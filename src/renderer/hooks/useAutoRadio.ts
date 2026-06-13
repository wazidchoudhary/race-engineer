/**
 * useAutoRadio — slim, canonical situation engine.
 *
 * Only fires situations that appear in `lib/radio-canonical.ts`. Every
 * situation is gated by the user's RadioConfig (Master + category + situation).
 * Audio is queued through `lib/tts-speaker.ts::speak` so messages never overlap
 * and the IndexedDB phrase cache is reused. AI-enabled categories route through
 * Claude (`askEngineer`) for a tailored line; everything else uses edge-tts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefs } from '../context/PrefsContext';
import { api } from '../lib/tauri-api';
import { speak } from '../lib/tts-speaker';
import { globalInteractionTracker, shouldSpeak } from '../lib/emergency-gate';
import {
  isCategoryAi,
  isSituationEnabled,
  urgencyFor,
  type Urgency,
} from '../lib/radio-canonical';
import type { TelemetryContextValue } from '../context/TelemetryContext';

export interface RadioMessage {
  text: string;
  timestamp: number;
  urgency: Urgency;
  category: string;
  situation: string;
}

/** Per-situation cooldown to prevent spam. Defaults to 60s if not listed. */
const SITUATION_COOLDOWN_MS: Record<string, number> = {
  // tyres
  high_wear: 60_000, critical_wear: 45_000, graining: 90_000, blistering: 90_000,
  cold_tyres: 60_000, overheating: 45_000, optimal_temp: 120_000,
  // incident
  wing_damage: 30_000, floor_damage: 30_000, puncture: 15_000,
  engine_damage: 30_000, gearbox_issue: 30_000, ers_fault: 30_000,
  // flags
  yellow_flag: 20_000, safety_car: 15_000, virtual_sc: 15_000,
  red_flag: 15_000, blue_flag: 20_000, green_flag: 20_000,
  // racecraft
  drs_available: 30_000, car_behind_close: 30_000, car_ahead_close: 30_000,
  overtake_opportunity: 30_000, defend_position: 30_000, slipstream: 60_000,
  // normal
  position_gained: 15_000, position_lost: 15_000, fastest_lap: 15_000,
  gap_change: 45_000, fuel_warning: 60_000, fuel_critical: 30_000,
  // weather
  rain_incoming: 60_000, rain_started: 30_000, drying_track: 60_000, temperature_change: 120_000,
  // pit
  pit_window_open: 60_000, undercut_threat: 45_000, overcut_opportunity: 45_000,
  box_now: 30_000, stay_out: 30_000, sc_pit_opportunity: 20_000,
  // ers
  low_battery: 60_000, full_battery: 90_000, harvest_mode: 90_000, deploy_opportunity: 60_000,
  // start
  formation_lap: 60_000, lights_out: 30_000, good_start: 30_000, poor_start: 30_000,
  // session
  session_start: 60_000, halfway_point: 120_000, final_laps: 60_000, checkered_flag: 30_000,
  // pace
  personal_best: 30_000, pace_drop: 60_000, consistent_pace: 120_000, sector_improvement: 60_000,
  // drs
  drs_enabled: 30_000, drs_disabled: 30_000, drs_detection: 30_000,
  // penalties
  track_limits_warning: 30_000, penalty_received: 15_000, penalty_served: 30_000,
  // finish
  last_lap: 30_000, finish_position: 30_000, race_complete: 60_000,
};

