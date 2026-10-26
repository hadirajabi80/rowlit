using System.Globalization;
using System.Numerics;
using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Sql;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Pushdown;

/// <summary>The mounted tables a query can reference: <c>alias.table</c> → source table (case-insensitive).</summary>
public sealed class LinkTableCatalog
{
    private readonly Dictionary<string, Dictionary<string, SourceTable>> _byAlias = new(StringComparer.OrdinalIgnoreCase);

    /// <param name="defaultAlias">Schema of unqualified table names (the first alias: the engine's search_path).</param>
    public LinkTableCatalog(IEnumerable<(string Alias, SourceTable Table)> tables, string? defaultAlias)
    {
        foreach (var (alias, table) in tables)
        {
            if (!_byAlias.TryGetValue(alias, out var map)) _byAlias[alias] = map = new Dictionary<string, SourceTable>(StringComparer.OrdinalIgnoreCase);
            map.TryAdd(table.LinkName, table);
        }
        DefaultAlias = defaultAlias;
    }

    public string? DefaultAlias { get; }

    public IEnumerable<string> Aliases => _byAlias.Keys;

    public IEnumerable<(string Alias, SourceTable Table)> All => _byAlias.SelectMany(kv => kv.Value.Values.Select(t => (kv.Key, t)));

    /// <summary>Resolves <c>schema.table</c> (schema null/empty = <see cref="DefaultAlias"/>) to the alias and table as the link spells them.</summary>
    public bool TryResolve(string? schema, string table, out LinkTableRef reference, out SourceTable source)
    {
        reference = new LinkTableRef("", "");
        source = null!;
        var s = string.IsNullOrEmpty(schema) ? DefaultAlias : schema;
        if (s is null || !_byAlias.TryGetValue(s, out var map) || !map.TryGetValue(table, out var t)) return false;
        reference = new LinkTableRef(_byAlias.Keys.First(k => string.Equals(k, s, StringComparison.OrdinalIgnoreCase)), t.LinkName);
        source = t;
        return true;
    }
}

/// <summary>What the analyzer decided for one mounted table of a query.</summary>
/// <param name="AllColumns">The whole table is needed (SELECT *, NATURAL JOIN, a row-struct reference, the text fallback).</param>
public sealed record AnalyzedTable(LinkTableRef Table, SourceTable Source, IReadOnlyList<string> Columns, IReadOnlyList<PushdownPredicate> Predicates,
    long? Limit, bool AllColumns);

/// <summary>A join equality between columns of two mounted tables (plan warnings: kinds, collations).</summary>
public sealed record JoinPair(LinkTableRef Left, SourceColumn LeftColumn, LinkTableRef Right, SourceColumn RightColumn);

/// <summary>The analyzer's result for one SQL text.</summary>
/// <param name="Parsed">DuckDB's AST was used (false: text fallback or a syntax error).</param>
/// <param name="SyntaxError">The parser rejected the SQL (nothing is fetched: the engine reports the error).</param>
/// <param name="LimitWithoutOrder">The outermost query has LIMIT but no ORDER BY.</param>
public sealed record QueryAnalysis(bool Parsed, IReadOnlyList<AnalyzedTable> Tables, IReadOnlyList<JoinPair> JoinPairs, bool LimitWithoutOrder,
    string? SyntaxError = null, string? FallbackReason = null);

/// <summary>
/// Push-down analysis (plan-links 1, "Push-down"): DuckDB's AST (<c>json_serialize_sql</c>) → the mounted tables a query
/// reads, the columns it needs of each (projection, always pushed, conservative: every column name the query mentions
/// that a table has), conjunctive single-table predicates (<c>column OP literal</c>; = &lt;&gt; &lt; &gt; &lt;= &gt;= IN BETWEEN
/// LIKE IS NOT NULL — all null-rejecting; never IS NULL, OR, NOT, functions, casts on the column, parameters), and a LIMIT
/// for single-table queries without joins, aggregates, DISTINCT, ORDER BY, windows or subqueries whose predicates all push.
/// <para>
/// Outer-join safety: WHERE predicates push to any table of their own SELECT (null-rejecting predicates on the
/// null-supplying side are safe because the engine re-applies the WHERE); ON predicates push only to the side the join
/// filters (inner: both; LEFT: the right side; RIGHT: the left side; SEMI: both; ANTI: the right side; FULL: none).
/// A table read several times (self-join, subqueries) gets only the predicates every occurrence has. POSITIONAL / ASOF
/// joins and table references the analyzer does not know push nothing and fetch whole tables.
/// </para>
/// Statements DuckDB cannot serialize (PIVOT, DESCRIBE, SHOW, SUMMARIZE…) use the text fallback: tables named
/// <c>alias.table</c> in the text, all their columns, no predicates (<see cref="PlanWarningCodes.Fallback"/>).
/// </summary>
public static class QueryAnalyzer
{
    public static QueryAnalysis Analyze(SqlAst ast, string sql, LinkTableCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(ast);
        if (!ast.Supported) return TextFallback(sql, catalog, "The engine has no SQL parser.");
        if (!ast.Ok || ast.Json is null)
        {
            if (ast.Json is not null && IsParserError(ast.Json, out var message)) return new QueryAnalysis(false, [], [], false, message);
            return TextFallback(sql, catalog, ast.Error ?? "The statement cannot be analysed.");
        }
        try
        {
            using var doc = JsonDocument.Parse(ast.Json);
            return new Walker(catalog).Run(doc.RootElement);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException or FormatException)
        {
            return TextFallback(sql, catalog, "The statement's syntax tree was not understood: " + e.Message);
        }
    }

