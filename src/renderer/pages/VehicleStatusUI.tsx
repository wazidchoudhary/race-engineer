import React, { useState } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { TyreLifeEstimator } from '../components/TyreLifeEstimator';
import type { CarDamage, TyreArray } from '../../shared/types/packets';

const MAX_ERS = 4_000_000;
const TYRE_LABELS: TyreArray<string> = ['RL', 'RR', 'FL', 'FR'];
const DISPLAY_ORDER = [2, 3, 0, 1]; // FL, FR, RL, RR for display grid

const COMPOUND_NAMES: Record<number, { label: string; color: string }> = {
  16: { label: 'Soft', color: '#FF3333' },
  17: { label: 'Medium', color: '#FFD700' },
  18: { label: 'Hard', color: '#CCCCCC' },
  7:  { label: 'Inter', color: '#39B54A' },
  8:  { label: 'Wet', color: '#4477FF' },
};

// Game enum order: 0=None, 1=Medium, 2=Hotlap, 3=Boost (ex-Overtake).
const ERS_MODES = ['None', 'Medium', 'Hotlap', 'Boost'];
const FUEL_MIXES = ['Lean', 'Standard', 'Rich', 'Max'];

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function dmgColor(pct: number): string {
  if (pct < 10) return '#39b54a';
  if (pct < 30) return '#ffd700';
  if (pct < 60) return '#ff8700';
  return '#dc0000';
}

function wearColor(pct: number): string {
  if (pct < 30) return '#39b54a';
  if (pct < 50) return '#ffd700';
  if (pct < 65) return '#ff8700';
  return '#dc0000';
}

function tempColor(temp: number, optimal: [number, number] = [85, 105]): string {
  if (temp < optimal[0]) return '#4477FF';
  if (temp <= optimal[1]) return '#39b54a';
  if (temp <= optimal[1] + 15) return '#ff8700';
  return '#dc0000';
}

function DamageBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="dmg-bar-row">
      <span className="dmg-bar-label">{label}</span>
      <div className="dmg-bar-track">
        <div className="dmg-bar-fill" style={{ width: `${clamp(pct, 0, 100)}%`, backgroundColor: dmgColor(pct) }} />
      </div>
      <span className="dmg-bar-value" style={{ color: dmgColor(pct) }}>{Math.round(pct)}%</span>
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="veh-stat-row">
      <span className="veh-stat-label">{label}</span>
      <span className="veh-stat-value" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