function fmtLap(ms: number): string {
  if (!ms || ms <= 0) return '--:--.---';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

// F1 24/25/26 enum: Race = 15..17 (10..12 are Sprint Shootouts).
function isRaceSession(s: any): boolean {
  return !!s && s.sessionType >= 15 && s.sessionType <= 17;
}

interface DetectionMemory {
  lap: number;
  prevPos: number;
  gridPos: number;
  weather: number | null;
  fiaFlag: number;
  scStatus: number;
  drsAllowed: number;
  maxWearReported: number;
  reportedDamage: Record<string, number>;
  ersState: 'normal' | 'low' | 'full';
  fuelWarned: boolean;
  fuelCriticalWarned: boolean;
  rainPctForecast: number;
  lastLapTimeMs: number;
  bestLapTimeMs: number;
  halfwaySpoken: boolean;
  finalLapsSpoken: boolean;
  raceCompleteSpoken: boolean;
  startSpoken: boolean;
  sessionStartSpoken: boolean;
  formationSpoken: boolean;
  paceDropLap: number;
  paceConsistencyLap: number;
  pittedNearby: Set<number>;
  rivalAheadCloseReported: number;   // epoch ms
  rivalBehindCloseReported: number;
  sessionSig: string;
}

function freshMemory(): DetectionMemory {
  return {
    lap: 0,
    prevPos: 0,
    gridPos: 0,
    weather: null,
    fiaFlag: 0,
    scStatus: 0,
    drsAllowed: 0,
    maxWearReported: 0,
    reportedDamage: {},
    ersState: 'normal',
    fuelWarned: false,
    fuelCriticalWarned: false,
    rainPctForecast: 0,
    lastLapTimeMs: 0,
    bestLapTimeMs: 0,
    halfwaySpoken: false,
    finalLapsSpoken: false,
    raceCompleteSpoken: false,
    startSpoken: false,
    sessionStartSpoken: false,
    formationSpoken: false,
    paceDropLap: 0,
    paceConsistencyLap: 0,
    pittedNearby: new Set(),
    rivalAheadCloseReported: 0,
    rivalBehindCloseReported: 0,
    sessionSig: '',
  };
}

export function useAutoRadio(
  ctx: TelemetryContextValue,
  ttsEnabled: boolean,
  ttsVoice: string,
  /** Popout windows set this — keep the local feed but never spend on
   *  Claude calls (the main window already makes them). */
  suppressAi = false,
): { messages: RadioMessage[]; clearMessages: () => void } {
  const prefs = usePrefs();
  const [messages, setMessages] = useState<RadioMessage[]>([]);

  // Keep refs fresh without re-arming the interval.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const ttsRef = useRef({ enabled: ttsEnabled, voice: ttsVoice });
  ttsRef.current = { enabled: ttsEnabled, voice: ttsVoice };
  const suppressAiRef = useRef(suppressAi);
  suppressAiRef.current = suppressAi;

  const memRef = useRef<DetectionMemory>(freshMemory());
  const triggerLogRef = useRef<Record<string, number>>({});

  /** Cooldown gate: returns true if we may fire this situation now. */
  const canFire = useCallback((situation: string, now: number): boolean => {
    const last = triggerLogRef.current[situation] || 0;
    const cd = SITUATION_COOLDOWN_MS[situation] ?? 60_000;
    return now - last >= cd;
  }, []);

  const markFired = useCallback((situation: string, now: number): void => {
    triggerLogRef.current[situation] = now;
  }, []);

  /**
   * Emit a radio message. Gated by RadioConfig (Master + category + situation),
   * cooldowns, then queued through `speak()`. Returns true if accepted.
   */
  const emit = useCallback((
    category: string,
    situation: string,
    classicText: string,
    aiContextHint?: string,
  ): boolean => {
    const p = prefsRef.current;
    if (!p.radioMasterEnabled) return false;
    if (!isSituationEnabled(p.radioConfig, category, situation)) return false;

    const now = Date.now();
    if (!canFire(situation, now)) return false;
    markFired(situation, now);

    const urgency = urgencyFor(category, situation);

    const push = (text: string): void => {
      const msg: RadioMessage = { text, timestamp: Date.now(), urgency, category, situation };
      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
      if (!ttsRef.current.enabled) return;
      const gate = shouldSpeak({
        category, urgency, situation,
        userAsked: false,
        lastUserInteractionAt: globalInteractionTracker.getLastAt(),
      });
      if (!gate.shouldSpeak) return;
      const priority = urgency === 'critical' ? 9 : urgency === 'high' ? 7 : urgency === 'medium' ? 4 : 2;
      speak(text, {
        voice: ttsRef.current.voice,
        priority,
        interrupt: urgency === 'critical',
      });
    };

    // AI path — only if category is AI-enabled and we have premium + key.
    // Suppressed in popout windows so each open window doesn't fire its own
    // paid Claude call for the same situation.
    if (!suppressAiRef.current && isCategoryAi(p.radioConfig, category)) {
      const snapshot = buildContextSnapshot(ctxRef.current, category, situation, aiContextHint);
      // Fire-and-forget; fall back to classic text if AI rejects.
      api.askEngineer({
        question: `Generate a single radio line for situation "${situation}" in category "${category}". Telemetry: ${JSON.stringify(snapshot)}. Reply with ONE short sentence (≤20 words), engineer-style, no preamble.`,
        context: snapshot,
        mode: 'DRIVER_RADIO',
      })
        .then((res) => {
          const aiText = (res?.response || '').trim();
          push(aiText && !res?.error ? aiText : classicText);
        })
        .catch(() => push(classicText));
      return true;
    }

    push(classicText);
    return true;
  }, [canFire, markFired]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      try {
        runDetectors(ctxRef.current, memRef.current, emit);
      } catch (e) {
        console.error('[useAutoRadio] detector error:', e);
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [emit]);

  const clearMessages = useCallback(() => setMessages([]), []);
  return { messages, clearMessages };
}

// ─── Detector implementations ───────────────────────────────────────────────

type EmitFn = (category: string, situation: string, classicText: string, aiHint?: string) => boolean;

function buildContextSnapshot(ctx: TelemetryContextValue, category: string, situation: string, hint?: string): any {
  const tel = ctx.telemetry;
  const sts = ctx.status;
  const dmg = ctx.damage;
  const ses = ctx.session;
  const lap = ctx.lapData?.[ctx.playerCarIndex];
  return {
    category, situation, hint: hint ?? null,
    track: ses?.trackName, sessionType: ses?.sessionTypeName,
    weather: ses?.weatherName,
    position: lap?.carPosition, currentLap: lap?.currentLapNum, totalLaps: ses?.totalLaps,
    lastLapMs: lap?.lastLapTimeMs, deltaAheadMs: lap?.deltaToCarAheadMs,
    speedKph: tel?.speed, gear: tel?.gear,
    drsAllowed: sts?.drsAllowed === 1, drsActive: tel?.drs === 1,
    fuelKg: sts?.fuelInTank, fuelLapsLeft: sts?.fuelRemainingLaps,
    ersPct: sts ? +((sts.ersStoreEnergy / 4_000_000) * 100).toFixed(1) : null,
    tyreAgeLaps: sts?.tyresAgeLaps,
    tyreWearMax: Array.isArray(dmg?.tyresWear) ? Math.max(...dmg!.tyresWear) : null,
    safetyCarStatus: ses?.safetyCarStatus,
  };
}

function runDetectors(ctx: TelemetryContextValue, mem: DetectionMemory, emit: EmitFn): void {
  if (!ctx.connected) return;
  const ses = ctx.session;
  if (!ses) return;
  const lap = ctx.lapData?.[ctx.playerCarIndex] ?? null;
  const tel = ctx.telemetry;
  const sts = ctx.status;
  const dmg = ctx.damage;

  // Reset memory on session change.
  const sig = `${ses.trackId}|${ses.sessionType}`;
  if (sig !== mem.sessionSig) {
    Object.assign(mem, freshMemory());
    mem.sessionSig = sig;
  }

  // Session start (one-shot per session)
  if (!mem.sessionStartSpoken && (lap?.currentLapNum ?? 0) === 0) {
    if (emit('session', 'session_start', `Session live. ${ses.sessionTypeName || ''} at ${ses.trackName || 'the circuit'}. Standing by.`)) {
      mem.sessionStartSpoken = true;
    }
  }

  // ── start phase (race only) ──
  if (isRaceSession(ses) && lap) {
    if (!mem.formationSpoken && (ses.safetyCarStatus === 3 || (lap.currentLapNum === 0 && (tel?.speed ?? 0) > 5))) {
      if (emit('start', 'formation_lap', 'Formation lap underway. Weave to keep heat in the tyres.')) {
        mem.formationSpoken = true;
      }
    }
    if (!mem.startSpoken && lap.currentLapNum === 1 && (tel?.speed ?? 0) > 50) {
      const grid = lap.gridPosition || mem.gridPos || lap.carPosition;
      if (mem.gridPos === 0) mem.gridPos = grid;
      const pos = lap.carPosition;
      emit('start', 'lights_out', 'Lights out and away we go.');
      if (pos < grid) {
        emit('start', 'good_start', `Good launch. P${pos} from P${grid}. Hold it together into turn one.`);
      } else if (pos > grid) {
        emit('start', 'poor_start', `Tough start. P${pos} from P${grid}. Stay calm, race comes to us.`);
      }
      mem.startSpoken = true;
    }
    // Cold tyres on lap 1
    if (tel && lap.currentLapNum <= 1) {
      const surfaces = tel.tyreSurfaceTemp;
      if (Array.isArray(surfaces) && surfaces.length === 4) {
        const avg = (surfaces[0] + surfaces[1] + surfaces[2] + surfaces[3]) / 4;
        if (avg < 70) emit('tyres', 'cold_tyres', `Tyres are cold. Average ${Math.round(avg)} degrees. Work them up carefully.`);
      }
    }
  }

  // ── flags ──
  // FiaFlag enum: 0=None, 1=Green, 2=Blue, 3=Yellow. Red flags come from
  // session.numRedFlagPeriods / Event packets, not this field.
  const fiaFlag: number = Number(sts?.vehicleFiaFlags ?? 0);
  if (fiaFlag !== mem.fiaFlag) {
    mem.fiaFlag = fiaFlag;
    if (fiaFlag === 1) emit('flags', 'green_flag', 'Green flag. Track is clear.');
    else if (fiaFlag === 2) emit('flags', 'blue_flag', 'Blue flags. Faster car coming through — let them by.');
    else if (fiaFlag === 3) emit('flags', 'yellow_flag', 'Yellow flag sector. No overtaking.');
  }
  // Red flag detection — session-level counter increments
  const redFlagPeriods: number = Number((ses as any).numRedFlagPeriods ?? 0);
  if (redFlagPeriods > (mem.reportedDamage.redFlags ?? 0)) {
    emit('flags', 'red_flag', 'Red flag. Slow down and prepare to box.');
    mem.reportedDamage.redFlags = redFlagPeriods;
  }
  const sc = ses.safetyCarStatus ?? 0;
  if (sc !== mem.scStatus) {
    const prev = mem.scStatus; mem.scStatus = sc;
    if (sc === 1 && prev !== 1) emit('flags', 'safety_car', 'Safety car deployed. Stay within delta.');
    if (sc === 2 && prev !== 2) emit('flags', 'virtual_sc', 'Virtual safety car. Respect the delta.');
    if (sc === 1 && prev === 1) { /* still active */ }
    // Free-stop opportunity under SC
    if ((sc === 1 || sc === 2) && isRaceSession(ses) && (lap?.currentLapNum ?? 0) >= 2) {
      emit('pit', 'sc_pit_opportunity', 'Safety car window — pit cost is cheap. Decide quickly.');
    }
  }

  // ── DRS ──
  if (sts) {
    const allowed = sts.drsAllowed;
    if (allowed !== mem.drsAllowed) {
      const prev = mem.drsAllowed; mem.drsAllowed = allowed;
      if (allowed === 1 && prev !== 1) emit('drs', 'drs_enabled', 'DRS enabled.');
      if (allowed === 0 && prev === 1) emit('drs', 'drs_disabled', 'DRS disabled.');
    }
    if (allowed === 1 && lap && lap.deltaToCarAheadMs > 0 && lap.deltaToCarAheadMs < 1000) {
      emit('racecraft', 'drs_available', `DRS available — you're within a second of the car ahead.`);
    }
  }

  // ── tyres: wear thresholds ──
  if (dmg && Array.isArray(dmg.tyresWear)) {
    const maxWear = Math.max(...dmg.tyresWear);
    const tyreLabel = ['RL', 'RR', 'FL', 'FR'][dmg.tyresWear.indexOf(maxWear)] ?? 'tyre';
    if (maxWear >= 90 && mem.maxWearReported < 90) {
      emit('tyres', 'critical_wear', `Critical tyre wear. ${tyreLabel} at ${Math.round(maxWear)} percent. Manage hard.`);
      mem.maxWearReported = 90;
    } else if (maxWear >= 70 && mem.maxWearReported < 70) {
      emit('tyres', 'high_wear', `High tyre wear. ${tyreLabel} at ${Math.round(maxWear)} percent.`);
      mem.maxWearReported = 70;
    }
    // Reset on fresh tyres
    if (maxWear < 8 && mem.maxWearReported > 0) mem.maxWearReported = 0;

    // Blistering / graining proxies — F1 25 reports tyre blisters; graining inferred from wear gradient.
    if (Array.isArray(dmg.tyreBlisters)) {
      const maxBlister = Math.max(...dmg.tyreBlisters);
      if (maxBlister >= 30) emit('tyres', 'blistering', `Blistering detected. Take temperature out of the tyres.`);
    }
  }

  // ── tyres: temp ──
  if (tel && Array.isArray(tel.tyreSurfaceTemp) && (lap?.currentLapNum ?? 0) > 1) {
    const surfaces = tel.tyreSurfaceTemp;
    const maxTemp = Math.max(...surfaces);
    if (maxTemp > 125) emit('tyres', 'overheating', `Tyres overheating. ${Math.round(maxTemp)} degrees surface. Back off briefly.`);
    if (maxTemp >= 80 && maxTemp <= 105) emit('tyres', 'optimal_temp', 'Tyres in the working window. Push when you can.');
    // Graining proxy — surface much hotter than inner (heuristic)
    if (Array.isArray(tel.tyreInnerTemp)) {
      for (let i = 0; i < 4; i++) {
        const delta = surfaces[i] - tel.tyreInnerTemp[i];
        if (delta > 25) {
          emit('tyres', 'graining', 'Front tyre graining suspected from temperature delta. Manage slip.');
          break;
        }
      }
    }
  }

  // ── incident / damage ──
  if (dmg) {
    const checks: Array<{ key: string; cur: number; threshold: number; cat: string; sit: string; line: string }> = [
      { key: 'fl_wing', cur: dmg.frontLeftWingDamage ?? 0, threshold: 20, cat: 'incident', sit: 'wing_damage', line: 'Front-left wing damage. Assess before the next stop.' },
      { key: 'fr_wing', cur: dmg.frontRightWingDamage ?? 0, threshold: 20, cat: 'incident', sit: 'wing_damage', line: 'Front-right wing damage. Assess before the next stop.' },
      { key: 'rw',      cur: dmg.rearWingDamage ?? 0,      threshold: 20, cat: 'incident', sit: 'wing_damage', line: 'Rear wing damage. Watch DRS reliability.' },
      { key: 'floor',   cur: dmg.floorDamage ?? 0,         threshold: 20, cat: 'incident', sit: 'floor_damage', line: 'Floor damage. You will lose downforce, adjust expectations.' },
      { key: 'gb',      cur: dmg.gearBoxDamage ?? 0,       threshold: 30, cat: 'incident', sit: 'gearbox_issue', line: 'Gearbox compromised. Short-shift to protect it.' },
      { key: 'engine',  cur: dmg.engineDamage ?? 0,        threshold: 25, cat: 'incident', sit: 'engine_damage', line: 'Engine damage. Modes down, save the unit.' },
    ];
    for (const c of checks) {
      const prev = mem.reportedDamage[c.key] ?? 0;
      if (c.cur >= c.threshold && c.cur > prev + 5) {
        emit(c.cat, c.sit, c.line);
        mem.reportedDamage[c.key] = c.cur;
      }
    }
    if ((dmg.ersFault ?? 0) > 0 && !mem.reportedDamage.ers) {
      emit('incident', 'ers_fault', 'ERS fault detected. Run without deployment for now.');
      mem.reportedDamage.ers = 1;
    }
    // Puncture proxy — single tyre at very high wear or damage spike
    if (Array.isArray(dmg.tyresDamage)) {
      const maxTD = Math.max(...dmg.tyresDamage);
      if (maxTD >= 70) emit('incident', 'puncture', 'Possible puncture. Box this lap.');
    }
  }

  // ── normal: position changes ──
  if (lap) {
    const pos = lap.carPosition ?? 0;
    if (mem.prevPos > 0 && pos !== mem.prevPos && Math.abs(pos - mem.prevPos) <= 3) {
      if (pos < mem.prevPos) emit('normal', 'position_gained', `Up to P${pos}.`);
      else emit('normal', 'position_lost', `Lost a place. P${pos} now.`);
    }
    mem.prevPos = pos;
  }

  // ── fuel ──
  // fuelRemainingLaps is the MFD fuel DELTA: laps of fuel in hand (+) or short
  // of the flag (−). The shortfall is therefore just its negation — NOT
  // lapsToFlag − value (that treated the delta as absolute laps and fired a
  // spurious "fuel critical" early in every race).
  if (sts && lap && isRaceSession(ses)) {
    const lapsToFlag = Math.max(0, (ses.totalLaps ?? 0) - lap.currentLapNum);
    const shortBy = -sts.fuelRemainingLaps; // laps short of the finish (>0 = short)
    if (shortBy >= 0.7 && !mem.fuelCriticalWarned) {
      emit('normal', 'fuel_critical', `Fuel critical. About ${shortBy.toFixed(1)} laps short with ${lapsToFlag} to the flag — save now.`);
      mem.fuelCriticalWarned = true;
    } else if (shortBy >= 0.25 && shortBy < 0.7 && !mem.fuelWarned) {
      emit('normal', 'fuel_warning', `Fuel tight — about ${shortBy.toFixed(1)} laps short with ${lapsToFlag} to go. Start saving.`);
      mem.fuelWarned = true;
    } else if (shortBy < 0.1) {
      mem.fuelWarned = false;
      mem.fuelCriticalWarned = false;
    }
  }

  // ── ERS ──
  if (sts) {
    const pct = (sts.ersStoreEnergy / 4_000_000) * 100;
    if (pct < 10 && mem.ersState !== 'low') {
      emit('ers', 'low_battery', `Battery low, ${Math.round(pct)} percent. Lift and harvest.`);
      mem.ersState = 'low';
    } else if (pct > 95 && mem.ersState !== 'full') {
      emit('ers', 'full_battery', 'Battery full. Deploy freely.');
      mem.ersState = 'full';
    } else if (pct >= 20 && pct <= 90) {
      mem.ersState = 'normal';
    }
    if (sts.ersDeployMode === 0) emit('ers', 'harvest_mode', 'In harvest mode.');
    if (sts.ersDeployMode >= 2 && lap && lap.deltaToCarAheadMs > 0 && lap.deltaToCarAheadMs < 1500) {
      emit('ers', 'deploy_opportunity', 'Deploy now — within DRS range up ahead.');
    }
  }

  // ── racecraft: close cars ──
  if (lap && Array.isArray(ctx.lapData)) {
    const myPos = lap.carPosition;
    const ahead = ctx.lapData.find((l: any) => l?.carPosition === myPos - 1);
    const behind = ctx.lapData.find((l: any) => l?.carPosition === myPos + 1);
    const aheadGapMs = lap.deltaToCarAheadMs ?? 0;
    if (ahead && aheadGapMs > 0 && aheadGapMs < 800) {
      emit('racecraft', 'car_ahead_close', `Within ${(aheadGapMs / 1000).toFixed(1)} seconds of car ahead.`);
      if (aheadGapMs < 600) emit('racecraft', 'overtake_opportunity', 'Overtake on. Set it up early.');
      if (aheadGapMs < 1000 && (tel?.speed ?? 0) > 180) emit('racecraft', 'slipstream', 'Tow available — punch out of the corner.');
    }
    const behindGapMs = behind?.deltaToCarAheadMs ?? 0;
    if (behind && behindGapMs > 0 && behindGapMs < 700) {
      emit('racecraft', 'car_behind_close', `Car behind closing — ${(behindGapMs / 1000).toFixed(1)} seconds.`);
      if (behindGapMs < 500) emit('racecraft', 'defend_position', 'Defend hard into the next braking zone.');
    }
  }

  // ── pace / fastest lap ──
  if (lap && lap.lastLapTimeMs > 0 && lap.lastLapTimeMs !== mem.lastLapTimeMs) {
    const prev = mem.lastLapTimeMs;
    mem.lastLapTimeMs = lap.lastLapTimeMs;
    const best = mem.bestLapTimeMs;
    if (best === 0 || lap.lastLapTimeMs < best) {
      mem.bestLapTimeMs = lap.lastLapTimeMs;
      emit('pace', 'personal_best', `Personal best — ${fmtLap(lap.lastLapTimeMs)}.`);
    }
    if (prev > 0) {
      const delta = lap.lastLapTimeMs - prev;
      if (delta > 700) emit('pace', 'pace_drop', `Pace dropped by ${(delta / 1000).toFixed(1)} seconds. Check the tyres.`);
      if (Math.abs(delta) < 200 && lap.currentLapNum > mem.paceConsistencyLap + 3) {
        emit('pace', 'consistent_pace', 'Consistent pace. Keep it rolling.');
        mem.paceConsistencyLap = lap.currentLapNum;
      }
    }
  }

  // ── session timing ──
  if (lap && ses.totalLaps > 0 && isRaceSession(ses)) {
    const cur = lap.currentLapNum;
    const half = Math.floor(ses.totalLaps / 2);
    if (!mem.halfwaySpoken && cur >= half && cur > 0) {
      emit('session', 'halfway_point', `Halfway. P${lap.carPosition}.`);
      mem.halfwaySpoken = true;
    }
    const remaining = ses.totalLaps - cur;
    if (!mem.finalLapsSpoken && remaining > 0 && remaining <= 3) {
      emit('session', 'final_laps', `${remaining} laps to go. Bring it home.`);
      emit('finish', 'last_lap', remaining === 1 ? 'Last lap. Push.' : `${remaining} more — every corner counts.`);
      mem.finalLapsSpoken = true;
    }
    if (!mem.raceCompleteSpoken && (lap.resultStatus ?? 0) >= 3) {
      emit('finish', 'race_complete', `Race complete. P${lap.carPosition}.`);
      emit('finish', 'finish_position', `Final classification: P${lap.carPosition}.`);
      mem.raceCompleteSpoken = true;
    }
  }

  // ── weather ──
  const w = ses.weather;
  if (mem.weather !== null && w !== mem.weather) {
    const wasWet = mem.weather >= 3;
    const isWet  = w >= 3;
    if (isWet && !wasWet) emit('weather', 'rain_started', 'Rain on track. Inters likely if it gets heavier.');
    else if (!isWet && wasWet) emit('weather', 'drying_track', 'Track is drying. Slicks crossover soon.');
    else emit('weather', 'temperature_change', 'Weather shifting.');
  }
  mem.weather = w;
  const fcst = (ses as any).weatherForecast?.[0];
  const rainPct = fcst?.rainPercentage ?? 0;
  if (rainPct - mem.rainPctForecast >= 25) {
    emit('weather', 'rain_incoming', `Rain incoming, forecast ${rainPct} percent within five minutes.`);
  }
  mem.rainPctForecast = rainPct;

  // ── penalties ──
  if (lap) {
    const warns = (lap.cornerCuttingWarnings ?? 0) + (lap.totalWarnings ?? 0);
    if (warns > 0 && warns !== mem.reportedDamage.warns) {
      emit('penalties', 'track_limits_warning', `Track limits — warning ${warns}. Tidy it up.`);
      mem.reportedDamage.warns = warns;
    }
    if ((lap.penalties ?? 0) > (mem.reportedDamage.pen ?? 0)) {
      emit('penalties', 'penalty_received', 'Penalty applied — check the next box of the screen.');
      mem.reportedDamage.pen = lap.penalties;
    }
    if ((lap.numUnservedDriveThroughPens ?? 0) === 0 && (lap.numUnservedStopGoPens ?? 0) === 0
        && (mem.reportedDamage.pen ?? 0) > 0 && lap.pitStatus === 0) {
      // best-effort: served
    }
  }

  // ── pit window ──
  if (sts && lap && isRaceSession(ses) && ses.totalLaps > 0) {
    if (sts.pitLimiterStatus) emit('pit', 'box_now', 'Pit limiter on — box this lap.');
    const tyreAge = sts.tyresAgeLaps ?? 0;
    const totalLaps = ses.totalLaps;
    const stintTarget = Math.floor(totalLaps / 2);
    if (tyreAge >= stintTarget && lap.numPitStops === 0) {
      emit('pit', 'pit_window_open', 'Pit window open. Box when traffic clears.');
    }
  }

  mem.lap = lap?.currentLapNum ?? mem.lap;
}
