using System.Globalization;
using System.Text;
using DbStudio.Core.Models;

namespace DbStudio.Core.Stats;

/// <summary>
/// The statements of a column profile, per dialect. Everything is a plain SELECT (nothing here can change data), reads one
/// table (or view) and, when the table is large, only its first rows: <see cref="StatsRelation.SampleRows"/> wraps the table
/// in a derived table that stops after that many rows, so every statement then costs the same however big the table is.
/// </summary>
internal static class StatsSql
{
    public static bool Supported(Dialect d) => d != Dialect.Cql;

    public static string Q(Dialect d, string name) => DialectInfo.QuoteIdentifier(d, name);

    /// <summary>The first <paramref name="n"/> rows of a table: <c>TOP</c>, <c>ROWNUM</c> (any Oracle version) or <c>LIMIT</c>.</summary>
    public static string LimitedSelect(Dialect d, string list, string table, string? where, int n)
    {
        var w = string.IsNullOrWhiteSpace(where) ? null : where.Trim();
        return d switch
        {
            Dialect.TSql => $"SELECT TOP ({n}) {list} FROM {table}{(w is null ? "" : " WHERE " + w)}",
            Dialect.PlSql => $"SELECT {list} FROM {table} WHERE {(w is null ? "" : "(" + w + ") AND ")}ROWNUM <= {n}",
            _ => $"SELECT {list} FROM {table}{(w is null ? "" : " WHERE " + w)} LIMIT {n}",
        };
    }

    /// <summary>The first <paramref name="n"/> rows of a SELECT that has an ORDER BY (the top values).</summary>
    public static string Limit(Dialect d, string select, int n) => d switch
    {
        Dialect.TSql => "SELECT TOP (" + n + ") " + select["SELECT ".Length..],
        Dialect.PlSql => $"SELECT * FROM (\n{select}\n) WHERE ROWNUM <= {n}",
        _ => $"{select}\nLIMIT {n}",
    };

    /// <summary>The number of rows the (filtered) table has, counted up to <paramref name="cap"/> + 1: tells a big table from a small one.</summary>
    public static string Probe(Dialect d, string table, string? where, int cap) =>
        $"SELECT {Count(d, "*")} FROM ({LimitedSelect(d, "1 AS x", table, where, cap + 1)}) p";

    /// <summary>COUNT with a 64-bit result (SQL Server's COUNT is an int).</summary>
    public static string Count(Dialect d, string arg) => d == Dialect.TSql ? $"COUNT_BIG({arg})" : $"COUNT({arg})";

    /// <summary>Character length of a text value.</summary>
    public static string Length(Dialect d, string q) => d switch
    {
        Dialect.TSql => $"LEN({q})",
        Dialect.PgSql or Dialect.MySql or Dialect.DuckDb => $"CHAR_LENGTH({q})",
        Dialect.ClickHouse => $"lengthUTF8({q})",
        _ => $"LENGTH({q})",
    };

    /// <summary>A date / timestamp as UNIX seconds (a number, so a range can be cut into histogram bars).</summary>
    public static string Epoch(Dialect d, string q) => d switch
    {
        Dialect.TSql => $"CAST(DATEDIFF_BIG(SECOND, '19700101', CAST({q} AS datetime2)) AS float)",
        Dialect.PgSql => $"EXTRACT(EPOCH FROM CAST({q} AS timestamp))",
        Dialect.DuckDb => $"epoch(CAST({q} AS TIMESTAMP))",
        Dialect.MySql => $"TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', {q})",
        Dialect.Sqlite => $"((julianday({q}) - 2440587.5) * 86400.0)",
        Dialect.PlSql => $"((CAST({q} AS DATE) - DATE '1970-01-01') * 86400)",
        Dialect.ClickHouse => $"toUnixTimestamp(toDateTime({q}))",
        Dialect.Snowflake => $"DATE_PART(EPOCH_SECOND, TO_TIMESTAMP_NTZ({q}))",
        _ => q,
    };

    /// <summary>Rounds a non-negative number down to a whole number.</summary>
    public static string Floor(Dialect d, string expr) => d == Dialect.Sqlite ? $"CAST({expr} AS INTEGER)" : $"FLOOR({expr})";

