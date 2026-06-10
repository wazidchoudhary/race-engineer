/**
 * Radio Messages — race-control feed (penalties, flags, overtakes, SC, DRS,
 * fastest lap, lights, chequered) for the active driver slot. Each new event
 * can also be spoken by the engineer voice when "Voice" is on.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { usePrefs } from '../context/PrefsContext';
import { applyNameMasks } from '../lib/name-mask';
import { speak } from '../lib/tts-speaker';
import { api } from '../lib/tauri-api';
import type { EventData, Participant } from '../../shared/types/packets';

type Kind = 'penalty' | 'warning' | 'flag' | 'overtake' | 'safety_car' | 'info' | 'fastest';

interface FormattedMsg {
  kind: Kind;
  text: string;
  /** monotonic index from the events array — used as React key + dedupe */
  seq: number;
  /** locale time */
  time: string;
}

const PENALTY_NAMES: Record<number, string> = {
  0: 'Drive-through',
  1: 'Stop-Go',
  2: 'Grid penalty',
  3: 'Penalty reminder',
  4: 'Time penalty',
  5: 'Warning',
  6: 'Disqualified',
  7: 'Removed from formation lap',
  8: 'Parked too long',
  9: 'Tyre regulations',
  10: 'This lap invalidated',
  11: 'This and next lap invalidated',
  12: 'This lap invalidated — no reason',
  13: 'This and next lap invalidated — no reason',
  14: 'This and previous lap invalidated',
  15: 'This and previous lap invalidated — no reason',
  16: 'Retired',
  17: 'Black flag timer',
};

const INFRINGEMENT_NAMES: Record<number, string> = {
  0: 'Blocking by slow driving',
  1: 'Blocking by wrong way',
  2: 'Reversing off start line',
  3: 'Big collision',
  4: 'Small collision',
  5: 'Collision and failed to hand back position',
  6: 'Collision and failed to hand back position multiple',
  7: 'Corner cutting — gained time',
  8: 'Corner cutting — overtake',
  9: 'Corner cutting — overtake multiple',
  10: 'Crossed pit exit lane',
  11: 'Ignored blue flags',
  12: 'Ignored yellow flags',
  13: 'Ignored drive-through',
  14: 'Too many drive-throughs',
  15: 'Drive-through reminder',
  16: 'Drive-through reminder 2',
  17: 'Pit lane speeding',
  18: 'Parked too long',
  19: 'Ignored tyre regulations',
  20: 'Too many penalties',
  21: 'Multiple warnings',
  22: 'Approaching disqualification',
  23: 'Tyre regulations select single',
  24: 'Tyre regulations select multiple',
  25: 'Lap invalidated — corner cutting',
  26: 'Lap invalidated — running wide',
  27: 'Corner cutting ran wide gained time minor',
  28: 'Corner cutting ran wide gained time significant',
  29: 'Corner cutting ran wide gained time extreme',
  30: 'Lap invalidated — wall riding',
  31: 'Lap invalidated — flashback used',
  32: 'Lap invalidated — reset to track',
  33: 'Blocking the pitlane',
  34: 'Jump start',
  35: 'Safety Car infringement',
  36: 'Safety Car too close',
  37: 'Safety Car illegal overtake',
  38: 'Safety Car exceeding allowed pace',
  39: 'Virtual SC exceeding allowed pace',
  40: 'Formation lap below allowed speed',
  41: 'Formation lap parking',
  42: 'Retired mechanical failure',
  43: 'Retired terminal damage',
  44: 'Safety Car falling too far back',
  45: 'Black flag timer',
  46: 'Unserved Stop-Go',
  47: 'Unserved Drive-Through',
  48: 'Engine component change',
  49: 'Gearbox change',
  50: 'Parc Ferme change',
  51: 'League grid penalty',
  52: 'Retry penalty',
  53: 'Illegal time gain',
  54: 'Mandatory pitstop',
  55: 'Attribute assigned',
};

const FLAG_NAMES: Record<number, string> = {
  0: 'No flag', 1: 'Green flag', 2: 'Blue flag', 3: 'Yellow flag', 4: 'Red flag',
};

const SC_TYPE: Record<number, string> = {
  0: 'No Safety Car', 1: 'Full Safety Car', 2: 'Virtual Safety Car', 3: 'Formation Lap',
};

const SC_EVENT: Record<number, string> = {
  0: 'deployed', 1: 'returning to pits', 2: 'ending', 3: 'called',
};

