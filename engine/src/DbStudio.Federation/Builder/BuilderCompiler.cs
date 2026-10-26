using System.Text;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Builder;

/// <summary>Column of a mounted table as the builder compilers see it (golden catalogs: <c>{name, kind, type}</c>).</summary>
public sealed record BuilderCatalogColumn(string Name, string Kind, string? Type = null);

/// <summary>Columns of the mounted tables keyed <c>"alias.table"</c> (case-insensitive); kinds drive the filter SQL.</summary>
public sealed class BuilderCatalog(IReadOnlyDictionary<string, IReadOnlyList<BuilderCatalogColumn>> tables)
{
    private readonly Dictionary<string, IReadOnlyList<BuilderCatalogColumn>> _tables = new(tables, StringComparer.OrdinalIgnoreCase);

    public static BuilderCatalog Empty { get; } = new(new Dictionary<string, IReadOnlyList<BuilderCatalogColumn>>());

    public IReadOnlyList<BuilderCatalogColumn>? Columns(string alias, string table) => _tables.GetValueOrDefault(alias + "." + table);

    /// <summary>The catalog's spelling of <c>alias.table</c>; an empty alias finds the table when exactly one member mounts it.</summary>
    public (string Alias, string Table)? Resolve(string alias, string table)
    {
        IEnumerable<string> keys = _tables.Keys;
        var hits = alias.Length > 0
            ? keys.Where(k => string.Equals(k, alias + "." + table, StringComparison.OrdinalIgnoreCase)).ToList()
            : keys.Where(k => k.Length > table.Length && string.Equals(k[(k.IndexOf('.') + 1)..], table, StringComparison.OrdinalIgnoreCase)).ToList();
        if (hits.Count != 1) return null;
        var dot = hits[0].IndexOf('.');
        return (hits[0][..dot], hits[0][(dot + 1)..]);
    }

    /// <summary>The catalog's spelling of a column (exact, then case-insensitive), or null.</summary>
    public string? Column(string alias, string table, string column)
    {
        var cols = Columns(alias, table);
        return cols?.FirstOrDefault(c => c.Name == column)?.Name ?? cols?.FirstOrDefault(c => string.Equals(c.Name, column, StringComparison.OrdinalIgnoreCase))?.Name;
    }

    public string? Kind(string alias, string table, string column)
    {
        var cols = Columns(alias, table);
        return cols?.FirstOrDefault(c => c.Name == column)?.Kind ?? cols?.FirstOrDefault(c => string.Equals(c.Name, column, StringComparison.OrdinalIgnoreCase))?.Kind;
    }

    /// <summary>The catalog of a link (every member's mounted tables).</summary>
    public static BuilderCatalog From(LinkCatalog catalog)
    {
        var d = new Dictionary<string, IReadOnlyList<BuilderCatalogColumn>>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in catalog.Schemas)
            foreach (var t in s.Tables)
                d[s.Alias + "." + t.LinkName] = t.Columns.Select(c => new BuilderCatalogColumn(c.Name, c.Kind, c.SourceType)).ToList();
        return new BuilderCatalog(d);
    }
}

/// <summary>
/// BuilderModel → the canonical DuckDB SQL of Contracts/BuilderModel.cs (byte-identical to the UI's builder/compile.ts,
/// checked by the shared goldens). Rules beyond the header (agreed in docs/wp-notes/links/WP-B.md, section "Compiler"):
/// <list type="bullet">
/// <item>item = <c>expr</c> or <c>as.column</c>, wrapped by the aggregate (<c>count(*)</c> when count has neither); <c> AS alias</c> whenever an alias is set; Output=false columns are left out.</item>
/// <item>A join with no condition (not cross) gets <c>ON TRUE</c> and the cartesian warning; tables no join reaches follow as CROSS JOIN, in table order, each with a cartesian warning.</item>
/// <item>Auto group: every Output column without an aggregate, by its expression, when any Output column has one.</item>
/// <item>Refs (group/sort): column id → (sort only: the alias of an Output column when it has one, else) its expression; table column → <c>as.column</c>; expr verbatim.</item>
/// <item>ORDER BY always writes ASC/DESC; NULLS FIRST/LAST when set. OFFSET without LIMIT is a line of its own.</item>
/// <item>WHERE columns: every catalog column of every table, named <c>tableId.column</c>; HAVING columns: the columns' ids, kind int for count, float for avg, the source kind for sum/min/max and plain columns, other for expressions.</item>
/// <item>Warnings (codes): cartesian, limitWithoutOrder, joinKinds (join columns of different kind classes), filter (filter/sql.ts warnings).</item>
/// </list>
/// Structural errors (unknown table ids, a join attaching a table twice …) are 400 VALIDATION.
/// </summary>
public static class BuilderCompiler
{
    public const string FilterWarning = "filter";

