// The links store (plan-links 3): link catalogs (GET /links/{cid}/catalog, cached per link, with a fallback built from
// the link's explorer catalog while the engine runtime is unavailable), the linked views of each link, and the query
// builder's undo / redo history per tab. Lazy: imported only by components/Links/** (never by the shell), so it stays
// out of the initial bundle.
import { create } from 'zustand';
import { errorMessage, isApiError } from '../api/client';
import {
  linksApi, type BuilderModel, type LinkBrowseResult, type LinkCatalog, type LinkCatalogSchema, type LinkedView, type LinkedViewInput,
  type LinkTableRef, type SourceColumn, type SourceTable,
} from '../api/links';
import type { CatalogObject, ColumnKind } from '../api/types';
import { dbKey, useCatalog } from './catalog';

export type LinkLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LinkCatalogEntry {
  status: LinkLoadStatus;
  catalog: LinkCatalog | null;
  error: string | null;
  /** 'engine' = GET /links/{cid}/catalog; 'explorer' = rebuilt from the link's connection catalog (no kinds, no relations). */
  source: 'engine' | 'explorer' | null;
  loadedAt: number | null;
}

export interface LinkViewsEntry {
  status: LinkLoadStatus;
  views: LinkedView[];
  error: string | null;
}

/** Undo / redo stacks of one builder tab (models, newest last). */
export interface BuilderHistory {
  past: BuilderModel[];
  future: BuilderModel[];
  /** Coalescing key of the last commit (typing in one field is one undo step). */
  lastKey: string | null;
  lastAt: number;
}

export const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;

/** One level of a wide member (POST /links/{cid}/browse), by browseKey(alias, path). */
export interface LinkBrowseEntry {
  status: LinkLoadStatus;
  result: LinkBrowseResult | null;
  error: string | null;
}

/** State of a table resolved by engine name (POST /links/{cid}/resolve): found, not mounted, or the call failed. */
export type LinkResolveStatus = 'loading' | 'ok' | 'missing' | 'error';

/** Key of a member level in LinksState.browse (alias + path). */
export const browseKey = (alias: string, path: readonly string[]) => [alias, ...path].join('\u0001');
/** Key of a table in LinksState.resolved. */
export const tableKey = (alias: string, table: string) => `${alias}\u0001${table}`;

/**
 * The catalog with the tables loaded on demand (`extra`, by alias) added to their member's schema (each engine name
 * once): the builder, its compiler and the join inference then see them like any mounted table.
 */
export function withExtraTables(c: LinkCatalog, extra: Record<string, SourceTable[]> | undefined): LinkCatalog {
  if (!extra) return c;
  let changed = false;
  const schemas = c.schemas.map((s) => {
    const more = extra[s.alias];
    if (!more?.length) return s;
    const have = new Set(s.tables.map((t) => t.linkName.toLowerCase()));
    const add = more.filter((t) => !have.has(t.linkName.toLowerCase()));
    if (!add.length) return s;
    changed = true;
    return { ...s, tables: [...s.tables, ...add] };
  });
  return changed ? { ...c, schemas } : c;
}

interface LinksState {
  catalogs: Record<string, LinkCatalogEntry>;
  views: Record<string, LinkViewsEntry>;
  history: Record<string, BuilderHistory>;
  /** Levels of wide members loaded so far, by link id then browseKey. */
  browse: Record<string, Record<string, LinkBrowseEntry>>;
  /** Tables of wide members loaded on demand (browse / resolve), by link id then alias; merged into `catalogs`. */
  extra: Record<string, Record<string, SourceTable[]>>;
  /** Tables asked for by engine name, by link id then tableKey. */
  resolved: Record<string, Record<string, LinkResolveStatus>>;
  loadCatalog(linkId: string, refresh?: boolean): Promise<LinkCatalog | null>;
  /** One level of a wide member (cached; `refresh` reads the source again). Its tables join the catalog. */
  browseLevel(linkId: string, alias: string, path: readonly string[], refresh?: boolean): Promise<LinkBrowseResult | null>;
  /** Loads the tables (engine names) the catalog does not have yet, e.g. the nested tables a saved model uses. */
  resolveTables(linkId: string, refs: readonly LinkTableRef[]): Promise<void>;
  loadViews(linkId: string, force?: boolean): Promise<LinkedView[]>;
  saveView(linkId: string, id: string | null, input: LinkedViewInput): Promise<LinkedView>;
  deleteView(linkId: string, id: string): Promise<void>;
  /** A link changed or was deleted: drop its catalog and views. */
  forget(linkId: string): void;
  /** Records `prev` before a change of the tab's model; `key` merges quick successive edits of the same thing. */
  record(tabId: string, prev: BuilderModel, key?: string | null): void;
  /** The model to go back to (and remembers `current` for redo), or null. */
  undo(tabId: string, current: BuilderModel): BuilderModel | null;
  redo(tabId: string, current: BuilderModel): BuilderModel | null;
  clearHistory(tabId: string): void;
}

