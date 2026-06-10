/**
 * Per-track ERS / battery-management intelligence for the Battery Coach.
 *
 * Each track lists its ERS-relevant corners in lap order with:
 *  - `pct`     — approximate lap fraction of the apex (0..1)
 *  - `cls`     — corner speed class (drives the deploy-mode rule)
 *  - `braking` — braking effort INTO the corner (drives lift-and-coast calls)
 *  - `exitStraightM` — full-throttle metres AFTER the corner (deploy priority)
 *
 * Flat-out kinks that need no driver action are omitted on purpose — the
 * coach narrates actions, not geography. Positions are hand-estimated from
 * circuit maps (±2-3% of lap distance); the live engine sequences by order
 * and distance windows, so small offsets only shift call timing slightly.
 *
 * Coaching doctrine encoded here (sim-community + 2026-regs research):
 *  - Hairpins / slowest corners: mode NONE through the corner, deploy hard
 *    (Boost) on exit once traction is restored, short-shift point ~7th gear
 *    or high revs in 6th, then drop to MEDIUM for the rest of the straight.
 *  - Medium / fast corners: stay on MEDIUM through and out.
 *  - Long braking zones: lift-and-coast starting 25-50 m before the normal
 *    braking point — maximum harvest for minimum lap-time loss.
 *  - Cut deployment ~100 m before heavy braking; deploying into a braking
 *    zone is wasted energy.
 */

export type CornerClass = 'hairpin' | 'slow' | 'medium' | 'fast' | 'chicane';
export type BrakingZone = 'none' | 'short' | 'medium' | 'long' | 'very-long';

export interface ErsCorner {
  num: number;
  name?: string;
  /** Lap fraction of the apex, 0..1. */
  pct: number;
  cls: CornerClass;
  /** Braking effort into this corner. */
  braking: BrakingZone;
  /** Approx full-throttle metres after the exit (deploy priority). */
  exitStraightM: number;
}

export interface ErsTrackData {
  trackId: number;
  name: string;
  /** Approximate lap length in metres. */
  lengthM: number;
  corners: ErsCorner[];
  /** Track-specific coaching notes shown in the Battery Coach tab. */
  notes: string[];
  /** True when corner positions are rough estimates (new/uncommon layout). */
  approximate?: boolean;
}

function c(
  num: number,
  pct: number,
  cls: CornerClass,
  braking: BrakingZone,
  exitStraightM: number,
  name?: string,
): ErsCorner {
  return { num, pct, cls, braking, exitStraightM, name };
}

