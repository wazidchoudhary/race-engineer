import React, { useMemo } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { usePrefs } from '../context/PrefsContext';
import { applyNameMasks } from '../lib/name-mask';
import { useRivalDominance } from '../hooks/useRivalDominance';
import { DominanceMap } from '../components/DominanceMap';
import type { LapData } from '../../shared/types/packets';

const COMPOUND_BADGE: Record<number, { label: string; color: string }> = {
  16: { label: 'Soft', color: '#FF3333' },
  17: { label: 'Medium', color: '#FFD700' },
  18: { label: 'Hard', color: '#CCCCCC' },
  7:  { label: 'Inter', color: '#39B54A' },
  8:  { label: 'Wet', color: '#4477FF' },
};
const MAX_ERS = 4_000_000;

function fmt(ms: number): string {
  if (!ms || ms <= 0) return '--:--.---';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function deltaFmt(ms: number): string {
  const s = ms / 1000;
  if (!isFinite(s)) return '--';
  return `${s >= 0 ? '+' : ''}${s.toFixed(3)}s`;
}

function lastSector3Ms(lap: LapData | undefined): number {
  if (!lap || !lap.lastLapTimeMs || !lap.sector1TimeMs || !lap.sector2TimeMs) return 0;
  const s3 = lap.lastLapTimeMs - lap.sector1TimeMs - lap.sector2TimeMs;
  return s3 > 0 ? s3 : 0;
}

export function Rival() {
  const {
    participants, lapData, allCarStatus, allCarDamage, allCarTelemetry,
    bestLapTimes, rivalCarIndex, playerCarIndex, setRival, driverHistories,
  } = useTelemetryContext();
  const { driverNameMasks } = usePrefs();

  const rivalList = useMemo(() => {
    if (!lapData || !participants) return [];
    return lapData
      .map((lap, idx) => ({ lap, idx }))
      .filter((c) => c.lap && c.lap.resultStatus >= 2 && c.idx !== playerCarIndex)
      .sort((a, b) => (a.lap.carPosition || 999) - (b.lap.carPosition || 999));
  }, [lapData, participants, playerCarIndex]);

  // Dominance sampler runs every render (hooks must not be conditional); it
  // no-ops internally until a rival is selected.
  const dominance = useRivalDominance(playerCarIndex, rivalCarIndex);

  if (rivalCarIndex == null) {
    return (
      <div className="rival-picker">
        <h2>SELECT YOUR RIVAL</h2>
        <p className="dim" style={{ marginBottom: 14 }}>
          Pick any driver for live side-by-side comparison. You can also double-click a driver
          in the Timing Tower, or use <kbd>[</kbd>/<kbd>]</kbd> to cycle rivals.
        </p>
        <div className="rival-grid">
          {rivalList.map(({ lap, idx }) => {
            const p = participants?.participants?.[idx];
            const name = applyNameMasks(p?.name || `Car ${idx + 1}`, driverNameMasks);
            const best = bestLapTimes[idx] ?? 0;
            return (
              <button key={idx} className="rival-card" onClick={() => setRival(idx)}>
                <div className="rival-card-pos">P{lap.carPosition}</div>
                <div className="rival-card-name">{name}</div>
                <div className="rival-card-best">{best > 0 ? fmt(best) : '—'}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const p = participants?.participants?.[rivalCarIndex];
  const rivalLap = lapData?.[rivalCarIndex];
  const rivalSts = allCarStatus?.[rivalCarIndex];
  const rivalDmg = allCarDamage?.[rivalCarIndex];
  const rivalTel = allCarTelemetry?.[rivalCarIndex];

  const playerLap = lapData?.[playerCarIndex];
  const playerSts = allCarStatus?.[playerCarIndex];

  const rivalName = applyNameMasks(p?.name || `Car ${rivalCarIndex + 1}`, driverNameMasks);
  const playerP = participants?.participants?.[playerCarIndex];
  const playerName = applyNameMasks(playerP?.name || 'You', driverNameMasks);
  const gapToPlayer = rivalLap && playerLap
    ? (rivalLap.deltaToLeaderMs || 0) - (playerLap.deltaToLeaderMs || 0)
    : 0;

  const compound = rivalSts?.visualTyreCompound;
  const compInfo = compound != null ? COMPOUND_BADGE[compound] : null;
  const rivalErsPct = rivalSts ? (rivalSts.ersStoreEnergy / MAX_ERS) * 100 : 0;
  const playerErsPct = playerSts ? (playerSts.ersStoreEnergy / MAX_ERS) * 100 : 0;

  return (
    <div className="rival-page">
      <div className="rival-header">
        <div>
          <div className="dim" style={{ fontSize: 11 }}>RIVAL</div>
          <h2 className="panel-title" style={{ margin: 0, fontSize: 22 }}>{rivalName}</h2>
          <div className="dim">
            P{rivalLap?.carPosition ?? '-'} · #{p?.raceNumber ?? '-'}
            · {p?.aiControlled ? 'AI' : 'Human'}
          </div>
        </div>
        <div className="rival-header-actions">
          <button className="btn-small" onClick={() => setRival(null)}>Change Rival</button>
        </div>
      </div>

      <div className="rival-delta">
        <span className="rival-delta-label">Gap to You</span>
        <span
          className="rival-delta-value"
          style={{ color: gapToPlayer > 0 ? '#39b54a' : '#ff8700' }}
        >
          {deltaFmt(gapToPlayer)}
        </span>
      </div>

      <DominanceMap data={dominance} playerName={playerName} rivalName={rivalName} />

      <div className="rival-grid-compare">
        <div className="panel">
          <h3 className="panel-title">LAP TIMES</h3>
          <CompareRow label="Best"
            a={bestLapTimes[playerCarIndex] > 0 ? fmt(bestLapTimes[playerCarIndex]) : '--'}
            b={bestLapTimes[rivalCarIndex] > 0 ? fmt(bestLapTimes[rivalCarIndex]) : '--'} />
          <CompareRow label="Last"
            a={fmt(playerLap?.lastLapTimeMs ?? 0)}
            b={fmt(rivalLap?.lastLapTimeMs ?? 0)} />
          <CompareRow label="S1"
            a={((playerLap?.sector1TimeMs ?? 0) / 1000).toFixed(3)}
            b={((rivalLap?.sector1TimeMs ?? 0) / 1000).toFixed(3)} />
          <CompareRow label="S2"
            a={((playerLap?.sector2TimeMs ?? 0) / 1000).toFixed(3)}
            b={((rivalLap?.sector2TimeMs ?? 0) / 1000).toFixed(3)} />
          <CompareRow label="S3 (last)"
            a={(lastSector3Ms(playerLap) / 1000).toFixed(3)}
            b={(lastSector3Ms(rivalLap) / 1000).toFixed(3)} />
          {(() => {
            const playerHist = driverHistories[playerCarIndex] ?? [];
            const rivalHist = driverHistories[rivalCarIndex] ?? [];
            const pBestS3 = playerHist.reduce(
              (m, l) => (l.sector3TimeMs > 0 && (m === 0 || l.sector3TimeMs < m) ? l.sector3TimeMs : m), 0);
            const rBestS3 = rivalHist.reduce(
              (m, l) => (l.sector3TimeMs > 0 && (m === 0 || l.sector3TimeMs < m) ? l.sector3TimeMs : m), 0);
            return pBestS3 > 0 || rBestS3 > 0 ? (
              <CompareRow label="S3 best"
                a={pBestS3 > 0 ? (pBestS3 / 1000).toFixed(3) : '--'}
                b={rBestS3 > 0 ? (rBestS3 / 1000).toFixed(3) : '--'} />
            ) : null;
          })()}
        </div>

        <div className="panel">
          <h3 className="panel-title">CAR</h3>
          <CompareRow label="Tyre"
            a={playerSts ? `${(COMPOUND_BADGE[playerSts.visualTyreCompound]?.label ?? '?')} · ${playerSts.tyresAgeLaps}L` : '--'}
            b={rivalSts  ? `${(compInfo?.label ?? '?')} · ${rivalSts.tyresAgeLaps}L` : '--'} />
          <CompareRow label="ERS"
            a={`${playerErsPct.toFixed(0)}%`}
            b={`${rivalErsPct.toFixed(0)}%`} />
          <CompareRow label="Pit Stops"
            a={String(playerLap?.numPitStops ?? 0)}
            b={String(rivalLap?.numPitStops ?? 0)} />
          <CompareRow label="Speed"
            a={`${allCarTelemetry?.[playerCarIndex]?.speed ?? 0} km/h`}
            b={`${rivalTel?.speed ?? 0} km/h`} />
        </div>

        <div className="panel">
          <h3 className="panel-title">DAMAGE (rival)</h3>
          <div className="stat-list">
            <Row label="FW Left"  value={`${rivalDmg?.frontLeftWingDamage ?? 0}%`} />
            <Row label="FW Right" value={`${rivalDmg?.frontRightWingDamage ?? 0}%`} />
            <Row label="Rear Wing" value={`${rivalDmg?.rearWingDamage ?? 0}%`} />
            <Row label="Floor"    value={`${rivalDmg?.floorDamage ?? 0}%`} />
            <Row label="Gearbox"  value={`${rivalDmg?.gearBoxDamage ?? 0}%`} />
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">PENALTIES (rival)</h3>
          <div className="stat-list">
            <Row label="Time Pen"   value={`${rivalLap?.penalties ?? 0}s`} />
            <Row label="Warnings"   value={String(rivalLap?.totalWarnings ?? 0)} />
            <Row label="Corner Cut" value={String(rivalLap?.cornerCuttingWarnings ?? 0)} />
            <Row label="Unserved"   value={String((rivalLap?.numUnservedDriveThroughPens ?? 0) + (rivalLap?.numUnservedStopGoPens ?? 0))} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CompareRow({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <div className="compare-row">
      <span className="compare-label">{label}</span>
      <span className="compare-you">{a}</span>
      <span className="compare-rival">{b}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row-item">
      <span className="stat-label-text">{label}</span>
      <span className="stat-value-text">{value}</span>
    </div>
  );
}
