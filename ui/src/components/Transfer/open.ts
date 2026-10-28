// Light entry module of Data Transfer (imported by commands.ts): where a transfer command applies and how its tab opens.
// The wizard itself is a lazy chunk (./views.tsx).
import { catalogDatabase } from '../../app/actions';
import { targetOf } from '../../commands/core';
import { isConnectionTarget, isContainerTarget, isObjectTarget } from '../../commands/types';
import { getConnection, isRelational, useConnections } from '../../store/connections';
import { getActiveTab, useTabs } from '../../store/tabs';

export const TRANSFER_VIEW_ID = 'transfer';

export interface TransferContext {
  connectionId: string;
  /** Catalog database key (null for providers without a database level). */
  database: string | null;
  schema: string | null;
  /** Pre-ticked tables / views of the schema. */
  tables: { name: string; type: 'table' | 'view' }[];
  /** Start with "SQL file" as the target. */
  dump?: boolean;
}

/** The persisted part of a transfer tab (tab.state). Plans, progress and results are never saved. */
export interface TransferTabState {
  schema: string | null;
  tables: { name: string; type: 'table' | 'view' }[];
  targetKind: 'connection' | 'file';
}

/** A relational connection rows can be read from (the engine refines this with /transfer/support). */
export function canTransferFrom(connectionId: string | null | undefined): boolean {
  const c = getConnection(connectionId);
  return !!c && isRelational(c.id);
}

/**
 * Where a transfer command applies: its explorer target (tables / views: those pre-ticked; a schema / database /
 * connection: nothing ticked), else the explorer selection, else the active tab's connection, else the first relational
 * connection.
 */
export function transferContext(args?: unknown): TransferContext | null {
  const t = targetOf(args);
  let ctx: TransferContext | null = null;
  if (isObjectTarget(t)) {
    const refs = (t.refs?.length ? t.refs : [t.ref]).filter((r) => r.type === 'table' || r.type === 'view');
    if (refs.length > 0) {
      ctx = {
        connectionId: t.connectionId, database: t.database, schema: refs[0].schema ?? null,
        tables: refs.filter((r) => (r.schema ?? null) === (refs[0].schema ?? null)).map((r) => ({ name: r.name, type: r.type === 'view' ? 'view' : 'table' })),
      };
    }
  } else if (isContainerTarget(t)) {
    if (!t.queries) ctx = { connectionId: t.connectionId, database: t.database, schema: t.schema, tables: [] };
  } else if (isConnectionTarget(t)) {
    ctx = { connectionId: t.connectionId, database: null, schema: null, tables: [] };
  }
  const explicit = !!args && typeof args === 'object' && 'kind' in args;
  if (!ctx && !explicit) {
    const tab = getActiveTab();
    if (tab?.connectionId && canTransferFrom(tab.connectionId)) {
      const objectTab = tab.kind === 'object' && (tab.ref.type === 'table' || tab.ref.type === 'view');
      ctx = {
        connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database),
        schema: tab.kind === 'object' ? tab.ref.schema ?? null : null,
        tables: objectTab ? [{ name: tab.ref.name, type: tab.ref.type === 'view' ? 'view' : 'table' }] : [],
      };
    }
  }
  if (!ctx && !explicit) {
    const first = useConnections.getState().connections.find((c) => canTransferFrom(c.id));
    if (first) ctx = { connectionId: first.id, database: null, schema: null, tables: [] };
  }
  return ctx && canTransferFrom(ctx.connectionId) ? ctx : null;
}

let seq = 0;

/** Opens a new transfer tab (several can be open at once). */
export function openTransfer(ctx: TransferContext): string {
  const state: TransferTabState = { schema: ctx.schema, tables: ctx.tables, targetKind: ctx.dump ? 'file' : 'connection' };
  const what = ctx.tables.length === 1 ? ctx.tables[0].name : ctx.schema ?? getConnection(ctx.connectionId)?.name ?? '';
  const title = `${ctx.dump ? 'Dump' : 'Transfer'}${what ? `: ${what}` : ''}`;
  const id = useTabs.getState().openView({
    view: TRANSFER_VIEW_ID, title, connectionId: ctx.connectionId, database: ctx.database, state, key: `transfer:${Date.now().toString(36)}:${++seq}`,
  });
  useTabs.getState().requestFocus(id);
  return id;
}
