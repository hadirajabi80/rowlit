// Light entry module of the Import Wizard (imported by commands.ts and the explorer): resolves where an import command
// applies and opens the wizard tab. The wizard itself is a lazy chunk (./views.tsx).
import { catalogDatabase } from '../../app/actions';
import { targetOf } from '../../commands/core';
import { isConnectionTarget, isContainerTarget, isObjectTarget } from '../../commands/types';
import { getConnection, isRelational, useConnections } from '../../store/connections';
import { getActiveTab, useTabs } from '../../store/tabs';
import { fileNameOf } from './files';

export const IMPORT_VIEW_ID = 'import.wizard';

/** Providers the wizard cannot load into (no relational INSERT path; linked databases are read-only). */
const UNSUPPORTED_PROVIDERS = new Set(['cassandra', 'linked']);

export interface ImportContext {
  connectionId: string;
  /** Catalog database key (null for providers without a database level). */
  database: string | null;
  schema: string | null;
  /** Existing table to load into (null: a new table). */
  table: string | null;
}

/** The persisted part of an import tab: where to load. Progress is never saved. */
export interface ImportTabState {
  path: string | null;
  targetMode: 'existing' | 'new';
  schema: string | null;
  table: string | null;
}

/** Relational, writable connection the wizard can load into. */
export function canImportInto(connectionId: string | null | undefined): boolean {
  const c = getConnection(connectionId);
  return !!c && isRelational(c.id) && !c.readOnly && !UNSUPPORTED_PROVIDERS.has(c.providerId);
}

/**
 * Where an import command applies: its explorer target (a table: load into it; a schema / database / connection: new
 * table), else the explorer selection, else the active tab's connection, else the first writable relational connection.
 * `forceNew` ignores a table target (the schema of the table is used instead).
 */
export function importContext(args?: unknown, opts: { forceNew?: boolean } = {}): ImportContext | null {
  const t = targetOf(args);
  let ctx: ImportContext | null = null;
  if (isObjectTarget(t)) {
    if (t.ref.type === 'table') {
      ctx = { connectionId: t.connectionId, database: t.database, schema: t.ref.schema, table: opts.forceNew ? null : t.ref.name };
    }
  } else if (isContainerTarget(t)) {
    if (!t.queries) ctx = { connectionId: t.connectionId, database: t.database, schema: t.schema, table: null };
  } else if (isConnectionTarget(t)) {
    ctx = { connectionId: t.connectionId, database: null, schema: null, table: null };
  }
  const explicit = !!args && typeof args === 'object' && 'kind' in args;
  if (!ctx && !explicit) {
    const tab = getActiveTab();
    if (tab?.connectionId) {
      if (tab.kind === 'object' && tab.ref.type === 'table' && !opts.forceNew) {
        ctx = { connectionId: tab.connectionId, database: tab.database, schema: tab.ref.schema, table: tab.ref.name };
      } else {
        ctx = { connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database), schema: tab.kind === 'object' ? tab.ref.schema : null, table: null };
      }
    }
  }
  if (!ctx && !explicit) {
    const first = useConnections.getState().connections.find((c) => canImportInto(c.id));
    if (first) ctx = { connectionId: first.id, database: null, schema: null, table: null };
  }
  return ctx && canImportInto(ctx.connectionId) ? ctx : null;
}

let seq = 0;

/** Opens a new wizard tab (several can be open at once). */
export function openImportWizard(ctx: ImportContext, path: string | null = null): string {
  const state: ImportTabState = { path, targetMode: ctx.table ? 'existing' : 'new', schema: ctx.schema, table: ctx.table };
  const title = ctx.table ? `Import: ${ctx.table}` : path ? `Import: ${fileNameOf(path)}` : 'Import data';
  const id = useTabs.getState().openView({
    view: IMPORT_VIEW_ID, title, connectionId: ctx.connectionId, database: ctx.database, state, key: `import:${Date.now().toString(36)}:${++seq}`,
  });
  useTabs.getState().requestFocus(id);
  return id;
}
