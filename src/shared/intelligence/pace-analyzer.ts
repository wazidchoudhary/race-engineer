/**
 * Pace Analysis Engine
 *
 * Tracks sector times across all cars to identify the session's
 * "ultimate best" (purple) sectors and compares the player's
 * current performance against them.
 *
 * Provides suggestions on where time is being lost.
 */

import type { LapData, CarTelemetry } from '../types/packets';
import type { PurpleSectors, PaceAnalysis, SectorTime } from '../types/store';

const TRACK_SECTORS: Record<number, string[]> = {
  // trackId -> corner names per sector (simplified)
  0:  ['T1-T5', 'T6-T10', 'T11-T14'],    // Melbourne
  3:  ['T1-T4', 'T5-T10', 'T11-T15'],     // Bahrain
  5:  ['Ste Devote-Casino', 'Mirabeau-Piscine', 'Rascasse-Anthony Noghes'], // Monaco
  7:  ['Copse-Maggotts', 'Becketts-Stowe', 'Club-Abbey'],   // Silverstone
  10: ['La Source-Rivage', 'Pouhon-Stavelot', 'Blanchimont-Bus Stop'], // Spa
  11: ['Variante del Rettifilo', 'Lesmos-Ascari', 'Parabolica'], // Monza
  13: ['T1-T6', 'Degner-Spoon', '130R-Casio'],  // Suzuka
  14: ['T1-T3', 'T4-T11', 'T12-T21'],     // Abu Dhabi
};

export class PaceAnalyzer {
  private purpleSectors: PurpleSectors = {
    sector1Ms: Infinity,
    sector2Ms: Infinity,
    sector3Ms: Infinity,
    sector1CarIdx: -1,
    sector2CarIdx: -1,
    sector3CarIdx: -1,
  };

  private personalBestLap: SectorTime | null = null;
  private lastLapSectors: Map<number, SectorTime> = new Map();
  /** Last seen currentLapNum per car — used to detect lap rollovers. */
  private carLastLap: Map<number, number> = new Map();
  /** Most recent in-lap S1/S2 per car, snapshotted while both are present so
   *  they can be paired with lastLapTimeMs the instant the lap rolls over. */
  private carSectorSnap: Map<number, { s1: number; s2: number }> = new Map();

  /** Reset for new session */
  reset(): void {
    this.purpleSectors = {
      sector1Ms: Infinity,
      sector2Ms: Infinity,
      sector3Ms: Infinity,
      sector1CarIdx: -1,
      sector2CarIdx: -1,
      sector3CarIdx: -1,
    };
    this.personalBestLap = null;
    this.lastLapSectors.clear();
    this.carLastLap.clear();
    this.carSectorSnap.clear();
  }

  /** Process lap data for all cars to update purple sectors */
  processLapData(lapData: LapData[], playerCarIndex: number): void {
    for (let i = 0; i < lapData.length; i++) {
      const car = lapData[i];
      if (!car || car.resultStatus < 2) continue; // Skip inactive

      // Purple S1/S2 come straight from the live current-lap sector times — the
      // game reports each the moment that sector is crossed, so they're valid.
      if (car.sector1TimeMs > 0 && car.sector1TimeMs < this.purpleSectors.sector1Ms) {
        this.purpleSectors.sector1Ms = car.sector1TimeMs;
        this.purpleSectors.sector1CarIdx = i;
      }
      if (car.sector2TimeMs > 0 && car.sector2TimeMs < this.purpleSectors.sector2Ms) {
        this.purpleSectors.sector2Ms = car.sector2TimeMs;
        this.purpleSectors.sector2CarIdx = i;
      }

      // S3 has no telemetry field — derive it as lap − S1 − S2. At the rollover
      // the live S1/S2 have already reset to 0, so we pair lastLapTimeMs with the
      // S1/S2 snapshotted on an earlier tick. Consume the snapshot at rollover
      // BEFORE refreshing it below, so a sector freshly crossed on the new lap
      // can never overwrite the completed lap's values before we read them.
      const lapNum = car.currentLapNum ?? 0;
      const prevLap = this.carLastLap.get(i);
      if (prevLap !== undefined && lapNum > prevLap && car.lastLapTimeMs > 0) {
        const snap = this.carSectorSnap.get(i);
        if (snap) {
          const s3 = car.lastLapTimeMs - snap.s1 - snap.s2;
          if (s3 > 0 && s3 < 180_000) {
            const sectors: SectorTime = {
              sector1Ms: snap.s1,
              sector2Ms: snap.s2,
              sector3Ms: s3,
            };
            this.lastLapSectors.set(i, sectors);

            if (s3 < this.purpleSectors.sector3Ms) {
              this.purpleSectors.sector3Ms = s3;
              this.purpleSectors.sector3CarIdx = i;
            }

            // Update personal best off the just-completed lap time.
            if (i === playerCarIndex &&
                (!this.personalBestLap || car.lastLapTimeMs < this.getLapTime(this.personalBestLap))) {
              this.personalBestLap = sectors;
            }
          }
        }
        // Start the next lap's snapshot fresh.
        this.carSectorSnap.delete(i);
      }

      // Snapshot the in-progress lap's S1/S2 for the NEXT rollover (after the
      // consume above, so the rollover tick can't clobber the completed lap).
      if (car.sector1TimeMs > 0 && car.sector2TimeMs > 0) {
        this.carSectorSnap.set(i, { s1: car.sector1TimeMs, s2: car.sector2TimeMs });
      }

      this.carLastLap.set(i, lapNum);
    }
  }

  /** Get pace analysis for the player */
  analyze(playerCarIndex: number, trackId: number): PaceAnalysis {
    const playerSectors = this.lastLapSectors.get(playerCarIndex) ?? null;
    const sectorNames = TRACK_SECTORS[trackId] ?? ['S1', 'S2', 'S3'];

    let deltaToUltimate: SectorTime | null = null;
    let suggestion: string | null = null;

    if (playerSectors && this.purpleSectors.sector1Ms < Infinity) {
      deltaToUltimate = {
        sector1Ms: playerSectors.sector1Ms - this.purpleSectors.sector1Ms,
        sector2Ms: playerSectors.sector2Ms - this.purpleSectors.sector2Ms,
        sector3Ms: playerSectors.sector3Ms - this.purpleSectors.sector3Ms,
      };

      // Find worst sector
      const deltas = [deltaToUltimate.sector1Ms, deltaToUltimate.sector2Ms, deltaToUltimate.sector3Ms];
      const worstIdx = deltas.indexOf(Math.max(...deltas));
      const worstDelta = deltas[worstIdx];

      if (worstDelta > 200) {
        suggestion = `Losing ${(worstDelta / 1000).toFixed(2)}s in ${sectorNames[worstIdx]} — check braking points and apex timing`;
      } else if (worstDelta > 100) {
        suggestion = `Minor time loss in ${sectorNames[worstIdx]} (+${(worstDelta / 1000).toFixed(2)}s) — tighten exit speed`;
      }
    }

    return {
      ultimateBest: { ...this.purpleSectors },
      personalBest: this.personalBestLap ? { ...this.personalBestLap } : null,
      currentLap: playerSectors,
      deltaToUltimate,
      suggestion,
    };
  }

  private getLapTime(s: SectorTime): number {
    return s.sector1Ms + s.sector2Ms + s.sector3Ms;
  }
}
