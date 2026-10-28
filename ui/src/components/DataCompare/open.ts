// Light entry module of Data compare (imported by commands.ts and by the Transfer run step): where "Compare data…"
// applies and how its tab opens. The view itself is a lazy chunk (./views.tsx).
import { targetOf } from '../../commands/core';
import { isConnectionTarget, isContainerTarget, isObjectTarget } from '../../commands/types';
import { isRelational } from '../../store/connections';
import { getActiveTab, useTabs } from '../../store/tabs';

export const DATA_COMPARE_VIEW_ID = 'data-compare';

/** One side as the pickers hold it: connection › database › schema › table (or a query). */
export interface DataSideState {
  connectionId: string | null;
  /** Catalog database key (null: the connection's current one, or no database level). */
  database: string | null;
  /** Null: the default schema. */
  schema: string | null;
  table: string | null;
  /** 'query': compare the rows of `query` (never written by a sync). */
  mode: 'table' | 'query';
  query: string;
  where: string;
}

/** What a data-compare tab persists in the workspace: the sides and the changed options (never the result). */
export interface DataCompareTabState {
  source: DataSideState;
  target: DataSideState;
  options?: Record<string, unknown>;
}

export const EMPTY_DATA_SIDE: DataSideState = { connectionId: null, database: null, schema: null, table: null, mode: 'table', query: '', where: '' };

export function side(p: Partial<DataSideState> | null | undefined): DataSideState {
  return {
    connectionId: p?.connectionId ?? null, database: p?.database ?? null, schema: p?.schema ?? null, table: p?.table ?? null,
    mode: p?.mode === 'query' ? 'query' : 'table', query: p?.query ?? '', where: p?.where ?? '',
  };
}

/**
 * The source side a command applies to: an explorer table / view (pre-filled), a schema / database / connection
 * (table empty), else the active tab's connection (and its table for a table tab); null when none is relational.
 */
export function dataCompareSourceOf(args?: unknown): DataSideState | null {
  const t = targetOf(args);
  let s: DataSideState | null = null;
  if (isObjectTarget(t)) {
    if (t.ref.type === 'table' || t.ref.type === 'view') s = side({ connectionId: t.connectionId, database: t.database, schema: t.ref.schema ?? null, table: t.ref.name });
  } else if (isContainerTarget(t)) {
    if (!t.queries) s = side({ connectionId: t.connectionId, database: t.database, schema: t.schema });
  } else if (isConnectionTarget(t)) {
    s = side({ connectionId: t.connectionId });
  }
  const explicit = !!args && typeof args === 'object' && 'kind' in args;
  if (!s && !explicit) {
    const tab = getActiveTab();
    if (tab?.connectionId) {
      const table = tab.kind === 'object' && (tab.ref.type === 'table' || tab.ref.type === 'view') ? tab.ref.name : null;
      s = side({ connectionId: tab.connectionId, database: tab.database, schema: tab.kind === 'object' ? tab.ref.schema ?? null : null, table });
    }
  }
  return s && isRelational(s.connectionId) ? s : null;
}

let seq = 0;

/** Opens a new Data compare tab; the target defaults to an empty side (or the given one, e.g. after a transfer). */
export function openDataCompare(source: DataSideState | null, target?: DataSideState | null): string {
  const state: DataCompareTabState = { source: source ?? EMPTY_DATA_SIDE, target: target ?? EMPTY_DATA_SIDE };
  const id = useTabs.getState().openView({
    view: DATA_COMPARE_VIEW_ID,
    title: source?.table ? `Compare data: ${source.table}` : 'Compare data',
    connectionId: source?.connectionId ?? null,
    database: source?.database ?? null,
    state,
    key: `data-compare:${Date.now().toString(36)}:${++seq}`,
  });
  useTabs.getState().requestFocus(id);
  return id;
}
