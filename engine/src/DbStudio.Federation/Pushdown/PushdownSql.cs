using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Pushdown;

/// <summary>Where a mounted table lives on its source: the parts of its qualified name.</summary>
/// <param name="Database">Database part (only rendered where the connection does not already target it: never, today).</param>
/// <param name="Schema">Schema / MySQL-ClickHouse database / Oracle owner / Cassandra keyspace; null = unqualified.</param>
public sealed record SourceObjectName(string? Database, string? Schema, string Name);

/// <summary>
/// Renders a <see cref="FetchRequest"/> as the source's SQL (plan-links 1): <c>SELECT &lt;projection&gt; FROM &lt;qualified&gt;
/// [WHERE &lt;predicates&gt;]</c> plus a row limit — the pushed LIMIT, or the row cap + 1 so a source never streams more
/// than the fetcher reads — as <c>TOP (n)</c> (T-SQL), <c>FETCH FIRST n ROWS ONLY</c> (Oracle 12c+) or <c>LIMIT n</c>.
/// Identifiers use <see cref="DialectInfo.QuoteIdentifier"/>; literals per dialect (T-SQL <c>N'…'</c> and 1/0 booleans,
/// Oracle <c>DATE '…'</c>/<c>TIMESTAMP '…'</c>, ClickHouse <c>toDate</c>, MySQL/ClickHouse/Snowflake backslash escapes,
/// CQL unquoted uuids). <see cref="Accept"/> drops what a dialect cannot evaluate exactly like DuckDB (see its rules).
/// </summary>
public static class PushdownSql
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    /// <summary>Partition key columns of a Cassandra table, stored by the fetcher in <see cref="SourceTable.Options"/>.</summary>
    public const string PartitionKeyOption = "_partitionKey";

    /// <summary>
    /// The request a source of <paramref name="dialect"/> can evaluate: predicates it cannot render exactly (or as a
    /// superset) are removed; when any is removed the limit goes too.
    /// <list type="bullet">
    /// <item>SQLite: no date/time/guid/bool predicates (values are text or numbers of any shape: text comparison is not date comparison).</item>
    /// <item>ClickHouse: no datetime predicates (DateTime columns compare in the column's time zone).</item>
    /// <item>Cassandra: only <c>=</c> on every partition key column (never ALLOW FILTERING); otherwise none (the plan warns fullScan).</item>
    /// <item>Everyone: LIKE patterns without a backslash only; T-SQL escapes <c>[</c>.</item>
    /// </list>
    /// </summary>
    public static FetchRequest Accept(Dialect dialect, FetchRequest proposed)
    {
        ArgumentNullException.ThrowIfNull(proposed);
        IReadOnlyList<PushdownPredicate> kept;
        if (dialect == Dialect.Cql)
        {
            var partition = PartitionKey(proposed.Table);
            var eq = proposed.Predicates.Where(p => p.Op == PushdownOps.Eq && partition.Contains(p.Column, StringComparer.OrdinalIgnoreCase)).ToList();
            var covered = partition.Count > 0 && partition.All(k => eq.Any(p => string.Equals(p.Column, k, StringComparison.OrdinalIgnoreCase)));
            kept = covered
                ? partition.Select(k => eq.First(p => string.Equals(p.Column, k, StringComparison.OrdinalIgnoreCase))).ToList()
                : [];
        }
        else
        {
            kept = proposed.Predicates.Where(p => CanRender(dialect, proposed.Table, p)).ToList();
        }
        var dropped = kept.Count != proposed.Predicates.Count;
        return proposed with { Predicates = kept, Limit = dropped ? null : proposed.Limit };
    }

    private static bool CanRender(Dialect dialect, SourceTable table, PushdownPredicate p)
    {
        if (!PushdownOps.All.Contains(p.Op)) return false;
        if (p.Op == PushdownOps.Like && p.Values.Any(v => v.Value.Contains('\\', StringComparison.Ordinal))) return false;
        var kind = table.Columns.FirstOrDefault(c => string.Equals(c.Name, p.Column, StringComparison.OrdinalIgnoreCase))?.Kind;
        if (kind is null) return false;
        if (p.Op == PushdownOps.IsNotNull) return true;
        return dialect switch
        {
            Dialect.Sqlite => kind is ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.Float or ColumnKinds.String,
            Dialect.ClickHouse => kind is not (ColumnKinds.DateTime or ColumnKinds.DateTimeOffset or ColumnKinds.Time),
            _ => kind is not (ColumnKinds.DateTimeOffset or ColumnKinds.Time),
        };
    }

    /// <summary>The Cassandra partition key of a table (see <see cref="PartitionKeyOption"/>).</summary>
    public static IReadOnlyList<string> PartitionKey(SourceTable table) =>
        table.Options?[PartitionKeyOption] is JsonArray arr ? arr.Select(x => x?.GetValue<string>() ?? "").Where(s => s.Length > 0).ToList() : [];

    /// <summary>The source SQL of an accepted request.</summary>
    /// <param name="capRows">Also limit the rows to <see cref="FetchRequest.MaxRows"/> + 1 when no LIMIT is pushed.</param>
    public static string Render(Dialect dialect, SourceObjectName name, FetchRequest request, bool capRows = true)
    {
        var limit = request.Limit is { } l ? Math.Min(l, request.MaxRows == long.MaxValue ? long.MaxValue : request.MaxRows + 1)
            : capRows && request.MaxRows < long.MaxValue - 1 ? request.MaxRows + 1 : (long?)null;
        var sb = new StringBuilder("SELECT ");
        if (dialect == Dialect.TSql && limit is not null) sb.Append("TOP (").Append(limit.Value.ToString(Inv)).Append(") ");
        sb.Append(string.Join(", ", request.Columns.Select(c => Quote(dialect, c))));
        sb.Append(" FROM ").Append(Qualified(dialect, name));
        if (request.Predicates.Count > 0)
        {
            sb.Append(" WHERE ");
            sb.Append(string.Join(" AND ", request.Predicates.Select(p => Predicate(dialect, request.Table, p))));
        }
        if (limit is not null)
        {
            switch (dialect)
            {
                case Dialect.TSql:
                    break;
                case Dialect.PlSql:
                    sb.Append(" FETCH FIRST ").Append(limit.Value.ToString(Inv)).Append(" ROWS ONLY");
                    break;
                default:
                    sb.Append(" LIMIT ").Append(limit.Value.ToString(Inv));
                    break;
            }
        }
        return sb.ToString();
    }

    public static string Quote(Dialect dialect, string identifier) => DialectInfo.QuoteIdentifier(dialect, identifier);

    public static string Qualified(Dialect dialect, SourceObjectName name)
    {
        var parts = new List<string>(3);
        if (!string.IsNullOrEmpty(name.Database)) parts.Add(Quote(dialect, name.Database));
        if (!string.IsNullOrEmpty(name.Schema)) parts.Add(Quote(dialect, name.Schema));
        parts.Add(Quote(dialect, name.Name));
        return string.Join(".", parts);
    }

    public static string Predicate(Dialect dialect, SourceTable table, PushdownPredicate p)
    {
        var col = Quote(dialect, p.Column);
        var kind = table.Columns.FirstOrDefault(c => string.Equals(c.Name, p.Column, StringComparison.OrdinalIgnoreCase))?.Kind ?? ColumnKinds.String;
        return p.Op switch
        {
            PushdownOps.IsNotNull => $"{col} IS NOT NULL",
            PushdownOps.In => $"{col} IN ({string.Join(", ", p.Values.Select(v => Literal(dialect, kind, v)))})",
            PushdownOps.Between => $"{col} BETWEEN {Literal(dialect, kind, p.Values[0])} AND {Literal(dialect, kind, p.Values[1])}",
            PushdownOps.Like => $"{col} LIKE {LikePattern(dialect, p.Values[0].Value)}",
            _ => $"{col} {p.Op} {Literal(dialect, kind, p.Values[0])}",
        };
    }

    private static string LikePattern(Dialect dialect, string pattern) =>
        // T-SQL: [ opens a character class; [[] is a literal [.
        StringLiteral(dialect, dialect == Dialect.TSql ? pattern.Replace("[", "[[]", StringComparison.Ordinal) : pattern);

    /// <summary>A literal for a column of <paramref name="columnKind"/> (the literal's own kind decides the spelling).</summary>
    public static string Literal(Dialect dialect, string columnKind, PushdownLiteral lit)
    {
        switch (lit.Kind)
        {
            case ColumnKinds.Int or ColumnKinds.Decimal:
                return lit.Value;
            case ColumnKinds.Float:
                return double.TryParse(lit.Value, NumberStyles.Float, Inv, out var d) ? FloatText(d) : lit.Value;
            case ColumnKinds.Bool:
            {
                var b = lit.Value == "true";
                return dialect is Dialect.TSql or Dialect.PlSql or Dialect.Sqlite ? (b ? "1" : "0") : (b ? "TRUE" : "FALSE");
            }
            case ColumnKinds.Date:
                return dialect switch
                {
                    Dialect.TSql => $"CAST('{lit.Value}' AS date)",
                    Dialect.ClickHouse => $"toDate('{lit.Value}')",
                    Dialect.Sqlite or Dialect.Cql => $"'{lit.Value}'",
                    Dialect.Snowflake => $"'{lit.Value}'::DATE",
                    _ => $"DATE '{lit.Value}'",
                };
            case ColumnKinds.DateTime:
            {
                var ts = lit.Value.Replace('T', ' ');
                return dialect switch
                {
                    Dialect.TSql => $"CAST('{lit.Value}' AS datetime2)",
                    Dialect.PlSql or Dialect.PgSql => $"TIMESTAMP '{ts}'",
                    Dialect.MySql => $"'{ts}'",
                    Dialect.Snowflake => $"'{ts}'::TIMESTAMP_NTZ",
                    Dialect.ClickHouse => $"toDateTime64('{ts}', 6)",
                    _ => $"'{ts}'",
                };
            }
            case ColumnKinds.Guid:
                return dialect switch
                {
                    Dialect.Cql => lit.Value,
                    Dialect.PgSql => $"'{lit.Value}'::uuid",
                    Dialect.ClickHouse => $"toUUID('{lit.Value}')",
                    _ => $"'{lit.Value}'",
                };
            default:
                return StringLiteral(dialect, lit.Value);
        }
    }

    private static string FloatText(double d)
    {
        var s = d.ToString("R", Inv);
        // "1E+20" is a float literal everywhere; plain digits without a point stay integers, which compare the same.
        return s;
    }

    /// <summary>A string literal: quotes doubled; backslashes doubled where they escape (MySQL, ClickHouse, Snowflake); T-SQL N'…'.</summary>
    public static string StringLiteral(Dialect dialect, string value)
    {
        var v = value.Replace("'", "''", StringComparison.Ordinal);
        if (dialect is Dialect.MySql or Dialect.ClickHouse or Dialect.Snowflake) v = v.Replace("\\", "\\\\", StringComparison.Ordinal);
        return dialect == Dialect.TSql ? $"N'{v}'" : $"'{v}'";
    }
}
