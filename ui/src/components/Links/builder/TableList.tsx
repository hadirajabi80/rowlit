// Left panel of the builder: the link's sources (members) and their mounted tables, searchable; click or Enter adds a
// table to the canvas, dragging drops it where you want it. The header edits the link.
import { AlertTriangle, ChevronDown, ChevronRight, Eye, LoaderCircle, Pencil, RefreshCw, Search, Table2 } from 'lucide-react';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { LinkCatalog } from '../../../api/links';
import { fuzzyMatch } from '../../../lib/fuzzy';
import { ROWLIT_OBJECT_MIME, type RowlitObjectDrag } from '../../../lib/dragObject';
import { getConnection } from '../../../store/connections';
import { ProviderLogo } from '../../../theme/brand/ProviderLogo';
import { memberColor } from './catalog';

export interface TableListHandle {
  focusSearch(): void;
}

interface Props {
  linkId: string;
  catalog: LinkCatalog | null;
  loading: boolean;
  error: string | null;
  /** alias.table → number of cards showing it. */
  onCanvas: ReadonlyMap<string, number>;
  onAdd(alias: string, table: string): void;
  onEdit(): void;
  onRetry(): void;
}

function Highlight({ text, positions }: { text: string; positions: readonly number[] | null }) {
  if (!positions?.length) return <>{text}</>;
  const set = new Set(positions);
  return <>{[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}</>;
}

export const TableList = forwardRef<TableListHandle, Props>(function TableList(p, ref) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }));

  const groups = useMemo(() => (p.catalog?.schemas ?? []).map((s) => {
    const tables = s.tables.map((t) => {
      const m = q.trim() ? fuzzyMatch(q.trim(), t.linkName) ?? fuzzyMatch(q.trim(), `${s.alias}.${t.linkName}`) : null;
      return { t, m };
    }).filter((x) => !q.trim() || x.m).sort((a, b) => (q.trim() ? (b.m?.score ?? 0) - (a.m?.score ?? 0) : a.t.linkName.localeCompare(b.t.linkName)));
    return { s, tables };
  }), [p.catalog, q]);
  const total = groups.reduce((a, g) => a + g.tables.length, 0);

  const startDrag = (alias: string, name: string, type: string) => (e: React.DragEvent) => {
    const drag: RowlitObjectDrag = { connectionId: p.linkId, providerId: 'linked', database: null, schema: alias, name, type: (type === 'view' ? 'view' : 'table') };
    e.dataTransfer.setData(ROWLIT_OBJECT_MIME, JSON.stringify(drag));
    e.dataTransfer.setData('text/plain', `${alias}.${name}`);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <aside className="lkb-list" aria-label="Tables of the linked database">
      <div className="lkb-list-search">
        <Search size={13} aria-hidden="true" />
        <input
          ref={searchRef}
          className="input xs"
          placeholder="Find a table…"
          aria-label="Find a table"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && q) {
              e.stopPropagation();
              setQ('');
            } else if (e.key === 'Enter') {
              const first = groups.find((g) => g.tables.length)?.tables[0];
              const g = groups.find((x) => x.tables.length);
              if (first && g) p.onAdd(g.s.alias, first.t.linkName);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              (e.currentTarget.closest('.lkb-list')?.querySelector('.lkb-list-item') as HTMLElement | null)?.focus();
            }
          }}
        />
      </div>
      <div className="lkb-list-body" role="tree" aria-label="Sources and tables">
        {p.loading && !p.catalog && (
          <div className="lkb-list-note"><LoaderCircle size={13} className="spin" /> Reading the sources…</div>
        )}
        {p.error && (
          <div className="lkb-list-note error">
            <AlertTriangle size={13} /> {p.error}
            <button type="button" className="link-btn" onClick={p.onRetry}><RefreshCw size={11} /> Retry</button>
          </div>
        )}
        {p.catalog && !p.catalog.schemas.length && (
          <div className="lkb-list-note">This link has no sources yet. <button type="button" className="link-btn" onClick={p.onEdit}>Add one…</button></div>
        )}
        {groups.map(({ s, tables }) => {
          const conn = getConnection(s.connectionId);
          const open = !closed.has(s.alias) || !!q.trim();
          if (q.trim() && !tables.length) return null;
          return (
            <div key={s.alias} className="lkb-list-group" style={{ ['--member' as string]: memberColor(p.catalog, s.alias) }}>
              <button
                type="button"
                className="lkb-list-member"
                role="treeitem"
                aria-expanded={open}
                aria-level={1}
                onClick={() => setClosed((c) => {
                  const n = new Set(c);
                  if (n.has(s.alias)) n.delete(s.alias);
                  else n.add(s.alias);
                  return n;
                })}
                title={conn ? `${conn.name}${s.error ? ` — ${s.error}` : ''}` : s.alias}
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="lkb-dot" aria-hidden="true" />
                <span className="lkb-list-alias">{s.alias}</span>
                {conn && <ProviderLogo providerId={conn.providerId} size={13} />}
                <span className="lkb-list-conn">{conn?.name ?? (s.kind === 'files' ? 'Files' : '')}</span>
                {s.error && <AlertTriangle size={12} className="lkb-warn-icon" />}
                <span className="lkb-list-count">{s.tables.length}</span>
              </button>
              {open && tables.map(({ t, m }) => {
                const n = p.onCanvas.get(`${s.alias}.${t.linkName}`) ?? 0;
                return (
                  <div
                    key={t.linkName}
                    className={`lkb-list-item${n ? ' used' : ''}`}
                    role="treeitem"
                    aria-level={2}
                    tabIndex={0}
                    draggable
                    onDragStart={startDrag(s.alias, t.linkName, t.type)}
                    onClick={() => p.onAdd(s.alias, t.linkName)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        p.onAdd(s.alias, t.linkName);
                      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const all = [...(e.currentTarget.closest('.lkb-list-body')?.querySelectorAll<HTMLElement>('.lkb-list-item') ?? [])];
                        const i = all.indexOf(e.currentTarget);
                        all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
                      }
                    }}
                    title={`${s.alias}.${t.linkName}${t.name !== t.linkName ? ` (source: ${t.name})` : ''} · ${t.columns.length} columns${t.rowEstimate ? ` · ~${t.rowEstimate.toLocaleString()} rows` : ''}\nClick to add, or drag onto the canvas.`}
                  >
                    {t.type === 'view' ? <Eye size={12} aria-hidden="true" /> : <Table2 size={12} aria-hidden="true" />}
                    <span className="lkb-list-name"><Highlight text={t.linkName} positions={m && fuzzyMatch(q.trim(), t.linkName) ? m.positions : null} /></span>
                    {n > 0 && <span className="lkb-list-used" title={`On the canvas${n > 1 ? ` ${n} times` : ''}`}>{n > 1 ? `×${n}` : '•'}</span>}
                    <span className="lkb-list-cols">{t.columns.length}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {q.trim() && p.catalog && total === 0 && <div className="lkb-list-note">No table matches “{q.trim()}”.</div>}
      </div>
      <div className="lkb-list-foot">
        <button type="button" className="btn btn-xs" onClick={p.onEdit} title="Add sources or tables, rename, change aliases">
          <Pencil size={12} /> Edit link…
        </button>
      </div>
    </aside>
  );
});
