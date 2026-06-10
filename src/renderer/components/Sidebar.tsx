import React from 'react';
import { useTelemetryContext } from '../context/TelemetryContext';
import { usePrefs } from '../context/PrefsContext';
import { SessionTimer } from './SessionTimer';
import { DriverSwitcher } from './DriverSwitcher';
import { api } from '../lib/tauri-api';
import type { Page } from '../App';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard',   label: 'Dashboard',    icon: '⊞' },
  { id: 'timing',      label: 'Timing',        icon: '⏱' },
  { id: 'lap-history', label: 'Lap History',   icon: '☰' },
  { id: 'analysis',    label: 'Analysis',      icon: '▣' },
  { id: 'trackmap',    label: 'Track Map',     icon: '◎' },
  { id: 'vehicle',     label: 'Vehicle',       icon: '⬡' },
  { id: 'rival',       label: 'Rival',         icon: '★' },
  { id: 'session',     label: 'Session',       icon: '⚑' },
  { id: 'engineer',    label: 'Engineer',      icon: '⚙' },
  { id: 'battery',     label: 'Battery Coach', icon: '⚡' },
  { id: 'radio',       label: 'Radio Config',  icon: '♫' },
  { id: 'settings',    label: 'Settings',      icon: '≣' },
];

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { connected, session, startTelemetry, stopTelemetry, rivalCarIndex, slot, packetRx } = useTelemetryContext();
  const { telemetryPorts } = usePrefs();
  const primaryPort = telemetryPorts[0] ?? 20777;

  const popOutPage = (page: Page, e: React.MouseEvent) => {
    e.stopPropagation();
    api.openPageWindow(page, slot).catch((err) => console.error('openPageWindow:', err));
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="app-title">APEX</h1>
        <span className="app-subtitle">ENGINEER</span>
      </div>

      <div className="connection-status">
        <div className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
        <span>{connected ? 'LIVE' : 'OFFLINE'}</span>
        {connected && (
          <span
            style={{ marginLeft: 8, fontSize: '0.75em', opacity: 0.75 }}
            title={
              packetRx.count === 0
                ? 'Listening but no UDP packets received yet. If this stays at 0 after a few seconds, check Windows Firewall for apex-engineer.exe or the F1 25 UDP IP setting.'
                : `Received ${packetRx.count} UDP packets. Last packet id: ${packetRx.lastPacketId}`
            }
          >
            {packetRx.count === 0 ? 'no UDP' : `RX ${packetRx.count}`}
          </span>
        )}
        {connected && packetRx.packetFormat >= 2020 && (
          <span
            style={{ marginLeft: 6, fontSize: '0.7em', color: '#00d2be', fontWeight: 700 }}
            title={`Game UDP format ${packetRx.packetFormat}`}
          >
            F1 {packetRx.packetFormat - 2000}
          </span>
        )}
      </div>

      {session && (
        <div className="session-badge">
          <span className="track-name">{session.trackName}</span>
          <span className="session-type">{session.sessionTypeName}</span>
        </div>
      )}

      <SessionTimer />
      <DriverSwitcher />

      <nav className="nav-list">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.id === 'rival' && rivalCarIndex != null && (
              <span className="nav-badge">★</span>
            )}
            <span
              role="button"
              className="nav-popout-btn"
              title={`Pop ${item.label} into its own window`}
              onClick={(e) => popOutPage(item.id, e)}
            >
              ⧉
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className={`telemetry-btn ${connected ? 'stop' : 'start'}`}
          onClick={() => connected ? stopTelemetry() : startTelemetry(primaryPort)}
        >
          {connected ? 'Stop Telemetry' : 'Start Telemetry'}
        </button>
      </div>
    </aside>
  );
}
