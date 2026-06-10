/**
 * ERS Coach — builds a per-lap battery deployment plan for the current track
 * and battery state, and turns it into live, position-aware instructions.
 *
 * Doctrine (from 2026-regs + sim-community research):
 *  - Deploy on corner exit only once the car is straight and hooked up.
 *  - Hairpins / slowest corners: NONE through, Boost on exit until ~7th gear
 *    (or high revs in 6th), then settle to MEDIUM.
 *  - Medium / fast corners: stay on MEDIUM.
 *  - Long braking zones: lift-and-coast starting 25-50 m before the normal
 *    braking point.
 *  - Cut deployment ~100 m before heavy braking.
 *  - Race: finish every lap above ~20%; Quali: arrive at the line nearly empty.
 */

import {
  ersTrackDataFor,
  type BrakingZone,
  type CornerClass,
  type ErsCorner,
} from '../track-data/ers-track-data';
import { MAX_ERS_STORE_J, type LapZone } from '../types/packets';

export type SegmentMode = 'boost' | 'medium' | 'none' | 'lift' | 'corner';

export interface PlanSegment {
  /** Lap fractions; from > to means the segment wraps through start/finish. */
  fromPct: number;
  toPct: number;
  mode: SegmentMode;
  /** Short label for the lap strip. */
  label: string;
  /** Longer explanation for the detail panel. */
  detail: string;
  /** What the engineer says as the car enters this segment ('' = silent). */
  voice: string;
  /** 1-10 — voice triage. */
  priority: number;
  cornerNum?: number;
}

export interface LapPlan {
  trackId: number;
  trackName: string;
  lengthM: number;
  segments: PlanSegment[];
  deployBudgetJ: number;
  expectedHarvestJ: number;
  approximate: boolean;
  /** One-paragraph strategy summary for the tab + AI lesson seed. */
  strategy: string;
  notes: string[];
}

export type BatteryStance = 'critical' | 'low' | 'balanced' | 'rich' | 'full';

export interface CoachLiveInput {
  lapDistanceM: number;
  speedKph: number;
  gear: number;
  brake: number;
  throttle: number;
  ersStoreJ: number;
  ersDeployedThisLapJ: number;
  ersHarvestedThisLapJ: number;
  ersHarvestLimitJ?: number;
  ersDeployMode: number; // 0 none, 1 medium, 2 hotlap, 3 boost
  overtakeAvailable?: boolean;
  overtakeActive?: boolean;
}

export interface CoachAdvice {
  segment: PlanSegment | null;
  /** The next actionable segment ahead (for "coming up" calls). */
  next: PlanSegment | null;
  /** Metres until `next` begins. */
  nextInM: number | null;
  instruction: string;
  stance: BatteryStance;
  stanceText: string;
}

// ── Tunables ─────────────────────────────────────────────────────────────────

const BRAKE_ZONE_M: Record<BrakingZone, number> = {
  'none': 0, 'short': 60, 'medium': 90, 'long': 120, 'very-long': 150,
};

/** Lift-and-coast length before the braking point (the 25-50 m rule). */
const LIFT_M: Record<BrakingZone, number> = {
  'none': 0, 'short': 0, 'medium': 0, 'long': 35, 'very-long': 50,
};

const CORNER_EXIT_M: Record<CornerClass, number> = {
  hairpin: 70, slow: 60, chicane: 55, medium: 45, fast: 30,
};

/** Approximate harvest per braking zone (J) under the MGU-K. */
const HARVEST_PER_BRAKE_J: Record<BrakingZone, number> = {
  'none': 0, 'short': 100_000, 'medium': 200_000, 'long': 320_000, 'very-long': 430_000,
};

/** Deploy cost per metre: full boost vs medium sustain (J/m). */
const BOOST_J_PER_M = 5200;   // ~350 kW at ~67 m/s
const MEDIUM_J_PER_M = 1900;  // partial deployment

