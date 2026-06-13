import React, { useState, useMemo, useCallback } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { useLapHistory, type CompletedLap } from '../hooks/useLapHistory';

const TYRE_WEAR_LABELS = ['RL', 'RR', 'FL', 'FR'];

const COMPOUND_LABELS: Record<number, { label: string; color: string }> = {
  16: { label: 'S', color: '#FF3333' },
  17: { label: 'M', color: '#FFD700' },
  18: { label: 'H', color: '#CCCCCC' },
  7:  { label: 'I', color: '#39B54A' },
  8:  { label: 'W', color: '#4477FF' },
};

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

function formatDelta(ms: number): string {
  const s = ms / 1000;
  return `${s >= 0 ? '+' : ''}${s.toFixed(3)}s`;
}

function formatFuel(kg: number | null): string {
  return kg != null && isFinite(kg) ? `${kg.toFixed(2)} kg` : '--';
}

function formatWear(wear: number[] | null): string {
  if (!wear) return '--';
  return TYRE_WEAR_LABELS.map((l, i) => `${l} ${wear[i]?.toFixed(1) ?? '-'}`).join(' · ');
}

// ── SVG Lap Comparison Chart ──
function LapCompareChart({ lapA, lapB }: { lapA: CompletedLap; lapB: CompletedLap }) {
  const W = 700, H = 200;
  const PL = 50, PR = 20, PT = 16, PB = 28;
  const plotW = W - PL - PR;
  const plotH = H - PT - PB;

  // Build 3 sector bars for each lap
  const totalA = lapA.lapTimeMs;
  const totalB = lapB.lapTimeMs;
  const maxTotal = Math.max(totalA, totalB);

  const sectors = [
    { label: 'S1', a: lapA.sector1TimeMs, b: lapB.sector1TimeMs },
    { label: 'S2', a: lapA.sector2TimeMs, b: lapB.sector2TimeMs },
    { label: 'S3', a: lapA.sector3TimeMs, b: lapB.sector3TimeMs },
  ];

  const barH = plotH / 3 - 8;
  const barGap = plotH / 3;
  const maxSector = Math.max(...sectors.flatMap((s) => [s.a, s.b]));

  const xFor = (ms: number) => PL + (ms / maxSector) * plotW;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="analysis-graph" style={{ width: '100%' }}>
      {sectors.map((s, i) => {
        const y = PT + i * barGap;
        const wA = s.a > 0 ? Math.max(2, xFor(s.a) - PL) : 0;
        const wB = s.b > 0 ? Math.max(2, xFor(s.b) - PL) : 0;
        const deltaMs = s.b - s.a;
        return (
          <g key={s.label}>
            <text x={PL - 6} y={y + barH / 2 + 4} textAnchor="end" className="analysis-axis-label">{s.label}</text>
            {/* Lap A bar */}
            <rect x={PL} y={y} width={wA} height={barH / 2 - 1} fill="#00d2be" opacity={0.8} rx={2} />
            <text x={PL + wA + 4} y={y + barH / 4 + 4} className="analysis-axis-label" fill="#00d2be">
              {formatSector(s.a)}
            </text>
            {/* Lap B bar */}
            <rect x={PL} y={y + barH / 2 + 2} width={wB} height={barH / 2 - 1} fill="#ff8700" opacity={0.8} rx={2} />
            <text x={PL + wB + 4} y={y + barH + 4} className="analysis-axis-label" fill="#ff8700">
              {formatSector(s.b)}
            </text>
            {/* Delta label */}
            {s.a > 0 && s.b > 0 && (
              <text x={W - PR} y={y + barH / 2 + 4} textAnchor="end"
                className="analysis-axis-label"
                fill={deltaMs <= 0 ? '#39b54a' : '#dc0000'}>
                {formatDelta(deltaMs)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Fuel Analysis Panel ──
function FuelPanel({ completedLaps, status }: {
  completedLaps: CompletedLap[];
  status: ReturnType<typeof useTelemetryContext>['status'];
}) {
  const lapsWithFuel = completedLaps.filter((l) => l.fuelUsedKg != null);
  const avgBurn = lapsWithFuel.length
    ? lapsWithFuel.reduce((s, l) => s + l.fuelUsedKg!, 0) / lapsWithFuel.length
    : null;

  const currentFuel = status?.fuelInTank ?? null;
  const fuelLapsLeft = status?.fuelRemainingLaps ?? null;
  const startFuel = completedLaps[0]?.fuelAtEndKg != null && avgBurn != null
    ? completedLaps[0].fuelAtEndKg + (completedLaps.length * avgBurn)
    : null;

  return (
    <div className="panel">
      <h3 className="panel-title">FUEL WINDOW</h3>
      <div className="stat-list">
        <StatRow label="Start Fuel" value={formatFuel(startFuel)} />
        <StatRow label="Current Fuel" value={formatFuel(currentFuel)} />
        <StatRow label="Avg Burn/Lap" value={avgBurn != null ? `${avgBurn.toFixed(3)} kg` : '--'} />
        {/* Game MFD fuel delta: + = laps of fuel extra, − = laps short. */}
        <StatRow
          label="Fuel Extra/Down (game)"
          value={fuelLapsLeft != null ? `${fuelLapsLeft >= 0 ? '+' : ''}${fuelLapsLeft.toFixed(1)} laps` : '--'}
          valueClass={fuelLapsLeft == null ? '' : fuelLapsLeft >= 0 ? 'status-on' : 'status-critical'} />
      </div>
    </div>
  );
}

// ── Pit Loss Estimate Panel ──
function PitLossPanel({ playerLap, lapData, pitLossSec }: {
  playerLap: ReturnType<typeof useTelemetryContext>['lapData'][0] | undefined;
  lapData: ReturnType<typeof useTelemetryContext>['lapData'];
  pitLossSec: number;
}) {
  if (!playerLap) return null;

  const pitLossMs = pitLossSec * 1000;
  const cars = lapData
    .map((l, idx) => ({ ...l, idx }))
    .filter((c) => c && c.resultStatus >= 2)
    .sort((a, b) => (a.carPosition || 999) - (b.carPosition || 999));

  const carBehind = cars.find((c) => c.carPosition === playerLap.carPosition + 1);
  const gapBehindMs = carBehind?.deltaToCarAheadMs ?? 0;
  const playerLeaderGap = playerLap.carPosition === 1 ? 0 : (playerLap.deltaToLeaderMs || 0);

  const carsLost = cars.filter((c) => {
    if (c.carPosition <= playerLap.carPosition) return false;
    const carGap = (c.deltaToLeaderMs || 0) - playerLeaderGap;
    return carGap > 0 && carGap < pitLossMs;
  }).length;

  const projectedPos = Math.min(cars.length, playerLap.carPosition + carsLost);
  // Free-stop margin as the post-stop time swing vs. the car behind:
  // negative = you still emerge clear (the stop is "free"), positive = you'd
  // drop into/behind them. Sign reversed from the old gap-minus-loss form so a
  // safe stop reads as a minus; colour still flags safe (green) vs. risky (red).
  const gapDeltaSec = (pitLossMs - gapBehindMs) / 1000;

  return (
    <div className="panel">
      <h3 className="panel-title">PIT ESTIMATE</h3>
      <div className="stat-list">
        <StatRow label="Gap Behind" value={gapBehindMs > 0 ? `${(gapBehindMs / 1000).toFixed(2)}s` : 'Leader'} />
        <StatRow label="Projected Rejoin" value={`P${projectedPos}`} />
        <StatRow
          label="Free Stop Margin"
          value={gapBehindMs > 0 ? `${gapDeltaSec >= 0 ? '+' : ''}${gapDeltaSec.toFixed(2)}s` : '--'}
          valueClass={gapBehindMs > 0 ? (gapDeltaSec <= 0 ? 'status-on' : 'status-critical') : ''}
        />
      </div>
    </div>
  );
}

// ── Full Lap Table ──
function LapTable({ completedLaps, bestLapMs }: { completedLaps: CompletedLap[]; bestLapMs: number | null }) {
  return (
    <div className="panel">
      <h3 className="panel-title">FULL RACE LAP TABLE</h3>
      <div className="laphistory-table-wrap">
        <table className="timing-table">
          <thead>
            <tr>
              <th>Lap</th>
              <th className="right">Time</th>
              <th className="right">Delta</th>
              <th className="right">S1</th>
              <th className="right">S2</th>
              <th className="right">S3</th>
              <th className="right">Fuel End</th>
              <th className="right">Fuel Used</th>
              <th className="center">Tyre</th>
              <th className="center">Wear End</th>
              <th className="center">Age</th>
              <th className="center">Pit</th>
              <th className="center">Invalid</th>
            </tr>
          </thead>
          <tbody>
            {completedLaps.length === 0 ? (
              <tr>
                <td colSpan={13}>
                  <div className="page-empty-inline">Waiting for completed laps...</div>
                </td>
              </tr>
            ) : (
              completedLaps.map((lap) => {
                const deltaMs = bestLapMs != null ? lap.lapTimeMs - bestLapMs : null;
                const isBest = bestLapMs != null && lap.lapTimeMs === bestLapMs && !lap.invalid && !lap.pitLap;
                const compound = lap.tyreCompound != null ? COMPOUND_LABELS[lap.tyreCompound] : null;

                return (
                  <tr key={lap.lapNumber} className={isBest ? 'fastest-row' : ''}>
                    <td className="pos-cell">{lap.lapNumber}</td>
                    <td className={`right lap-time ${isBest ? 'lap-fastest' : ''}`}>{formatTime(lap.lapTimeMs)}</td>
                    <td className={`right gap-time ${deltaMs != null && deltaMs <= 0 ? 'lap-fastest' : ''}`}>
                      {deltaMs != null ? formatDelta(deltaMs) : '--'}
                    </td>
                    <td className="right sector-time">{formatSector(lap.sector1TimeMs)}</td>
                    <td className="right sector-time">{formatSector(lap.sector2TimeMs)}</td>
                    <td className="right sector-time">{formatSector(lap.sector3TimeMs)}</td>
                    <td className="right gap-time">{formatFuel(lap.fuelAtEndKg)}</td>
                    <td className="right gap-time">{lap.fuelUsedKg != null ? `${lap.fuelUsedKg.toFixed(3)} kg` : '--'}</td>
                    <td className="center">
                      {compound
                        ? <span className="tyre-badge" style={{ color: compound.color, borderColor: compound.color }}>{compound.label}</span>
                        : '--'}
                    </td>
                    <td className="center dim" style={{ fontSize: 10 }}>{formatWear(lap.tyreWearEndPct)}</td>
                    <td className="center dim">{lap.tyreAgeLaps}</td>
                    <td className="center">
                      {lap.pitLap ? <span className="pit-badge in-lane">YES</span> : <span className="pit-badge">NO</span>}
                    </td>
                    <td className="center">
                      {lap.invalid ? <span className="status-badge">INV</span> : <span className="status-badge finished">OK</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Analysis Page ──
export function Analysis() {
  const ctx = useTelemetryContext();
  const { completedLaps, bestLapMs } = useLapHistory(ctx);
  const [pitLossSec, setPitLossSec] = useState(22);
  const [compareLapA, setCompareLapA] = useState<number | null>(null);
  const [compareLapB, setCompareLapB] = useState<number | null>(null);

  const playerLap = ctx.lapData[ctx.playerCarIndex];

  const lapNumbers = useMemo(
    () => completedLaps.map((l) => l.lapNumber),
    [completedLaps]
  );

  const lapA = useMemo(
    () => completedLaps.find((l) => l.lapNumber === compareLapA) ?? null,
    [completedLaps, compareLapA]
  );
  const lapB = useMemo(
    () => completedLaps.find((l) => l.lapNumber === compareLapB) ?? null,
    [completedLaps, compareLapB]
  );

  const swapLaps = useCallback(() => {
    setCompareLapA(compareLapB);
    setCompareLapB(compareLapA);
  }, [compareLapA, compareLapB]);

  const validLaps = useMemo(() => completedLaps.filter((l) => !l.invalid && !l.pitLap && l.lapTimeMs > 0), [completedLaps]);
  const avgMs = validLaps.length
    ? Math.round(validLaps.reduce((s, l) => s + l.lapTimeMs, 0) / validLaps.length)
    : null;

  return (
    <div className="analysis-page">
      {/* Summary Row */}
      <div className="analysis-summary-row">
        <FuelPanel completedLaps={completedLaps} status={ctx.status} />

        <div className="panel">
          <h3 className="panel-title">LAP SUMMARY</h3>
          <div className="stat-list">
            <StatRow label="Completed Laps" value={String(completedLaps.length)} />
            <StatRow label="Best Lap" value={bestLapMs ? formatTime(bestLapMs) : '--'} />
            <StatRow label="Average Lap" value={avgMs ? formatTime(avgMs) : '--'} />
            <StatRow label="Total Time" value={completedLaps.reduce((s, l) => s + l.lapTimeMs, 0) > 0
              ? formatTime(completedLaps.reduce((s, l) => s + l.lapTimeMs, 0))
              : '--'} />
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">PIT LOSS ESTIMATE</h3>
          <div className="settings-field">
            <label>Time loss (seconds)</label>
            <input
              type="number" className="settings-input" min={5} max={120} step={0.5}
              value={pitLossSec}
              onChange={(e) => setPitLossSec(parseFloat(e.target.value) || 22)}
            />
          </div>
          <PitLossPanel playerLap={playerLap} lapData={ctx.lapData} pitLossSec={pitLossSec} />
        </div>
      </div>

      {/* Lap Comparison */}
      <div className="panel" style={{ marginTop: 'var(--gap)' }}>
        <h3 className="panel-title">2-LAP COMPARISON</h3>
        <div className="analysis-compare-toolbar">
          <div className="settings-field">
            <label>Lap A</label>
            <select className="settings-input" value={compareLapA ?? ''}
              onChange={(e) => setCompareLapA(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select lap</option>
              {lapNumbers.map((n) => <option key={n} value={n}>Lap {n}</option>)}
            </select>
          </div>
          <div className="settings-field">
            <label>Lap B</label>
            <select className="settings-input" value={compareLapB ?? ''}
              onChange={(e) => setCompareLapB(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Select lap</option>
              {lapNumbers.map((n) => <option key={n} value={n}>Lap {n}</option>)}
            </select>
          </div>
          <button className="btn-action secondary" onClick={swapLaps}>Swap</button>
        </div>

        {lapA && lapB ? (
          <div className="analysis-compare-content">
            <div className="analysis-compare-pills">
              <span className="analysis-compare-pill" style={{ color: '#00d2be' }}>
                Lap {lapA.lapNumber}: {formatTime(lapA.lapTimeMs)}
              </span>
              <span className="analysis-compare-pill" style={{ color: '#ff8700' }}>
                Lap {lapB.lapNumber}: {formatTime(lapB.lapTimeMs)}
              </span>
              <span className="analysis-compare-pill" style={{
                color: lapB.lapTimeMs - lapA.lapTimeMs <= 0 ? '#39b54a' : '#dc0000',
              }}>
                Delta: {formatDelta(lapB.lapTimeMs - lapA.lapTimeMs)}
              </span>
              {lapA.tyreWearEndPct && (
                <span className="analysis-compare-pill dim">Wear A: {formatWear(lapA.tyreWearEndPct)}</span>
              )}
              {lapB.tyreWearEndPct && (
                <span className="analysis-compare-pill dim">Wear B: {formatWear(lapB.tyreWearEndPct)}</span>
              )}
            </div>
            <LapCompareChart lapA={lapA} lapB={lapB} />
          </div>
        ) : (
          <div className="page-empty-inline">Select two laps above to compare sector times.</div>
        )}
      </div>

      {/* Full lap table */}
      <div style={{ marginTop: 'var(--gap)' }}>
        <LapTable completedLaps={completedLaps} bestLapMs={bestLapMs} />
      </div>
    </div>
  );
}

function StatRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="stat-row-item">
      <span className="stat-label-text">{label}</span>
      <span className={`stat-value-text ${valueClass || ''}`}>{value}</span>
    </div>
  );
}
