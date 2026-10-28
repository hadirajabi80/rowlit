import { useEffect, useRef, useState } from 'react';
import { Activity, CirclePause, CirclePlay, RefreshCw, Skull } from 'lucide-react';
import type { TabViewProps } from '../layout/tabViews';
import { api, errorMessage, http } from '../../api/client';
import type { ActivityRow } from '../../api/types';
import type { MonitorSnapshot } from '../../api/types.monitor';
import { getConnection } from '../../store/connections';
import { toast } from '../../store/ui';
import { openLogs } from '../Logs/open';
import { KillDialog } from '../Logs/KillDialog';
import { killStatement } from '../Logs/model';
import { formatMetric, metricRates, shouldPoll } from './model';
import type { MonitorState } from './open';
import { Sparkline } from './Sparkline';
import './monitor.css';

type Point = { at: number; value: number };
const GROUPS = ['sessions', 'throughput', 'memory', 'io', 'server'] as const;
const LABEL: Record<string, string> = { sessions: 'Sessions', throughput: 'Throughput', memory: 'Memory and cache', io: 'I/O', server: 'Server' };

export function MonitorView({ tab, visible }: TabViewProps) {
  const state = tab.state as MonitorState;
  const connection = getConnection(state.connectionId);
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const previous = useRef<MonitorSnapshot | null>(null);
  const [shown, setShown] = useState<ReturnType<typeof metricRates>>([]);
  const [history, setHistory] = useState<Record<string, Point[]>>({});
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(state.intervalMs || 5000);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kill, setKill] = useState<ActivityRow | null>(null);

  const load = async () => {
    if (busy) return; setBusy(true);
    try {
      const next = await http.json<MonitorSnapshot>('GET', `/monitor/${encodeURIComponent(state.connectionId)}/snapshot`);
      const display = metricRates(previous.current, next); previous.current = next; setSnap(next); setShown(display); setError(null);
      const at = Date.parse(next.at), cutoff = at - 30 * 60_000;
      setHistory((old) => { const out = { ...old }; for (const m of display) if (m.displayValue != null) out[m.id] = [...(old[m.id] ?? []).filter((p) => p.at >= cutoff), { at, value: m.displayValue }]; return out; });
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!shouldPoll(visible, paused)) return;
    void load(); const id = setInterval(() => void load(), intervalMs); return () => clearInterval(id);
  }, [visible, paused, intervalMs, state.connectionId]);

  const doKill = async () => {
    if (!kill) return;
    const r = await api.logs.kill(state.connectionId, { id: kill.id, kind: kill.kind, ...(snap?.providerId === 'postgresql' ? { mode: 'terminate' as const } : {}) });
    if (!r.killed) throw new Error(r.message || `${kill.id} was not killed`);
    toast('success', r.message || `Session ${kill.id} was killed`); setKill(null); void load();
  };
  return <div className="monitor-view" data-command-scope="monitor">
    <header><div><h2>Server monitor</h2><p>{connection?.name ?? state.connectionId}{snap?.version ? ` · ${snap.version}` : ''}{snap ? ` · ${new Date(snap.at).toLocaleTimeString()}` : ''}</p></div><div className="monitor-actions"><select aria-label="Refresh interval" value={intervalMs} onChange={(e) => setIntervalMs(Number(e.target.value))}><option value={2000}>2 s</option><option value={5000}>5 s</option><option value={10000}>10 s</option><option value={30000}>30 s</option><option value={60000}>1 min</option></select><button className="btn btn-xs" onClick={() => setPaused((p) => !p)}>{paused ? <CirclePlay size={13}/> : <CirclePause size={13}/>} {paused ? 'Resume' : 'Pause'}</button><button className="icon-btn" aria-label="Refresh" disabled={busy} onClick={() => void load()}><RefreshCw size={14} className={busy ? 'spin' : ''}/></button><button className="btn btn-xs" onClick={() => openLogs(state.connectionId, { sub: 'activity' })}><Activity size={13}/> Open Activity</button></div></header>
    {error && <div className="error-banner">{error} <button className="btn btn-xs" onClick={() => void load()}>Retry</button></div>}
    {!snap && !error && <div className="workspace-missing"><RefreshCw className="spin"/>Reading server metrics…</div>}
    {snap && <>{GROUPS.map((group) => { const list = shown.filter((m) => m.group === group); return list.length ? <section key={group}><h3>{LABEL[group]}</h3><div className="monitor-grid">{list.map((m) => <article className={`monitor-tile${m.value == null ? ' unavailable' : ''}`} key={m.id} title={m.hint ?? m.needs ?? undefined}><div><span>{m.label}</span><strong>{formatMetric(m.displayValue, m.unit, m.rate)}</strong></div>{(history[m.id]?.length ?? 0) > 1 && <Sparkline values={history[m.id]} label={m.label}/>} {m.hint && <small>{m.hint}</small>}</article>)}</div></section> : null; })}
      {!!snap.databases.length && <section><h3>Database sizes</h3><div className="monitor-databases">{snap.databases.map((d) => <div key={d.name}><span>{d.name}</span><b>{formatMetric(d.sizeBytes, 'bytes')}</b></div>)}</div></section>}
      {!!snap.topQueries.length && <section><h3>Longest running queries</h3><div className="monitor-queries">{snap.topQueries.map((q) => <div key={`${q.kind}:${q.id}`}><b>{q.id}</b><span>{q.user ?? '—'}</span><span>{q.database ?? '—'}</span><span>{q.durationMs == null ? '—' : formatMetric(q.durationMs, 'ms')}</span><code title={q.text}>{q.text || q.command || q.state}</code>{q.canKill && !connection?.readOnly ? <button className="btn btn-xs btn-danger-outline" onClick={() => setKill(q)}><Skull size={12}/> Kill</button> : null}</div>)}</div></section>}
      {!!snap.notes.length && <div className="monitor-notes">{snap.notes.map((n) => <p key={n}>{n}</p>)}</div>}
    </>}
    {kill && <KillDialog row={kill} mode="terminate" statement={killStatement(kill, 'terminate', snap?.providerId)} connectionName={connection?.name ?? state.connectionId} onConfirm={doKill} onClose={() => setKill(null)}/>}
  </div>;
}
