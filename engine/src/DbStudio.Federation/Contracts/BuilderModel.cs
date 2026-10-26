using System.Text.Json.Nodes;

namespace DbStudio.Federation.Contracts;

// FROZEN (plan-links WP0): the query builder's model, compiled to DuckDB SQL by the UI (WP-C, builder/compile.ts, for
// the live preview) and by the engine (WP-B, POST /links/{cid}/compile) with the SAME output, checked by the shared
// goldens in engine/tests/DbStudio.Federation.Tests/Goldens/Builder/ (see docs/wp-notes/links/wp0.md, "Builder SQL").
// Wire mirror: ui/src/api/links.ts. It is also what a linked view stores next to its SQL.
//
// Canonical SQL (both compilers):
//   SELECT [DISTINCT ]<item>, <item>                 item = <expr>[ AS <alias>]; no output column → SELECT *
//   FROM <alias>.<table> AS <as>                      Tables[0]
//   <TYPE> JOIN <alias>.<table> AS <as> ON <c> AND <c> one line per join, in Joins order (CROSS JOIN has no ON)
//   CROSS JOIN <alias>.<table> AS <as>                tables no join reaches (warning "cartesian")
//   WHERE <predicate>                                 Filter through ui/src/filter/sql.ts rules for dialect duckdb
//   GROUP BY <expr>, <expr>
//   HAVING <predicate>
//   ORDER BY <expr> ASC|DESC[ NULLS FIRST|LAST], …
//   LIMIT <n>[ OFFSET <m>]
// Clauses on their own line (\n), no trailing semicolon, keywords upper case; identifiers through LinkSql.QuoteIdent
// (ui: quoteIdent(name, 'duckdb')); column refs <as>.<column>; filter values are bind parameters $fp1, $fp2, … (prefix
// "fp", the filter/sql.ts ParamBuilder for duckdb) returned next to the SQL, never inlined.

/// <summary>The query builder's state: tables on the canvas, joins, output columns, filters, grouping, sort and limit.</summary>
public sealed record BuilderModel
{
    public const int CurrentVersion = 1;

    public int Version { get; init; } = CurrentVersion;

    /// <summary>Tables on the canvas; the first is the FROM table.</summary>
    public IReadOnlyList<BuilderTable> Tables { get; init; } = [];

    /// <summary>
    /// Joins in SQL order. Each join attaches <see cref="BuilderJoin.Right"/> (a table no earlier join attached, and not
    /// Tables[0]) to <see cref="BuilderJoin.Left"/> (Tables[0] or a table an earlier join attached).
    /// </summary>
    public IReadOnlyList<BuilderJoin> Joins { get; init; } = [];

    /// <summary>Output (and helper) columns in SELECT order.</summary>
    public IReadOnlyList<BuilderColumn> Columns { get; init; } = [];

    /// <summary>WHERE: a filter group (ui/src/filter/model.ts); condition columns are <see cref="BuilderRefs.ColumnKey"/> ("t1.name").</summary>
    public BuilderFilterNode? Filter { get; init; }

    /// <summary>Explicit GROUP BY (used when <see cref="AutoGroup"/> is false).</summary>
    public IReadOnlyList<BuilderRef> GroupBy { get; init; } = [];

    /// <summary>
    /// True (default): when an output column has an aggregate, GROUP BY every output column without one (in column
    /// order); no aggregate → no GROUP BY. False: <see cref="GroupBy"/> as given.
    /// </summary>
    public bool AutoGroup { get; init; } = true;

    /// <summary>HAVING: a filter group whose condition columns are <see cref="BuilderColumn.Id"/>s of output columns.</summary>
    public BuilderFilterNode? Having { get; init; }

    public IReadOnlyList<BuilderSort> Sort { get; init; } = [];

    public long? Limit { get; init; }
    public long? Offset { get; init; }
    public bool Distinct { get; init; }
}

/// <summary>A table on the canvas.</summary>
public sealed record BuilderTable
{
    /// <summary>Stable id inside the model ("t1", "t2", …); joins, columns and refs point to it.</summary>
    public string Id { get; init; } = "";

    /// <summary>Member alias (the link schema).</summary>
    public string Alias { get; init; } = "";

    /// <summary>Mounted table name (<see cref="MountedTable.LinkName"/>).</summary>
    public string Table { get; init; } = "";

    /// <summary>SQL table alias, unique in the model (the UI assigns it when the table is added: the table name, or name2, name3…).</summary>
    public string As { get; init; } = "";

    /// <summary>Canvas position (UI only; ignored by compilers).</summary>
    public double X { get; init; }
    public double Y { get; init; }
    public bool Collapsed { get; init; }
}

/// <summary><see cref="BuilderJoin.Type"/> tokens; SQL: INNER JOIN, LEFT JOIN, RIGHT JOIN, FULL JOIN, CROSS JOIN.</summary>
public static class BuilderJoinTypes
{
    public const string Inner = "inner", Left = "left", Right = "right", Full = "full", Cross = "cross";
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Inner, Left, Right, Full, Cross };
}

