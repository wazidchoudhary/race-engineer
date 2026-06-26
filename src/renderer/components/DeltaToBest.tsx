/**
 * Live predictive delta to your best lap — a center-zero bar plus a big
 * green/red number. Self-contained: drives itself from {@link useReferenceLap}.
 */
import React from 'react';
import { useReferenceLap } from '../hooks/useReferenceLap';

const CLAMP_S = 1.0; // bar saturates at ±1.0s

function fmtLap(ms: number | null): string {
  if (!ms || ms <= 0) return '--:--.---';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = ms % 1000;
  return `${m}:${s.toString().padStart(2, '0')}.${mm.toString().padStart(3, '0')}`;
}

export function DeltaToBest() {
  const { hasReference, deltaSec, bestLapMs, lapInvalid } = useReferenceLap();

  if (!hasReference) {
    return (
      <div className="panel">
        <h3 className="panel-title">DELTA TO BEST</h3>
        <p className="dim">Complete one clean lap to set your reference.</p>
      </div>
    );
  }

  const d = deltaSec;
  const ahead = d != null && d < 0;
  const color = d == null ? '#8a93a6' : ahead ? '#39b54a' : '#ff3b30';
  const text = d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(2)}s`;
  const clamped = Math.max(-CLAMP_S, Math.min(CLAMP_S, d ?? 0));
  const widthPct = (Math.abs(clamped) / CLAMP_S) * 50; // 0..50% of half-bar

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="panel-title" style={{ margin: 0 }}>DELTA TO BEST</h3>
        <span className="dim" style={{ fontSize: 11 }}>best {fmtLap(bestLapMs)}</span>
      </div>

      <div style={{ textAlign: 'center', fontSize: 38, fontWeight: 700, color, lineHeight: 1.2 }}>
        {text}
      </div>

      <div style={{ position: 'relative', height: 10, background: '#161b27', borderRadius: 5, overflow: 'hidden', marginTop: 4 }}>
        {/* center zero line */}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#3a4253' }} />
        {/* delta fill, growing left (ahead) or right (behind) from center */}
        {d != null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: `${widthPct}%`,
              background: color,
              transform: ahead ? 'translateX(-100%)' : 'none',
              transition: 'width 80ms linear',
            }}
          />
        )}
      </div>

      <div className="dim" style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
        {lapInvalid ? 'lap invalidated' : ahead ? 'ahead of your best' : d != null ? 'behind your best' : 'on your best'}
      </div>
    </div>
  );
}