    public static CompileResult Compile(BuilderModel model, BuilderCatalog catalog, DateTime? now = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (model.Tables.Count == 0) throw EngineException.Validation("The query has no table.", new { field = "tables" });
        var tables = new Dictionary<string, BuilderTable>(StringComparer.Ordinal);
        var asNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var t in model.Tables)
        {
            if (string.IsNullOrEmpty(t.Id) || !tables.TryAdd(t.Id, t))
                throw EngineException.Validation($"Table id '{t.Id}' is empty or used twice.", new { field = "tables" });
            if (string.IsNullOrEmpty(t.Alias) || string.IsNullOrEmpty(t.Table) || string.IsNullOrEmpty(t.As))
                throw EngineException.Validation($"Table '{t.Id}' needs an alias, a table and an SQL alias.", new { field = "tables" });
            if (!asNames.Add(t.As)) throw EngineException.Validation($"The SQL alias '{t.As}' is used twice.", new { field = "tables" });
        }
        BuilderTable Table(string? id, string field) =>
            id is not null && tables.TryGetValue(id, out var t) ? t : throw EngineException.Validation($"Unknown table id '{id}'.", new { field });
        string ColRef(BuilderTable t, string column) => LinkSql.QuoteIdent(t.As) + "." + LinkSql.QuoteIdent(column);
        string? KindOf(BuilderTable t, string column) =>
            catalog.Columns(t.Alias, t.Table)?.FirstOrDefault(c => c.Name == column)?.Kind
            ?? catalog.Columns(t.Alias, t.Table)?.FirstOrDefault(c => string.Equals(c.Name, column, StringComparison.OrdinalIgnoreCase))?.Kind;

        var warnings = new List<PlanWarning>();
        var sb = new StringBuilder();

        // ---- SELECT
        var columns = new Dictionary<string, BuilderColumn>(StringComparer.Ordinal);
        foreach (var c in model.Columns)
        {
            if (string.IsNullOrEmpty(c.Id) || !columns.TryAdd(c.Id, c))
                throw EngineException.Validation($"Column id '{c.Id}' is empty or used twice.", new { field = "columns" });
            if (c.Agg is not null && !BuilderAggregates.All.Contains(c.Agg))
                throw EngineException.Validation($"Unknown aggregate '{c.Agg}'.", new { field = "columns" });
            if (string.IsNullOrWhiteSpace(c.Expr) && c.Column is not null) Table(c.TableId, "columns");
        }
        string BaseExpr(BuilderColumn c) =>
            !string.IsNullOrWhiteSpace(c.Expr) ? c.Expr!.Trim()
            : c.Column is not null ? ColRef(Table(c.TableId, "columns"), c.Column)
            : "*";
        string ColumnExpr(BuilderColumn c)
        {
            var e = BaseExpr(c);
            return c.Agg switch
            {
                null => e == "*" ? throw EngineException.Validation($"Column '{c.Id}' has no column or expression.", new { field = "columns" }) : e,
                BuilderAggregates.Count => $"count({e})",
                BuilderAggregates.CountDistinct => e == "*" ? throw EngineException.Validation("count distinct needs a column.", new { field = "columns" }) : $"count(DISTINCT {e})",
                _ => e == "*" ? throw EngineException.Validation($"{c.Agg} needs a column.", new { field = "columns" }) : $"{c.Agg}({e})",
            };
        }
        var output = model.Columns.Where(c => c.Output).ToList();
        sb.Append("SELECT ");
        if (model.Distinct) sb.Append("DISTINCT ");
        sb.Append(output.Count == 0
            ? "*"
            : string.Join(", ", output.Select(c => ColumnExpr(c) + (string.IsNullOrEmpty(c.Alias) ? "" : " AS " + LinkSql.QuoteIdent(c.Alias)))));

