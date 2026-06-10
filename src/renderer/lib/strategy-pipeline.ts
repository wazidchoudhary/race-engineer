/**
 * Strategy Pipeline
 *
 * Owns:
 *  • debouncing & rate-limiting strategy calls (floor 30s, cancel-on-newer 3s)
 *  • building a compact telemetry snapshot (player + 3 ahead + 3 behind + session)
 *  • dispatching Haiku calls via api.callStrategy
 *
 * Inputs are plain telemetry objects from TelemetryContext. The pipeline never
 * mutates them — it only reads.
 */
import { api, type StrategyDecision } from './tauri-api';

export type StrategyTrigger =
  | 'lap_complete'
  | 'sc_deployed'
  | 'vsc_deployed'
  | 'rain_onset'
  | 'rain_heavier'
  | 'damage_escalated'
  | 'tyre_cliff'
  | 'rival_pitted'
  | 'user_ask'
  | 'session_change';

const MIN_INTERVAL_MS = 30_000;      // hard floor between calls
const NEWER_CANCEL_MS = 3_000;       // cancel in-flight if a newer trigger arrives within this
const MAX_IN_FLIGHT = 1;

interface PendingCall {
  trigger: StrategyTrigger;
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
  question?: string;
}

interface PipelineState {
  lastCallAt: number;
  pending: PendingCall | null;
  inFlight: number;
}

const PRIORITY: Record<StrategyTrigger, number> = {
  sc_deployed: 10,
  vsc_deployed: 9,
  rain_onset: 9,
  rain_heavier: 8,
  damage_escalated: 8,
  tyre_cliff: 7,
  user_ask: 6,
  rival_pitted: 5,
  lap_complete: 3,
  session_change: 2,
};

export interface TelemetrySources {
  connected: boolean;
  session: any;
  lapData: any[] | null;
  telemetry: any;
  status: any;
  damage: any;
  allCarStatus: any[] | null;
  allCarTelemetry: any[] | null;
  allCarDamage: any[] | null;
  participants: any;
  playerCarIndex: number;
  bestLapTimes: Record<number, number>;
  paceHistory?: { lap: number; lapTimeMs: number; compound: number }[];
}

export interface StrategyResult {
  decision?: StrategyDecision;
  error?: string;
  trigger: StrategyTrigger;
  tookMs: number;
}

// Per-track pit loss seconds (approximate)
const PIT_LOSS: Record<number, number> = {
  5: 19,   // Monaco
  12: 23,  // Singapore
  0: 21,   // Melbourne
  7: 22,   // Silverstone
  10: 22,  // Spa
  11: 20,  // Monza
  15: 21,  // Austin/Texas
};
const DEFAULT_PIT_LOSS = 22;

function compoundName(c: number): string {
  switch (c) {
    case 16: return 'soft';
    case 17: return 'medium';
    case 18: return 'hard';
    case 7: return 'inter';
    case 8: return 'wet';
    default: return 'unknown';
  }
}

function ms2s(ms: number): number {
  return Math.round((ms / 1000) * 100) / 100;
}

/**
 * Build a compact JSON snapshot for the strategy call.
 * Aggressive trimming: only the player and up to 3 cars ahead + 3 behind.
 */