const EMPTY_HISTORY: BuilderHistory = { past: [], future: [], lastKey: null, lastAt: 0 };
const inflight = new Map<string, Promise<LinkCatalog | null>>();
const browsing = new Map<string, Promise<LinkBrowseResult | null>>();

/** Without `linkId`'s key. */
const drop = <T>(r: Record<string, T>, linkId: string): Record<string, T> => {
  if (!(linkId in r)) return r;
  const out = { ...r };
  delete out[linkId];
  return out;
};

export const useLinks = create<LinksState>((set, get) => ({
  catalogs: {},
  views: {},
  history: {},
  browse: {},
  extra: {},
  resolved: {},

  loadCatalog(linkId, refresh = false) {
    const cur = get().catalogs[linkId];
    if (!refresh && cur?.status === 'ready') return Promise.resolve(cur.catalog);
    const running = inflight.get(linkId);
    if (running && !refresh) return running;
    // a refresh reads the wide members' levels and nested tables again too (on demand, as before)
    if (refresh) set((s) => ({ browse: drop(s.browse, linkId), extra: drop(s.extra, linkId), resolved: drop(s.resolved, linkId) }));
    set((s) => ({ catalogs: { ...s.catalogs, [linkId]: { ...(cur ?? { catalog: null, source: null, loadedAt: null }), status: 'loading', error: null } } }));
    const p = (async () => {
      try {
        let catalog: LinkCatalog;
        let source: LinkCatalogEntry['source'] = 'engine';
        try {
          catalog = await linksApi.catalog(linkId, refresh);
        } catch (e) {
          // the engine's link runtime is not there yet (501) or the route is unknown (older engine): the explorer
          // catalog of the link has the same schemas (aliases) and tables, without kinds and relations
          if (!isApiError(e) || !(e.status === 501 || e.status === 404 || e.code === 'NOT_SUPPORTED')) throw e;
          catalog = await catalogFromExplorer(linkId, refresh);
          source = 'explorer';
        }
        const merged = withExtraTables(catalog, get().extra[linkId]);
        set((s) => ({ catalogs: { ...s.catalogs, [linkId]: { status: 'ready', catalog: merged, error: null, source, loadedAt: Date.now() } } }));
        return merged;
      } catch (e) {
        set((s) => ({ catalogs: { ...s.catalogs, [linkId]: { status: 'error', catalog: s.catalogs[linkId]?.catalog ?? null, error: errorMessage(e), source: null, loadedAt: null } } }));
        return null;
      } finally {
        inflight.delete(linkId);
      }
    })();
    inflight.set(linkId, p);
    return p;
  },

  browseLevel(linkId, alias, path, refresh = false) {
    const key = browseKey(alias, path);
    const cur = get().browse[linkId]?.[key];
    if (!refresh && cur?.status === 'ready') return Promise.resolve(cur.result);
    const flight = `${linkId}\u0002${key}`;
    const running = browsing.get(flight);
    if (running && !refresh) return running;
    const put = (e: LinkBrowseEntry) => set((s) => ({ browse: { ...s.browse, [linkId]: { ...s.browse[linkId], [key]: e } } }));
    put({ status: 'loading', result: cur?.result ?? null, error: null });
    const p = (async () => {
      try {
        const result = await linksApi.browse(linkId, { alias, path: [...path], ...(refresh ? { refresh } : {}) });
        put({ status: 'ready', result, error: null });
        if (result.tables.length) addExtra(linkId, alias, result.tables);
        return result;
      } catch (e) {
        put({ status: 'error', result: cur?.result ?? null, error: errorMessage(e) });
        return null;
      } finally {
        browsing.delete(flight);
      }
    })();
    browsing.set(flight, p);
    return p;
  },

  async resolveTables(linkId, refs) {
    const known = get().resolved[linkId] ?? {};
    const want = refs.filter((r, i) => !known[tableKey(r.alias, r.table)] && refs.findIndex((x) => x.alias === r.alias && x.table === r.table) === i);
    if (!want.length) return;
    const mark = (list: readonly LinkTableRef[], st: LinkResolveStatus) => set((s) => {
      const next = { ...s.resolved[linkId] };
      for (const r of list) next[tableKey(r.alias, r.table)] = st;
      return { resolved: { ...s.resolved, [linkId]: next } };
    });
    mark(want, 'loading');
    try {
      const r = await linksApi.resolve(linkId, { tables: want.map((x) => ({ alias: x.alias, table: x.table })) });
      const byAlias = new Map<string, SourceTable[]>();
      for (const t of r.tables) byAlias.set(t.alias, [...(byAlias.get(t.alias) ?? []), t.table]);
      for (const [alias, tables] of byAlias) addExtra(linkId, alias, tables);
      const found = new Set(r.tables.map((t) => tableKey(t.alias, t.table.linkName).toLowerCase()));
      mark(want.filter((x) => found.has(tableKey(x.alias, x.table).toLowerCase())), 'ok');
      mark(want.filter((x) => !found.has(tableKey(x.alias, x.table).toLowerCase())), 'missing');
    } catch {
      mark(want, 'error');
    }
  },

  async loadViews(linkId, force = false) {
    const cur = get().views[linkId];
    if (!force && cur?.status === 'ready') return cur.views;
    set((s) => ({ views: { ...s.views, [linkId]: { views: cur?.views ?? [], status: 'loading', error: null } } }));
    try {
      const views = await linksApi.views(linkId);
      set((s) => ({ views: { ...s.views, [linkId]: { views, status: 'ready', error: null } } }));
      return views;
    } catch (e) {
      set((s) => ({ views: { ...s.views, [linkId]: { views: cur?.views ?? [], status: 'error', error: errorMessage(e) } } }));
      return cur?.views ?? [];
    }
  },

  async saveView(linkId, id, input) {
    const v = await linksApi.putView(linkId, id ?? 'new', input);
    set((s) => {
      const list = s.views[linkId]?.views ?? [];
      const views = list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [...list, v];
      return { views: { ...s.views, [linkId]: { views, status: 'ready', error: null } } };
    });
    return v;
  },

  async deleteView(linkId, id) {
    await linksApi.deleteView(linkId, id);
    set((s) => ({ views: { ...s.views, [linkId]: { ...(s.views[linkId] ?? { status: 'ready', error: null }), views: (s.views[linkId]?.views ?? []).filter((v) => v.id !== id) } } }));
  },

  forget(linkId) {
    set((s) => {
      const catalogs = { ...s.catalogs };
      const views = { ...s.views };
      delete catalogs[linkId];
      delete views[linkId];
      return { catalogs, views, browse: drop(s.browse, linkId), extra: drop(s.extra, linkId), resolved: drop(s.resolved, linkId) };
    });
  },

  record(tabId, prev, key = null) {
    set((s) => {
      const h = s.history[tabId] ?? EMPTY_HISTORY;
      const now = Date.now();
      // the same field edited again within a moment: keep the first state of the run
      if (key && h.lastKey === key && now - h.lastAt < COALESCE_MS) return { history: { ...s.history, [tabId]: { ...h, lastAt: now, future: [] } } };
      const past = [...h.past, prev].slice(-HISTORY_LIMIT);
      return { history: { ...s.history, [tabId]: { past, future: [], lastKey: key, lastAt: now } } };
    });
  },

  undo(tabId, current) {
    const h = get().history[tabId];
    if (!h?.past.length) return null;
    const prev = h.past[h.past.length - 1];
    set((s) => ({ history: { ...s.history, [tabId]: { past: h.past.slice(0, -1), future: [...h.future, current], lastKey: null, lastAt: 0 } } }));
    return prev;
  },

  redo(tabId, current) {
    const h = get().history[tabId];
    if (!h?.future.length) return null;
    const next = h.future[h.future.length - 1];
    set((s) => ({ history: { ...s.history, [tabId]: { past: [...h.past, current].slice(-HISTORY_LIMIT), future: h.future.slice(0, -1), lastKey: null, lastAt: 0 } } }));
    return next;
  },

  clearHistory(tabId) {
    set((s) => {
      const history = { ...s.history };
      delete history[tabId];
      return { history };
    });
  },
}));

