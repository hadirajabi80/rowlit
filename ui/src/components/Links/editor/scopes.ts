// Member scopes (pure): which scopes a provider offers, where a "whole database" member keeps its database name, the
// place a scope stores and how its tables are named in SQL. The engine decides what a level really spans
// (Runtime/MemberScopes.cs, the catalog's `levels`); these rules only shape the editor and the explorer commands.
import type { LinkMemberKind, LinkScope } from '../../../api/links';

/** Providers with databases above their schemas (the console switches databases, a database holds schemas). */
const DATABASE_LEVEL = new Set(['sqlserver', 'postgresql', 'snowflake']);
/** Providers whose one level is a database (MySQL database, ClickHouse database, Cassandra keyspace, MongoDB database): stored in `schema`. */
const DATABASE_IS_SCHEMA = new Set(['mysql', 'mariadb', 'clickhouse', 'cassandra', 'mongodb']);
/** Non-relational providers a link can mount (the engine has fetchers for them), with the scopes the editor can offer. */
const SOURCE_SCOPES: Record<string, LinkScope[]> = { mongodb: ['database', 'connection'], elasticsearch: ['connection'] };

export const SCOPE_LABELS: Record<LinkScope, string> = {
  tables: 'Tables', schema: 'Whole schema', database: 'Whole database', connection: 'Whole connection',
};

/** Spans more than a list of tables (no table list to pick). */
export const mountsAll = (scope: LinkScope) => scope !== 'tables';

/**
 * Where a database-scope member names its database: `database` (SQL Server, PostgreSQL, Snowflake), `schema` (providers
 * whose single level is the database: MySQL, MariaDB, ClickHouse, Cassandra, MongoDB; the member's schema is that
 * database, so their whole database is the same as a whole schema) or nowhere (Oracle, SQLite: the connection is the
 * database, its schemas / attached files are spanned; Elasticsearch: no levels).
 */
export function databaseScopeField(providerId: string | null | undefined): 'database' | 'schema' | null {
  if (!providerId) return null;
  if (DATABASE_LEVEL.has(providerId)) return 'database';
  if (DATABASE_IS_SCHEMA.has(providerId)) return 'schema';
  return null;
}

/** The scopes a member of this provider can have (files members: tables only; unknown providers: all). */
export function scopesFor(providerId: string | null | undefined, kind: LinkMemberKind = 'connection'): LinkScope[] {
  if (kind === 'files') return ['tables'];
  return (providerId && SOURCE_SCOPES[providerId]) || ['tables', 'schema', 'database', 'connection'];
}

/** The scope a new member of this provider starts with. */
export function defaultScopeFor(providerId: string | null | undefined): LinkScope {
  return scopesFor(providerId)[0];
}

/** A provider whose members mount without the explorer's table catalog (the editor shows no schema / table pickers). */
export const isSourceProvider = (providerId: string | null | undefined): boolean => !!providerId && providerId in SOURCE_SCOPES;

/** The database / schema a member of this scope stores (the scope ignores the rest: stored null). */
export function placeOf(scope: LinkScope, providerId: string | null | undefined, database: string | null, schema: string | null): { database: string | null; schema: string | null } {
  if (scope === 'connection') return { database: null, schema: null };
  if (scope === 'database') {
    const f = databaseScopeField(providerId);
    return f === 'database' ? { database, schema: null } : f === 'schema' ? { database: null, schema } : { database: null, schema: null };
  }
  return { database, schema };
}

/** How SQL names the tables of a member of this scope (`crm` = the alias). */
export function scopeNaming(scope: LinkScope, providerId: string | null | undefined, alias: string): string {
  const a = alias || 'alias';
  if (providerId === 'elasticsearch') return `Query every index as ${a}.index.`;
  const dbLevel = !!providerId && DATABASE_LEVEL.has(providerId);
  const oneLevel = !!providerId && DATABASE_IS_SCHEMA.has(providerId);
  if (scope === 'database') {
    if (oneLevel) return `Query as ${a}.table: this database has no schemas inside, so it mounts the same as a whole schema.`;
    return `Query as ${a}.schema.table; ${a}.table for the default schema.`;
  }
  if (scope === 'connection') {
    if (dbLevel) return `Query as ${a}.database.schema.table; ${a}.schema.table for the default database, ${a}.table for its default schema.`;
    if (oneLevel) return `Query as ${a}.database.table; ${a}.table for the default database.`;
    return `Query as ${a}.schema.table; ${a}.table for the default schema.`;
  }
  return `Query as ${a}.table.`;
}

/** True when `outer` mounts everything `inner` does (same connection assumed; null place = the default / any). */
export function scopeCovers(
  outer: { scope: LinkScope; database: string | null; schema: string | null },
  inner: { scope: LinkScope; database: string | null; schema: string | null },
  providerId: string | null | undefined,
): boolean {
  const rank: Record<LinkScope, number> = { tables: 0, schema: 1, database: 2, connection: 3 };
  if (outer.scope === 'connection') return true;
  if (rank[outer.scope] < rank[inner.scope] || outer.scope === 'tables') return false;
  const f = databaseScopeField(providerId);
  const eq = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
  if (outer.scope === 'database') {
    if (f === 'database') return eq(outer.database, inner.database);
    if (f === 'schema') return eq(outer.schema, inner.schema);
    return true; // Oracle / SQLite: the connection's one database
  }
  // schema: the same schema of the same database
  return eq(outer.database, inner.database) && eq(outer.schema, inner.schema);
}
