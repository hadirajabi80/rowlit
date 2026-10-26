namespace DbStudio.Federation.Engine;

// WP-A fills this (plan-links 1): the fallback IFederationEngine over an in-memory SQLite (Microsoft.Data.Sqlite) when
// libduckdb cannot load: schemas as ATTACHed in-memory databases named by alias, typed columns by affinity, the builder
// subset of SQL only (Features without FullSql / SerializeSql / Spill); the session warns PlanWarningCodes.FallbackEngine.
internal static class SqliteFederationEnginePlaceholder;
