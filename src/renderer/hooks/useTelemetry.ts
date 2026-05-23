import { useState, useEffect, useCallback } from 'react';
import type {
  SessionData,
  LapData,
  CarTelemetry,
  CarStatus,
  CarDamage,
  CarSetup,
  Participant,
  EventData,
  DriverHistoryUpdate,
  HistoryLap,
} from '../../shared/types/packets';
import type { TelemetryState } from '../../shared/types/store';
import {
  PRIMARY_SLOT,
  onTelemetryStartedFor,
  onTelemetryStoppedFor,
  onTelemetryErrorFor,
  onSessionUpdateFor,
  onLapUpdateFor,
  onTelemetryUpdateFor,
  onAllTelemetryUpdateFor,
  onStatusUpdateFor,
  onAllStatusUpdateFor,
  onDamageUpdateFor,
  onSetupUpdateFor,
  onAllSetupUpdateFor,
  onParticipantsUpdateFor,
  onBestLapsUpdateFor,
  onFastestLapUpdateFor,
  onEventUpdateFor,
  onDriverHistoryUpdateFor,
  onMotionUpdateFor,
  onTrackTraceCompleteFor,
  onPacketRxFor,
  api,
  type MotionUpdate,
} from '../lib/tauri-api';

export interface PacketRxStats {
  count: number;
  lastPacketId: number;
  lastSeenAt: number;
}

function createInitialState(): TelemetryState {
  return {
    connected: false,
    session: null,
    participants: null,
    lapData: [],
    telemetry: null,
    status: null,
    damage: null,
    setup: null,
    allCarTelemetry: [],
    allCarStatus: [],
    allCarSetup: [],
    allCarDamage: [],
    playerCarIndex: 0,
    bestLapTimes: {},
    fastestLapCar: null,
    fastestLapMs: null,
    events: [],
    driverHistories: {},
    rivalCarIndex: null,
    motion: [],
  };
}

export function useTelemetry(slot: string = PRIMARY_SLOT) {
  const [state, setState] = useState<TelemetryState>(createInitialState);
  const [packetRx, setPacketRx] = useState<PacketRxStats>(
    { count: 0, lastPacketId: 0, lastSeenAt: 0 }
  );

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let active = true;

    const register = async () => {
      const results = await Promise.allSettled([
        onTelemetryStartedFor(slot, () => setState((s) => ({ ...s, connected: true }))),
        onTelemetryStoppedFor(slot, () => setState((s) => ({ ...s, connected: false }))),
        onTelemetryErrorFor(slot, () => setState((s) => ({ ...s, connected: false }))),

        onSessionUpdateFor(slot, (data: SessionData) =>
          setState((s) => ({ ...s, session: data, playerCarIndex: data.playerCarIndex ?? s.playerCarIndex }))),

        onLapUpdateFor(slot, (data: { lapData: LapData[]; playerCarIndex: number }) =>
          setState((s) => ({ ...s, lapData: data.lapData ?? [], playerCarIndex: data.playerCarIndex ?? s.playerCarIndex }))),

        onTelemetryUpdateFor(slot, (data: CarTelemetry) =>
          setState((s) => ({ ...s, telemetry: data }))),

        onAllTelemetryUpdateFor(slot, (data: CarTelemetry[]) =>
          setState((s) => ({ ...s, allCarTelemetry: data ?? [] }))),

        onStatusUpdateFor(slot, (data: CarStatus) =>
          setState((s) => ({ ...s, status: data }))),

        onAllStatusUpdateFor(slot, (data: CarStatus[]) =>
          setState((s) => ({ ...s, allCarStatus: data ?? [] }))),

        onDamageUpdateFor(slot, (data: CarDamage) =>
          setState((s) => ({ ...s, damage: data }))),

        onSetupUpdateFor(slot, (data: CarSetup) =>
          setState((s) => ({ ...s, setup: data }))),

        onAllSetupUpdateFor(slot, (data: CarSetup[]) =>
          setState((s) => ({ ...s, allCarSetup: data ?? [] }))),

        onParticipantsUpdateFor(slot, (data: { numActiveCars: number; participants: Participant[] }) =>
          setState((s) => ({ ...s, participants: data }))),

        onBestLapsUpdateFor(slot, (data: Record<string, number>) => {
          const numKeyed: Record<number, number> = {};
          for (const [k, v] of Object.entries(data)) numKeyed[Number(k)] = v;
          setState((s) => ({ ...s, bestLapTimes: { ...s.bestLapTimes, ...numKeyed } }));
        }),

        onFastestLapUpdateFor(slot, (data: { vehicleIdx: number; lapTimeMs: number }) =>
          setState((s) => ({ ...s, fastestLapCar: data.vehicleIdx, fastestLapMs: data.lapTimeMs }))),

        onEventUpdateFor(slot, (data: EventData) =>
          setState((s) => ({ ...s, events: [...s.events.slice(-99), data] }))),

        onDriverHistoryUpdateFor(slot, (data: DriverHistoryUpdate) =>
          setState((s) => ({
            ...s,
            driverHistories: {
              ...s.driverHistories,
              [data.carIdx]: (data.laps ?? []) as HistoryLap[],
            },
          }))),

        onMotionUpdateFor(slot, (data: MotionUpdate) =>
          setState((s) => ({ ...s, motion: data ?? [] }))),

        // When the Rust recorder finishes a lap of trace samples, persist
        // them to disk. Fire-and-forget; errors only surface to the log.
        onTrackTraceCompleteFor(slot, (data) => {
          if (!data || !data.samples || data.samples.length === 0) return;
          api.saveTrackTrace(data.trackId, data.samples)
            .catch((e) => console.error('saveTrackTrace:', e));
        }),

        // Diagnostic: Rust emits this every 30 UDP packets. If the count
        // never moves while telemetry is "LIVE", packets aren't actually
        // arriving — almost always a Windows Firewall block on this exe
        // or F1 25 sending to a destination this app isn't listening on.
        onPacketRxFor(slot, (data) =>
          setPacketRx({
            count: data.count,
            lastPacketId: data.lastPacketId,
            lastSeenAt: Date.now(),
          })),
      ]);

      const fns: Array<() => void> = [];
      for (const r of results) {
        if (r.status === 'fulfilled') fns.push(r.value);
        else console.error('useTelemetry register failed:', r.reason);
      }
      if (active) unlisteners.push(...fns);
      else fns.forEach((fn) => fn());
    };

    register().catch(console.error);

    return () => {
      active = false;
      unlisteners.forEach((fn) => fn());
    };
  }, [slot]);

  const startTelemetry = useCallback(async (port: number) => {
    try { await api.startTelemetry(port, slot); } catch (e) { console.error('startTelemetry:', e); }
  }, [slot]);

  const stopTelemetry = useCallback(async () => {
    try { await api.stopTelemetry(slot); } catch (e) { console.error('stopTelemetry:', e); }
  }, [slot]);

  const setRival = useCallback((idx: number | null) => {
    setState((s) => ({ ...s, rivalCarIndex: idx }));
  }, []);

  useEffect(() => {
    setState((s) => ({ ...s, driverHistories: {}, rivalCarIndex: null }));
  }, [state.session?.trackId, state.session?.sessionType]);

  return { ...state, startTelemetry, stopTelemetry, setRival, packetRx };
}
