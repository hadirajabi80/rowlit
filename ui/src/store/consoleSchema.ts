// The default schema of a console as the toolbar, the schema picker and IntelliSense see it (lib/schemaScope.ts for the rules).
import { useMemo } from 'react';
import type { SchemaMode } from '../api/types';
import { catalogDatabase } from '../app/actions';
import { activeSchema, hasSchemaSwitcher, isEditorOverride, schemaModeOf } from '../lib/schemaScope';
import { dbKey, useCatalog } from './catalog';
import { useConnection } from './connections';
import { useTabSession } from './sessions';
import type { ConsoleTab } from './tabs';

export interface ConsoleSchemaState {
  /** The provider gets a schema control (SQL Server, PostgreSQL, Snowflake). */
  enabled: boolean;
  mode: SchemaMode;
  /** Where unqualified names resolve (PostgreSQL / Snowflake) or the editor schema (SQL Server); falls back to the catalog's default. */
  schema: string | null;
  /** The schema the server itself uses for the session (last read), null before the first run. */
  serverSchema: string | null;
  /** SQL Server: the tab’s editor schema differs from the login’s default schema. */
  override: boolean;
  /** PostgreSQL: the effective search_path. */
  searchPath: string[] | null;
  /** The catalog database the schemas are listed from. */
  catalogDb: string | null;
}

export function useConsoleSchema(tab: ConsoleTab): ConsoleSchemaState {
  const conn = useConnection(tab.connectionId);
  const session = useTabSession(tab.id);
  const catalogDb = useCatalog(() => catalogDatabase(tab.connectionId, tab.database));
  const catalogDefault = useCatalog((s) => (tab.connectionId ? s.dbs[dbKey(tab.connectionId, catalogDb)]?.defaultSchema ?? null : null));
  const providerId = conn?.providerId;
  const tabSchema = tab.schema ?? null;
  const serverSchema = session?.schema ?? null;
  const searchPath = session?.searchPath ?? null;
  const mode = hasSchemaSwitcher(providerId) ? schemaModeOf(providerId, session) : 'none';
  return useMemo(() => {
    const enabled = hasSchemaSwitcher(providerId);
    const active = enabled ? activeSchema(mode, { schema: serverSchema }, tabSchema) : null;
    return {
      enabled, mode, schema: active ?? (enabled ? catalogDefault : null), serverSchema,
      override: enabled && isEditorOverride(mode, { schema: serverSchema }, tabSchema), searchPath, catalogDb,
    };
  }, [providerId, mode, serverSchema, tabSchema, searchPath, catalogDefault, catalogDb]);
}
