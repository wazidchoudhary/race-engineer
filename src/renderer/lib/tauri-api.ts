/**
 * Tauri API bridge. Events for the "primary" slot are legacy-unsuffixed;
 * events for additional slots are suffixed `::<slot>`. Use the `*For(slot)`
 * listener helpers when binding to a non-primary slot.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const PRIMARY_SLOT = 'primary';

export function eventName(base: string, slot: string): string {
  return slot === PRIMARY_SLOT ? base : `${base}::${slot}`;
}

export const api = {
  startTelemetry: (port?: number, slot?: string) =>
    invoke<{ success: boolean; port: number; slot: string }>('start_telemetry', { port, slot }),

  stopTelemetry: (slot?: string) =>
    invoke<{ success: boolean; slot: string }>('stop_telemetry', { slot }),

  listTelemetrySlots: () =>
    invoke<{ slots: { slot: string; port: number }[] }>('list_telemetry_slots'),

  openDriverWindow: (slot: string) =>
    invoke<{ success: boolean; reused: boolean; label?: string }>('open_driver_window', { slot }),

  openPageWindow: (page: string, slot?: string) =>
    invoke<{ success: boolean; reused: boolean; label?: string }>('open_page_window', { page, slot }),

  openOverlayWindow: (slot?: string) =>
    invoke<{ success: boolean; reused?: boolean }>('open_overlay_window', { slot }),

  setLanRelay: (payload: { slot?: string; host?: string; port?: number }) =>
    invoke<{ success: boolean; slot: string; relay?: string }>('set_lan_relay', payload),

  setManualTrack: (trackId: number, slot?: string) =>
    invoke<void>('set_manual_track', { trackId, slot }),

  // ── Track-trace recording ────────────────────────────────────────────────
  startTrackTrace: (slot?: string) =>
    invoke<{ success: boolean; trackId?: number; error?: string }>(
      'start_track_trace', { slot }),

  stopTrackTrace: (slot?: string) =>
    invoke<{ success: boolean }>('stop_track_trace', { slot }),

  saveTrackTrace: (trackId: number, samples: [number, number][]) =>
    invoke<{ success: boolean; path?: string; error?: string }>(
      'save_track_trace', { trackId, samples }),

  loadTrackTrace: (trackId: number) =>
    invoke<TrackTrace | null>('load_track_trace', { trackId }),

  listTrackTraces: () =>
    invoke<number[]>('list_track_traces'),

  // ── Team Telemetry 25 BYO-data import ──────────────────────────────────
  loadTtTrack: (trackId: number, ttPath: string) =>
    invoke<TtTrackData>('load_tt_track', { trackId, ttPath }),

  setApiKey: (key: string) =>
    invoke<void>('set_api_key', { key }),

  setPremium: (enabled: boolean) =>
    invoke<void>('set_premium', { enabled }),

  getPremium: () =>
    invoke<{ premium: boolean; hasApiKey: boolean }>('get_premium'),

  validateApiKey: (key: string) =>
    invoke<{ valid: boolean; error?: string; model?: string; status?: number }>(
      'validate_api_key', { key },
    ),

  getUsage: () =>
    invoke<{
      inputTokens: number;
      cachedInputTokens: number;
      cacheCreationTokens: number;
      outputTokens: number;
      costUsd: number;
    }>('get_usage'),

  resetUsage: () =>
    invoke<void>('reset_usage'),

  loadSettings: () =>
    invoke<any>('load_settings'),

  saveSettings: (settings: any) =>
    invoke<void>('save_settings', { settings }),

  saveExportFile: (payload: { content: string; defaultName?: string; filters?: any[] }) =>
    invoke<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>(
      'save_export_file',
      { payload },
    ),

  getLookups: () =>
    invoke<any>('get_lookups'),

  askEngineer: (payload: { question: string; context?: any; mode?: string }) =>
    invoke<{ response?: string; error?: string; message?: string }>('ask_engineer', { payload }),

  callStrategy: (payload: { snapshot: any; trigger: string; question?: string }) =>
    invoke<{ decision?: StrategyDecision; trigger?: string; error?: string; message?: string }>(
      'call_strategy',
      { payload },
    ),

  ttsSpeak: (payload: { text: string; voice?: string; rate?: number }) =>
    invoke<string>('tts_speak', { payload }),

  // ── Network connectivity (firewall + UPnP) ────────────────────────────
  networkDiagnose: (port: number) =>
    invoke<NetworkDiagnosis>('network_diagnose', { port }),

  networkAutoSetup: (port: number) =>
    invoke<NetworkSetupResult>('network_auto_setup', { port }),

  networkRemoveSetup: (port: number) =>
    invoke<NetworkSetupResult>('network_remove_setup', { port }),

  openExternalUrl: (url: string) =>
    invoke<void>('open_external_url', { url }),
};

export interface NetworkDiagnosis {
  port: number;
  platform: string;                    // "windows" | "macos" | "linux"
  localIp: string | null;
  localIps: string[];
  publicIp: string | null;
  cgnatLikely: boolean;
  /** True if any inbound UDP allow-rule covers the port (manual + ours). */
  firewallRuleExists: boolean;
  /** Display names of every matching rule (often includes user-installed ones). */
  firewallRules: string[];
  /** True only when our specific named rule is present — gates Remove Setup. */
  ourFirewallRule: boolean;
  upnp: {
    available: boolean;
    mapped: boolean;
    externalIp?: string | null;
    gatewayIp?: string | null;
    gatewayAdminUrl?: string | null;
    error?: string | null;
  };
}

