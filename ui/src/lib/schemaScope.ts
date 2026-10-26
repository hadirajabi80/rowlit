// The default schema of a console ("where unqualified names resolve"): which providers get a schema control next to the
// database switcher, what that control can do, and how the schema feeds IntelliSense. Pure (no store imports).
import type { CatalogSnapshot, SchemaMode, SessionInfo } from '../api/types';

/**
 * Providers with a database level above schemas (SQL Server, PostgreSQL, Snowflake) get a schema control of their own.
 * Single-level providers (Oracle schema, MySQL/MariaDB/ClickHouse database, Cassandra keyspace, SQLite main) do not:
 * their database switcher already is the schema (see providerLevels.schemaLevelLabel).
 */
export function hasSchemaSwitcher(providerId: string | null | undefined): boolean {
  return providerId === 'sqlserver' || providerId === 'postgresql' || providerId === 'snowflake';
}

/** What the console can do with the schema before the engine says (no session yet): SQL Server read-only, the others settable. */
export function schemaModeOf(providerId: string | null | undefined, session?: Pick<SessionInfo, 'schemaMode'> | null): SchemaMode {
  if (session?.schemaMode && session.schemaMode !== 'none') return session.schemaMode;
  if (providerId === 'sqlserver') return 'readOnly';
  if (providerId === 'postgresql' || providerId === 'snowflake') return 'session';
  return 'none';
}

/**
 * The schema unqualified names resolve to in this console. With a session-level schema (PostgreSQL, Snowflake) the
 * session's own value wins once it is known (it follows `SET search_path` / `USE SCHEMA` typed in the editor); before the
 * first run the tab's remembered choice stands in. SQL Server cannot change it per session: the tab's "Editor schema"
 * (completion and diagnostics only) wins over the login's default schema.
 */
export function activeSchema(mode: SchemaMode, session: Pick<SessionInfo, 'schema'> | null | undefined, tabSchema: string | null | undefined): string | null {
  if (mode === 'readOnly') return tabSchema ?? session?.schema ?? null;
  return session?.schema ?? tabSchema ?? null;
}

/** True when `schema` differs from the server's own default, i.e. the editor/tab overrides it (SQL Server "Editor schema"). */
export function isEditorOverride(mode: SchemaMode, session: Pick<SessionInfo, 'schema'> | null | undefined, tabSchema: string | null | undefined): boolean {
  return mode === 'readOnly' && !!tabSchema && tabSchema !== (session?.schema ?? null);
}

/**
 * The catalog snapshot an editor completes against, with `schema` as its default schema (so `SELECT * FROM ` offers its
 * tables unqualified, diagnostics resolve bare names there). PostgreSQL also puts it first on the search_path. Returns the
 * same object when nothing changes, so the editor's index is not rebuilt for nothing.
 */
export function snapshotWithSchema(
  snapshot: CatalogSnapshot | null, schema: string | null | undefined, searchPath?: readonly string[] | null,
): CatalogSnapshot | null {
  if (!snapshot || !schema) return snapshot;
  const known = snapshot.schemaNames ?? snapshot.schemas.map((s) => s.name);
  const hit = known.find((n) => n === schema) ?? known.find((n) => n.toLowerCase() === schema.toLowerCase());
  // A schema the database does not have (stale choice after a database switch): keep the catalog's own default.
  if (!hit) return snapshot;
  let path: string[] | undefined;
  if (snapshot.dialect === 'pgsql') {
    const rest = (searchPath?.length ? searchPath : snapshot.searchPath ?? []).filter((n) => n.toLowerCase() !== hit.toLowerCase());
    path = [hit, ...rest];
  }
  const samePath = !path || (snapshot.searchPath?.length === path.length && snapshot.searchPath.every((n, i) => n === path![i]));
  if (hit === snapshot.defaultSchema && samePath) return snapshot;
  return { ...snapshot, defaultSchema: hit, ...(path ? { searchPath: path } : {}) };
}
