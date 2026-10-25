// Opening Data tabs (PLAN-M1.5 A1): a `view` tab registered as 'data' (components/layout/tabViews).
import type { CatalogObjectType, CellValue, Dialect } from '../../api/types';
import { newCondition, newGroup, type FilterGroup } from '../../filter/model';
import { dbKey, useCatalog } from '../../store/catalog';
import { dialectOrNull } from '../../store/connections';
import { useTabs, type Tab, type ViewTab } from '../../store/tabs';
import { focusIsLost } from '../common/focus';
import { focusGrid } from '../Grid/controller';

export const DATA_VIEW = 'data';

/** Serializable state of a Data tab (persisted with the workspace). */
export interface DataTabState {
  schema: string | null;
  name: string;
  type?: CatalogObjectType;
  /** Initial / externally requested filter (FK navigation); applied when `nonce` changes. */
  filter?: FilterGroup | null;
  /** Quick search over the text columns (persisted). */
  quick?: string;
  /** Server ORDER BY by column name (persisted). */
  sort?: SortByName[];
  nonce?: number;
  /** Set on every explicit open of the table: a tab whose load failed loads again (it does not stay on the old error). */
  retry?: number;
}

/** A sort key stored by column name (column positions can change between sessions). */
export interface SortByName {
  column: string;
  dir: 'asc' | 'desc';
}

export interface OpenDataTabOptions {
  connectionId: string;
  database: string | null;
  schema: string | null;
  name: string;
  type?: CatalogObjectType;
  /** Equality filter on key columns (FK navigation), or a full filter tree. */
  filter?: { column: string; value: CellValue }[] | FilterGroup | null;
}

/** SQL Server / SQLite match object names case-insensitively; the other servers keep `Orders` and `orders` apart. */
const caseInsensitive = (dialect: Dialect | null): boolean => dialect === 'tsql' || dialect === 'sqlite';

/**
 * Identity of the Data tab of one object. Each part is separated by a control character (a schema `a` with the table
 * `b.c` is not the schema `a.b` with the table `c`), and names are only case-folded where the server does (PostgreSQL's
 * `"Orders"` and `orders` are two tables and must not share a tab).
 */
export function dataTabKey(connectionId: string, database: string | null, schema: string | null, name: string, dialect: Dialect | null = dialectOrNull(connectionId)): string {
  const k = `data\u0001${connectionId}\u0001${database ?? ''}\u0001${schema ?? ''}\u0001${name}`;
  return caseInsensitive(dialect) ? k.toLowerCase() : k;
}

/** The key tabs were given before `dataTabKey` was exact (still in restored workspaces). */
const legacyDataTabKey = (connectionId: string, database: string | null, schema: string | null, name: string): string =>
  `${connectionId}|${database ?? ''}|${schema ?? ''}.${name}`.toLowerCase();

export function pairsToFilter(pairs: { column: string; value: CellValue }[]): FilterGroup {
  return newGroup('and', pairs.map((p) => {
    if (p.value === null) return newCondition(p.column, 'isNull');
    const v = typeof p.value === 'object' ? null : p.value;
    return newCondition(p.column, 'eq', [v]);
  }));
}

export function openDataTab(o: OpenDataTabOptions): string {
  const filter = !o.filter ? null : Array.isArray(o.filter) ? pairsToFilter(o.filter) : o.filter;
  const dialect = dialectOrNull(o.connectionId);
  // The same table opened from a list that omits the default schema and from one that names it is one tab.
  const schemaForKey = o.schema ?? useCatalog.getState().dbs[dbKey(o.connectionId, o.database)]?.defaultSchema ?? null;
  const key = dataTabKey(o.connectionId, o.database, schemaForKey, o.name, dialect);
  const tabs = useTabs.getState();
  const isDataTab = (t: Tab): t is ViewTab => t.kind === 'view' && t.view === DATA_VIEW;
  const sameObject = (t: ViewTab) => {
    const s = (t.state ?? {}) as Partial<DataTabState>;
    return s.name === o.name && (s.schema ?? null) === (o.schema ?? null);
  };
  // A tab restored from an older workspace carries the old key: adopt the new one so that it is found.
  const legacy = legacyDataTabKey(o.connectionId, o.database, o.schema, o.name);
  const stale = tabs.tabs.find((t): t is ViewTab => isDataTab(t) && t.key === legacy && t.key !== key && sameObject(t));
  if (stale) tabs.updateView(stale.id, { key });
  const existing = useTabs.getState().tabs.find((t): t is ViewTab => isDataTab(t) && t.key === key);
  const cur = (existing?.state ?? {}) as Partial<DataTabState>;
  // Opening a table that is already open shows that tab as it is (its filter, search and sort stay); only a filter that
  // was asked for (FK navigation, a search hit) replaces the filter. `retry` makes a tab whose load failed load again.
  const state: DataTabState = existing && !filter
    ? { ...cur, schema: o.schema, name: o.name, type: o.type ?? cur.type, retry: Date.now() }
    : { ...cur, schema: o.schema, name: o.name, type: o.type, filter, nonce: Date.now(), retry: Date.now() };
  return useTabs.getState().openView({
    view: DATA_VIEW,
    title: `${o.schema ? `${o.schema}.` : ''}${o.name}`,
    connectionId: o.connectionId,
    database: o.database,
    state,
    key,
  });
}

export const dataGridKey = (tabId: string) => `data:${tabId}`;

// ------------------------------------------------------------------ primary focus (design-15)

/** Data tabs whose grid should take focus as soon as it renders (opened from a command before the rows arrived). */
const pendingGridFocus = new Map<string, { origin: Element | null; until: number }>();
const PENDING_FOCUS_MS = 15_000;

/**
 * `focusPrimary` of the data view: focus the tab's grid. While the grid is not rendered yet (the first page is still
 * loading) the request is remembered and the tab focuses its grid once it appears (`consumeGridFocus`), unless the
 * user has moved focus meanwhile. It never falls back to the search box: the request counts as handled.
 */
export function focusDataTabPrimary(tabId: string): boolean {
  if (focusGrid(dataGridKey(tabId))) {
    pendingGridFocus.delete(tabId);
    return true;
  }
  pendingGridFocus.set(tabId, { origin: typeof document === 'undefined' ? null : document.activeElement, until: Date.now() + PENDING_FOCUS_MS });
  return true;
}

/** Called by the data tab once its grid is rendered: performs a remembered focus request (true when it did). */
export function consumeGridFocus(tabId: string): boolean {
  const req = pendingGridFocus.get(tabId);
  if (!req) return false;
  if (Date.now() > req.until || useTabs.getState().activeId !== tabId) {
    pendingGridFocus.delete(tabId);
    return false;
  }
  // The user went somewhere else meanwhile (clicked the search box, another tab, …): leave focus alone.
  const a = typeof document === 'undefined' ? null : document.activeElement;
  if (a !== req.origin && !focusIsLost()) {
    pendingGridFocus.delete(tabId);
    return false;
  }
  if (!focusGrid(dataGridKey(tabId))) return false; // not focusable yet: the tab tries again
  pendingGridFocus.delete(tabId);
  return true;
}

export function hasPendingGridFocus(tabId: string): boolean {
  return pendingGridFocus.has(tabId);
}
