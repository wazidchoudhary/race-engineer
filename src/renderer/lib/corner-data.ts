/**
 * Named corners and pit-loss estimates for F1 circuits.
 *
 * - CORNER_NAMES[trackId] is an array of { num, name, pct } where pct is a
 *   rough normalized lap-distance (0-1) for label placement. Numbers without
 *   a `name` aren't rendered as labels.
 * - PIT_LOSS_SECONDS[trackId] is the estimated seconds lost in a pit stop
 *   vs. staying on-track (normal stop, not SC).
 */

export interface CornerInfo {
  num: number;
  name?: string;
  pct: number; // 0..1 along lap distance
}

// Only well-known named corners. If a track isn't listed, we draw none.
export const CORNER_NAMES: Record<number, CornerInfo[]> = {
  // Monaco
  5: [
    { num: 1,  name: 'Ste Devote',    pct: 0.08 },
    { num: 3,  name: 'Massenet',      pct: 0.18 },
    { num: 4,  name: 'Casino',        pct: 0.22 },
    { num: 6,  name: 'Grand Hotel',   pct: 0.38 },
    { num: 8,  name: 'Portier',       pct: 0.52 },
    { num: 10, name: 'Tabac',         pct: 0.63 },
    { num: 12, name: 'Piscine',       pct: 0.70 },
    { num: 15, name: 'Rascasse',      pct: 0.88 },
    { num: 16, name: 'Anthony Noghes',pct: 0.94 },
  ],
  // Silverstone
  7: [
    { num: 1,  name: 'Abbey',     pct: 0.05 },
    { num: 3,  name: 'Village',   pct: 0.12 },
    { num: 6,  name: 'Brooklands',pct: 0.23 },
    { num: 7,  name: 'Luffield',  pct: 0.28 },
    { num: 9,  name: 'Copse',     pct: 0.38 },
    { num: 10, name: 'Maggotts',  pct: 0.46 },
    { num: 11, name: 'Becketts',  pct: 0.50 },
    { num: 13, name: 'Stowe',     pct: 0.66 },
    { num: 15, name: 'Club',      pct: 0.83 },
  ],
  // Spa
  10: [
    { num: 1,  name: 'La Source', pct: 0.04 },
    { num: 3,  name: 'Eau Rouge', pct: 0.17 },
    { num: 4,  name: 'Raidillon', pct: 0.20 },
    { num: 9,  name: 'Pouhon',    pct: 0.46 },
    { num: 12, name: 'Stavelot',  pct: 0.62 },
    { num: 15, name: 'Blanchimont', pct: 0.78 },
    { num: 18, name: 'Bus Stop',  pct: 0.90 },
  ],
  // Monza
  11: [
    { num: 1,  name: 'Rettifilo',   pct: 0.07 },
    { num: 4,  name: 'Curva Grande', pct: 0.22 },
    { num: 6,  name: 'Roggia',      pct: 0.34 },
    { num: 7,  name: 'Lesmo 1',     pct: 0.40 },
    { num: 8,  name: 'Lesmo 2',     pct: 0.44 },
    { num: 10, name: 'Ascari',      pct: 0.62 },
    { num: 11, name: 'Parabolica',  pct: 0.88 },
  ],
  // Suzuka
  13: [
    { num: 2,  name: 'S Curves',  pct: 0.10 },
    { num: 6,  name: 'Dunlop',    pct: 0.24 },
    { num: 8,  name: 'Degner 1',  pct: 0.30 },
    { num: 9,  name: 'Degner 2',  pct: 0.33 },
    { num: 11, name: 'Hairpin',   pct: 0.40 },
    { num: 13, name: 'Spoon',     pct: 0.56 },
    { num: 15, name: '130R',      pct: 0.78 },
    { num: 16, name: 'Casio',     pct: 0.88 },
  ],
  // Interlagos (Brazil)
  16: [
    { num: 1,  name: 'Senna S',    pct: 0.05 },
    { num: 4,  name: 'Descida do Lago', pct: 0.28 },
    { num: 8,  name: 'Ferradura',  pct: 0.52 },
    { num: 12, name: 'Juncao',     pct: 0.82 },
  ],
  // Red Bull Ring (Austria)
  17: [
    { num: 1, name: 'Niki Lauda',   pct: 0.12 },
    { num: 3, name: 'Remus',        pct: 0.30 },
    { num: 4, name: 'Schlossgold',  pct: 0.44 },
    { num: 6, name: 'Jochen Rindt', pct: 0.70 },
    { num: 9, name: 'Red Bull Mur', pct: 0.93 },
  ],
  // Baku
  20: [
    { num: 1,  name: 'Turn 1',     pct: 0.02 },
    { num: 8,  name: 'Castle',     pct: 0.38 },
    { num: 15, name: 'Tunnel',     pct: 0.60 },
    { num: 16, name: 'Fountain',   pct: 0.66 },
  ],
  // Zandvoort
  26: [
    { num: 1,  name: 'Tarzan',      pct: 0.05 },
    { num: 3,  name: 'Hugenholtz',  pct: 0.18 },
    { num: 7,  name: 'Scheivlak',   pct: 0.46 },
    { num: 13, name: 'Arie Luyendyk', pct: 0.92 },
  ],
  // Imola
  27: [
    { num: 2,  name: 'Tamburello',  pct: 0.10 },
    { num: 4,  name: 'Villeneuve',  pct: 0.22 },
    { num: 7,  name: 'Tosa',        pct: 0.38 },
    { num: 9,  name: 'Piratella',   pct: 0.52 },
    { num: 11, name: 'Acque Minerali', pct: 0.64 },
    { num: 14, name: 'Variante Alta', pct: 0.76 },
    { num: 17, name: 'Rivazza',     pct: 0.92 },
  ],
  // Portimao
  28: [
    { num: 1,  name: 'Turn 1',     pct: 0.04 },
    { num: 5,  name: 'Craig Lowndes', pct: 0.36 },
    { num: 9,  name: 'Alan Jones', pct: 0.60 },
  ],
};