export const ERS_TRACK_DATA: Record<number, ErsTrackData> = {
  // ── Melbourne ──
  0: {
    trackId: 0, name: 'Melbourne', lengthM: 5278,
    corners: [
      c(1, 0.06, 'medium', 'long', 120, 'Turn 1'),
      c(2, 0.075, 'medium', 'none', 480),
      c(3, 0.17, 'slow', 'long', 220, 'Turn 3'),
      c(4, 0.19, 'medium', 'short', 350),
      c(6, 0.31, 'fast', 'short', 450, 'Turn 6'),
      c(9, 0.47, 'fast', 'medium', 300, 'Turn 9'),
      c(10, 0.48, 'medium', 'none', 700),
      c(11, 0.62, 'fast', 'medium', 350, 'Turn 11'),
      c(13, 0.83, 'slow', 'long', 250, 'Turn 13'),
      c(14, 0.85, 'medium', 'short', 800, 'Turn 14'),
    ],
    notes: [
      'Around 70% of this lap is full throttle — the hardest battery balance on the calendar. Lift-and-coast is mandatory, not optional.',
      'Few big braking zones to harvest from: protect 20% minimum battery at all times.',
      'Best deploy: exit of Turn 14 onto the pit straight and exit of Turn 10 down to Turn 11.',
    ],
  },

  // ── Shanghai ──
  2: {
    trackId: 2, name: 'Shanghai', lengthM: 5451,
    corners: [
      c(1, 0.05, 'medium', 'long', 0, 'Turn 1'),
      c(3, 0.09, 'slow', 'none', 300, 'Turn 3'),
      c(6, 0.22, 'hairpin', 'long', 400, 'Turn 6'),
      c(8, 0.33, 'fast', 'short', 250, 'Turn 8'),
      c(9, 0.36, 'medium', 'short', 350),
      c(11, 0.52, 'slow', 'medium', 150, 'Turn 11'),
      c(13, 0.58, 'medium', 'short', 1170, 'Turn 13'),
      c(14, 0.78, 'hairpin', 'very-long', 350, 'Turn 14'),
      c(16, 0.93, 'medium', 'medium', 600, 'Turn 16'),
    ],
    notes: [
      'The 1.2 km back straight after Turn 13 is your biggest deploy zone — exit clean and burn through it.',
      'Turn 14 hairpin has the heaviest braking on the lap: lift-and-coast 50 m early, harvest hard.',
      'The long Turn 1-2-3 snail uses no deployment — bank energy through there.',
    ],
  },

  // ── Bahrain ──
  3: {
    trackId: 3, name: 'Bahrain', lengthM: 5412,
    corners: [
      c(1, 0.05, 'slow', 'very-long', 250, 'Turn 1'),
      c(2, 0.07, 'medium', 'none', 300),
      c(4, 0.17, 'medium', 'long', 400, 'Turn 4'),
      c(8, 0.36, 'slow', 'medium', 200, 'Turn 8'),
      c(10, 0.47, 'slow', 'long', 350, 'Turn 10'),
      c(11, 0.55, 'fast', 'none', 600, 'Turn 11'),
      c(13, 0.72, 'medium', 'medium', 250, 'Turn 13'),
      c(14, 0.85, 'slow', 'medium', 1090, 'Turn 14'),
    ],
    notes: [
      'Four straights and big stops — classic pulse-deployment track and the best place to practise ERS timing.',
      'Boost out of Turn 14 onto the kilometre-long main straight, then Medium once you hit 7th gear.',
      'Heavy braking into Turns 1, 4 and 10 recovers plenty — lift-and-coast 40 m early into Turn 1.',
    ],
  },

  // ── Catalunya ──
  4: {
    trackId: 4, name: 'Catalunya', lengthM: 4657,
    corners: [
      c(1, 0.07, 'medium', 'long', 150, 'Turn 1'),
      c(2, 0.09, 'medium', 'none', 250),
      c(3, 0.13, 'fast', 'none', 300, 'Turn 3'),
      c(4, 0.20, 'medium', 'medium', 300, 'Turn 4'),
      c(5, 0.27, 'slow', 'medium', 250, 'Turn 5'),
      c(7, 0.36, 'medium', 'short', 300, 'Turn 7'),
      c(9, 0.48, 'fast', 'short', 500, 'Turn 9'),
      c(10, 0.58, 'slow', 'long', 200, 'Turn 10'),
      c(12, 0.70, 'medium', 'short', 250, 'Turn 12'),
      c(13, 0.78, 'medium', 'short', 200),
      c(14, 0.82, 'fast', 'none', 730, 'Final corner'),
    ],
    notes: [
      'Deploy priority: the main straight (exit of the fast final corner) and the run out of Turn 9 down to Turn 10.',
      'The fast final sector means you arrive on the straight already at speed — short Boost burst, then Medium.',
      'Harvest through the middle-sector esses where deployment gains little.',
    ],
  },

  // ── Monaco ──
  5: {
    trackId: 5, name: 'Monaco', lengthM: 3337,
    corners: [
      c(1, 0.08, 'slow', 'medium', 200, 'Ste Devote'),
      c(3, 0.18, 'medium', 'short', 100, 'Massenet'),
      c(4, 0.22, 'slow', 'short', 150, 'Casino'),
      c(5, 0.30, 'slow', 'medium', 100, 'Mirabeau'),
      c(6, 0.38, 'hairpin', 'medium', 120, 'Grand Hotel Hairpin'),
      c(8, 0.52, 'slow', 'short', 580, 'Portier'),
      c(10, 0.61, 'chicane', 'long', 150, 'Nouvelle Chicane'),
      c(12, 0.70, 'medium', 'short', 150, 'Piscine'),
      c(15, 0.88, 'slow', 'medium', 100, 'Rascasse'),
      c(16, 0.94, 'slow', 'short', 350, 'Anthony Noghes'),
    ],
    notes: [
      'Lowest energy demand of the season — you can harvest almost the whole lap and still be full.',
      'The only deploy zone that matters: Portier exit, through the tunnel, down to the chicane.',
      'NONE through the Grand Hotel hairpin — the slowest corner in F1. Any deployment there is wheelspin.',
      'Use surplus battery for Anthony Noghes onto the pit straight in qualifying.',
    ],
  },

  // ── Montreal ──
  6: {
    trackId: 6, name: 'Montreal', lengthM: 4361,
    corners: [
      c(1, 0.04, 'medium', 'medium', 100, 'Turn 1'),
      c(2, 0.06, 'slow', 'none', 350, 'Turn 2'),
      c(3, 0.12, 'chicane', 'medium', 250, 'Turns 3-4'),
      c(6, 0.25, 'chicane', 'medium', 300, 'Turns 6-7'),
      c(8, 0.38, 'chicane', 'long', 350, 'Turns 8-9'),
      c(10, 0.52, 'hairpin', 'long', 1100, "L'Epingle"),
      c(13, 0.83, 'chicane', 'very-long', 600, 'Wall of Champions'),
    ],
    notes: [
      'The hairpin exit feeds the 1.1 km Casino straight — your number-one deploy zone. NONE through the hairpin, Boost once straight.',
      'Big stop into the final chicane: lift-and-coast 50 m early, harvest, then deploy across the line.',
      'Chicane-to-chicane stop-start rhythm recovers well — battery rarely runs critical here.',
    ],
  },

  // ── Silverstone ──
  7: {
    trackId: 7, name: 'Silverstone', lengthM: 5891,
    corners: [
      c(1, 0.05, 'fast', 'short', 200, 'Abbey'),
      c(3, 0.12, 'slow', 'long', 750, 'Village'),
      c(6, 0.23, 'medium', 'long', 150, 'Brooklands'),
      c(7, 0.28, 'medium', 'none', 550, 'Luffield'),
      c(9, 0.38, 'fast', 'none', 300, 'Copse'),
      c(10, 0.46, 'fast', 'short', 100, 'Maggotts'),
      c(13, 0.50, 'fast', 'short', 770, 'Becketts exit'),
      c(15, 0.66, 'fast', 'medium', 250, 'Stowe'),
      c(16, 0.78, 'chicane', 'long', 300, 'Vale'),
      c(18, 0.83, 'medium', 'short', 700, 'Club'),
    ],
    notes: [
      'Becketts exit onto Hangar straight is the king deploy zone — keep MEDIUM through the esses, full burn after the last apex.',
      'Village exit feeds the long Wellington straight: NONE in, Boost out.',
      'Maggotts-Becketts takes no deployment benefit mid-complex — save it for the exits.',
    ],
  },

  // ── Hungaroring ──
  9: {
    trackId: 9, name: 'Hungaroring', lengthM: 4381,
    corners: [
      c(1, 0.07, 'medium', 'long', 250, 'Turn 1'),
      c(2, 0.15, 'medium', 'medium', 350, 'Turn 2'),
      c(4, 0.27, 'fast', 'short', 150, 'Turn 4'),
      c(5, 0.33, 'medium', 'medium', 200, 'Turn 5'),
      c(6, 0.40, 'chicane', 'short', 150, 'Turns 6-7'),
      c(11, 0.62, 'fast', 'none', 300, 'Turn 11'),
      c(12, 0.72, 'medium', 'medium', 150, 'Turn 12'),
      c(13, 0.80, 'slow', 'medium', 150, 'Turn 13'),
      c(14, 0.88, 'medium', 'medium', 750, 'Turn 14'),
    ],
    notes: [
      'Monaco-with-fences: one real straight. Deploy is concentrated on the Turn 14 exit down to Turn 1.',
      'Harvest through the twisty middle sector — deployment there barely moves lap time.',
      'Track position is everything here: bank battery for a Turn 14 exit attack with DRS.',
    ],
  },

  // ── Spa ──
  10: {
    trackId: 10, name: 'Spa-Francorchamps', lengthM: 7004,
    corners: [
      c(1, 0.04, 'hairpin', 'long', 700, 'La Source'),
      c(3, 0.17, 'fast', 'none', 100, 'Eau Rouge'),
      c(4, 0.20, 'fast', 'none', 800, 'Raidillon'),
      c(5, 0.27, 'chicane', 'very-long', 300, 'Les Combes'),
      c(8, 0.33, 'slow', 'medium', 250, 'Bruxelles'),
      c(9, 0.46, 'fast', 'medium', 350, 'Pouhon'),
      c(12, 0.62, 'medium', 'medium', 300, 'Stavelot'),
      c(15, 0.78, 'fast', 'none', 750, 'Blanchimont'),
      c(18, 0.90, 'chicane', 'long', 600, 'Bus Stop'),
    ],
    notes: [
      'NONE through La Source, then the longest effective deploy zone in F1: hairpin exit, flat through Eau Rouge, all the way up Kemmel. Boost until 7th, Medium to the top.',
      'Huge stop into Les Combes after 1.5 km flat-out — lift-and-coast 50 m early, you barely lose time and harvest a chunk.',
      'Watch for clipping at the end of Kemmel and before Bus Stop — short-lift instead of fighting it.',
    ],
  },

  // ── Monza ──
  11: {
    trackId: 11, name: 'Monza', lengthM: 5793,
    corners: [
      c(1, 0.07, 'chicane', 'very-long', 750, 'Rettifilo'),
      c(3, 0.22, 'fast', 'none', 300, 'Curva Grande'),
      c(4, 0.34, 'chicane', 'long', 350, 'Roggia'),
      c(6, 0.40, 'medium', 'medium', 200, 'Lesmo 1'),
      c(7, 0.44, 'medium', 'short', 650, 'Lesmo 2'),
      c(8, 0.62, 'chicane', 'long', 900, 'Ascari'),
      c(11, 0.88, 'medium', 'long', 620, 'Parabolica'),
    ],
    notes: [
      'Strictest energy management of the year: long full-throttle stretches and only three real braking zones. Expect heavy clipping.',
      'In real 2026 racing the FIA cuts the harvest limit at Monza — watch the per-lap harvest gauge, do not count on a full recharge.',
      'Deploy out of Ascari and Parabolica; accept that the battery will run down across the lap and rebuild it in the Rettifilo/Roggia stops.',
      'Lift-and-coast 50 m before Turn 1 — the 340 km/h stop is your biggest single harvest of the lap.',
    ],
  },

  // ── Singapore ──
  12: {
    trackId: 12, name: 'Singapore', lengthM: 4940,
    corners: [
      c(1, 0.03, 'medium', 'medium', 150, 'Turn 1'),
      c(3, 0.07, 'slow', 'medium', 400, 'Turn 3'),
      c(5, 0.16, 'medium', 'short', 500, 'Turn 5'),
      c(7, 0.26, 'slow', 'long', 350, 'Turn 7'),
      c(8, 0.32, 'slow', 'medium', 200, 'Turn 8'),
      c(10, 0.42, 'slow', 'medium', 200, 'Turn 10'),
      c(13, 0.52, 'hairpin', 'long', 350, 'Turn 13'),
      c(14, 0.58, 'slow', 'medium', 400, 'Turn 14'),
      c(16, 0.72, 'slow', 'short', 250, 'Turn 16'),
      c(18, 0.80, 'slow', 'short', 200, 'Turn 18'),
      c(19, 0.88, 'medium', 'short', 450, 'Turn 19'),
    ],
    notes: [
      'Stop-start all lap: lots of harvest, lots of short bursts. Deploy in 0.5-1.0 s taps on every decent exit.',
      'Priority zones: Turn 5 exit down to Turn 7, and Turn 13 hairpin exit.',
      'Battery rarely the limit here — tyre temperature is. Use Medium freely.',
    ],
  },

  // ── Suzuka ──
  13: {
    trackId: 13, name: 'Suzuka', lengthM: 5807,
    corners: [
      c(1, 0.05, 'fast', 'medium', 100, 'Turn 1'),
      c(2, 0.10, 'medium', 'short', 250, 'S Curves entry'),
      c(6, 0.24, 'medium', 'short', 200, 'Dunlop'),
      c(8, 0.30, 'medium', 'short', 150, 'Degner 1'),
      c(9, 0.33, 'slow', 'medium', 350, 'Degner 2'),
      c(11, 0.40, 'hairpin', 'long', 500, 'Hairpin'),
      c(13, 0.56, 'medium', 'medium', 850, 'Spoon'),
      c(15, 0.78, 'fast', 'none', 350, '130R'),
      c(16, 0.88, 'chicane', 'long', 550, 'Casio Triangle'),
    ],
    notes: [
      'Spoon exit feeds the 1 km back straight to 130R — the lap-time deploy zone. NONE through the hairpin before it, bank energy.',
      'Known super-clipping point: flat through 130R at top speed the car force-harvests (~30 km/h loss). Treat it as free charge, don\'t fight it.',
      'The first-sector esses want a steady MEDIUM — no big bursts until Degner 2 exit.',
    ],
  },

  // ── Abu Dhabi ──
  14: {
    trackId: 14, name: 'Abu Dhabi', lengthM: 5281,
    corners: [
      c(1, 0.04, 'medium', 'medium', 250, 'Turn 1'),
      c(5, 0.17, 'hairpin', 'medium', 1200, 'Turn 5 hairpin'),
      c(6, 0.36, 'chicane', 'very-long', 600, 'Turns 6-7'),
      c(9, 0.55, 'hairpin', 'very-long', 300, 'Turn 9'),
      c(12, 0.70, 'medium', 'medium', 200, 'Turn 12'),
      c(13, 0.78, 'slow', 'medium', 250, 'Turn 13'),
      c(15, 0.85, 'medium', 'short', 200, 'Turn 15'),
      c(16, 0.90, 'medium', 'short', 550, 'Turn 16'),
    ],
    notes: [
      'Two monster straights off slow corners: Turn 5 exit (1.2 km) and Turns 6-7 exit. NONE through both hairpins, Boost on exit.',
      'Both straights end in very heavy braking — lift-and-coast 50 m early and you recover most of what you spent.',
      'The marina sector is all harvest — keep it on NONE/MEDIUM and arrive at Turn 16 with charge for the main straight.',
    ],
  },

  // ── Austin (COTA) ──
  15: {
    trackId: 15, name: 'Austin', lengthM: 5513,
    corners: [
      c(1, 0.05, 'hairpin', 'long', 350, 'Turn 1'),
      c(3, 0.12, 'fast', 'none', 100, 'Esses entry'),
      c(9, 0.25, 'fast', 'short', 250, 'Esses exit'),
      c(11, 0.32, 'hairpin', 'long', 1100, 'Turn 11'),
      c(12, 0.50, 'slow', 'very-long', 250, 'Turn 12'),
      c(13, 0.55, 'slow', 'short', 150, 'Turn 13'),
      c(15, 0.65, 'medium', 'medium', 250, 'Turn 15'),
      c(16, 0.72, 'fast', 'none', 300, 'Triple right'),
      c(19, 0.85, 'medium', 'long', 250, 'Turn 19'),
      c(20, 0.92, 'slow', 'medium', 450, 'Turn 20'),
    ],
    notes: [
      'Turn 11 hairpin onto the 1.1 km back straight is the lap-defining exit: NONE in, perfect traction, Boost to 7th, Medium, then lift-and-coast 50 m before Turn 12.',
      'The S1 esses flow like Maggotts-Becketts — steady MEDIUM, no bursts.',
      'Uphill drag to Turn 1 rewards a short burst across the start line.',
    ],
  },

  // ── Interlagos ──
  16: {
    trackId: 16, name: 'Interlagos', lengthM: 4309,
    corners: [
      c(1, 0.05, 'chicane', 'long', 550, 'Senna S'),
      c(4, 0.28, 'medium', 'long', 350, 'Descida do Lago'),
      c(7, 0.52, 'medium', 'medium', 200, 'Ferradura'),
      c(8, 0.58, 'slow', 'medium', 150, 'Laranja'),
      c(10, 0.68, 'slow', 'short', 150, 'Pinheirinho'),
      c(11, 0.78, 'slow', 'medium', 150, 'Bico de Pato'),
      c(12, 0.82, 'medium', 'short', 1000, 'Juncao'),
    ],
    notes: [
      'Juncao exit starts a kilometre of flat-out climbing to Turn 1 — the single most important exit. Carry momentum, Boost when straight, Medium up the hill.',
      'Senna S braking is the big harvest: lift-and-coast 40 m early.',
      'Short lap, big elevation: battery cycles fast — recover any deficit within two laps.',
    ],
  },

  // ── Red Bull Ring ──
  17: {
    trackId: 17, name: 'Red Bull Ring', lengthM: 4318,
    corners: [
      c(1, 0.12, 'medium', 'long', 650, 'Niki Lauda Kurve'),
      c(3, 0.30, 'slow', 'very-long', 700, 'Remus'),
      c(4, 0.44, 'slow', 'long', 400, 'Schlossgold'),
      c(6, 0.60, 'fast', 'short', 200, 'Turn 6'),
      c(7, 0.70, 'fast', 'short', 250, 'Rindt'),
      c(9, 0.85, 'fast', 'medium', 250, 'Turn 9'),
      c(10, 0.93, 'medium', 'medium', 400, 'Turn 10'),
    ],
    notes: [
      'Three uphill drags off slow corners — Remus exit is the overtaking spot, save Boost (and the Overtake button) for it.',
      'Big stops into Remus and Schlossgold: both are lift-and-coast gold, start the lift 40 m early.',
      'Short lap: a recharge lap costs little — if you run below 20%, one calm lap restores the battery.',
    ],
  },

  // ── Mexico ──
  19: {
    trackId: 19, name: 'Mexico City', lengthM: 4304,
    corners: [
      c(1, 0.06, 'medium', 'very-long', 250, 'Turn 1'),
      c(4, 0.17, 'slow', 'long', 350, 'Turn 4'),
      c(6, 0.25, 'slow', 'medium', 300, 'Turn 6'),
      c(9, 0.40, 'medium', 'short', 200, 'Esses'),
      c(12, 0.55, 'medium', 'long', 150, 'Stadium entry'),
      c(13, 0.62, 'slow', 'short', 150, 'Foro Sol'),
      c(16, 0.72, 'slow', 'short', 200, 'Turn 16'),
      c(17, 0.78, 'medium', 'none', 1200, 'Stadium exit'),
    ],
    notes: [
      'Thin air = less drag = the 1.2 km main straight rewards a long Medium burn rather than a short Boost.',
      'Heavy stop into Turn 1 at 360+ km/h: textbook lift-and-coast, start 50 m early.',
      'Cooling is marginal at altitude — clipping shows up early; harvest in the stadium section.',
    ],
  },

  // ── Baku ──
  20: {
    trackId: 20, name: 'Baku', lengthM: 6003,
    corners: [
      c(1, 0.02, 'slow', 'long', 250, 'Turn 1'),
      c(2, 0.05, 'slow', 'medium', 300, 'Turn 2'),
      c(3, 0.10, 'slow', 'long', 350, 'Turn 3'),
      c(4, 0.13, 'slow', 'medium', 400, 'Turn 4'),
      c(7, 0.30, 'slow', 'medium', 200, 'Turn 7'),
      c(8, 0.38, 'slow', 'short', 100, 'Castle entry'),
      c(12, 0.45, 'slow', 'short', 250, 'Castle exit'),
      c(15, 0.60, 'slow', 'long', 300, 'Turn 15'),
      c(16, 0.66, 'slow', 'medium', 2200, 'Turn 16'),
    ],
    notes: [
      'The 2.2 km flat-out blast to Turn 1 is the longest deploy zone in F1 — but you cannot feed it all. Boost off Turn 16, Medium, and accept the taper.',
      'Expect super-clipping near the end of the main straight; lift early into Turn 1 instead of fighting it.',
      'The castle section is pure harvest — NONE from Turn 7 to Turn 12 loses almost nothing.',
    ],
  },

  // ── Zandvoort ──
  26: {
    trackId: 26, name: 'Zandvoort', lengthM: 4259,
    corners: [
      c(1, 0.05, 'hairpin', 'long', 250, 'Tarzan'),
      c(3, 0.18, 'slow', 'medium', 350, 'Hugenholtz'),
      c(7, 0.46, 'fast', 'none', 250, 'Scheivlak'),
      c(9, 0.55, 'slow', 'medium', 200, 'Turn 9'),
      c(11, 0.65, 'slow', 'medium', 250, 'Turn 11'),
      c(13, 0.85, 'fast', 'none', 150, 'Turn 13'),
      c(14, 0.92, 'fast', 'none', 650, 'Arie Luyendyk (banked)'),
    ],
    notes: [
      'The banked final corner is flat — you arrive on the pit straight at speed. Short Boost off the banking, Medium to Tarzan.',
      'Tarzan is the only real overtaking spot: bank battery for a DRS + Boost run there.',
      'NONE out of Hugenholtz until the banking unwinds, then build through the dunes on MEDIUM.',
    ],
  },

  // ── Imola ──
  27: {
    trackId: 27, name: 'Imola', lengthM: 4909,
    corners: [
      c(2, 0.10, 'chicane', 'very-long', 600, 'Tamburello'),
      c(5, 0.22, 'chicane', 'medium', 400, 'Villeneuve'),
      c(7, 0.38, 'hairpin', 'long', 450, 'Tosa'),
      c(9, 0.52, 'fast', 'short', 250, 'Piratella'),
      c(11, 0.64, 'medium', 'medium', 300, 'Acque Minerali'),
      c(14, 0.76, 'chicane', 'medium', 350, 'Variante Alta'),
      c(17, 0.92, 'medium', 'long', 700, 'Rivazza'),
    ],
    notes: [
      'Rivazza exit onto the start-finish run is the priority deploy zone — the "straight" is actually a flat-out curve past the pits all the way to Tamburello.',
      'Tamburello braking from 330 km/h: lift-and-coast 50 m early, biggest harvest on the lap.',
      'Narrow track, hard to pass: in races, bank for a Tamburello DRS move rather than dribbling energy out every lap.',
    ],
  },

  // ── Jeddah ──
  29: {
    trackId: 29, name: 'Jeddah', lengthM: 6174,
    corners: [
      c(1, 0.03, 'chicane', 'long', 400, 'Turn 1'),
      c(4, 0.12, 'fast', 'none', 300, 'Turn 4'),
      c(13, 0.42, 'medium', 'medium', 500, 'Turn 13 (banked)'),
      c(16, 0.52, 'fast', 'short', 400, 'Turn 16'),
      c(22, 0.74, 'fast', 'short', 500, 'Turn 22'),
      c(27, 0.95, 'hairpin', 'long', 800, 'Turn 27'),
    ],
    notes: [
      'Fastest street circuit in the world — mostly flat-out kinks. Energy demand is huge and harvest chances are few.',
      'Three DRS zones chain together: deploy with discipline or you will clip everywhere.',
      'NONE through the final hairpin, then Boost across the line — the main straight is the overtaking zone.',
    ],
  },

  // ── Miami ──
  30: {
    trackId: 30, name: 'Miami', lengthM: 5412,
    corners: [
      c(1, 0.03, 'medium', 'long', 250, 'Turn 1'),
      c(7, 0.20, 'fast', 'none', 350, 'Turn 7'),
      c(8, 0.25, 'medium', 'short', 700, 'Turn 8'),
      c(11, 0.42, 'slow', 'long', 250, 'Turn 11'),
      c(14, 0.55, 'chicane', 'medium', 150, 'Turns 14-15'),
      c(16, 0.62, 'slow', 'short', 1100, 'Turn 16'),
      c(17, 0.78, 'slow', 'very-long', 350, 'Turn 17'),
      c(19, 0.90, 'medium', 'medium', 500, 'Turn 19'),
    ],
    notes: [
      'Turn 16 exit onto the 1.1 km back straight is the move zone — NONE through the chicane complex, then full Boost.',
      'Massive stop into Turn 17: lift-and-coast 50 m early, harvest most of the deploy back.',
      'The Turn 8 sweeper feeds a long curved run — steady Medium beats a burst there.',
    ],
  },

  // ── Las Vegas ──
  31: {
    trackId: 31, name: 'Las Vegas', lengthM: 6201,
    corners: [
      c(1, 0.03, 'slow', 'long', 300, 'Turn 1'),
      c(5, 0.14, 'medium', 'medium', 600, 'Turn 5'),
      c(9, 0.30, 'slow', 'medium', 250, 'Turn 9'),
      c(12, 0.40, 'medium', 'long', 1900, 'Turn 12'),
      c(14, 0.72, 'slow', 'very-long', 250, 'Turn 14'),
      c(16, 0.85, 'medium', 'medium', 700, 'Turn 16'),
    ],
    notes: [
      'The 1.9 km Strip straight off Turn 12 cannot be fed flat-out — Boost the exit, Medium, then ride the taper. Expect super-clipping before Turn 14.',
      'Cold track + huge braking into Turn 14: free harvest, lift 50 m early.',
      'Low-downforce lap like Monza — manage the battery across the lap, not corner to corner.',
    ],
  },

  // ── Losail ──
  32: {
    trackId: 32, name: 'Losail', lengthM: 5419,
    corners: [
      c(1, 0.05, 'medium', 'long', 250, 'Turn 1'),
      c(2, 0.08, 'medium', 'short', 300, 'Turn 2'),
      c(4, 0.18, 'fast', 'none', 250, 'Turns 4-5'),
      c(6, 0.27, 'slow', 'medium', 350, 'Turn 6'),
      c(10, 0.45, 'medium', 'long', 400, 'Turn 10'),
      c(12, 0.60, 'fast', 'none', 300, 'Turns 12-14'),
      c(15, 0.78, 'medium', 'medium', 250, 'Turn 15'),
      c(16, 0.88, 'medium', 'medium', 1070, 'Turn 16'),
    ],
    notes: [
      'MotoGP-style flowing lap — corners chain together, so MEDIUM through the fast sweeps and one big burn off Turn 16 onto the kilometre main straight.',
      'Few heavy stops: harvest mainly comes from Turn 1 and Turn 6 braking. Protect 25%+ battery.',
      'High-speed corner loads cook tyres before battery — don\'t over-deploy mid-lap.',
    ],
  },

  // ── Madrid (Madring, new for 2026) ──
  42: {
    trackId: 42, name: 'Madrid (Madring)', lengthM: 5470,
    approximate: true,
    corners: [
      c(1, 0.04, 'slow', 'long', 350, 'Turn 1'),
      c(4, 0.14, 'medium', 'medium', 300, 'Turn 4'),
      c(7, 0.28, 'slow', 'long', 600, 'Turn 7'),
      c(10, 0.42, 'medium', 'medium', 400, 'Turn 10'),
      c(13, 0.55, 'slow', 'medium', 300, 'Turn 13'),
      c(17, 0.72, 'hairpin', 'long', 450, 'Turn 17'),
      c(20, 0.88, 'fast', 'none', 700, 'La Monumental (banked)'),
    ],
    notes: [
      'New for 2026 — corner positions are approximate until we record a lap trace.',
      'La Monumental: the 24%-banked final sweep is flat — you launch onto the pit straight at speed. Short Boost, then Medium.',
      'NONE through the Turn 17 hairpin, deploy once the banking takes the load.',
      'Record a lap with the Track Map trace recorder to refine this data.',
    ],
  },
};

/** Tracks we have ERS data for. */
export function hasErsTrackData(trackId: number | undefined | null): boolean {
  return trackId != null && ERS_TRACK_DATA[trackId] != null;
}

export function ersTrackDataFor(trackId: number | undefined | null): ErsTrackData | null {
  if (trackId == null) return null;
  return ERS_TRACK_DATA[trackId] ?? null;
}
