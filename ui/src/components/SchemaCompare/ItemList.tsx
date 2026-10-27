// Left pane of a comparison: status filter chips with counts, a search box, and the items grouped by kind with a
// checkbox each (what "Generate script" takes) and a status badge. Arrow keys move the focused item.
import { TriangleAlert, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import type { CompareItem, CompareStatus } from '../../api/types.schemaCompare';
import {
  countStatuses, groupItems, groupState, STATUS_LABELS, STATUS_ORDER, toggle, toggleMany, worstSeverity, type ItemFilter,
} from './model';

export interface ItemListProps {
  items: readonly CompareItem[];
  filter: ItemFilter;
  onFilter: (f: ItemFilter) => void;
  selection: ReadonlySet<string>;
  onSelection: (s: Set<string>) => void;
  focusedId: string | null;
  onFocus: (id: string) => void;
}

export function StatusBadge({ status }: { status: CompareStatus }) {
  return <span className={`sc-badge sc-${status}`}>{STATUS_LABELS[status]}</span>;
}

function GroupCheck({ state, label, onChange }: { state: 'all' | 'none' | 'some'; label: string; onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={state === 'all'} onChange={(e) => onChange(e.target.checked)} />;
}

export function ItemList({ items, filter, onFilter, selection, onSelection, focusedId, onFocus }: ItemListProps) {
  const counts = useMemo(() => countStatuses(items), [items]);
  const groups = useMemo(() => groupItems(items, filter), [items, filter]);
  const visible = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const listRef = useRef<HTMLDivElement>(null);

  const setStatus = (s: CompareStatus) => {
    const next = new Set(filter.statuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onFilter({ ...filter, statuses: next });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    if (!visible.length) return;
    e.preventDefault();
    const at = visible.findIndex((i) => i.id === focusedId);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1
      : e.key === 'ArrowDown' ? Math.min(visible.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
    const id = visible[next].id;
    onFocus(id);
    [...(listRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [])].find((n) => n.dataset.itemId === id)?.focus();
  };

  return (
    <div className="sc-list">
      <div className="sc-filters" role="group" aria-label="Show">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className={`sc-chip sc-chip-${s}${filter.statuses.has(s) ? ' on' : ''}`}
            aria-pressed={filter.statuses.has(s)}
            onClick={() => setStatus(s)}
          >
            {STATUS_LABELS[s]} <span className="sc-count">{counts[s]}</span>
          </button>
        ))}
      </div>
      <label className="sc-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="input"
          type="search"
          placeholder="Filter objects"
          aria-label="Filter objects"
          value={filter.search}
          onChange={(e) => onFilter({ ...filter, search: e.target.value })}
        />
      </label>
      <div className="sc-items" ref={listRef} onKeyDown={onKeyDown} role="list" aria-label="Compared objects">
        {groups.length === 0 && <p className="muted sc-empty">{items.length ? 'No object matches the filter.' : 'Nothing to compare.'}</p>}
        {groups.map((g) => (
          <section key={g.kind} className="sc-group" aria-label={g.label}>
            <header className="sc-group-head">
              <GroupCheck state={groupState(selection, g.items)} label={`Select all ${g.label.toLowerCase()}`} onChange={(on) => onSelection(toggleMany(selection, g.items, on))} />
              <span className="sc-group-title">{g.label}</span>
              <span className="sc-count">{g.items.length}</span>
            </header>
            {g.items.map((it) => {
              const sev = worstSeverity(it.warnings);
              return (
                <div key={it.id} role="listitem" className={`sc-item${it.id === focusedId ? ' focused' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${it.name}`}
                    checked={selection.has(it.id)}
                    disabled={it.status === 'identical'}
                    onChange={(e) => onSelection(toggle(selection, it.id, e.target.checked))}
                  />
                  <button
                    type="button"
                    className="sc-item-name"
                    data-item-id={it.id}
                    tabIndex={it.id === focusedId || (!focusedId && it === visible[0]) ? 0 : -1}
                    aria-current={it.id === focusedId ? 'true' : undefined}
                    onClick={() => onFocus(it.id)}
                    title={it.changes.join('\n')}
                  >
                    <span className="sc-name">{it.name}</span>
                    {it.detail && <span className="sc-detail muted">on {it.detail}</span>}
                  </button>
                  {sev === 'dataLoss' && <TriangleAlert size={13} className="sc-sev-dataLoss" aria-label="Data loss" />}
                  {sev === 'warning' && <TriangleAlert size={13} className="sc-sev-warning" aria-label="Warning" />}
                  <StatusBadge status={it.status} />
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
