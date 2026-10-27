using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Builder;

/// <summary>
/// SQL → BuilderModel ("Back to builder", <c>POST /links/{cid}/parse</c>) from DuckDB's <c>json_serialize_sql</c> AST.
/// The builder subset: one SELECT over mounted tables (left-deep INNER/LEFT/RIGHT/FULL/CROSS joins whose ON is an AND of
/// column comparisons, optionally wrapped in lower()/trim()), output columns (table columns, the five aggregates,
/// calculated expressions without aggregates or windows), WHERE/HAVING made of what ui/src/filter/sql.ts produces
/// (with inlined literals), GROUP BY (auto or explicit columns), ORDER BY (columns, aliases, positions), LIMIT/OFFSET and
/// DISTINCT. Anything else (CTEs, subqueries, set operations, window functions, USING/NATURAL/SEMI joins, bind
/// parameters, …) gives a null model with the reason. Every model it returns compiles (BuilderCompiler) to a statement
/// with the same meaning.
/// </summary>
public sealed partial class BuilderParser
{
    private const ulong NoLocation = ulong.MaxValue;

    /// <summary>Aggregate function names (lower-case) that make an expression an aggregate.</summary>
    private static readonly HashSet<string> AggregateNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "count", "count_star", "sum", "avg", "min", "max", "mean", "median", "mode", "string_agg", "group_concat", "listagg", "list",
        "array_agg", "first", "last", "any_value", "arg_min", "arg_max", "argmin", "argmax", "min_by", "max_by", "stddev", "stddev_pop",
        "stddev_samp", "variance", "var_pop", "var_samp", "bool_and", "bool_or", "every", "product", "quantile", "quantile_cont",
        "quantile_disc", "approx_count_distinct", "approx_quantile", "histogram", "bit_and", "bit_or", "bit_xor", "entropy", "kurtosis",
        "skewness", "corr", "covar_pop", "covar_samp", "regr_slope", "regr_intercept", "regr_r2", "regr_count", "sumkahan", "fsum",
        "favg", "kahan_sum", "sum_no_overflow", "bitstring_agg", "geomean", "mad", "reservoir_quantile",
    };

    private sealed class ParseFailure(string reason) : Exception(reason);

    private readonly string _sql;
    private readonly BuilderCatalog _catalog;
    private readonly Func<string, CancellationToken, Task<SqlAst>> _serialize;
    private readonly List<BuilderTable> _tables = [];
    private readonly List<(BuilderColumn Column, string Key)> _columns = [];
    private int _filterSeq, _groupSeq;

    private BuilderParser(string sql, BuilderCatalog catalog, Func<string, CancellationToken, Task<SqlAst>> serialize)
    {
        _sql = sql;
        _catalog = catalog;
        _serialize = serialize;
    }

    /// <summary>Parses <paramref name="sql"/>; <paramref name="serialize"/> is <see cref="ILinkRuntime.SerializeSqlAsync"/>.</summary>
    public static async Task<ParseResult> ParseAsync(string sql, BuilderCatalog catalog, Func<string, CancellationToken, Task<SqlAst>> serialize, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(sql);
        if (string.IsNullOrWhiteSpace(sql)) return new ParseResult(null, "The SQL is empty.");
        var ast = await serialize(sql, ct).ConfigureAwait(false);
        if (!ast.Supported) return new ParseResult(null, "This build cannot parse SQL (no DuckDB).");
        if (!ast.Ok || ast.Json is null) return new ParseResult(null, "The SQL does not parse: " + (ast.Error ?? "syntax error"));
        var parser = new BuilderParser(sql, catalog, serialize);
        try
        {
            using var doc = JsonDocument.Parse(ast.Json);
            var model = await parser.ModelAsync(doc.RootElement, ct).ConfigureAwait(false);
            // A model the compiler refuses is outside the subset too.
            try { BuilderCompiler.Compile(model, catalog); }
            catch (EngineException e) { return new ParseResult(null, e.Message); }
            return new ParseResult(model);
        }
        catch (ParseFailure f)
        {
            return new ParseResult(null, f.Message);
        }
    }

    private static ParseFailure Fail(string reason) => new(reason);

    // ================================================================= statement

    private async Task<BuilderModel> ModelAsync(JsonElement root, CancellationToken ct)
    {
        var statements = root.GetProperty("statements");
        if (statements.GetArrayLength() != 1) throw Fail("The builder holds exactly one statement.");
        var stmt = statements[0];
        if (stmt.TryGetProperty("named_param_map", out var pm) && pm.GetArrayLength() > 0)
            throw Fail("Bind parameters cannot be read back into the builder: inline their values first.");
        var node = stmt.GetProperty("node");
        var type = Str(node, "type");
        if (type == "SET_OPERATION_NODE") throw Fail("UNION / INTERSECT / EXCEPT are outside the builder.");
        if (type != "SELECT_NODE") throw Fail("Only SELECT statements can be shown in the builder.");
        if (node.TryGetProperty("cte_map", out var cte) && cte.GetProperty("map").GetArrayLength() > 0) throw Fail("WITH (common table expressions) is outside the builder.");
        if (!IsNull(node, "qualify")) throw Fail("QUALIFY is outside the builder.");
        if (!IsNull(node, "sample")) throw Fail("USING SAMPLE is outside the builder.");

        // ---- modifiers
        var distinct = false;
        long? limit = null, offset = null;
        JsonElement? orders = null;
        foreach (var m in node.GetProperty("modifiers").EnumerateArray())
        {
            switch (Str(m, "type"))
            {
                case "DISTINCT_MODIFIER":
                    if (m.GetProperty("distinct_on_targets").GetArrayLength() > 0) throw Fail("DISTINCT ON is outside the builder.");
                    distinct = true;
                    break;
                case "ORDER_MODIFIER":
                    orders = m.GetProperty("orders");
                    break;
                case "LIMIT_MODIFIER":
                    limit = LimitValue(m, "limit");
                    offset = LimitValue(m, "offset");
                    break;
                default:
                    throw Fail("LIMIT … PERCENT and other modifiers are outside the builder.");
            }
        }

        // ---- FROM
        var joins = FromClause(node.GetProperty("from_table"));

        // ---- SELECT list
        var select = node.GetProperty("select_list");
        var items = select.EnumerateArray().ToList();
        if (items.Count == 1 && Str(items[0], "class") == "STAR")
        {
            var star = items[0];
            if (Str(star, "relation_name") != "" || star.GetProperty("exclude_list").GetArrayLength() > 0 || star.GetProperty("replace_list").GetArrayLength() > 0
                || star.GetProperty("columns").GetBoolean() || !IsNull(star, "expr"))
                throw Fail("Only a plain SELECT * can be shown in the builder.");
        }
        else
        {
            var fromStart = MinLocation(node.GetProperty("from_table"));
            for (var i = 0; i < items.Count; i++)
            {
                var end = i + 1 < items.Count ? MinLocation(items[i + 1]) : FromKeyword(fromStart);
                await SelectItemAsync(items[i], end, ct).ConfigureAwait(false);
            }
        }

        // ---- WHERE
        BuilderFilterNode? filter = null;
        if (!IsNull(node, "where_clause")) filter = RootGroup(Filter(Refuse(node.GetProperty("where_clause")), WhereColumn));

        // ---- GROUP BY
        var groups = node.GetProperty("group_expressions").EnumerateArray().ToList();
        var sets = node.GetProperty("group_sets");
        if (sets.GetArrayLength() > 1 || (sets.GetArrayLength() == 1 && sets[0].GetArrayLength() != groups.Count))
            throw Fail("GROUPING SETS / ROLLUP / CUBE are outside the builder.");
        var handling = Str(node, "aggregate_handling");
        var autoGroup = true;
        var groupBy = new List<BuilderRef>();
        if (handling == "FORCE_AGGREGATES") { /* GROUP BY ALL = auto group */ }
        else if (handling != "STANDARD_HANDLING") throw Fail("This GROUP BY form is outside the builder.");
        else if (groups.Count > 0)
        {
            var output = _columns.Where(c => c.Column.Output).ToList();
            var auto = output.Any(c => c.Column.Agg is not null) ? output.Where(c => c.Column.Agg is null).Select(c => c.Key).ToList() : [];
            var keys = groups.Select(g => GroupKey(g, output)).ToList();
            if (!keys.SequenceEqual(auto, StringComparer.Ordinal))
            {
                autoGroup = false;
                foreach (var g in groups) groupBy.Add(Ref(g, output, false) ?? throw Fail("GROUP BY expressions must be columns of the query."));
            }
        }

        // ---- HAVING
        BuilderFilterNode? having = null;
        if (!IsNull(node, "having")) having = RootGroup(Filter(Refuse(node.GetProperty("having")), HavingColumn));

        // ---- ORDER BY
        var sort = new List<BuilderSort>();
        if (orders is { } os)
        {
            var output = _columns.Where(c => c.Column.Output).ToList();
            foreach (var o in os.EnumerateArray())
            {
                var dir = Str(o, "type") switch
                {
                    "ASCENDING" or "ORDER_DEFAULT" => "asc",
                    "DESCENDING" => "desc",
                    _ => throw Fail("This ORDER BY form is outside the builder."),
                };
                var nulls = Str(o, "null_order") switch
                {
                    "ORDER_DEFAULT" => null,
                    "NULLS FIRST" or "NULLS_FIRST" => "first",
                    "NULLS LAST" or "NULLS_LAST" => "last",
                    _ => throw Fail("This NULLS ordering is outside the builder."),
                };
                var r = Ref(o.GetProperty("expression"), output, true) ?? throw Fail("ORDER BY expressions must be columns of the query.");
                sort.Add(new BuilderSort { Ref = r, Dir = dir, Nulls = nulls });
            }
        }

        return new BuilderModel
        {
            Tables = _tables,
            Joins = joins,
            Columns = _columns.Select(c => c.Column).ToList(),
            Filter = filter,
            AutoGroup = autoGroup,
            GroupBy = groupBy,
            Having = having,
            Sort = sort,
            Limit = limit,
            Offset = offset,
            Distinct = distinct,
        };
    }

    private static long? LimitValue(JsonElement modifier, string name)
    {
        if (IsNull(modifier, name)) return null;
        var c = Constant(modifier.GetProperty(name));
        if (c is null || c.Value.Kind != "int" || c.Value.Number < 0) throw Fail($"{name.ToUpperInvariant()} must be a non-negative number.");
        return (long)c.Value.Number;
    }

    // ================================================================= FROM

    private List<BuilderJoin> FromClause(JsonElement from)
    {
        var joins = new List<BuilderJoin>();
        Walk(from);
        return joins;

        void Walk(JsonElement t)
        {
            switch (Str(t, "type"))
            {
                case "BASE_TABLE":
                    if (_tables.Count > 0) throw Fail("Comma-separated FROM lists are outside the builder: use CROSS JOIN.");
                    AddTable(t);
                    return;
                case "JOIN":
                {
                    Walk(t.GetProperty("left"));
                    var right = t.GetProperty("right");
                    if (Str(right, "type") != "BASE_TABLE") throw Fail("Nested joins and subqueries are outside the builder.");
                    var refType = Str(t, "ref_type");
                    if (refType is not ("REGULAR" or "CROSS")) throw Fail($"{refType} joins are outside the builder.");
                    if (t.GetProperty("using_columns").GetArrayLength() > 0) throw Fail("JOIN … USING is outside the builder: use ON.");
                    var type = refType == "CROSS" ? BuilderJoinTypes.Cross : Str(t, "join_type") switch
                    {
                        "INNER" => BuilderJoinTypes.Inner,
                        "LEFT" => BuilderJoinTypes.Left,
                        "RIGHT" => BuilderJoinTypes.Right,
                        "FULL" or "OUTER" => BuilderJoinTypes.Full,
                        var other => throw Fail($"{other} joins are outside the builder."),
                    };
                    var rt = AddTable(right);
                    var id = "j" + (joins.Count + 1).ToString(CultureInfo.InvariantCulture);
                    if (type == BuilderJoinTypes.Cross || IsNull(t, "condition"))
                    {
                        if (type != BuilderJoinTypes.Cross) throw Fail("A join needs an ON condition.");
                        joins.Add(new BuilderJoin { Id = id, Type = type, Left = _tables[0].Id, Right = rt.Id });
                        return;
                    }
                    var (left, on) = JoinConditions(t.GetProperty("condition"), rt);
                    joins.Add(new BuilderJoin { Id = id, Type = type, Left = left?.Id ?? _tables[0].Id, Right = rt.Id, On = on });
                    return;
                }
                case "SUBQUERY": throw Fail("Subqueries are outside the builder.");
                case "TABLE_FUNCTION": throw Fail("Table functions are outside the builder.");
                case "EMPTY": throw Fail("The query has no FROM table.");
                default: throw Fail("This FROM clause is outside the builder.");
            }
        }
    }

    private BuilderTable AddTable(JsonElement t)
    {
        if (Str(t, "catalog_name") != "") throw Fail("Catalog-qualified tables are outside the builder.");
        if (t.GetProperty("column_name_alias").GetArrayLength() > 0) throw Fail("Column aliases on tables are outside the builder.");
        if (!IsNull(t, "sample") || !IsNull(t, "at_clause")) throw Fail("TABLESAMPLE / AT clauses are outside the builder.");
        var schema = Str(t, "schema_name");
        var table = Str(t, "table_name");
        var resolved = _catalog.Resolve(schema, table) ?? (schema.Length > 0 ? (schema, table) : throw Fail($"Table '{table}' must be written alias.table."));
        var alias = Str(t, "alias");
        var asName = alias.Length > 0 ? alias : resolved.Table;
        if (_tables.Any(x => string.Equals(x.As, asName, StringComparison.OrdinalIgnoreCase)))
        {
            if (alias.Length > 0) throw Fail($"The table alias '{alias}' is used twice.");
            var n = 2;
            while (_tables.Any(x => string.Equals(x.As, asName + n.ToString(CultureInfo.InvariantCulture), StringComparison.OrdinalIgnoreCase))) n++;
            asName += n.ToString(CultureInfo.InvariantCulture);
        }
        var i = _tables.Count;
        var bt = new BuilderTable
        {
            Id = "t" + (i + 1).ToString(CultureInfo.InvariantCulture),
            Alias = resolved.Alias,
            Table = resolved.Table,
            As = asName,
            X = 40 + (i % 4) * 320,
            Y = 40 + (i / 4) * 280,
        };
        _tables.Add(bt);
        return bt;
    }

    /// <summary>ON = AND of comparisons between the new table and ONE earlier table (the join's Left).</summary>
    private (BuilderTable? Left, List<BuilderJoinCondition> On) JoinConditions(JsonElement cond, BuilderTable right)
    {
        if (IsTrueLiteral(cond)) return (null, []);
        var parts = Str(cond, "type") == "CONJUNCTION_AND" ? cond.GetProperty("children").EnumerateArray().ToList() : [cond];
        BuilderTable? left = null;
        var on = new List<BuilderJoinCondition>();
        foreach (var p in parts)
        {
            if (Str(p, "class") != "COMPARISON") throw Fail("Join conditions must be comparisons of two columns joined with AND.");
            var op = CompareOp(Str(p, "type")) ?? throw Fail("This join operator is outside the builder.");
            var (lt, lc, lw) = JoinSide(p.GetProperty("left"));
            var (rt, rc, rw) = JoinSide(p.GetProperty("right"));
            if (lw != rw) throw Fail("Both sides of a join condition must use the same lower()/trim() wrapping.");
            if (lt.Id == right.Id && rt.Id != right.Id)
            {
                (lt, rt) = (rt, lt);
                (lc, rc) = (rc, lc);
                op = Mirror(op);
            }
            if (rt.Id != right.Id || lt.Id == right.Id) throw Fail($"A join condition of {right.As} must compare it with an earlier table.");
            if (left is not null && left.Id != lt.Id) throw Fail($"The conditions of the join of {right.As} must all use the same earlier table.");
            left = lt;
            on.Add(new BuilderJoinCondition { LeftColumn = lc, RightColumn = rc, Op = op, IgnoreCase = lw.Lower, Trim = lw.Trim });
        }
        return (left, on);
    }

    private (BuilderTable Table, string Column, (bool Lower, bool Trim) Wrap) JoinSide(JsonElement e)
    {
        bool lower = false, trim = false;
        if (FunctionCall(e, "lower") is { } l) { lower = true; e = l; }
        if (FunctionCall(e, "trim") is { } t) { trim = true; e = t; }
        if (Str(e, "class") != "COLUMN_REF") throw Fail("Join conditions must compare columns.");
        var (table, column) = ColumnRef(e) ?? throw Fail("A join column could not be resolved to a table of the query.");
        return (table, column, (lower, trim));
    }

    private static string Mirror(string op) => op switch { "<" => ">", ">" => "<", "<=" => ">=", ">=" => "<=", _ => op };

    private static string? CompareOp(string type) => type switch
    {
        "COMPARE_EQUAL" => "=",
        "COMPARE_NOTEQUAL" => "<>",
        "COMPARE_LESSTHAN" => "<",
        "COMPARE_GREATERTHAN" => ">",
        "COMPARE_LESSTHANOREQUALTO" => "<=",
        "COMPARE_GREATERTHANOREQUALTO" => ">=",
        _ => null,
    };

    // ================================================================= columns

    /// <summary>A column reference resolved against the query's tables: as.column, alias.table.column, or a bare column of exactly one table.</summary>
    private (BuilderTable Table, string Column)? ColumnRef(JsonElement e)
    {
        var names = e.GetProperty("column_names").EnumerateArray().Select(n => n.GetString() ?? "").ToList();
        switch (names.Count)
        {
            case 1:
            {
                var matches = _tables.Where(t => _catalog.Column(t.Alias, t.Table, names[0]) is not null).ToList();
                if (matches.Count == 1) return (matches[0], _catalog.Column(matches[0].Alias, matches[0].Table, names[0])!);
                if (matches.Count == 0 && _tables.Count == 1 && _catalog.Columns(_tables[0].Alias, _tables[0].Table) is null) return (_tables[0], names[0]);
                return null;
            }
            case 2:
            {
                var t = _tables.FirstOrDefault(x => x.As == names[0]) ?? _tables.FirstOrDefault(x => string.Equals(x.As, names[0], StringComparison.OrdinalIgnoreCase));
                if (t is null) return null;
                return (t, _catalog.Column(t.Alias, t.Table, names[1]) ?? names[1]);
            }
            case 3:
            {
                var ts = _tables.Where(x => string.Equals(x.Alias, names[0], StringComparison.OrdinalIgnoreCase) && string.Equals(x.Table, names[1], StringComparison.OrdinalIgnoreCase)).ToList();
                return ts.Count == 1 ? (ts[0], _catalog.Column(ts[0].Alias, ts[0].Table, names[2]) ?? names[2]) : null;
            }
            default: return null;
        }
    }

    private async Task SelectItemAsync(JsonElement item, ulong end, CancellationToken ct)
    {
        var id = "c" + (_columns.Count + 1).ToString(CultureInfo.InvariantCulture);
        var aliasText = Str(item, "alias");
        var alias = aliasText.Length > 0 ? aliasText : null;
        var cls = Str(item, "class");
        if (cls == "STAR") throw Fail("SELECT * mixed with other columns is outside the builder.");
        if (cls == "COLUMN_REF")
        {
            var (t, c) = ColumnRef(item) ?? throw Fail("A column could not be resolved to a table of the query.");
            _columns.Add((new BuilderColumn { Id = id, TableId = t.Id, Column = c, Alias = alias }, Key(item)));
            return;
        }
        Validate(item, allowTopAggregate: true);
        if (cls == "FUNCTION" && AggregateOf(item) is { } agg)
        {
            var children = item.GetProperty("children").EnumerateArray().ToList();
            if (agg == BuilderAggregates.Count && children.Count == 0)
            {
                _columns.Add((new BuilderColumn { Id = id, Agg = agg, Alias = alias }, Key(item)));
                return;
            }
            var child = children[0];
            if (Str(child, "class") == "COLUMN_REF" && ColumnRef(child) is { } cr)
            {
                _columns.Add((new BuilderColumn { Id = id, TableId = cr.Table.Id, Column = cr.Column, Agg = agg, Alias = alias }, Key(item)));
                return;
            }
            Validate(child, allowTopAggregate: false);
            var text = ItemText(item, end, alias);
            var m = AggregateCallText().Match(text);
            if (!m.Success) throw Fail("A calculated aggregate could not be read back.");
            var inner = m.Groups["inner"].Value.Trim();
            await VerifyAsync(inner, child, ct).ConfigureAwait(false);
            _columns.Add((new BuilderColumn { Id = id, Expr = inner, Agg = agg, Alias = alias }, Key(item)));
            return;
        }
        Validate(item, allowTopAggregate: false);
        var expr = ItemText(item, end, alias);
        await VerifyAsync(expr, item, ct).ConfigureAwait(false);
        _columns.Add((new BuilderColumn { Id = id, Expr = expr, Alias = alias }, Key(item)));
    }

    [GeneratedRegex(@"^\s*[A-Za-z_]+\s*\(\s*(?:DISTINCT\s+)?(?<inner>.*)\)\s*$", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex AggregateCallText();

    /// <summary>The builder aggregate token of a call, or null when it is not one of the five.</summary>
    private static string? AggregateOf(JsonElement fn)
    {
        var name = Str(fn, "function_name").ToLowerInvariant();
        var children = fn.GetProperty("children").GetArrayLength();
        if (!IsNull(fn, "filter") || fn.GetProperty("order_bys").GetProperty("orders").GetArrayLength() > 0) return null;
        if (fn.TryGetProperty("is_operator", out var op) && op.GetBoolean()) return null;
        var distinct = fn.TryGetProperty("distinct", out var d) && d.GetBoolean();
        return name switch
        {
            "count_star" when children == 0 && !distinct => BuilderAggregates.Count,
            "count" when children == 1 => distinct ? BuilderAggregates.CountDistinct : BuilderAggregates.Count,
            "sum" or "avg" or "min" or "max" when children == 1 && !distinct => name,
            _ => null,
        };
    }

    /// <summary>Refuses windows, subqueries, parameters, aggregates (except a top-level builder aggregate when allowed) in an expression tree.</summary>
    private static void Validate(JsonElement e, bool allowTopAggregate)
    {
        void Visit(JsonElement x, bool top)
        {
            if (x.ValueKind == JsonValueKind.Object)
            {
                if (x.TryGetProperty("class", out var cls))
                {
                    switch (cls.GetString())
                    {
                        case "WINDOW": throw Fail("Window functions are outside the builder.");
                        case "SUBQUERY": throw Fail("Subqueries are outside the builder.");
                        case "PARAMETER": throw Fail("Bind parameters cannot be read back into the builder: inline their values first.");
                        case "STAR": throw Fail("* inside an expression is outside the builder.");
                        case "FUNCTION":
                            var name = x.GetProperty("function_name").GetString() ?? "";
                            if (AggregateNames.Contains(name) && !(top && allowTopAggregate && AggregateOf(x) is not null))
                                throw Fail($"The aggregate {name}() can only be a column's aggregate in the builder.");
                            break;
                    }
                }
                foreach (var p in x.EnumerateObject()) Visit(p.Value, false);
            }
            else if (x.ValueKind == JsonValueKind.Array)
            {
                foreach (var v in x.EnumerateArray()) Visit(v, false);
            }
        }
        Visit(e, true);
    }

    /// <summary>Windows, subqueries and parameters anywhere in a filter (their own reasons beat the generic one).</summary>
    private static JsonElement Refuse(JsonElement e)
    {
        void Visit(JsonElement x)
        {
            if (x.ValueKind == JsonValueKind.Object)
            {
                switch (Str(x, "class"))
                {
                    case "WINDOW": throw Fail("Window functions are outside the builder.");
                    case "SUBQUERY": throw Fail("Subqueries are outside the builder.");
                    case "PARAMETER": throw Fail("Bind parameters cannot be read back into the builder: inline their values first.");
                }
                foreach (var p in x.EnumerateObject()) Visit(p.Value);
            }
            else if (x.ValueKind == JsonValueKind.Array) foreach (var v in x.EnumerateArray()) Visit(v);
        }
        Visit(e);
        return e;
    }

    // ---- text of select items (calculated columns keep the user's spelling)

    private ulong FromKeyword(ulong fromStart)
    {
        if (fromStart == NoLocation || fromStart > (ulong)_sql.Length) throw Fail("The FROM clause could not be located.");
        var idx = _sql.LastIndexOf("FROM", (int)Math.Max(0, (long)fromStart - 1), StringComparison.OrdinalIgnoreCase);
        if (idx < 0) throw Fail("The FROM clause could not be located.");
        return (ulong)idx;
    }

    private string ItemText(JsonElement item, ulong end, string? alias)
    {
        var start = MinLocation(item);
        if (start == NoLocation || end == NoLocation || start >= end || end > (ulong)_sql.Length) throw Fail("A calculated column could not be read back.");
        var s = (int)start;
        // Opening parentheses before the first token belong to the item.
        var k = s - 1;
        while (k >= 0)
        {
            if (char.IsWhiteSpace(_sql[k])) { k--; continue; }
            if (_sql[k] == '(') { s = k; k--; continue; }
            break;
        }
        var text = _sql[s..(int)end].TrimEnd();
        if (text.EndsWith(',')) text = text[..^1].TrimEnd();
        if (alias is not null)
        {
            var m = AliasSuffix().Match(text);
            if (!m.Success || Unquote(m.Groups["name"].Value) != alias) throw Fail("A calculated column's alias could not be read back.");
            text = m.Groups["expr"].Value.TrimEnd();
        }
        return text;
    }

    [GeneratedRegex("^(?<expr>.*?)\\s+(?:AS\\s+)?(?<name>\"(?:[^\"]|\"\")*\"|[A-Za-z_][A-Za-z0-9_$]*)$", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex AliasSuffix();

    private static string Unquote(string name) =>
        name.Length >= 2 && name[0] == '"' && name[^1] == '"' ? name[1..^1].Replace("\"\"", "\"", StringComparison.Ordinal) : name;

    /// <summary>Re-parses the sliced text and checks it is the same expression.</summary>
    private async Task VerifyAsync(string text, JsonElement expected, CancellationToken ct)
    {
        var ast = await _serialize("SELECT " + text, ct).ConfigureAwait(false);
        if (!ast.Ok || ast.Json is null) throw Fail("A calculated column could not be read back.");
        using var doc = JsonDocument.Parse(ast.Json);
        var list = doc.RootElement.GetProperty("statements")[0].GetProperty("node").GetProperty("select_list");
        if (list.GetArrayLength() != 1 || Key(list[0], ignoreAlias: true) != Key(expected, ignoreAlias: true))
            throw Fail("A calculated column could not be read back.");
    }

    // ================================================================= GROUP BY / ORDER BY refs

    private string GroupKey(JsonElement g, List<(BuilderColumn Column, string Key)> output)
    {
        // GROUP BY 1 / an output alias name the select item.
        if (Constant(g) is { Kind: "int" } pos && pos.Number >= 1 && pos.Number <= output.Count) return output[(int)pos.Number - 1].Key;
        if (Str(g, "class") == "COLUMN_REF" && SingleName(g) is { } n && ColumnRef(g) is null
            && output.FirstOrDefault(c => c.Column.Alias == n) is { Column: not null } byAlias) return byAlias.Key;
        return Key(g);
    }

    private BuilderRef? Ref(JsonElement e, List<(BuilderColumn Column, string Key)> output, bool sort)
    {
        if (Constant(e) is { Kind: "int" } pos)
            return pos.Number >= 1 && pos.Number <= output.Count ? new BuilderRef { ColumnId = output[(int)pos.Number - 1].Column.Id } : null;
        if (Str(e, "class") == "COLUMN_REF" && SingleName(e) is { } n)
        {
            var byAlias = output.FirstOrDefault(c => c.Column.Alias == n);
            if (byAlias.Column is not null && (sort || ColumnRef(e) is null)) return new BuilderRef { ColumnId = byAlias.Column.Id };
        }
        var key = Key(e);
        var same = _columns.FirstOrDefault(c => c.Key == key);
        if (same.Column is not null) return new BuilderRef { ColumnId = same.Column.Id };
        if (Str(e, "class") == "COLUMN_REF" && ColumnRef(e) is { } cr) return new BuilderRef { TableId = cr.Table.Id, Column = cr.Column };
        return null;
    }

    private static string? SingleName(JsonElement colRef)
    {
        var names = colRef.GetProperty("column_names");
        return names.GetArrayLength() == 1 ? names[0].GetString() : null;
    }

    // ================================================================= filters

    private sealed record FilterColumnRef(string Key, string? Kind);

    private FilterColumnRef? WhereColumn(JsonElement e)
    {
        if (Str(e, "class") != "COLUMN_REF") return null;
        var (t, c) = ColumnRef(e) ?? throw Fail("A filter column could not be resolved to a table of the query.");
        return new FilterColumnRef(BuilderRefs.ColumnKey(t.Id, c), _catalog.Kind(t.Alias, t.Table, c));
    }

    private FilterColumnRef? HavingColumn(JsonElement e)
    {
        var key = Key(e);
        var hit = _columns.FirstOrDefault(c => c.Key == key);
        if (hit.Column is null && Str(e, "class") == "COLUMN_REF" && SingleName(e) is { } n)
            hit = _columns.FirstOrDefault(c => c.Column.Output && c.Column.Alias == n);
        if (hit.Column is null)
        {
            // An aggregate the SELECT list does not show: a helper column (Output = false).
            if (Str(e, "class") != "FUNCTION" || AggregateOf(e) is not { } agg) return null;
            var children = e.GetProperty("children").EnumerateArray().ToList();
            var id = "c" + (_columns.Count + 1).ToString(CultureInfo.InvariantCulture);
            BuilderColumn col;
            if (children.Count == 0) col = new BuilderColumn { Id = id, Agg = agg, Output = false };
            else if (Str(children[0], "class") == "COLUMN_REF" && ColumnRef(children[0]) is { } cr)
                col = new BuilderColumn { Id = id, TableId = cr.Table.Id, Column = cr.Column, Agg = agg, Output = false };
            else return null;
            hit = (col, key);
            _columns.Add(hit);
        }
        var c = hit.Column;
        string? kind = c.Agg is BuilderAggregates.Count or BuilderAggregates.CountDistinct ? ColumnKinds.Int
            : c.Agg == BuilderAggregates.Avg ? ColumnKinds.Float
            : c.Expr is null && c.Column is not null && _tables.FirstOrDefault(t => t.Id == c.TableId) is { } tt ? _catalog.Kind(tt.Alias, tt.Table, c.Column)
            : null;
        return new FilterColumnRef(c.Id, kind);
    }

    private BuilderFilterNode RootGroup(BuilderFilterNode n) =>
        n.Kind == "group" ? n : Group("and", [n]);

    private BuilderFilterNode Group(string logic, List<BuilderFilterNode> items, bool negate = false) => new()
    {
        Kind = "group",
        Id = "g" + (++_groupSeq).ToString(CultureInfo.InvariantCulture),
        Logic = logic,
        Items = items,
        Negate = negate ? true : null,
    };

    private BuilderFilterNode Condition(FilterColumnRef col, string op, IEnumerable<JsonNode?> values, bool caseSensitive = false) => new()
    {
        Kind = "condition",
        Id = "f" + (++_filterSeq).ToString(CultureInfo.InvariantCulture),
        Column = col.Key,
        Op = op,
        Values = values.ToList(),
        CaseSensitive = caseSensitive ? true : null,
        Enabled = true,
    };

    private BuilderFilterNode Filter(JsonElement e, Func<JsonElement, FilterColumnRef?> column)
    {
        var type = Str(e, "type");
        switch (type)
        {
            case "CONJUNCTION_AND" or "CONJUNCTION_OR":
                return Group(type == "CONJUNCTION_AND" ? "and" : "or", e.GetProperty("children").EnumerateArray().Select(c => Filter(c, column)).ToList());
            case "OPERATOR_NOT":
            {
                var child = e.GetProperty("children")[0];
                if (LikeCondition(child, column, negated: true) is { } notLike) return notLike;
                var inner = Filter(child, column);
                if (inner.Kind == "group" && inner.Negate != true) return inner with { Negate = true };
                return Group("and", [inner], negate: true);
            }
            case "OPERATOR_IS_NULL" or "OPERATOR_IS_NOT_NULL":
            {
                var col = column(e.GetProperty("children")[0]) ?? throw Unsupported();
                return Condition(col, type == "OPERATOR_IS_NULL" ? "isNull" : "isNotNull", []);
            }
            case "COMPARE_IN" or "COMPARE_NOT_IN":
            {
                var children = e.GetProperty("children").EnumerateArray().ToList();
                var (col, lowered) = FilterOperand(children[0], column);
                var values = new List<JsonNode?>();
                foreach (var v in children.Skip(1))
                {
                    var (lit, litLowered) = Literal(v);
                    if (litLowered != lowered) throw Unsupported();
                    values.Add(ValueFor(lit, col, null));
                }
                var cs = !lowered && FilterValues.KindClass(col.Kind ?? KindOfLiteral(Literal(children[1]).Lit)) != "number";
                return Condition(col, type == "COMPARE_IN" ? "in" : "notIn", values, cs);
            }
            case "COMPARE_BETWEEN":
            {
                var (col, lowered) = FilterOperand(e.GetProperty("input"), column);
                var (lo, l1) = Literal(e.GetProperty("lower"));
                var (hi, l2) = Literal(e.GetProperty("upper"));
                if (l1 != lowered || l2 != lowered) throw Unsupported();
                var cls = FilterValues.KindClass(col.Kind ?? KindOfLiteral(lo));
                return Condition(col, "between", [ValueFor(lo, col, "between"), ValueFor(hi, col, "between")], !lowered && cls is "string" or "other");
            }
        }
        if (Str(e, "class") == "COMPARISON") return Comparison(e, column);
        if (LikeCondition(e, column, negated: false) is { } like) return like;
        if (RegexCondition(e, column) is { } regex) return regex;
        throw Unsupported();
    }

    /// <summary><c>regexp_matches(col, 'pattern'[, 'i'])</c> → the grid's "matches regex" condition (the compiler's output for it).</summary>
    private BuilderFilterNode? RegexCondition(JsonElement e, Func<JsonElement, FilterColumnRef?> column)
    {
        if (Str(e, "class") != "FUNCTION" || !string.Equals(Str(e, "function_name"), "regexp_matches", StringComparison.OrdinalIgnoreCase)) return null;
        var children = e.GetProperty("children").EnumerateArray().ToList();
        if (children.Count is not (2 or 3)) return null;
        var col = column(children[0]);
        if (col is null || Constant(children[1]) is not { Kind: "string" } pattern) return null;
        var caseSensitive = true;
        if (children.Count == 3)
        {
            if (Constant(children[2]) is not { Kind: "string" } flags || flags.Text != "i") return null;
            caseSensitive = false;
        }
        return Condition(col, "regex", [JsonValue.Create(pattern.Text)], caseSensitive);
    }

    private static ParseFailure Unsupported() => Fail("This WHERE / HAVING condition cannot be shown as a builder filter.");

    private BuilderFilterNode Comparison(JsonElement e, Func<JsonElement, FilterColumnRef?> column)
    {
        var op = CompareOp(Str(e, "type")) ?? throw Unsupported();
        var left = e.GetProperty("left");
        var right = e.GetProperty("right");
        if (IsLiteralSide(left) && !IsLiteralSide(right))
        {
            (left, right) = (right, left);
            op = Mirror(op);
        }
        var (col, lowered) = FilterOperand(left, column);
        var (lit, litLowered) = Literal(right);
        if (litLowered != lowered) throw Unsupported();
        var token = op switch { "=" => "eq", "<>" => "neq", "<" => "lt", ">" => "gt", "<=" => "lte", _ => "gte" };
        var kindClass = FilterValues.KindClass(col.Kind ?? KindOfLiteral(lit));
        if (!lowered)
        {
            if (lit.Kind == "bool" && token == "eq" && kindClass is "bool" or "other") return Condition(col, lit.Bool ? "isTrue" : "isFalse", []);
            if (lit.Kind == "string" && lit.Text.Length == 0 && token == "eq" && kindClass is "string" or "other") return Condition(col, "isEmpty", []);
        }
        if (lit.Kind == "null") throw Fail("Comparisons with NULL are outside the builder (use IS NULL).");
        switch (kindClass)
        {
            case "number" or "bool":
                if (lowered) throw Unsupported();
                return Condition(col, token, [ValueFor(lit, col, token)]);
            case "date":
                if (lowered) throw Unsupported();
                return Condition(col, token, [ValueFor(lit, col, token)]);
            case "time":
                if (lowered) throw Unsupported();
                return token switch
                {
                    "lt" => Condition(col, "before", [ValueFor(lit, col, token)]),
                    "gt" => Condition(col, "after", [ValueFor(lit, col, token)]),
                    _ => throw Fail("Time columns can be filtered with before / after / between only."),
                };
            default:
                return Condition(col, token, [ValueFor(lit, col, token)], caseSensitive: !lowered);
        }
    }

    /// <summary>LIKE / ILIKE (with or without ESCAPE '\') whose pattern is %x%, x% or %x → contains / startsWith / endsWith.</summary>
    private BuilderFilterNode? LikeCondition(JsonElement e, Func<JsonElement, FilterColumnRef?> column, bool negated)
    {
        if (Str(e, "class") != "FUNCTION") return null;
        var name = Str(e, "function_name");
        (bool Insensitive, bool Negated, bool Escape)? shape = name switch
        {
            "~~" => (false, false, false),
            "~~*" => (true, false, false),
            "!~~" => (false, true, false),
            "!~~*" => (true, true, false),
            "like_escape" => (false, false, true),
            "ilike_escape" => (true, false, true),
            "not_like_escape" => (false, true, true),
            "not_ilike_escape" => (true, true, true),
            _ => null,
        };
        if (shape is not var (insensitive, negatedFn, escape)) return null;
        var children = e.GetProperty("children").EnumerateArray().ToList();
        if (children.Count != (escape ? 3 : 2)) return null;
        if (escape && (Constant(children[2]) is not { Kind: "string" } esc || esc.Text != "\\")) return null;
        var col = column(children[0]);
        if (col is null) return null;
        var pattern = ConcatText(children[1]);
        if (pattern is null) return null;
        var parsed = LikePattern(pattern, escape);
        if (parsed is null) return null;
        var (op, value) = parsed.Value;
        var not = negated ^ negatedFn;
        if (not && op != "contains") return null; // only "does not contain" exists
        return Condition(col, not ? "notContains" : op, [JsonValue.Create(value)], caseSensitive: !insensitive);
    }

    /// <summary>A string constant or a <c>||</c> chain of string constants, concatenated.</summary>
    private static string? ConcatText(JsonElement e)
    {
        if (Constant(e) is { Kind: "string" } c) return c.Text;
        if (Str(e, "class") == "FUNCTION" && Str(e, "function_name") == "||")
        {
            var sb = new StringBuilder();
            foreach (var ch in e.GetProperty("children").EnumerateArray())
            {
                var part = ConcatText(ch);
                if (part is null) return null;
                sb.Append(part);
            }
            return sb.ToString();
        }
        return null;
    }

    private static (string Op, string Value)? LikePattern(string pattern, bool escape)
    {
        var lead = pattern.StartsWith('%');
        var body = lead ? pattern[1..] : pattern;
        var trail = false;
        if (body.EndsWith('%') && !(escape && EscapedAt(body, body.Length - 1)))
        {
            trail = true;
            body = body[..^1];
        }
        if (!lead && !trail) return null;
        var sb = new StringBuilder();
        for (var i = 0; i < body.Length; i++)
        {
            var ch = body[i];
            if (escape && ch == '\\')
            {
                if (i + 1 >= body.Length) return null;
                sb.Append(body[++i]);
                continue;
            }
            if (ch is '%' or '_') return null;
            if (!escape && ch == '\\') return null; // the compiler would escape it
            sb.Append(ch);
        }
        if (sb.Length == 0) return null;
        return (lead && trail ? "contains" : lead ? "endsWith" : "startsWith", sb.ToString());
    }

    private static bool EscapedAt(string s, int index)
    {
        var n = 0;
        for (var i = index - 1; i >= 0 && s[i] == '\\'; i--) n++;
        return n % 2 == 1;
    }

    private (FilterColumnRef Col, bool Lowered) FilterOperand(JsonElement e, Func<JsonElement, FilterColumnRef?> column)
    {
        if (FunctionCall(e, "lower") is { } inner && column(inner) is { } lc) return (lc, true);
        return (column(e) ?? throw Unsupported(), false);
    }

    private static bool IsLiteralSide(JsonElement e) =>
        Constant(e) is not null || (FunctionCall(e, "lower") is { } inner && Constant(inner) is not null);

    private static (Lit Lit, bool Lowered) Literal(JsonElement e)
    {
        if (FunctionCall(e, "lower") is { } inner && Constant(inner) is { Kind: "string" } s) return (s, true);
        return (Constant(e) ?? throw Unsupported(), false);
    }

    private static string KindOfLiteral(Lit lit) => lit.Kind switch
    {
        "int" or "decimal" or "float" => ColumnKinds.Decimal,
        "bool" => ColumnKinds.Bool,
        _ => ColumnKinds.String,
    };

    /// <summary>The filter operand of a literal for the column's kind class (dates as full ISO datetimes, so "=" keeps its exact meaning).</summary>
    private static JsonNode? ValueFor(Lit lit, FilterColumnRef col, string? op)
    {
        var cls = FilterValues.KindClass(col.Kind ?? KindOfLiteral(lit));
        switch (lit.Kind)
        {
            case "int": return cls == "number" || cls == "bool" ? JsonValue.Create((long)lit.Number) : JsonValue.Create(lit.Text);
            case "float": return cls == "number" ? JsonValue.Create(lit.Number) : JsonValue.Create(lit.Text);
            case "decimal": return JsonValue.Create(lit.Text);
            case "bool": return JsonValue.Create(lit.Bool);
            case "null": throw Fail("NULL values are outside the builder (use IS NULL).");
        }
        var text = lit.Text;
        if (cls == "date")
        {
            var iso = FilterValues.ParseDate(JsonValue.Create(text)) ?? throw Fail($"'{text}' is not a date the builder understands (YYYY-MM-DD[THH:MM:SS]).");
            return JsonValue.Create(iso.Length == 10 ? iso + "T00:00:00" : iso);
        }
        if (cls == "time")
        {
            var t = FilterValues.ParseTime(JsonValue.Create(text)) ?? throw Fail($"'{text}' is not a time the builder understands (HH:MM[:SS]).");
            return JsonValue.Create(t);
        }
        if (cls == "number" && FilterValues.ParseNumber(JsonValue.Create(text)) is null) throw Fail($"'{text}' is not a number.");
        _ = op;
        return JsonValue.Create(text);
    }

    // ================================================================= AST helpers

    private readonly record struct Lit(string Kind, string Text, double Number = 0, bool Bool = false);

    /// <summary>A constant: VALUE_CONSTANT, CAST(constant AS DATE/TIME/TIMESTAMP/BOOLEAN), or -constant.</summary>
    private static Lit? Constant(JsonElement e)
    {
        var cls = Str(e, "class");
        if (cls == "CAST")
        {
            if (e.TryGetProperty("try_cast", out var tc) && tc.GetBoolean()) return null;
            var target = e.GetProperty("cast_type").GetProperty("id").GetString();
            var inner = Constant(e.GetProperty("child"));
            if (inner is not { Kind: "string" } s) return null;
            return target switch
            {
                "BOOLEAN" => s.Text is "t" or "true" ? new Lit("bool", "true", Bool: true) : s.Text is "f" or "false" ? new Lit("bool", "false") : null,
                "DATE" or "TIME" or "TIMESTAMP" or "TIMESTAMP WITH TIME ZONE" or "VARCHAR" => s,
                _ => null,
            };
        }
        if (cls == "FUNCTION" && Str(e, "function_name") == "-" && e.GetProperty("children").GetArrayLength() == 1
            && Constant(e.GetProperty("children")[0]) is { Kind: "int" or "decimal" or "float" } neg)
            return neg with { Number = -neg.Number, Text = neg.Text.StartsWith('-') ? neg.Text[1..] : "-" + neg.Text };
        if (cls != "CONSTANT") return null;
        var value = e.GetProperty("value");
        if (value.GetProperty("is_null").GetBoolean()) return new Lit("null", "");
        var typeId = value.GetProperty("type").GetProperty("id").GetString();
        var v = value.GetProperty("value");
        switch (typeId)
        {
            case "TINYINT" or "SMALLINT" or "INTEGER" or "BIGINT" or "HUGEINT" or "UTINYINT" or "USMALLINT" or "UINTEGER" or "UBIGINT" or "UHUGEINT":
            {
                var raw = v.ValueKind == JsonValueKind.String ? v.GetString()! : v.GetRawText();
                return new Lit("int", raw, double.Parse(raw, NumberStyles.Float, CultureInfo.InvariantCulture));
            }
            case "DECIMAL":
            {
                var scale = value.GetProperty("type").GetProperty("type_info").GetProperty("scale").GetInt32();
                var raw = v.ValueKind == JsonValueKind.String ? v.GetString()! : v.GetRawText();
                var text = ScaleDecimal(raw, scale);
                return new Lit("decimal", text, double.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture));
            }
            case "FLOAT" or "DOUBLE":
            {
                var d = v.GetDouble();
                return new Lit("float", FilterValues.JsNumber(d), d);
            }
            case "VARCHAR": return new Lit("string", v.GetString() ?? "");
            case "BOOLEAN": return new Lit("bool", v.GetBoolean() ? "true" : "false", Bool: v.GetBoolean());
            default: return null;
        }
    }

    private static string ScaleDecimal(string raw, int scale)
    {
        var neg = raw.StartsWith('-');
        var digits = neg ? raw[1..] : raw;
        if (scale > 0)
        {
            digits = digits.PadLeft(scale + 1, '0');
            digits = digits[..^scale] + "." + digits[^scale..];
        }
        return (neg ? "-" : "") + digits;
    }

    private static bool IsTrueLiteral(JsonElement e) => Constant(e) is { Kind: "bool", Bool: true };

    /// <summary>The single argument of a call to <paramref name="name"/>, or null.</summary>
    private static JsonElement? FunctionCall(JsonElement e, string name)
    {
        if (Str(e, "class") != "FUNCTION" || !string.Equals(Str(e, "function_name"), name, StringComparison.OrdinalIgnoreCase)) return null;
        var children = e.GetProperty("children");
        return children.GetArrayLength() == 1 ? children[0] : null;
    }

    private static string Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    private static bool IsNull(JsonElement e, string name) => !e.TryGetProperty(name, out var v) || v.ValueKind == JsonValueKind.Null;

    /// <summary>Smallest query_location in a subtree (the sentinel ulong.MaxValue = unknown).</summary>
    private static ulong MinLocation(JsonElement e)
    {
        var min = NoLocation;
        void Visit(JsonElement x)
        {
            if (x.ValueKind == JsonValueKind.Object)
            {
                foreach (var p in x.EnumerateObject())
                {
                    if (p.NameEquals("query_location") && p.Value.ValueKind == JsonValueKind.Number && p.Value.TryGetUInt64(out var loc)) min = Math.Min(min, loc);
                    else Visit(p.Value);
                }
            }
            else if (x.ValueKind == JsonValueKind.Array) foreach (var v in x.EnumerateArray()) Visit(v);
        }
        Visit(e);
        return min;
    }

    /// <summary>Structural key of an expression: no locations, top-level alias dropped, column refs resolved to tableId.column.</summary>
    private string Key(JsonElement e, bool ignoreAlias = true)
    {
        var sb = new StringBuilder();
        void Visit(JsonElement x, bool top)
        {
            switch (x.ValueKind)
            {
                case JsonValueKind.Object:
                    if (Str(x, "class") == "COLUMN_REF")
                    {
                        var r = ColumnRef(x);
                        sb.Append(r is { } cr ? "col(" + cr.Table.Id + "." + cr.Column.ToLowerInvariant() + ")"
                            : "name(" + string.Join(".", x.GetProperty("column_names").EnumerateArray().Select(n => n.GetString())) + ")");
                        return;
                    }
                    sb.Append('{');
                    foreach (var p in x.EnumerateObject())
                    {
                        if (p.NameEquals("query_location")) continue;
                        if (p.NameEquals("alias") && (top ? ignoreAlias : true)) continue;
                        sb.Append(p.Name).Append(':');
                        Visit(p.Value, false);
                        sb.Append(',');
                    }
                    sb.Append('}');
                    return;
                case JsonValueKind.Array:
                    sb.Append('[');
                    foreach (var v in x.EnumerateArray()) { Visit(v, false); sb.Append(','); }
                    sb.Append(']');
                    return;
                default:
                    sb.Append(x.GetRawText());
                    return;
            }
        }
        Visit(e, true);
        return sb.ToString();
    }
}
