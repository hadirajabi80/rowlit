// Light entry module of the links package (imported by commands.ts): which link a command applies to, and opening the
// query builder tab. The builder view and the link editor are lazy chunks.
import type { BuilderModel } from '../../api/links';
import { targetOf } from '../../commands/core';
import { getConnection, useConnections } from '../../store/connections';
import { getActiveTab, useTabs, type ViewTab } from '../../store/tabs';

export const LINK_BUILDER_VIEW = 'links.builder';
const PROVIDER = 'linked';

export const isLink = (connectionId: string | null | undefined): connectionId is string => getConnection(connectionId)?.providerId === PROVIDER;

export const linkConnections = () => useConnections.getState().connections.filter((c) => c.providerId === PROVIDER);

/** The link a command applies to: its explicit {connectionId}, the explorer target, the active tab, else the only link. */
export function linkIdOf(args?: unknown, opts: { fallbackToOnly?: boolean } = {}): string | null {
  if (args && typeof args === 'object' && 'connectionId' in args) {
    const id = (args as { connectionId?: unknown }).connectionId;
    if (typeof id === 'string') return isLink(id) ? id : null;
  }
  const t = targetOf(args);
  if (t && 'connectionId' in t && isLink(t.connectionId)) return t.connectionId;
  const tab = getActiveTab();
  if (tab?.connectionId && isLink(tab.connectionId)) return tab.connectionId;
  if (opts.fallbackToOnly) {
    const all = linkConnections();
    if (all.length >= 1) return all[0].id;
  }
  return null;
}

/** A table to put on the canvas (alias = member schema, table = mounted name). */
export interface BuilderTableRequest {
  alias: string;
  table: string;
}

/** Persisted state of a builder tab as far as the light modules need it (full type: builder/model.ts). */
interface LightBuilderState {
  linkId: string;
  model?: BuilderModel;
  mode?: 'builder' | 'sql';
  sql?: string | null;
  viewId?: string | null;
  viewName?: string | null;
  /** Tables to add when the view mounts (explorer "Add to query builder", palette). */
  pendingAdd?: BuilderTableRequest[];
}

export const builderKey = (linkId: string, viewId?: string | null) => (viewId ? `${linkId}:${LINK_BUILDER_VIEW}:view:${viewId}` : `${linkId}:${LINK_BUILDER_VIEW}`);

function builderTitle(linkId: string, viewName?: string | null): string {
  const name = getConnection(linkId)?.name ?? 'Linked database';
  return viewName ? `${viewName} (${name})` : `Query builder: ${name}`;
}

export interface OpenBuilderOptions {
  addTables?: BuilderTableRequest[];
  /** Open a linked view: its builder model (or its SQL in Advanced mode). */
  view?: { id: string; name: string; sql: string; builder: BuilderModel | null } | null;
  /** Start in Advanced mode with this SQL. */
  sql?: string | null;
}

/** Opens (or activates) the builder tab of a link (one per link, plus one per opened linked view). */
export function openBuilder(linkId: string, opts: OpenBuilderOptions = {}): string {
  const tabs = useTabs.getState();
  const key = builderKey(linkId, opts.view?.id);
  const prev = tabs.tabs.find((t): t is ViewTab => t.kind === 'view' && t.view === LINK_BUILDER_VIEW && t.key === key);
  if (prev) {
    if (opts.addTables?.length) {
      const st = prev.state as LightBuilderState;
      tabs.updateView(prev.id, { state: { ...st, pendingAdd: [...(st.pendingAdd ?? []), ...opts.addTables] } });
    }
    tabs.activate(prev.id);
    tabs.requestFocus(prev.id);
    return prev.id;
  }
  const v = opts.view;
  const state: LightBuilderState = {
    linkId,
    ...(v?.builder ? { model: v.builder, mode: 'builder' } : v ? { mode: 'sql', sql: v.sql } : opts.sql ? { mode: 'sql', sql: opts.sql } : {}),
    viewId: v?.id ?? null, viewName: v?.name ?? null,
    pendingAdd: opts.addTables ?? [],
  };
  const id = tabs.openView({ view: LINK_BUILDER_VIEW, title: builderTitle(linkId, v?.name), connectionId: linkId, database: null, state, key });
  tabs.requestFocus(id);
  return id;
}