/** Boost phase length on a straight — until ~7th gear, then Medium. */
const BOOST_PHASE_M = 320;

// ── Battery stance ───────────────────────────────────────────────────────────

export function batteryStance(pct: number): BatteryStance {
  if (pct < 12) return 'critical';
  if (pct < 30) return 'low';
  if (pct < 70) return 'balanced';
  if (pct < 92) return 'rich';
  return 'full';
}

export function stanceText(stance: BatteryStance, raceMode: 'race' | 'quali'): string {
  switch (stance) {
    case 'critical':
      return 'Battery critical — deployment off, lift and coast everywhere, one recovery lap.';
    case 'low':
      return 'Battery low — short bursts only on the two biggest exits, harvest the rest.';
    case 'balanced':
      return raceMode === 'race'
        ? 'Battery in the working band — follow the plan, finish the lap above 20%.'
        : 'Battery workable — spend it where the plan says, arrive at the line near empty.';
    case 'rich':
      return 'Battery rich — you can add a burst on the second-priority straights.';
    case 'full':
      return 'Battery full — deploy freely, every second at 100% wastes harvest.';
  }
}

function budgetFactor(stance: BatteryStance): number {
  switch (stance) {
    case 'critical': return 0.2;
    case 'low': return 0.55;
    case 'balanced': return 1.0;
    case 'rich': return 1.25;
    case 'full': return 1.5;
  }
}

// ── Plan builder ─────────────────────────────────────────────────────────────

interface StraightCandidate {
  fromPct: number;
  toPct: number;
  lengthM: number;
  afterCorner: ErsCorner;
  inDrsZone: boolean;
}

function wrapPct(p: number): number {
  return ((p % 1) + 1) % 1;
}

/** Forward distance (in lap fractions) from a to b. */
function fwd(a: number, b: number): number {
  return wrapPct(b - a);
}