export interface NetworkStepResult {
  ok: boolean;
  error?: string;
  userDeclined?: boolean;
  skipped?: boolean;
  externalIp?: string | null;
  leaseSeconds?: number;
  localIp?: string;
  code?: number;
}

export interface NetworkSetupResult {
  firewall: NetworkStepResult;
  upnp: NetworkStepResult;
}

export type StrategyAction =
  | 'pit_now' | 'pit_next_lap' | 'pit_in_n_laps' | 'stay_out'
  | 'push' | 'save_tyres' | 'save_fuel' | 'manage_ers'
  | 'defend' | 'attack_undercut' | 'attack_overcut' | 'hold_position';

export type StrategyCompound = 'soft' | 'medium' | 'hard' | 'inter' | 'wet' | null;

/** One car's live world position (from the Motion packet). */
export interface MotionPoint { x: number; y: number; z: number; }
export type MotionUpdate = MotionPoint[];

export interface TrackTrace {
  trackId: number;
  samples: [number, number][];            // [worldX, worldZ] pairs
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number };
  recordedAt?: string;
}

/** Parsed TT data for a single track. `found:false` when the CSVs aren't
 *  present at the configured path (renderer should fall back). */
export interface TtTrackData {
  found: boolean;
  trackId: number;
  racingLine?: [number, number][];
  pitLane?: [number, number][];
  settings?: Record<string, number | string | boolean> | null;
  bbox?: { minX: number; maxX: number; minZ: number; maxZ: number };
  pathLength?: number;
}

export interface StrategyDecision {
  action: StrategyAction;
  targetLap?: number | null;
  targetCompound?: StrategyCompound;
  confidence: number;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
  radioMessage: string;
  alternativeAction?: string | null;
  triggerConditions?: string[];
}

// ── Event listeners (slot-aware) ──────────────────────────────────────────────
// `onFoo(cb)` binds to the primary slot. `onFooFor(slot, cb)` targets another.

const NOOP_UNLISTEN: UnlistenFn = () => {};

// Tauri 2 injects window.__TAURI_INTERNALS__ before page scripts run, but in
// dev mode with HMR / strict-mode double-mount the React effect can fire
// before the injection completes. Without this guard, listen() throws
// "Cannot read properties of undefined (reading 'transformCallback')",
// Promise.all short-circuits, and the renderer stays deaf to every event.
async function waitForTauriIpc(maxWaitMs = 5000): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: { transformCallback?: unknown } };
  if (w.__TAURI_INTERNALS__?.transformCallback) return true;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 50));
    if (w.__TAURI_INTERNALS__?.transformCallback) return true;
  }
  return false;
}

async function bind<T>(base: string, slot: string, cb: (d: T) => void): Promise<UnlistenFn> {
  const ready = await waitForTauriIpc();
  if (!ready) {
    console.error(
      `[tauri-api] IPC bridge unavailable — cannot register listener for "${eventName(base, slot)}". ` +
      'window.__TAURI_INTERNALS__ never appeared. This window is not a Tauri webview ' +
      '(opened in a regular browser?) or the IPC injection failed.'
    );
    return NOOP_UNLISTEN;
  }
  try {
    return await listen<T>(eventName(base, slot), (e) => cb(e.payload));
  } catch (err) {
    console.error(`[tauri-api] listen("${eventName(base, slot)}") failed:`, err);
    return NOOP_UNLISTEN;
  }
}