/** Tables of a wide member loaded on demand: kept in `extra` (survives a catalog reload) and merged into the catalog. */
function addExtra(linkId: string, alias: string, tables: readonly SourceTable[]): void {
  useLinks.setState((s) => {
    const mine = s.extra[linkId]?.[alias] ?? [];
    const byName = new Map(mine.map((t) => [t.linkName.toLowerCase(), t]));
    for (const t of tables) byName.set(t.linkName.toLowerCase(), t);
    const extra = { ...s.extra, [linkId]: { ...s.extra[linkId], [alias]: [...byName.values()] } };
    const entry = s.catalogs[linkId];
    if (!entry?.catalog) return { extra };
    const catalog = withExtraTables(entry.catalog, { [alias]: [...tables] });
    return catalog === entry.catalog ? { extra } : { extra, catalogs: { ...s.catalogs, [linkId]: { ...entry, catalog } } };
  });
}

// ---------------------------------------------------------------- explorer fallback

/** ColumnKind of a DuckDB type name (the link catalog's column types; engine TypeMap twin, coarse). */
export function kindOfDuckType(type: string): ColumnKind {
  const t = type.trim().toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|INT[1248])\b/.test(t)) return 'int';
  if (/^(DOUBLE|REAL|FLOAT|FLOAT[48])\b/.test(t)) return 'float';
  if (/^(DECIMAL|NUMERIC)\b/.test(t)) return 'decimal';
  if (/^(BOOLEAN|BOOL)\b/.test(t)) return 'bool';
  if (/^DATE$/.test(t)) return 'date';
  if (/^TIME(\s|$)/.test(t)) return 'time';
  if (/^(TIMESTAMPTZ|TIMESTAMP WITH TIME ZONE)\b/.test(t)) return 'datetimeoffset';
  if (/^(TIMESTAMP|DATETIME)/.test(t)) return 'datetime';
  if (/^UUID\b/.test(t)) return 'guid';
  if (/^(BLOB|BYTEA|VARBINARY|BINARY)\b/.test(t)) return 'binary';
  if (/^JSON\b/.test(t)) return 'json';
  if (/^(VARCHAR|TEXT|STRING|CHAR|BPCHAR)/.test(t)) return 'string';
  return 'other';
}

