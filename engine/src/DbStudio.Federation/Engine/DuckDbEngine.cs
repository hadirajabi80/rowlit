namespace DbStudio.Federation.Engine;

// WP-A fills this (plan-links 2): IFederationEngine over DuckDB.NET (in-memory, Diagnostics/DuckDbProbe.LockdownStatements
// first: no extension install/load, no external access), memory_limit / threads / temp_directory from FederationLimits,
// Appender API per table (each IFederationAppender on its own DuckDBConnection, converting values per FederatedColumn.Kind),
// Interrupt() = DuckDBConnection interrupt, SerializeSqlAsync = DuckDbProbe.SerializeSql. Plus the IFederationEngineFactory
// (DuckDbEngineFactory) that falls back to SqliteFederationEngine when libduckdb does not load.
internal static class DuckDbEnginePlaceholder;
