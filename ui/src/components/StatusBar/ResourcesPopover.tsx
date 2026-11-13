// Portaled above the status bar so the shell's overflow cannot clip the memory inspector.
import { Check, ChevronRight, Cpu, Eraser, Gauge, Layers, LoaderCircle, RefreshCw, Settings as SettingsIcon, Unplug, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectionResources } from '../../api/resources';
import { disconnectAll, disconnectConnection } from '../../app/actions';
import { freeMemoryNow } from '../../app/resources';
import { formatBytes, useResources } from '../../store/resources';
import { useRestoreFocus } from '../common/focus';
import { pluralize } from '../common/text';
import { openSettings } from '../layout/settings/nav';
import './resources.css';

const LEVEL_TEXT = { normal: 'Healthy', high: 'High usage', critical: 'Over the limit' } as const;

function describe(c: ConnectionResources): string {
  return [
    c.openSessions ? pluralize(c.openSessions, 'open session') : null,
    c.releasedSessions ? `${pluralize(c.releasedSessions, 'session')} released` : null,
    c.sourceClient ? 'client open' : null,
    c.streams ? pluralize(c.streams, 'live view') : null,
    c.jobs ? pluralize(c.jobs, 'job') : null,
    c.catalogBytes ? `${formatBytes(c.catalogBytes)} metadata` : null,
  ].filter(Boolean).join(' · ') || 'nothing held';
}

