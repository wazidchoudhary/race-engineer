import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { usePrefs } from '../context/PrefsContext';
import { applyNameMasks } from '../lib/name-mask';
import {
  allCornersForTrack, pitLossForTrack, pitLaneConfigForTrack,
} from '../lib/corner-data';
import { loadTrackSvg, hasTrackSvg } from '../lib/track-svg-loader';
import { api, type TrackTrace } from '../lib/tauri-api';
import {
  hasTtTrack, loadTtTrack, listTtTracks, nearestSampleByDistance,
  nearestPitSampleByDistance, type TtTrack,
} from '../lib/tt-tracks';
import CIRCUITS from '../../circuits.js';
import { teamColor } from '../lib/team-colors';

const MAX_ERS = 4_000_000;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }


export function TrackMap() {
  const {
    session, lapData, participants, allCarStatus, status, playerCarIndex,
    rivalCarIndex, motion, slot,
  } = useTelemetryContext();
  const {
    driverNameMasks,
    trackmapZoom, trackmapRotation, trackmapShowCorners, trackmapShowPitExit,
    setPrefs,
  } = usePrefs();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [zoom, setZoomLocal] = useState(trackmapZoom);
  const [rotation, setRotationLocal] = useState(trackmapRotation);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showCorners, setShowCornersLocal] = useState(trackmapShowCorners);
  const [showPitExit, setShowPitExitLocal] = useState(trackmapShowPitExit);
  const [pitLossOverride, setPitLossOverride] = useState<number | null>(null);

  // ── Recorded-trace support ────────────────────────────────────────────
  const [trace, setTrace] = useState<TrackTrace | null>(null);
  const [recordState, setRecordState] = useState<'idle' | 'armed' | 'saved'>('idle');

  // ── TT data — bundled with the app ────────────────────────────────────
  // Racing line + pit lane for every supported track ship in the repo
  // (see src/renderer/assets/tt-tracks/README.md for attribution).
  // TT stores world coords in cm (1 unit = 1 cm); F1 25's UDP motion
  // packet is in metres, so the scale is fixed at 100. The world ORIGIN
  // can differ per track between F1's internal coords and what TT
  // recorded, so we derive a constant offset on the first valid frame.
  const ttTransformRef = useRef<{ scale: number; offsetX: number; offsetZ: number } | null>(null);
  const TT_SCALE = 100;

  // Browse-mode preview: when set, the dropdown overrides the live
  // session and we render that track's TT data with no cars (the live
  // motion stream isn't for that track). `null` = follow live session.
  const [previewTrackId, setPreviewTrackId] = useState<number | null>(null);
  const ttTrackList = useMemo(() => listTtTracks(), []);
  const effectiveTrackId = previewTrackId ?? session?.trackId ?? null;
  const isPreviewing = previewTrackId !== null && previewTrackId !== session?.trackId;

  // ttData is derived synchronously from the effective track id. Using
  // useMemo (not useState+useEffect) avoids a render where the skeleton
  // effect sees the new trackId but the OLD ttData — which would draw
  // the previous track's shape under the new track's bbox.
  const ttData = useMemo<TtTrack | null>(() => {
    if (effectiveTrackId == null || !hasTtTrack(effectiveTrackId)) return null;
    return loadTtTrack(effectiveTrackId);
  }, [effectiveTrackId]);

  // Reset transform on track change so the next track re-derives its offset
  useEffect(() => { ttTransformRef.current = null; }, [effectiveTrackId]);

  // Load any previously-saved trace for the active track
  useEffect(() => {
    let cancelled = false;
    const tid = session?.trackId;
    if (tid == null) { setTrace(null); return; }
    api.loadTrackTrace(tid)
      .then((t) => { if (!cancelled) setTrace(t ?? null); })
      .catch(() => { if (!cancelled) setTrace(null); });
    return () => { cancelled = true; };
  }, [session?.trackId, recordState]);

  const armRecording = useCallback(async () => {
    try {
      const r = await api.startTrackTrace(slot);
      if (r.success) setRecordState('armed');
    } catch (e) { console.error('startTrackTrace:', e); }
  }, [slot]);
  const cancelRecording = useCallback(async () => {
    try { await api.stopTrackTrace(slot); } catch { /* ignore */ }
    setRecordState('idle');
  }, [slot]);

  // persist layout on change (coalesced via React batching)
  const setZoom = useCallback((fnOrVal: number | ((z: number) => number)) => {
    setZoomLocal((prev) => {
      const n = typeof fnOrVal === 'function' ? (fnOrVal as any)(prev) : fnOrVal;
      setPrefs({ trackmapZoom: n });
      return n;
    });
  }, [setPrefs]);
  const setRotation = useCallback((fnOrVal: number | ((r: number) => number)) => {
    setRotationLocal((prev) => {
      const n = typeof fnOrVal === 'function' ? (fnOrVal as any)(prev) : fnOrVal;
      setPrefs({ trackmapRotation: n });
      return n;
    });
  }, [setPrefs]);
  const setShowCorners = useCallback((v: boolean) => {
    setShowCornersLocal(v); setPrefs({ trackmapShowCorners: v });
  }, [setPrefs]);
  const setShowPitExit = useCallback((v: boolean) => {
    setShowPitExitLocal(v); setPrefs({ trackmapShowPitExit: v });
  }, [setPrefs]);

  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const sortedCars = useMemo(() => {
    if (!lapData || lapData.length === 0) return [];
    return lapData
      .map((lap, idx) => ({ lap, idx }))
      .filter(c => c.lap && c.lap.resultStatus >= 2)
      .sort((a, b) => (a.lap.carPosition || 999) - (b.lap.carPosition || 999));
  }, [lapData]);

  const trackId = session?.trackId;
  const pitLossSec = pitLossOverride ?? pitLossForTrack(trackId);
  const corners = useMemo(() => showCorners ? allCornersForTrack(trackId) : [], [trackId, showCorners]);

  // Build SVG skeleton once per track change. Runs even without an
  // active F1 25 session, as long as we have a track to display
  // (either the live session or a browse-mode preview).
  useEffect(() => {
    if (!containerRef.current) return;
    const tid = effectiveTrackId;
    if (tid == null) return;

    // Track-shape data sources, in priority order:
    //   1. Team Telemetry 25 import (loaded from user's local TT install).
    //   2. Recorded lap trace from the player's own lap at this track.
    //   3. julesr0y SVG (clean 2026 layouts).
    //   4. bacinger GeoJSON (fallback).
    let circuit: { viewBox: string; path: string; pitPath?: string } | null = null;

    if (ttData && ttData.racingLine.length > 4) {
      // Combine racing-line bbox with pit-lane bbox so the pit lane (which
      // can stick out well past the racing line on city circuits) isn't
      // clipped off the visible area.
      let { minX, maxX, minZ, maxZ } = ttData.bbox;
      for (const [x, z] of ttData.pitLane) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const pad = Math.max(maxX - minX, maxZ - minZ) * 0.05;
      const vbX = minX - pad;
      const vbZ = minZ - pad;
      const vbW = (maxX - minX) + pad * 2;
      const vbH = (maxZ - minZ) + pad * 2;
      const d = ttData.racingLine
        .map(([x, z], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${z.toFixed(2)}`)
        .join(' ') + ' Z';
      const pitPath = ttData.pitLane && ttData.pitLane.length > 1
        ? ttData.pitLane.map(([x, z], i) =>
            `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${z.toFixed(2)}`).join(' ')
        : undefined;
      circuit = { viewBox: `${vbX} ${vbZ} ${vbW} ${vbH}`, path: d, pitPath };
    } else if (trace && trace.trackId === tid && trace.samples.length > 4) {
      const { minX, maxX, minZ, maxZ } = trace.bbox;
      const pad = Math.max(maxX - minX, maxZ - minZ) * 0.05;
      const vbX = minX - pad;
      const vbZ = minZ - pad;
      const vbW = (maxX - minX) + pad * 2;
      const vbH = (maxZ - minZ) + pad * 2;
      const d = trace.samples
        .map(([x, z], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${z.toFixed(2)}`)
        .join(' ') + ' Z';
      circuit = { viewBox: `${vbX} ${vbZ} ${vbW} ${vbH}`, path: d };
    } else {
      const fromSvg = hasTrackSvg(tid) ? loadTrackSvg(tid) : null;
      const fromGeo = (CIRCUITS as any)[tid] ?? null;
      circuit = fromSvg
        ? { viewBox: fromSvg.viewBox, path: fromSvg.racingLine }
        : fromGeo;
    }

    if (!circuit) {
      containerRef.current.innerHTML = '<div class="trackmap-no-data">No circuit map available for this track</div>';
      svgRef.current = null;
      return;
    }

    let svg = containerRef.current.querySelector('svg') as SVGSVGElement | null;
    if (!svg || svg.dataset.trackId !== String(tid)) {
      containerRef.current.innerHTML = '';
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      svg.setAttribute('viewBox', circuit.viewBox);
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.dataset.trackId = String(tid);

      // Stroke widths must scale to the viewBox. julesr0y SVGs use a
      // 500×500 viewBox and were tuned with 12/8/3 px strokes (~2.4 %
      // of the viewBox dimension). TT data is in cm — viewBoxes can be
      // 30k–80k units wide. A fixed 12-unit stroke would be sub-pixel.
      const vbParts = circuit.viewBox.split(/\s+/).map(Number);
      const vbExtent = Math.max(vbParts[2] || 500, vbParts[3] || 500);
      const SW_BG     = vbExtent * 0.024;      // ≈ 12 / 500
      const SW_REF    = vbExtent * 0.016;
      const SW_SECTOR = vbExtent * 0.016;
      const SW_PIT_BG = vbExtent * 0.0075;     // pit lane thinner
      const SW_PIT    = vbExtent * 0.0035;
      const PIT_DASH  = `${vbExtent * 0.008} ${vbExtent * 0.006}`;

      // Root group for zoom/rotate/pan transform
      const gRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gRoot.id = 'trackmap-root';
      svg.appendChild(gRoot);

      // Subtle outer kerb (slim, dark)
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      bg.setAttribute('d', circuit.path);
      bg.setAttribute('stroke', '#2e3447');
      bg.setAttribute('stroke-width', String(SW_BG));
      bg.setAttribute('fill', 'none');
      bg.setAttribute('stroke-linecap', 'round');
      bg.setAttribute('stroke-linejoin', 'round');
      gRoot.appendChild(bg);

      // The reference path used for getPointAtLength / overlays
      const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      overlay.setAttribute('d', circuit.path);
      overlay.setAttribute('stroke', 'transparent');
      overlay.setAttribute('stroke-width', String(SW_REF));
      overlay.setAttribute('fill', 'none');
      overlay.id = 'track-path-ref';
      gRoot.appendChild(overlay);

      // Sector overlays — three pastel segments along the lap
      containerRef.current.appendChild(svg);
      const totalLen = overlay.getTotalLength();
      const segLen = totalLen / 3;
      const sectors: Array<{ color: string; offset: number; cls: string }> = [
        { color: '#ff9090', offset: 0,           cls: 'tm-sec1' },
        { color: '#ffd96b', offset: -segLen,     cls: 'tm-sec2' },
        { color: '#7dc8ff', offset: -2 * segLen, cls: 'tm-sec3' },
      ];
      for (const s of sectors) {
        const seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        seg.setAttribute('d', circuit.path);
        seg.setAttribute('stroke', s.color);
        seg.setAttribute('stroke-width', String(SW_SECTOR));
        seg.setAttribute('fill', 'none');
        seg.setAttribute('stroke-linecap', 'butt');
        seg.setAttribute('stroke-linejoin', 'round');
        seg.setAttribute('stroke-dasharray', `${segLen} ${totalLen}`);
        seg.setAttribute('stroke-dashoffset', String(s.offset));
        seg.classList.add(s.cls);
        // Insert beneath the reference path so dots/labels stay on top
        gRoot.insertBefore(seg, overlay);
      }
      // If we got a TT pit lane path, draw it as part of the static
      // skeleton (NOT the per-frame layer). Class `pit-lane-static` keeps
      // it out of the dynamic-cleanup selector, so it stays put across
      // every render until the track changes.
      if ((circuit as any).pitPath) {
        const pitBg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pitBg.setAttribute('d', (circuit as any).pitPath);
        pitBg.setAttribute('stroke', '#0c0c14');
        pitBg.setAttribute('stroke-width', String(SW_PIT_BG));
        pitBg.setAttribute('fill', 'none');
        pitBg.setAttribute('stroke-linecap', 'round');
        pitBg.classList.add('pit-lane-static');
        gRoot.appendChild(pitBg);
        const pit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pit.setAttribute('d', (circuit as any).pitPath);
        pit.setAttribute('stroke', '#e8eaf2');
        pit.setAttribute('stroke-width', String(SW_PIT));
        pit.setAttribute('fill', 'none');
        pit.setAttribute('stroke-linecap', 'round');
        pit.setAttribute('stroke-dasharray', PIT_DASH);
        pit.setAttribute('opacity', '0.85');
        pit.classList.add('pit-lane-static');
        gRoot.appendChild(pit);
      }

      svgRef.current = svg;
    }
  }, [effectiveTrackId, trace, ttData]);

  // Apply zoom/rotate/pan to root group whenever they change
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const root = svg.querySelector('#trackmap-root') as SVGGElement | null;
    if (!root) return;
    const vb = svg.viewBox.baseVal;
    const cx = vb.x + vb.width / 2;
    const cy = vb.y + vb.height / 2;
    // TT ships a per-track Rotate (Monaco=59°, Monza=170°, etc.) so the
    // raw worldX/Z layout displays correctly oriented. Combine it with
    // the user's manual rotation around the same centre.
    const ttRotate = Number(ttData?.settings?.Rotate) || 0;
    const totalRot = rotation + ttRotate;
    root.setAttribute(
      'transform',
      `translate(${pan.x} ${pan.y}) rotate(${totalRot} ${cx} ${cy}) translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})`,
    );
  }, [zoom, rotation, pan, ttData]);

  // Render dynamic overlays (dots, corners, pit-exit) on every update
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !session || !lapData || lapData.length === 0) return;
    const root = svg.querySelector('#trackmap-root') as SVGGElement | null;
    const pathEl = svg.querySelector('#track-path-ref') as SVGPathElement | null;
    if (!root || !pathEl) return;

    const totalLen = pathEl.getTotalLength();
    const trackLen = session.trackLength || 1;

    // Remove DYNAMIC overlays only (cars, labels, pit-exit ghost,
    // synthesised pit lane). The TT pit lane lives in the static
    // skeleton with class `pit-lane-static` and must NOT be touched
    // here — otherwise the real TT geometry gets wiped every frame
    // and the synthesised parallel-offset curve replaces it.
    root.querySelectorAll(
      '.car-dot, .car-label, .car-name-label, .car-fx, .corner-label, .pit-exit-marker, .pit-lane-dyn'
    ).forEach((n) => n.remove());

    // (Corner labels removed — the auto-detected positions never matched
    // the real F1 turn numbering well enough to be useful. The
    // PIT_LANE_CONFIG, sector colors and SVG itself convey enough.)
    const vbBox = svg.viewBox.baseVal;
    const cxView = vbBox.x + vbBox.width / 2;
    const cyView = vbBox.y + vbBox.height / 2;
    // Per-frame size scale matching the static skeleton: julesr0y SVGs
    // were 500×500, dots/labels were tuned for that. TT viewBoxes can
    // be 100× larger, so all dot radii / label fontsizes need to scale
    // proportionally to stay visible.
    const vbExtentR = Math.max(vbBox.width, vbBox.height);
    const K = vbExtentR / 500;

    // Pit-exit ghost dot — where PLAYER would be after a pit right now
    const playerLap = lapData[playerCarIndex];
    const playerBest = playerLap?.lastLapTimeMs || 90000;
    if (showPitExit && playerLap && playerBest > 0) {
      const avgSpeedMps = trackLen / (playerBest / 1000);
      const ghostDist = (playerLap.lapDistance || 0) + pitLossSec * avgSpeedMps;
      let norm = ghostDist % trackLen; if (norm < 0) norm += trackLen;
      const pt = pathEl.getPointAtLength((norm / trackLen) * totalLen);
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', String(pt.x));
      ring.setAttribute('cy', String(pt.y));
      ring.setAttribute('r', String(7 * K));
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#dc0000');
      ring.setAttribute('stroke-width', String(1.5 * K));
      ring.setAttribute('stroke-dasharray', `${2 * K} ${2 * K}`);
      ring.classList.add('pit-exit-marker');
      root.appendChild(ring);
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(pt.x));
      dot.setAttribute('cy', String(pt.y));
      dot.setAttribute('r', String(3 * K));
      dot.setAttribute('fill', '#dc0000');
      dot.classList.add('pit-exit-marker');
      root.appendChild(dot);
    }

    // ── Pit lane ─────────────────────────────────────────────────────
    // When TT data is the source, the real pit-lane geometry (Box CSV)
    // is already drawn in the static skeleton with class
    // `.pit-lane-static`. We render NOTHING here in that case — the
    // synthesised PIT_LANE_CONFIG offset-curve was always wrong relative
    // to TT's actual recorded pit lane and would just overwrite it.
    //
    // For tracks WITHOUT TT data (Paul Ricard, Hockenheim, etc.), fall
    // back to the synthesised parallel-offset curve as a best-effort.
    const haveTtForPit = !!ttData;
    let pitFallbackPts: { x: number; y: number }[] = [];
    let pitFallbackNx0 = 0, pitFallbackNy0 = 1;
    if (!haveTtForPit) {
      const pitCfg = pitLaneConfigForTrack(session.trackId);
      const pitOffset = pitCfg.offset ?? 14;
      const segLenPct = pitCfg.entryPct > pitCfg.exitPct
        ? (1 - pitCfg.entryPct) + pitCfg.exitPct
        : pitCfg.exitPct - pitCfg.entryPct;
      const PIT_SAMPLES = 48;
      const rawSamples: { x: number; y: number }[] = [];
      const tangents: { tx: number; ty: number }[] = [];
      for (let i = 0; i <= PIT_SAMPLES; i++) {
        const t = (pitCfg.entryPct + (i / PIT_SAMPLES) * segLenPct) % 1;
        const lt = t * totalLen;
        const here = pathEl.getPointAtLength(lt);
        const ahead = pathEl.getPointAtLength((lt + 6) % totalLen);
        const tx = ahead.x - here.x, ty = ahead.y - here.y;
        const tm = Math.hypot(tx, ty) || 1;
        rawSamples.push(here);
        tangents.push({ tx: tx / tm, ty: ty / tm });
      }
      const midIdx = Math.floor(rawSamples.length / 2);
      const midPt = rawSamples[midIdx];
      const midT = tangents[midIdx];
      const midN1x = -midT.ty, midN1y = midT.tx;
      const midDot = (midPt.x - cxView) * midN1x + (midPt.y - cyView) * midN1y;
      const wantOutside = pitCfg.side === 'outside';
      const useN1 = wantOutside ? midDot >= 0 : midDot < 0;
      const sign = useN1 ? 1 : -1;
      pitFallbackPts = rawSamples.map((p, i) => {
        const t = tangents[i];
        const nx = -t.ty * sign;
        const ny =  t.tx * sign;
        const u = i / PIT_SAMPLES;
        const eased = u < 0.15 ? (u / 0.15) : u > 0.85 ? ((1 - u) / 0.15) : 1;
        return { x: p.x + nx * pitOffset * eased, y: p.y + ny * pitOffset * eased };
      });
      pitFallbackNx0 = -midT.ty * sign;
      pitFallbackNy0 =  midT.tx * sign;
      const pitD = pitFallbackPts
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' ');
      const pitLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pitLine.setAttribute('d', pitD);
      pitLine.setAttribute('stroke', '#e8eaf2');
      pitLine.setAttribute('stroke-width', '2');
      pitLine.setAttribute('fill', 'none');
      pitLine.setAttribute('stroke-linecap', 'round');
      pitLine.setAttribute('stroke-linejoin', 'round');
      pitLine.setAttribute('stroke-dasharray', '5 4');
      pitLine.setAttribute('opacity', '0.85');
      pitLine.classList.add('pit-lane-dyn');
      root.appendChild(pitLine);
    }
    // Aliases used by the in-pit-car fallback path below
    const pitPts = pitFallbackPts;
    const nx0 = pitFallbackNx0;
    const ny0 = pitFallbackNy0;


    // Car dots
    // Show every car that's in the session (resultStatus >= 2 = Active or
    // beyond). Includes garage cars (driverStatus === 0). Team Telemetry
    // shows them at their physical garage spot via live worldPosition;
    // we do the same.
    const visibleCars = lapData
      .map((lap, idx) => ({ lap, idx }))
      .filter((c) => c.lap && c.lap.resultStatus >= 2);

    let pitSlot = 0;
    // Distance perpendicular to the track on the right (driver-right) side
    // where the name floats. ~track-stroke-half + a little padding.
    const NAME_OFFSET = 18;

    // Car-positioning modes (priority order):
    //   • TT       — transform F1 motion → TT-coord space using a scale +
    //                offset derived ONCE from path-length / track-length
    //                and one player-motion sample. Instant, no warm-up.
    //   • trace    — recorded lap trace (legacy fallback, raw worldX/Z).
    //   • lap-dist — projection along the bundled SVG path.
    //
    // When the user is BROWSING a track that isn't the live session,
    // the motion stream belongs to a different circuit — so suppress
    // car rendering entirely (cars would land at random TT-cm coords).
    const liveTrackMatches = !isPreviewing;
    const haveTt = !!(ttData && motion?.length && liveTrackMatches);
    const haveTrace = !!(
      trace && trace.trackId === session.trackId && motion?.length >= visibleCars.length && liveTrackMatches
    );

    // Derive the per-track offset ONCE per track. The transform is a
    // CONSTANT relationship between F1's worldPosition origin and TT's
    // recording origin per track — re-deriving every frame would shift
    // all dots whenever the player drives slightly off the racing line.
    //
    // Strict derivation conditions to avoid bad samples:
    //   • pitStatus === 0  (not in pit lane / pit area — otherwise motion
    //                       is laterally offset from the racing line)
    //   • lapDistance > 200 m  (past pit exit on every track)
    //   • driverStatus on-track (1=Flying, 3=OutLap, 4=OnTrack)
    // If derivation never succeeds, we fall back to identity offset.
    if (haveTt && !ttTransformRef.current) {
      const m = motion[playerCarIndex];
      const lap = lapData[playerCarIndex];
      const validMotion = m && Number.isFinite(m.x) && Number.isFinite(m.z) &&
        !(m.x === 0 && m.z === 0);
      const onTrack = lap && lap.pitStatus === 0 &&
        (lap.driverStatus === 1 || lap.driverStatus === 3 || lap.driverStatus === 4);
      if (validMotion && lap && onTrack && lap.lapDistance > 200) {
        const targetCm = lap.lapDistance * TT_SCALE;
        const { point } = nearestSampleByDistance(ttData!, targetCm);
        const offsetX = point[0] - m.x * TT_SCALE;
        const offsetZ = point[1] - m.z * TT_SCALE;
        ttTransformRef.current = { scale: TT_SCALE, offsetX, offsetZ };
        // eslint-disable-next-line no-console
        console.log('[TrackMap] derived transform', {
          trackId: session?.trackId,
          playerLapDist_m: lap.lapDistance,
          playerMotion: { x: m.x, z: m.z },
          ttPointAtLapDist: { x: point[0], z: point[1] },
          offsetX, offsetZ, scale: TT_SCALE,
        });
      }
    }
    // Fall back to identity-offset transform so cars render even before
    // a derivation succeeds (otherwise they'd land outside the TT-cm
    // viewBox and never appear).
    const ttTx = haveTt
      ? (ttTransformRef.current ?? { scale: TT_SCALE, offsetX: 0, offsetZ: 0 })
      : null;
    const positionByMotion = haveTrace || haveTt;

    visibleCars.forEach(({ lap, idx }) => {
      const inPit = lap.pitStatus > 0;
      let cx: number, cy: number;
      // Track-tangent at the car's position. Used to compute the
      // perpendicular "right side" the name floats off of.
      let nx = 0, ny = 1;

      // PRIMARY positioning: live worldX/Z from Motion packet, regardless
      // of pitStatus. F1's `worldPosition` is the truth — it's correct
      // whether the car is in the garage, on pit lane, or on track. The
      // synthesised pit-row stacking only kicks in when there's NO motion
      // data and no TT data (legacy fallback).
      const m = positionByMotion ? motion[idx] : undefined;
      const motionValid = !!(m && Number.isFinite(m.x) && Number.isFinite(m.z) &&
        !(m.x === 0 && m.z === 0));

      // Pit-area positioning. Two distinct cases:
      //   In pit-lane TRANSIT — actively driving the pit lane (entry →
      //     through → exit). F1's `pitStatus` lags behind reality
      //     (it stays 0 for a moment after the driver crosses the pit
      //     entry line, and flips back to 0 BEFORE they fully exit),
      //     so we treat `pitLaneTimerActive === 1` as the canonical
      //     "in pit lane" signal. Snap the dot onto the Box CSV by
      //     lapDistance so it smoothly traces the dashed pit line.
      //   pitStatus === 2 — parked in pit box / garage.
      //     ALWAYS distribute along the Box CSV by carIndex, never by
      //     live motion. F1 25's motion stream is unreliable for parked
      //     cars: at session start it's (0,0,0), and the moment any car
      //     enters the pit lane the engine wakes up motion for parked
      //     cars too — but reports them at a default position on the
      //     racing line (not their actual garage spot), making the whole
      //     pack jump down to start/finish. Sticking to carIndex spread
      //     keeps every parked car at a stable, distinct slot in the
      //     pit area regardless of motion-stream behaviour.
      const inPitLaneTransit =
        lap.pitStatus === 1 ||
        (lap.pitLaneTimerActive === 1 && lap.pitStatus !== 2);
      let snappedToPit = false;
      if (haveTt && inPitLaneTransit && lap.lapDistance > 0) {
        const targetCm = lap.lapDistance * TT_SCALE;
        const pitSnap = nearestPitSampleByDistance(ttData!, targetCm);
        if (pitSnap) {
          cx = pitSnap.point[0];
          cy = pitSnap.point[1];
          snappedToPit = true;
          const next = ttData!.pitLane[(pitSnap.idx + 1) % ttData!.pitLane.length];
          const tx = next[0] - cx, ty = next[1] - cy;
          const mag = Math.hypot(tx, ty) || 1;
          nx = -ty / mag; ny = tx / mag;
        }
      } else if (haveTt && lap.pitStatus === 2) {
        const pl = ttData!.pitLane;
        if (pl.length > 4) {
          const slot = ((idx % 22) + 0.5) / 22;
          const i = Math.floor(slot * pl.length);
          cx = pl[i][0];
          cy = pl[i][1];
          snappedToPit = true;
          const next = pl[(i + 1) % pl.length];
          const tx = next[0] - cx, ty = next[1] - cy;
          const mag = Math.hypot(tx, ty) || 1;
          nx = -ty / mag; ny = tx / mag;
        }
      }

      if (!snappedToPit && motionValid && m) {
        if (haveTt && ttTx) {
          cx = m.x * ttTx.scale + ttTx.offsetX;
          cy = m.z * ttTx.scale + ttTx.offsetZ;
        } else {
          cx = m.x;
          cy = m.z;
        }
        // Approximate tangent by nearest-ahead reference sample
        const refSamples: [number, number][] | undefined =
          haveTt ? ttData!.racingLine
                 : haveTrace ? trace!.samples : undefined;
        if (refSamples && refSamples.length > 4) {
          let bestI = 0, bestD = Infinity;
          for (let i = 0; i < refSamples.length; i++) {
            const [sx, sz] = refSamples[i];
            const d2 = (sx - cx) ** 2 + (sz - cy) ** 2;
            if (d2 < bestD) { bestD = d2; bestI = i; }
          }
          const [ax, az] = refSamples[(bestI + 4) % refSamples.length];
          const tx = ax - cx, ty = az - cy;
          const mag = Math.hypot(tx, ty) || 1;
          nx = -ty / mag; ny = tx / mag;
        }
      } else if (inPit && pitPts.length > 0) {
        // Legacy fallback ONLY for SVG-mode tracks (no TT data, no motion)
        const slotIdx = Math.min(pitSlot, pitPts.length - 1);
        cx = pitPts[slotIdx].x;
        cy = pitPts[slotIdx].y;
        pitSlot += 1;
        nx = nx0; ny = ny0;
      } else {
        let dist = Number.isFinite(lap.lapDistance) ? lap.lapDistance : lap.totalDistance;
        if (!Number.isFinite(dist)) dist = 0;
        let norm = dist % trackLen;
        if (norm < 0) norm += trackLen;
        const progress = clamp(norm / trackLen, 0, 1);
        const lenAt = progress * totalLen;
        const pt = pathEl.getPointAtLength(lenAt);
        cx = pt.x; cy = pt.y;

        // Tangent: sample a tiny bit ahead along the path. Wrap at the end.
        const aheadLen = (lenAt + 6) % totalLen;
        const ahead = pathEl.getPointAtLength(aheadLen);
        const tx = ahead.x - cx;
        const ty = ahead.y - cy;
        const m = Math.hypot(tx, ty) || 1;
        // Driver-right perpendicular in SVG (y-down): (-ty, tx)
        nx = -ty / m;
        ny =  tx / m;
      }

      const p = participants?.participants?.[idx];
      const color = teamColor(p?.teamId ?? -1);
      const isPlayer = idx === playerCarIndex;
      const isRival = idx === rivalCarIndex;
      const fullName = applyNameMasks(p?.name || `Car ${idx + 1}`, driverNameMasks);

      // ── Car dot ────────────────────────────────────────────────────
      // Sizes scale with viewBox extent (K) so dots stay visible
      // regardless of whether we're rendering a 500-unit julesr0y SVG
      // or a 50000-unit TT-coord viewBox.
      const dotR = (isPlayer || isRival ? 9.9 : 7.2) * K;
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', String(dotR));
      dot.setAttribute('fill', color);
      dot.setAttribute('stroke', isPlayer ? '#ffffff' : isRival ? '#ff7a00' : '#0c0c14');
      dot.setAttribute('stroke-width', String((isPlayer || isRival ? 2.2 : 1) * K));
      dot.setAttribute('opacity', inPit ? '0.85' : '1');
      dot.classList.add('car-dot');
      root.appendChild(dot);

      // Position number inside the dot
      const posLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      posLabel.setAttribute('x', String(cx));
      posLabel.setAttribute('y', String(cy + dotR * 0.38));
      posLabel.setAttribute('text-anchor', 'middle');
      posLabel.setAttribute('fill', '#0c0c14');
      posLabel.setAttribute('font-size', String(dotR * 0.95));
      posLabel.setAttribute('font-weight', '900');
      posLabel.classList.add('car-label');
      posLabel.textContent = String(lap.carPosition || '');
      root.appendChild(posLabel);

      // ── Lap-state badge on top of the dot (Qualifying clarity) ─────
      // driverStatus: 0=Garage, 1=FlyingLap, 2=InLap, 3=OutLap, 4=OnTrack
      // We treat a flying lap as "aborted" (no fire) when:
      //   • currentLapInvalid === 1 (lap got invalidated — went off,
      //     cut a corner, etc.), OR
      //   • pitStatus > 0 (driver heading to the pits during what was
      //     a flying lap — gave up on the lap).
      let stateGlyph = '';
      let stateColor = '';
      let glow = false;
      const aborted =
        lap.driverStatus === 1 &&
        (lap.currentLapInvalid === 1 || lap.pitStatus > 0);
      switch (lap.driverStatus) {
        case 1:
          if (!aborted) {
            stateGlyph = '🔥'; stateColor = '#ff7a00'; glow = true;
          }
          break;
        case 2: stateGlyph = '↓';  stateColor = '#ff6464'; break;              // in-lap
        case 3: stateGlyph = '↑';  stateColor = '#7dff7d'; break;              // out-lap
        default: break;
      }

      if (glow) {
        const aura = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        aura.setAttribute('cx', String(cx));
        aura.setAttribute('cy', String(cy));
        aura.setAttribute('r', String(dotR + 4 * K));
        aura.setAttribute('fill', 'none');
        aura.setAttribute('stroke', stateColor);
        aura.setAttribute('stroke-width', String(1.6 * K));
        aura.setAttribute('opacity', '0.85');
        aura.classList.add('car-fx', 'car-fx-flying');
        root.appendChild(aura);
      }

      if (stateGlyph) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('x', String(cx));
        badge.setAttribute('y', String(cy - dotR - 2 * K));
        badge.setAttribute('text-anchor', 'middle');
        badge.setAttribute('fill', stateColor);
        badge.setAttribute('font-size', String(9 * K));
        badge.setAttribute('font-weight', '900');
        badge.classList.add('car-fx');
        badge.textContent = stateGlyph;
        root.appendChild(badge);
      }

      // ── 3-letter name pill sticky on top of the dot ─────────────────
      // Style matches Team Telemetry: dark pill, white text, vertical
      // team-color bar on the LEFT. All sizes scale by K.
      const shortName =
        fullName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
          || `C${idx + 1}`;
      const fontSize = (isPlayer || isRival ? 11 : 10) * K;
      const padX = 4 * K;
      const padY = 2 * K;
      const barW = 2 * K;
      const textW = shortName.length * fontSize * 0.62;
      const pillW = textW + padX * 2 + barW + 2 * K;
      const pillH = fontSize + padY * 2 + 1 * K;

      // Top of the dot, with a small gap. Lap-state badge (🔥/↑/↓) lives
      // higher up; pill goes between it and the dot.
      const gap = 4 * K;
      const pillX = cx - pillW / 2;
      const pillY = cy - dotR - gap - pillH;

      const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      pill.setAttribute('x', String(pillX));
      pill.setAttribute('y', String(pillY));
      pill.setAttribute('width', String(pillW));
      pill.setAttribute('height', String(pillH));
      pill.setAttribute('rx', String(2 * K));
      pill.setAttribute('fill', 'rgba(8, 10, 20, 0.92)');
      pill.setAttribute('stroke',
        isPlayer ? '#ffffff' : isRival ? '#ff7a00' : 'none');
      pill.setAttribute('stroke-width', String((isPlayer || isRival ? 1 : 0) * K));
      pill.classList.add('car-label', 'car-name-pill');
      root.appendChild(pill);

      // Team-color vertical bar on the left
      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bar.setAttribute('x', String(pillX + 1.5 * K));
      bar.setAttribute('y', String(pillY + 1.5 * K));
      bar.setAttribute('width', String(barW));
      bar.setAttribute('height', String(pillH - 3 * K));
      bar.setAttribute('rx', String(0.5 * K));
      bar.setAttribute('fill', color);
      bar.classList.add('car-label');
      root.appendChild(bar);

      const nameLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      nameLabel.setAttribute('x', String(pillX + barW + padX + 2 * K));
      nameLabel.setAttribute('y', String(pillY + pillH - padY - 1.5 * K));
      nameLabel.setAttribute('text-anchor', 'start');
      nameLabel.setAttribute('fill', '#ffffff');
      nameLabel.setAttribute('font-size', String(fontSize));
      nameLabel.setAttribute('font-weight', '700');
      nameLabel.setAttribute('font-family',
        '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif');
      nameLabel.setAttribute('letter-spacing', String(0.5 * K));
      nameLabel.classList.add('car-name-label');
      nameLabel.textContent = shortName;
      root.appendChild(nameLabel);

      // Pitting cars get a "PIT" suffix label below the dot
      if (inPit) {
        const pitTag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        pitTag.setAttribute('x', String(cx));
        pitTag.setAttribute('y', String(cy + dotR + 8 * K));
        pitTag.setAttribute('text-anchor', 'middle');
        pitTag.setAttribute('fill', '#aab0c0');
        pitTag.setAttribute('font-size', String(7 * K));
        pitTag.setAttribute('font-weight', '700');
        pitTag.setAttribute('letter-spacing', String(1 * K));
        pitTag.classList.add('car-name-label');
        pitTag.textContent = 'PIT';
        root.appendChild(pitTag);
      }

      // Suppress unused-var warnings for old perpendicular-offset code
      void nx; void ny; void NAME_OFFSET;
    });
  }, [
    session, lapData, participants, playerCarIndex, rivalCarIndex,
    corners, showPitExit, pitLossSec, driverNameMasks, motion, trace, ttData,
  ]);

  // ── Zoom/pan handlers ────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => clamp(z * delta, 0.5, 6));
  }, []);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current || !svgRef.current) return;
    const svg = svgRef.current;
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scaleX = vb.width / rect.width;
    const scaleY = vb.height / rect.height;
    setPan({
      x: dragStart.current.panX + (e.clientX - dragStart.current.x) * scaleX,
      y: dragStart.current.panY + (e.clientY - dragStart.current.y) * scaleY,
    });
  }, []);
  const onMouseUp = useCallback(() => { dragStart.current = null; }, []);
  const reset = useCallback(() => { setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }); }, []);

  // Allow the page to render even without a live session, as long as
  // the user has selected a track from the browse-mode dropdown. The
  // live-data panels gracefully handle session === null below.
  if (!session && previewTrackId == null) {
    return (
      <div className="page-empty">
        <h2>TRACK MAP</h2>
        <p>Waiting for session data — or pick a track from the browser:</p>
        <select
          className="settings-input"
          style={{ marginTop: 14, maxWidth: 320 }}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v !== '') setPreviewTrackId(Number(v));
          }}
        >
          <option value="">— Select a track —</option>
          {ttTrackList.map((t) => (
            <option key={t.trackId} value={t.trackId}>{t.name}</option>
          ))}
        </select>
      </div>
    );
  }

  const ersPct = status ? clamp((status.ersStoreEnergy / MAX_ERS) * 100, 0, 100) : 0;
  const ersMJ = status ? (status.ersStoreEnergy / 1e6).toFixed(2) : '--';

  return (
    <div className="trackmap-layout">
      <div className="trackmap-main-area">
        <div className="trackmap-header">
          <h3 className="panel-title">
            TRACK MAP — {ttData?.name || session?.trackName || 'Unknown'}
            {isPreviewing && <span className="dim" style={{ fontSize: 11, marginLeft: 8 }}>(browsing)</span>}
          </h3>
          <div className="trackmap-controls">
            <select
              className="settings-input"
              style={{ height: 26, padding: '0 6px', fontSize: 12 }}
              value={previewTrackId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setPreviewTrackId(v === '' ? null : Number(v));
              }}
              title="Browse any track. Pick the blank entry to follow the live session."
            >
              <option value="">{session?.trackName ? `Live: ${session.trackName}` : '— Browse —'}</option>
              {ttTrackList.map((t) => (
                <option key={t.trackId} value={t.trackId}>{t.name}</option>
              ))}
            </select>
            <button className="btn-small" onClick={() => setZoom((z) => clamp(z * 1.2, 0.5, 6))}>+</button>
            <button className="btn-small" onClick={() => setZoom((z) => clamp(z * 0.83, 0.5, 6))}>−</button>
            <button className="btn-small" onClick={() => setRotation((r) => (r - 15) % 360)}>↶</button>
            <button className="btn-small" onClick={() => setRotation((r) => (r + 15) % 360)}>↷</button>
            <button className="btn-small" onClick={reset}>Reset</button>
            {ttData && !isPreviewing && (
              <button
                className="btn-small"
                title="Force a fresh map↔world calibration. Use when on a long clean straight if cars look offset from the racing line."
                onClick={() => { ttTransformRef.current = null; }}
              >
                Recalibrate
              </button>
            )}
            <label className="trackmap-check" title="Toggle corner labels">
              <input type="checkbox" checked={showCorners}
                onChange={(e) => setShowCorners(e.target.checked)} /> Corners
            </label>
            <label className="trackmap-check" title="Toggle simulated pit-exit marker">
              <input type="checkbox" checked={showPitExit}
                onChange={(e) => setShowPitExit(e.target.checked)} /> Pit Exit ({pitLossSec}s)
            </label>

            {/* Record-Lap is now a fallback for tracks the bundled TT
                data doesn't cover. When TT has the track, hide it
                completely — recording is unnecessary. */}
            {!ttData && recordState === 'armed' && (
              <button className="btn-small record-btn recording"
                onClick={cancelRecording}
                title="Recorder is armed. It will capture your next full lap automatically. Click to cancel.">
                ● Recording… (cancel)
              </button>
            )}
            {!ttData && recordState !== 'armed' && (
              <button className="btn-small record-btn"
                onClick={armRecording}
                title={trace
                  ? 'Re-record this track. The next full lap you drive will overwrite the saved trace.'
                  : 'No bundled track data for this circuit — record one flying lap to generate it.'}>
                {trace ? '↻ Re-record Lap' : '● Record Lap'}
              </button>
            )}
            {!ttData && trace && (
              <span className="dim" style={{ fontSize: 11 }}>
                ✓ trace: {trace.samples.length} pts
              </span>
            )}
          </div>
        </div>
        <div
          className="trackmap-svg-container"
          ref={containerRef}
          onWheel={onWheel}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{ cursor: dragStart.current ? 'grabbing' : 'grab' }}
        >
          <div className="trackmap-no-data">Loading circuit...</div>
        </div>
      </div>

      <div className="trackmap-sidebar">
        <div className="panel">
          <h3 className="panel-title">YOUR BATTERY</h3>
          <div className="stat-list">
            <div className="stat-row-item">
              <span className="stat-label-text">ERS Store</span>
              <span className="stat-value-text">{ersMJ} MJ</span>
            </div>
            <div className="stat-row-item">
              <span className="stat-label-text">Battery %</span>
              <span className="stat-value-text">{ersPct.toFixed(1)}%</span>
            </div>
          </div>
          <div className="ers-bar-outer">
            <div className="ers-bar-inner" style={{ width: `${ersPct}%`, backgroundColor: '#00d2be' }} />
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">PIT LOSS</h3>
          <div className="settings-field" style={{ marginBottom: 0 }}>
            <label>Override (s)</label>
            <input type="number" className="settings-input" min={10} max={60} step={0.5}
              value={pitLossOverride ?? pitLossSec}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setPitLossOverride(isFinite(v) ? v : null);
              }} />
          </div>
          <p className="settings-note">
            Red dashed ring shows where you'd rejoin if you pitted this instant.
          </p>
        </div>

        <div className="panel">
          <h3 className="panel-title">CARS ON TRACK</h3>
          <div className="trackmap-car-list">
            {sortedCars.map(({ lap, idx }) => {
              const p = participants?.participants?.[idx];
              const color = teamColor(p?.teamId ?? -1);
              const name = applyNameMasks(p?.name || `Car ${idx + 1}`, driverNameMasks);
              const isPlayer = idx === playerCarIndex;
              const isRival = idx === rivalCarIndex;
              const sts = allCarStatus?.[idx];
              const carErsMJ = sts ? (sts.ersStoreEnergy / 1e6).toFixed(2) : '--';
              const gapStr = lap.carPosition === 1 ? 'Leader'
                : lap.deltaToLeaderMs > 0 ? `+${(lap.deltaToLeaderMs / 1000).toFixed(1)}s` : '';

              return (
                <div key={idx}
                  className={`trackmap-car-item ${isPlayer ? 'player' : ''} ${isRival ? 'rival' : ''}`}>
                  <span className="trackmap-car-pos">{lap.carPosition || '-'}</span>
                  <span className="trackmap-car-dot-sm" style={{ background: color }} />
                  <div className="trackmap-car-info">
                    <span className="trackmap-car-name">
                      {name}{isRival && ' ★'}
                    </span>
                    <div className="trackmap-car-sub-row">
                      <span>{carErsMJ} MJ</span>
                      <span>{gapStr}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
