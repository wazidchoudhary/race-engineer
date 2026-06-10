/**
 * TTS Speaker — wraps Edge TTS (via Tauri) with a local IndexedDB phrase cache
 * and a single-track audio queue so engineer phrases never overlap.
 *
 * If the Edge TTS backend fails (offline, Microsoft endpoint changes), we fall
 * back to the browser's speechSynthesis so the engineer is never silent.
 */
import { api } from './tauri-api';
import { getCached, putCached } from './phrase-cache';

interface QueueItem {
  text: string;
  voice: string;
  priority: number;
  rate: number;
  dedupeBy?: string;
}

const speakerState = {
  queue: [] as QueueItem[],
  current: null as HTMLAudioElement | null,
  /** Retained so Chromium can't GC an utterance with pending end events. */
  currentUtterance: null as SpeechSynthesisUtterance | null,
  urlsToRevoke: [] as string[],
  speaking: false,
  /** Bumped by stop(); in-flight playback callbacks from an older generation
   *  must not touch the queue state (prevents overlap after interrupts). */
  generation: 0,
  /** Set after the first backend failure so we can report health to the UI. */
  lastError: null as string | null,
  backendFailures: 0,
  rate: 1.0,
};

/** Global speech rate multiplier (persisted in Settings as tts.rate). */
export function setSpeechRate(rate: number): void {
  if (Number.isFinite(rate) && rate > 0) speakerState.rate = Math.min(2, Math.max(0.5, rate));
}

/** Last TTS backend error, or null when healthy. For Settings diagnostics. */
export function getTtsHealth(): { lastError: string | null; backendFailures: number } {
  return { lastError: speakerState.lastError, backendFailures: speakerState.backendFailures };
}

function base64ToBlobUrl(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'audio/mp3' });
  const url = URL.createObjectURL(blob);
  speakerState.urlsToRevoke.push(url);
  return url;
}

async function fetchAudio(text: string, voice: string, rate: number): Promise<string | null> {
  // Rate participates in the cache key so cached audio matches the setting.
  const cacheVoice = rate === 1.0 ? voice : `${voice}@${rate.toFixed(2)}`;
  const cached = await getCached(cacheVoice, text);
  if (cached) return cached;
  try {
    const b64 = await api.ttsSpeak({ text, voice, rate });
    if (!b64) return null;
    speakerState.lastError = null;
    void putCached(cacheVoice, text, b64);
    return b64;
  } catch (err: any) {
    speakerState.backendFailures += 1;
    speakerState.lastError = err?.message ?? String(err);
    if (speakerState.backendFailures <= 3) {
      console.error('[tts] Edge TTS backend failed, falling back to speechSynthesis:', err);
    }
    return null;
  }
}

/** Browser-native fallback so voice still works when Edge TTS is down. */
function speakWithWebSpeech(item: QueueItem, onDone: () => void): boolean {
  const synth = window.speechSynthesis;
  if (!synth) return false;
  try {
    const utter = new SpeechSynthesisUtterance(item.text);
    utter.lang = item.voice.startsWith('en-GB') ? 'en-GB' : 'en-US';
    utter.rate = item.rate;
    const gb = synth.getVoices().find((v) => v.lang === utter.lang);
    if (gb) utter.voice = gb;
    utter.onend = onDone;
    utter.onerror = onDone;
    speakerState.currentUtterance = utter;
    synth.speak(utter);
    return true;
  } catch {
    return false;
  }
}

async function playNext(): Promise<void> {
  if (speakerState.speaking) return;
  const next = speakerState.queue.shift();
  if (!next) return;
  speakerState.speaking = true;
  const gen = speakerState.generation;

  // Callbacks from a generation that stop() has since flushed must not touch
  // the speaker state — the cancelled audio's onend/onerror fires async and
  // would otherwise mark the NEW utterance's slot as free (overlapping audio).
  const finish = (): void => {
    if (gen !== speakerState.generation) return;
    speakerState.current = null;
    speakerState.currentUtterance = null;
    speakerState.speaking = false;
    void playNext();
  };

  const b64 = await fetchAudio(next.text, next.voice, next.rate);
  if (gen !== speakerState.generation) return; // interrupted while fetching
  if (!b64) {
    // Edge TTS unavailable — try the browser's built-in voice.
    if (speakWithWebSpeech(next, finish)) return;
    finish();
    return;
  }
  const url = base64ToBlobUrl(b64);
  const audio = new Audio(url);
  speakerState.current = audio;
  audio.onended = () => {
    URL.revokeObjectURL(url);
    finish();
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    finish();
  };
  try { await audio.play(); }
  catch (err) {
    console.error('[tts] audio.play() rejected (autoplay policy?):', err);
    URL.revokeObjectURL(url);
    finish();
  }
}

export interface SpeakOptions {
  voice?: string;
  /** 0-10 — higher jumps ahead of lower-priority pending items. Default 3. */
  priority?: number;
  /** drop if something with the same dedupe key is already queued */
  dedupeBy?: string;
  /** cancel current & flush queue before speaking */
  interrupt?: boolean;
  /** rate multiplier override; defaults to the global Settings rate */
  rate?: number;
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  const clean = (text ?? '').trim();
  if (!clean) return;
  const voice = opts.voice ?? 'en-GB-RyanNeural';
  const priority = opts.priority ?? 3;
  const rate = opts.rate ?? speakerState.rate;

  if (opts.dedupeBy && speakerState.queue.some((q) => q.dedupeBy === opts.dedupeBy)) {
    return;
  }

  if (opts.interrupt) {
    stop();
  }

  // Insert by priority (stable)
  const item: QueueItem = { text: clean, voice, priority, rate, dedupeBy: opts.dedupeBy };
  let idx = speakerState.queue.findIndex((q) => q.priority < priority);
  if (idx < 0) speakerState.queue.push(item);
  else speakerState.queue.splice(idx, 0, item);

  void playNext();
}

export function stop(): void {
  const cur = speakerState.current;
  speakerState.generation += 1; // invalidate in-flight callbacks
  speakerState.queue = [];
  speakerState.current = null;
  speakerState.currentUtterance = null;
  speakerState.speaking = false;
  if (cur) {
    try { cur.pause(); cur.src = ''; } catch { /* noop */ }
  }
  try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  for (const url of speakerState.urlsToRevoke.splice(0)) {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
}

export function isSpeaking(): boolean {
  return speakerState.speaking;
}

/** Pre-warm cache by fetching a phrase without playing it. */
export async function prewarm(text: string, voice = 'en-GB-RyanNeural'): Promise<void> {
  await fetchAudio(text, voice, speakerState.rate);
}