export default function ResourcesPopover({ id, anchorRef, onClose }: { id: string; anchorRef: RefObject<HTMLElement>; onClose: () => void }) {
  const snapshot = useResources((s) => s.snapshot);
  const error = useResources((s) => s.error);
  const appMemory = useResources((s) => s.appMemory);
  const trimming = useResources((s) => s.trimming);
  const lastTrim = useResources((s) => s.lastTrim);
  const sampledAt = useResources((s) => s.sampledAt);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, bottom: 32, maxHeight: Math.max(0, window.innerHeight - 48) });
  useRestoreFocus(true, ref);

  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(480, window.innerWidth - 24);
      setPosition({
        left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
        bottom: Math.max(12, window.innerHeight - anchor.top + 8),
        maxHeight: Math.max(0, anchor.top - 20),
      });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    ref.current?.focus();
    void useResources.getState().refresh();
    const t = setInterval(() => {
      if (!useResources.getState().trimming) void useResources.getState().refresh();
    }, 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [anchorRef, onClose]);

  const m = snapshot?.memory;
  const pct = m && m.limitBytes > 0 ? Math.round((m.usedBytes / m.limitBytes) * 100) : 0;
  const rows = snapshot?.connections ?? [];
  const refresh = () => void useResources.getState().refresh();
  const engineShare = m && m.usedBytes > 0 ? Math.min(100, (m.engineBytes / m.usedBytes) * 100) : 100;

  return createPortal(
    <div id={id} className="resources-popover" role="dialog" aria-label="Resources" aria-describedby={`${id}-description`} tabIndex={-1} ref={ref} style={position}>
      <header className="resources-head">
        <Gauge size={16} aria-hidden="true" />
        <span className="resources-title">Memory & resources</span>
        <span className="resources-live muted" title={sampledAt ? `Updated at ${new Date(sampledAt).toLocaleTimeString()}` : undefined}>Live · 5s</span>
        <div className="flex-1" />
        <button type="button" className="icon-btn xs" title="Refresh" aria-label="Refresh" disabled={trimming} onClick={refresh}><RefreshCw size={13} /></button>
        <button type="button" className="icon-btn xs" title="Close" aria-label="Close" onClick={onClose}><X size={13} /></button>
      </header>
      <div className="resources-scroll">
        {error && <div className="resources-error" role="alert">Could not update memory usage. {error}</div>}
        {!m && !error && <div className="resources-empty" role="status"><LoaderCircle size={14} className="spin" /> Reading memory usage…</div>}
        {m && snapshot && (
          <section className="resources-memory" aria-label="Memory" aria-busy={trimming}>
            <div className="resources-memory-line"><span className="muted">Memory in use</span><span className={`resources-level level-${m.level}`}>{LEVEL_TEXT[m.level]}</span></div>
            <div className="resources-usage"><strong className="tabular">{formatBytes(m.usedBytes)}</strong><span className="muted">/ {formatBytes(m.limitBytes)} {m.autoLimit ? 'auto limit' : 'limit'}</span><span className="resources-percent tabular">{pct}%</span></div>
            <div className={`resources-bar level-${m.level}`} role="progressbar" aria-label="Memory use" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)} aria-valuetext={`${pct}% of the memory limit`}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
            <div className="resources-breakdown" aria-label="Memory breakdown">
              <details className="resources-card">
                <summary><Cpu size={14} /><span>Database engine</span><strong className="tabular">{formatBytes(m.engineBytes)}</strong><ChevronRight size={12} /></summary>
                <dl><div><dt>Managed heap</dt><dd>{formatBytes(m.managedBytes)}</dd></div></dl>
                <p className="muted">Managed heap and caches are part of the engine total.</p>
              </details>
              <details className="resources-card">
                <summary><Layers size={14} /><span>App & windows</span><strong className="tabular">{m.appBytes > 0 ? formatBytes(m.appBytes) : '—'}</strong><ChevronRight size={12} /></summary>
                {appMemory ? <dl>
                  <div><dt>Window renderers</dt><dd>{formatBytes(appMemory.rendererBytes)}</dd></div>
                  <div><dt>Other app processes</dt><dd>{formatBytes(Math.max(0, appMemory.totalBytes - appMemory.rendererBytes))}</dd></div>
                  <div><dt>Processes</dt><dd>{appMemory.processes}</dd></div>
                </dl> : <p className="muted">{m.appBytes > 0 ? 'Browser JavaScript heap. Full process details are available in the desktop app.' : 'Process memory is unavailable in this environment.'}</p>}
              </details>
            </div>
            <div className="resources-split-bar" aria-hidden="true"><span style={{ width: `${engineShare}%` }} /><span style={{ width: `${100 - engineShare}%` }} /></div>
            <dl className="resources-cache-details">
              <div><dt>Result cache</dt><dd className="tabular">{formatBytes(snapshot.totals.resultBytes)} <span className="muted">/ {formatBytes(snapshot.totals.resultCapBytes)}</span></dd></div>
              <div><dt>Metadata cache</dt><dd className="tabular">{formatBytes(snapshot.totals.catalogBytes)} <span className="muted">· {pluralize(rows.reduce((n, c) => n + c.catalogSchemas, 0), 'schema')}</span></dd></div>
            </dl>
            <div className="resources-cleanup">
              <button type="button" className="btn btn-primary" disabled={trimming} onClick={() => void freeMemoryNow()}>{trimming ? <LoaderCircle size={14} className="spin" /> : <Eraser size={14} />}{trimming ? 'Freeing memory…' : 'Free memory now'}</button>
              <p id={`${id}-description`} className="muted">Release unused caches and background results. Active work and unsaved edits stay protected.</p>
            </div>
            {lastTrim && <div className="resources-trim-result" role="status"><Check size={15} /><div>
              <strong>{lastTrim.freedBytes > 0 ? `${formatBytes(lastTrim.freedBytes)} freed` : 'Cleanup complete'}</strong>
              <div className="muted tabular">{formatBytes(lastTrim.beforeBytes)} → {formatBytes(lastTrim.afterBytes)}{lastTrim.releasedRows > 0 ? ` · ${lastTrim.releasedRows.toLocaleString()} background rows released` : ''}</div>
              {lastTrim.freedBytes === 0 && <div className="muted">No measurable drop yet. Memory still needed by the app stays in use.</div>}
            </div></div>}
          </section>
        )}
        <section className="resources-conns" aria-label="Connections">
          {snapshot && <div className="resources-conns-head"><strong>Connections</strong><span className="muted">{snapshot.totals.openConnections} open · {pluralize(snapshot.totals.openSessions, 'session')}{snapshot.totals.streams > 0 ? ` · ${pluralize(snapshot.totals.streams, 'live view')}` : ''}</span></div>}
          {rows.length === 0 && snapshot && <div className="resources-empty muted">No connection holds resources.</div>}
          <ul className="resources-list">{rows.map((c) => <li key={c.connectionId} className="resources-row">
            <span className={`resources-dot${c.connected ? ' on' : ''}`} aria-hidden="true" />
            <div className="resources-connection-info"><strong className="resources-name" title={c.name}>{c.name}</strong><div className="resources-desc muted">{describe(c)}</div></div>
            <button type="button" className="link-btn" aria-label={`Close ${c.name}`} disabled={trimming} title="Release the connection and its cached metadata" onClick={() => void disconnectConnection(c.connectionId).then(refresh)}><Unplug size={11} /> Close</button>
          </li>)}</ul>
        </section>
      </div>
      <footer className="resources-foot">
        <button type="button" className="link-btn" disabled={!rows.length || trimming} onClick={() => void disconnectAll().then(refresh)}><Unplug size={12} /> Disconnect all</button>
        <div className="flex-1" />
        <button type="button" className="link-btn" onClick={() => { onClose(); openSettings('connections'); }}><SettingsIcon size={12} /> Memory settings</button>
      </footer>
    </div>, document.body,
  );
}
