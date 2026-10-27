// Left panel of the builder: the link's sources (members) and their mounted tables, searchable; click or Enter adds a
// table to the canvas, dragging drops it where you want it. The header edits the link. A wide member (whole database /
// whole connection) lists its default schema's tables first, then its databases → schemas → tables, each level read
// on expand (POST /links/{cid}/browse) and rendered only while open.
import { AlertTriangle, ChevronDown, ChevronRight, Database, Eye, FolderTree, LoaderCircle, Pencil, RefreshCw, Search, Table2 } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { isWideSchema, type LinkCatalog, type LinkCatalogSchema, type SourceTable } from '../../../api/links';
import { fuzzyMatch } from '../../../lib/fuzzy';
import { ROWLIT_OBJECT_MIME, type RowlitObjectDrag } from '../../../lib/dragObject';
import { getConnection } from '../../../store/connections';
import { browseKey, useLinks, type LinkBrowseEntry } from '../../../store/links';
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

/** Tables rendered per container of a wide member before "refine the search". */
export const CONTAINER_LIMIT = 500;
/** Containers "Search in alias…" reads at most at once. */
const SEARCH_LOADS = 20;

function Highlight({ text, positions }: { text: string; positions: readonly number[] | null }) {
  if (!positions?.length) return <>{text}</>;
  const set = new Set(positions);
  return <>{[...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}</>;
}

/** What a table row needs from the list. */
interface RowCtx {
  linkId: string;
  q: string;
  onCanvas: ReadonlyMap<string, number>;
  onAdd(alias: string, table: string): void;
}

/** The name a table is shown with: its path below the alias (`sales.orders`), else its link name. */
const shownName = (t: SourceTable) => (t.path?.length ? t.path.join('.') : t.linkName);

function TableRow({ ctx, alias, t, depth }: { ctx: RowCtx; alias: string; t: SourceTable; depth?: number }) {
  const n = ctx.onCanvas.get(`${alias}.${t.linkName}`) ?? 0;
  const shown = depth ? (t.path?.[t.path.length - 1] ?? t.linkName) : t.linkName;
  const m = ctx.q ? fuzzyMatch(ctx.q, shown) : null;
  const natural = `${alias}.${shownName(t)}`;
  const startDrag = (e: React.DragEvent) => {
    const drag: RowlitObjectDrag = { connectionId: ctx.linkId, providerId: 'linked', database: null, schema: alias, name: t.linkName, type: (t.type === 'view' ? 'view' : 'table') };
    e.dataTransfer.setData(ROWLIT_OBJECT_MIME, JSON.stringify(drag));
    e.dataTransfer.setData('text/plain', natural);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <div
      className={`lkb-list-item${n ? ' used' : ''}${depth ? ' nested' : ''}`}
      style={depth ? { ['--depth' as string]: depth } : undefined}
      role="treeitem"
      aria-level={(depth ?? 0) + 2}
      aria-label={depth ? natural : undefined}
      tabIndex={0}
      draggable
      onDragStart={startDrag}
      onClick={() => ctx.onAdd(alias, t.linkName)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ctx.onAdd(alias, t.linkName);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const all = [...(e.currentTarget.closest('.lkb-list-body')?.querySelectorAll<HTMLElement>('.lkb-list-item, .lkb-list-node') ?? [])];
          const i = all.indexOf(e.currentTarget);
          all[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
        }
      }}
      title={`${natural}${t.name !== t.linkName && !t.path?.length ? ` (source: ${t.name})` : ''} · ${t.columns.length} columns${t.rowEstimate ? ` · ~${t.rowEstimate.toLocaleString()} rows` : ''}\nClick to add, or drag onto the canvas.`}
    >
      {t.type === 'view' ? <Eye size={12} aria-hidden="true" /> : <Table2 size={12} aria-hidden="true" />}
      <span className="lkb-list-name"><Highlight text={shown} positions={m ? m.positions : null} /></span>
      {n > 0 && <span className="lkb-list-used" title={`On the canvas${n > 1 ? ` ${n} times` : ''}`}>{n > 1 ? `×${n}` : '•'}</span>}
      <span className="lkb-list-cols">{t.columns.length}</span>
    </div>
  );
}

// ---------------------------------------------------------------- wide members

interface TreeCtx extends RowCtx {
  alias: string;
  levels: readonly string[];
  browse: Record<string, LinkBrowseEntry> | undefined;
  expanded: ReadonlySet<string>;
  toggle(key: string): void;
}

const matches = (q: string, name: string) => !q || !!fuzzyMatch(q, name);

/** A loaded container (or one of its loaded descendants) has a name or a table matching `q`. */
function hasMatch(ctx: TreeCtx, path: readonly string[], q: string, depth = 0): boolean {
  if (depth > 4) return false;
  const r = ctx.browse?.[browseKey(ctx.alias, path)]?.result;
  if (!r) return false;
  if (r.tables.some((t) => matches(q, t.path?.[t.path.length - 1] ?? t.linkName))) return true;
  return r.children.some((c) => matches(q, c.name) || hasMatch(ctx, [...path, c.name], q, depth + 1));
}

