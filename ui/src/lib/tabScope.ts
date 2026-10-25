// The database / schema a tab works in, for its colour (lib/scopeColors.ts): console → its database and current schema
// (Oracle and the other single-level providers: the schema is the console's "database"), object tab → the object's
// schema, data tab → the table's schema. Other tabs have none.
import { catalogDatabase } from '../app/actions';
import { dbKey, useCatalog } from '../store/catalog';
import { getConnection, schemaIsDatabase } from '../store/connections';
import { useTabs, type Tab } from '../store/tabs';
import { resolveScopeColor, useScopeColors, type ScopeRef } from './scopeColors';

/** The catalog's default schema of a database (single-schema databases: that schema; SQLite: main). */
function defaultSchemaOf(connectionId: string, database: string | null): string | null {
  const d = useCatalog.getState().dbs[dbKey(connectionId, database)];
  const list = d?.schemasResp?.schemas;
  return d?.schemasResp?.defaultSchema ?? d?.defaultSchema ?? (list?.length === 1 ? list[0].name : null)
    ?? (getConnection(connectionId)?.providerId === 'sqlite' ? 'main' : null);
}

/** The scope a tab lives in (null: a tab without one). Reads the catalog, so call it from a catalog selector. */
export function tabScopeRef(tab: Tab): ScopeRef | null {
  if (tab.kind === 'console') {
    const cid = tab.connectionId;
    if (!cid) return null;
    const database = catalogDatabase(cid, tab.database);
    const schema = schemaIsDatabase(getConnection(cid)?.providerId) ? tab.database ?? defaultSchemaOf(cid, database) : defaultSchemaOf(cid, database);
    return { connectionId: cid, database, schema };
  }
  if (tab.kind === 'object') {
    return { connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database ?? tab.ref.database ?? null), schema: tab.ref.schema ?? null };
  }
  if (tab.kind === 'view' && tab.view === 'results') {
    // The results of a console carry its colour.
    const id = (tab.state as { consoleTabId?: string } | null)?.consoleTabId;
    const c = id ? useTabs.getState().tabs.find((t) => t.id === id) : undefined;
    return c?.kind === 'console' ? tabScopeRef(c) : null;
  }
  if (tab.kind === 'view' && tab.view === 'data' && tab.connectionId) {
    const st = tab.state as { schema?: string | null } | null;
    return { connectionId: tab.connectionId, database: catalogDatabase(tab.connectionId, tab.database), schema: st?.schema ?? null };
  }
  return null;
}

/** The colour tag of the tab's schema (else its database), null when none is set. */
export function useTabScopeColor(tab: Tab): string | null {
  const map = useScopeColors();
  const key = useCatalog(() => {
    const r = tabScopeRef(tab);
    return r ? `${r.connectionId}\u0002${r.database ?? ''}\u0002${r.schema ?? ''}` : '';
  });
  if (!key) return null;
  const [cid, db, schema] = key.split('\u0002');
  return resolveScopeColor(map, cid, db || null, schema || null);
}