// Pit-loss estimates in seconds — rough averages from real F1 data.
export const PIT_LOSS_SECONDS: Record<number, number> = {
  0: 21,   // Melbourne
  1: 19,   // Paul Ricard
  2: 22,   // Shanghai
  3: 22,   // Bahrain
  4: 22,   // Catalunya
  5: 19,   // Monaco
  6: 20,   // Montreal
  7: 22,   // Silverstone
  8: 20,   // Hockenheim
  9: 20,   // Hungaroring
  10: 22,  // Spa
  11: 20,  // Monza
  12: 23,  // Singapore
  13: 22,  // Suzuka
  14: 22,  // Abu Dhabi
  15: 21,  // Austin
  16: 22,  // Interlagos
  17: 19,  // Red Bull Ring
  18: 24,  // Sochi
  19: 21,  // Mexico
  20: 20,  // Baku
  26: 19,  // Zandvoort
  27: 27,  // Imola (long pit entry)
  28: 19,  // Portimao
  29: 20,  // Jeddah
  30: 22,  // Miami
  31: 22,  // Las Vegas
  32: 22,  // Losail
  39: 22,  // Silverstone (Reverse)
  40: 19,  // Austria (Reverse)
  41: 19,  // Zandvoort (Reverse)
  42: 21,  // Madrid (Madring)
};

export function pitLossForTrack(trackId: number | undefined): number {
  if (trackId == null) return 22;
  return PIT_LOSS_SECONDS[trackId] ?? 22;
}

/**
 * Per-track pit-lane geometry, expressed as fractions of lap distance and
 * a side hint relative to the racing line. The TrackMap renderer
 * synthesises a curved path parallel to the racing line between
 * `entryPct` and `exitPct`, offset on the requested side.
 *
 * - `side`: `'inside'` = perpendicular pointing TOWARDS the viewBox centre
 *           `'outside'` = perpendicular pointing AWAY from the centre
 * - `entryPct`: where the pit lane diverges from the racing line (lap %)
 * - `exitPct`:  where it rejoins the racing line (lap %)
 *   If `entryPct > exitPct`, the segment wraps through start/finish.
 * - `offset`:   perpendicular distance off the racing line (viewBox units)
 */
