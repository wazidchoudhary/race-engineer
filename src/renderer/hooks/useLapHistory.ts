import { useState, useEffect, useRef } from 'react';
import type { TelemetryState } from '../../shared/types/store';

export interface CompletedLap {
  lapNumber: number;
  lapTimeMs: number;
  sector1TimeMs: number;
  sector2TimeMs: number;
  sector3TimeMs: number;
  tyreCompound: number | null;
  tyreAgeLaps: number;
  pitLap: boolean;
  invalid: boolean;
  completedAt: number; // timestamp
  fuelAtEndKg: number | null;
  fuelUsedKg: number | null;
  tyreWearEndPct: number[] | null;
}

export function useLapHistory(telemetry: TelemetryState) {
  const [completedLaps, setCompletedLaps] = useState<CompletedLap[]>([]);
  const prevLapNumRef = useRef<number | null>(null);
  const prevFuelRef = useRef<number | null>(null);
  // S1/S2 of the lap in progress, captured each tick while both are populated.
  // At the rollover tick the live sectors have already reset to 0, so the
  // completed lap's sectors (and the derived S3) come from this snapshot.
  const prevSectorsRef = useRef<{ s1: number; s2: number } | null>(null);

  useEffect(() => {
    const playerLap = telemetry.lapData[telemetry.playerCarIndex];
    const status = telemetry.status;
    const damage = telemetry.damage;

    if (!playerLap) return;

    const currentLapNum = playerLap.currentLapNum;
    const sectorsValid = playerLap.sector1TimeMs > 0 && playerLap.sector2TimeMs > 0;

    if (prevLapNumRef.current === null) {
      prevLapNumRef.current = currentLapNum;
      prevFuelRef.current = status?.fuelInTank ?? null;
      if (sectorsValid) {
        prevSectorsRef.current = { s1: playerLap.sector1TimeMs, s2: playerLap.sector2TimeMs };
      }
      return;
    }

    // Lap completed when lap number increments
    if (currentLapNum > prevLapNumRef.current) {
      const completedLapNum = prevLapNumRef.current;
      // The live S1/S2 have already reset for the new lap, so take the sectors
      // captured on the previous tick and derive S3 = lap − S1 − S2 from them.
      const snap = prevSectorsRef.current;
      const s1 = snap?.s1 ?? 0;
      const s2 = snap?.s2 ?? 0;
      const sector3Ms =
        playerLap.lastLapTimeMs > 0 && s1 > 0 && s2 > 0
          ? playerLap.lastLapTimeMs - s1 - s2
          : 0;

      const fuelNow = status?.fuelInTank ?? null;
      const fuelUsed =
        prevFuelRef.current !== null && fuelNow !== null
          ? prevFuelRef.current - fuelNow
          : null;

      const lap: CompletedLap = {
        lapNumber: completedLapNum,
        lapTimeMs: playerLap.lastLapTimeMs,
        sector1TimeMs: s1,
        sector2TimeMs: s2,
        sector3TimeMs: sector3Ms > 0 ? sector3Ms : 0,
        tyreCompound: status?.visualTyreCompound ?? null,
        tyreAgeLaps: status?.tyresAgeLaps ?? 0,
        pitLap: playerLap.pitStatus > 0,
        invalid: playerLap.currentLapInvalid === 1,
        completedAt: Date.now(),
        fuelAtEndKg: fuelNow,
        fuelUsedKg: fuelUsed !== null && fuelUsed > 0 && fuelUsed < 10 ? fuelUsed : null,
        tyreWearEndPct: damage ? [...damage.tyresWear] : null,
      };

      setCompletedLaps((prev) => [...prev, lap]);
      // New lap has no sectors yet — start its snapshot fresh.
      prevSectorsRef.current = null;
    }

    // Keep the in-progress lap's sectors snapshotted for the next rollover.
    if (sectorsValid) {
      prevSectorsRef.current = { s1: playerLap.sector1TimeMs, s2: playerLap.sector2TimeMs };
    }

    prevLapNumRef.current = currentLapNum;
    prevFuelRef.current = status?.fuelInTank ?? null;
  }, [
    telemetry.lapData,
    telemetry.playerCarIndex,
    telemetry.status,
    telemetry.damage,
  ]);

  // Clear history when session changes (track changes)
  useEffect(() => {
    setCompletedLaps([]);
    prevLapNumRef.current = null;
    prevFuelRef.current = null;
    prevSectorsRef.current = null;
  }, [telemetry.session?.trackId]);

  const bestLapMs =
    completedLaps.length > 0
      ? Math.min(
          ...completedLaps
            .filter((l) => !l.invalid && !l.pitLap && l.lapTimeMs > 0)
            .map((l) => l.lapTimeMs)
        )
      : null;

  return { completedLaps, bestLapMs: isFinite(bestLapMs ?? Infinity) ? bestLapMs : null };
}
