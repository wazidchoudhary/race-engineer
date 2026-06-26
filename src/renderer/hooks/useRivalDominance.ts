/**
 * Rival "track dominance" sampler.
 *
 * The F1 UDP feed only gives 3 macro sector times per lap — there is no
 * corner-by-corner timing. To colour the circuit by who is faster where
 * (the F1-TV driver-dominance graphic) we sample it ourselves: bin the lap
 * into N mini-sectors by lap distance and, per driver, keep the best speed
 * seen in each bin across the session. The faster driver "wins" the bin.
 *
 * Speed-per-bin is the simple, stable v1 metric (broadcast-proven). A future
 * upgrade is time-in-bin (integrate dt across the bin) for full accuracy.
 *
 * Cars are positioned on the map by projecting their live `lapDistance` onto
 * the bundled TT racing line ([[tt-tracks]]), so no F1→TT world-coordinate
 * transform is needed.
 */
import { useEffect, useRef, useState } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { teamColor } from '../lib/team-colors';
import { hasTtTrack, loadTtTrack, type TtTrack } from '../lib/tt-tracks';

export const DOMINANCE_BINS = 24;
/** Speeds within this band (km/h) are a tie — keeps the colouring from flickering. */
const TIE_KMH = 1.5;

export interface DominanceData {
  available: boolean;
  track: TtTrack | null;
  n: number;
  /** Per bin: 0 = player faster, 1 = rival faster, -1 = tie / not enough data. */
  winners: Int8Array;
  playerColor: string;
  rivalColor: string;
  /** Live lap distance (metres, <0 when unknown) for the moving dots. */
  playerDistM: number;
  rivalDistM: number;
  trackLengthM: number;
  /** 0..1 — fraction of bins where both drivers have a sample yet. */
  coverage: number;
}

function emptyData(): DominanceData {
  return {
    available: false,
    track: null,
    n: DOMINANCE_BINS,
    winners: new Int8Array(DOMINANCE_BINS).fill(-1),
    playerColor: '#39b54a',
    rivalColor: '#ff8700',
    playerDistM: -1,
    rivalDistM: -1,
    trackLengthM: 0,
    coverage: 0,
  };
}

export function useRivalDominance(playerIdx: number, rivalIdx: number | null): DominanceData {
  const { session, lapData, allCarTelemetry, participants } = useTelemetryContext();

  const playerBest = useRef<Float32Array>(new Float32Array(DOMINANCE_BINS));
  const rivalBest = useRef<Float32Array>(new Float32Array(DOMINANCE_BINS));
  const sigRef = useRef<string>('');
  const [data, setData] = useState<DominanceData>(emptyData);

  const trackId = session?.trackId ?? -1;
  const trackLengthM = session?.trackLength || 0;
  const playerSpeed = allCarTelemetry?.[playerIdx]?.speed ?? 0;
  const rivalSpeed = rivalIdx != null ? (allCarTelemetry?.[rivalIdx]?.speed ?? 0) : 0;
  const playerDistM = lapData?.[playerIdx]?.lapDistance ?? -1;
  const rivalDistM = rivalIdx != null ? (lapData?.[rivalIdx]?.lapDistance ?? -1) : -1;

  useEffect(() => {
    // No rival selected, or no usable session geometry — clear and bail.
    if (rivalIdx == null || !session || trackLengthM <= 0) {
      if (sigRef.current !== '') { sigRef.current = ''; setData(emptyData()); }
      return;
    }

    // Reset accumulators when the track or chosen rival changes.
    const sig = `${trackId}|${rivalIdx}`;
    if (sig !== sigRef.current) {
      playerBest.current = new Float32Array(DOMINANCE_BINS);
      rivalBest.current = new Float32Array(DOMINANCE_BINS);
      sigRef.current = sig;
    }

    const binOf = (distM: number): number => {
      if (distM < 0) return -1;
      const b = Math.floor((distM / trackLengthM) * DOMINANCE_BINS);
      return b < 0 ? 0 : b >= DOMINANCE_BINS ? DOMINANCE_BINS - 1 : b;
    };

    // Keep the best (max) speed seen per bin — robust to slow in/out laps.
    if (playerSpeed > 0) {
      const b = binOf(playerDistM);
      if (b >= 0 && playerSpeed > playerBest.current[b]) playerBest.current[b] = playerSpeed;
    }
    if (rivalSpeed > 0) {
      const b = binOf(rivalDistM);
      if (b >= 0 && rivalSpeed > rivalBest.current[b]) rivalBest.current[b] = rivalSpeed;
    }

    const winners = new Int8Array(DOMINANCE_BINS).fill(-1);
    let covered = 0;
    for (let i = 0; i < DOMINANCE_BINS; i++) {
      const p = playerBest.current[i];
      const r = rivalBest.current[i];
      if (p > 0 && r > 0) {
        covered++;
        winners[i] = Math.abs(p - r) <= TIE_KMH ? -1 : p > r ? 0 : 1;
      }
    }

    const track = hasTtTrack(trackId) ? loadTtTrack(trackId) : null;
    const playerColor = teamColor(participants?.participants?.[playerIdx]?.teamId, '#39b54a');
    const rivalColor = teamColor(participants?.participants?.[rivalIdx]?.teamId, '#ff8700');

    setData({
      available: !!track,
      track,
      n: DOMINANCE_BINS,
      winners,
      playerColor,
      rivalColor,
      playerDistM,
      rivalDistM,
      trackLengthM,
      coverage: covered / DOMINANCE_BINS,
    });
  }, [trackId, rivalIdx, playerIdx, playerDistM, rivalDistM, playerSpeed, rivalSpeed, trackLengthM, session, participants]);

  return data;
}
