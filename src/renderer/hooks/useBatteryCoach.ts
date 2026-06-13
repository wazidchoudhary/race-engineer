/**
 * useBatteryCoach — drives the Battery Coach: builds the per-lap ERS plan for
 * the current track + battery state, tracks the car around the lap, and makes
 * the engineer speak position-aware battery calls (corner mode, burn zones,
 * lift-and-coast points, lap summaries).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { speak } from '../lib/tts-speaker';
import { api } from '../lib/tauri-api';
import {
  adviceAt,
  buildLapPlan,
  lapSummaryLine,
  batteryStance,
  type CoachAdvice,
  type LapPlan,
} from '../../shared/intelligence/ers-coach';
import { MAX_ERS_STORE_J, isRaceSessionType, isQualiSessionType } from '../../shared/types/packets';

export type CoachMode = 'auto' | 'race' | 'quali';

export interface CoachCall {
  text: string;
  at: number;
}

export function useBatteryCoach(voiceEnabled: boolean, modeOverride: CoachMode) {
  const ctx = useTelemetryContext();
  const { session, status, telemetry, telemetry2, lapData, playerCarIndex, connected } = ctx;
  const playerLap = lapData?.[playerCarIndex] ?? null;

  const [calls, setCalls] = useState<CoachCall[]>([]);
  const voiceRef = useRef('en-GB-RyanNeural');

  useEffect(() => {
    api.loadSettings?.().then((s: any) => {
      if (s?.tts?.voice) voiceRef.current = s.tts.voice;
    }).catch(() => {});
  }, []);

  const raceMode: 'race' | 'quali' = useMemo(() => {
    if (modeOverride === 'race') return 'race';
    if (modeOverride === 'quali') return 'quali';
    const t = session?.sessionType;
    if (isQualiSessionType(t) || t === 18) return 'quali';
    if (isRaceSessionType(t)) return 'race';
    return 'race';
  }, [modeOverride, session?.sessionType]);

  const storePct = status ? (status.ersStoreEnergy / MAX_ERS_STORE_J) * 100 : 0;
  // Quantise battery so the plan doesn't rebuild every tick: race plans only
  // depend on the stance band; quali budgets use the percentage directly
  // (ers-coach), so track it in 10% steps there.
  const stance = batteryStance(storePct);
  const qualiPct = Math.round(storePct / 10) * 10;
  const planBatteryPct = raceMode === 'quali' ? qualiPct : storePct;
  const harvestLimitJ = status?.ersHarvestLimitPerLap || undefined;

  const plan: LapPlan | null = useMemo(() => {
    if (!session) return null;
    return buildLapPlan({
      trackId: session.trackId,
      trackLengthM: session.trackLength,
      batteryPct: planBatteryPct,
      raceMode,
      harvestLimitJ,
      drsZones: session.drsZones,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session?.trackId,
    session?.trackLength,
    stance,
    raceMode === 'quali' ? qualiPct : null,
    raceMode,
    harvestLimitJ,
    session?.drsZones?.length,
  ]);

  const advice: CoachAdvice | null = useMemo(() => {
    if (!plan || !status || !playerLap) return null;
    return adviceAt(plan, {
      lapDistanceM: Math.max(0, playerLap.lapDistance ?? 0),
      speedKph: telemetry?.speed ?? 0,
      gear: telemetry?.gear ?? 0,
      brake: telemetry?.brake ?? 0,
      throttle: telemetry?.throttle ?? 0,
      ersStoreJ: status.ersStoreEnergy,
      ersDeployedThisLapJ: status.ersDeployedThisLap,
      ersHarvestedThisLapJ: (status.ersHarvestedMGUK ?? 0) + (status.ersHarvestedMGUH ?? 0),
      ersHarvestLimitJ: harvestLimitJ,
      ersDeployMode: status.ersDeployMode,
      overtakeAvailable: telemetry2 ? telemetry2.overtakeAvailable === 1 : undefined,
      overtakeActive: telemetry2 ? telemetry2.overtakeActive === 1 : undefined,
    }, raceMode);
  }, [plan, status, telemetry, telemetry2, playerLap, raceMode, harvestLimitJ]);

  // ── Voice engine ──
  const spokenThisLap = useRef<Set<string>>(new Set());
  const lastLapNum = useRef(0);
  const lastStance = useRef(stance);
  // Snapshot of the per-lap counters from the LAST tick of the previous lap —
  // by the time we notice the lap-number change, the live status has already
  // reset ersDeployedThisLap/Harvested for the new lap.
  const prevLapStats = useRef<{ deployedJ: number; harvestedJ: number; storePct: number } | null>(null);

  const pushCall = (text: string, priority: number, dedupe: string) => {
    setCalls((prev) => [...prev.slice(-29), { text, at: Date.now() }]);
    if (voiceEnabled) {
      speak(text, { voice: voiceRef.current, priority, dedupeBy: dedupe });
    }
  };

  // Segment-entry + look-ahead calls, keyed once per lap per segment.
  useEffect(() => {
    if (!plan || !advice || !connected || !playerLap) return;

    const lapNum = playerLap.currentLapNum ?? 0;
    if (lapNum !== lastLapNum.current) {
      // Lap rollover: summarise the lap that just ended from the snapshot.
      const prev = prevLapStats.current;
      if (lastLapNum.current > 0 && prev && voiceEnabled) {
        const line = lapSummaryLine({
          deployedJ: prev.deployedJ,
          harvestedJ: prev.harvestedJ,
          harvestLimitJ,
          endStorePct: prev.storePct,
          raceMode,
        });
        pushCall(line, 4, 'coach-lap-summary');
      }
      spokenThisLap.current.clear();
      lastLapNum.current = lapNum;
      prevLapStats.current = null;
    } else if (status) {
      // Same lap: keep the snapshot fresh so the rollover summary reflects
      // the final values of this lap.
      prevLapStats.current = {
        deployedJ: status.ersDeployedThisLap ?? 0,
        harvestedJ: (status.ersHarvestedMGUK ?? 0) + (status.ersHarvestedMGUH ?? 0),
        storePct: (status.ersStoreEnergy / MAX_ERS_STORE_J) * 100,
      };
    }

    // Stance transition calls (critical / full) — these jump the queue.
    if (stance !== lastStance.current) {
      lastStance.current = stance;
      if (stance === 'critical') {
        pushCall('Battery critical. Deployment off — lift and coast, rebuild to thirty percent.', 8, 'coach-stance');
      } else if (stance === 'full') {
        pushCall('Battery full. Burn it — holding one hundred percent wastes harvest.', 6, 'coach-stance');
      }
    }

    // Current-segment entry call.
    const seg = advice.segment;
    if (seg && seg.voice) {
      const key = `seg:${seg.fromPct.toFixed(3)}`;
      if (!spokenThisLap.current.has(key)) {
        spokenThisLap.current.add(key);
        pushCall(seg.voice, seg.priority, key);
      }
    }

    // Look-ahead for lift-and-coast: call it ~150 m early so the driver can act.
    // Keyed off advice.nextLift (the nearest lift zone regardless of intervening
    // deploy zones) — using advice.next here meant a closer boost/medium segment
    // swallowed the heads-up and the lift call only landed once the car was
    // already at the braking zone.
    if (advice.nextLift && advice.nextLiftInM != null && advice.nextLiftInM < 150) {
      const preKey = `pre:${advice.nextLift.fromPct.toFixed(3)}`;
      const segKey = `seg:${advice.nextLift.fromPct.toFixed(3)}`;
      if (!spokenThisLap.current.has(preKey) && !spokenThisLap.current.has(segKey)) {
        spokenThisLap.current.add(preKey);
        // Also mark the entry key — the same line would otherwise repeat
        // seconds later when the car enters the segment.
        spokenThisLap.current.add(segKey);
        pushCall(advice.nextLift.voice, advice.nextLift.priority, preKey);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advice, plan, connected, playerLap?.currentLapNum, stance, voiceEnabled]);

  return {
    plan,
    advice,
    raceMode,
    storePct,
    stance,
    harvestLimitJ,
    calls,
    playerLap,
    status,
    telemetry,
    telemetry2,
    session,
    connected,
  };
}
