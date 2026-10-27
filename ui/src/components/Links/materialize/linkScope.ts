// "Link database…" / "Link schema…" (explorer database and schema nodes, MongoDB databases): pure rules that turn the node
// into a wide link member, tell whether a link already spans it, and add it. The dialog and the commands call them.
import {
  LINK_PROVIDER_ID, linkDefinitionOf, memberScopeOf, slugifyAlias, uniqueAlias, type LinkDefinition, type LinkMember, type LinkScope,
} from '../../../api/links';
import { targetOf } from '../../../commands/core';
import { isContainerTarget, isSourceTarget } from '../../../commands/types';
import { getConnection, providerKind } from '../../../store/connections';
import { databaseScopeField, scopeCovers, scopeNaming } from '../editor/scopes';

/** The node being linked. */
export interface ScopeSource {
  connectionId: string;
  providerId: string;
  /** 'database': a whole database (SQL Server / PostgreSQL / Snowflake database, MySQL-like database, MongoDB database); 'schema': one schema. */
  scope: Extract<LinkScope, 'database' | 'schema'>;
  database: string | null;
  schema: string | null;
  /** The node's name (database or schema). */
  name: string;
}

const GENERIC = new Set(['dbo', 'public', 'main']);

/**
 * The node `links.linkDatabase` / `links.linkSchema` act on: an explorer database or schema row of a relational
 * connection that is not a link (folders and Queries folders do not count), or a MongoDB database. `want` picks the
 * command: a database node (or the database-like schema of MySQL, MariaDB, ClickHouse, Cassandra) for 'database', a
 * plain schema for 'schema'.
 */
export function scopeSourceOf(args: unknown, want: ScopeSource['scope']): ScopeSource | null {
  const t = targetOf(args);
  if (isSourceTarget(t)) {
    if (want !== 'database' || t.providerId !== 'mongodb' || t.nodeType !== 'database' || !t.path[0]) return null;
    if (!getConnection(t.connectionId)) return null;
    return { connectionId: t.connectionId, providerId: 'mongodb', scope: 'database', database: null, schema: t.path[0], name: t.path[0] };
  }
  if (!isContainerTarget(t) || t.objectType || t.queries || t.typeKind) return null;
  const conn = getConnection(t.connectionId);
  if (!conn || conn.providerId === LINK_PROVIDER_ID || providerKind(conn.providerId) !== 'relational') return null;
  const field = databaseScopeField(conn.providerId);
  if (!t.schema) {
    // a database node: a whole database where the provider has databases above schemas
    if (want !== 'database' || !t.database || field !== 'database') return null;
    return { connectionId: conn.id, providerId: conn.providerId, scope: 'database', database: t.database, schema: null, name: t.database };
  }
  if (field === 'schema') {
    // MySQL & co.: the schema node is a database
    if (want !== 'database') return null;
    return { connectionId: conn.id, providerId: conn.providerId, scope: 'database', database: null, schema: t.schema, name: t.schema };
  }
  if (want !== 'schema') return null;
  return { connectionId: conn.id, providerId: conn.providerId, scope: 'schema', database: t.database ?? null, schema: t.schema, name: t.schema };
}

/** "shop" of Postgres Shop → shop; a generic schema (dbo, public, main) → the connection's name. */
export function scopeAliasProposal(source: ScopeSource, connectionName: string): string {
  return slugifyAlias(GENERIC.has(source.name.toLowerCase()) ? connectionName : source.name);
}

/** The member a node becomes (alias unique among `taken`). */
export function scopeMember(source: ScopeSource, connectionName: string, taken: readonly string[] = []): LinkMember {
  return {
    alias: uniqueAlias(scopeAliasProposal(source, connectionName), taken), kind: 'connection', connectionId: source.connectionId,
    database: source.database, schema: source.schema, scope: source.scope, allTables: true, tables: [],
  };
}

/** The link's member that already mounts all of the node (same connection, the same or a wider scope), if any. */
export function coveringMember(def: LinkDefinition, source: ScopeSource): LinkMember | null {
  const inner = { scope: source.scope as LinkScope, database: source.database, schema: source.schema };
  return def.members.find((m) => (m.kind ?? 'connection') === 'connection' && m.connectionId === source.connectionId
    && scopeCovers({ scope: memberScopeOf(m), database: m.database ?? null, schema: m.schema ?? null }, inner, source.providerId)) ?? null;
}

export interface ScopeAddResult {
  definition: LinkDefinition;
  member: LinkMember;
  /** The link already spans the node: the definition is unchanged and `member` is the one that does. */
  already: boolean;
}

export function addScopeToDefinition(def: LinkDefinition, source: ScopeSource, connectionName: string): ScopeAddResult {
  const have = coveringMember(def, source);
  if (have) return { definition: def, member: have, already: true };
  const member = scopeMember(source, connectionName, def.members.map((m) => m.alias));
  return { definition: { ...def, members: [...def.members, member] }, member, already: false };
}

/** How to query the member's tables ("Query as crm.schema.table; crm.table for the default schema."). */
export function howToQuery(member: LinkMember, providerId: string | null | undefined): string {
  return scopeNaming(memberScopeOf(member), providerId, member.alias);
}

export { linkDefinitionOf };
