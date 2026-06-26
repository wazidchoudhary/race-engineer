/**
 * Strategy Engine
 *
 * Handles pit strategy calculations including:
 * - Virtual pit exit position (rejoin ghost)
 * - Stint history tracking
 * - Optimal pit window based on wear + gaps
 */

import { SafetyCarStatus } from '../types/packets';
import type { LapData, CarStatus, SessionData } from '../types/packets';
import type { StintData, PitStrategy, WearPrediction } from '../types/store';
import { pitLossSeconds } from '../track-data/pit-loss-data';

export class StrategyEngine {
  private stints: StintData[] = [];
  private currentStintStart: number = 1;
  private currentCompound: number = -1;
  private lapTimes: number[] = [];

  /** Reset for new session */
  reset(): void {
    this.stints = [];
    this.currentStintStart = 1;
    this.currentCompound = -1;
    this.lapTimes = [];
  }

  /** Track stint changes */
  onLapComplete(lap: number, lapTimeMs: number, compound: number, avgWear: number): void {
    if (compound !== this.currentCompound && this.currentCompound !== -1) {
      // Pit stop detected — close current stint
      this.stints.push({
        compound: this.currentCompound,
        startLap: this.currentStintStart,
        endLap: lap - 1,
        avgWear,
        avgPace: this.getAvgPace(),
        laps: lap - 1 - this.currentStintStart + 1,
      });
      this.currentStintStart = lap;
      this.lapTimes = [];
    }

    this.currentCompound = compound;
    if (lapTimeMs > 0 && lapTimeMs < 300_000) { // Sanity check
      this.lapTimes.push(lapTimeMs);
    }
  }

  /**
   * Simulate "if I pit right now, where will I rejoin, and when should I pit?"
   *
   * - Pit loss is per-track ([[pit-loss-data]]), discounted under SC/VSC.
   * - Rejoin position prefers the game's own `pitStopRejoinPosition`; otherwise
   *   it is computed from gaps-to-leader (the only gap channel that is
   *   cumulative from the player), counting how many cars behind would jump
   *   ahead during the stop.
   * - When a tyre-wear prediction is available, derives an optimal pit lap from
   *   the cliff and a fallback window when the game provides none.
   */
  calculatePitRejoin(
    playerLap: LapData,
    allLaps: LapData[],
    playerIdx: number,
    session: SessionData,
    wearPrediction: WearPrediction | null = null,
  ): PitStrategy {
    // Per-track pit loss, discounted when a safety car neutralises the field.
    const baseLossSec = pitLossSeconds(session.trackId);
    const scFactor =
      session.safetyCarStatus === SafetyCarStatus.Full ? 0.5 :
      session.safetyCarStatus === SafetyCarStatus.Virtual ? 0.6 : 1;
    const pitLossSec = baseLossSec * scFactor;
    const pitLossMs = pitLossSec * 1000;

    const playerPos = playerLap.carPosition;
    const playerDtl = playerLap.deltaToLeaderMs || 0;

    // ── Rejoin estimate from gaps-to-leader (cars that would jump ahead) ──
    const carsBehind = allLaps
      .map((lap, idx) => ({ lap, idx }))
      .filter((e) => e.lap && e.idx !== playerIdx && e.lap.resultStatus >= 2 && e.lap.carPosition > playerPos)
      .sort((a, b) => a.lap.carPosition - b.lap.carPosition);

    let dropped = 0;
    let gapToCarAheadMs: number | null = null;
    let haveValidDeltas = playerDtl > 0;
    for (const { lap } of carsBehind) {
      const gapBehindMs = (lap.deltaToLeaderMs || 0) - playerDtl;
      if (gapBehindMs > 0) haveValidDeltas = true;
      if (gapBehindMs > 0 && gapBehindMs < pitLossMs) {
        dropped++;
        gapToCarAheadMs = pitLossMs - gapBehindMs; // we slot in just behind this car
      } else if (gapBehindMs >= pitLossMs) {
        break;
      }
    }

    // Prefer the game's own prediction; fall back to our estimate.
    const gameRejoin = session.pitStopRejoinPosition ?? 0;
    let rejoinPosition: number | null;
    let usingGameData = false;
    if (gameRejoin > 0) {
      rejoinPosition = gameRejoin;
      usingGameData = true;
    } else if (haveValidDeltas) {
      rejoinPosition = playerPos + dropped;
    } else {
      rejoinPosition = null; // no race timing (quali / time trial) — can't tell
    }
    const rejoinGap = gapToCarAheadMs != null ? gapToCarAheadMs / 1000 : null;

    // ── Tyre cliff → optimal pit lap ──
    const currentLap = playerLap.currentLapNum || 0;
    let lapsLeftOnTyres: number | null = null;
    let optimalPitLap: number | null = null;
    if (wearPrediction) {
      const cliffs = wearPrediction.predictedLapBelow40.filter(
        (v): v is number => v != null && v > 0,
      );
      if (cliffs.length > 0) {
        const cliffLap = Math.min(...cliffs);
        lapsLeftOnTyres = Math.max(0, cliffLap - currentLap);
        optimalPitLap = Math.max(currentLap + 1, cliffLap - 1); // pit ~1 lap before the cliff
      }
    }

    // ── Pit window: game value, else a fallback derived from the tyre cliff ──
    let idealLap = session.pitStopWindowIdealLap || 0;
    let latestLap = session.pitStopWindowLatestLap || 0;
    if (idealLap <= 0 && optimalPitLap != null) {
      idealLap = optimalPitLap;
      const cliffWindow = lapsLeftOnTyres != null ? currentLap + lapsLeftOnTyres : optimalPitLap + 1;
      latestLap = Math.max(idealLap, cliffWindow); // never show an inverted window
    }

    // ── Reason line ──
    const posLost = rejoinPosition != null ? rejoinPosition - playerPos : 0;
    let reason: string;
    if (rejoinPosition == null) {
      reason = 'Rejoin estimate needs live race timing';
    } else if (posLost <= 0) {
      reason = `Pit now → stay P${rejoinPosition} (clear air)`;
    } else {
      const places = posLost === 1 ? '1 place' : `${posLost} places`;
      const gapStr = rejoinGap != null ? `, +${rejoinGap.toFixed(1)}s to car ahead` : '';
      reason = `Pit now → P${rejoinPosition}, lose ${places}${gapStr}`;
    }

    return {
      idealLap,
      latestLap,
      rejoinPosition,
      rejoinGap,
      optimalPitLap,
      lapsLeftOnTyres,
      pitLossSec: Math.round(pitLossSec * 10) / 10,
      usingGameData,
      reason,
    };
  }

  /** Get completed stints */
  getStints(): StintData[] {
    return [...this.stints];
  }

  /** Get current stint data */
  getCurrentStint(currentLap: number, avgWear: number): StintData {
    return {
      compound: this.currentCompound,
      startLap: this.currentStintStart,
      endLap: null,
      avgWear,
      avgPace: this.getAvgPace(),
      laps: currentLap - this.currentStintStart + 1,
    };
  }

  private getAvgPace(): number {
    if (this.lapTimes.length === 0) return 0;
    return this.lapTimes.reduce((a, b) => a + b, 0) / this.lapTimes.length;
  }
}