export function buildSnapshot(src: TelemetrySources): any {
  const { session, lapData, status, damage, telemetry, allCarStatus, participants } = src;
  const playerIdx = src.playerCarIndex ?? 0;
  const playerLap = lapData?.[playerIdx];
  if (!session || !playerLap) return null;

  const myPos = playerLap.carPosition || 0;
  const trackId = session.trackId ?? -1;
  const pitLossSec = PIT_LOSS[trackId] ?? DEFAULT_PIT_LOSS;

  function rivalAt(offset: number): any | null {
    if (!Array.isArray(lapData)) return null;
    const pos = myPos + offset;
    const idx = lapData.findIndex((l: any) => l && l.carPosition === pos);
    if (idx < 0) return null;
    const lap = lapData[idx];
    const sts = allCarStatus?.[idx];
    const name =
      participants?.participants?.[idx]?.name ||
      `P${pos}`;
    return {
      position: pos,
      name,
      compound: compoundName(sts?.visualTyreCompound ?? -1),
      tyreAgeLaps: sts?.tyresAgeLaps ?? null,
      gapToAheadSec: ms2s(lap.deltaToCarAheadMs ?? 0),
      lastLapSec: ms2s(lap.lastLapTimeMs ?? 0),
      resultStatus: lap.resultStatus ?? 0,
      pitStatus: lap.pitStatus ?? 0,
    };
  }

  const rivalsAhead = [1, 2, 3]
    .map((o) => rivalAt(-o))
    .filter(Boolean);
  const rivalsBehind = [1, 2, 3]
    .map((o) => rivalAt(+o))
    .filter(Boolean);

  // Forecast trimming (first 5 samples only)
  const forecast = Array.isArray(session.weatherForecast)
    ? session.weatherForecast.slice(0, 5).map((s: any) => ({
        timeOffsetMin: s.timeOffset,
        weather: s.weather,
        trackTemp: s.trackTemp,
        airTemp: s.airTemp,
        rainPct: s.rainPercentage,
      }))
    : [];

  const wearFL = damage?.tyresWear?.[2] ?? 0;
  const wearFR = damage?.tyresWear?.[3] ?? 0;
  const wearRL = damage?.tyresWear?.[0] ?? 0;
  const wearRR = damage?.tyresWear?.[1] ?? 0;
  const maxWear = Math.max(wearFL, wearFR, wearRL, wearRR);

  // Pace trend from paceHistory (last 5 laps)
  const pace = (src.paceHistory ?? []).slice(-5).map((p) => ({
    lap: p.lap,
    lapTimeSec: ms2s(p.lapTimeMs),
    compound: compoundName(p.compound),
  }));

  return {
    session: {
      trackId,
      trackName: session.trackName ?? 'Unknown',
      sessionType: session.sessionTypeName ?? session.sessionType,
      totalLaps: session.totalLaps,
      currentLap: playerLap.currentLapNum,
      remainingLaps: Math.max(0, (session.totalLaps || 0) - (playerLap.currentLapNum || 0)),
      weather: session.weatherName ?? session.weather,
      trackTemp: session.trackTemperature,
      airTemp: session.airTemperature,
      safetyCarStatus: session.safetyCarStatus,
      pitWindowIdealLap: session.pitStopWindowIdealLap,
      pitWindowLatestLap: session.pitStopWindowLatestLap,
      pitLossSec,
      forecast,
    },
    player: {
      position: myPos,
      gridPosition: playerLap.gridPosition,
      compound: compoundName(status?.visualTyreCompound ?? -1),
      tyreAgeLaps: status?.tyresAgeLaps ?? 0,
      lastLapSec: ms2s(playerLap.lastLapTimeMs ?? 0),
      currentLapSec: ms2s(playerLap.currentLapTimeMs ?? 0),
      sector1Sec: ms2s(playerLap.sector1TimeMs ?? 0),
      sector2Sec: ms2s(playerLap.sector2TimeMs ?? 0),
      pace,
      wear: { FL: Math.round(wearFL), FR: Math.round(wearFR), RL: Math.round(wearRL), RR: Math.round(wearRR), max: Math.round(maxWear) },
      temps: {
        FL: telemetry?.tyreSurfaceTemp?.[2],
        FR: telemetry?.tyreSurfaceTemp?.[3],
        RL: telemetry?.tyreSurfaceTemp?.[0],
        RR: telemetry?.tyreSurfaceTemp?.[1],
      },
      damage: {
        frontWing: Math.max(damage?.frontLeftWingDamage ?? 0, damage?.frontRightWingDamage ?? 0),
        rearWing: damage?.rearWingDamage ?? 0,
        floor: damage?.floorDamage ?? 0,
        engine: damage?.engineDamage ?? 0,
        gearbox: damage?.gearBoxDamage ?? 0,
      },
      fuelKg: status?.fuelInTank ?? 0,
      fuelRemainingLaps: status?.fuelRemainingLaps ?? 0,
      ersStorePct: Math.round(((status?.ersStoreEnergy ?? 0) / 4_000_000) * 100),
      ersDeployMode: status?.ersDeployMode ?? 0,
      penaltiesSec: playerLap.penalties ?? 0,
      warnings: playerLap.totalWarnings ?? 0,
    },
    rivalsAhead,
    rivalsBehind,
  };
}

