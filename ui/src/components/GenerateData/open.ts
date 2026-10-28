// Light entry module of Generate data (imported by commands.ts and the Data tab): where the command applies and how its tab
// opens. The tab itself is a lazy chunk (./views.tsx).
import { catalogDatabase } from '../../app/actions';
import { targetOf } from '../../commands/core';
import { isObjectTarget } from '../../commands/types';
import { getConnection, isRelational } from '../../store/connections';
import { getActiveTab, useTabs, type ViewTab } from '../../store/tabs';

export const GENERATE_VIEW_ID = 'generate-data';

/** Providers rows cannot be generated into (no relational INSERT path in the Import loaders; linked databases are read-only). */
const UNSUPPORTED_PROVIDERS = new Set(['cassandra', 'linked']);

export interface GenerateContext {
  connectionId: string;
  /** Catalog database key (null for providers without a database level). */
  database: string | null;
  schema: string | null;
  table: string;
}

/** The persisted part of a Generate data tab: which table. Settings, plan and results are never saved. */
export interface GenerateTabState {
  schema: string | null;
  table: string;
}

/** Relational, writable connection rows can be generated into. */
export function canGenerateInto(connectionId: string | null | undefined): boolean {
  const c = getConnection(connectionId);
  return !!c && isRelational(c.id) && !c.readOnly && !UNSUPPORTED_PROVIDERS.has(c.providerId);
}

/**
 * Where "Generate data…" applies: a table in the explorer (its menu target, or the explorer selection), else the active
 * tab when it shows a table (the table's object tab or its Data tab). Views and other objects never qualify.
 */
export function generateContext(args?: unknown): GenerateContext | null {
  const t = targetOf(args);
  let ctx: GenerateContext | null = null;
  if (isObjectTarget(t)) {
    if (t.ref.type === 'table') ctx = { connectionId: t.connectionId, database: t.database, schema: t.ref.schema ?? null, table: t.ref.name };
  }
  const explicit = !!args && typeof args === 'object' && 'kind' in args;
  if (!ctx && !explicit) {
    const tab = getActiveTab();
    if (tab?.connectionId) {
      if (tab.kind === 'object' && tab.ref.type === 'table') {
        ctx = { connectionId: tab.connectionId, database: tab.database, schema: tab.ref.schema ?? null, table: tab.ref.name };
      } else if (tab.kind === 'view' && tab.view === 'data') {
        const s = (tab.state ?? {}) as { schema?: string | null; name?: string; type?: string };
        if (s.name && (!s.type || s.type === 'table')) {
          ctx = { connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database), schema: s.schema ?? null, table: s.name };
        }
      }
    }
  }
  return ctx && canGenerateInto(ctx.connectionId) ? ctx : null;
}

export function generateTabKey(ctx: GenerateContext): string {
  return `generate\u0001${ctx.connectionId}\u0001${ctx.database ?? ''}\u0001${ctx.schema ?? ''}\u0001${ctx.table}`;
}

/** Opens the Generate data tab of a table (one tab per table: a second request focuses it). */
export function openGenerateData(ctx: GenerateContext): string {
  const state: GenerateTabState = { schema: ctx.schema, table: ctx.table };
  const id = useTabs.getState().openView({
    view: GENERATE_VIEW_ID, title: `Generate: ${ctx.table}`, connectionId: ctx.connectionId, database: ctx.database, state, key: generateTabKey(ctx),
  });
  useTabs.getState().requestFocus(id);
  return id;
}

/** The table a Generate data tab is for. */
export function tabTarget(tab: ViewTab): GenerateContext | null {
  const s = (tab.state ?? {}) as Partial<GenerateTabState>;
  if (!tab.connectionId || !s.table) return null;
  return { connectionId: tab.connectionId, database: tab.database, schema: s.schema ?? null, table: s.table };
}
