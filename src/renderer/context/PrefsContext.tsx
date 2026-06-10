import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/tauri-api';
import type { DriverNameMask } from '../../shared/types/store';
import { defaultRadioConfig, normalizeRadioConfig, type RadioConfig } from '../lib/radio-canonical';

export interface AppPrefs {
  driverNameMasks: DriverNameMask[];
  showSessionTimer: boolean;
  streamOverlayOpacity: number;
  streamOverlayEnabled: boolean;
  telemetryPorts: number[];
  tyreWearTargetPct: number;    // user target for tyre life estimator
  launchTargetRpmMin: number;
  launchTargetRpmMax: number;
  launchTargetThrottle: number; // 0..1
  // Layout persistence
  trackmapZoom: number;
  trackmapRotation: number;
  trackmapShowCorners: boolean;
  trackmapShowPitExit: boolean;
  timingGapMode: 'leader' | 'interval' | 'both';
  // LAN relay
  lanRelayEnabled: boolean;
  lanRelayHost: string;
  lanRelayPort: number;
  /** When on, the engineer voice speaks every race-control message. */
  radioVoiceEnabled: boolean;
  /** Per-category / per-situation enables for the auto-radio engine. */
  radioConfig: RadioConfig;
  /** Master kill-switch — same checkbox as RadioConfigUI's Master Radio. */
  radioMasterEnabled: boolean;
}

interface PrefsContextValue extends AppPrefs {
  setPrefs: (patch: Partial<AppPrefs>) => Promise<void>;
  reload: () => Promise<void>;
}

const DEFAULT_PREFS: AppPrefs = {
  driverNameMasks: [],
  showSessionTimer: true,
  streamOverlayOpacity: 0.9,
  streamOverlayEnabled: false,
  telemetryPorts: [20777],
  tyreWearTargetPct: 65,
  launchTargetRpmMin: 10500,
  launchTargetRpmMax: 11500,
  launchTargetThrottle: 0.85,
  trackmapZoom: 1,
  trackmapRotation: 0,
  trackmapShowCorners: true,
  trackmapShowPitExit: true,
  timingGapMode: 'both',
  lanRelayEnabled: false,
  lanRelayHost: '',
  lanRelayPort: 20778,
  radioVoiceEnabled: false,
  radioConfig: defaultRadioConfig(),
  radioMasterEnabled: true,
};

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<AppPrefs>(DEFAULT_PREFS);
  // Mirror of the latest prefs so rapid setPrefs calls don't clobber each
  // other through a stale render-time closure.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const load = useCallback(async () => {
    try {
      const s: any = await api.loadSettings?.();
      if (!s) return;
      setPrefsState({
        driverNameMasks: Array.isArray(s.driverNameMasks) ? s.driverNameMasks : [],
        showSessionTimer: s.showSessionTimer !== false,
        streamOverlayOpacity: typeof s.streamOverlay?.opacity === 'number' ? s.streamOverlay.opacity : 0.9,
        streamOverlayEnabled: !!s.streamOverlay?.enabled,
        telemetryPorts: Array.isArray(s.telemetryPorts) && s.telemetryPorts.length > 0
          ? s.telemetryPorts
          : [s.telemetryPort ?? 20777],
        tyreWearTargetPct: typeof s.tyreWearTargetPct === 'number' ? s.tyreWearTargetPct : 65,
        launchTargetRpmMin: typeof s.launchTargetRpmMin === 'number' ? s.launchTargetRpmMin : 10500,
        launchTargetRpmMax: typeof s.launchTargetRpmMax === 'number' ? s.launchTargetRpmMax : 11500,
        launchTargetThrottle: typeof s.launchTargetThrottle === 'number' ? s.launchTargetThrottle : 0.85,
        trackmapZoom: typeof s.trackmapZoom === 'number' ? s.trackmapZoom : 1,
        trackmapRotation: typeof s.trackmapRotation === 'number' ? s.trackmapRotation : 0,
        trackmapShowCorners: s.trackmapShowCorners !== false,
        trackmapShowPitExit: s.trackmapShowPitExit !== false,
        timingGapMode: (s.timingGapMode === 'leader' || s.timingGapMode === 'interval') ? s.timingGapMode : 'both',
        lanRelayEnabled: !!s.lanRelay?.enabled,
        lanRelayHost: typeof s.lanRelay?.host === 'string' ? s.lanRelay.host : '',
        lanRelayPort: typeof s.lanRelay?.port === 'number' ? s.lanRelay.port : 20778,
        radioVoiceEnabled: !!s.radioVoiceEnabled,
        radioConfig: normalizeRadioConfig(s.radioConfig),
        radioMasterEnabled: s.radioMasterEnabled !== false,
      });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const setPrefs = useCallback(async (patch: Partial<AppPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefsState(next);
    try {
      const prev: any = (await api.loadSettings?.()) ?? {};
      await api.saveSettings?.({
        ...prev,
        driverNameMasks: next.driverNameMasks,
        showSessionTimer: next.showSessionTimer,
        telemetryPorts: next.telemetryPorts,
        streamOverlay: {
          enabled: next.streamOverlayEnabled,
          opacity: next.streamOverlayOpacity,
        },
        tyreWearTargetPct: next.tyreWearTargetPct,
        launchTargetRpmMin: next.launchTargetRpmMin,
        launchTargetRpmMax: next.launchTargetRpmMax,
        launchTargetThrottle: next.launchTargetThrottle,
        trackmapZoom: next.trackmapZoom,
        trackmapRotation: next.trackmapRotation,
        trackmapShowCorners: next.trackmapShowCorners,
        trackmapShowPitExit: next.trackmapShowPitExit,
        timingGapMode: next.timingGapMode,
        lanRelay: {
          enabled: next.lanRelayEnabled,
          host: next.lanRelayHost,
          port: next.lanRelayPort,
        },
        radioVoiceEnabled: next.radioVoiceEnabled,
        radioConfig: next.radioConfig,
        radioMasterEnabled: next.radioMasterEnabled,
      });
      // Push LAN relay to backend so it takes effect now
      try {
        if (next.lanRelayEnabled && next.lanRelayHost) {
          await api.setLanRelay({ host: next.lanRelayHost, port: next.lanRelayPort });
        } else {
          await api.setLanRelay({});
        }
      } catch { /* ignore */ }
    } catch { /* ignore persistence errors */ }
  }, []);

  return (
    <PrefsContext.Provider value={{ ...prefs, setPrefs, reload: load }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be inside PrefsProvider');
  return ctx;
}