    private static bool IsParserError(string json, out string? message)
    {
        message = null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.TryGetProperty("error_type", out var t) && t.GetString() is "parser")
            {
                message = root.TryGetProperty("error_message", out var m) ? m.GetString() : "Syntax error.";
                return true;
            }
        }
        catch (JsonException) { /* not JSON */ }
        return false;
    }

    /// <summary>Tables named <c>alias.table</c> (or a default-schema table after FROM/JOIN…) in the SQL text, all columns, no predicates.</summary>
    public static QueryAnalysis TextFallback(string sql, LinkTableCatalog catalog, string reason)
    {
        var tokens = SqlTokenizer.Tokenize(sql, Dialect.DuckDb);
        var found = new Dictionary<string, (LinkTableRef Ref, SourceTable Src)>(StringComparer.OrdinalIgnoreCase);
        static bool IsName(SqlToken t) => t.Kind is SqlTokenKind.Word or SqlTokenKind.QuotedIdentifier;
        static string NameOf(SqlToken t) => t.Kind == SqlTokenKind.QuotedIdentifier && t.Value.Length >= 2 && t.Value[0] == '"'
            ? t.Value[1..^1].Replace("\"\"", "\"", StringComparison.Ordinal) : t.Value;
        for (var i = 0; i < tokens.Count; i++)
        {
            if (!IsName(tokens[i])) continue;
            if (i + 2 < tokens.Count && tokens[i + 1].Kind == SqlTokenKind.Punct && tokens[i + 1].Value == "." && IsName(tokens[i + 2])
                && catalog.TryResolve(NameOf(tokens[i]), NameOf(tokens[i + 2]), out var r, out var src))
            {
                found.TryAdd(r.ToString(), (r, src));
                i += 2;
                continue;
            }
            var prevKeyword = i > 0 && tokens[i - 1].Kind == SqlTokenKind.Word
                && tokens[i - 1].Value.ToUpperInvariant() is "FROM" or "JOIN" or "PIVOT" or "UNPIVOT" or "DESCRIBE" or "DESC" or "SUMMARIZE" or "TABLE";
            var nextIsDot = i + 1 < tokens.Count && tokens[i + 1].Value == ".";
            if (prevKeyword && !nextIsDot && catalog.TryResolve(null, NameOf(tokens[i]), out var r2, out var src2)) found.TryAdd(r2.ToString(), (r2, src2));
        }
        var tables = found.Values.Select(f => new AnalyzedTable(f.Ref, f.Src, f.Src.Columns.Select(c => c.Name).ToList(), [], null, true)).ToList();
        return new QueryAnalysis(false, tables, [], false, null, reason);
    }

    // ------------------------------------------------------------------ AST walk

    private sealed class Occurrence(LinkTableRef reference, SourceTable source, string alias, string? schema)
    {
        public LinkTableRef Ref { get; } = reference;
        public SourceTable Source { get; } = source;
        /// <summary>Name the query uses for it: its alias, else the table name.</summary>
        public string Alias { get; } = alias;
        public string? Schema { get; } = schema;
        public bool Opaque { get; set; }
        public bool AllColumns { get; set; }
        public List<PushdownPredicate> Predicates { get; } = [];

        public SourceColumn? Column(string name) =>
            Source.Columns.FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.Ordinal))
            ?? Source.Columns.FirstOrDefault(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));
    }

    private sealed class Walker(LinkTableCatalog catalog)
    {
        private readonly List<Occurrence> _all = [];
        private readonly HashSet<string> _cteNames = new(StringComparer.OrdinalIgnoreCase);
        private readonly List<string[]> _columnRefs = [];
        private readonly List<JoinPair> _joins = [];
        private readonly HashSet<string> _usingColumns = new(StringComparer.OrdinalIgnoreCase);

        public QueryAnalysis Run(JsonElement root)
        {
            if (!root.TryGetProperty("statements", out var statements) || statements.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException("no statements");
            CollectCteNames(root);
            CollectColumnRefs(root);

            long? limit = null;
            var limitWithoutOrder = false;
            var statementCount = statements.GetArrayLength();
            foreach (var st in statements.EnumerateArray())
            {
                var node = st.GetProperty("node");
                VisitQueryNode(node);
                limitWithoutOrder |= HasLimitWithoutOrder(node);
                if (statementCount == 1) limit = SingleTableLimit(node);
            }

            // Projection: every referenced column name, attributed conservatively.
            var needed = new Dictionary<Occurrence, HashSet<string>>();
            foreach (var o in _all) needed[o] = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var parts in _columnRefs) Attribute(parts, needed);
            foreach (var u in _usingColumns) Attribute([u], needed);

            // Group occurrences by physical table.
            var tables = new List<AnalyzedTable>();
            foreach (var group in _all.GroupBy(o => o.Ref.ToString(), StringComparer.OrdinalIgnoreCase))
            {
                var occ = group.ToList();
                var src = occ[0].Source;
                var all = occ.Any(o => o.AllColumns);
                var names = new HashSet<string>(occ.SelectMany(o => needed[o]), StringComparer.OrdinalIgnoreCase);
                var columns = all ? src.Columns.Select(c => c.Name).ToList()
                    : src.Columns.Where(c => names.Contains(c.Name)).Select(c => c.Name).ToList();
                if (columns.Count == 0 && src.Columns.Count > 0)
                    columns.Add(src.PrimaryKey.FirstOrDefault(pk => src.Columns.Any(c => c.Name == pk)) ?? src.Columns[0].Name);

                // Predicates every occurrence has.
                IReadOnlyList<PushdownPredicate> preds = [];
                if (occ.All(o => !o.Opaque))
                {
                    var keys = occ.Select(o => o.Predicates.Select(Key).ToHashSet(StringComparer.Ordinal)).ToList();
                    var common = keys.Skip(1).Aggregate(new HashSet<string>(keys[0], StringComparer.Ordinal), (acc, k) => { acc.IntersectWith(k); return acc; });
                    var seen = new HashSet<string>(StringComparer.Ordinal);
                    preds = occ[0].Predicates.Where(p => common.Contains(Key(p)) && seen.Add(Key(p))).ToList();
                }
                var tableLimit = occ.Count == 1 && limit is not null && ReferenceEquals(occ[0], _limitOccurrence) ? limit : null;
                tables.Add(new AnalyzedTable(occ[0].Ref, src, columns, preds, tableLimit, all));
            }
            return new QueryAnalysis(true, tables, _joins, limitWithoutOrder);
        }

        private Occurrence? _limitOccurrence;

        internal static string Key(PushdownPredicate p) =>
            p.Column.ToUpperInvariant() + "\u0001" + p.Op + "\u0001" + string.Join("\u0002", p.Values.Select(v => v.Kind + ":" + v.Value));

        private void Attribute(string[] parts, Dictionary<Occurrence, HashSet<string>> needed)
        {
            if (parts.Length == 0) return;
            if (parts.Length == 2)
            {
                var byAlias = _all.Where(o => string.Equals(o.Alias, parts[0], StringComparison.OrdinalIgnoreCase)).ToList();
                var hits = byAlias.Where(o => o.Column(parts[1]) is not null).ToList();
                if (hits.Count > 0)
                {
                    foreach (var o in hits) needed[o].Add(o.Column(parts[1])!.Name);
                    return;
                }
            }
            if (parts.Length >= 3)
            {
                // schema.table.column
                foreach (var o in _all.Where(o => string.Equals(o.Ref.Alias, parts[0], StringComparison.OrdinalIgnoreCase)
                                                  && string.Equals(o.Ref.Table, parts[1], StringComparison.OrdinalIgnoreCase)))
                {
                    if (o.Column(parts[2]) is { } c) needed[o].Add(c.Name);
                }
            }
            foreach (var part in parts)
            {
                var any = false;
                foreach (var o in _all)
                {
                    if (o.Column(part) is { } c)
                    {
                        needed[o].Add(c.Name);
                        any = true;
                    }
                }
                // "SELECT t FROM a.t t": a bare table alias is the whole row as a struct.
                if (!any && parts.Length == 1)
                    foreach (var o in _all.Where(o => string.Equals(o.Alias, part, StringComparison.OrdinalIgnoreCase))) o.AllColumns = true;
            }
        }

        // ---- collection passes over the whole tree

        private void CollectCteNames(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    if (e.TryGetProperty("cte_map", out var cm) && cm.ValueKind == JsonValueKind.Object && cm.TryGetProperty("map", out var map)
                        && map.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var entry in map.EnumerateArray())
                            if (entry.TryGetProperty("key", out var k) && k.GetString() is { } name) _cteNames.Add(name);
                    }
                    foreach (var p in e.EnumerateObject()) CollectCteNames(p.Value);
                    break;
                case JsonValueKind.Array:
                    foreach (var x in e.EnumerateArray()) CollectCteNames(x);
                    break;
            }
        }

        private void CollectColumnRefs(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    if (TypeOf(e) == "COLUMN_REF" && e.TryGetProperty("column_names", out var names) && names.ValueKind == JsonValueKind.Array)
                        _columnRefs.Add(names.EnumerateArray().Select(n => n.GetString() ?? "").ToArray());
                    if (TypeOf(e) == "JOIN" && e.TryGetProperty("using_columns", out var uc) && uc.ValueKind == JsonValueKind.Array)
                        foreach (var u in uc.EnumerateArray()) if (u.GetString() is { } s) _usingColumns.Add(s);
                    foreach (var p in e.EnumerateObject()) CollectColumnRefs(p.Value);
                    break;
                case JsonValueKind.Array:
                    foreach (var x in e.EnumerateArray()) CollectColumnRefs(x);
                    break;
            }
        }

        private static string? TypeOf(JsonElement e) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;

        private static bool IsNull(JsonElement e, string property) =>
            !e.TryGetProperty(property, out var v) || v.ValueKind == JsonValueKind.Null;

        // ---- query nodes

        private void VisitQueryNode(JsonElement node)
        {
            if (node.ValueKind != JsonValueKind.Object) return;
            if (node.TryGetProperty("cte_map", out var cm) && cm.TryGetProperty("map", out var map) && map.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in map.EnumerateArray())
                    if (entry.TryGetProperty("value", out var v) && v.TryGetProperty("query", out var q) && q.TryGetProperty("node", out var n))
                        VisitQueryNode(n);
            }
            switch (TypeOf(node))
            {
                case "SELECT_NODE":
                    VisitSelect(node);
                    break;
                case "SET_OPERATION_NODE" or "RECURSIVE_CTE_NODE" or "CTE_NODE":
                    foreach (var side in new[] { "left", "right", "query", "child" })
                        if (node.TryGetProperty(side, out var s)) VisitQueryNode(s);
                    if (node.TryGetProperty("children", out var ch) && ch.ValueKind == JsonValueKind.Array)
                        foreach (var c in ch.EnumerateArray()) VisitQueryNode(c);
                    VisitSubqueriesIn(node, skip: ["left", "right", "query", "child", "children", "cte_map"]);
                    break;
                default:
                    MarkOpaque(node);
                    break;
            }
        }

        private void VisitSelect(JsonElement node)
        {
            var direct = new List<Occurrence>();
            if (node.TryGetProperty("from_table", out var from)) direct = VisitFrom(from);

            // SELECT * / t.* / COLUMNS(...) need whole tables of this FROM.
            if (node.TryGetProperty("select_list", out var list) && list.ValueKind == JsonValueKind.Array)
            {
                var fromAll = from.ValueKind == JsonValueKind.Object ? AllOccurrencesIn(from) : [];
                foreach (var item in list.EnumerateArray()) MarkStars(item, fromAll);
            }

            // WHERE conjuncts.
            if (node.TryGetProperty("where_clause", out var where) && where.ValueKind == JsonValueKind.Object)
            {
                foreach (var c in Conjuncts(where))
                {
                    if (TryPredicate(c, direct, out var occ, out var pred)) occ!.Predicates.Add(pred!);
                    RecordJoinPair(c, direct);
                }
            }

            // Nested subqueries in expressions (EXISTS, IN (SELECT…), scalar subqueries).
            VisitSubqueriesIn(node, skip: ["from_table", "cte_map"]);
        }

        /// <summary>Visits every query node nested in expression fields (not the FROM, handled by <see cref="VisitFrom"/>).</summary>
        private void VisitSubqueriesIn(JsonElement e, string[] skip)
        {
            if (e.ValueKind == JsonValueKind.Object)
            {
                foreach (var p in e.EnumerateObject())
                {
                    if (skip.Contains(p.Name)) continue;
                    FindSubqueries(p.Value);
                }
            }
        }

        private void FindSubqueries(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    if (e.TryGetProperty("subquery", out var sq) && sq.ValueKind == JsonValueKind.Object && sq.TryGetProperty("node", out var n))
                    {
                        VisitQueryNode(n);
                        foreach (var p in e.EnumerateObject()) if (p.Name != "subquery") FindSubqueries(p.Value);
                        return;
                    }
                    foreach (var p in e.EnumerateObject()) FindSubqueries(p.Value);
                    break;
                case JsonValueKind.Array:
                    foreach (var x in e.EnumerateArray()) FindSubqueries(x);
                    break;
            }
        }

        /// <summary>Visits a table reference; returns the base-table occurrences directly in it (not inside subqueries).</summary>
        private List<Occurrence> VisitFrom(JsonElement from)
        {
            switch (TypeOf(from))
            {
                case "BASE_TABLE":
                {
                    var schema = from.TryGetProperty("schema_name", out var s) ? s.GetString() : null;
                    var table = from.GetProperty("table_name").GetString() ?? "";
                    if (string.IsNullOrEmpty(schema) && _cteNames.Contains(table)) return [];
                    if (!catalog.TryResolve(schema, table, out var r, out var src)) return [];
                    var alias = from.TryGetProperty("alias", out var a) && a.GetString() is { Length: > 0 } al ? al : src.LinkName;
                    var occ = new Occurrence(r, src, alias, schema);
                    // TABLESAMPLE: a pushed predicate would change what the sample draws from.
                    if (!IsNull(from, "sample")) occ.Opaque = true;
                    if (from.TryGetProperty("column_name_alias", out var cna) && cna.ValueKind == JsonValueKind.Array && cna.GetArrayLength() > 0)
                        occ.AllColumns = true; // t(a, b) renames columns positionally
                    _all.Add(occ);
                    return [occ];
                }
                case "JOIN":
                {
                    var left = VisitFrom(from.GetProperty("left"));
                    var right = VisitFrom(from.GetProperty("right"));
                    var joinType = from.TryGetProperty("join_type", out var jt) ? jt.GetString() : "INNER";
                    var refType = from.TryGetProperty("ref_type", out var rt) ? rt.GetString() : "REGULAR";
                    var both = left.Concat(right).ToList();
                    if (refType is "NATURAL")
                    {
                        foreach (var o in AllOccurrencesIn(from)) o.AllColumns = true;
                    }
                    if (refType is not ("REGULAR" or "NATURAL" or "CROSS" or "DEPENDENT") || joinType is not ("INNER" or "LEFT" or "RIGHT" or "OUTER" or "FULL" or "SEMI" or "ANTI"))
                    {
                        foreach (var o in AllOccurrencesIn(from)) o.Opaque = true;
                        if (from.TryGetProperty("condition", out var oc)) FindSubqueries(oc);
                        return both;
                    }
                    if (from.TryGetProperty("condition", out var cond) && cond.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var c in Conjuncts(cond))
                        {
                            RecordJoinPair(c, both);
                            if (!TryPredicate(c, both, out var occ, out var pred)) continue;
                            var onLeft = left.Contains(occ!);
                            var allowed = joinType switch
                            {
                                "INNER" => true,
                                "LEFT" => !onLeft,
                                "RIGHT" => onLeft,
                                "SEMI" => true,
                                "ANTI" => !onLeft,
                                _ => false, // FULL / OUTER
                            };
                            if (allowed) occ!.Predicates.Add(pred!);
                        }
                        FindSubqueries(cond);
                    }
                    return both;
                }
                case "SUBQUERY":
                {
                    if (from.TryGetProperty("subquery", out var sq) && sq.TryGetProperty("node", out var n)) VisitQueryNode(n);
                    if (from.TryGetProperty("column_name_alias", out var cna) && cna.ValueKind == JsonValueKind.Array && cna.GetArrayLength() > 0
                        && from.TryGetProperty("subquery", out var sq2))
                        foreach (var o in AllOccurrencesIn(sq2)) o.AllColumns = true;
                    return [];
                }
                case "EMPTY" or "EXPRESSION_LIST" or "TABLE_FUNCTION":
                    FindSubqueries(from);
                    return [];
                case null:
                    return [];
                default:
                    // PIVOT / UNPIVOT / anything new: whole tables, nothing pushed.
                    MarkOpaque(from);
                    return [];
            }
        }

        /// <summary>Every base table inside <paramref name="e"/> (including nested subqueries) is read whole without predicates.</summary>
        private void MarkOpaque(JsonElement e)
        {
            var before = _all.Count;
            CollectBaseTables(e);
            for (var i = before; i < _all.Count; i++)
            {
                _all[i].Opaque = true;
                _all[i].AllColumns = true;
            }
        }

        private void CollectBaseTables(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    if (TypeOf(e) == "BASE_TABLE")
                    {
                        VisitFrom(e);
                        return;
                    }
                    foreach (var p in e.EnumerateObject()) CollectBaseTables(p.Value);
                    break;
                case JsonValueKind.Array:
                    foreach (var x in e.EnumerateArray()) CollectBaseTables(x);
                    break;
            }
        }

        /// <summary>Occurrences already registered whose BASE_TABLE node lies inside <paramref name="e"/> (matched by alias / table).</summary>
        private List<Occurrence> AllOccurrencesIn(JsonElement e)
        {
            var names = new List<(string? Schema, string Table, string? Alias)>();
            void Walk(JsonElement x)
            {
                switch (x.ValueKind)
                {
                    case JsonValueKind.Object:
                        if (TypeOf(x) == "BASE_TABLE")
                        {
                            names.Add((x.TryGetProperty("schema_name", out var s) ? s.GetString() : null, x.GetProperty("table_name").GetString() ?? "",
                                x.TryGetProperty("alias", out var a) ? a.GetString() : null));
                            return;
                        }
                        foreach (var p in x.EnumerateObject()) Walk(p.Value);
                        break;
                    case JsonValueKind.Array:
                        foreach (var y in x.EnumerateArray()) Walk(y);
                        break;
                }
            }
            Walk(e);
            var result = new List<Occurrence>();
            foreach (var (schema, table, alias) in names)
            {
                if (!catalog.TryResolve(schema, table, out var r, out _)) continue;
                result.AddRange(_all.Where(o => o.Ref.ToString().Equals(r.ToString(), StringComparison.OrdinalIgnoreCase)
                                                && (string.IsNullOrEmpty(alias) || string.Equals(o.Alias, alias, StringComparison.OrdinalIgnoreCase))));
            }
            return result.Distinct().ToList();
        }

        private void MarkStars(JsonElement e, List<Occurrence> fromAll)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    if (TypeOf(e) == "STAR")
                    {
                        var relation = e.TryGetProperty("relation_name", out var rn) ? rn.GetString() : null;
                        var columns = e.TryGetProperty("columns", out var c) && c.ValueKind == JsonValueKind.True;
                        var targets = !columns && !string.IsNullOrEmpty(relation)
                            ? fromAll.Where(o => string.Equals(o.Alias, relation, StringComparison.OrdinalIgnoreCase)).ToList()
                            : [];
                        foreach (var o in targets.Count > 0 ? targets : fromAll) o.AllColumns = true;
                    }
                    if (e.TryGetProperty("subquery", out _)) return; // nested selects mark their own stars
                    foreach (var p in e.EnumerateObject()) MarkStars(p.Value, fromAll);
                    break;
                case JsonValueKind.Array:
                    foreach (var x in e.EnumerateArray()) MarkStars(x, fromAll);
                    break;
            }
        }

        private static IEnumerable<JsonElement> Conjuncts(JsonElement e)
        {
            if (TypeOf(e) == "CONJUNCTION_AND" && e.TryGetProperty("children", out var ch) && ch.ValueKind == JsonValueKind.Array)
            {
                foreach (var c in ch.EnumerateArray())
                    foreach (var x in Conjuncts(c)) yield return x;
                yield break;
            }
            yield return e;
        }

        // ---- predicates

        private static string[]? ColumnNames(JsonElement e) =>
            TypeOf(e) == "COLUMN_REF" && e.TryGetProperty("column_names", out var n) && n.ValueKind == JsonValueKind.Array
                ? n.EnumerateArray().Select(x => x.GetString() ?? "").ToArray()
                : null;

        /// <summary>The single occurrence of <paramref name="scope"/> a column reference names, with its source column.</summary>
        private static (Occurrence Occ, SourceColumn Col)? Resolve(string[] parts, List<Occurrence> scope)
        {
            List<(Occurrence, SourceColumn)> hits = parts.Length switch
            {
                1 => scope.Select(o => (o, o.Column(parts[0]))).Where(x => x.Item2 is not null).Select(x => (x.o, x.Item2!)).ToList(),
                2 => scope.Where(o => string.Equals(o.Alias, parts[0], StringComparison.OrdinalIgnoreCase))
                    .Select(o => (o, o.Column(parts[1]))).Where(x => x.Item2 is not null).Select(x => (x.o, x.Item2!)).ToList(),
                3 => scope.Where(o => string.Equals(o.Ref.Alias, parts[0], StringComparison.OrdinalIgnoreCase)
                                      && string.Equals(o.Ref.Table, parts[1], StringComparison.OrdinalIgnoreCase) && o.Alias == o.Source.LinkName)
                    .Select(o => (o, o.Column(parts[2]))).Where(x => x.Item2 is not null).Select(x => (x.o, x.Item2!)).ToList(),
                _ => [],
            };
            return hits.Count == 1 ? hits[0] : null;
        }

        private void RecordJoinPair(JsonElement e, List<Occurrence> scope)
        {
            if (TypeOf(e) != "COMPARE_EQUAL" || !e.TryGetProperty("left", out var l) || !e.TryGetProperty("right", out var r)) return;
            if (ColumnNames(l) is not { } ln || ColumnNames(r) is not { } rn) return;
            if (Resolve(ln, scope) is not { } a || Resolve(rn, scope) is not { } b || ReferenceEquals(a.Occ, b.Occ)) return;
            _joins.Add(new JoinPair(a.Occ.Ref, a.Col, b.Occ.Ref, b.Col));
        }

        private static bool TryPredicate(JsonElement e, List<Occurrence> scope, out Occurrence? occ, out PushdownPredicate? pred)
        {
            occ = null;
            pred = null;
            if (scope.Count == 0) return false;
            var type = TypeOf(e);
            string[]? colParts = null;
            string? op = null;
            var literals = new List<Literal>();
            switch (type)
            {
                case "COMPARE_EQUAL" or "COMPARE_NOTEQUAL" or "COMPARE_LESSTHAN" or "COMPARE_GREATERTHAN" or "COMPARE_LESSTHANOREQUALTO" or "COMPARE_GREATERTHANOREQUALTO":
                {
                    var l = e.GetProperty("left");
                    var r = e.GetProperty("right");
                    var flipped = false;
                    if (ColumnNames(l) is { } lc && ParseLiteral(r) is { } rl) { colParts = lc; literals.Add(rl); }
                    else if (ColumnNames(r) is { } rc && ParseLiteral(l) is { } ll) { colParts = rc; literals.Add(ll); flipped = true; }
                    else return false;
                    op = type switch
                    {
                        "COMPARE_EQUAL" => PushdownOps.Eq,
                        "COMPARE_NOTEQUAL" => PushdownOps.Ne,
                        "COMPARE_LESSTHAN" => flipped ? PushdownOps.Gt : PushdownOps.Lt,
                        "COMPARE_GREATERTHAN" => flipped ? PushdownOps.Lt : PushdownOps.Gt,
                        "COMPARE_LESSTHANOREQUALTO" => flipped ? PushdownOps.Ge : PushdownOps.Le,
                        _ => flipped ? PushdownOps.Le : PushdownOps.Ge,
                    };
                    break;
                }
                case "COMPARE_IN":
                {
                    var ch = e.GetProperty("children").EnumerateArray().ToList();
                    if (ch.Count < 2 || ColumnNames(ch[0]) is not { } c) return false;
                    foreach (var x in ch.Skip(1))
                    {
                        if (ParseLiteral(x) is not { } lit) return false;
                        literals.Add(lit);
                    }
                    colParts = c;
                    op = PushdownOps.In;
                    break;
                }
                case "COMPARE_BETWEEN":
                {
                    if (ColumnNames(e.GetProperty("input")) is not { } c || ParseLiteral(e.GetProperty("lower")) is not { } lo
                        || ParseLiteral(e.GetProperty("upper")) is not { } hi) return false;
                    colParts = c;
                    literals.Add(lo);
                    literals.Add(hi);
                    op = PushdownOps.Between;
                    break;
                }
                case "OPERATOR_IS_NOT_NULL":
                {
                    var ch = e.GetProperty("children").EnumerateArray().ToList();
                    if (ch.Count != 1 || ColumnNames(ch[0]) is not { } c) return false;
                    colParts = c;
                    op = PushdownOps.IsNotNull;
                    break;
                }
                case "FUNCTION":
                {
                    // LIKE is the function ~~ (column, 'pattern'); NOT LIKE (!~~), ILIKE (~~*) and ESCAPE (like_escape) do not push.
                    if (!e.TryGetProperty("function_name", out var fn) || fn.GetString() != "~~") return false;
                    var ch = e.GetProperty("children").EnumerateArray().ToList();
                    if (ch.Count != 2 || ColumnNames(ch[0]) is not { } c || ParseLiteral(ch[1]) is not { Kind: ColumnKinds.String } pat) return false;
                    colParts = c;
                    literals.Add(pat);
                    op = PushdownOps.Like;
                    break;
                }
                default:
                    return false;
            }

            if (Resolve(colParts!, scope) is not { } hit) return false;
            var values = new List<PushdownLiteral>();
            foreach (var lit in literals)
            {
                if (Compatible(hit.Col.Kind, op!, lit) is not { } v) return false;
                values.Add(v);
            }
            if (op == PushdownOps.Like && values[0].Value.Contains('\\', StringComparison.Ordinal)) return false; // escape rules differ per source
            occ = hit.Occ;
            pred = new PushdownPredicate(hit.Col.Name, op!, values);
            return true;
        }

        // ---- LIMIT

        private static bool HasLimitWithoutOrder(JsonElement node)
        {
            if (!node.TryGetProperty("modifiers", out var mods) || mods.ValueKind != JsonValueKind.Array) return false;
            var hasLimit = false;
            var hasOrder = false;
            foreach (var m in mods.EnumerateArray())
            {
                var t = TypeOf(m);
                if (t is "LIMIT_MODIFIER" && !IsNull(m, "limit")) hasLimit = true;
                if (t is "LIMIT_PERCENT_MODIFIER") hasLimit = true;
                if (t is "ORDER_MODIFIER") hasOrder = true;
            }
            return hasLimit && !hasOrder;
        }

        private static readonly HashSet<string> Aggregates = new(StringComparer.OrdinalIgnoreCase)
        {
            "count", "count_star", "sum", "avg", "mean", "min", "max", "any_value", "first", "last", "list", "array_agg", "string_agg",
            "group_concat", "listagg", "median", "mode", "quantile", "quantile_cont", "quantile_disc", "stddev", "stddev_pop", "stddev_samp",
            "variance", "var_pop", "var_samp", "bool_and", "bool_or", "bit_and", "bit_or", "bit_xor", "arg_max", "arg_min", "argmax",
            "argmin", "max_by", "min_by", "approx_count_distinct", "approx_quantile", "histogram", "entropy", "kurtosis", "skewness",
            "product", "fsum", "favg", "sumkahan", "kahan_sum", "corr", "covar_pop", "covar_samp", "regr_avgx", "regr_avgy",
            "regr_count", "regr_intercept", "regr_r2", "regr_slope", "regr_sxx", "regr_sxy", "regr_syy", "bitstring_agg", "mad",
            "reservoir_quantile", "geomean", "geometric_mean", "count_if", "countif", "every", "some", "json_group_array",
            "json_group_object", "json_group_structure", "unique", "string_split_agg", "arbitrary", "weighted_avg", "wavg", "sem",
        };

        /// <summary>The LIMIT (plus OFFSET) of a single-table query that may push it, else null.</summary>
        private long? SingleTableLimit(JsonElement node)
        {
            if (TypeOf(node) != "SELECT_NODE") return null;
            if (node.TryGetProperty("cte_map", out var cm) && cm.TryGetProperty("map", out var map) && map.GetArrayLength() > 0) return null;
            if (!node.TryGetProperty("modifiers", out var mods) || mods.ValueKind != JsonValueKind.Array) return null;
            long? limit = null;
            long offset = 0;
            foreach (var m in mods.EnumerateArray())
            {
                if (TypeOf(m) != "LIMIT_MODIFIER") return null; // ORDER BY, DISTINCT, LIMIT %
                if (IsNull(m, "limit") || ParseLiteral(m.GetProperty("limit")) is not { Kind: ColumnKinds.Int } l
                    || !long.TryParse(l.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var lv) || lv < 0) return null;
                limit = lv;
                if (!IsNull(m, "offset"))
                {
                    if (ParseLiteral(m.GetProperty("offset")) is not { Kind: ColumnKinds.Int } o
                        || !long.TryParse(o.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out offset) || offset < 0) return null;
                }
            }
            if (limit is null) return null;
            if (!node.TryGetProperty("from_table", out var from) || TypeOf(from) != "BASE_TABLE") return null;
            if (node.TryGetProperty("group_expressions", out var g) && g.ValueKind == JsonValueKind.Array && g.GetArrayLength() > 0) return null;
            if (node.TryGetProperty("group_sets", out var gs) && gs.ValueKind == JsonValueKind.Array && gs.GetArrayLength() > 0) return null;
            if (!IsNull(node, "having") || !IsNull(node, "qualify") || !IsNull(node, "sample")) return null;
            if (node.TryGetProperty("aggregate_handling", out var ah) && ah.GetString() is not (null or "STANDARD_HANDLING")) return null;
            if (node.TryGetProperty("select_list", out var list) && ContainsAggregateWindowOrSubquery(list)) return null;
            if (node.TryGetProperty("where_clause", out var where) && where.ValueKind == JsonValueKind.Object && ContainsAggregateWindowOrSubquery(where)) return null;

            var occ = _all.FirstOrDefault(o => !o.Opaque && Matches(from, o));
            if (occ is null || _all.Count(o => o.Ref.ToString().Equals(occ.Ref.ToString(), StringComparison.OrdinalIgnoreCase)) != 1) return null;
            // Every WHERE conjunct must have become a predicate (the fetcher must apply all of them for the limit to be right).
            var conjuncts = where.ValueKind == JsonValueKind.Object ? Conjuncts(where).Count() : 0;
            if (conjuncts != occ.Predicates.Count) return null;
            _limitOccurrence = occ;
            return checked(limit.Value + offset);
        }

        private bool Matches(JsonElement baseTable, Occurrence o)
        {
            var schema = baseTable.TryGetProperty("schema_name", out var s) ? s.GetString() : null;
            var table = baseTable.GetProperty("table_name").GetString() ?? "";
            return catalog.TryResolve(schema, table, out var r, out _) && r.ToString().Equals(o.Ref.ToString(), StringComparison.OrdinalIgnoreCase);
        }

        private static bool ContainsAggregateWindowOrSubquery(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                {
                    var t = TypeOf(e);
                    if (t is not null && (t.StartsWith("WINDOW_", StringComparison.Ordinal) || t == "SUBQUERY")) return true;
                    if (t == "FUNCTION" && e.TryGetProperty("function_name", out var fn) && fn.GetString() is { } name && Aggregates.Contains(name)) return true;
                    foreach (var p in e.EnumerateObject()) if (ContainsAggregateWindowOrSubquery(p.Value)) return true;
                    return false;
                }
                case JsonValueKind.Array:
                    foreach (var x in e.EnumerateArray()) if (ContainsAggregateWindowOrSubquery(x)) return true;
                    return false;
                default:
                    return false;
            }
        }
    }

    // ------------------------------------------------------------------ literals

    /// <summary>A constant of the query: ColumnKinds token + invariant text (see <see cref="PushdownLiteral"/>).</summary>
    internal sealed record Literal(string Kind, string Value);

    internal static Literal? ParseLiteral(JsonElement e)
    {
        var type = e.ValueKind == JsonValueKind.Object && e.TryGetProperty("type", out var t) ? t.GetString() : null;
        if (type == "VALUE_CONSTANT") return Constant(e.GetProperty("value"));
        if (type == "OPERATOR_CAST")
        {
            if (e.TryGetProperty("try_cast", out var tc) && tc.ValueKind == JsonValueKind.True) return null;
            if (!e.TryGetProperty("child", out var child) || ParseLiteral(child) is not { } inner) return null;
            var target = e.GetProperty("cast_type").GetProperty("id").GetString();
            return CastLiteral(inner, target, e.GetProperty("cast_type"));
        }
        return null;
    }

    private static Literal? Constant(JsonElement v)
    {
        if (v.TryGetProperty("is_null", out var n) && n.ValueKind == JsonValueKind.True) return null;
        var id = v.GetProperty("type").GetProperty("id").GetString();
        var value = v.GetProperty("value");
        switch (id)
        {
            case "INTEGER" or "BIGINT" or "SMALLINT" or "TINYINT" or "UINTEGER" or "UBIGINT" or "USMALLINT" or "UTINYINT":
                return value.ValueKind == JsonValueKind.Number ? new Literal(ColumnKinds.Int, value.GetRawText()) : null;
            case "DECIMAL":
            {
                if (value.ValueKind != JsonValueKind.Number) return null; // 128-bit decimals come as {upper, lower}
                var scale = v.GetProperty("type").GetProperty("type_info").TryGetProperty("scale", out var s) ? s.GetInt32() : 0;
                return BigInteger.TryParse(value.GetRawText(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var unscaled)
                    ? new Literal(ColumnKinds.Decimal, FormatDecimal(unscaled, scale))
                    : null;
            }
            case "DOUBLE" or "FLOAT":
                return value.ValueKind == JsonValueKind.Number && double.TryParse(value.GetRawText(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d)
                       && double.IsFinite(d)
                    ? new Literal(ColumnKinds.Float, d.ToString("R", CultureInfo.InvariantCulture))
                    : null;
            case "VARCHAR":
                return value.ValueKind == JsonValueKind.String ? new Literal(ColumnKinds.String, value.GetString() ?? "") : null;
            case "BOOLEAN":
                return value.ValueKind is JsonValueKind.True or JsonValueKind.False ? new Literal(ColumnKinds.Bool, value.ValueKind == JsonValueKind.True ? "true" : "false") : null;
            default:
                return null;
        }
    }

    internal static string FormatDecimal(BigInteger unscaled, int scale)
    {
        if (scale <= 0) return unscaled.ToString(CultureInfo.InvariantCulture);
        var neg = unscaled.Sign < 0;
        var digits = BigInteger.Abs(unscaled).ToString(CultureInfo.InvariantCulture).PadLeft(scale + 1, '0');
        var text = digits[..^scale] + "." + digits[^scale..];
        return neg ? "-" + text : text;
    }

    private static Literal? CastLiteral(Literal inner, string? target, JsonElement castType)
    {
        var inv = CultureInfo.InvariantCulture;
        switch (target)
        {
            case "DATE":
                return inner.Kind == ColumnKinds.String && DateOnly.TryParseExact(inner.Value.Trim(), ["yyyy-MM-dd", "yyyy-M-d"], inv, DateTimeStyles.None, out var d)
                    ? new Literal(ColumnKinds.Date, d.ToString("yyyy-MM-dd", inv))
                    : null;
            case "TIMESTAMP" or "TIMESTAMP_MS" or "TIMESTAMP_NS" or "TIMESTAMP_S" or "DATETIME":
                return inner.Kind == ColumnKinds.String && ParseTimestamp(inner.Value) is { } ts ? new Literal(ColumnKinds.DateTime, ts) : null;
            case "BOOLEAN":
                return inner.Kind == ColumnKinds.String
                    ? inner.Value.Trim().ToLowerInvariant() switch
                    {
                        "t" or "true" => new Literal(ColumnKinds.Bool, "true"),
                        "f" or "false" => new Literal(ColumnKinds.Bool, "false"),
                        _ => null,
                    }
                    : inner.Kind == ColumnKinds.Bool ? inner : null;
            case "UUID":
                return inner.Kind == ColumnKinds.String && Guid.TryParse(inner.Value, out var g) ? new Literal(ColumnKinds.Guid, g.ToString("D")) : null;
            case "DOUBLE" or "FLOAT":
                return inner.Kind is ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.Float
                       && double.TryParse(inner.Value, NumberStyles.Float, inv, out var dv)
                    ? new Literal(ColumnKinds.Float, dv.ToString("R", inv))
                    : null;
            case "INTEGER" or "BIGINT" or "SMALLINT" or "TINYINT":
                return inner.Kind is ColumnKinds.Int || (inner.Kind == ColumnKinds.String && long.TryParse(inner.Value.Trim(), NumberStyles.Integer, inv, out _))
                    ? new Literal(ColumnKinds.Int, inner.Value.Trim())
                    : null;
            case "DECIMAL":
            {
                if (inner.Kind is not (ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.String)) return null;
                if (!decimal.TryParse(inner.Value.Trim(), NumberStyles.Float, inv, out var m)) return null;
                var scale = castType.TryGetProperty("type_info", out var ti) && ti.ValueKind == JsonValueKind.Object && ti.TryGetProperty("scale", out var s) ? s.GetInt32() : 3;
                return new Literal(ColumnKinds.Decimal, Math.Round(m, Math.Min(scale, 28), MidpointRounding.ToEven).ToString(inv));
            }
            case "VARCHAR":
                return inner.Kind == ColumnKinds.String ? inner : null;
            default:
                return null;
        }
    }

    /// <summary>"yyyy-MM-ddTHH:mm:ss[.fffffff]" of a timestamp text, or null.</summary>
    internal static string? ParseTimestamp(string text)
    {
        var inv = CultureInfo.InvariantCulture;
        string[] formats = ["yyyy-MM-dd HH:mm:ss.FFFFFFF", "yyyy-MM-ddTHH:mm:ss.FFFFFFF", "yyyy-MM-dd HH:mm", "yyyy-MM-ddTHH:mm", "yyyy-MM-dd"];
        return DateTime.TryParseExact(text.Trim(), formats, inv, DateTimeStyles.None, out var dt) ? dt.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF", inv) : null;
    }

    /// <summary>
    /// The pushed literal of <paramref name="lit"/> for a column of <paramref name="columnKind"/> and <paramref name="op"/>,
    /// or null when the comparison must not push (plan-links: never fewer rows than the engine would keep).
    /// </summary>
    internal static PushdownLiteral? Compatible(string columnKind, string op, Literal lit)
    {
        var numeric = lit.Kind is ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.Float;
        switch (columnKind)
        {
            case ColumnKinds.Int or ColumnKinds.Decimal or ColumnKinds.Float:
                return numeric && op != PushdownOps.Like ? new PushdownLiteral(lit.Kind, lit.Value) : null;
            case ColumnKinds.String:
                // = / IN / LIKE only: case-insensitive or padding collations give a superset (the engine filters), while
                // <> and ranges could drop rows DuckDB's binary comparison keeps.
                return lit.Kind == ColumnKinds.String && op is PushdownOps.Eq or PushdownOps.In or PushdownOps.Like
                    ? new PushdownLiteral(ColumnKinds.String, lit.Value)
                    : null;
            case ColumnKinds.Bool:
                return lit.Kind == ColumnKinds.Bool && op is PushdownOps.Eq ? new PushdownLiteral(ColumnKinds.Bool, lit.Value) : null;
            case ColumnKinds.Date:
            {
                if (op is PushdownOps.Like or PushdownOps.Ne) return null;
                if (lit.Kind == ColumnKinds.Date) return new PushdownLiteral(ColumnKinds.Date, lit.Value);
                if (lit.Kind == ColumnKinds.DateTime) return new PushdownLiteral(ColumnKinds.DateTime, lit.Value);
                if (lit.Kind == ColumnKinds.String && DateOnly.TryParseExact(lit.Value.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d))
                    return new PushdownLiteral(ColumnKinds.Date, d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
                return null;
            }
            case ColumnKinds.DateTime:
            {
                if (op is PushdownOps.Like or PushdownOps.Ne) return null;
                if (lit.Kind == ColumnKinds.DateTime) return new PushdownLiteral(ColumnKinds.DateTime, lit.Value);
                if (lit.Kind is ColumnKinds.Date or ColumnKinds.String && ParseTimestamp(lit.Value) is { } ts) return new PushdownLiteral(ColumnKinds.DateTime, ts);
                return null;
            }
            case ColumnKinds.Guid:
                return op is PushdownOps.Eq or PushdownOps.In && lit.Kind is ColumnKinds.Guid or ColumnKinds.String && Guid.TryParse(lit.Value, out var g)
                    ? new PushdownLiteral(ColumnKinds.Guid, g.ToString("D"))
                    : null;
            default:
                return null;
        }
    }
}
