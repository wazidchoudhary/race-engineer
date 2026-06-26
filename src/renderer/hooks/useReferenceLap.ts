/**
 * Reference-lap predictive delta — the headline esports analysis tool that
 * F1Laps / Coach Dave / trophi all centre on.
 *
 * Records the player's cumulative lap time at each distance bin. When a lap
 * beats the current best (and was clean), that lap's time-at-distance profile
 * becomes the reference. The live delta is then `currentLapTime − referenceTime`
 * at the car's current lap distance: negative = ahead of your best, positive =
 * behind. This is the in-game "delta to fastest lap" but driven from telemetry,
 * so it works in any session.
 */
import { useEffect, useRef, useState } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';

const BINS = 200; // ~25 m on a 5 km lap

export interface ReferenceLapData {
  hasReference: boolean;
  bestLapMs: number | null;
  /** Current lap vs reference at this distance (seconds). <0 = ahead. */
  deltaSec: number | null;
  lapInvalid: boolean;
}

function emptyRef(): Float32Array {
  return new Float32Array(BINS).fill(NaN);
}

export function useReferenceLap(): ReferenceLapData {
  const { session, lapData, playerCarIndex } = useTelemetryContext();

  const refTime = useRef<Float32Array>(emptyRef()); // best lap: cumulative time per bin
  const curTime = useRef<Float32Array>(emptyRef()); // lap in progress
  const bestMs = useRef<number | null>(null);
  const lastLapNum = useRef<number>(-1);
  const invalidThisLap = useRef<boolean>(false);
  const sigRef = useRef<string>('');
  const [data, setData] = useState<ReferenceLapData>({
    hasReference: false, bestLapMs: null, deltaSec: null, lapInvalid: false,
  });

  const lap = lapData?.[playerCarIndex];
  const trackId = session?.trackId ?? -1;
  const trackLengthM = session?.trackLength || 0;
  const lapNum = lap?.currentLapNum ?? -1;
  const lapDistanceM = lap?.lapDistance ?? -1;
  const curLapMs = lap?.currentLapTimeMs ?? 0;
  const lastLapMs = lap?.lastLapTimeMs ?? 0;
  const invalid = (lap?.currentLapInvalid ?? 0) !== 0;

  useEffect(() => {
    if (!session || trackLengthM <= 0 || !lap) return;

    // Reset everything when the track changes.
    const sig = String(trackId);
    if (sig !== sigRef.current) {
      refTime.current = emptyRef();
      curTime.current = emptyRef();
      bestMs.current = null;
      invalidThisLap.current = false;
      lastLapNum.current = lapNum;
      sigRef.current = sig;
    }

    // Lap rollover: promote the finished lap to reference if it's a clean new best.
    if (lapNum !== lastLapNum.current) {
      const wasInvalid = invalidThisLap.current;
      const isNewBest = lastLapMs > 0 && (bestMs.current == null || lastLapMs < bestMs.current);
      if (isNewBest && !wasInvalid) {
        let filled = 0;
        for (let i = 0; i < BINS; i++) if (!Number.isNaN(curTime.current[i])) filled++;
        if (filled > BINS * 0.6) { // ignore partial in/out laps
          refTime.current = curTime.current.slice();
          bestMs.current = lastLapMs;
        }
      }
      curTime.current = emptyRef();
      invalidThisLap.current = false;
      lastLapNum.current = lapNum;
    }

    if (invalid) invalidThisLap.current = true;

    // Sample the current lap + compute live delta.
    let deltaSec: number | null = null;
    if (lapDistanceM >= 0 && curLapMs > 0) {
      const bin = Math.min(BINS - 1, Math.max(0, Math.floor((lapDistanceM / trackLengthM) * BINS)));
      curTime.current[bin] = curLapMs;
      if (bestMs.current != null) {
        const refT = refTime.current[bin];
        if (!Number.isNaN(refT)) deltaSec = (curLapMs - refT) / 1000;
      }
    }

    setData({
      hasReference: bestMs.current != null,
      bestLapMs: bestMs.current,
      deltaSec,
      lapInvalid: invalid,
    });
  }, [trackId, lapNum, lapDistanceM, curLapMs, lastLapMs, trackLengthM, invalid, session, lap]);

  return data;
}