/**
 * Create a strategy pipeline instance. One per app session.
 */
export function createStrategyPipeline() {
  const st: PipelineState = { lastCallAt: 0, pending: null, inFlight: 0 };

  async function execute(
    trigger: StrategyTrigger,
    src: TelemetrySources,
    question: string | undefined,
    onResult: (r: StrategyResult) => void,
  ): Promise<void> {
    if (st.inFlight >= MAX_IN_FLIGHT) return;
    const snapshot = buildSnapshot(src);
    if (!snapshot) return;

    const t0 = performance.now();
    st.inFlight += 1;
    st.lastCallAt = Date.now();
    try {
      const res = await api.callStrategy({ snapshot, trigger, question });
      const tookMs = Math.round(performance.now() - t0);
      if (res?.error) {
        onResult({ error: res.message || res.error, trigger, tookMs });
      } else if (res?.decision) {
        onResult({ decision: res.decision, trigger, tookMs });
      } else {
        onResult({ error: 'Empty response', trigger, tookMs });
      }
    } catch (e: any) {
      onResult({ error: e?.message ?? String(e), trigger, tookMs: Math.round(performance.now() - t0) });
    } finally {
      st.inFlight -= 1;
    }
  }

  /**
   * Request a strategy call. Returns true if accepted (will fire now or later),
   * false if dropped (rate-limited and lower priority than pending).
   */
  function request(
    trigger: StrategyTrigger,
    src: TelemetrySources,
    onResult: (r: StrategyResult) => void,
    question?: string,
  ): boolean {
    const now = Date.now();
    const sinceLast = now - st.lastCallAt;
    const needsDelay = sinceLast < MIN_INTERVAL_MS;

    // User asks bypass floor — they pressed the button, they get a call.
    if (trigger === 'user_ask') {
      if (st.pending?.timer) clearTimeout(st.pending.timer);
      st.pending = null;
      void execute(trigger, src, question, onResult);
      return true;
    }

    // If a pending call exists, keep the higher-priority trigger.
    if (st.pending) {
      const currentPri = PRIORITY[st.pending.trigger];
      const newPri = PRIORITY[trigger];
      if (newPri <= currentPri) return false;
      if (st.pending.timer) clearTimeout(st.pending.timer);
      st.pending = null;
    }

    if (!needsDelay) {
      void execute(trigger, src, question, onResult);
      return true;
    }

    // Schedule for later — but if the trigger is emergency-level, cut the wait.
    const urgent = PRIORITY[trigger] >= 8;
    const delayMs = urgent ? Math.min(NEWER_CANCEL_MS, MIN_INTERVAL_MS - sinceLast) : MIN_INTERVAL_MS - sinceLast;
    const pending: PendingCall = { trigger, timer: null, startedAt: now, question };
    pending.timer = setTimeout(() => {
      st.pending = null;
      void execute(trigger, src, question, onResult);
    }, Math.max(100, delayMs));
    st.pending = pending;
    return true;
  }

  function cancel(): void {
    if (st.pending?.timer) clearTimeout(st.pending.timer);
    st.pending = null;
  }

  function getState() {
    return {
      lastCallAt: st.lastCallAt,
      pendingTrigger: st.pending?.trigger ?? null,
      inFlight: st.inFlight,
    };
  }

  return { request, cancel, getState };
}
