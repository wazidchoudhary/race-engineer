import React, { useMemo, useState, useCallback } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { usePrefs } from '../context/PrefsContext';
import { applyNameMasks } from '../lib/name-mask';
import { teamColor as sharedTeamColor } from '../lib/team-colors';
import { DriverDetailModal } from '../components/DriverDetailModal';
import type { LapData } from '../../shared/types/packets';

import { api } from '../lib/tauri-api';

const COMPOUND_BADGE: Record<number, { label: string; color: string }> = {
  16: { label: 'S', color: '#FF3333' },
  17: { label: 'M', color: '#FFD700' },
  18: { label: 'H', color: '#CCCCCC' },
  7:  { label: 'I', color: '#39B54A' },
  8:  { label: 'W', color: '#4477FF' },
};

function teamColor(teamId: number): string { return sharedTeamColor(teamId, '#888888'); }

function formatTime(ms: number): string {
  if (!ms || ms <= 0) return '--:--.---';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function formatSector(ms: number): string {
  if (!ms || ms <= 0) return '--';
  return (ms / 1000).toFixed(3);
}

function computeSector3(car: LapData): number {
  if (!car.lastLapTimeMs || !car.sector1TimeMs || !car.sector2TimeMs) return 0;
  return car.lastLapTimeMs - car.sector1TimeMs - car.sector2TimeMs;
}

function csvEscape(val: any): string {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

type GapMode = 'leader' | 'interval' | 'both';

export function TimingTower() {
  const {
    lapData, playerCarIndex, participants, allCarStatus,
    bestLapTimes, fastestLapCar, fastestLapMs, session,
    rivalCarIndex, setRival,
  } = useTelemetryContext();
  const { driverNameMasks, timingGapMode, setPrefs } = usePrefs();

  const [exportStatus, setExportStatus] = useState('');
  const gapMode: GapMode = timingGapMode;
  const [detailIdx, setDetailIdx] = useState<number | null>(null);

  const sortedCars = useMemo(() => {
    if (!lapData || lapData.length === 0) return [];
    return lapData
      .map((lap, idx) => ({ lap, idx }))
      .filter((c) => c.lap && c.lap.resultStatus >= 2)
      .sort((a, b) => (a.lap.carPosition || 999) - (b.lap.carPosition || 999));
  }, [lapData]);

  const exportTiming = useCallback(async (format: 'csv' | 'json') => {
    const rows = sortedCars.map(({ lap, idx }) => {
      const p = participants?.participants?.[idx];
      const sts = allCarStatus?.[idx];
      const s3 = computeSector3(lap);
      return {
        position: lap.carPosition || '',
        driver: applyNameMasks(p?.name || `Car ${idx + 1}`, driverNameMasks),
        teamId: p?.teamId ?? '',
        aiControlled: p?.aiControlled ?? '',
        lastLap: formatTime(lap.lastLapTimeMs),
        bestLap: formatTime(bestLapTimes[idx] || 0),
        sector1: formatSector(lap.sector1TimeMs),
        sector2: formatSector(lap.sector2TimeMs),
        sector3: formatSector(s3),
        gapToLeader: lap.carPosition === 1 ? 0 : +((lap.deltaToLeaderMs || 0) / 1000).toFixed(3),
        interval: lap.carPosition === 1 ? 0 : +((lap.deltaToCarAheadMs || 0) / 1000).toFixed(3),
        tyre: sts?.visualTyreCompound ?? '',
        tyreAgeLaps: sts?.tyresAgeLaps ?? '',
        pitStops: lap.numPitStops ?? '',
        lap: lap.currentLapNum ?? '',
        penaltySec: lap.penalties ?? 0,
        warnings: lap.totalWarnings ?? 0,
        cornerCuts: lap.cornerCuttingWarnings ?? 0,
      };
    });

    if (rows.length === 0) { setExportStatus('No data'); setTimeout(() => setExportStatus(''), 3000); return; }

    let content: string;
    let ext: string;
    if (format === 'json') {
      ext = 'json';
      content = JSON.stringify({
        exportedAt: new Date().toISOString(),
        trackName: session?.trackName ?? null,
        sessionType: session?.sessionTypeName ?? null,
        rows,
      }, null, 2);
    } else {
      ext = 'csv';
      const headers = Object.keys(rows[0]);
      content = [headers.join(','), ...rows.map((r) => headers.map((h) => csvEscape((r as any)[h])).join(','))].join('\n');
    }

    const trackPart = (session?.trackName || 'track').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const result = await api?.saveExportFile?.({
      content,
      defaultName: `timing-${trackPart}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (result?.success) setExportStatus(`Saved: ${result.filePath}`);
    else if (result?.cancelled) setExportStatus('Cancelled');
    else setExportStatus('Export failed');
    setTimeout(() => setExportStatus(''), 4000);
  }, [sortedCars, participants, allCarStatus, bestLapTimes, session, driverNameMasks]);

  const cycleGap = () => {
    const next: GapMode = gapMode === 'leader' ? 'interval' : gapMode === 'interval' ? 'both' : 'leader';
    setPrefs({ timingGapMode: next });
  };

  if (sortedCars.length === 0) {
    return (
      <div className="page-empty">
        <h2>TIMING TOWER</h2>
        <p>Waiting for telemetry data...</p>
      </div>
    );
  }

  return (
    <div className="timing-page">
      <div className="timing-toolbar">
        <button className="btn-small" onClick={() => exportTiming('csv')}>Export CSV</button>
        <button className="btn-small" onClick={() => exportTiming('json')}>Export JSON</button>
        <span className="dim" style={{ fontSize: 11, marginLeft: 12 }}>
          Double-click driver for details · <kbd>[</kbd>/<kbd>]</kbd> cycle rival · <kbd>\</kbd> clear
        </span>
        {exportStatus && <span className="dim" style={{ fontSize: 11 }}>{exportStatus}</span>}
      </div>
      <div className="timing-table-wrap">
        <table className="timing-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>P</th>
              <th>Driver</th>
              <th
                className="right th-clickable"
                title="Click to toggle Gap / Interval / Both"
                onClick={cycleGap}
              >
                {gapMode === 'leader' ? 'Gap ▾' : gapMode === 'interval' ? 'Interval ▾' : 'Gap / Int ▾'}
              </th>
              <th className="right">Last Lap</th>
              <th className="right">Best Lap</th>
              <th className="right">S1</th>
              <th className="right">S2</th>
              <th className="right">S3</th>
              <th className="center" title="Penalty seconds">P(s)</th>
              <th className="center" title="Total warnings">W</th>
              <th className="center" title="Corner-cut warnings">CC</th>
              <th className="center">Tyre</th>
              <th className="center">Age</th>
              <th className="center">Pits</th>
              <th className="center">Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedCars.map(({ lap, idx }, rank) => {
              const p = participants?.participants?.[idx];
              const color = teamColor(p?.teamId ?? -1);
              const name = applyNameMasks(p?.name || `Car ${idx + 1}`, driverNameMasks);
              const isPlayer = idx === playerCarIndex;
              const isFastest = idx === fastestLapCar && (fastestLapMs ?? 0) > 0;
              const isRival = idx === rivalCarIndex;
              const sts = allCarStatus?.[idx];
              const compound = sts?.visualTyreCompound;
              const compInfo = compound != null ? COMPOUND_BADGE[compound] : null;
              const tyreAge = sts?.tyresAgeLaps ?? '';

              const leaderStr = rank === 0 ? 'Leader' :
                (lap.deltaToLeaderMs > 0 ? `+${(lap.deltaToLeaderMs / 1000).toFixed(3)}` : '');
              const intervalStr = rank > 0 && lap.deltaToCarAheadMs > 0
                ? `+${(lap.deltaToCarAheadMs / 1000).toFixed(3)}` : '';
              const gapCell =
                gapMode === 'leader'   ? leaderStr :
                gapMode === 'interval' ? intervalStr :
                rank === 0 ? <span>Leader</span> :
                <div className="gap-both">
                  <span>{leaderStr}</span>
                  <span className="gap-interval">{intervalStr}</span>
                </div>;

              const bestMs = bestLapTimes[idx];
              const bestStr = bestMs > 0 ? formatTime(bestMs) : '';

              let pitCell: React.ReactNode;
              if (lap.pitStatus === 1) pitCell = <span className="pit-badge in-lane">PIT LANE</span>;
              else if (lap.pitStatus === 2) pitCell = <span className="pit-badge in-pit">IN PIT</span>;
              else pitCell = <span className="pit-badge">{lap.numPitStops}</span>;

              const statusLabel = lap.resultStatus === 4 ? 'DNF' :
                lap.resultStatus === 5 ? 'DSQ' :
                lap.resultStatus === 7 ? 'RET' :
                lap.driverStatus === 0 ? 'Garage' :
                lap.driverStatus === 2 ? 'In Lap' :
                lap.driverStatus === 3 ? 'Out Lap' : '';

              const penSec = lap.penalties ?? 0;
              const warns  = lap.totalWarnings ?? 0;
              const ccWarns = lap.cornerCuttingWarnings ?? 0;

              return (
                <tr
                  key={idx}
                  className={
                    `${isPlayer ? 'player-row' : ''}` +
                    `${isFastest ? ' fastest-row' : ''}` +
                    `${isRival ? ' rival-row' : ''}`
                  }
                  onDoubleClick={() => setDetailIdx(idx)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setRival(isRival ? null : idx);
                  }}
                  title="Double-click for details · Right-click to set rival"
                >
                  <td className="pos-cell">{lap.carPosition || '-'}</td>
                  <td className="driver-cell">
                    <span className="team-bar" style={{ background: color }} />
                    <span className="driver-name">{name}</span>
                    {p?.aiControlled === 1 && <span className="ai-badge">AI</span>}
                    {isPlayer && <span className="you-badge">YOU</span>}
                    {isRival && <span className="rival-badge">★</span>}
                  </td>
                  <td className="right gap-time">{gapCell}</td>
                  <td className={`right lap-time ${lap.currentLapInvalid ? 'lap-invalid' : ''}`}>
                    {formatTime(lap.lastLapTimeMs)}
                  </td>
                  <td className={`right lap-time ${isFastest ? 'lap-fastest' : ''}`}>{bestStr}</td>
                  <td className="right sector-time">{formatSector(lap.sector1TimeMs)}</td>
                  <td className="right sector-time">{formatSector(lap.sector2TimeMs)}</td>
                  <td className="right sector-time">{formatSector(computeSector3(lap))}</td>
                  <td className="center pen-cell"
                    style={{ color: penSec > 0 ? '#ff8700' : undefined }}>
                    {penSec > 0 ? `${penSec}s` : ''}
                  </td>
                  <td className="center warn-cell"
                    style={{ color: warns >= 3 ? '#dc0000' : warns > 0 ? '#ffd700' : undefined }}>
                    {warns || ''}
                  </td>
                  <td className="center dim">{ccWarns || ''}</td>
                  <td className="center">
                    {compInfo && (
                      <span className="tyre-badge" style={{ color: compInfo.color, borderColor: compInfo.color }}>
                        {compInfo.label}
                      </span>
                    )}
                  </td>
                  <td className="center dim">{tyreAge}</td>
                  <td className="center">{pitCell}</td>
                  <td className="center">
                    {statusLabel && <span className="status-badge">{statusLabel}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detailIdx != null && (
        <DriverDetailModal carIdx={detailIdx} onClose={() => setDetailIdx(null)} />
      )}
    </div>
  );
}