        // ---- FROM / JOIN
        var first = model.Tables[0];
        sb.Append("\nFROM ").Append(LinkSql.Qualified(first.Alias, first.Table)).Append(" AS ").Append(LinkSql.QuoteIdent(first.As));
        var attached = new HashSet<string>(StringComparer.Ordinal) { first.Id };
        foreach (var j in model.Joins)
        {
            var type = string.IsNullOrEmpty(j.Type) ? BuilderJoinTypes.Inner : j.Type;
            if (!BuilderJoinTypes.All.Contains(type)) throw EngineException.Validation($"Unknown join type '{j.Type}'.", new { field = "joins" });
            var left = Table(j.Left, "joins");
            var right = Table(j.Right, "joins");
            if (!attached.Contains(left.Id))
                throw EngineException.Validation($"Join '{j.Id}' starts from table '{left.Id}', which is not in the FROM clause yet.", new { field = "joins" });
            if (!attached.Add(right.Id))
                throw EngineException.Validation($"Join '{j.Id}' attaches table '{right.Id}' a second time.", new { field = "joins" });
            sb.Append('\n').Append(type.ToUpperInvariant()).Append(" JOIN ").Append(LinkSql.Qualified(right.Alias, right.Table))
                .Append(" AS ").Append(LinkSql.QuoteIdent(right.As));
            if (type == BuilderJoinTypes.Cross) continue;
            if (j.On.Count == 0)
            {
                sb.Append(" ON TRUE");
                warnings.Add(new PlanWarning(PlanWarningCodes.Cartesian, $"The join of {right.As} has no condition: every row pairs with every row.", new LinkTableRef(right.Alias, right.Table)));
                continue;
            }
            var conds = new List<string>();
            foreach (var on in j.On)
            {
                var op = string.IsNullOrEmpty(on.Op) ? "=" : on.Op;
                if (op is not ("=" or "<>" or "<" or ">" or "<=" or ">="))
                    throw EngineException.Validation($"Unknown join operator '{on.Op}'.", new { field = "joins" });
                conds.Add(JoinSide(ColRef(left, on.LeftColumn), on) + " " + op + " " + JoinSide(ColRef(right, on.RightColumn), on));
                var lk = KindOf(left, on.LeftColumn);
                var rk = KindOf(right, on.RightColumn);
                if (lk is not null && rk is not null && FilterValues.KindClass(lk) != FilterValues.KindClass(rk))
                    warnings.Add(new PlanWarning(PlanWarningCodes.JoinKinds,
                        $"{left.As}.{on.LeftColumn} ({lk}) is compared with {right.As}.{on.RightColumn} ({rk}).", new LinkTableRef(right.Alias, right.Table)));
            }
            sb.Append(" ON ").Append(string.Join(" AND ", conds));
        }
        foreach (var t in model.Tables)
        {
            if (attached.Contains(t.Id)) continue;
            attached.Add(t.Id);
            sb.Append("\nCROSS JOIN ").Append(LinkSql.Qualified(t.Alias, t.Table)).Append(" AS ").Append(LinkSql.QuoteIdent(t.As));
            warnings.Add(new PlanWarning(PlanWarningCodes.Cartesian, $"No join reaches {t.As}: every row pairs with every row.", new LinkTableRef(t.Alias, t.Table)));
        }

        // ---- WHERE
        var pb = new FilterParams();
        var whereColumns = new List<FilterColumn>();
        foreach (var t in model.Tables)
            foreach (var c in catalog.Columns(t.Alias, t.Table) ?? [])
                whereColumns.Add(new FilterColumn(BuilderRefs.ColumnKey(t.Id, c.Name), c.Kind, ColRef(t, c.Name)));
        var where = new FilterSql(whereColumns, pb, now);
        var whereSql = where.Build(model.Filter);
        if (whereSql is not null) sb.Append("\nWHERE ").Append(whereSql);

