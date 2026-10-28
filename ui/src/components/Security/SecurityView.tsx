import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, UserRoundCog, UsersRound } from 'lucide-react';
import type { SecurityChangeRequest, SecurityPrincipal, SecurityPrincipalDetail } from '../../api/types.security';
import type { TabViewProps } from '../layout/tabViews';
import { getConnection } from '../../store/connections';
import { toast } from '../../store/ui';
import { ChangeDialog } from './ChangeDialog';
import { securityApi } from './api';
import { blankChange, filterPrincipals } from './model';
import type { SecurityState } from './open';
import './security.css';

type Section = 'overview' | 'privileges' | 'script';
export function SecurityView({ tab, visible }: TabViewProps) {
  const state = tab.state as SecurityState; const connection = getConnection(state.connectionId);
  const [rows, setRows] = useState<SecurityPrincipal[]>([]); const [writable, setWritable] = useState(false); const [notes, setNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<SecurityPrincipal | null>(null); const [detail, setDetail] = useState<SecurityPrincipalDetail | null>(null);
  const [section, setSection] = useState<Section>('overview'); const [search, setSearch] = useState(''); const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); const [change, setChange] = useState<SecurityChangeRequest | null>(null);
  const load = async () => { setLoading(true); try { const r = await securityApi.list(state.connectionId, state.database); setRows(r.principals); setWritable(r.writable); setNotes(r.notes); setError(null); setSelected((old) => old && r.principals.find((p) => p.name === old.name && p.kind === old.kind && p.host === old.host) || r.principals[0] || null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); } };
  useEffect(() => { if (visible) void load(); }, [visible, state.connectionId, state.database]);
  useEffect(() => { if (!selected) { setDetail(null); return; } const ac = new AbortController(); setDetail(null); void securityApi.detail(state.connectionId, state.database, selected.name, selected.kind, selected.host, ac.signal).then(setDetail).catch((e) => { if ((e as { code?: string }).code !== 'ABORTED') setError(e instanceof Error ? e.message : String(e)); }); return () => ac.abort(); }, [state.connectionId, state.database, selected]);
  const shown = useMemo(() => filterPrincipals(rows, state.filter, search), [rows, state.filter, search]);
  const action = (a: SecurityChangeRequest['action'], p = selected) => setChange({ ...blankChange(a, p?.kind ?? 'user', p?.name ?? ''), host: p?.host ?? undefined, database: state.database ?? undefined });
  return <div className="security-view">
    <header><div><h2><ShieldCheck size={18}/> Users, roles and privileges</h2><p>{connection?.name ?? state.connectionId}{state.database ? ` · ${state.database}` : ''}{!writable ? ' · inspection only' : ''}</p></div><div className="security-actions"><button className="btn btn-xs" disabled={!writable} onClick={() => action('create', null)}><Plus size={13}/> New</button><button className="icon-btn" aria-label="Refresh" disabled={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button></div></header>
    {error && <div className="error-banner">{error} <button className="btn btn-xs" onClick={() => void load()}>Retry</button></div>}
    {notes.map((n) => <p className="security-note" key={n}>{n}</p>)}
    <div className="security-layout">
      <aside><input data-primary-focus placeholder="Filter principals" aria-label="Filter principals" value={search} onChange={(e) => setSearch(e.target.value)}/><div className="security-principals">{shown.map((p) => <button key={`${p.kind}:${p.name}:${p.host}`} className={selected?.name === p.name && selected.kind === p.kind && selected.host === p.host ? 'selected' : ''} onClick={() => setSelected(p)}>{p.kind === 'role' ? <UsersRound size={15}/> : <UserRoundCog size={15}/>}<span><b>{p.name}{p.host ? `@${p.host}` : ''}</b><small>{p.kind}{p.disabled ? ' · disabled/locked' : ''}{p.system ? ' · system' : ''}</small></span></button>)}{!loading && !shown.length && <p className="muted">No principals found.</p>}</div></aside>
      <main>{selected ? <><div className="security-title"><div><h3>{selected.name}{selected.host ? `@${selected.host}` : ''}</h3><span>{selected.kind}</span></div>{writable && !selected.system && <div><button className="btn btn-xs" onClick={() => action('grant')}><ShieldCheck size={12}/> Grant/revoke</button>{selected.kind !== 'role' && <button className="btn btn-xs" onClick={() => action('password')}><KeyRound size={12}/> Password</button>}<button className="btn btn-xs" onClick={() => action('membership')}><UsersRound size={12}/> Membership</button><button className="btn btn-xs btn-danger-outline" onClick={() => action('drop')}><Trash2 size={12}/> Drop</button></div>}</div>
        <nav><button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}>Overview</button><button className={section === 'privileges' ? 'active' : ''} onClick={() => setSection('privileges')}>Privileges</button><button className={section === 'script' ? 'active' : ''} onClick={() => setSection('script')}>Script</button></nav>
        {!detail ? <div className="workspace-missing"><RefreshCw className="spin"/>Reading security details…</div> : section === 'overview' ? <div className="security-overview"><dl>{Object.entries(detail.attributes).filter(([,v]) => v != null).map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><h4>Member of</h4><p>{detail.memberOf.join(', ') || 'None'}</p><h4>Members</h4><p>{detail.members.join(', ') || 'None'}</p>{detail.notes.map((n) => <p className="security-note" key={n}>{n}</p>)}</div> : section === 'privileges' ? <div className="security-grants"><table><thead><tr><th>Object</th><th>Privilege</th><th>State</th><th>Grantable</th><th>Grantor</th></tr></thead><tbody>{detail.grants.map((g,i) => <tr key={`${g.object}:${g.privilege}:${i}`}><td>{g.object}</td><td>{g.privilege}</td><td>{g.state ?? g.scope ?? '—'}</td><td>{g.grantable ? 'Yes' : 'No'}</td><td>{g.grantor ?? '—'}</td></tr>)}</tbody></table>{!detail.grants.length && <p className="muted">No direct grants were returned. Effective access can also come from role membership or public grants.</p>}</div> : <pre className="security-sql">{detail.createScript.join('\n\n')}</pre>}
      </> : <div className="workspace-missing">Select a user, login, or role.</div>}</main>
    </div>
    {change && <ChangeDialog
      connectionId={state.connectionId}
      initial={change}
      onClose={() => setChange(null)}
      onApplied={() => { toast('success', 'Security change applied'); void load(); }}
    />}
  </div>;
}
