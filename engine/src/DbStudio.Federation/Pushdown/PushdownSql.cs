namespace DbStudio.Federation.Pushdown;

// WP-A fills this (plan-links 1): renders a FetchRequest as source SQL per Dialect: SELECT <projection> FROM <qualified>
// [WHERE <predicates>] with DialectInfo.QuoteIdentifier; row limit TOP n (T-SQL), FETCH FIRST n ROWS ONLY (Oracle 12c+,
// ROWNUM before), LIMIT elsewhere; PushdownLiteral rendering per dialect (ISO dates, DATE '…' / TO_TIMESTAMP on Oracle,
// booleans 1/0 on T-SQL/Oracle, N'…' on T-SQL, CQL: partition-key equality only, never ALLOW FILTERING).
// Snapshot-tested for all eight source dialects (tests/DbStudio.Federation.Tests/WpA/).
internal static class PushdownSqlPlaceholder;