public sealed record BuilderJoin
{
    public string Id { get; init; } = "";
    /// <summary><see cref="BuilderJoinTypes"/>; default inner.</summary>
    public string Type { get; init; } = BuilderJoinTypes.Inner;
    /// <summary>Table id already in the FROM clause.</summary>
    public string Left { get; init; } = "";
    /// <summary>Table id this join attaches.</summary>
    public string Right { get; init; } = "";
    /// <summary>ON conditions, joined with AND (empty for cross joins).</summary>
    public IReadOnlyList<BuilderJoinCondition> On { get; init; } = [];
}

/// <summary>
/// <c>left.LeftColumn Op right.RightColumn</c>. <see cref="IgnoreCase"/> / <see cref="Trim"/> wrap both sides:
/// trim → <c>trim(x)</c>, ignore case → <c>lower(x)</c>, both → <c>lower(trim(x))</c>.
/// </summary>
public sealed record BuilderJoinCondition
{
    public string LeftColumn { get; init; } = "";
    public string RightColumn { get; init; } = "";
    /// <summary>= (default), &lt;&gt;, &lt;, &gt;, &lt;=, &gt;=.</summary>
    public string Op { get; init; } = "=";
    public bool IgnoreCase { get; init; }
    public bool Trim { get; init; }
}

/// <summary><see cref="BuilderColumn.Agg"/> tokens; SQL count(x), count(DISTINCT x), sum, avg, min, max (count with no column: count(*)).</summary>
public static class BuilderAggregates
{
    public const string Count = "count", CountDistinct = "countDistinct", Sum = "sum", Avg = "avg", Min = "min", Max = "max";
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Count, CountDistinct, Sum, Avg, Min, Max };
}

/// <summary>An output column: a table column (<see cref="TableId"/> + <see cref="Column"/>) or a calculated expression.</summary>
public sealed record BuilderColumn
{
    /// <summary>Stable id ("c1", …); HAVING conditions and sort refs point to it.</summary>
    public string Id { get; init; } = "";
    public string? TableId { get; init; }
    public string? Column { get; init; }
    /// <summary>Calculated column: a DuckDB SQL expression written by the user, emitted verbatim (wins over TableId/Column).</summary>
    public string? Expr { get; init; }
    /// <summary>Output name (AS); null = the column name (expressions without alias get none).</summary>
    public string? Alias { get; init; }
    /// <summary><see cref="BuilderAggregates"/> or null.</summary>
    public string? Agg { get; init; }
    /// <summary>False: kept in the model (e.g. a sort/group helper) but not in the SELECT list.</summary>
    public bool Output { get; init; } = true;
}

/// <summary>A reference to a value: an output column (<see cref="ColumnId"/>), a table column, or an expression (in that priority).</summary>
public sealed record BuilderRef
{
    public string? ColumnId { get; init; }
    public string? TableId { get; init; }
    public string? Column { get; init; }
    public string? Expr { get; init; }
}

public static class BuilderRefs
{
    /// <summary>Key of a table column in WHERE filter conditions: "<c>tableId.column</c>" (the first dot separates).</summary>
    public static string ColumnKey(string tableId, string column) => tableId + "." + column;

    /// <summary>Splits a <see cref="ColumnKey"/>; null when there is no dot.</summary>
    public static (string TableId, string Column)? ParseColumnKey(string key)
    {
        var dot = key.IndexOf('.');
        return dot <= 0 ? null : (key[..dot], key[(dot + 1)..]);
    }
}

public sealed record BuilderSort
{
    public BuilderRef Ref { get; init; } = new();
    /// <summary>asc | desc.</summary>
    public string Dir { get; init; } = "asc";
    /// <summary>first | last | null (DuckDB default).</summary>
    public string? Nulls { get; init; }
}

/// <summary>
/// One node of a filter tree, the wire form of ui/src/filter/model.ts <c>FilterNode</c> (one shape for both kinds):
/// group = { kind: "group", id, logic: and|or, items, negate? }; condition = { kind: "condition", id, column, ordinal?,
/// op (FilterOp token: eq, neq, lt, lte, gt, gte, between, contains, notContains, startsWith, endsWith, in, notIn,
/// isNull, isNotNull, isTrue, isFalse, isEmpty, regex, before, after, onDate, last, next), values, caseSensitive?, enabled? }.
/// </summary>
public sealed record BuilderFilterNode
{
    /// <summary>group | condition.</summary>
    public string Kind { get; init; } = "group";
    public string Id { get; init; } = "";

    // group
    public string? Logic { get; init; }
    public IReadOnlyList<BuilderFilterNode>? Items { get; init; }
    public bool? Negate { get; init; }

    // condition
    public string? Column { get; init; }
    public int? Ordinal { get; init; }
    public string? Op { get; init; }
    /// <summary>Operands (string | number | boolean | null), as in the UI model.</summary>
    public IReadOnlyList<JsonNode?>? Values { get; init; }
    public bool? CaseSensitive { get; init; }
    public bool? Enabled { get; init; }
}