export function buildLapPlan(opts: {
  trackId: number | undefined | null;
  trackLengthM?: number;
  batteryPct: number;
  raceMode: 'race' | 'quali';
  harvestLimitJ?: number;
  drsZones?: LapZone[];
}): LapPlan | null {
  const data = ersTrackDataFor(opts.trackId ?? null);
  if (!data) return buildFallbackPlan(opts);

  const lengthM = opts.trackLengthM && opts.trackLengthM > 1000 ? opts.trackLengthM : data.lengthM;
  const corners = [...data.corners].sort((a, b) => a.pct - b.pct);
  const stance = batteryStance(opts.batteryPct);

  // Expected harvest per lap from the braking zones (capped by the 2026
  // per-lap harvest limit when the game reports one).
  let expectedHarvestJ = corners.reduce((sum, k) => sum + HARVEST_PER_BRAKE_J[k.braking], 0);
  expectedHarvestJ += 250_000; // partial-throttle / lift recovery around the lap
  if (opts.harvestLimitJ && opts.harvestLimitJ > 0) {
    expectedHarvestJ = Math.min(expectedHarvestJ, opts.harvestLimitJ);
  }

  // Deploy budget for this lap.
  let deployBudgetJ: number;
  if (opts.raceMode === 'quali') {
    // Spend almost everything in the tank plus most of what we recover.
    deployBudgetJ = (opts.batteryPct / 100) * MAX_ERS_STORE_J * 0.9 + expectedHarvestJ * 0.6;
  } else {
    // Sustainable racing: spend roughly what we recover, scaled by stance.
    deployBudgetJ = expectedHarvestJ * budgetFactor(stance);
  }

  // ── Straight candidates between corner exit and next braking point ──
  const straights: StraightCandidate[] = [];
  for (let i = 0; i < corners.length; i++) {
    const cur = corners[i];
    const nxt = corners[(i + 1) % corners.length];
    // Work in metres from the apex gap so close-together corners can't wrap
    // a "negative" straight into a near-full-lap segment.
    const apexGapM = fwd(cur.pct, nxt.pct) * lengthM;
    const segLenM = apexGapM
      - CORNER_EXIT_M[cur.cls]
      - BRAKE_ZONE_M[nxt.braking]
      - LIFT_M[nxt.braking];
    if (segLenM < 80) continue; // nothing worth narrating
    const fromPct = wrapPct(cur.pct + CORNER_EXIT_M[cur.cls] / lengthM);
    const toPct = wrapPct(fromPct + segLenM / lengthM);
    const midPct = wrapPct(fromPct + (segLenM / 2) / lengthM);
    const inDrsZone = (opts.drsZones ?? []).some(
      (z) => fwd(z.start, midPct) <= fwd(z.start, z.end),
    );
    straights.push({ fromPct, toPct, lengthM: segLenM, afterCorner: cur, inDrsZone });
  }

  // ── Allocate the budget greedily over the longest (and DRS) straights ──
  // Longest straights claim budget first; cost is capped at what's left so a
  // monster straight (Baku's 2.2 km) can never be leapfrogged by short ones
  // just because its full cost exceeds the remaining budget — on a long
  // straight you simply stop deploying partway down, which is exactly what
  // the real cars do (clipping).
  const ranked = [...straights].sort(
    (a, b) => (b.lengthM + (b.inDrsZone ? 250 : 0)) - (a.lengthM + (a.inDrsZone ? 250 : 0)),
  );
  const modeFor = new Map<StraightCandidate, SegmentMode>();
  let remaining = deployBudgetJ;
  for (const s of ranked) {
    const boostPhase = Math.min(s.lengthM, BOOST_PHASE_M);
    const boostCost = boostPhase * BOOST_J_PER_M + Math.max(0, s.lengthM - boostPhase) * MEDIUM_J_PER_M;
    const mediumCost = s.lengthM * MEDIUM_J_PER_M;
    if (s.lengthM >= 420 && remaining >= boostPhase * BOOST_J_PER_M) {
      modeFor.set(s, 'boost');
      remaining -= Math.min(boostCost, remaining);
    } else if (s.lengthM >= 220 && remaining >= mediumCost * 0.5) {
      modeFor.set(s, 'medium');
      remaining -= Math.min(mediumCost, remaining);
    } else {
      modeFor.set(s, 'none');
    }
  }

  // ── Emit segments in lap order: corner → exit straight → lift → (next) ──
  const segments: PlanSegment[] = [];
  for (let i = 0; i < corners.length; i++) {
    const cur = corners[i];
    const nxt = corners[(i + 1) % corners.length];
    const brakeStartPct = wrapPct(cur.pct - BRAKE_ZONE_M[cur.braking] / lengthM);
    const exitPct = wrapPct(cur.pct + CORNER_EXIT_M[cur.cls] / lengthM);
    const cname = cur.name ?? `Turn ${cur.num}`;

    // Corner segment (braking point → exit).
    const slowCorner = cur.cls === 'hairpin' || cur.cls === 'slow';
    segments.push({
      fromPct: brakeStartPct,
      toPct: exitPct,
      mode: 'corner',
      cornerNum: cur.num,
      label: cname,
      detail: slowCorner
        ? `${cname}: mode NONE through the corner — deployment here is wheelspin. Wait for grip on exit.`
        : `${cname}: stay on MEDIUM through the corner.`,
      voice: slowCorner ? `Mode none through ${cname}.` : '',
      priority: slowCorner ? 5 : 2,
    });

    // Exit straight segment.
    const straight = straights.find((s) => s.afterCorner === cur);
    if (straight) {
      const mode = modeFor.get(straight) ?? 'none';
      const drsTag = straight.inDrsZone ? ' DRS zone — stack it with deployment.' : '';
      if (mode === 'boost') {
        segments.push({
          fromPct: straight.fromPct,
          toPct: straight.toPct,
          mode,
          label: `Burn → ${Math.round(straight.lengthM)} m`,
          detail: `Priority deploy zone (${Math.round(straight.lengthM)} m). ${slowCorner ? 'Grip first, then ' : ''}Boost until 7th gear (or high revs in 6th), then settle to MEDIUM.${drsTag}`,
          voice: slowCorner
            ? `Good exit, now burn — boost to seventh, then medium.`
            : `Deploy now — boost to seventh, then medium.`,
          priority: 6,
        });
      } else if (mode === 'medium') {
        segments.push({
          fromPct: straight.fromPct,
          toPct: straight.toPct,
          mode,
          label: `Medium → ${Math.round(straight.lengthM)} m`,
          detail: `Secondary straight (${Math.round(straight.lengthM)} m): hold MEDIUM deployment.${drsTag}`,
          voice: `Medium deployment down this one.`,
          priority: 3,
        });
      } else {
        segments.push({
          fromPct: straight.fromPct,
          toPct: straight.toPct,
          mode,
          label: `Bank → ${Math.round(straight.lengthM)} m`,
          detail: `Short run (${Math.round(straight.lengthM)} m): not worth the energy — bank it for the priority zones.`,
          voice: '',
          priority: 1,
        });
      }
    }

    // Lift-and-coast segment before the NEXT corner's braking point.
    const liftM = LIFT_M[nxt.braking];
    if (liftM > 0) {
      const nxtBrakeStart = wrapPct(nxt.pct - BRAKE_ZONE_M[nxt.braking] / lengthM);
      const liftStart = wrapPct(nxtBrakeStart - liftM / lengthM);
      const nname = nxt.name ?? `Turn ${nxt.num}`;
      segments.push({
        fromPct: liftStart,
        toPct: nxtBrakeStart,
        mode: 'lift',
        cornerNum: nxt.num,
        label: `Lift ${liftM} m`,
        detail: `Long braking zone into ${nname}: lift and coast from ${liftM} m before your braking point — big harvest, tiny time loss. Deployment OFF before this point.`,
        voice: `Lift and coast into ${nname}.`,
        priority: 7,
      });
    }
  }

  // Sort by lap order for the strip renderer.
  segments.sort((a, b) => a.fromPct - b.fromPct);

  const boostCount = [...modeFor.values()].filter((m) => m === 'boost').length;
  const mediumCount = [...modeFor.values()].filter((m) => m === 'medium').length;
  const strategy =
    `${data.name}: ${opts.raceMode === 'quali' ? 'qualifying lap — spend it all' : 'race rhythm — spend what you harvest'}. ` +
    `${boostCount} priority burn zone${boostCount === 1 ? '' : 's'}, ${mediumCount} medium sustain zone${mediumCount === 1 ? '' : 's'}; ` +
    `everything else banks energy. Expected harvest ≈ ${(expectedHarvestJ / 1e6).toFixed(1)} MJ/lap` +
    (opts.harvestLimitJ ? ` (FIA limit ${(opts.harvestLimitJ / 1e6).toFixed(1)} MJ)` : '') +
    `, deploy budget ≈ ${(deployBudgetJ / 1e6).toFixed(1)} MJ.`;

  return {
    trackId: data.trackId,
    trackName: data.name,
    lengthM,
    segments,
    deployBudgetJ,
    expectedHarvestJ,
    approximate: !!data.approximate,
    strategy,
    notes: data.notes,
  };
}

