// Batch 3 (plan-batch3 1.2): how a provider's catalog levels map onto the console switcher. Pure (no store imports) so
// models and tests can use it; store/connections re-exports it.
import type { ProviderId } from '../api/types';

/**
 * Batch 3: single-level providers whose "schema" is what the console switches (Oracle schema, MySQL/MariaDB/ClickHouse
 * database, Cassandra keyspace): the catalog has no database level and the switcher lists schemas.
 */
export function schemaIsDatabase(providerId: ProviderId | string | null | undefined): boolean {
  return providerId === 'oracle' || providerId === 'mysql' || providerId === 'mariadb' || providerId === 'clickhouse'
    || providerId === 'cassandra';
}

/** Batch 3 (D3): engines without multi-statement transactions; their consoles have no Auto/Tx toggle or Commit/Rollback. */
export function hasTransactions(providerId: ProviderId | string | null | undefined): boolean {
  // plan-links: a linked database is read-only and query-only (no transactions either)
  return providerId !== 'cassandra' && providerId !== 'clickhouse' && providerId !== 'linked';
}

/**
 * Batch 3: engines with no EXPLAIN plan (Cassandra traces instead); their consoles have no Explain button. plan-links: a
 * linked database has its own push-down plan view (links.plan) instead of EXPLAIN.
 */
export function hasExplain(providerId: ProviderId | string | null | undefined): boolean {
  return providerId !== 'cassandra' && providerId !== 'linked';
}

/** Batch 3: what the console switcher calls the level it switches (Oracle schema, Cassandra keyspace, else database). */
export function schemaLevelLabel(providerId: ProviderId | string | null | undefined): 'schema' | 'keyspace' | 'database' {
  // plan-links: a link's schemas are its member aliases
  return providerId === 'oracle' || providerId === 'linked' ? 'schema' : providerId === 'cassandra' ? 'keyspace' : 'database';
}
