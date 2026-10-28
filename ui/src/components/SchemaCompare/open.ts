// Light entry module of Schema compare (imported by commands.ts): where "Compare schema…" applies and how it opens the
// tab. The view itself is a lazy chunk (./views.tsx).
import { targetOf } from '../../commands/core';
import { isConnectionTarget, isContainerTarget, isObjectTarget } from '../../commands/types';
import { getActiveTab, useTabs } from '../../store/tabs';
import { isRelational } from '../../store/connections';
import type { CompareOptions } from '../../api/types.schemaCompare';

export const SCHEMA_COMPARE_VIEW_ID = 'schema-compare';

/** One side of the comparison as the pickers hold it (catalog keys, not yet an engine endpoint). */
export interface SideState {
  connectionId: string | null;
  /** Catalog database key (null: the connection's default / providers without a database level). */
  database: string | null;
  /** Schema (MySQL/MariaDB: the database; Oracle: the user). Null: the default schema. */
  schema: string | null;
}

/** What a schema-compare tab persists in the workspace: the two sides and the options (never the result). */
export interface SchemaCompareTabState {
  source: SideState;
  target: SideState;
  options?: Partial<CompareOptions>;
}

export const EMPTY_SIDE: SideState = { connectionId: null, database: null, schema: null };

/**
 * The source side a command applies to: its explorer target (a database / schema / connection, or an object's schema),
 * else the explorer selection, else the active tab's connection; null when none is relational. Opening from the palette
 * without any connection still works (the pickers start empty), so `run` falls back to an empty source.
 */
export function compareSourceOf(args?: unknown): SideState | null {
  const t = targetOf(args);
  let side: SideState | null = null;
  if (isContainerTarget(t)) {
    if (!t.queries) side = { connectionId: t.connectionId, database: t.database, schema: t.schema };
  } else if (isConnectionTarget(t)) {
    side = { connectionId: t.connectionId, database: null, schema: null };
  } else if (isObjectTarget(t)) {
    side = { connectionId: t.connectionId, database: t.database, schema: t.ref.schema ?? null };
  }
  const explicit = !!args && typeof args === 'object' && 'kind' in args;
  if (!side && !explicit) {
    const tab = getActiveTab();
    if (tab?.connectionId) side = { connectionId: tab.connectionId, database: tab.database, schema: tab.kind === 'object' ? tab.ref.schema ?? null : null };
  }
  return side && isRelational(side.connectionId) ? side : null;
}

let seq = 0;

/** Opens a new Schema compare tab with the source pre-filled and an empty target. */
export function openSchemaCompare(source: SideState | null): string {
  const state: SchemaCompareTabState = { source: source ?? EMPTY_SIDE, target: EMPTY_SIDE };
  const where = source?.schema ?? source?.database ?? null;
  const id = useTabs.getState().openView({
    view: SCHEMA_COMPARE_VIEW_ID,
    title: where ? `Compare: ${where}` : 'Compare schemas',
    connectionId: source?.connectionId ?? null,
    database: source?.database ?? null,
    state,
    key: `schema-compare:${Date.now().toString(36)}:${++seq}`,
  });
  useTabs.getState().requestFocus(id);
  return id;
}
