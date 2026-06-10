/**
 * Dashboard — "Mission Control" View
 *
 * Real-time telemetry dashboard with:
 * - Speed/Gear/RPM hero display
 * - Pedal inputs (throttle/brake/clutch)
 * - Tyre status (surface + carcass temps, wear, pressure, blisters)
 * - Fuel & ERS gauges
 * - Damage matrix (mini car diagram)
 * - AI wear prediction panel
 * - Pace analysis with delta to purple
 * - ERS recommendation strip
 * - Brake bias tracker
 * - Race control messages
 */

import React, { useMemo } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { LaunchGuide } from '../components/LaunchGuide';
import { RadioMessages } from '../components/RadioMessages';
import type { TyreArray, CarDamage } from '../../shared/types/packets';
import type { WearPrediction, ErsAnalysis } from '../../shared/types/store';
import { ErsRecommendation } from '../../shared/types/store';

// ── Constants ──

const MAX_ERS_STORE = 4_000_000;
const TYRE_LABELS: TyreArray<string> = ['RL', 'RR', 'FL', 'FR'];
const COMPOUND_NAMES: Record<number, { label: string; color: string }> = {
  16: { label: 'S', color: '#FF3333' },
  17: { label: 'M', color: '#FFD700' },
  18: { label: 'H', color: '#CCCCCC' },
  7:  { label: 'I', color: '#39B54A' },
  8:  { label: 'W', color: '#4477FF' },
};

// ── Utility Functions ──