function tableFromObject(o: CatalogObject, schema: string): SourceTable {
  const columns: SourceColumn[] = (o.c ?? []).map(([name, type, nullable, pk]) => ({
    name, sourceType: type, kind: kindOfDuckType(type), nullable: nullable === 1, isPk: pk === 1,
  }));
  return {
    name: o.n, linkName: o.n, database: null, schema, type: o.t, columns,
    primaryKey: o.pk ?? columns.filter((c) => c.isPk).map((c) => c.name),
    foreignKeys: (o.fk ?? []).map((f) => ({ name: f.n, columns: f.cols, refSchema: f.rs, refTable: f.rt, refColumns: f.rcols })),
    comment: o.cm ?? null,
  };
}

/** The link's catalog rebuilt from its explorer catalog (GET /connections/{cid}/catalog: schemas = aliases). */
async function catalogFromExplorer(linkId: string, refresh: boolean): Promise<LinkCatalog> {
  const cat = useCatalog.getState();
  const r = await cat.loadSchemas(linkId, null, refresh);
  const names = (r?.schemas ?? []).map((s) => s.name);
  await Promise.all(names.map((n) => cat.loadSchema(linkId, null, n, refresh)));
  const d = useCatalog.getState().dbs[dbKey(linkId, null)];
  const schemas: LinkCatalogSchema[] = names.map((alias) => ({
    alias, kind: 'connection', connectionId: null, providerId: null, warnings: [],
    tables: (d?.loaded[alias]?.objects ?? []).filter((o) => o.t === 'table' || o.t === 'view' || o.t === 'mview').map((o) => tableFromObject(o, alias)),
  }));
  return { schemas, relations: [] };
}