    /// <summary>An invariant number literal (a negative number in parentheses).</summary>
    public static string Number(double v)
    {
        var s = v.ToString("R", CultureInfo.InvariantCulture);
        return v < 0 ? "(" + s + ")" : s;
    }

    // ------------------------------------------------------------------ the summary

    /// <summary>Where each statistic of a column sits in the summary row (-1: not selected).</summary>
    public sealed record SummaryColumn(int NonNull, int Distinct, int Min, int Max, int Avg, int Sum, int MinLen, int MaxLen);

    /// <summary>The summary statement of some columns: row count, and per column the statistics of the chosen level.</summary>
    /// <param name="level">0 = everything, 1 = counts, distinct, min and max, 2 = counts only (the fallback when a statement fails).</param>
    public static (string Sql, SummaryColumn[] Layout) Summary(StatsRelation rel, IReadOnlyList<ColumnPlan> columns, int level)
    {
        var d = rel.Dialect;
        var items = new List<string> { Count(d, "*") + " AS n" };
        var layout = new SummaryColumn[columns.Count];
        for (var i = 0; i < columns.Count; i++)
        {
            var c = columns[i];
            var q = Q(d, c.Name);
            int Add(string expr)
            {
                items.Add(expr + " AS s" + items.Count);
                return items.Count - 1;
            }
            int nonNull = Add(Count(d, q)), distinct = -1, min = -1, max = -1, avg = -1, sum = -1, minLen = -1, maxLen = -1;
            if (level <= 1)
            {
                if (c.Distinct) distinct = Add(Count(d, "DISTINCT " + q));
                if (c.MinMax)
                {
                    min = Add($"MIN({q})");
                    max = Add($"MAX({q})");
                }
            }
            if (level == 0)
            {
                if (c.Numeric)
                {
                    avg = Add($"AVG({(d == Dialect.TSql ? $"CAST({q} AS float)" : q)})");
                    sum = Add($"SUM({(d == Dialect.TSql && c.Integer ? $"CAST({q} AS decimal(38,0))" : q)})");
                }
                if (c.Length)
                {
                    minLen = Add($"MIN({Length(d, q)})");
                    maxLen = Add($"MAX({Length(d, q)})");
                }
            }
            layout[i] = new SummaryColumn(nonNull, distinct, min, max, avg, sum, minLen, maxLen);
        }
        return (rel.Select(string.Join(", ", items), columns.Select(c => Q(d, c.Name)).ToList()), layout);
    }

    /// <summary>The most frequent values of a column (not NULL), with their counts.</summary>
    public static string TopValues(StatsRelation rel, string column, int n)
    {
        var d = rel.Dialect;
        var q = Q(d, column);
        var select = rel.Select($"{q}, {Count(d, "*")} AS cnt", [q], $"{q} IS NOT NULL", $"GROUP BY {q}\nORDER BY {Count(d, "*")} DESC, {q}");
        return Limit(d, select, n);
    }

    /// <summary>The smallest and largest value of a date column as numbers (the range a histogram cuts).</summary>
    public static string TemporalRange(StatsRelation rel, string column)
    {
        var d = rel.Dialect;
        var q = Q(d, column);
        var e = Epoch(d, q);
        return rel.Select($"MIN({e}), MAX({e})", [q], $"{q} IS NOT NULL");
    }

    /// <summary>
    /// The histogram bars: how many values fall in each of <paramref name="buckets"/> equal slices of [min, max]. The row
    /// of bar <paramref name="buckets"/> (the maximum itself) is folded into the last bar by the caller.
    /// </summary>
    public static string Histogram(StatsRelation rel, string column, bool temporal, double min, double max, int buckets)
    {
        var d = rel.Dialect;
        var q = Q(d, column);
        var x = temporal ? Epoch(d, q) : q;
        var bucket = Floor(d, $"((1.0 * ({x} - {Number(min)})) * {buckets} / {Number(max - min)})");
        var inner = rel.Select($"{bucket} AS bkt", [q], $"{q} IS NOT NULL");
        return $"SELECT bkt, {Count(d, "*")} FROM (\n{inner}\n) h GROUP BY bkt ORDER BY bkt";
    }
}