/** The contents of the container at `path` (children or tables), loaded on first render. */
function Container({ ctx, path }: { ctx: TreeCtx; path: readonly string[] }) {
  const key = browseKey(ctx.alias, path);
  const entry = ctx.browse?.[key];
  const depth = path.length;
  useEffect(() => {
    if (!entry) void useLinks.getState().browseLevel(ctx.linkId, ctx.alias, path);
  }, [entry, ctx.linkId, ctx.alias, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const note = (body: ReactNode, error = false) => (
    <div className={`lkb-list-note nested${error ? ' error' : ''}`} style={{ ['--depth' as string]: depth }}>{body}</div>
  );
  if (!entry || (entry.status === 'loading' && !entry.result)) return note(<><LoaderCircle size={12} className="spin" aria-hidden="true" /> Loading…</>);
  if (entry.status === 'error' && !entry.result) {
    return note(<>
      <AlertTriangle size={12} aria-hidden="true" /> {entry.error ?? 'Could not read this level.'}
      <button type="button" className="link-btn" onClick={() => void useLinks.getState().browseLevel(ctx.linkId, ctx.alias, path, true)}><RefreshCw size={11} /> Retry</button>
    </>, true);
  }
  const r = entry.result!;
  if (depth < ctx.levels.length) {
    const kids = r.children.filter((c) => matches(ctx.q, c.name) || (!!ctx.q && hasMatch(ctx, [...path, c.name], ctx.q)));
    if (!r.children.length) return note(`No ${ctx.levels[depth] === 'database' ? 'database' : 'schema'} here.`);
    return (
      <>
        {kids.map((c) => <LevelNode key={c.name} ctx={ctx} path={[...path, c.name]} isDefault={c.isDefault} level={ctx.levels[depth]} />)}
        {ctx.q && !kids.length && note(`No loaded name matches “${ctx.q}”.`)}
      </>
    );
  }
  const tables = ctx.q ? r.tables.filter((t) => matches(ctx.q, t.path?.[t.path.length - 1] ?? t.linkName)) : r.tables;
  const shown = tables.slice(0, CONTAINER_LIMIT);
  return (
    <>
      {shown.map((t) => <TableRow key={t.linkName} ctx={ctx} alias={ctx.alias} t={t} depth={depth} />)}
      {!r.tables.length && note('No tables or views.')}
      {tables.length > shown.length && note(`${(tables.length - shown.length).toLocaleString()} more, refine the search to see them.`)}
    </>
  );
}

function LevelNode({ ctx, path, isDefault, level }: { ctx: TreeCtx; path: readonly string[]; isDefault: boolean; level: string }) {
  const key = browseKey(ctx.alias, path);
  const open = ctx.expanded.has(key) || (!!ctx.q && hasMatch(ctx, path, ctx.q));
  const name = path[path.length - 1];
  const m = ctx.q ? fuzzyMatch(ctx.q, name) : null;
  const loading = ctx.browse?.[key]?.status === 'loading';
  return (
    <>
      <button
        type="button"
        className="lkb-list-node"
        role="treeitem"
        aria-expanded={open}
        aria-level={path.length + 1}
        aria-label={`${level} ${name}`}
        style={{ ['--depth' as string]: path.length }}
        onClick={() => ctx.toggle(key)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const all = [...(e.currentTarget.closest('.lkb-list-body')?.querySelectorAll<HTMLElement>('.lkb-list-item, .lkb-list-node') ?? [])];
            all[all.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
          } else if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) {
            e.preventDefault();
            ctx.toggle(key);
          }
        }}
        title={`${ctx.alias}.${path.join('.')}${isDefault ? ' (default)' : ''}`}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {level === 'database' ? <Database size={12} aria-hidden="true" /> : <FolderTree size={12} aria-hidden="true" />}
        <span className="lkb-list-name"><Highlight text={name} positions={m ? m.positions : null} /></span>
        {isDefault && <span className="lkb-list-default">default</span>}
        {loading && <LoaderCircle size={11} className="spin" aria-hidden="true" />}
      </button>
      {/* a container whose own name matches shows all of its contents */}
      {open && <Container ctx={m ? { ...ctx, q: '' } : ctx} path={path} />}
    </>
  );
}

// ---------------------------------------------------------------- the list