function formatTime(ms: number): string {
  if (ms <= 0) return '--:--.---';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function wearColor(wear: number): string {
  if (wear < 30) return '#39b54a';
  if (wear < 50) return '#ffd700';
  if (wear < 65) return '#ff8700';
  return '#dc0000';
}

function tempColor(temp: number, optimal: [number, number] = [85, 105]): string {
  if (temp < optimal[0]) return '#4477FF'; // Cold
  if (temp <= optimal[1]) return '#39b54a'; // Optimal
  if (temp <= optimal[1] + 15) return '#ff8700'; // Hot
  return '#dc0000'; // Critical
}

function damageColor(pct: number): string {
  if (pct === 0) return '#1a1a2e';
  if (pct < 20) return '#39b54a';
  if (pct < 50) return '#ffd700';
  if (pct < 75) return '#ff8700';
  return '#dc0000';
}

// ── Sub-Components ──

function SpeedHero({ speed, gear, rpm, maxRpm, revPercent }: {
  speed: number; gear: number; rpm: number; maxRpm: number; revPercent: number;
}) {
  const gearLabel = gear === -1 ? 'R' : gear === 0 ? 'N' : String(gear);

  return (
    <div className="hero-panel">
      <div className="speed-display">
        <span className="speed-value">{speed}</span>
        <span className="speed-unit">KPH</span>
      </div>
      <div className="gear-display">
        <span className="gear-value">{gearLabel}</span>
      </div>
      <div className="rpm-bar-container">
        <div className="rpm-bar" style={{ width: `${clamp(revPercent, 0, 100)}%` }} />
        <div className="rpm-lights">
          {Array.from({ length: 15 }, (_, i) => (
            <div
              key={i}
              className={`rpm-light ${revPercent >= (i + 1) * 6.67 ? 'active' : ''}`}
              style={{
                backgroundColor: revPercent >= (i + 1) * 6.67
                  ? i < 5 ? '#39b54a' : i < 10 ? '#ffd700' : '#dc0000'
                  : '#1a1a2e',
              }}
            />
          ))}
        </div>
        <span className="rpm-text">{rpm.toLocaleString()} RPM</span>
      </div>
    </div>
  );
}

function PedalInputs({ throttle, brake, clutch, steer }: {
  throttle: number; brake: number; clutch: number; steer: number;
}) {
  return (
    <div className="pedal-panel">
      <div className="pedal">
        <div className="pedal-bar-track">
          <div className="pedal-bar throttle" style={{ height: `${throttle * 100}%` }} />
        </div>
        <span className="pedal-label">THR</span>
        <span className="pedal-value">{Math.round(throttle * 100)}%</span>
      </div>
      <div className="pedal">
        <div className="pedal-bar-track">
          <div className="pedal-bar brake" style={{ height: `${brake * 100}%` }} />
        </div>
        <span className="pedal-label">BRK</span>
        <span className="pedal-value">{Math.round(brake * 100)}%</span>
      </div>
      <div className="pedal">
        <div className="pedal-bar-track">
          <div className="pedal-bar clutch" style={{ height: `${clutch}%` }} />
        </div>
        <span className="pedal-label">CLT</span>
        <span className="pedal-value">{clutch}%</span>
      </div>
      <div className="steering-indicator">
        <div className="steer-bar" style={{ transform: `translateX(${steer * 50}%)` }} />
      </div>
    </div>
  );
}

function TyreCard({ index, wear, surfaceTemp, innerTemp, pressure, blisters, brakeDamage, brakeTemp, compound }: {
  index: number;
  wear: number;
  surfaceTemp: number;
  innerTemp: number;
  pressure: number;
  blisters: number;
  brakeDamage: number;
  brakeTemp: number;
  compound: number;
}) {
  const compoundInfo = COMPOUND_NAMES[compound] ?? { label: '?', color: '#888' };
  const tempDelta = Math.abs(innerTemp - surfaceTemp);

  return (
    <div className="tyre-card" style={{ borderColor: wearColor(wear) }}>
      <div className="tyre-header">
        <span className="tyre-label">{TYRE_LABELS[index]}</span>
        <span className="tyre-compound" style={{ color: compoundInfo.color }}>{compoundInfo.label}</span>
      </div>
      <div className="tyre-wear">
        <div className="wear-bar-track">
          <div className="wear-bar" style={{ width: `${100 - wear}%`, backgroundColor: wearColor(wear) }} />
        </div>
        <span className="wear-pct">{wear.toFixed(1)}%</span>
      </div>
      <div className="tyre-temps">
        <div className="temp-row">
          <span className="temp-label">Surface</span>
          <span className="temp-value" style={{ color: tempColor(surfaceTemp) }}>{surfaceTemp}°C</span>
        </div>
        <div className="temp-row">
          <span className="temp-label">Carcass</span>
          <span className="temp-value" style={{ color: tempColor(innerTemp) }}>{innerTemp}°C</span>
        </div>
        {tempDelta > 10 && (
          <div className="temp-warning">
            ⚠ Δ{tempDelta}°C — {surfaceTemp > innerTemp ? 'Sliding' : 'Setup issue'}
          </div>
        )}
      </div>
      <div className="tyre-details">
        <span>PSI: {pressure.toFixed(1)}</span>
        {blisters > 0 && <span className="blister-warn">Blisters: {blisters}%</span>}
        <span>Brake: <span style={{ color: tempColor(brakeTemp, [200, 800]) }}>{brakeTemp}°C</span></span>
        {brakeDamage > 0 && <span style={{ color: damageColor(brakeDamage) }}>Brake Dmg: {brakeDamage}%</span>}
      </div>
    </div>
  );
}

function TyreGrid({ telemetry, damage, status }: {
  telemetry: NonNullable<ReturnType<typeof useTelemetryContext>['telemetry']>;
  damage: NonNullable<ReturnType<typeof useTelemetryContext>['damage']>;
  status: NonNullable<ReturnType<typeof useTelemetryContext>['status']>;
}) {
  // Grid: FL FR on top, RL RR on bottom — but array order is RL=0,RR=1,FL=2,FR=3
  return (
    <div className="tyre-grid">
      <div className="tyre-row">
        <TyreCard index={2} wear={damage.tyresWear[2]} surfaceTemp={telemetry.tyreSurfaceTemp[2]}
          innerTemp={telemetry.tyreInnerTemp[2]} pressure={telemetry.tyrePressure[2]}
          blisters={damage.tyreBlisters[2]} brakeDamage={damage.brakesDamage[2]}
          brakeTemp={telemetry.brakesTemp[2]} compound={status.visualTyreCompound} />
        <TyreCard index={3} wear={damage.tyresWear[3]} surfaceTemp={telemetry.tyreSurfaceTemp[3]}
          innerTemp={telemetry.tyreInnerTemp[3]} pressure={telemetry.tyrePressure[3]}
          blisters={damage.tyreBlisters[3]} brakeDamage={damage.brakesDamage[3]}
          brakeTemp={telemetry.brakesTemp[3]} compound={status.visualTyreCompound} />
      </div>
      <div className="tyre-row">
        <TyreCard index={0} wear={damage.tyresWear[0]} surfaceTemp={telemetry.tyreSurfaceTemp[0]}
          innerTemp={telemetry.tyreInnerTemp[0]} pressure={telemetry.tyrePressure[0]}
          blisters={damage.tyreBlisters[0]} brakeDamage={damage.brakesDamage[0]}
          brakeTemp={telemetry.brakesTemp[0]} compound={status.visualTyreCompound} />
        <TyreCard index={1} wear={damage.tyresWear[1]} surfaceTemp={telemetry.tyreSurfaceTemp[1]}
          innerTemp={telemetry.tyreInnerTemp[1]} pressure={telemetry.tyrePressure[1]}
          blisters={damage.tyreBlisters[1]} brakeDamage={damage.brakesDamage[1]}
          brakeTemp={telemetry.brakesTemp[1]} compound={status.visualTyreCompound} />
      </div>
    </div>
  );
}

function FuelGauge({ fuelInTank, fuelCapacity, fuelRemainingLaps }: {
  fuelInTank: number; fuelCapacity: number; fuelRemainingLaps: number;
}) {
  const fuelPct = (fuelInTank / Math.max(fuelCapacity, 1)) * 100;

  return (
    <div className="gauge-panel fuel-gauge">
      <h3>FUEL</h3>
      <div className="gauge-bar-track">
        <div className="gauge-bar" style={{
          width: `${clamp(fuelPct, 0, 100)}%`,
          backgroundColor: fuelPct < 10 ? '#dc0000' : fuelPct < 25 ? '#ff8700' : '#39b54a',
        }} />
      </div>
      <div className="gauge-stats">
        <span>{fuelInTank.toFixed(1)} kg</span>
        <span>{fuelRemainingLaps.toFixed(1)} laps</span>
      </div>
    </div>
  );
}

const ERS_MODE_NAMES: Record<number, string> = { 0: 'NONE', 1: 'MEDIUM', 2: 'HOTLAP', 3: 'BOOST' };

function ErsGauge({ status, telemetry2, analysis }: {
  status: NonNullable<ReturnType<typeof useTelemetryContext>['status']>;
  telemetry2: ReturnType<typeof useTelemetryContext>['telemetry2'];
  analysis: ErsAnalysis | null;
}) {
  const storePct = (status.ersStoreEnergy / MAX_ERS_STORE) * 100;
  // Reference the per-lap budget against the FIA harvest limit when the game
  // reports one (2026) — dividing by the full 4 MJ store made "Deploy" look
  // permanently tiny.
  const lapRefJ = status.ersHarvestLimitPerLap && status.ersHarvestLimitPerLap > 0
    ? status.ersHarvestLimitPerLap
    : MAX_ERS_STORE;
  const deployedPct = (status.ersDeployedThisLap / lapRefJ) * 100;
  const harvestedJ = (status.ersHarvestedMGUK ?? 0) + (status.ersHarvestedMGUH ?? 0);
  const harvestedPct = (harvestedJ / lapRefJ) * 100;
  const modeName = ERS_MODE_NAMES[status.ersDeployMode] ?? '?';
  const totalHp = Math.round((status.enginePowerICE + status.enginePowerMGUK) / 745.7);

  const recColor: Record<string, string> = {
    [ErsRecommendation.Push]: '#39b54a',
    [ErsRecommendation.Overtake]: '#00d2be',
    [ErsRecommendation.Defend]: '#ff8700',
    [ErsRecommendation.Conserve]: '#dc0000',
    [ErsRecommendation.Neutral]: '#888',
  };

  return (
    <div className="gauge-panel ers-gauge">
      <h3>
        ERS <span className="ers-mode-badge">{modeName}</span>
        {telemetry2?.overtakeActive === 1 && <span className="ers-ot-badge active">OVERTAKE</span>}
        {telemetry2?.overtakeActive !== 1 && telemetry2?.overtakeAvailable === 1 && (
          <span className="ers-ot-badge">OT ARMED</span>
        )}
        {telemetry2 && (
          <span className="ers-aero-badge">{telemetry2.activeAeroMode === 1 ? 'AERO: STRAIGHT' : 'AERO: CORNER'}</span>
        )}
      </h3>
      <div className="ers-bars">
        <div className="ers-bar-group">
          <span className="ers-bar-label">Store</span>
          <div className="gauge-bar-track">
            <div className="gauge-bar" style={{
              width: `${clamp(storePct, 0, 100)}%`,
              backgroundColor: '#00d2be',
            }} />
          </div>
          <span className="ers-bar-value">{storePct.toFixed(0)}%</span>
        </div>
        <div className="ers-bar-group">
          <span className="ers-bar-label">Deploy</span>
          <div className="gauge-bar-track">
            <div className="gauge-bar" style={{
              width: `${clamp(deployedPct, 0, 100)}%`,
              backgroundColor: '#ffd700',
            }} />
          </div>
          <span className="ers-bar-value">{(status.ersDeployedThisLap / 1e6).toFixed(1)}MJ</span>
        </div>
        <div className="ers-bar-group">
          <span className="ers-bar-label">Harvest</span>
          <div className="gauge-bar-track">
            <div className="gauge-bar" style={{
              width: `${clamp(harvestedPct, 0, 100)}%`,
              backgroundColor: '#39b54a',
            }} />
          </div>
          <span className="ers-bar-value">
            {(harvestedJ / 1e6).toFixed(1)}
            {status.ersHarvestLimitPerLap ? `/${(status.ersHarvestLimitPerLap / 1e6).toFixed(1)}` : ''}MJ
          </span>
        </div>
      </div>
      <div className="ers-power">
        <span>ICE: {(status.enginePowerICE / 1000).toFixed(0)}kW</span>
        <span>MGU-K: {(status.enginePowerMGUK / 1000).toFixed(0)}kW</span>
        <span>{totalHp} hp</span>
      </div>
      {analysis && (
        <div className="ers-recommendation" style={{ borderColor: recColor[analysis.recommendation] }}>
          <span className="ers-rec-mode" style={{ color: recColor[analysis.recommendation] }}>
            {analysis.recommendation}
          </span>
          <span className="ers-rec-reason">{analysis.reason}</span>
        </div>
      )}
    </div>
  );
}

function DamageMatrix({ damage }: { damage: CarDamage }) {
  const zones = [
    { label: 'FL Wing', value: damage.frontLeftWingDamage },
    { label: 'FR Wing', value: damage.frontRightWingDamage },
    { label: 'Rear Wing', value: damage.rearWingDamage },
    { label: 'Floor', value: damage.floorDamage },
    { label: 'Diffuser', value: damage.diffuserDamage },
    { label: 'Sidepod', value: damage.sidepodDamage },
    { label: 'Engine', value: damage.engineDamage },
    { label: 'Gearbox', value: damage.gearBoxDamage },
  ];

  const powerUnit = [
    { label: 'ICE', value: damage.engineICEWear },
    { label: 'MGU-H', value: damage.engineMGUHWear },
    { label: 'MGU-K', value: damage.engineMGUKWear },
    { label: 'TC', value: damage.engineTCWear },
    { label: 'CE', value: damage.engineCEWear },
    { label: 'ES', value: damage.engineESWear },
  ];

  return (
    <div className="damage-panel">
      <h3>DAMAGE</h3>
      {(damage.engineBlown === 1 || damage.engineSeized === 1) && (
        <div className="critical-alert">
          {damage.engineBlown === 1 && '🔴 ENGINE BLOWN'}
          {damage.engineSeized === 1 && '🔴 ENGINE SEIZED'}
        </div>
      )}
      {damage.drsFault === 1 && <div className="fault-badge">DRS FAULT</div>}
      {damage.ersFault === 1 && <div className="fault-badge">ERS FAULT</div>}
      <div className="damage-grid">
        {zones.map((z) => (
          <div key={z.label} className="damage-cell">
            <span className="damage-label">{z.label}</span>
            <div className="damage-bar-track">
              <div className="damage-bar" style={{
                width: `${z.value}%`,
                backgroundColor: damageColor(z.value),
              }} />
            </div>
            <span className="damage-value" style={{ color: damageColor(z.value) }}>{z.value}%</span>
          </div>
        ))}
      </div>
      <h4>Power Unit Wear</h4>
      <div className="damage-grid pu-grid">
        {powerUnit.map((p) => (
          <div key={p.label} className="damage-cell">
            <span className="damage-label">{p.label}</span>
            <div className="damage-bar-track">
              <div className="damage-bar" style={{
                width: `${p.value}%`,
                backgroundColor: wearColor(p.value),
              }} />
            </div>
            <span className="damage-value">{p.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WearPredictionPanel({ prediction, currentLap }: {
  prediction: WearPrediction; currentLap: number;
}) {
  return (
    <div className="prediction-panel">
      <h3>TYRE PREDICTION</h3>
      <div className="prediction-confidence">
        Confidence: {(prediction.confidence * 100).toFixed(0)}%
      </div>
      <div className="prediction-grid">
        {TYRE_LABELS.map((label, i) => {
          const lapBelow40 = prediction.predictedLapBelow40[i];
          const lapsLeft = lapBelow40 !== null ? lapBelow40 - currentLap : null;
          const urgent = lapsLeft !== null && lapsLeft <= 3;

          return (
            <div key={label} className={`prediction-cell ${urgent ? 'urgent' : ''}`}>
              <span className="prediction-tyre">{label}</span>
              <span className="prediction-grip" style={{ color: wearColor(100 - prediction.currentGrip[i]) }}>
                Grip: {prediction.currentGrip[i].toFixed(0)}%
              </span>
              <span className="prediction-rate">
                {prediction.wearRatePerLap[i].toFixed(2)}%/lap
              </span>
              <span className="prediction-cliff">
                {lapBelow40 !== null
                  ? `Cliff: Lap ${lapBelow40} (${lapsLeft} laps)`
                  : 'No cliff predicted'
                }
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PacePanel({ analysis }: {
  analysis: NonNullable<ReturnType<typeof useTelemetryContext>['intelligence']['paceAnalysis']>;
}) {
  const ub = analysis.ultimateBest;
  const delta = analysis.deltaToUltimate;

  return (
    <div className="pace-panel">
      <h3>PACE ANALYSIS</h3>
      <div className="sector-comparison">
        <div className="sector-header">
          <span></span>
          <span>Purple</span>
          <span>Your Best</span>
          <span>Delta</span>
        </div>
        {['S1', 'S2', 'S3'].map((sector, i) => {
          const purpleMs = [ub.sector1Ms, ub.sector2Ms, ub.sector3Ms][i];
          const personalMs = analysis.personalBest
            ? [analysis.personalBest.sector1Ms, analysis.personalBest.sector2Ms, analysis.personalBest.sector3Ms][i]
            : null;
          const deltaMs = delta
            ? [delta.sector1Ms, delta.sector2Ms, delta.sector3Ms][i]
            : null;

          return (
            <div key={sector} className="sector-row">
              <span className="sector-label">{sector}</span>
              <span className="purple-time">{purpleMs < Infinity ? formatTime(purpleMs) : '--'}</span>
              <span className="personal-time">{personalMs ? formatTime(personalMs) : '--'}</span>
              <span className={`delta-time ${deltaMs && deltaMs > 0 ? 'slower' : 'faster'}`}>
                {deltaMs !== null ? `${deltaMs > 0 ? '+' : ''}${(deltaMs / 1000).toFixed(3)}` : '--'}
              </span>
            </div>
          );
        })}
      </div>
      {analysis.suggestion && (
        <div className="pace-suggestion">{analysis.suggestion}</div>
      )}
    </div>
  );
}

// ── Main Dashboard ──

export function Dashboard() {
  const ctx = useTelemetryContext();
  const { telemetry, telemetry2, status, damage, session, lapData, playerCarIndex, intelligence } = ctx;
  const playerLap = lapData[playerCarIndex];

  // No data state
  if (!telemetry || !status) {
    return (
      <div className="dashboard no-data">
        <div className="no-data-message">
          <h2>APEX ENGINEER</h2>
          <p>Waiting for telemetry data...</p>
          <p className="no-data-hint">
            Telemetry listens automatically — start an F1 25 / F1 26 session.
            If nothing arrives, check the game's UDP settings (port 20777) and Windows Firewall.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <LaunchGuide />

      {/* Row 1: Hero + Pedals */}
      <div className="dashboard-row hero-row">
        <SpeedHero
          speed={telemetry.speed}
          gear={telemetry.gear}
          rpm={telemetry.engineRPM}
          maxRpm={status.maxRPM}
          revPercent={telemetry.revLightsPercent}
        />
        <PedalInputs
          throttle={telemetry.throttle}
          brake={telemetry.brake}
          clutch={telemetry.clutch}
          steer={telemetry.steer}
        />
        {/* Position & Lap Info */}
        <div className="position-panel">
          <div className="position-big">P{playerLap?.carPosition ?? '-'}</div>
          <div className="lap-info">
            <span>Lap {playerLap?.currentLapNum ?? '-'}{session ? ` / ${session.totalLaps}` : ''}</span>
            <span>Last: {formatTime(playerLap?.lastLapTimeMs ?? 0)}</span>
            <span>Delta P1: {playerLap && playerLap.deltaToLeaderMs > 0
              ? `+${(playerLap.deltaToLeaderMs / 1000).toFixed(1)}s`
              : 'Leader'
            }</span>
            <span>Gap: {playerLap && playerLap.deltaToCarAheadMs > 0
              ? `${(playerLap.deltaToCarAheadMs / 1000).toFixed(1)}s`
              : '--'
            }</span>
          </div>
          <div className="brake-bias-display">
            BB: {status.frontBrakeBias}% F
          </div>
        </div>
      </div>

      {/* Row 2: Tyres + Fuel/ERS */}
      <div className="dashboard-row data-row">
        {damage && (
          <TyreGrid telemetry={telemetry} damage={damage} status={status} />
        )}
        <div className="gauges-column">
          <FuelGauge
            fuelInTank={status.fuelInTank}
            fuelCapacity={status.fuelCapacity}
            fuelRemainingLaps={status.fuelRemainingLaps}
          />
          <ErsGauge status={status} telemetry2={telemetry2} analysis={intelligence.ersAnalysis} />
        </div>
      </div>

      {/* Row 3: Intelligence panels */}
      <div className="dashboard-row intel-row">
        {damage && <DamageMatrix damage={damage} />}

        {intelligence.wearPrediction && intelligence.wearPrediction.confidence > 0 && (
          <WearPredictionPanel
            prediction={intelligence.wearPrediction}
            currentLap={playerLap?.currentLapNum ?? 0}
          />
        )}

        {intelligence.paceAnalysis && intelligence.paceAnalysis.ultimateBest.sector1Ms < Infinity && (
          <PacePanel analysis={intelligence.paceAnalysis} />
        )}

        {intelligence.pitStrategy && (
          <div className="strategy-panel">
            <h3>PIT STRATEGY</h3>
            <div className="strategy-info">
              <span>Window: Lap {intelligence.pitStrategy.idealLap} - {intelligence.pitStrategy.latestLap}</span>
              {intelligence.pitStrategy.rejoinPosition && (
                <span className="rejoin-position">
                  Pit now → P{intelligence.pitStrategy.rejoinPosition}
                  {intelligence.pitStrategy.rejoinGap !== null && ` (${intelligence.pitStrategy.rejoinGap.toFixed(1)}s gap)`}
                </span>
              )}
              <span className="strategy-reason">{intelligence.pitStrategy.reason}</span>
            </div>
          </div>
        )}

        <RadioMessages />
      </div>
    </div>
  );
}
