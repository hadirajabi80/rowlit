// A table card of the query builder canvas: header (member badge, table, FROM marker, select-all, collapse, menu,
// remove), one row per column (output checkbox, key marker, name, type, join port) and a footer summary. Rows have a
// fixed height (geometry.ts) so join edges anchor without measuring; the body scrolls for long tables.
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Funnel, KeyRound, Link2, MoreHorizontal, X } from 'lucide-react';
import { memo, useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import type { BuilderTable, SourceColumn } from '../../../api/links';
import { kindClass } from '../../../filter/model';
import { BCARD, type CardSize } from './geometry';
import { kindLabel } from './catalog';

export interface CardColumnState {
  selected: boolean;
  /** Under an aggregate in the output (sum, count…). */
  agg: string | null;
  sort: 'asc' | 'desc' | null;
  filtered: boolean;
  joined: boolean;
}

interface Props {
  table: BuilderTable;
  size: CardSize;
  columns: readonly SourceColumn[];
  state: ReadonlyMap<string, CardColumnState>;
  color: string;
  memberLabel: string;
  isFrom: boolean;
  focused: boolean;
  /** A join drag is in progress: from this card (source) or rows of this kind class are drop targets. */
  linking: { tableId: string; column: string; kindClass: string } | null;
  dropTarget: string | null;
  missing: boolean;
  onHeaderPointerDown(e: PointerEvent<HTMLDivElement>): void;
  onToggle(column: string): void;
  onToggleAll(on: boolean): void;
  onPortPointerDown(column: string, e: PointerEvent<HTMLElement>): void;
  onScroll(scrollTop: number): void;
  onMenu(e: MouseEvent | { clientX: number; clientY: number }, column?: string): void;
  onRemove(): void;
  onCollapse(): void;
  onFocus(): void;
  onKeyDown(e: KeyboardEvent<HTMLDivElement>): void;
}

export const BuilderCard = memo(function BuilderCard(p: Props) {
  const { table: t, size, columns, state } = p;
  const bodyRef = useRef<HTMLDivElement>(null);
  const nSel = columns.filter((c) => state.get(c.name)?.selected).length;
  const all = columns.length > 0 && nSel === columns.length;
  const some = nSel > 0 && !all;
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some]);
  const linkingFromHere = p.linking?.tableId === t.id;
  const title = t.as !== t.table ? `${t.alias}.${t.table} as ${t.as}` : `${t.alias}.${t.table}`;

  return (
    <div
      className={`lkb-card${p.focused ? ' focused' : ''}${t.collapsed ? ' collapsed' : ''}${linkingFromHere ? ' linking-src' : ''}${p.missing ? ' missing' : ''}`}
      style={{ transform: `translate(${t.x}px, ${t.y}px)`, width: size.w, height: size.h, ['--member' as string]: p.color }}
      data-table-id={t.id}
      role="group"
      aria-label={`Table ${title}`}
      tabIndex={0}
      onFocus={(e) => {
        if (e.target === e.currentTarget) p.onFocus();
      }}
      onKeyDown={p.onKeyDown}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[data-col-row]')) return;
        e.preventDefault();
        e.stopPropagation();
        p.onMenu(e);
      }}
    >
      <div className="lkb-card-head" onPointerDown={p.onHeaderPointerDown} title={`${title} — ${p.memberLabel}. Drag to move.`}>
        <span className="lkb-card-strip" aria-hidden="true" />
        <input
          ref={allRef}
          type="checkbox"
          className="lkb-check"
          checked={all}
          disabled={!columns.length}
          aria-label={`Select all columns of ${t.as}`}
          title={all ? 'Clear the column selection' : 'Select every column'}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={() => p.onToggleAll(!all)}
        />
        <span className="lkb-card-titles">
          <span className="lkb-card-name">
            <span className="lkb-member" title={p.memberLabel}>{t.alias}</span>
            <span className="lkb-card-table">{t.table}</span>
          </span>
          {t.as !== t.table && <span className="lkb-card-as">as {t.as}</span>}
        </span>
        {p.isFrom && <span className="lkb-from" title="The first table of the query (FROM): joins start here">FROM</span>}
        <span className="lkb-card-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="icon-btn xs" aria-label={t.collapsed ? `Expand ${t.as}` : `Collapse ${t.as}`} title={t.collapsed ? 'Expand' : 'Collapse'} onClick={p.onCollapse}>
            {t.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <button type="button" className="icon-btn xs" aria-label={`More actions for ${t.as}`} aria-haspopup="menu" title="More actions" onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            p.onMenu({ clientX: r.left, clientY: r.bottom + 2 });
          }}>
            <MoreHorizontal size={13} />
          </button>
          <button type="button" className="icon-btn xs" aria-label={`Remove ${t.as} from the query`} title="Remove from the query" onClick={p.onRemove}>
            <X size={13} />
          </button>
        </span>
      </div>
      {!t.collapsed && (
        <>
          <div
            ref={bodyRef}
            className="lkb-card-body"
            style={{ height: size.bodyH }}
            onScroll={(e) => p.onScroll(e.currentTarget.scrollTop)}
            onWheel={(e) => {
              // the body scrolls its rows; the canvas does not pan meanwhile
              const el = e.currentTarget;
              if (el.scrollHeight > el.clientHeight && !e.ctrlKey && !e.metaKey) e.stopPropagation();
            }}
          >
            {p.missing && <div className="lkb-card-missing">This table is no longer part of the link.</div>}
            {columns.map((c) => {
              const s = state.get(c.name);
              const cls = kindClass(c.kind as never);
              const target = !!p.linking && !linkingFromHere;
              const compatible = target && p.linking!.kindClass === cls;
              return (
                <div
                  key={c.name}
                  className={`lkb-row${s?.selected ? ' sel' : ''}${target ? (compatible ? ' drop-ok' : ' drop-weak') : ''}${p.dropTarget === c.name ? ' drop-hover' : ''}`}
                  style={{ height: BCARD.rowH }}
                  data-col-row=""
                  data-table={t.id}
                  data-column={c.name}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    p.onMenu(e, c.name);
                  }}
                >
                  <input
                    type="checkbox"
                    className="lkb-check"
                    checked={!!s?.selected}
                    aria-label={`Show ${t.as}.${c.name} in the results`}
                    onChange={() => p.onToggle(c.name)}
                  />
                  <span className="lkb-row-key" aria-hidden="true">{c.isPk ? <KeyRound size={11} /> : null}</span>
                  <span
                    className="lkb-row-name"
                    title={`${c.name} · ${c.sourceType}${c.nullable ? '' : ' · not null'}${c.isPk ? ' · primary key' : ''}\nDrag onto a column of another table to join.`}
                    onPointerDown={(e) => p.onPortPointerDown(c.name, e)}
                  >
                    {c.name}
                  </span>
                  <span className="lkb-row-marks" aria-hidden="true">
                    {s?.agg && <span className="lkb-agg">{s.agg}</span>}
                    {s?.filtered && <Funnel size={10} />}
                    {s?.sort === 'asc' && <ArrowUp size={10} />}
                    {s?.sort === 'desc' && <ArrowDown size={10} />}
                    {s?.joined && <Link2 size={10} />}
                  </span>
                  <span className={`lkb-row-type kind-${cls}`} title={c.sourceType}>{kindLabel(c.kind)}</span>
                  <span
                    className="lkb-port"
                    role="button"
                    tabIndex={-1}
                    aria-label={`Join from ${t.as}.${c.name}`}
                    title="Drag to a column of another table to join"
                    onPointerDown={(e) => p.onPortPointerDown(c.name, e)}
                  />
                </div>
              );
            })}
          </div>
          <div className="lkb-card-foot">
            {nSel ? `${nSel} of ${columns.length} column${columns.length === 1 ? '' : 's'}` : `${columns.length} column${columns.length === 1 ? '' : 's'}`}
          </div>
        </>
      )}
    </div>
  );
});