export const TableList = forwardRef<TableListHandle, Props>(function TableList(p, ref) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  /** Open containers of wide members (browseKey). */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const browse = useLinks((s) => s.browse[p.linkId]);
  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }));
  const query = q.trim();

  const groups = useMemo(() => (p.catalog?.schemas ?? []).map((s) => {
    // a wide member's nested tables live in its tree (the catalog keeps them for the canvas and the compiler)
    const tables = s.tables.filter((t) => !t.path?.length).map((t) => {
      const m = query ? fuzzyMatch(query, t.linkName) ?? fuzzyMatch(query, `${s.alias}.${t.linkName}`) : null;
      return { t, m };
    }).filter((x) => !query || x.m).sort((a, b) => (query ? (b.m?.score ?? 0) - (a.m?.score ?? 0) : a.t.linkName.localeCompare(b.t.linkName)));
    return { s, tables, wide: isWideSchema(s) };
  }), [p.catalog, query]);
  const total = groups.reduce((a, g) => a + g.tables.length, 0);

  const toggle = (key: string) => setExpanded((cur) => {
    const n = new Set(cur);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  });

  /** "Search in alias…": read the loaded containers whose name matches the search (first levels, then their children). */
  const searchIn = (s: LinkCatalogSchema) => {
    const levels = s.levels ?? [];
    const st = useLinks.getState();
    const cache = st.browse[p.linkId] ?? {};
    const open: string[] = [];
    let loads = 0;
    const visit = (path: string[]) => {
      const r = cache[browseKey(s.alias, path)]?.result;
      if (!r) {
        if (loads++ < SEARCH_LOADS) void st.browseLevel(p.linkId, s.alias, path);
        return;
      }
      if (path.length >= levels.length) return;
      for (const c of r.children) {
        const next = [...path, c.name];
        if (fuzzyMatch(query, c.name)) {
          open.push(browseKey(s.alias, next));
          if (!cache[browseKey(s.alias, next)] && loads++ < SEARCH_LOADS) void st.browseLevel(p.linkId, s.alias, next);
        } else if (path.length + 1 < levels.length && cache[browseKey(s.alias, next)]) visit(next);
      }
    };
    visit([]);
    if (open.length) setExpanded((cur) => new Set([...cur, ...open]));
  };

  /** Enter: the best flat match, else the first loaded nested table that matches, else open the first matching container. */
  const enter = () => {
    const g = groups.find((x) => x.tables.length);
    if (g) {
      p.onAdd(g.s.alias, g.tables[0].t.linkName);
      return;
    }
    for (const { s, wide } of groups) {
      if (!wide) continue;
      const entries = Object.entries(browse ?? {}).filter(([k]) => k === s.alias || k.startsWith(`${s.alias}\u0001`));
      for (const [, e] of entries) {
        const t = e.result?.tables.find((x) => !!fuzzyMatch(query, x.path?.[x.path.length - 1] ?? x.linkName));
        if (t) {
          p.onAdd(s.alias, t.linkName);
          return;
        }
      }
      searchIn(s);
      return;
    }
  };

  const ctx: RowCtx = { linkId: p.linkId, q: query, onCanvas: p.onCanvas, onAdd: p.onAdd };

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
              if (query) enter();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              (e.currentTarget.closest('.lkb-list')?.querySelector('.lkb-list-item, .lkb-list-node') as HTMLElement | null)?.focus();
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
        {groups.map(({ s, tables, wide }) => {
          const conn = getConnection(s.connectionId);
          const open = !closed.has(s.alias) || !!query;
          if (query && !tables.length && !wide) return null;
          const tree: TreeCtx | null = wide ? { ...ctx, alias: s.alias, levels: s.levels ?? [], browse, expanded, toggle } : null;
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
                title={conn ? `${conn.name}${wide ? ` · whole ${s.scope === 'connection' ? 'connection' : 'database'}` : ''}${s.error ? ` — ${s.error}` : ''}` : s.alias}
              >
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="lkb-dot" aria-hidden="true" />
                <span className="lkb-list-alias">{s.alias}</span>
                {conn && <ProviderLogo providerId={conn.providerId} size={13} />}
                <span className="lkb-list-conn">{conn?.name ?? (s.kind === 'files' ? 'Files' : '')}</span>
                {s.error && <AlertTriangle size={12} className="lkb-warn-icon" />}
                <span className="lkb-list-count">{wide ? `${tables.length}+` : s.tables.length}</span>
              </button>
              {open && tables.map(({ t }) => <TableRow key={t.linkName} ctx={ctx} alias={s.alias} t={t} />)}
              {open && tree && (
                <>
                  {query && (
                    <button type="button" className="link-btn lkb-list-note nested" style={{ ['--depth' as string]: 0 }} onClick={() => searchIn(s)} title={`Read the ${s.levels?.[0] === 'database' ? 'databases' : 'schemas'} of ${s.alias} whose name matches “${query}”`}>
                      <Search size={11} aria-hidden="true" /> Search in {s.alias}…
                    </button>
                  )}
                  <Container ctx={tree} path={[]} />
                </>
              )}
            </div>
          );
        })}
        {query && p.catalog && total === 0 && !groups.some((g) => g.wide) && <div className="lkb-list-note">No table matches “{query}”.</div>}
      </div>
      <div className="lkb-list-foot">
        <button type="button" className="btn btn-xs" onClick={p.onEdit} title="Add sources or tables, rename, change aliases">
          <Pencil size={12} /> Edit link…
        </button>
      </div>
    </aside>
  );
});
