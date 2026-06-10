/**
 * RadioContext — hosts the auto-radio detector engine at app level so the
 * engineer voice works on EVERY page, not just while the Engineer tab is open.
 *
 * The main window mounts <RadioProvider>; popout windows mount it with
 * `muted` so they still show the message feed without doubling the audio.
 */
import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTelemetryContext } from './TelemetryContext';
import { useAutoRadio, type RadioMessage } from '../hooks/useAutoRadio';
import { api } from '../lib/tauri-api';
import { stop as ttsStop, setSpeechRate } from '../lib/tts-speaker';

interface RadioContextValue {
  messages: RadioMessage[];
  clearMessages: () => void;
  ttsEnabled: boolean;
  setTtsEnabled: (on: boolean) => void;
  ttsVoice: string;
  /** True in popout windows — feed renders, audio stays in the main window. */
  muted: boolean;
}

const RadioContext = createContext<RadioContextValue | null>(null);

export function RadioProvider({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const ctx = useTelemetryContext();
  const [ttsEnabled, setTtsEnabledState] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('en-GB-RyanNeural');

  useEffect(() => {
    const applySettings = (s: any) => {
      if (s?.tts?.enabled != null) setTtsEnabledState(!!s.tts.enabled);
      if (s?.tts?.voice) setTtsVoice(s.tts.voice);
      if (s?.tts?.rate != null) setSpeechRate(s.tts.rate);
    };
    api.loadSettings?.().then(applySettings).catch(() => {});
    // SettingsUI broadcasts this after Save All so voice/rate changes take
    // effect without an app restart.
    const onChanged = () => { api.loadSettings?.().then(applySettings).catch(() => {}); };
    window.addEventListener('tts-settings-changed', onChanged);
    return () => window.removeEventListener('tts-settings-changed', onChanged);
  }, []);

  // Persist the toggle so it survives restarts (the old Engineer-page
  // checkbox only set local state and reset on every remount).
  const setTtsEnabled = useCallback((on: boolean) => {
    setTtsEnabledState(on);
    if (!on) ttsStop();
    void (async () => {
      try {
        const prev: any = (await api.loadSettings?.()) ?? {};
        await api.saveSettings?.({ ...prev, tts: { ...(prev.tts ?? {}), enabled: on } });
      } catch { /* ignore */ }
    })();
  }, []);

  const { messages, clearMessages } = useAutoRadio(ctx, ttsEnabled && !muted, ttsVoice, muted);

  return (
    <RadioContext.Provider value={{ messages, clearMessages, ttsEnabled, setTtsEnabled, ttsVoice, muted }}>
      {children}
    </RadioContext.Provider>
  );
}

export function useRadio(): RadioContextValue {
  const ctx = useContext(RadioContext);
  if (!ctx) throw new Error('useRadio must be inside RadioProvider');
  return ctx;
}
