import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTelemetry, type PacketRxStats } from '../hooks/useTelemetry';
import { useIntelligence, type IntelligenceData } from '../hooks/useIntelligence';
import { usePrefs } from './PrefsContext';
import type { TelemetryState } from '../../shared/types/store';
import { PRIMARY_SLOT } from '../lib/tauri-api';

export interface TelemetryContextValue extends TelemetryState {
  startTelemetry: (port: number) => void;
  stopTelemetry: () => void;
  setRival: (idx: number | null) => void;
  intelligence: IntelligenceData;
  /** Slot this window/view is observing. */
  slot: string;
  /** Spawned windows lock to the URL's `?slot=X`; the main window can switch. */
  locked: boolean;
  setSlot: (slot: string) => void;
  /** Diagnostic UDP receive stats (count, last packet id, last seen at). */
  packetRx: PacketRxStats;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

/** Read `?slot=X` from the URL once at mount. Empty → null (main window). */
function readSlotFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('slot');
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const urlSlot = readSlotFromUrl();
  const locked = urlSlot !== null;
  const [slot, setSlot] = useState<string>(urlSlot ?? PRIMARY_SLOT);

  const telemetry = useTelemetry(slot);
  const intelligence = useIntelligence(telemetry);
  const { telemetryPorts } = usePrefs();

  // Auto-start the primary UDP listener once on app launch in the main window.
  // Without this, the Dashboard stays empty until the user finds and clicks the
  // "Start Telemetry" button in the sidebar — surprising for anyone coming
  // from Team Telemetry, which auto-listens.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (locked) return;
    if (slot !== PRIMARY_SLOT) return;
    autoStartedRef.current = true;
    const port = telemetryPorts[0] ?? 20777;
    telemetry.startTelemetry(port);
  }, [locked, slot, telemetryPorts, telemetry]);

  const value: TelemetryContextValue = {
    ...telemetry,
    intelligence,
    slot,
    locked,
    setSlot: locked ? () => { /* spawned windows are locked to their URL slot */ } : setSlot,
  };

  return (
    <TelemetryContext.Provider value={value}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetryContext(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetryContext must be used within TelemetryProvider');
  return ctx;
}
