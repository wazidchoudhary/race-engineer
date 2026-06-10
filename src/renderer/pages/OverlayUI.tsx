import React from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';

const COMPOUND: Record<number, { label: string; color: string }> = {
  16: { label: 'S', color: '#FF3333' },
  17: { label: 'M', color: '#FFD700' },
  18: { label: 'H', color: '#CCCCCC' },
  7:  { label: 'I', color: '#39B54A' },
  8:  { label: 'W', color: '#4477FF' },
};

function fmt(ms: number): string {
  if (!ms || ms <= 0) return '--:--.---';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

const MAX_ERS = 4_000_000;

export function Overlay() {
  const { lapData, status, telemetry2, session, playerCarIndex, damage, bestLapTimes } = useTelemetryContext();
  const lap = lapData[playerCarIndex];
  const comp = status?.visualTyreCompound;
  const compInfo = comp != null ? COMPOUND[comp] : null;
  const best = bestLapTimes[playerCarIndex] ?? 0;
  const ersPct = status ? Math.round((status.ersStoreEnergy / MAX_ERS) * 100) : null;

  const avgWear = damage
    ? (damage.tyresWear[0] + damage.tyresWear[1] + damage.tyresWear[2] + damage.tyresWear[3]) / 4
    : 0;

  return (
    <div className="overlay-root" data-tauri-drag-region>
      <div className="overlay-row" data-tauri-drag-region>
        <div className="ov-cell">
          <span className="ov-label">POS</span>
          <span className="ov-big">{lap?.carPosition ?? '-'}</span>
        </div>
        <div className="ov-cell">
          <span className="ov-label">LAP</span>
          <span className="ov-val">
            {lap?.currentLapNum ?? '-'}{session ? `/${session.totalLaps}` : ''}
          </span>
        </div>
        <div className="ov-cell">
          <span className="ov-label">LAST</span>
          <span className="ov-val mono">{fmt(lap?.lastLapTimeMs ?? 0)}</span>
        </div>
        <div className="ov-cell">
          <span className="ov-label">BEST</span>
          <span className="ov-val mono">{best > 0 ? fmt(best) : '--'}</span>
        </div>
        <div className="ov-cell">
          <span className="ov-label">GAP P1</span>
          <span className="ov-val mono">
            {lap && lap.deltaToLeaderMs > 0 ? `+${(lap.deltaToLeaderMs / 1000).toFixed(1)}s` : 'LEAD'}
          </span>
        </div>
        <div className="ov-cell">
          <span className="ov-label">TYRE</span>
          <span className="ov-val" style={{ color: compInfo?.color }}>
            {compInfo?.label ?? '?'}{status != null && ` · ${status.tyresAgeLaps}L`}
          </span>
        </div>
        <div className="ov-cell">
          <span className="ov-label">WEAR</span>
          <span className="ov-val mono">{avgWear.toFixed(0)}%</span>
        </div>
        <div className="ov-cell">
          <span className="ov-label">BATT</span>
          <span
            className="ov-val mono"
            style={{ color: ersPct != null && ersPct < 15 ? '#ff5555' : telemetry2?.overtakeActive ? '#4aa3ff' : '#00d2be' }}
          >
            {ersPct != null ? `${ersPct}%` : '--'}
            {telemetry2?.overtakeActive === 1 ? ' OT' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