        // ---- GROUP BY
        string RefExpr(BuilderRef r, bool sort, string field)
        {
            if (!string.IsNullOrEmpty(r.ColumnId))
            {
                if (!columns.TryGetValue(r.ColumnId, out var c)) throw EngineException.Validation($"Unknown column id '{r.ColumnId}'.", new { field });
                return sort && c.Output && !string.IsNullOrEmpty(c.Alias) ? LinkSql.QuoteIdent(c.Alias) : ColumnExpr(c);
            }
            if (!string.IsNullOrEmpty(r.Column)) return ColRef(Table(r.TableId, field), r.Column);
            if (!string.IsNullOrWhiteSpace(r.Expr)) return r.Expr.Trim();
            throw EngineException.Validation("A reference names no column or expression.", new { field });
        }
        List<string> groupBy = model.AutoGroup
            ? output.Any(c => c.Agg is not null) ? output.Where(c => c.Agg is null).Select(ColumnExpr).ToList() : []
            : model.GroupBy.Select(r => RefExpr(r, false, "groupBy")).ToList();
        if (groupBy.Count > 0) sb.Append("\nGROUP BY ").Append(string.Join(", ", groupBy));

        // ---- HAVING
        var havingColumns = model.Columns.Select(c => new FilterColumn(c.Id, HavingKind(c, KindOf, Table), ColumnExpr(c))).ToList();
        var having = new FilterSql(havingColumns, pb, now);
        var havingSql = having.Build(model.Having);
        if (havingSql is not null) sb.Append("\nHAVING ").Append(havingSql);

        // ---- ORDER BY
        if (model.Sort.Count > 0)
        {
            var items = model.Sort.Select(s =>
            {
                var dir = (s.Dir ?? "asc").ToLowerInvariant();
                if (dir is not ("asc" or "desc")) throw EngineException.Validation($"Unknown sort direction '{s.Dir}'.", new { field = "sort" });
                var nulls = s.Nulls?.ToLowerInvariant();
                if (nulls is not (null or "first" or "last")) throw EngineException.Validation($"Unknown NULLS position '{s.Nulls}'.", new { field = "sort" });
                return RefExpr(s.Ref, true, "sort") + " " + dir.ToUpperInvariant() + (nulls is null ? "" : " NULLS " + nulls.ToUpperInvariant());
            });
            sb.Append("\nORDER BY ").Append(string.Join(", ", items));
        }

        // ---- LIMIT / OFFSET
        if (model.Limit is < 0 || model.Offset is < 0) throw EngineException.Validation("limit and offset must be >= 0.", new { field = "limit" });
        if (model.Limit is { } limit)
        {
            sb.Append("\nLIMIT ").Append(limit.ToString(System.Globalization.CultureInfo.InvariantCulture));
            if (model.Offset is { } off) sb.Append(" OFFSET ").Append(off.ToString(System.Globalization.CultureInfo.InvariantCulture));
            if (model.Sort.Count == 0)
                warnings.Add(new PlanWarning(PlanWarningCodes.LimitWithoutOrder, "LIMIT without ORDER BY: which rows come back is arbitrary."));
        }
        else if (model.Offset is { } offOnly) sb.Append("\nOFFSET ").Append(offOnly.ToString(System.Globalization.CultureInfo.InvariantCulture));

        foreach (var w in where.Warnings.Concat(having.Warnings)) warnings.Add(new PlanWarning(FilterWarning, w));
        return new CompileResult(sb.ToString(), pb.Params, warnings);
    }

    private static string JoinSide(string expr, BuilderJoinCondition on) =>
        (on.IgnoreCase, on.Trim) switch
        {
            (true, true) => $"lower(trim({expr}))",
            (true, false) => $"lower({expr})",
            (false, true) => $"trim({expr})",
            _ => expr,
        };

    private static string HavingKind(BuilderColumn c, Func<BuilderTable, string, string?> kindOf, Func<string?, string, BuilderTable> table)
    {
        if (c.Agg is BuilderAggregates.Count or BuilderAggregates.CountDistinct) return ColumnKinds.Int;
        if (c.Agg == BuilderAggregates.Avg) return ColumnKinds.Float;
        if (!string.IsNullOrWhiteSpace(c.Expr) || c.Column is null) return ColumnKinds.Other;
        return kindOf(table(c.TableId, "columns"), c.Column) ?? ColumnKinds.Other;
    }
}
