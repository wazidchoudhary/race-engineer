/**
 * Battery Coach — the 2026 energy-management trainer.
 *
 * Builds a per-lap ERS deployment plan for the current track and battery
 * state, renders it as a colour-coded lap strip with the live car position,
 * and (with Voice on) has the engineer call every action at the right point:
 * mode NONE through hairpins, Boost on exit until 7th gear, Medium through
 * fast corners, lift-and-coast 25-50 m before long braking zones.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useBatteryCoach, type CoachMode } from '../hooks/useBatteryCoach';
import { useRadio } from '../context/RadioContext';
import { speak, stop as ttsStop } from '../lib/tts-speaker';
import { api } from '../lib/tauri-api';
import { ERS_MODE_LABELS, MAX_ERS_STORE_J } from '../../shared/types/packets';
import type { PlanSegment } from '../../shared/intelligence/ers-coach';

const SEGMENT_COLORS: Record<PlanSegment['mode'], string> = {
  boost: '#00d2be',
  medium: '#ffd700',
  none: '#3a3a55',
  lift: '#dc4040',
  corner: '#8868d0',
};

const SEGMENT_LEGEND: { mode: PlanSegment['mode']; label: string }[] = [
  { mode: 'boost', label: 'Burn (Boost → Medium)' },
  { mode: 'medium', label: 'Medium sustain' },
  { mode: 'none', label: 'Bank energy' },
  { mode: 'lift', label: 'Lift & coast' },
  { mode: 'corner', label: 'Corner' },
];

const LEARN_CARDS: { title: string; body: string }[] = [
  {
    title: 'Why battery rules 2026',
    body: 'The 2026 cars are 50/50 combustion and electric — about 475 hp comes from the MGU-K. Manage the battery badly and you are slower everywhere; there is no hiding a flat battery.',
  },
  {
    title: 'Deploy on exit, never mid-corner',
    body: 'Deployment before the car is straight becomes wheelspin. Out of slow corners: grip first, then Boost until 7th gear (or high revs in 6th), then settle to Medium for the rest of the straight.',
  },
  {
    title: 'Hairpins are NONE zones',
    body: 'Through the slowest corners run mode NONE — you cannot use the power and the lift into them harvests. The win is the exit, not the corner.',
  },
  {
    title: 'Lift & coast: 25-50 m',
    body: 'Before long braking zones, lift 25-50 m before your normal braking point and coast. You lose almost no lap time and harvest a chunk every lap. Start with 50 m at the heaviest stops.',
  },
  {
    title: 'Cut deployment before braking',
    body: 'Deploying into a braking zone is pure waste. Kill deployment ~100 m before heavy stops — the energy does nothing and you want the battery hungry for the harvest.',
  },
  {
    title: 'Short bursts beat holding',
    body: 'Two to four second bursts on the best exits give most of the gain. Holding Boost the whole lap drains the per-lap allowance early and is 0.2-0.6 s/lap slower.',
  },
  {
    title: 'Overtake mode (2026)',
    body: 'Get within 1 s of the car ahead at a detection line and Overtake arms for the next lap: full power past the normal high-speed taper, plus extra harvest allowance. Save it for a real move.',
  },
  {
    title: 'Super-clipping is free charge',
    body: 'At the end of the longest straights the car force-harvests at top speed (you feel it as a speed loss). Don\'t fight it — lift slightly early and bank the energy on your terms.',
  },
  {
    title: 'Race vs Qualifying',
    body: 'Race: finish every lap above ~20% and never run dry — you spend what you harvest. Qualifying: start the flier at 100% (harvest the whole out-lap) and cross the line nearly empty.',
  },
];

function mj(j: number | undefined | null): string {
  return (((j ?? 0) / 1e6)).toFixed(2);
}

function hp(watts: number | undefined | null): number {
  return Math.round(((watts ?? 0) / 745.7));
}

export function BatteryCoach() {
  // Popout windows are muted — only the main window speaks coach calls.
  const { muted } = useRadio();
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [mode, setMode] = useState<CoachMode>('auto');
  const coach = useBatteryCoach(voiceEnabled && !muted, mode);
  const { plan, advice, status, telemetry, telemetry2, session, playerLap, storePct, harvestLimitJ } = coach;

  const [aiLesson, setAiLesson] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [premium, setPremium] = useState(false);
  useEffect(() => {
    api.getPremium?.().then((p) => setPremium(!!p?.premium)).catch(() => {});
  }, []);

  const askAiLesson = useCallback(async () => {
    if (!plan || aiBusy) return;
    setAiBusy(true);
    setAiLesson(null);
    try {
      const res = await api.askEngineer({
        question:
          `Teach me battery management for ${plan.trackName}, corner by corner, like a race engineer briefing a rookie before the session. ` +
          `Use this deployment plan and the track notes. Keep it under 180 words, plain speech, no lists.`,
        context: { strategy: plan.strategy, notes: plan.notes, segments: plan.segments.map((s) => ({ label: s.label, detail: s.detail })) },
        mode: 'DRIVER_RADIO',
      });
      const text = res?.response?.trim();
      if (text && !res?.error) {
        setAiLesson(text);
        if (voiceEnabled && !muted) speak(text, { priority: 5 });
      } else {
        setAiLesson(res?.message || res?.error || 'No response — check your API key in Settings.');
      }
    } catch (e: any) {
      setAiLesson(`Error: ${e?.message ?? e}`);
    } finally {
      setAiBusy(false);
    }
  }, [plan, aiBusy, voiceEnabled, muted]);

  const briefTrack = useCallback(() => {
    if (!plan) return;
    const lines = [
      `${plan.trackName} battery briefing.`,
      plan.strategy,
      ...plan.notes.slice(0, 2),
    ];
    speak(lines.join(' '), { priority: 5, interrupt: true });
  }, [plan]);

  const deployMode = status?.ersDeployMode ?? 0;
  const deployedJ = status?.ersDeployedThisLap ?? 0;
  const harvestedJ = (status?.ersHarvestedMGUK ?? 0) + (status?.ersHarvestedMGUH ?? 0);
  const lapPct = plan && playerLap
    ? Math.max(0, Math.min(1, (playerLap.lapDistance ?? 0) / plan.lengthM))
    : 0;
  const is2026 = (session?.packetFormat ?? 0) >= 2026 || !!telemetry2;
  const totalHp = hp((status?.enginePowerICE ?? 0) + (status?.enginePowerMGUK ?? 0));

  return (
    <div className="battery-coach-page">
      {/* Header */}
      <div className="engineer-header">
        <h2 className="engineer-title">Battery Coach</h2>
        {is2026 && <span className="model-badge">F1 26 · 2026 regs</span>}
        <div className="engineer-actions">
          <label
            className="toggle-label"
            title={muted
              ? 'Voice plays in the main window only (this is a popout)'
              : 'Engineer speaks battery calls at the right points on track'}
          >
            <input
              type="checkbox"
              checked={voiceEnabled && !muted}
              disabled={muted}
              onChange={(e) => { setVoiceEnabled(e.target.checked); if (!e.target.checked) ttsStop(); }}
            />
            Coach voice
          </label>
          <select
            className="coach-mode-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as CoachMode)}
            title="Race: spend what you harvest. Quali: spend it all."
          >
            <option value="auto">Auto ({coach.raceMode})</option>
            <option value="race">Race</option>
            <option value="quali">Quali</option>
          </select>
          <button className="btn-small" onClick={briefTrack} disabled={!plan}>🔊 Track briefing</button>
        </div>
      </div>

      {/* Status strip */}
      <div className="radio-status-strip">
        <div className="radio-status-item">
          <span className="radio-status-label">Battery</span>
          <span className={`radio-status-value ${storePct < 12 ? 'status-critical' : storePct < 30 ? 'status-warn' : ''}`}>
            {status ? `${storePct.toFixed(0)}%` : '--'}
          </span>
        </div>
        <div className="radio-status-item">
          <span className="radio-status-label">ERS Mode</span>
          <span className="radio-status-value">{status ? ERS_MODE_LABELS[deployMode] ?? deployMode : '--'}</span>
        </div>
        <div className="radio-status-item">
          <span className="radio-status-label">Deployed</span>
          <span className="radio-status-value">{status ? `${mj(deployedJ)} MJ` : '--'}</span>
        </div>
        <div className="radio-status-item">
          <span className="radio-status-label">Harvested</span>
          <span className="radio-status-value">
            {status ? `${mj(harvestedJ)}${harvestLimitJ ? ` / ${mj(harvestLimitJ)}` : ''} MJ` : '--'}
          </span>
        </div>
        <div className="radio-status-item">
          <span className="radio-status-label">Power</span>
          <span className="radio-status-value">
            {status ? `${totalHp} hp` : '--'}
            {status && <span className="dim"> ({hp(status.enginePowerMGUK)} elec)</span>}
          </span>
        </div>
        {is2026 && (
          <div className="radio-status-item">
            <span className="radio-status-label">Overtake</span>
            <span className={`radio-status-value ${telemetry2?.overtakeActive ? 'status-critical' : ''}`}>
              {telemetry2?.overtakeActive ? 'ACTIVE' : telemetry2?.overtakeAvailable ? 'ARMED' : '—'}
            </span>
          </div>
        )}
        {is2026 && (
          <div className="radio-status-item">
            <span className="radio-status-label">Active Aero</span>
            <span className="radio-status-value">
              {telemetry2 ? (telemetry2.activeAeroMode === 1 ? 'STRAIGHT' : 'CORNER') : '—'}
            </span>
          </div>
        )}
      </div>

      {!coach.connected || !session ? (
        <div className="coach-empty">
          <p>Waiting for telemetry. Start a session in F1 25/26 — the coach builds a battery plan the moment it knows the track.</p>
        </div>
      ) : !plan ? (
        <div className="coach-empty">
          <p>No battery intelligence for this layout yet. Drive a lap — if the game sends DRS zones (F1 26), a basic plan appears automatically.</p>
        </div>
      ) : (
        <>
          {/* Lap strip */}
          <div className="coach-strip-panel panel">
            <div className="coach-strip-header">
              <h3 className="panel-title">
                LAP PLAN — {plan.trackName}
                {plan.approximate && <span className="dim"> (approximate)</span>}
              </h3>
              <div className="coach-legend">
                {SEGMENT_LEGEND.map((l) => (
                  <span key={l.mode} className="coach-legend-item">
                    <span className="coach-legend-dot" style={{ background: SEGMENT_COLORS[l.mode] }} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
            <svg className="coach-strip" viewBox="0 0 1000 64" preserveAspectRatio="none">
              <rect x={0} y={22} width={1000} height={20} rx={4} fill="#22223a" />
              {plan.segments.map((s, i) => {
                const from = s.fromPct * 1000;
                const to = s.toPct * 1000;
                const segs = s.fromPct <= s.toPct
                  ? [[from, to - from]]
                  : [[from, 1000 - from], [0, to]];
                return segs.map(([x, w], j) => (
                  <rect
                    key={`${i}-${j}`}
                    x={x} y={22} width={Math.max(2, w)} height={20}
                    fill={SEGMENT_COLORS[s.mode]}
                    opacity={s.mode === 'none' ? 0.6 : 0.92}
                  >
                    <title>{s.label}: {s.detail}</title>
                  </rect>
                ));
              })}
              {plan.segments.filter((s) => s.mode === 'corner' && s.cornerNum != null).map((s, i) => (
                <text key={i} x={((s.fromPct + fwdHalf(s.fromPct, s.toPct)) % 1) * 1000} y={14}
                  fontSize={11} fill="#9aa" textAnchor="middle">
                  T{s.cornerNum}
                </text>
              ))}
              {/* Live car marker */}
              <polygon
                points={`${lapPct * 1000 - 6},58 ${lapPct * 1000 + 6},58 ${lapPct * 1000},46`}
                fill="#fff"
              />
            </svg>
          </div>

          {/* Now / Next advice */}
          <div className="coach-now-row">
            <div className="coach-now panel">
              <h3 className="panel-title">NOW</h3>
              <div className={`coach-now-text stance-${coach.stance}`}>
                {advice?.instruction ?? 'Follow the lap strip.'}
              </div>
              <div className="coach-stance dim">{advice?.stanceText}</div>
            </div>
            <div className="coach-next panel">
              <h3 className="panel-title">COMING UP</h3>
              {advice?.next ? (
                <div className="coach-next-text">
                  <span className="coach-next-dist">
                    {advice.nextInM != null ? `${Math.round(advice.nextInM)} m` : ''}
                  </span>
                  <span>{advice.next.label}</span>
                  <span className="dim">{advice.next.detail}</span>
                </div>
              ) : (
                <div className="dim">—</div>
              )}
            </div>
          </div>

          {/* Strategy + notes */}
          <div className="coach-strategy panel">
            <h3 className="panel-title">TRACK STRATEGY</h3>
            <p className="coach-strategy-text">{plan.strategy}</p>
            <ul className="coach-notes">
              {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
            <div className="coach-ai-row">
              <button className="btn-small" onClick={askAiLesson} disabled={aiBusy || !premium}
                title={premium ? 'Ask the AI engineer for a personalised track briefing' : 'Premium (API key in Settings) required'}>
                {aiBusy ? 'Briefing…' : '🤖 AI track lesson'}
              </button>
              {!premium && <span className="dim">Premium — add your API key in Settings</span>}
            </div>
            {aiLesson && <div className="coach-ai-lesson">{aiLesson}</div>}
          </div>

          {/* Recent coach calls */}
          <div className="coach-calls panel">
            <h3 className="panel-title">COACH CALLS</h3>
            {coach.calls.length === 0 ? (
              <div className="dim">Calls appear here as you drive — corner modes, burn zones, lift points, lap summaries.</div>
            ) : (
              <div className="coach-calls-list">
                {[...coach.calls].reverse().map((c, i) => (
                  <div key={`${c.at}-${i}`} className="coach-call">
                    <span className="radio-msg-time">
                      {new Date(c.at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span>{c.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Learning section — always visible */}
      <div className="coach-learn panel">
        <h3 className="panel-title">BATTERY SCHOOL</h3>
        <div className="coach-learn-grid">
          {LEARN_CARDS.map((card) => (
            <div key={card.title} className="coach-learn-card">
              <h4>{card.title}</h4>
              <p>{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Half the forward distance from a to b around the lap (for label centring). */
function fwdHalf(a: number, b: number): number {
  const d = ((b - a) % 1 + 1) % 1;
  return d / 2;
}
