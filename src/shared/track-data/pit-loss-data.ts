/**
 * Per-track pit-loss estimates (full green-flag pit cycle in seconds:
 * pit-entry delta + speed-limited lane + stationary + pit-exit delta vs
 * staying out one lap). Single source shared by the deterministic
 * StrategyEngine and the LLM snapshot builder so the two never disagree.
 *
 * Values are approximate community/real-world figures keyed by UDP trackId
 * (see SessionData m_trackId). When the game reports a real
 * `pitLaneTimeInLaneMs`, callers should prefer that observed value.
 */
export const PIT_LOSS_BY_TRACK: Record<number, number> = {
  0: 21,   // Melbourne
  2: 22,   // Shanghai
  3: 21,   // Sakhir (Bahrain)
  4: 21,   // Catalunya
  5: 19,   // Monaco
  6: 18,   // Montreal
  7: 22,   // Silverstone
  9: 20,   // Hungaroring
  10: 22,  // Spa
  11: 20,  // Monza
  12: 23,  // Singapore
  13: 22,  // Suzuka
  14: 21,  // Abu Dhabi
  15: 21,  // Texas (Austin)
  16: 20,  // Brazil (Interlagos)
  17: 19,  // Austria (Red Bull Ring)
  19: 22,  // Mexico
  20: 18,  // Baku
  26: 21,  // Zandvoort
  27: 26,  // Imola (long pit lane)
  29: 20,  // Jeddah
  30: 20,  // Miami
  31: 20,  // Las Vegas
  32: 23,  // Losail (Qatar)
  42: 22,  // Madrid (Madring) — approximate
};

export const DEFAULT_PIT_LOSS_SEC = 22;

/** Pit-loss seconds for a trackId, falling back to a sane default. */
export function pitLossSeconds(trackId: number | undefined | null): number {
  if (trackId == null) return DEFAULT_PIT_LOSS_SEC;
  return PIT_LOSS_BY_TRACK[trackId] ?? DEFAULT_PIT_LOSS_SEC;
}
