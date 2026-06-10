/**
 * useStrategyCalls
 *
 * Watches telemetry for strategy-worthy triggers, forwards them to the
 * strategy pipeline (debounced/prioritized), and surfaces the most recent
 * decision to the UI. Only premium users actually hit the Haiku API; free
 * users get a noop (rules engine still runs in useAutoRadio).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createStrategyPipeline, type StrategyResult, type StrategyTrigger, type TelemetrySources,
} from '../lib/strategy-pipeline';
import { globalInteractionTracker } from '../lib/emergency-gate';
import { api, type StrategyDecision } from '../lib/tauri-api';

interface Opts {
  src: TelemetrySources;
  premium: boolean;
  onDecision?: (d: StrategyDecision, trigger: StrategyTrigger) => void;
}

interface State {
  last: StrategyResult | null;
  pending: boolean;
  pendingTrigger: StrategyTrigger | null;
}

export function useStrategyCalls({ src, premium, onDecision }: Opts) {
  const pipeline = useMemo(() => createStrategyPipeline(), []);
  const [state, setState] = useState<State>({ last: null, pending: false, pendingTrigger: null });

  // Mutable snapshot of the latest src — avoids stale closures in triggers.
  const srcRef = useRef(src);
  srcRef.current = src;

  // Previous-state memory for trigger detection
  const prev = useRef({
    lap: 0,
    sc: 0,
    weather: 0,
    rainPct: 0,
    maxWear: 0,
    totalDamage: 0,
    pittedCars: new Set<number>(),
    sessionSig: '',
  });

  const dispatch = useCallback((trigger: StrategyTrigger, question?: string) => {
    if (!premium) return false;
    setState((s) => ({ ...s, pending: true, pendingTrigger: trigger }));
    return pipeline.request(
      trigger,
      srcRef.current,
      (r) => {
        setState({ last: r, pending: false, pendingTrigger: null });
        if (r.decision) onDecision?.(r.decision, trigger);
      },
      question,
    );
  }, [premium, pipeline, onDecision]);

  // ── Trigger detection ──
  useEffect(() => {
    const s = src;
    const p = prev.current;
    if (!s.session || !s.lapData) return;
    const pLap = s.lapData[s.playerCarIndex];
    if (!pLap) return;

    // Session change → reset trigger memory
    const sig = `${s.session.trackId}|${s.session.sessionType}`;
    if (sig !== p.sessionSig) {
      p.sessionSig = sig;
      p.lap = 0; p.sc = 0; p.weather = 0; p.rainPct = 0;
      p.maxWear = 0; p.totalDamage = 0; p.pittedCars.clear();
      if (pLap.currentLapNum > 0) dispatch('session_change');
      return;
    }

    // Lap complete
    const lap = pLap.currentLapNum ?? 0;
    if (lap > p.lap && p.lap > 0) {
      p.lap = lap;
      dispatch('lap_complete');
    } else if (lap > 0 && p.lap === 0) {
      p.lap = lap;
    }

    // Safety car changes
    const sc = s.session.safetyCarStatus ?? 0;
    if (sc !== p.sc) {
      const prevSc = p.sc; p.sc = sc;
      if (sc === 1 && prevSc !== 1) dispatch('sc_deployed');
      else if (sc === 2 && prevSc !== 2) dispatch('vsc_deployed');
    }

    // Weather transitions
    const weather = s.session.weather ?? 0;
    if (weather !== p.weather) {
      const prevWeather = p.weather; p.weather = weather;
      // 0-2 = dry, 3+ = rain
      if (prevWeather < 3 && weather >= 3) dispatch('rain_onset');
      else if (prevWeather < weather && weather >= 4) dispatch('rain_heavier');
    }
    const fcst = s.session.weatherForecast?.[0];
    const rainPct = fcst?.rainPercentage ?? 0;
    if (rainPct - p.rainPct >= 25) {
      p.rainPct = rainPct;
      dispatch('rain_heavier');
    } else {
      p.rainPct = rainPct;
    }

    // Tyre cliff
    const wear = s.damage?.tyresWear;
    if (Array.isArray(wear)) {
      const maxWear = Math.max(...wear);
      if (maxWear >= 65 && p.maxWear < 65) dispatch('tyre_cliff');
      p.maxWear = maxWear;
    }

    // Damage escalation
    const dmg = s.damage;
    if (dmg) {
      const total =
        Math.max(dmg.frontLeftWingDamage ?? 0, dmg.frontRightWingDamage ?? 0) +
        (dmg.rearWingDamage ?? 0) + (dmg.floorDamage ?? 0) +
        (dmg.engineDamage ?? 0) + (dmg.gearBoxDamage ?? 0);
      if (total - p.totalDamage >= 15) dispatch('damage_escalated');
      p.totalDamage = total;
    }

    // Rival pitted detection — track pitStatus transitions on any rival
    if (Array.isArray(s.lapData)) {
      for (let i = 0; i < s.lapData.length; i++) {
        if (i === s.playerCarIndex) continue;
        const l = s.lapData[i];
        if (!l) continue;
        const pitting = (l.pitStatus ?? 0) > 0;
        if (pitting && !p.pittedCars.has(i)) {
          p.pittedCars.add(i);
          // Only meaningful if they're near us in position
          const gap = Math.abs((l.carPosition ?? 99) - (pLap.carPosition ?? 0));
          if (gap <= 3) dispatch('rival_pitted');
        } else if (!pitting && p.pittedCars.has(i)) {
          p.pittedCars.delete(i);
        }
      }
    }
  }, [src, dispatch]);

  const ask = useCallback((question: string) => {
    globalInteractionTracker.mark();
    const ok = dispatch('user_ask', question);
    if (!premium) {
      // No API call possible — surface a soft error so the UI can show it.
      setState({
        last: { error: 'premium_required', trigger: 'user_ask', tookMs: 0 },
        pending: false, pendingTrigger: null,
      });
    }
    return ok;
  }, [dispatch, premium]);

  const resetUsage = useCallback(() => api.resetUsage?.(), []);

  return {
    lastResult: state.last,
    lastDecision: state.last?.decision ?? null,
    pending: state.pending,
    pendingTrigger: state.pendingTrigger,
    ask,
    resetUsage,
  };
}
