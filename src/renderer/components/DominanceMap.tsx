/**
 * Broadcast-style driver-dominance track map.
 *
 * Draws the circuit outline from bundled TT geometry and colours each
 * mini-sector by whichever driver (player vs rival) is faster there, using
 * each driver's team colour — the F1-TV "dominance" graphic. Two live dots
 * mark each car's current position (projected from lap distance).
 *
 * Pace data + colours come from {@link useRivalDominance}.
 */
import React, { useMemo } from 'react';
import type { DominanceData } from '../hooks/useRivalDominance';
import { nearestSampleByDistance } from '../lib/tt-tracks';

const W = 640;
const H = 420;
const PAD = 26;
const NEUTRAL = '#5b6478';
const TARGET_POINTS = 600; // decimate the ~5000-row racing line for light SVG

interface Props {
  data: DominanceData;
  playerName: string;
  rivalName: string;
}

export function DominanceMap({ data, playerName, rivalName }: Props) {
  const track = data.track;

  // Viewport transform (stable per track).
  const fit = useMemo(() => {
    if (!track) return null;
    const { minX, maxX, minZ, maxZ } = track.bbox;
    const spanX = maxX - minX || 1;
    const spanZ = maxZ - minZ || 1;
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanZ);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanZ * scale) / 2;
    return {
      tx: (x: number) => (x - minX) * scale + offX,
      ty: (z: number) => (maxZ - z) * scale + offY, // flip Z so north is up
    };
  }, [track]);

  // Outline + colored runs only change when the winners do — key on a stable
  // signature so this doesn't rebuild on every position frame.
  const winnersKey = `${data.winners.join('')}|${data.playerColor}|${data.rivalColor}`;
  const outline = useMemo(() => {
    if (!track || !fit || track.racingLine.length < 4) return null;
    const { tx, ty } = fit;
    const pts = track.racingLine;
    const dist = track.racingLineDist;
    const maxDist = dist[dist.length - 1] || 1;
    const step = Math.max(1, Math.floor(pts.length / TARGET_POINTS));
    const binOfIdx = (i: number) => {
      const b = Math.floor((dist[i] / maxDist) * data.n);
      return b < 0 ? 0 : b >= data.n ? data.n - 1 : b;
    };
    const colorFor = (w: number) => (w === 0 ? data.playerColor : w === 1 ? data.rivalColor : NEUTRAL);

    let bg = '';
    const runs: { color: string; d: string }[] = [];
    let curColor = '';
    let cur = '';
    let prev: [number, number] | null = null;
    for (let i = 0; i < pts.length; i += step) {
      const X = tx(pts[i][0]).toFixed(1);
      const Y = ty(pts[i][1]).toFixed(1);
      bg += `${i === 0 ? 'M' : 'L'} ${X} ${Y} `;
      const c = colorFor(data.winners[binOfIdx(i)]);
      if (c !== curColor) {
        if (cur) runs.push({ color: curColor, d: cur });
        cur = prev ? `M ${tx(prev[0]).toFixed(1)} ${ty(prev[1]).toFixed(1)} L ${X} ${Y} ` : `M ${X} ${Y} `;
        curColor = c;
      } else {
        cur += `L ${X} ${Y} `;
      }
      prev = pts[i];
    }
    if (cur) runs.push({ color: curColor, d: cur });
    return { bg, runs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, fit, winnersKey, data.n]);

  // Dots follow live position (cheap, recomputed each frame).
  const dots = useMemo(() => {
    if (!track || !fit) return { player: null, rival: null };
    const dot = (distM: number) => {
      if (distM < 0) return null;
      const s = nearestSampleByDistance(track, distM * 100); // metres → TT cm
      return { cx: fit.tx(s.point[0]), cy: fit.ty(s.point[1]) };
    };
    return { player: dot(data.playerDistM), rival: dot(data.rivalDistM) };
  }, [track, fit, data.playerDistM, data.rivalDistM]);

  if (!data.available || !outline) {
    return (
      <div className="panel" style={{ textAlign: 'center', padding: 24 }}>
        <h3 className="panel-title">TRACK DOMINANCE</h3>
        <p className="dim">No bundled track map for this circuit yet.</p>
      </div>
    );
  }

  const pct = Math.round(data.coverage * 100);

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="panel-title" style={{ margin: 0 }}>TRACK DOMINANCE</h3>
        <span className="dim" style={{ fontSize: 11 }}>
          {pct < 100 ? `building… ${pct}%` : 'fastest per mini-sector'}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <path d={outline.bg} stroke="#23293a" strokeWidth={9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {outline.runs.map((r, i) => (
          <path key={i} d={r.d} stroke={r.color} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {dots.rival && (
          <circle cx={dots.rival.cx} cy={dots.rival.cy} r={7} fill={data.rivalColor} stroke="#0b0e16" strokeWidth={2} />
        )}
        {dots.player && (
          <circle cx={dots.player.cx} cy={dots.player.cy} r={7} fill={data.playerColor} stroke="#ffffff" strokeWidth={2} />
        )}
      </svg>

      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 6, fontSize: 12 }}>
        <Legend color={data.playerColor} label={`${playerName} (you)`} ring="#ffffff" />
        <Legend color={data.rivalColor} label={rivalName} ring="#0b0e16" />
      </div>
    </div>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, border: `2px solid ${ring}`, display: 'inline-block' }} />
      <span>{label}</span>
    </span>
  );
}
