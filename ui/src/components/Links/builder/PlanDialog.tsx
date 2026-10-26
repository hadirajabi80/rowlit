// Push-down plan preview: what each source is asked for (its own SQL, columns, pushed filters and limit), how many rows
// came back last time, whether the session has them cached, and the plan's warnings.
import { AlertTriangle, ArrowDownToLine, CircleCheck, Database, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../../api/client';
import type { PushdownPlan, PushdownPredicate } from '../../../api/links';
import type { QueryParam } from '../../../api/types';
import { formatCount } from '../../../lib/format';
import { getConnection } from '../../../store/connections';
import { ProviderLogo } from '../../../theme/brand/ProviderLogo';
import { Dialog } from '../../common/Dialog';
import { loadPlan } from './actions';

const OP: Record<string, string> = { '=': '=', '<>': '≠', '<': '<', '>': '>', '<=': '≤', '>=': '≥', in: 'in', between: 'between', like: 'like', isNotNull: 'is not null' };

function predicateText(p: PushdownPredicate): string {
  const v = p.values.map((x) => x.value);
  if (p.op === 'isNotNull') return `${p.column} is not null`;
  if (p.op === 'between') return `${p.column} between ${v[0]} and ${v[1]}`;
  if (p.op === 'in') return `${p.column} in (${v.join(', ')})`;
  return `${p.column} ${OP[p.op] ?? p.op} ${v[0] ?? ''}`;
}

export function PlanDialog({ linkId, sql, params, onClose }: { linkId: string; sql: string; params: QueryParam[]; onClose(): void }) {
  const [plan, setPlan] = useState<PushdownPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadPlan(linkId, sql, params).then((p) => live && setPlan(p), (e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [linkId, sql, params]);

  return (
    <Dialog title="Push-down plan" onClose={onClose} width="min(860px, calc(100vw - 32px))" className="lkb-plan" footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}>
      <p className="lkb-plan-intro muted">
        Rowlit reads each table from its own server, asking only for the columns (and, where safe, the rows) the query needs, then joins them locally.
      </p>
      {!plan && !error && <div className="lkb-plan-note"><LoaderCircle size={14} className="spin" /> Planning…</div>}
      {error && <div className="lkb-plan-note error"><AlertTriangle size={14} /> {error}</div>}
      {plan && (
        <>
          {!plan.parsed && (
            <div className="lkb-plan-note warn"><AlertTriangle size={13} /> The statement could not be analysed fully: every referenced column is fetched and no filter is pushed.</div>
          )}
          <ol className="lkb-plan-sources">
            {plan.sources.map((s, i) => {
              const conn = getConnection(s.connectionId);
              return (
                <li key={i} className="lkb-plan-source">
                  <div className="lkb-plan-head">
                    {conn ? <ProviderLogo providerId={conn.providerId} size={16} /> : <Database size={16} />}
                    <b>{s.table.alias}.{s.table.table}</b>
                    <span className="muted">from {conn?.name ?? s.providerId}</span>
                    <span className="flex-1" />
                    {s.cached ? (
                      <span className="lkb-pill ok" title={s.fetchedAt ? `Fetched ${new Date(s.fetchedAt).toLocaleString()}` : undefined}><CircleCheck size={11} /> cached</span>
                    ) : (
                      <span className="lkb-pill" title="Read from the source on the next run"><ArrowDownToLine size={11} /> fetch</span>
                    )}
                    {s.rows != null && <span className="lkb-pill">{formatCount(s.rows)} rows{s.truncated ? ' (capped)' : ''}</span>}
                  </div>
                  <pre className="lkb-plan-sql">{s.sourceQuery}</pre>
                  <div className="lkb-plan-meta">
                    <span><b>{s.columns.length}</b> column{s.columns.length === 1 ? '' : 's'}: {s.columns.join(', ') || '—'}</span>
                    {s.predicates.length > 0 && <span>Pushed filters: {s.predicates.map(predicateText).join(' · ')}</span>}
                    {s.limit != null && <span>Limit pushed: {formatCount(s.limit)}</span>}
                    <span className="muted">Row cap {formatCount(s.maxRows)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
          {plan.warnings.length > 0 && (
            <ul className="lkb-plan-warnings" aria-label="Warnings">
              {plan.warnings.map((w, i) => (
                <li key={i}><AlertTriangle size={12} /> {w.message}{w.table ? <span className="muted"> ({w.table.alias}.{w.table.table})</span> : null}</li>
              ))}
            </ul>
          )}
          <div className="lkb-plan-engine muted">Engine: {plan.engine === 'duckdb' ? 'DuckDB (embedded)' : plan.engine}</div>
        </>
      )}
    </Dialog>
  );
}