/** No corner data — derive a coarse plan from the live DRS zones (2026). */
function buildFallbackPlan(opts: {
  trackId: number | undefined | null;
  trackLengthM?: number;
  batteryPct: number;
  raceMode: 'race' | 'quali';
  harvestLimitJ?: number;
  drsZones?: LapZone[];
}): LapPlan | null {
  const zones = opts.drsZones ?? [];
  const lengthM = opts.trackLengthM && opts.trackLengthM > 1000 ? opts.trackLengthM : 5000;
  if (zones.length === 0) return null;
  const segments: PlanSegment[] = [];
  for (const z of zones) {
    segments.push({
      fromPct: z.start,
      toPct: z.end,
      mode: 'boost',
      label: 'DRS zone — deploy',
      detail: 'DRS zone: the game marks these on the longest straights — deploy here, boost early then medium.',
      voice: 'DRS zone — deploy now.',
      priority: 5,
    });
  }
  segments.sort((a, b) => a.fromPct - b.fromPct);
  return {
    trackId: opts.trackId ?? -1,
    trackName: 'Unknown track',
    lengthM,
    segments,
    deployBudgetJ: 2_000_000,
    expectedHarvestJ: 2_000_000,
    approximate: true,
    strategy:
      'No corner intelligence for this layout yet — deploying in the DRS zones (the game places them on the longest straights) and harvesting everywhere else. Record a lap trace on the Track Map page to improve this.',
    notes: [],
  };
}