/// <summary>The rows a profile reads: the table with the user's filter, or only its first <see cref="SampleRows"/> rows.</summary>
/// <param name="Table">Quoted, qualified table name.</param>
/// <param name="Where">The user's condition (without WHERE), or null.</param>
internal sealed record StatsRelation(Dialect Dialect, string Table, string? Where, int? SampleRows)
{
    /// <summary><c>SELECT list FROM rel [WHERE extra] [tail]</c>; <paramref name="columns"/> are the (quoted) columns the statement reads.</summary>
    public string Select(string list, IReadOnlyList<string> columns, string? extraWhere = null, string? tail = null)
    {
        var sb = new StringBuilder("SELECT ").Append(list).Append("\nFROM ");
        string? where = extraWhere;
        if (SampleRows is { } n)
        {
            var cols = columns.Count == 0 ? "1 AS x" : string.Join(", ", columns);
            sb.Append('(').Append(StatsSql.LimitedSelect(Dialect, cols, Table, Where, n)).Append(") s");
        }
        else
        {
            sb.Append(Table);
            var user = string.IsNullOrWhiteSpace(Where) ? null : Where.Trim();
            where = user is null ? extraWhere : extraWhere is null ? user : $"({user}) AND {extraWhere}";
        }
        if (where is not null) sb.Append("\nWHERE ").Append(where);
        if (tail is not null) sb.Append('\n').Append(tail);
        return sb.ToString();
    }
}

/// <summary>What can be asked of one column, from its type.</summary>
/// <param name="Kind">numeric | temporal | time | text | bool | guid | other.</param>
internal sealed record ColumnPlan(string Name, string Type, string Kind, bool Distinct, bool MinMax, bool Numeric, bool Integer, bool Temporal, bool Length, bool Top)
{
    /// <summary>Plans a column from its declared type (<see cref="Transfer.TypeMapper"/> reads the type of any dialect).</summary>
    public static ColumnPlan For(Dialect d, string name, string typeText)
    {
        var type = string.IsNullOrWhiteSpace(typeText) ? "text" : typeText;
        var canon = Transfer.TypeMapper.Parse(d, type);
        var b = Transfer.TypeMapper.Split(type).Base.ToLowerInvariant();
        // Types the server cannot group, compare or take the DISTINCT of.
        var lob = (d == Dialect.TSql && b is "text" or "ntext" or "image" or "xml" or "sql_variant" or "hierarchyid" or "geography" or "geometry")
                  || (d == Dialect.PlSql && b is "clob" or "nclob" or "blob" or "long" or "bfile" or "xmltype" or "long raw");
        if (lob) return new ColumnPlan(name, type, "other", false, false, false, false, false, false, false);
        return canon.Kind switch
        {
            Transfer.TypeKind.Int => new ColumnPlan(name, type, "numeric", true, true, true, true, false, false, true),
            Transfer.TypeKind.Float or Transfer.TypeKind.Decimal => new ColumnPlan(name, type, "numeric", true, true, true, false, false, false, true),
            Transfer.TypeKind.Boolean => new ColumnPlan(name, type, "bool", true, false, false, false, false, false, true),
            Transfer.TypeKind.Char or Transfer.TypeKind.VarChar or Transfer.TypeKind.Text or Transfer.TypeKind.Enum =>
                new ColumnPlan(name, type, "text", true, true, false, false, false, true, true),
            Transfer.TypeKind.Date or Transfer.TypeKind.DateTime or Transfer.TypeKind.DateTimeTz =>
                new ColumnPlan(name, type, "temporal", true, true, false, false, true, false, true),
            Transfer.TypeKind.Time => new ColumnPlan(name, type, "time", true, true, false, false, false, false, true),
            Transfer.TypeKind.Guid => new ColumnPlan(name, type, "guid", true, false, false, false, false, false, true),
            _ => new ColumnPlan(name, type, "other", false, false, false, false, false, false, false),
        };
    }
}
