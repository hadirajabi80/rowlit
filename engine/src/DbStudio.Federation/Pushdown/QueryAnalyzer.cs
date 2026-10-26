namespace DbStudio.Federation.Pushdown;

// WP-A fills this (plan-links 1, "Push-down"): DuckDB AST (json_serialize_sql) → base tables (alias.table, CTE names
// excluded), referenced columns per table (projection), conjunctive single-table predicates (column OP literal; = <> < >
// <= >= IN BETWEEN LIKE IS NOT NULL; never IS NULL / OR with null-accepting terms / functions / parameters), pushed only
// for INNER-joined tables and the preserved side of outer joins (plus null-rejecting predicates on the null-supplying side),
// LIMIT only for single-table queries without joins/aggregates/DISTINCT/ORDER BY whose predicates all push. Output: one
// FetchRequest per table (then ISourceFetcher.Accept). Parse failure → text fallback: projection = identifiers in the SQL,
// no predicates, PlanWarningCodes.Fallback.
internal static class QueryAnalyzerPlaceholder;