// ── Live advice ──────────────────────────────────────────────────────────────

function segContains(seg: PlanSegment, pct: number): boolean {
  return fwd(seg.fromPct, pct) <= fwd(seg.fromPct, seg.toPct);
}

export function adviceAt(plan: LapPlan, input: CoachLiveInput, raceMode: 'race' | 'quali'): CoachAdvice {
  const pct = wrapPct(input.lapDistanceM / plan.lengthM);
  const storePct = (input.ersStoreJ / MAX_ERS_STORE_J) * 100;
  const stance = batteryStance(storePct);

  const segment = plan.segments.find((s) => segContains(s, pct)) ?? null;

  // Next actionable segment ahead (skip silent 'bank' segments).
  let next: PlanSegment | null = null;
  let nextDist = Infinity;
  for (const s of plan.segments) {
    if (s === segment) continue;
    if (s.priority < 3) continue;
    const d = fwd(pct, s.fromPct);
    if (d < nextDist) { nextDist = d; next = s; }
  }
  const nextInM = next ? nextDist * plan.lengthM : null;

  // Stance overrides the plan at the extremes.
  let instruction: string;
  if (stance === 'critical') {
    instruction = 'Deployment OFF. Lift and coast every braking zone — rebuild to 30% before deploying again.';
  } else if (stance === 'full' && segment?.mode !== 'lift' && segment?.mode !== 'corner') {
    instruction = 'Battery full — burn it now. Every metre at 100% throws harvest away.';
  } else if (segment) {
    instruction = segment.detail;
  } else {
    instruction = 'Follow the lap strip — deploy on the marked exits, harvest everywhere else.';
  }

  // Overtake (Manual Override) bonus call.
  if (input.overtakeAvailable && !input.overtakeActive && stance !== 'critical') {
    instruction += ' Overtake mode is ARMED — it beats the high-speed taper, use it on the next big straight.';
  }

  return {
    segment,
    next,
    nextInM,
    instruction,
    stance,
    stanceText: stanceText(stance, raceMode),
  };
}

// ── Lap summary (spoken at lap completion) ───────────────────────────────────

export function lapSummaryLine(args: {
  deployedJ: number;
  harvestedJ: number;
  harvestLimitJ?: number;
  endStorePct: number;
  raceMode: 'race' | 'quali';
}): string {
  const dep = (args.deployedJ / 1e6).toFixed(1);
  const har = (args.harvestedJ / 1e6).toFixed(1);
  const end = Math.round(args.endStorePct);
  let line = `Lap done: deployed ${dep} mega-joules, harvested ${har}. Battery ${end} percent.`;
  if (args.harvestLimitJ && args.harvestedJ >= args.harvestLimitJ * 0.97) {
    line += ' Harvest limit reached — extra lifting gains nothing this lap.';
  }
  if (args.raceMode === 'race' && end < 20) {
    line += ' Below the race floor — calm lap now, rebuild to thirty.';
  } else if (args.raceMode === 'race' && end > 90) {
    line += ' You are over-saving — spend more on the priority straights.';
  }
  return line;
}