export function VehicleStatus() {
  const { telemetry, status, damage, setup, playerCarIndex } = useTelemetryContext();
  const [tab, setTab] = useState<'overview' | 'setup'>('overview');

  if (!telemetry || !status) {
    return (
      <div className="page-empty">
        <h2>VEHICLE STATUS</h2>
        <p>Waiting for telemetry data...</p>
      </div>
    );
  }

  const gearLabel = telemetry.gear === -1 ? 'R' : telemetry.gear === 0 ? 'N' : String(telemetry.gear);
  const ersPct = clamp((status.ersStoreEnergy / MAX_ERS) * 100, 0, 100);
  const fuelPct = clamp((status.fuelInTank / Math.max(status.fuelCapacity, 1)) * 100, 0, 100);
  const compInfo = COMPOUND_NAMES[status.visualTyreCompound];

  return (
    <div className="vehicle-page">
      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={`tab-btn ${tab === 'setup' ? 'active' : ''}`} onClick={() => setTab('setup')}>
          Car Setup
        </button>
      </div>

      {tab === 'overview' ? (
        <div className="vehicle-overview">
          {/* Motion & Telemetry */}
          <div className="vehicle-grid">
            <div className="panel">
              <h3 className="panel-title">MOTION</h3>
              <div className="stat-list">
                <StatItem label="Speed" value={`${telemetry.speed} km/h`} />
                <StatItem label="Gear" value={gearLabel} />
                <StatItem label="RPM" value={`${telemetry.engineRPM.toLocaleString()}`} />
                <StatItem label="Engine" value={`${telemetry.engineTemp}°C`}
                  color={tempColor(telemetry.engineTemp, [80, 110])} />
                <StatItem label="Throttle" value={`${(telemetry.throttle * 100).toFixed(1)}%`} />
                <StatItem label="Brake" value={`${(telemetry.brake * 100).toFixed(1)}%`} />
                <StatItem label="Steer" value={`${(telemetry.steer * 100).toFixed(1)}%`} />
                <StatItem label="DRS" value={telemetry.drs ? 'ON' : 'OFF'}
                  color={telemetry.drs ? '#39b54a' : '#888'} />
              </div>
            </div>

            {/* Tyre Surface Temps */}
            <div className="panel">
              <h3 className="panel-title">TYRE TEMPERATURES</h3>
              <div className="tyre-temp-grid">
                {DISPLAY_ORDER.map(idx => (
                  <div key={idx} className="tyre-temp-cell">
                    <div className="tyre-temp-circle" style={{
                      borderColor: tempColor(telemetry.tyreSurfaceTemp[idx]),
                    }}>
                      <span className="tyre-temp-val"
                        style={{ color: tempColor(telemetry.tyreSurfaceTemp[idx]) }}>
                        {telemetry.tyreSurfaceTemp[idx]}°
                      </span>
                    </div>
                    <span className="tyre-temp-label">{TYRE_LABELS[idx]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tyre Detail */}
            <div className="panel">
              <h3 className="panel-title">TYRE DETAIL</h3>
              <div className="tyre-detail-grid">
                {DISPLAY_ORDER.map(idx => {
                  const wear = damage ? damage.tyresWear[idx] : 0;
                  const blisters = damage?.tyreBlisters?.[idx] ?? 0;
                  return (
                    <div key={idx} className="tyre-detail-cell">
                      <div className="tyre-detail-ring" style={{ borderColor: wearColor(wear) }}>
                        <span>{wear.toFixed(0)}%</span>
                      </div>
                      <span className="tyre-detail-label">{TYRE_LABELS[idx]}</span>
                      <span className="tyre-detail-sub">
                        {telemetry.tyreInnerTemp[idx]}°C inner
                      </span>
                      <span className="tyre-detail-sub">
                        {telemetry.tyrePressure[idx].toFixed(1)} PSI
                      </span>
                      {blisters > 0 && (
                        <span className="tyre-detail-sub" style={{
                          color: blisters > 60 ? '#dc0000' : blisters > 30 ? '#ff8700' : '#ffd700'
                        }}>
                          Blister {blisters}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Fuel, ERS, Damage */}
          <div className="vehicle-grid">
            <div className="panel">
              <h3 className="panel-title">FUEL</h3>
              <div className="gauge-bar-outer">
                <div className="gauge-bar-inner" style={{
                  width: `${fuelPct}%`,
                  backgroundColor: fuelPct < 10 ? '#dc0000' : fuelPct < 25 ? '#ff8700' : '#39b54a',
                }} />
              </div>
              <div className="stat-list">
                <StatItem label="In Tank" value={`${status.fuelInTank.toFixed(2)} kg`} />
                <StatItem label="Capacity" value={`${status.fuelCapacity.toFixed(1)} kg`} />
                <StatItem label="Laps Left" value={status.fuelRemainingLaps.toFixed(2)} />
              </div>
            </div>

            <div className="panel">
              <h3 className="panel-title">ERS</h3>
              <div className="gauge-bar-outer">
                <div className="gauge-bar-inner" style={{ width: `${ersPct}%`, backgroundColor: '#00d2be' }} />
              </div>
              <div className="stat-list">
                <StatItem label="Store" value={`${(status.ersStoreEnergy / 1e6).toFixed(2)} MJ (${ersPct.toFixed(0)}%)`} />
                <StatItem label="Mode" value={ERS_MODES[status.ersDeployMode] || 'None'} />
                <StatItem label="Deployed" value={`${(status.ersDeployedThisLap / 1e6).toFixed(2)} MJ`} />
                <StatItem label="Harvested K" value={`${(status.ersHarvestedMGUK / 1e6).toFixed(2)} MJ`} />
                <StatItem label="Harvested H" value={`${(status.ersHarvestedMGUH / 1e6).toFixed(2)} MJ`} />
                <StatItem label="ICE Power" value={`${(status.enginePowerICE / 1000).toFixed(0)} kW`} />
                <StatItem label="MGU-K Power" value={`${(status.enginePowerMGUK / 1000).toFixed(0)} kW`} />
              </div>
            </div>

            <TyreLifeEstimator />

            {damage && (
              <>
                <div className="panel">
                  <h3 className="panel-title">BODYWORK DAMAGE</h3>
                  {damage.engineBlown === 1 && <div className="critical-alert">ENGINE BLOWN</div>}
                  {damage.engineSeized === 1 && <div className="critical-alert">ENGINE SEIZED</div>}
                  {damage.drsFault === 1 && <div className="fault-badge">DRS FAULT</div>}
                  {damage.ersFault === 1 && <div className="fault-badge">ERS FAULT</div>}
                  <DamageBar label="FL Wing" pct={damage.frontLeftWingDamage} />
                  <DamageBar label="FR Wing" pct={damage.frontRightWingDamage} />
                  <DamageBar label="Rear Wing" pct={damage.rearWingDamage} />
                  <DamageBar label="Floor" pct={damage.floorDamage} />
                  <DamageBar label="Diffuser" pct={damage.diffuserDamage} />
                  <DamageBar label="Sidepod" pct={damage.sidepodDamage} />
                  <DamageBar label="Gearbox" pct={damage.gearBoxDamage} />
                </div>

                <div className="panel">
                  <h3 className="panel-title">POWER UNIT WEAR</h3>
                  <DamageBar label="ICE" pct={damage.engineICEWear} />
                  <DamageBar label="MGU-H" pct={damage.engineMGUHWear} />
                  <DamageBar label="MGU-K" pct={damage.engineMGUKWear} />
                  <DamageBar label="TC" pct={damage.engineTCWear} />
                  <DamageBar label="CE" pct={damage.engineCEWear} />
                  <DamageBar label="ES" pct={damage.engineESWear} />
                  <DamageBar label="Engine" pct={damage.engineDamage} />
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* Setup Tab */
        <div className="vehicle-setup">
          <div className="vehicle-grid">
            <div className="panel">
              <h3 className="panel-title">DRIVER AIDS</h3>
              <div className="stat-list">
                <StatItem label="Fuel Mix" value={FUEL_MIXES[status.fuelMix] || '-'} />
                <StatItem label="Front Brake Bias" value={`${status.frontBrakeBias}%`} />
                <StatItem label="Traction Control" value={['Off', 'Medium', 'Full'][status.tractionControl] || '-'} />
                <StatItem label="ABS" value={status.antiLockBrakes ? 'On' : 'Off'} />
                <StatItem label="Pit Limiter" value={status.pitLimiterStatus ? 'Active' : 'Off'}
                  color={status.pitLimiterStatus ? '#ff8700' : undefined} />
                <StatItem label="ERS Mode" value={ERS_MODES[status.ersDeployMode] || 'None'} />
                <StatItem label="DRS" value={status.drsAllowed ? 'Allowed' : 'Not Allowed'}
                  color={status.drsAllowed ? '#39b54a' : '#888'} />
              </div>
            </div>

            <div className="panel">
              <h3 className="panel-title">TYRE COMPOUND</h3>
              <div className="stat-list">
                <StatItem label="Visual" value={compInfo?.label || '?'}
                  color={compInfo?.color} />
                <StatItem label="Age" value={`${status.tyresAgeLaps} laps`} />
              </div>
              <h3 className="panel-title" style={{ marginTop: 16 }}>TYRE PRESSURES</h3>
              <div className="stat-list">
                {DISPLAY_ORDER.map(idx => (
                  <StatItem key={idx}
                    label={TYRE_LABELS[idx]}
                    value={`${telemetry.tyrePressure[idx].toFixed(1)} PSI`} />
                ))}
              </div>
              <h3 className="panel-title" style={{ marginTop: 16 }}>INNER TEMPERATURES</h3>
              <div className="stat-list">
                {DISPLAY_ORDER.map(idx => (
                  <StatItem key={idx}
                    label={TYRE_LABELS[idx]}
                    value={`${telemetry.tyreInnerTemp[idx]}°C`}
                    color={tempColor(telemetry.tyreInnerTemp[idx])} />
                ))}
              </div>
            </div>

            {setup && (
              <div className="panel">
                <h3 className="panel-title">SETUP</h3>
                <div className="stat-list">
                  <StatItem label="Front Wing" value={String(setup.frontWing ?? '-')} />
                  <StatItem label="Rear Wing" value={String(setup.rearWing ?? '-')} />
                  <StatItem label="Diff On Throttle" value={setup.onThrottle != null ? `${setup.onThrottle}%` : '-'} />
                  <StatItem label="Diff Off Throttle" value={setup.offThrottle != null ? `${setup.offThrottle}%` : '-'} />
                  <StatItem label="Front Camber" value={setup.frontCamber?.toFixed(2) ?? '-'} />
                  <StatItem label="Rear Camber" value={setup.rearCamber?.toFixed(2) ?? '-'} />
                  <StatItem label="Front Toe" value={setup.frontToe?.toFixed(3) ?? '-'} />
                  <StatItem label="Rear Toe" value={setup.rearToe?.toFixed(3) ?? '-'} />
                  <StatItem label="Front Suspension" value={String(setup.frontSuspension ?? '-')} />
                  <StatItem label="Rear Suspension" value={String(setup.rearSuspension ?? '-')} />
                  <StatItem label="Front ARB" value={String(setup.frontAntiRollBar ?? '-')} />
                  <StatItem label="Rear ARB" value={String(setup.rearAntiRollBar ?? '-')} />
                  <StatItem label="Brake Pressure" value={setup.brakePressure != null ? `${setup.brakePressure}%` : '-'} />
                  <StatItem label="Brake Bias" value={setup.brakeBias != null ? `${setup.brakeBias}%` : '-'} />
                  <StatItem label="Engine Braking" value={setup.engineBraking != null ? `${setup.engineBraking}%` : '-'} />
                  <StatItem label="Fuel Load" value={setup.fuelLoad != null ? `${setup.fuelLoad.toFixed(1)} kg` : '-'} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
