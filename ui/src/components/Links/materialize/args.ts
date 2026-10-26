// What the wizard commands act on, from their arguments, the explorer selection or the active console. Light module
// (the commands chunk imports it); the dialogs themselves are lazy.
import { LINK_PROVIDER_ID } from '../../../api/links';
import { objectTargetOf } from '../../../commands/core';
import { isObjectTarget } from '../../../commands/types';
import { quoteIdent } from '../../../lib/sql';
import { getConnection, isRelational } from '../../../store/connections';
import { getActiveConsole } from '../../../store/tabs';
import type { MaterializeSource } from './model';
import type { TableSource } from './addToLink';

const MOUNTABLE = new Set(['table', 'view', 'mview']);

export const isLinkId = (id: string | null | undefined): id is string => !!id && getConnection(id)?.providerId === LINK_PROVIDER_ID;

const record = (a: unknown): Record<string, unknown> | null => (a && typeof a === 'object' ? (a as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * The table `links.addTable` mounts: an explorer object (table / view of a relational connection that is not a link), or the
 * flat `{connectionId, database, schema, name, type}` of the reserved command signature.
 */
export function tableSourceOf(args?: unknown): TableSource | null {
  const o = objectTargetOf(args);
  let src: TableSource | null = null;
  if (o && isObjectTarget(o)) {
    src = { connectionId: o.connectionId, database: o.database ?? o.ref.database ?? null, schema: o.ref.schema ?? null, name: o.ref.name, type: o.ref.type };
  } else {
    const r = record(args);
    const cid = str(r?.connectionId);
    const name = str(r?.name);
    if (r && cid && name) {
      src = { connectionId: cid, database: str(r.database), schema: str(r.schema), name, type: str(r.type) ?? 'table' };
    }
  }
  if (!src) return null;
  const conn = getConnection(src.connectionId);
  if (!conn || conn.providerId === LINK_PROVIDER_ID || !isRelational(conn.id) || !MOUNTABLE.has(src.type)) return null;
  return src;
}

/**
 * What `links.materialize` writes out: explicit `{connectionId (the link), sql | viewId, params?, sessionId?, name?}`, a table of a
 * link in the explorer (`SELECT * FROM alias.table`), or - resolved when the command runs - the active linked console.
 */
export function materializeSourceOf(args?: unknown): MaterializeSource | null {
  const r = record(args);
  const cid = str(r?.connectionId);
  if (r && cid && isLinkId(cid) && (str(r.sql) || str(r.viewId))) {
    return {
      connectionId: cid, sql: str(r.sql), viewId: str(r.viewId), params: (r.params as MaterializeSource['params']) ?? null,
      sessionId: str(r.sessionId), name: str(r.name),
    };
  }
  const o = objectTargetOf(args);
  if (o && isLinkId(o.connectionId) && (o.ref.type === 'table' || o.ref.type === 'view') && o.ref.schema) {
    return { connectionId: o.connectionId, sql: `SELECT *\nFROM ${quoteIdent(o.ref.schema, 'duckdb')}.${quoteIdent(o.ref.name, 'duckdb')}`, name: o.ref.name };
  }
  return null;
}

/** The active console, when it is a linked one. */
export function activeLinkConsole() {
  const t = getActiveConsole();
  return t && isLinkId(t.connectionId) ? t : undefined;
}
