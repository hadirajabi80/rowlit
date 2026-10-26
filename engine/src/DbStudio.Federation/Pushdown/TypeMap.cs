namespace DbStudio.Federation.Pushdown;

// WP-A fills this (plan-links 1, "Type map"): SourceColumn (Kind from ValueConverter.KindFor) → FederatedColumn.EngineType:
// int → BIGINT (UInt64 / Int128 → HUGEINT), float → DOUBLE, decimal → DECIMAL(38,s) (precision > 38 → VARCHAR + warning
// decimalWidened), string → VARCHAR, bool → BOOLEAN, date → DATE, time → TIME, datetime → TIMESTAMP, datetimeoffset →
// TIMESTAMPTZ (UTC), guid → UUID (lower case), binary → BLOB, json → JSON, xml / other → VARCHAR. And back: DuckDB result
// column types → ColumnInfo.Kind for the console (results through ValueConverter.ToWire).
internal static class TypeMapPlaceholder;
