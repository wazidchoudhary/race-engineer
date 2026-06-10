/**
 * Emergency Gate
 *
 * The engineer stays quiet by default. Unprompted speech only fires for
 * emergencies, and only after a user-idle grace window has elapsed.
 *
 * - Emergency categories bypass the idle wait.
 * - Non-emergency categories require ≥ IDLE_MS since last user interaction.
 * - Driver pressing PTT (or typing a query) bumps `lastUserInteractionAt`.
 */

export const IDLE_MS = 15_000;

// Categories/urgencies the engineer may speak unprompted.
// Everything else is silenced unless the driver asks for it.
export const EMERGENCY_CATEGORIES = new Set<string>([
  'flags',      // SC, VSC, red flag, yellows
  'incident',   // damage, spin
  'weather',    // rain onset, crossover
  'pit',        // pit emergency, SC free-stop
  'tyres',      // tyre cliff, wear critical, puncture risk
]);

export const EMERGENCY_URGENCIES = new Set<string>(['critical', 'high']);

// Specific situations that override the category gate — true emergencies that
// must always be spoken regardless of idle state. Names must match the
// canonical situation keys in `radio-canonical.ts` / `useAutoRadio.ts`.
export const ALWAYS_SPEAK_SITUATIONS = new Set<string>([
  'safety_car',
  'virtual_sc',
  'red_flag',
  'yellow_flag',
  'blue_flag',
  'critical_wear',
  'puncture',
  'wing_damage',
  'floor_damage',
  'engine_damage',
  'gearbox_issue',
  'ers_fault',
  'rain_started',
  'rain_incoming',
  'fuel_critical',
  'box_now',
  'sc_pit_opportunity',
]);

export interface SpeakDecisionInput {
  category?: string;
  urgency?: string;
  situation?: string;
  /** user has explicitly asked for engineer input (PTT or typed query) */
  userAsked?: boolean;
  /** epoch ms of last user interaction */
  lastUserInteractionAt: number;
  /** epoch ms now */
  now?: number;
}

export interface SpeakDecision {
  shouldSpeak: boolean;
  reason: string;
}

export function shouldSpeak(input: SpeakDecisionInput): SpeakDecision {
  const now = input.now ?? Date.now();
  if (input.userAsked) return { shouldSpeak: true, reason: 'user_asked' };

  const sit = (input.situation ?? '').toLowerCase();
  if (sit && ALWAYS_SPEAK_SITUATIONS.has(sit)) {
    return { shouldSpeak: true, reason: 'always_speak_situation' };
  }

  const urgency = (input.urgency ?? 'low').toLowerCase();
  const category = (input.category ?? '').toLowerCase();

  const isEmergency =
    EMERGENCY_URGENCIES.has(urgency) || EMERGENCY_CATEGORIES.has(category);

  if (isEmergency) return { shouldSpeak: true, reason: 'emergency' };

  const idleMs = now - (input.lastUserInteractionAt || 0);
  if (idleMs >= IDLE_MS) {
    return { shouldSpeak: true, reason: 'idle_elapsed' };
  }

  return {
    shouldSpeak: false,
    reason: `muted_until_idle_${Math.max(0, IDLE_MS - idleMs)}ms`,
  };
}

/**
 * Singleton-ish interaction tracker. Hooks update this on PTT/query events.
 */
export class InteractionTracker {
  private lastAt = 0;
  mark(): void { this.lastAt = Date.now(); }
  getLastAt(): number { return this.lastAt; }
  idleMs(now: number = Date.now()): number { return now - this.lastAt; }
  isIdle(now: number = Date.now()): boolean { return this.idleMs(now) >= IDLE_MS; }
}

export const globalInteractionTracker = new InteractionTracker();
