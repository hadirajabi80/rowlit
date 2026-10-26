namespace DbStudio.Federation.Fetchers;

// WP-A fills this: ISourceFetcher for every relational provider id (sqlserver, oracle, postgresql, mysql, mariadb, sqlite,
// clickhouse, snowflake, cassandra). Catalog through IDbProvider.OpenCatalogReaderAsync (LoadSchemaAsync of the member's
// database/schema); fetch over a dedicated connection (Import's ImportConnections.OpenAsync opens one per provider, or
// IDbProvider.OpenSessionAsync for providers it does not cover) with the SQL of Pushdown/PushdownSql, a DbDataReader
// streamed into the IFederationAppender, cap + 1 row, DbCommand.Cancel on cancellation.
internal static class RelationalFetcherPlaceholder;
