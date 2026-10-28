// Step 1: where the rows come from - connection > database > schema, and the tables (and views) to copy.
import { ChevronRight, History, Search, X } from 'lucide-react';
import { useMemo, useState, type Ref } from 'react';
import { getConnection } from '../../store/connections';
import { Callout, Field, StepHeader } from '../ImportWizard/parts';
import { levelOf } from './labels';
import { isSelected, setAll, toggleTable } from './model';
import { forgetRecent, readRecent, type RecentTransfer } from './recent';
import type { Transfer } from './useTransfer';

export function Crumb() {
  return <ChevronRight size={14} className="iw-crumb" aria-hidden="true" />;
}

function describeRecent(r: RecentTransfer): string {
  const from = `${getConnection(r.sourceCid)?.name ?? r.sourceCid}${r.sourceSchema ? ` › ${r.sourceSchema}` : ''}`;
  const to = r.targetKind === 'file' ? r.filePath.split(/[\\/]/).pop() ?? r.filePath
    : `${getConnection(r.targetCid)?.name ?? r.targetCid}${r.targetSchema ? ` › ${r.targetSchema}` : ''}`;
  const n = r.tables.length;
  return `${from} → ${to} · ${n} ${n === 1 ? 'table' : 'tables'}`;
}

export function SourceStep({ t, headingRef }: { t: Transfer; headingRef: Ref<HTMLHeadingElement> }) {
  const { s, patch } = t;
  const level = levelOf(t.conn?.providerId);
  const [recent, setRecent] = useState(() => readRecent());
  const usable = useMemo(() => recent.filter((r) => !!getConnection(r.sourceCid)), [recent]);
  const allTicked = t.listed.length > 0 && t.listed.every((o) => isSelected(s, o.name));

  return (
    <section className="iw-step" aria-labelledby="tr-src-title">
      <StepHeader ref={headingRef} id="tr-src-title" title="Choose what to copy" help="Pick the source schema and tick the tables to copy. Views are copied as tables." />

      <div className="iw-card">
        <div className="iw-where">
          <Field label="Source connection">
            <select className="input" aria-label="Source connection" value={t.cid} onChange={(e) => t.setSourceConnection(e.target.value)}>
              {!t.cid && <option value="">Choose a connection…</option>}
              {t.connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {t.source.databases && (
            <>
              <Crumb />
              <Field label="Database">
                <select className="input" aria-label="Source database" value={t.sourceDb ?? ''} onChange={(e) => t.setSourceDatabase(e.target.value || null)}>
                  {!t.sourceDb && <option value="">(connection default)</option>}
                  {t.sourceDb && !t.source.databases.includes(t.sourceDb) && <option value={t.sourceDb}>{t.sourceDb}</option>}
                  {t.source.databases.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            </>
          )}
          <Crumb />
          <Field label={level}>
            <select className="input" aria-label={`Source ${level.toLowerCase()}`} value={s.sourceSchema ?? ''} onChange={(e) => t.setSourceSchema(e.target.value || null)} disabled={!t.cid}>
              {s.sourceSchema === null && <option value="">(default)</option>}
              {s.sourceSchema && !t.source.schemaNames.includes(s.sourceSchema) && <option value={s.sourceSchema}>{s.sourceSchema}</option>}
              {t.source.schemaNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {t.sourceBlocker && <Callout tone="error">{t.sourceBlocker}</Callout>}

      <div className="iw-card tr-tables">
        <div className="tr-tables-bar">
          <label className="tr-search">
            <Search size={13} aria-hidden="true" />
            <input className="input" type="search" aria-label="Filter tables" placeholder="Filter tables" value={s.search} onChange={(e) => patch({ search: e.target.value })} />
          </label>
          <label className="iw-check">
            <input type="checkbox" checked={s.includeViews} onChange={(e) => patch({ includeViews: e.target.checked, selected: e.target.checked ? s.selected : s.selected.filter((x) => x.type !== 'view') })} />
            Include views
          </label>
          <span className="iw-nav-spacer" />
          <button type="button" className="btn btn-xs" disabled={t.listed.length === 0} onClick={() => patch({ selected: setAll(s.selected, t.listed, !allTicked) })}>
            {allTicked ? 'Untick all' : 'Tick all'}
          </button>
          <span className="iw-note" role="status">{s.selected.length} selected</span>
        </div>
        <ul className="tr-table-list" aria-label="Source tables">
          {t.listed.map((o) => (
            <li key={`${o.type}:${o.name}`}>
              <label className="iw-check">
                <input type="checkbox" checked={isSelected(s, o.name)} onChange={() => patch({ selected: toggleTable(s.selected, o.name, o.type) })} />
                <span dir="auto">{o.name}</span>
                {o.type === 'view' && <span className="tr-badge">view</span>}
              </label>
            </li>
          ))}
          {t.listed.length === 0 && <li className="iw-note">{t.cid ? (s.search ? 'No table matches the filter.' : 'No tables in this schema.') : 'Choose a connection first.'}</li>}
        </ul>
        {s.selected.some((x) => !t.source.objects.some((o) => o.name === x.name)) && t.source.objects.length > 0 && (
          <Callout tone="warn">Some ticked tables are not in this schema any more: {s.selected.filter((x) => !t.source.objects.some((o) => o.name === x.name)).map((x) => x.name).join(', ')}.</Callout>
        )}
      </div>

      {usable.length > 0 && (
        <section className="iw-card" aria-label="Recent transfers">
          <h3 className="iw-sub"><History size={13} aria-hidden="true" /> Recent transfers</h3>
          <ul className="tr-recent">
            {usable.map((r) => (
              <li key={r.at}>
                <button type="button" className="iw-link" onClick={() => t.applyRecent(r)}>{describeRecent(r)}</button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label="Forget this transfer"
                  title="Forget"
                  onClick={() => {
                    forgetRecent(r.at);
                    setRecent(readRecent());
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
