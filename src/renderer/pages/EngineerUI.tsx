import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { useRadio } from '../context/RadioContext';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useStrategyCalls } from '../hooks/useStrategyCalls';
import { globalInteractionTracker } from '../lib/emergency-gate';
import { speak as ttsSpeakQueued } from '../lib/tts-speaker';
import { api, type StrategyDecision } from '../lib/tauri-api';
import { buildSnapshot, type TelemetrySources } from '../lib/strategy-pipeline';

const MAX_ERS = 4_000_000;

const COMPOUND_INFO: Record<number, { name: string; color: string }> = {
  16: { name: 'Soft',   color: '#FF3333' },
  17: { name: 'Medium', color: '#FFD700' },
  18: { name: 'Hard',   color: '#CCCCCC' },
  7:  { name: 'Inter',  color: '#39B54A' },
  8:  { name: 'Wet',    color: '#4477FF' },
};

const SC_LABELS: Record<number, string> = {
  0: 'Green', 1: 'Full SC', 2: 'Virtual SC', 3: 'Formation Lap',
};

export function Engineer() {
  const ctx = useTelemetryContext();
  const { lapData, playerCarIndex, status, damage, session, participants } = ctx;

  const [premium, setPremium] = useState(false);
  const [lastDecision, setLastDecision] = useState<StrategyDecision | null>(null);

  useEffect(() => {
    api.getPremium?.().then((p) => setPremium(!!p?.premium)).catch(() => {});
  }, []);

  // Auto-radio now lives in RadioContext at app level (voice works on every
  // page); this page renders the feed and owns the master Voice toggle.
  const { messages, clearMessages, ttsEnabled, setTtsEnabled, ttsVoice } = useRadio();

  // Strategy pipeline — feeds TelemetrySources
  const src: TelemetrySources = useMemo(() => ({
    connected: ctx.connected,
    session: ctx.session,
    lapData: ctx.lapData,
    telemetry: ctx.telemetry,
    status: ctx.status,
    damage: ctx.damage,
    allCarStatus: ctx.allCarStatus,
    allCarTelemetry: ctx.allCarTelemetry,
    allCarDamage: (ctx as any).allCarDamage ?? null,
    participants: ctx.participants,
    playerCarIndex: ctx.playerCarIndex,
    bestLapTimes: ctx.bestLapTimes ?? {},
  }), [ctx]);

  const strategy = useStrategyCalls({
    src, premium,
    onDecision: (d) => {
      setLastDecision(d);
      if (ttsEnabled && d.radioMessage) {
        const priority = d.urgency === 'critical' ? 10 : d.urgency === 'high' ? 8 : 5;
        ttsSpeakQueued(d.radioMessage, { voice: ttsVoice, priority, interrupt: d.urgency === 'critical' });
      }
    },
  });

  // Push-to-talk — dispatches user_ask with the transcript
  const ptt = usePushToTalk({
    onQuery: (t) => {
      setQuery('');
      sendQuery(t);
    },
  });

  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const playerLap = lapData?.[playerCarIndex];

  useEffect(() => {
    if (feedRef.current && messages.length > 0) feedRef.current.scrollTop = 0;
  }, [messages.length]);

  const sendQuery = useCallback(async (textParam?: string) => {
    const q = (textParam ?? query).trim();
    if (!q || loading) return;
    setQuery('');
    setLoading(true);
    setResponse(null);
    globalInteractionTracker.mark();

    // Free mode: skip API and hand to strategy pipeline (which will no-op for non-premium).
    if (!premium) {
      setResponse("Free mode: I'm using predefined radio calls only. Upgrade to Premium in Settings for dynamic strategy.");
      setLoading(false);
      return;
    }

    // Premium path: one prose call. (Routing the same question through the
    // structured strategy pipeline too caused double token spend and two
    // overlapping spoken replies.)
    try {
      const snapshot = buildSnapshot(src);
      const result = await api.askEngineer({ question: q, context: snapshot ?? {}, mode: 'DRIVER_RADIO' });
      if (result?.error === 'premium_required') {
        setResponse(result.message || 'Premium required.');
      } else if (result?.error) {
        setResponse(`Error: ${result.error}`);
      } else {
        setResponse(result?.response || 'No response');
        if (ttsEnabled && result?.response) {
          ttsSpeakQueued(result.response, { voice: ttsVoice, priority: 5, interrupt: true });
        }
      }
    } catch (err: any) {
      setResponse(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [query, loading, premium, src, ttsEnabled, ttsVoice]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(); }
  }, [sendQuery]);

  const proximity = useMemo(() => {
    if (!playerLap || !lapData) return null;
    const myPos = playerLap.carPosition;
    const carAheadIdx = lapData.findIndex((l) => l?.carPosition === myPos - 1);
    const carBehindIdx = lapData.findIndex((l) => l?.carPosition === myPos + 1);
    const gapAheadMs = playerLap.deltaToCarAheadMs;
    const gapBehindMs = carBehindIdx >= 0 ? lapData[carBehindIdx]?.deltaToCarAheadMs : 0;
    const aheadName = carAheadIdx >= 0 ? participants?.participants?.[carAheadIdx]?.name || `P${myPos - 1}` : null;
    const behindName = carBehindIdx >= 0 ? participants?.participants?.[carBehindIdx]?.name || `P${myPos + 1}` : null;
    const showAhead = aheadName && gapAheadMs > 0 && gapAheadMs < 1200;
    const showBehind = behindName && gapBehindMs > 0 && gapBehindMs < 1000;
    if (!showAhead && !showBehind) return null;
    return {
      aheadName: showAhead ? aheadName : null,
      aheadGap: showAhead ? (gapAheadMs / 1000).toFixed(2) : null,
      behindName: showBehind ? behindName : null,
      behindGap: showBehind ? (gapBehindMs / 1000).toFixed(2) : null,
    };
  }, [playerLap, lapData, participants]);

  const compound = status ? COMPOUND_INFO[status.visualTyreCompound] : null;
  const maxWear = damage ? Math.max(...damage.tyresWear.map((w: number) => Math.round(w))) : 0;
  const ersPct = status ? ((status.ersStoreEnergy / MAX_ERS) * 100).toFixed(0) : '--';
  const fuelLaps = status ? status.fuelRemainingLaps.toFixed(1) : '--';
  const gapAhead = playerLap && playerLap.deltaToCarAheadMs > 0
    ? `${(playerLap.deltaToCarAheadMs / 1000).toFixed(1)}s` : '--';
  const scLabel = session ? SC_LABELS[session.safetyCarStatus] || 'Green' : '--';

  const pttEngaged = ptt.listening;
  const pttLabel = ptt.binding ? (ptt.binding.label ?? `${ptt.binding.kind}:${ptt.binding.code}`) : 'unbound';

  return (
    <div className="engineer-page">
      {/* Header */}
      <div className="engineer-header">
        <h2 className="engineer-title">AI Race Engineer</h2>
        <span className="model-badge">{premium ? 'claude-haiku-4-5' : 'Free · Rules only'}</span>
        <div className="engineer-actions">
          <label className="toggle-label">
            <input type="checkbox" checked={ttsEnabled}
              onChange={(e) => setTtsEnabled(e.target.checked)} />
            Voice
          </label>
          <button className="btn-small" onClick={clearMessages}>Clear</button>
        </div>
      </div>

      {/* Status Strip */}
      <div className="radio-status-strip">
        <StatusItem label="Position" value={playerLap ? `P${playerLap.carPosition}` : '--'} />
        <StatusItem label="Lap" value={playerLap ? `${playerLap.currentLapNum}/${session?.totalLaps || ''}` : '--'} />
        <StatusItem label="Tyre"
          value={compound ? `${compound.name} (${status?.tyresAgeLaps}L)` : '--'}
          color={compound?.color} />
        <StatusItem label="Wear" value={damage ? `${maxWear}%` : '--'}
          warn={maxWear > 60} critical={maxWear > 80} />
        <StatusItem label="ERS" value={`${ersPct}%`} />
        <StatusItem label="Fuel" value={`${fuelLaps} laps`} />
        <StatusItem label="Gap Ahead" value={gapAhead} />
        <StatusItem label="Flags" value={scLabel} critical={session ? session.safetyCarStatus > 0 : false} />
      </div>

      {/* Proximity Bar */}
      {proximity && (
        <div className="proximity-bar">
          {proximity.aheadName && (
            <span className="prox-rival prox-attack">{proximity.aheadName} +{proximity.aheadGap}s</span>
          )}
          <span className="prox-me">YOU</span>
          {proximity.behindName && (
            <span className="prox-rival prox-defend">{proximity.behindName} -{proximity.behindGap}s</span>
          )}
        </div>
      )}

      {/* Strategy Decision Banner */}
      {lastDecision && (
        <div className={`strategy-banner urgency-${lastDecision.urgency}`}>
          <div className="strategy-action">{formatAction(lastDecision.action)}
            {lastDecision.targetLap ? ` · Lap ${lastDecision.targetLap}` : ''}
            {lastDecision.targetCompound ? ` · ${lastDecision.targetCompound}` : ''}
            <span className="strategy-confidence"> {Math.round(lastDecision.confidence * 100)}%</span>
          </div>
          <div className="strategy-radio">"{lastDecision.radioMessage}"</div>
          <div className="strategy-reason">{lastDecision.reasoning}</div>
        </div>
      )}

      {/* Radio Feed */}
      <div className="radio-feed-section">
        <div className="radio-feed-header">
          Team Radio <span className="dim">auto-triggered · idle-gated · emergencies bypass</span>
          {strategy.pending && <span className="dim"> · strategy pending ({strategy.pendingTrigger})</span>}
        </div>
        <div className="radio-feed" ref={feedRef}>
          {messages.length === 0 ? (
            <div className="radio-feed-empty">
              No radio messages yet. Situations auto-trigger during the race.
            </div>
          ) : (
            messages.slice().reverse().map((msg, i) => (
              <div key={i} className={`radio-card urgency-${msg.urgency}`}>
                {msg.category && (
                  <div className="radio-card-header">
                    <span className={`radio-tag tag-${msg.category}`}>
                      {msg.category.toUpperCase().replace('_', ' ')}
                    </span>
                    <span className={`radio-urgency urgency-${msg.urgency}`}>
                      {msg.urgency.toUpperCase()}
                    </span>
                    <span className="radio-time">
                      {new Date(msg.timestamp).toLocaleTimeString('en', {
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                  </div>
                )}
                <div className="radio-text">{msg.text}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* PTT + Manual Query */}
      <div className="chat-input-area">
        <button
          className={`ptt-btn ${pttEngaged ? 'ptt-active' : ''}`}
          onMouseDown={ptt.manualListen}
          onMouseUp={ptt.manualStop}
          onTouchStart={ptt.manualListen}
          onTouchEnd={ptt.manualStop}
          disabled={!ptt.supported}
          title={ptt.supported ? `Hold to talk (binding: ${pttLabel})` : 'Speech recognition not supported'}
        >
          {pttEngaged ? '● Listening…' : '🎙 Hold to Talk'}
        </button>
        <div className="chat-input-col">
          <span className="dim" style={{ fontSize: 11 }}>
            {premium ? 'Manual query — strategy-grade' : 'Manual query — Free mode shows rule-based replies only'}
          </span>
          <textarea
            className="chat-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Should I box this lap? (Enter to send)"
            rows={2}
          />
        </div>
        <button className="chat-send-btn" onClick={() => sendQuery()} disabled={loading}>
          {loading ? '...' : 'Ask'}
        </button>
      </div>

      {response && (
        <div className="manual-response">
          <div className="radio-card urgency-medium">
            <div className="radio-text">{response}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusItem({ label, value, color, warn, critical }: {
  label: string; value: string; color?: string; warn?: boolean; critical?: boolean;
}) {
  const cls = critical ? 'status-critical' : warn ? 'status-warn' : '';
  return (
    <div className="radio-status-item">
      <span className="radio-status-label">{label}</span>
      <span className={`radio-status-value ${cls}`} style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

function formatAction(a: string): string {
  return a.replace(/_/g, ' ').replace(/\bn\b/g, 'N').replace(/^./, (c) => c.toUpperCase());
}