export const onTelemetryStarted   = (cb: (d: any) => void) => bind<any>('telemetry-started', PRIMARY_SLOT, cb);
export const onTelemetryStopped   = (cb: (d: any) => void) => bind<any>('telemetry-stopped', PRIMARY_SLOT, cb);
export const onTelemetryError     = (cb: (d: any) => void) => bind<any>('telemetry-error', PRIMARY_SLOT, cb);
export const onSessionUpdate      = (cb: (d: any) => void) => bind<any>('session-update', PRIMARY_SLOT, cb);
export const onLapUpdate          = (cb: (d: any) => void) => bind<any>('lap-update', PRIMARY_SLOT, cb);
export const onTelemetryUpdate    = (cb: (d: any) => void) => bind<any>('telemetry-update', PRIMARY_SLOT, cb);
export const onAllTelemetryUpdate = (cb: (d: any) => void) => bind<any>('alltelemetry-update', PRIMARY_SLOT, cb);
export const onStatusUpdate       = (cb: (d: any) => void) => bind<any>('status-update', PRIMARY_SLOT, cb);
export const onAllStatusUpdate    = (cb: (d: any) => void) => bind<any>('allstatus-update', PRIMARY_SLOT, cb);
export const onDamageUpdate       = (cb: (d: any) => void) => bind<any>('damage-update', PRIMARY_SLOT, cb);
export const onSetupUpdate        = (cb: (d: any) => void) => bind<any>('setup-update', PRIMARY_SLOT, cb);
export const onAllSetupUpdate     = (cb: (d: any) => void) => bind<any>('allsetup-update', PRIMARY_SLOT, cb);
export const onParticipantsUpdate = (cb: (d: any) => void) => bind<any>('participants-update', PRIMARY_SLOT, cb);
export const onBestLapsUpdate     = (cb: (d: any) => void) => bind<any>('best-laps-update', PRIMARY_SLOT, cb);
export const onFastestLapUpdate   = (cb: (d: any) => void) => bind<any>('fastest-lap-update', PRIMARY_SLOT, cb);
export const onEventUpdate        = (cb: (d: any) => void) => bind<any>('event-update', PRIMARY_SLOT, cb);
export const onDriverHistoryUpdate= (cb: (d: any) => void) => bind<any>('driver-history-update', PRIMARY_SLOT, cb);
export const onPacketRx           = (cb: (d: { count: number; lastPacketId: number; packetFormat?: number }) => void) =>
  bind<{ count: number; lastPacketId: number; packetFormat?: number }>('packet-rx', PRIMARY_SLOT, cb);

// Slot-scoped variants — same callbacks, different event suffix.
export const onTelemetryStartedFor   = (slot: string, cb: (d: any) => void) => bind<any>('telemetry-started', slot, cb);
export const onTelemetryStoppedFor   = (slot: string, cb: (d: any) => void) => bind<any>('telemetry-stopped', slot, cb);
export const onTelemetryErrorFor     = (slot: string, cb: (d: any) => void) => bind<any>('telemetry-error', slot, cb);
export const onSessionUpdateFor      = (slot: string, cb: (d: any) => void) => bind<any>('session-update', slot, cb);
export const onLapUpdateFor          = (slot: string, cb: (d: any) => void) => bind<any>('lap-update', slot, cb);
export const onTelemetryUpdateFor    = (slot: string, cb: (d: any) => void) => bind<any>('telemetry-update', slot, cb);
export const onAllTelemetryUpdateFor = (slot: string, cb: (d: any) => void) => bind<any>('alltelemetry-update', slot, cb);
export const onStatusUpdateFor       = (slot: string, cb: (d: any) => void) => bind<any>('status-update', slot, cb);
export const onAllStatusUpdateFor    = (slot: string, cb: (d: any) => void) => bind<any>('allstatus-update', slot, cb);
export const onDamageUpdateFor       = (slot: string, cb: (d: any) => void) => bind<any>('damage-update', slot, cb);
export const onSetupUpdateFor        = (slot: string, cb: (d: any) => void) => bind<any>('setup-update', slot, cb);
export const onAllSetupUpdateFor     = (slot: string, cb: (d: any) => void) => bind<any>('allsetup-update', slot, cb);
export const onParticipantsUpdateFor = (slot: string, cb: (d: any) => void) => bind<any>('participants-update', slot, cb);
export const onBestLapsUpdateFor     = (slot: string, cb: (d: any) => void) => bind<any>('best-laps-update', slot, cb);
export const onFastestLapUpdateFor   = (slot: string, cb: (d: any) => void) => bind<any>('fastest-lap-update', slot, cb);
export const onEventUpdateFor        = (slot: string, cb: (d: any) => void) => bind<any>('event-update', slot, cb);
export const onDriverHistoryUpdateFor= (slot: string, cb: (d: any) => void) => bind<any>('driver-history-update', slot, cb);
export const onPacketRxFor           = (slot: string, cb: (d: { count: number; lastPacketId: number; packetFormat?: number }) => void) =>
  bind<{ count: number; lastPacketId: number; packetFormat?: number }>('packet-rx', slot, cb);
export const onMotionUpdateFor        = (slot: string, cb: (d: MotionUpdate) => void) => bind<MotionUpdate>('motion-update', slot, cb);
// 2026 Season Pack: Car Telemetry 2 (Overtake mode + Active Aero) and all-car damage.
export const onTelemetry2UpdateFor    = (slot: string, cb: (d: any) => void) => bind<any>('telemetry2-update', slot, cb);
export const onAllTelemetry2UpdateFor = (slot: string, cb: (d: any) => void) => bind<any>('alltelemetry2-update', slot, cb);
export const onAllDamageUpdateFor     = (slot: string, cb: (d: any) => void) => bind<any>('alldamage-update', slot, cb);
export const onTrackTraceCompleteFor  = (slot: string, cb: (d: { trackId: number; samples: [number, number][] }) => void) =>
  bind<{ trackId: number; samples: [number, number][] }>('track-trace-complete', slot, cb);
