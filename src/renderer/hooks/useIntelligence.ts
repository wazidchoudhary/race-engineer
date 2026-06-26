/**
 * React hook that runs the intelligence modules against live telemetry.
 */

import { useMemo, useRef, useCallback } from 'react';
import { WearPredictor } from '../../shared/intelligence/wear-predictor';
import { PaceAnalyzer } from '../../shared/intelligence/pace-analyzer';
import { ErsManager } from '../../shared/intelligence/ers-manager';
import { StrategyEngine } from '../../shared/intelligence/strategy-engine';
import type { TelemetryState, WearPrediction, PaceAnalysis, ErsAnalysis, PitStrategy } from '../../shared/types/store';
import type { TyreArray } from '../../shared/types/packets';

export interface IntelligenceData {
  wearPrediction: WearPrediction | null;
  paceAnalysis: PaceAnalysis | null;
  ersAnalysis: ErsAnalysis | null;
  pitStrategy: PitStrategy | null;
}

export function useIntelligence(state: TelemetryState): IntelligenceData {
  const wearPredictor = useMemo(() => new WearPredictor(), []);
  const paceAnalyzer = useMemo(() => new PaceAnalyzer(), []);
  const ersManager = useMemo(() => new ErsManager(), []);
  const strategyEngine = useMemo(() => new StrategyEngine(), []);

  const lastLapRef = useRef<number>(0);
  const lastTrackIdRef = useRef<number | null>(null);

  // Process on each render (cheap operations)
  let wearPrediction: WearPrediction | null = null;
  let paceAnalysis: PaceAnalysis | null = null;
  let ersAnalysis: ErsAnalysis | null = null;
  let pitStrategy: PitStrategy | null = null;

  const playerLap = state.lapData[state.playerCarIndex];
  const playerStatus = state.status;
  const playerDamage = state.damage;

  // Feed wear data on lap change
  if (playerLap && playerDamage && playerStatus && state.telemetry) {
    const currentLap = playerLap.currentLapNum;

    if (currentLap > lastLapRef.current && currentLap > 1) {
      // New lap completed — add wear sample
      wearPredictor.addSample({
        lap: currentLap - 1,
        timestamp: Date.now(),
        wear: playerDamage.tyresWear,
        surfaceTemp: state.telemetry.tyreSurfaceTemp,
        innerTemp: state.telemetry.tyreInnerTemp,
        pressure: state.telemetry.tyrePressure,
        compound: playerStatus.actualTyreCompound,
        fuelLoad: playerStatus.fuelInTank,
      });

      // Track stint
      const avgWear = playerDamage.tyresWear.reduce((a, b) => a + b, 0) / 4;
      strategyEngine.onLapComplete(
        currentLap - 1,
        playerLap.lastLapTimeMs,
        playerStatus.actualTyreCompound,
        avgWear,
      );

      lastLapRef.current = currentLap;
    }

    wearPrediction = wearPredictor.predict(currentLap);
  }

  // Pace analysis — purple sectors and personal best are per-session, so reset
  // when the track changes (the analyzer instance lives for the whole app run).
  if (state.session && state.session.trackId !== lastTrackIdRef.current) {
    paceAnalyzer.reset();
    strategyEngine.reset(); // stints/pace must not leak across sessions/tracks
    lastLapRef.current = 0;
    lastTrackIdRef.current = state.session.trackId;
  }
  if (state.lapData.length > 0) {
    paceAnalyzer.processLapData(state.lapData, state.playerCarIndex);
    if (state.session) {
      paceAnalysis = paceAnalyzer.analyze(state.playerCarIndex, state.session.trackId);
    }
  }

  // ERS analysis
  if (playerStatus && playerLap && state.lapData.length > 0 && state.allCarStatus.length > 0) {
    ersAnalysis = ersManager.analyze(
      playerStatus,
      playerLap,
      state.lapData,
      state.allCarStatus,
      state.playerCarIndex,
    );
  }

  // Pit strategy
  if (playerLap && state.session && state.lapData.length > 0) {
    pitStrategy = strategyEngine.calculatePitRejoin(
      playerLap,
      state.lapData,
      state.playerCarIndex,
      state.session,
      wearPrediction,
    );
  }

  return { wearPrediction, paceAnalysis, ersAnalysis, pitStrategy };
}
