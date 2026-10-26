// Where a materialized result can go: writable relational connections (never a link, never read-only) and their
// database > schema > tables, read from the catalog store the explorer fills.
import { useEffect, useMemo } from 'react';
import { dbKey, useCatalog } from '../../../store/catalog';
import { getConnection, hasDatabaseLevel, isRelational, useConnections } from '../../../store/connections';
import type { ConnectionProfile } from '../../../api/types';
import { LINK_PROVIDER_ID } from '../../../api/links';

/** Providers that cannot take a CREATE TABLE ... INSERT from a link (read-only by nature, or no relational INSERT path). */
const NO_TARGET = new Set<string>([LINK_PROVIDER_ID, 'cassandra']);

/** A relational, writable connection that is not a link. */
export function canMaterializeInto(connectionId: string | null | undefined): boolean {
  const c = getConnection(connectionId);
  return !!c && isRelational(c.id) && !c.readOnly && !NO_TARGET.has(c.providerId);
}

export function materializeTargets(connections: readonly ConnectionProfile[]): ConnectionProfile[] {
  return connections.filter((c) => !c.readOnly && !NO_TARGET.has(c.providerId) && isRelational(c.id));
}

const LAST_KEY = 'rowlit.links.materialize.target';

/** The target used last time (a convenience: null when storage is unavailable). */
export function lastTarget(): { connectionId: string; database: string | null; schema: string | null } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    const v = raw ? (JSON.parse(raw) as { connectionId?: unknown; database?: unknown; schema?: unknown }) : null;
    return v && typeof v.connectionId === 'string'
      ? { connectionId: v.connectionId, database: typeof v.database === 'string' ? v.database : null, schema: typeof v.schema === 'string' ? v.schema : null }
      : null;
  } catch {
    return null;
  }
}

export function rememberTarget(t: { connectionId: string; database: string | null; schema: string | null }): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(t));
  } catch {
    // private window / blocked storage: the dialog works without it
  }
}

export interface Placement {
  connections: ConnectionProfile[];
  /** Whether the connection's provider has a database level above the schemas. */
  dbLevel: boolean;
  databases: string[];
  schemas: string[];
  defaultSchema: string | null;
  /** Names of the tables of the chosen schema (for Replace / Append). */
  tables: string[];
  loading: boolean;
}

/** Loads the pickers' options for a connection / database / schema (all cached in the catalog store). */
export function usePlacement(cid: string, database: string | null, schema: string | null): Placement {
  const all = useConnections((c) => c.connections);
  const connections = useMemo(() => materializeTargets(all), [all]);
  const conn = all.find((c) => c.id === cid);
  const dbLevel = hasDatabaseLevel(conn?.providerId);
  const catDb = dbLevel ? database : null;
  const databasesResp = useCatalog((c) => c.conns[cid]?.databases?.databases);
  const dbCat = useCatalog((c) => c.dbs[dbKey(cid, catDb)]);
  useEffect(() => {
    if (cid && dbLevel) void useCatalog.getState().loadDatabases(cid);
  }, [cid, dbLevel]);
  useEffect(() => {
    if (cid && (!dbLevel || catDb)) void useCatalog.getState().loadSchemas(cid, catDb);
  }, [cid, dbLevel, catDb]);
  useEffect(() => {
    if (cid && schema && (!dbLevel || catDb) && !dbCat?.loaded[schema]) void useCatalog.getState().loadSchema(cid, catDb, schema);
  }, [cid, dbLevel, catDb, schema, dbCat?.loaded]);
  const schemas = useMemo(() => dbCat?.schemasResp?.schemas.map((s) => s.name) ?? [], [dbCat?.schemasResp]);
  const tables = useMemo(
    () => (schema ? (dbCat?.loaded[schema]?.objects ?? []).filter((o) => o.t === 'table').map((o) => o.n).sort((a, b) => a.localeCompare(b)) : []),
    [dbCat?.loaded, schema],
  );
  return {
    connections,
    dbLevel,
    databases: databasesResp ?? [],
    schemas,
    defaultSchema: dbCat?.defaultSchema ?? dbCat?.schemasResp?.defaultSchema ?? null,
    tables,
    loading: !!cid && (dbCat?.schemasStatus === 'loading' || (!!schema && dbCat?.schemaStatus[schema] === 'loading')),
  };
}