export interface PitLaneConfig {
  side: 'inside' | 'outside';
  entryPct: number;
  exitPct: number;
  offset?: number;
}

export const PIT_LANE_CONFIG: Record<number, PitLaneConfig> = {
  0:  { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Melbourne
  3:  { side: 'inside',  entryPct: 0.95, exitPct: 0.06, offset: 14 }, // Bahrain
  4:  { side: 'inside',  entryPct: 0.95, exitPct: 0.05, offset: 14 }, // Catalunya
  5:  { side: 'inside',  entryPct: 0.97, exitPct: 0.05, offset: 12 }, // Monaco
  6:  { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Montreal
  7:  { side: 'outside', entryPct: 0.94, exitPct: 0.06, offset: 14 }, // Silverstone (right of Wellington straight)
  9:  { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Hungaroring
  10: { side: 'inside',  entryPct: 0.96, exitPct: 0.06, offset: 14 }, // Spa
  11: { side: 'outside', entryPct: 0.93, exitPct: 0.05, offset: 14 }, // Monza
  12: { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Singapore (Marina Bay)
  13: { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Suzuka
  14: { side: 'inside',  entryPct: 0.95, exitPct: 0.04, offset: 14 }, // Yas Marina
  15: { side: 'inside',  entryPct: 0.95, exitPct: 0.05, offset: 14 }, // Austin
  16: { side: 'inside',  entryPct: 0.95, exitPct: 0.04, offset: 14 }, // Interlagos
  17: { side: 'inside',  entryPct: 0.96, exitPct: 0.05, offset: 14 }, // Spielberg
  19: { side: 'inside',  entryPct: 0.95, exitPct: 0.05, offset: 14 }, // Mexico City
  20: { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Baku
  26: { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Zandvoort
  29: { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Jeddah
  30: { side: 'inside',  entryPct: 0.96, exitPct: 0.05, offset: 14 }, // Miami
  31: { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Las Vegas
  32: { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Lusail
  2:  { side: 'inside',  entryPct: 0.96, exitPct: 0.04, offset: 14 }, // Shanghai
};

export function pitLaneConfigForTrack(trackId: number | undefined): PitLaneConfig {
  if (trackId != null && PIT_LANE_CONFIG[trackId]) return PIT_LANE_CONFIG[trackId];
  return { side: 'inside', entryPct: 0.95, exitPct: 0.05, offset: 14 };
}

/**
 * Hand-traced pit-lane SVG paths, expressed in the same coordinate space
 * as the corresponding julesr0y track SVG (500x500 viewBox). When a track
 * has an entry here, TrackMap renders THIS path verbatim and skips the
 * synthesised parallel-offset curve. That's the only way to match
 * Team-Telemetry-grade accuracy because the pit lane diverges from the
 * racing line in shape, not just offset.
 *
 * Format: standard SVG path `d` attribute. Use only `M` and `L` (and
 * optionally `Q`/`C` for curved sections) — keep it simple so it renders
 * identically across browsers.
 *
 * Add a track here once the user supplies a real screenshot showing the
 * pit lane shape and we trace it onto the same viewBox.
 */
export const PIT_LANE_PATHS: Record<number, string> = {
  // 19 — Mexico City (Autodromo Hermanos Rodriguez)
  // Pit lane runs parallel & inside (below) the start/finish straight.
  // Racing line at top: from ~(68,75) up to ~(445,130). Pit ramps off
  // before T1 and rejoins just after start/finish.
  19: 'M 420 148 Q 410 165 392 164 L 130 122 Q 105 113 100 95',

  // 20 — Baku (Baku City Circuit)
  // Verified via `node scripts/dump-track-vertices.mjs 20`:
  //   • V42→V43 = main straight (296 units) = (246,272)→(461,68)
  //               direction u1 ≈ (0.726, -0.688)
  //   • V44     = T1 apex (462,52)
  //   • V44→V1  = T1→T2 short straight (50 units) = (462,52)→(427,15)
  //               direction u2 ≈ (-0.686, -0.726)
  //   • midpoint of V44→V1 = (445, 34)   ← pit-lane exit point
  // Driver-left perpendicular for each segment (SVG y-down):
  //   perp(u1) ≈ (-0.688, -0.726)   → main-straight offset is up-left
  //   perp(u2) ≈ (-0.726,  0.686)   → T1→T2 offset is left-down
  // Offset 10 units from racing line gives:
  //   • (368,141) at 63% along main straight (offset start after taper)
  //   • (454, 61) at end of main straight (V43)
  //   • (455, 59) at T1 apex on T1→T2 offset line
  //   • (438, 41) just before pit-exit merge
  // Every cubic uses tangent-based control points (d≈5 units) so every
  // junction is smooth (C1-continuous) and the entry/exit are gradual
  // tapers off and onto the racing line, not 90° joins.
  20: 'M 375 149 C 379 146 364 144 368 141 L 454 61 C 458 58 458 63 455 59 L 438 41 C 435 38 448 37 445 34',
};

export function pitLanePathForTrack(trackId: number | undefined): string | null {
  if (trackId == null) return null;
  return PIT_LANE_PATHS[trackId] ?? null;
}

export function cornersForTrack(trackId: number | undefined): CornerInfo[] {
  if (trackId == null) return [];
  return CORNER_NAMES[trackId] ?? [];
}

/** Total corner count per F1 25 track. Used to render every turn number even
 *  when only a few are named in CORNER_NAMES. */
export const TRACK_CORNER_COUNTS: Record<number, number> = {
  0: 14,  // Melbourne
  1: 15,  // Paul Ricard
  2: 16,  // Shanghai
  3: 15,  // Bahrain
  4: 14,  // Catalunya
  5: 19,  // Monaco
  6: 14,  // Montreal
  7: 18,  // Silverstone
  8: 17,  // Hockenheim
  9: 14,  // Hungaroring
  10: 19, // Spa
  11: 11, // Monza
  12: 19, // Singapore
  13: 18, // Suzuka
  14: 16, // Abu Dhabi
  15: 20, // Austin
  16: 15, // Interlagos
  17: 10, // Red Bull Ring
  18: 18, // Sochi
  19: 17, // Mexico
  20: 20, // Baku
  21: 9,  // Sakhir Short
  22: 12, // Silverstone Short
  23: 14, // Austin Short
  24: 11, // Suzuka Short
  25: 23, // Hanoi
  26: 14, // Zandvoort
  27: 19, // Imola
  28: 15, // Portimao
  29: 27, // Jeddah
  30: 19, // Miami
  31: 17, // Las Vegas
  32: 16, // Losail
  39: 18, // Silverstone (Reverse)
  40: 10, // Austria (Reverse)
  41: 14, // Zandvoort (Reverse)
  42: 22, // Madrid (Madring)
};

/**
 * Returns every turn for the track. Named corners use their precise `pct`;
 * unnamed turns are evenly distributed in the remaining lap space. So you
 * always see T1..TN labeled, with the named ones anchored where we know them.
 */
export function allCornersForTrack(trackId: number | undefined): CornerInfo[] {
  if (trackId == null) return [];
  const named = CORNER_NAMES[trackId] ?? [];
  const total = TRACK_CORNER_COUNTS[trackId] ?? named.length;
  if (total === 0) return named;
  const namedByNum = new Map(named.map((c) => [c.num, c]));
  const out: CornerInfo[] = [];
  for (let i = 1; i <= total; i++) {
    const existing = namedByNum.get(i);
    if (existing) out.push(existing);
    else out.push({ num: i, pct: (i - 0.5) / total });
  }
  return out;
}
