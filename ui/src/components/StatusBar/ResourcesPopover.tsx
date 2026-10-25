// Resources popover (docs/resources.md), lazy: memory against the limit, what every connection holds (sessions,
// streams, client, cached metadata) with a Close button, Free memory now, Disconnect all and the settings.
import { Gauge, RefreshCw, Settings as SettingsIcon, Unplug, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ConnectionResources } from '../../api/resources';
import { disconnectAll, disconnectConnection } from '../../app/actions';
import { freeMemoryNow } from '../../app/resources';
import { formatBytes, useResources } from '../../store/resources';
import { pluralize } from '../common/text';
import { openSettings } from '../layout/settings/nav';
import './resources.css';

const LEVEL_TEXT = { normal: 'Normal', high: 'High', critical: 'Over the limit' } as const;

function describe(c: ConnectionResources): string {
  const parts = [
    c.openSessions ? pluralize(c.openSessions, 'open session') : null,
    c.releasedSessions ? `${pluralize(c.releasedSessions, 'session')} released` : null,
    c.sourceClient ? 'client open' : null,
    c.streams ? pluralize(c.streams, 'live view') : null,
    c.jobs ? pluralize(c.jobs, 'job') : null,
    c.catalogBytes ? `${formatBytes(c.catalogBytes)} metadata` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing held';
}

export default function ResourcesPopover({ onClose }: { onClose: () => void }) {
  const snapshot = useResources((s) => s.snapshot);
  const error = useResources((s) => s.error);
  const ref = useRef<HTMLDivElement>(null);

  // Fresh numbers on open, then every 5 s while it stays open.
  useEffect(() => {
    void useResources.getState().refresh();
    const t = setInterval(() => void useResources.getState().refresh(), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const m = snapshot?.memory;
  const pct = m && m.limitBytes > 0 ? Math.min(100, Math.round((m.usedBytes / m.limitBytes) * 100)) : 0;
  const rows = snapshot?.connections ?? [];
  const refresh = () => void useResources.getState().refresh();

  return (
    <div className="resources-popover" role="dialog" aria-label="Resources" ref={ref}>
      <header className="resources-head">
        <Gauge size={14} aria-hidden="true" />
        <span className="resources-title">Resources</span>
        <div className="flex-1" />
        <button type="button" className="icon-btn xs" title="Refresh" aria-label="Refresh" onClick={refresh}>
          <RefreshCw size={12} />
        </button>
        <button type="button" className="icon-btn xs" title="Close" aria-label="Close" onClick={onClose}>
          <X size={12} />
        </button>
      </header>
      {error && !snapshot && <div className="resources-error">{error}</div>}
      {m && (
        <section className="resources-memory" aria-label="Memory">
          <div className="resources-memory-line">
            <span>Memory</span>
            <span className={`resources-level level-${m.level}`}>{LEVEL_TEXT[m.level]}</span>
            <div className="flex-1" />
            <span className="tabular">{formatBytes(m.usedBytes)} of {formatBytes(m.limitBytes)}{m.autoLimit ? ' (auto)' : ''}</span>
          </div>
          <div className={`resources-bar level-${m.level}`} role="progressbar" aria-label="Memory use" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="resources-memory-detail muted">
            Engine {formatBytes(m.engineBytes)}{m.appBytes ? ` · windows ${formatBytes(m.appBytes)}` : ''}
            {snapshot && ` · results cache ${formatBytes(snapshot.totals.resultBytes)} · metadata ${formatBytes(snapshot.totals.catalogBytes)}`}
          </div>
        </section>
      )}
      <section className="resources-conns" aria-label="Connections">
        {snapshot && (
          <div className="resources-conns-head muted">
            {pluralize(snapshot.totals.openConnections, 'connection')} holding server resources · {pluralize(snapshot.totals.openSessions, 'open session')}
            {snapshot.totals.releasedSessions ? ` · ${pluralize(snapshot.totals.releasedSessions, 'released session')}` : ''}
          </div>
        )}
        {rows.length === 0 && snapshot && <div className="resources-empty muted">No connection holds anything.</div>}
        <ul className="resources-list">
          {rows.map((c) => (
            <li key={c.connectionId} className={`resources-row${c.connected ? ' connected' : ''}`}>
              <span className={`resources-dot${c.connected ? ' on' : ''}`} aria-hidden="true" />
              <span className="resources-name" title={c.name}>{c.name}</span>
              <span className="resources-desc muted">{describe(c)}</span>
              <button
                type="button"
                className="link-btn"
                aria-label={`Close ${c.name}`}
                title="Close the connection: release its sessions (tabs reconnect on their next run), stop its streams and drop its cached metadata"
                onClick={() => void disconnectConnection(c.connectionId).then(refresh)}
              >
                <Unplug size={11} /> Close
              </button>
            </li>
          ))}
        </ul>
      </section>
      <footer className="resources-foot">
        <button type="button" className="btn btn-xs" onClick={() => void freeMemoryNow()}>Free memory now</button>
        <button type="button" className="btn btn-xs" disabled={!rows.length} onClick={() => void disconnectAll().then(refresh)}>Disconnect all</button>
        <div className="flex-1" />
        <button type="button" className="link-btn" onClick={() => { onClose(); openSettings('connections'); }}>
          <SettingsIcon size={11} /> Settings
        </button>
      </footer>
    </div>
  );
}
