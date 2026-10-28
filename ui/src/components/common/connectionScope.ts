// Pure helpers of the connection › database › schema picker (ConnectionScopePicker.tsx): the scope it shows and the
// engine endpoint it stands for. Kept apart so the component file only exports components.
import { dbKey, useCatalog } from '../../store/catalog';
import { getConnection, hasDatabaseLevel } from '../../store/connections';

export interface ConnectionScope {
  connectionId: string | null;
  /** Catalog database key (null: the connection's current database, or no database level). */
  database: string | null;
  /** Null: the default schema. */
  schema: string | null;
}

/** The catalog database key the picker reads schemas from (the connection's current database when none is chosen). */
export function scopeCatalogDatabase(connectionId: string | null, database: string | null): string | null {
  if (!connectionId) return null;
  const c = getConnection(connectionId);
  if (!c || !hasDatabaseLevel(c.providerId)) return null;
  return database ?? useCatalog.getState().conns[connectionId]?.databases?.current ?? null;
}

/**
 * The engine endpoint of a scope: the database only for providers with a database level, and the schema the picker shows
 * as "(default: x)" when none is chosen (single-level providers need one: there the schema is the database).
 */
export function scopeEndpoint(v: ConnectionScope): { connectionId: string; database: string | null; schema: string | null } | null {
  if (!v.connectionId) return null;
  const database = scopeCatalogDatabase(v.connectionId, v.database);
  const cat = useCatalog.getState().dbs[dbKey(v.connectionId, database)];
  const schema = v.schema ?? cat?.schemasResp?.defaultSchema ?? cat?.defaultSchema ?? null;
  return { connectionId: v.connectionId, database, schema };
}