function fmt(ms: number): string {
  if (!ms || ms <= 0) return '--:--.---';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function nameOf(participants: (Participant | null)[] | undefined,
                idx: number | undefined,
                masks: any): string {
  if (idx == null) return '';
  const p = participants?.[idx];
  return applyNameMasks(p?.name || `Car ${idx + 1}`, masks);
}

function formatEvent(
  evt: EventData,
  participants: (Participant | null)[] | undefined,
  masks: any,
  playerCarIndex: number,
): { kind: Kind; text: string } | null {
  const e: any = evt;
  const isMe = (idx?: number) => idx != null && idx === playerCarIndex;
  switch (evt.type) {
    case 'PENA': {
      const who = nameOf(participants, e.vehicleIdx, masks);
      const pen = PENALTY_NAMES[e.penaltyType] ?? `Penalty type ${e.penaltyType}`;
      const inf = INFRINGEMENT_NAMES[e.infringementType] ?? '';
      const dur = e.time > 0 ? ` (${e.time}s)` : '';
      const target = isMe(e.vehicleIdx) ? 'You' : who;
      const text = `${target}: ${pen}${dur}${inf ? ` — ${inf}` : ''}`;
      return { kind: 'penalty', text };
    }
    case 'RCMG': {
      const who = nameOf(participants, e.vehicleIdx, masks);
      const flag = FLAG_NAMES[e.flagType] ?? `Flag ${e.flagType}`;
      const text = who ? `${flag} — ${isMe(e.vehicleIdx) ? 'You' : who}` : flag;
      return { kind: 'flag', text };
    }
    case 'OVTK': {
      const ot = nameOf(participants, e.overtakingVehicleIdx, masks);
      const bo = nameOf(participants, e.beingOvertakenVehicleIdx, masks);
      const meOt = isMe(e.overtakingVehicleIdx);
      const meBo = isMe(e.beingOvertakenVehicleIdx);
      if (meOt) return { kind: 'overtake', text: `Overtake — you passed ${bo}` };
      if (meBo) return { kind: 'overtake', text: `Overtake — ${ot} passed you` };
      return { kind: 'overtake', text: `${ot} overtakes ${bo}` };
    }
    case 'FTLP': {
      const who = nameOf(participants, e.vehicleIdx, masks);
      const ms = e.lapTimeMs ?? 0;
      const target = isMe(e.vehicleIdx) ? 'You' : who;
      return { kind: 'fastest', text: `Fastest lap — ${target} ${fmt(ms)}` };
    }
    case 'SCAR': {
      const t = SC_TYPE[e.safetyCarType] ?? 'Safety Car';
      const ev = SC_EVENT[e.eventType] ?? 'updated';
      return { kind: 'safety_car', text: `${t} ${ev}` };
    }
    case 'DRSE': return { kind: 'info', text: 'DRS enabled' };
    case 'DRSD': return { kind: 'info', text: 'DRS disabled' };
    case 'CHQF': return { kind: 'flag', text: 'Chequered flag' };
    case 'STLG': return { kind: 'info', text: `Lights: ${e.numLights}` };
    case 'LGOT': return { kind: 'info', text: 'Lights out — go go go!' };
    case 'SSTA': return { kind: 'info', text: 'Session started' };
    case 'SEND': return { kind: 'info', text: 'Session ended' };
    case 'RTMT': {
      const who = nameOf(participants, e.vehicleIdx, masks);
      return { kind: 'warning', text: `Retirement — ${who || 'unknown'}` };
    }
    case 'TMPT': return { kind: 'info', text: 'Teammate in pits' };
    case 'STPS': {
      const who = nameOf(participants, e.vehicleIdx, masks);
      return { kind: 'info', text: `Stop / Go served — ${isMe(e.vehicleIdx) ? 'You' : who}` };
    }
    default: return null;
  }
}

const SPEAKABLE: Set<Kind> = new Set(['penalty', 'flag', 'overtake', 'safety_car', 'fastest', 'warning']);

export function RadioMessages() {
  const { events, participants, playerCarIndex } = useTelemetryContext();
  const { driverNameMasks, radioVoiceEnabled, setPrefs } = usePrefs();
  const lastSpokenSeq = useRef<number>(-1);
  const voiceRef = useRef<string>('en-GB-RyanNeural');

  // Load preferred voice from settings (one-time)
  useEffect(() => {
    api.loadSettings?.().then((s: any) => {
      if (s?.tts?.voice) voiceRef.current = s.tts.voice;
    }).catch(() => {});
  }, []);

  const formatted: FormattedMsg[] = useMemo(() => {
    const out: FormattedMsg[] = [];
    events.forEach((evt, i) => {
      const f = formatEvent(evt, participants?.participants, driverNameMasks, playerCarIndex);
      if (!f) return;
      // useTelemetry stamps each event with a monotonic seq (stable across
      // the 100-event ring buffer — array indices are not) and an arrival
      // timestamp for display.
      const at = evt.receivedAt ?? 0;
      const d = new Date(at || Date.now());
      out.push({
        kind: f.kind,
        text: f.text,
        seq: evt.seq ?? at + i / 1000,
        time: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`,
      });
    });
    return out.slice(-50);
  }, [events, participants, driverNameMasks, playerCarIndex]);

  // Auto-speak unspoken messages when voice is on. Iterates everything newer
  // than the last spoken seq so a burst (penalty + retirement batched into
  // one render) doesn't drop calls.
  useEffect(() => {
    if (!radioVoiceEnabled || formatted.length === 0) return;
    const newest = formatted[formatted.length - 1];
    // On first mount, don't dump the entire backlog into TTS
    if (lastSpokenSeq.current < 0) {
      lastSpokenSeq.current = newest.seq;
      return;
    }
    for (const m of formatted) {
      if (m.seq <= lastSpokenSeq.current) continue;
      lastSpokenSeq.current = m.seq;
      if (!SPEAKABLE.has(m.kind)) continue;
      speak(m.text, { voice: voiceRef.current, priority: m.kind === 'penalty' ? 6 : 4 });
    }
  }, [formatted, radioVoiceEnabled]);

  return (
    <div className="radio-panel">
      <div className="radio-panel-header">
        <h3>RACE CONTROL</h3>
        <label className="radio-tts-toggle" title="Engineer reads each message aloud">
          <input
            type="checkbox"
            checked={radioVoiceEnabled}
            onChange={(e) => setPrefs({ radioVoiceEnabled: e.target.checked })}
          />
          VOICE
        </label>
      </div>
      <div className="radio-msg-list">
        {formatted.length === 0 ? (
          <div className="radio-empty">No race control messages yet</div>
        ) : (
          [...formatted].reverse().map((m) => (
            <div key={m.seq} className={`radio-msg kind-${m.kind}`}>
              <span className="radio-msg-time">{m.time}</span>
              <span className="radio-msg-text">{m.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
