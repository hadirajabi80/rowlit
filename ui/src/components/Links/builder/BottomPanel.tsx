// Bottom panel of the builder: Columns (order, alias, aggregate, calculated columns), Filters (WHERE, the grid's
// FilterBar on the canvas tables' columns), Group by / Having, Sort, Limit, and the Results of the last run.
import { ArrowDown, ArrowUp, Calculator, Hash, Plus, Sigma, Trash2, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { BuilderAggregate, BuilderColumn, BuilderModel, BuilderRef, BuilderSort, LinkCatalog } from '../../../api/links';
import { countConditions, kindClass } from '../../../filter/model';
import { Select } from '../../common/Select';
import { FilterBar } from '../../FilterBar/FilterBar';
import { columnsOf } from './catalog';
import * as M from './model';
import { AGGS, columnTitle, havingNames, NUMERIC_ONLY, remapFilter, whereNames } from './names';
import type { BottomTab } from './model';

type Apply = (fn: (m: BuilderModel) => BuilderModel, key?: string) => void;

interface Props {
  tab: BottomTab;
  onTab(t: BottomTab): void;
  model: BuilderModel;
  catalog: LinkCatalog | null;
  apply: Apply;
  results: ReactNode;
  resultsBadge: ReactNode;
  disabled: boolean;
  /** Filter focus request from a card ("Filter on this column…"). */
  filterFocus: { column: string | null; nonce: number } | null;
}

export function BottomPanel(p: Props) {
  const { model } = p;
  const nFilters = countConditions(model.filter);
  const nHaving = countConditions(model.having);
  const tabs: { id: BottomTab; label: string; badge?: ReactNode }[] = [
    { id: 'columns', label: 'Columns', badge: model.columns.filter((c) => c.output !== false).length || null },
    { id: 'filters', label: 'Filters', badge: nFilters || null },
    { id: 'group', label: 'Group by', badge: (model.columns.some((c) => c.agg) || nHaving || (model.autoGroup === false && model.groupBy.length)) ? <Sigma size={10} /> : null },
    { id: 'sort', label: 'Sort', badge: model.sort.length || null },
    { id: 'limit', label: 'Limit', badge: model.limit != null ? model.limit : model.distinct ? 'D' : null },
    { id: 'results', label: 'Results', badge: p.resultsBadge },
  ];
  return (
    <section className="lkb-bottom" aria-label="Query details">
      <div className="lkb-tabs" role="tablist" aria-label="Query details">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`lkb-tab-${t.id}`}
            aria-selected={p.tab === t.id}
            aria-controls={`lkb-panel-${t.id}`}
            className={`lkb-tab${p.tab === t.id ? ' on' : ''}`}
            onClick={() => p.onTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = tabs.findIndex((x) => x.id === p.tab);
              const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
              p.onTab(n.id);
              requestAnimationFrame(() => document.getElementById(`lkb-tab-${n.id}`)?.focus());
            }}
          >
            {t.label}
            {t.badge !== null && t.badge !== undefined && t.badge !== 0 && <span className="lkb-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      <div className={`lkb-panel${p.tab === 'results' ? ' results' : ''}`} role="tabpanel" id={`lkb-panel-${p.tab}`} aria-labelledby={`lkb-tab-${p.tab}`}>
        {p.disabled && p.tab !== 'results' && (
          <div className="lkb-panel-note">SQL mode: the query runs as written. Switch back to the builder to edit it here.</div>
        )}
        {!p.disabled && p.tab === 'columns' && <ColumnsTab {...p} />}
        {!p.disabled && p.tab === 'filters' && <FiltersTab {...p} />}
        {!p.disabled && p.tab === 'group' && <GroupTab {...p} />}
        {!p.disabled && p.tab === 'sort' && <SortTab {...p} />}
        {!p.disabled && p.tab === 'limit' && <LimitTab {...p} />}
        {p.tab === 'results' && p.results}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- columns

function ColumnsTab({ model, catalog, apply }: Props) {
  const [expr, setExpr] = useState('');
  const [alias, setAlias] = useState('');
  const tables = useMemo(() => new Map(model.tables.map((t) => [t.id, t])), [model.tables]);
  const kindOf = (c: BuilderColumn) => {
    const t = c.tableId ? tables.get(c.tableId) : undefined;
    return t && c.column ? columnsOf(catalog, t).find((x) => x.name === c.column)?.kind : undefined;
  };
  const addCalc = () => {
    if (!expr.trim()) return;
    apply((m) => M.addCalculated(m, expr.trim(), alias.trim() || M.uniqueOutputName(m, 'expr')).model);
    setExpr('');
    setAlias('');
  };
  return (
    <div className="lkb-cols">
      {model.columns.length === 0 ? (
        <div className="lkb-panel-empty">
          No columns chosen: the query returns every column (<code>SELECT *</code>). Tick columns on the cards, or add a calculated column below.
        </div>
      ) : (
        <table className="lkb-grid" aria-label="Output columns">
          <thead>
            <tr>
              <th className="w-out"><span className="sr-only">Show</span></th>
              <th>Column</th>
              <th>Name in results</th>
              <th>Aggregate</th>
              <th className="w-act"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {model.columns.map((c, i) => {
              const t = c.tableId ? tables.get(c.tableId) : undefined;
              const k = kindOf(c);
              const numeric = kindClass(k as never) === 'number' || !!c.expr;
              return (
                <tr key={c.id} className={c.output === false ? 'hidden-col' : ''}>
                  <td className="w-out">
                    <input type="checkbox" className="lkb-check" checked={c.output !== false} aria-label={`Show ${columnTitle(c, model)} in the results`}
                      title={c.output === false ? 'Hidden: only used for sorting / grouping / HAVING' : 'Shown in the results'}
                      onChange={(e) => apply((m) => M.updateColumn(m, c.id, { output: e.target.checked }))} />
                  </td>
                  <td>
                    {c.expr != null && c.expr !== '' || !c.column ? (
                      <input className="input xs mono lkb-expr" aria-label="Expression" value={c.expr ?? ''} placeholder={c.agg === 'count' ? '* (all rows)' : 'expression'}
                        onChange={(e) => apply((m) => M.updateColumn(m, c.id, { expr: e.target.value || null }), `expr:${c.id}`)} />
                    ) : (
                      <span className="lkb-colref" title={`${t?.alias}.${t?.table}.${c.column}`}>
                        <span className="lkb-colref-as">{t?.as}.</span>{c.column}
                      </span>
                    )}
                  </td>
                  <td>
                    <input className="input xs" aria-label={`Name of ${columnTitle(c, model)} in the results`} value={c.alias ?? ''} placeholder={c.column ?? 'name'}
                      onChange={(e) => apply((m) => M.updateColumn(m, c.id, { alias: e.target.value || null }), `alias:${c.id}`)} />
                  </td>
                  <td>
                    <Select size="xs" aria-label={`Aggregate of ${columnTitle(c, model)}`} value={c.agg ?? ''} searchable={false}
                      options={AGGS.filter((a) => (!c.column && !c.expr?.trim() ? a.value === 'count' : !a.value || numeric || !NUMERIC_ONLY.has(a.value as BuilderAggregate))).map((a) => ({ value: a.value, label: a.label }))}
                      onChange={(v) => apply((m) => M.updateColumn(m, c.id, { agg: (v || null) as BuilderAggregate | null }))} />
                  </td>
                  <td className="w-act">
                    <button type="button" className="icon-btn xs" aria-label={`Move ${columnTitle(c, model)} up`} title="Move up" disabled={i === 0} onClick={() => apply((m) => M.moveColumn(m, c.id, i - 1))}><ArrowUp size={12} /></button>
                    <button type="button" className="icon-btn xs" aria-label={`Move ${columnTitle(c, model)} down`} title="Move down" disabled={i === model.columns.length - 1} onClick={() => apply((m) => M.moveColumn(m, c.id, i + 1))}><ArrowDown size={12} /></button>
                    <button type="button" className="icon-btn xs" aria-label={`Remove ${columnTitle(c, model)}`} title="Remove" onClick={() => apply((m) => M.removeColumn(m, c.id))}><Trash2 size={12} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <form className="lkb-calc" onSubmit={(e) => { e.preventDefault(); addCalc(); }}>
        <Calculator size={13} aria-hidden="true" />
        <input className="input xs mono lkb-calc-expr" aria-label="Calculated column expression" placeholder="Calculated column, e.g. orders.total * 1.2 or upper(customers.name)" value={expr} onChange={(e) => setExpr(e.target.value)} />
        <input className="input xs lkb-calc-alias" aria-label="Calculated column name" placeholder="name" value={alias} onChange={(e) => setAlias(e.target.value)} />
        <button type="submit" className="btn btn-xs" disabled={!expr.trim()}><Plus size={12} /> Add</button>
        <button type="button" className="btn btn-xs" title="Add a count of the rows (count(*))" onClick={() => apply((m) => M.addCountAll(m).model)}><Hash size={12} /> Count rows</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- filters

function FiltersTab({ model, catalog, apply, filterFocus }: Props) {
  const names = useMemo(() => whereNames(model, catalog), [model, catalog]);
  if (!model.tables.length) return <div className="lkb-panel-empty">Add a table to the canvas to filter its rows.</div>;
  return (
    <div className="lkb-filters">
      <FilterBar
        columns={names.columns}
        filter={remapFilter(model.filter, names.toDisplay)}
        quick=""
        dialect="duckdb"
        onChange={(g) => apply((m) => M.setFilter(m, remapFilter(g, names.toKey)), 'filter')}
        onClose={() => undefined}
        focusRequest={filterFocus ? { column: filterFocus.column ? names.toDisplay(filterFocus.column) : null, nonce: filterFocus.nonce } : null}
        status={countConditions(model.filter) ? 'Rows are filtered before grouping (WHERE)' : null}
      />
    </div>
  );
}

// ---------------------------------------------------------------- group by / having

function GroupTab({ model, catalog, apply }: Props) {
  const having = useMemo(() => havingNames(model, catalog), [model, catalog]);
  const anyAgg = model.columns.some((c) => c.output !== false && !!c.agg);
  const auto = model.autoGroup !== false;
  const tables = new Map(model.tables.map((t) => [t.id, t]));
  const options = refOptions(model, catalog);
  const autoList = anyAgg ? model.columns.filter((c) => c.output !== false && !c.agg).map((c) => columnTitle(c, model)) : [];
  return (
    <div className="lkb-group">
      <div className="lkb-group-mode">
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => apply((m) => {
            const next = M.setAutoGroup(m, e.target.checked);
            // switching to manual starts from what the automatic grouping did
            if (!e.target.checked && !m.groupBy.length) {
              return M.setGroupBy(next, m.columns.filter((c) => c.output !== false && !c.agg).map((c) => ({ columnId: c.id })));
            }
            return next;
          })} />
          Group automatically by every column without an aggregate
        </label>
        {auto && (
          <span className="lkb-group-auto muted">
            {anyAgg ? (autoList.length ? `GROUP BY ${autoList.join(', ')}` : 'One summary row (no grouping column)') : 'No aggregate yet: choose Count, Sum… in the Columns tab to summarise rows.'}
          </span>
        )}
      </div>
      {!auto && (
        <RefList
          label="Group by"
          refs={model.groupBy}
          options={options}
          tables={tables}
          model={model}
          onChange={(refs) => apply((m) => M.setGroupBy(m, refs))}
        />
      )}
      <div className="lkb-having">
        <div className="lkb-sub-title">Having <span className="muted">— conditions on the summarised values (e.g. count &gt; 10)</span></div>
        {model.columns.length ? (
          <FilterBar
            columns={having.columns}
            filter={remapFilter(model.having, having.toDisplay)}
            quick=""
            dialect="duckdb"
            onChange={(g) => apply((m) => M.setHaving(m, remapFilter(g, having.toKey)), 'having')}
            onClose={() => undefined}
          />
        ) : <div className="lkb-panel-empty">Add output columns first.</div>}
      </div>
    </div>
  );
}

interface RefOption { value: string; label: string; ref: BuilderRef }

/** Output columns first, then every table column. */
function refOptions(model: BuilderModel, catalog: LinkCatalog | null): RefOption[] {
  const out: RefOption[] = model.columns.map((c) => ({ value: `c:${c.id}`, label: columnTitle(c, model), ref: { columnId: c.id } }));
  for (const t of model.tables) {
    for (const c of columnsOf(catalog, t)) out.push({ value: `t:${t.id}.${c.name}`, label: `${t.as}.${c.name}`, ref: { tableId: t.id, column: c.name } });
  }
  return out;
}

const refValue = (r: BuilderRef) => (r.columnId ? `c:${r.columnId}` : r.tableId ? `t:${r.tableId}.${r.column}` : `e:${r.expr ?? ''}`);

function RefList({ label, refs, options, model, onChange }: {
  label: string; refs: BuilderRef[]; options: RefOption[]; tables: Map<string, unknown>; model: BuilderModel; onChange(refs: BuilderRef[]): void;
}) {
  void model;
  return (
    <div className="lkb-reflist" role="list" aria-label={label}>
      {refs.map((r, i) => (
        <div className="lkb-refrow" role="listitem" key={i}>
          <Select size="xs" aria-label={`${label} ${i + 1}`} value={refValue(r)} options={options.map((o) => ({ value: o.value, label: o.label }))} menuMinWidth={220}
            onChange={(v) => onChange(refs.map((x, k) => (k === i ? options.find((o) => o.value === v)!.ref : x)))} />
          <button type="button" className="icon-btn xs" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(refs.filter((_, k) => k !== i))}><X size={12} /></button>
        </div>
      ))}
      {options.length > 0 && (
        <button type="button" className="btn btn-xs" onClick={() => onChange([...refs, options.find((o) => !refs.some((r) => refValue(r) === o.value))?.ref ?? options[0].ref])}>
          <Plus size={12} /> Add
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sort

function SortTab({ model, catalog, apply }: Props) {
  const options = refOptions(model, catalog);
  const set = (sort: BuilderSort[]) => apply((m) => M.setSort(m, sort));
  if (!options.length) return <div className="lkb-panel-empty">Add a table to the canvas to sort its rows.</div>;
  return (
    <div className="lkb-sort" role="list" aria-label="Sort order">
      {model.sort.length === 0 && <div className="lkb-panel-empty">No sort: rows come back in any order. Add a sort below or use “Sort by this column” on a card.</div>}
      {model.sort.map((s, i) => (
        <div className="lkb-refrow" role="listitem" key={i}>
          <span className="lkb-sort-n">{i + 1}</span>
          <Select size="xs" aria-label={`Sort column ${i + 1}`} value={refValue(s.ref)} options={options.map((o) => ({ value: o.value, label: o.label }))} menuMinWidth={220}
            onChange={(v) => set(model.sort.map((x, k) => (k === i ? { ...x, ref: options.find((o) => o.value === v)!.ref } : x)))} />
          <div className="segmented" role="radiogroup" aria-label={`Direction ${i + 1}`}>
            <button type="button" role="radio" aria-checked={s.dir === 'asc'} className={s.dir === 'asc' ? 'on' : ''} onClick={() => set(model.sort.map((x, k) => (k === i ? { ...x, dir: 'asc' } : x)))}><ArrowUp size={11} /> Ascending</button>
            <button type="button" role="radio" aria-checked={s.dir === 'desc'} className={s.dir === 'desc' ? 'on' : ''} onClick={() => set(model.sort.map((x, k) => (k === i ? { ...x, dir: 'desc' } : x)))}><ArrowDown size={11} /> Descending</button>
          </div>
          <Select size="xs" aria-label={`Empty values ${i + 1}`} value={s.nulls ?? ''} searchable={false}
            options={[{ value: '', label: 'Empty values: default' }, { value: 'first', label: 'Empty values first' }, { value: 'last', label: 'Empty values last' }]}
            onChange={(v) => set(model.sort.map((x, k) => (k === i ? { ...x, nulls: (v || null) as BuilderSort['nulls'] } : x)))} />
          <button type="button" className="icon-btn xs" aria-label={`Move sort ${i + 1} up`} disabled={i === 0} onClick={() => {
            const n = [...model.sort];
            [n[i - 1], n[i]] = [n[i], n[i - 1]];
            set(n);
          }}><ArrowUp size={12} /></button>
          <button type="button" className="icon-btn xs" aria-label={`Remove sort ${i + 1}`} onClick={() => set(model.sort.filter((_, k) => k !== i))}><X size={12} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-xs" onClick={() => set([...model.sort, { ref: (options.find((o) => !model.sort.some((s) => refValue(s.ref) === o.value)) ?? options[0]).ref, dir: 'asc', nulls: null }])}>
        <Plus size={12} /> Add sort
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- limit

function LimitTab({ model, apply }: Props) {
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v)) || 0));
  return (
    <div className="lkb-limit">
      <label className="lkb-field">
        <span>Return at most</span>
        <input className="input xs lkb-num" type="number" min={0} aria-label="Row limit" placeholder="all" value={model.limit ?? ''}
          onChange={(e) => apply((m) => M.setLimit(m, num(e.target.value)), 'limit')} />
        <span className="muted">rows</span>
        {[100, 1000, 10000].map((n) => (
          <button key={n} type="button" className={`chip${model.limit === n ? ' on' : ''}`} onClick={() => apply((m) => M.setLimit(m, n))}>{n.toLocaleString()}</button>
        ))}
        <button type="button" className={`chip${model.limit == null ? ' on' : ''}`} onClick={() => apply((m) => M.setLimit(m, null))}>All</button>
      </label>
      <label className="lkb-field">
        <span>Skip the first</span>
        <input className="input xs lkb-num" type="number" min={0} aria-label="Rows to skip" placeholder="0" value={model.offset ?? ''}
          onChange={(e) => apply((m) => M.setLimit(m, m.limit ?? null, num(e.target.value) || null), 'offset')} />
        <span className="muted">rows</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={!!model.distinct} onChange={(e) => apply((m) => M.setDistinct(m, e.target.checked))} />
        Distinct rows only (remove duplicates)
      </label>
      {model.limit != null && !model.sort.length && (
        <div className="lkb-panel-note">Without a sort, which rows make the limit can change from run to run.</div>
      )}
    </div>
  );
}

