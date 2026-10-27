using System.Text.RegularExpressions;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Services;

namespace DbStudio.Core.SchemaCompare;

internal sealed record BuiltScript(List<ScriptStatement> Statements, List<ItemWarning> Warnings, bool TransactionalDdl, int ItemCount);

/// <summary>
/// Turns the selected items of a comparison into one ordered script for the target. Order: drop triggers, drop views / routines,
/// drop foreign keys, drop tables, create types and sequences, alter tables, create tables, add foreign keys, create views /
/// routines / packages in dependency order, create triggers, drop the sequences and types that are gone. Tables go through the
/// provider's own <see cref="IDdlScripter"/> (the table designer's scripts), with the foreign keys split off so that cycles and
/// create-before-reference order never matter.
/// </summary>
internal sealed partial class ScriptBuilder
{
    private readonly ComparisonModel _m;
    private readonly Dialect _d;
    private readonly IDdlScripter _scripter;
    private readonly List<ScriptStatement> _out = [];
    private readonly List<ItemWarning> _warnings = [];
    private readonly CancellationToken _ct;

    private ScriptBuilder(ComparisonModel m, CancellationToken ct)
    {
        _m = m;
        _d = m.Dialect;
        _scripter = m.Target.Scripter;
        _ct = ct;
    }

    public static async Task<BuiltScript> BuildAsync(ComparisonModel m, IReadOnlyCollection<string>? itemIds, CancellationToken ct)
    {
        var b = new ScriptBuilder(m, ct);
        var selected = m.Items.Where(i => i.Status != CompareStatus.Identical
                                          && (itemIds is null || itemIds.Contains(i.Id, StringComparer.OrdinalIgnoreCase))).ToList();
        await b.RunAsync(selected).ConfigureAwait(false);
        var ctx = await m.ContextAsync(null, ct).ConfigureAwait(false);
        var transactional = m.Target.Scripter.GetTypes(ctx).Features.TransactionalDdl;
        return new BuiltScript(b._out, b._warnings, transactional, selected.Count);
    }

    // ------------------------------------------------------------------ helpers

    private void Add(ItemRec item, string sql, string kind, string? warning = null)
    {
        _out.Add(new ScriptStatement(sql, kind, item.Id, warning));
        if (!string.IsNullOrWhiteSpace(warning)) Warn(item, "warning", warning);
    }

    private void Warn(ItemRec item, string severity, string message)
    {
        if (_warnings.Any(w => w.ItemId == item.Id && w.Message == message)) return;
        _warnings.Add(new ItemWarning(item.Id, severity, message));
    }

    private bool _needForeignKeyCheck;

    /// <summary>"type:name" of the views / triggers this script drops or recreates itself: a SQLite table rebuild must not recreate them.</summary>
    private HashSet<string> _handledDependents = new(StringComparer.OrdinalIgnoreCase);

    private void AddScript(ItemRec item, TableScript script)
    {
        foreach (var st in script.Statements)
        {
            if (IsSqlite && st.Kind == DdlKinds.Pragma)
            {
                // one foreign_keys switch around the whole script (see RunAsync), one check at the end
                if (st.Sql.Contains("foreign_key_check", StringComparison.OrdinalIgnoreCase)) _needForeignKeyCheck = true;
                continue;
            }
            Add(item, st.Sql, st.Kind, st.Warning);
        }
        foreach (var w in script.Warnings) Warn(item, "warning", w);
    }

    private void AddScript(ItemRec item, DdlScript script)
    {
        foreach (var st in script.Statements) Add(item, st.Sql, st.Kind, st.Warning);
        foreach (var w in script.Warnings) Warn(item, "warning", w);
    }

    private async Task<TableScript> TableScriptAsync(TableModel? original, TableModel desired, string table)
    {
        var ctx = await _m.ContextAsync(table, _ct).ConfigureAwait(false);
        if (ctx.Dependents is { Count: > 0 } dependents && _handledDependents.Count > 0)
            ctx = ctx with { Dependents = dependents.Where(x => !_handledDependents.Contains(x.Type + ":" + x.Name)).ToList() };
        try
        {
            return _scripter.ScriptTable(original, desired, ctx);
        }
        catch (ArgumentException ex)
        {
            throw EngineException.Validation($"Table {table}: {ex.Message}", new { field = "items" });
        }
    }

    private static TableModel WithFks(TableModel t, IEnumerable<ForeignKeyModel> fks) => t with { ForeignKeys = fks.ToList() };

    private bool IsSqlite => _d == Dialect.Sqlite;

    // ------------------------------------------------------------------ run

    private async Task RunAsync(List<ItemRec> selected)
    {
        var tables = selected.Where(i => i.Kind == CompareKinds.Table).ToList();
        var droppedTables = tables.Where(t => t.Status == CompareStatus.Drop).ToList();
        var alteredTables = tables.Where(t => t.Status == CompareStatus.Alter).ToList();
        var createdTables = tables.Where(t => t.Status == CompareStatus.Create).ToList();
        var ctx = await _m.ContextAsync(null, _ct).ConfigureAwait(false);

        var views = selected.Where(i => i.Kind == CompareKinds.View).ToList();
        var routines = selected.Where(i => i.Kind is CompareKinds.Func or CompareKinds.Proc or CompareKinds.Package).ToList();
        var triggers = selected.Where(i => i.Kind == CompareKinds.Trigger).ToList();
        var sequences = selected.Where(i => i.Kind == CompareKinds.Sequence).ToList();
        var types = selected.Where(i => i.Kind == CompareKinds.Type).ToList();

        var viewsToRecreate = ViewsToRecreate(views, selected);
        _handledDependents = selected.Where(i => i.Kind is CompareKinds.View or CompareKinds.Trigger && i.Status is CompareStatus.Drop or CompareStatus.Alter)
            .Select(i => i.Kind + ":" + i.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

        // 1. triggers that go away or are rebuilt
        foreach (var t in triggers.Where(t => t.Status == CompareStatus.Drop || (t.Status == CompareStatus.Alter && !CanReplace(t, ctx))))
            Add(t, CompareDialect.Drop(_d, _m.TargetSchema, t.Tgt!, t.Kind), DdlKinds.Drop);

        // 2. views and routines that go away, views that are rebuilt (dependents first)
        var recreate = _m.Items.Where(i => viewsToRecreate.Contains(i.Id)).ToList();
        var drops = views.Where(v => v.Status == CompareStatus.Drop).Concat(recreate).Distinct().Select(v => (Item: v, Obj: v.Tgt!))
            .Concat(routines.Where(r => r.Status == CompareStatus.Drop).Select(r => (Item: r, Obj: r.Tgt!))).ToList();
        foreach (var (item, obj) in OrderByDependencies(drops, x => x.Obj.Ddl, x => x.Obj.Name, dependentsFirst: true))
            Add(item, CompareDialect.Drop(_d, _m.TargetSchema, obj, item.Kind), DdlKinds.Drop);

        // 3. foreign keys that go away (own, of dropped tables, and keys of surviving tables that point to a dropped table)
        var droppedFks = new HashSet<ForeignKeyModel>();
        if (!IsSqlite)
        {
            foreach (var t in alteredTables.Where(t => t.FkDrop.Count > 0))
            {
                var tgt = t.TgtTable!;
                await AddFkDropsAsync(t, tgt, t.FkDrop, droppedFks).ConfigureAwait(false);
            }
            foreach (var t in droppedTables.Where(t => t.TgtTable!.ForeignKeys.Count > 0))
                await AddFkDropsAsync(t, t.TgtTable!, t.TgtTable!.ForeignKeys, droppedFks).ConfigureAwait(false);
            var dropNames = droppedTables.Select(t => t.TgtTable!.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var other in _m.Items.Where(i => i.TgtTable is not null && i.Status != CompareStatus.Drop && !droppedTables.Contains(i)))
            {
                var inbound = other.TgtTable!.ForeignKeys.Where(f => dropNames.Contains(f.RefTable) && !droppedFks.Contains(f)).ToList();
                if (inbound.Count == 0) continue;
                await AddFkDropsAsync(other, other.TgtTable!, inbound, droppedFks, "it points to a table that is dropped").ConfigureAwait(false);
            }
        }

        // 4. SQLite: the drops of tables happen with the other table work below; others drop tables here
        if (IsSqlite && (droppedTables.Count > 0 || alteredTables.Count > 0))
            _out.Add(new ScriptStatement("PRAGMA foreign_keys = OFF", DdlKinds.Pragma, null, null));
        if (!IsSqlite)
            foreach (var t in droppedTables.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase))
                AddDropTable(t);

        // 5. types and sequences that are created or changed
        foreach (var ty in types.Where(t => t.Status == CompareStatus.Create))
            Add(ty, Prep(ty.CreateDdl!, ty), DdlKinds.Create);
        foreach (var ty in types.Where(t => t.Status == CompareStatus.Alter))
            Warn(ty, "warning", $"Type {ty.Name} differs; types are not altered automatically — change it by hand.");
        foreach (var sq in sequences.Where(s => s.Status == CompareStatus.Create))
            Add(sq, Prep(sq.CreateDdl!, sq), DdlKinds.Create);
        foreach (var sq in sequences.Where(s => s.Status == CompareStatus.Alter))
            AddSequenceAlter(sq);

        // 6. tables
        if (IsSqlite)
        {
            foreach (var t in OrderTablesByForeignKeys(createdTables))
            {
                var script = await TableScriptAsync(null, t.SrcTable!, t.Name).ConfigureAwait(false);
                AddScript(t, script);
            }
            foreach (var t in alteredTables)
                AddScript(t, await TableScriptAsync(t.TgtTable, t.SrcTable!, t.Name).ConfigureAwait(false));
            foreach (var t in droppedTables.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)) AddDropTable(t);
        }
        else
        {
            foreach (var t in alteredTables)
            {
                var tgtNoFk = WithFks(t.TgtTable!, t.TgtTable!.ForeignKeys.Where(f => !t.FkDrop.Contains(f)));
                var srcNoFk = WithFks(t.SrcTable!, t.SrcTable!.ForeignKeys.Where(f => !t.FkAdd.Contains(f)));
                var script = await TableScriptAsync(tgtNoFk, srcNoFk, t.Name).ConfigureAwait(false);
                AddScript(t, script);
            }
            foreach (var t in createdTables.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase))
            {
                var script = await TableScriptAsync(null, WithFks(t.SrcTable!, []), t.Name).ConfigureAwait(false);
                AddScript(t, script);
            }
            // 7. foreign keys that are added
            foreach (var t in alteredTables.Where(t => t.FkAdd.Count > 0))
            {
                var without = WithFks(t.SrcTable!, t.SrcTable!.ForeignKeys.Where(f => !t.FkAdd.Contains(f)));
                var with = WithFks(t.SrcTable!, t.SrcTable!.ForeignKeys);
                AddScript(t, await TableScriptAsync(without, with, t.Name).ConfigureAwait(false));
            }
            foreach (var t in createdTables.Where(t => t.SrcTable!.ForeignKeys.Count > 0).OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase))
            {
                AddScript(t, await TableScriptAsync(WithFks(t.SrcTable!, []), t.SrcTable!, t.Name).ConfigureAwait(false));
            }
        }
        if (IsSqlite && (droppedTables.Count > 0 || alteredTables.Count > 0))
        {
            if (_needForeignKeyCheck) _out.Add(new ScriptStatement("PRAGMA foreign_key_check", DdlKinds.Pragma, null, null));
            _out.Add(new ScriptStatement("PRAGMA foreign_keys = ON", DdlKinds.Pragma, null, null));
        }

        // 8. views and routines (created, changed), in dependency order, then triggers
        var nodes = new List<(ItemRec Item, ItemRec Ref)>();
        foreach (var v in views.Where(v => v.Status is CompareStatus.Create or CompareStatus.Alter).Concat(recreate).Distinct()) nodes.Add((v, v));
        foreach (var r in routines.Where(r => r.Status is CompareStatus.Create or CompareStatus.Alter)) nodes.Add((r, r));
        foreach (var (item, _) in OrderByDependencies(nodes, x => x.Item.CreateDdl ?? "", x => x.Item.Src!.Name, dependentsFirst: false))
        {
            if (item.Kind == CompareKinds.View) AddView(item, viewsToRecreate.Contains(item.Id), ctx);
            else AddRoutine(item, ctx);
        }
        foreach (var t in triggers.Where(t => t.Status is CompareStatus.Create or CompareStatus.Alter).OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase))
            AddRoutine(t, ctx);

        // 9. sequences and types that are gone
        foreach (var sq in sequences.Where(s => s.Status == CompareStatus.Drop))
            Add(sq, CompareDialect.Drop(_d, _m.TargetSchema, sq.Tgt!, sq.Kind), DdlKinds.Drop);
        foreach (var ty in types.Where(t => t.Status == CompareStatus.Drop))
            Add(ty, CompareDialect.Drop(_d, _m.TargetSchema, ty.Tgt!, ty.Kind), DdlKinds.Drop);

        // item warnings found while comparing travel with the script
        foreach (var item in selected)
            foreach (var w in item.Warnings) Warn(item, w.Severity, w.Message);
    }

    // ------------------------------------------------------------------ tables

    private async Task AddFkDropsAsync(ItemRec item, TableModel tgt, IEnumerable<ForeignKeyModel> fks, HashSet<ForeignKeyModel> done, string? why = null)
    {
        var list = fks.Where(f => !done.Contains(f)).ToList();
        if (list.Count == 0) return;
        var script = await TableScriptAsync(tgt, WithFks(tgt, tgt.ForeignKeys.Where(f => !list.Contains(f))), tgt.Name).ConfigureAwait(false);
        AddScript(item, script);
        foreach (var f in list) done.Add(f);
        if (why is not null)
            Warn(item, "info", $"{tgt.Name}: {string.Join(", ", list.Select(f => f.Name ?? f.RefTable))} dropped because {why}.");
    }

    private void AddDropTable(ItemRec t)
    {
        Add(t, CompareDialect.DropTable(_d, _m.TargetSchema, t.TgtTable!.Name), DdlKinds.Drop,
            $"Dropping table {t.TgtTable.Name} deletes all of its rows.");
    }

    /// <summary>SQLite: tables created in foreign-key order (referenced first); cycles keep the name order.</summary>
    private static List<ItemRec> OrderTablesByForeignKeys(List<ItemRec> created)
    {
        var byName = created.ToDictionary(t => t.SrcTable!.Name, StringComparer.OrdinalIgnoreCase);
        var result = new List<ItemRec>();
        var state = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        void Visit(ItemRec t)
        {
            if (state.TryGetValue(t.SrcTable!.Name, out var st) && st != 0) return;
            state[t.SrcTable.Name] = 1;
            foreach (var f in t.SrcTable.ForeignKeys)
                if (!f.RefTable.Equals(t.SrcTable.Name, StringComparison.OrdinalIgnoreCase) && byName.TryGetValue(f.RefTable, out var dep)) Visit(dep);
            state[t.SrcTable.Name] = 2;
            result.Add(t);
        }
        foreach (var t in created.OrderBy(t => t.Name, StringComparer.OrdinalIgnoreCase)) Visit(t);
        return result;
    }

    // ------------------------------------------------------------------ views

    private static bool ColumnsCompatible(IReadOnlyList<CatalogColumn>? target, IReadOnlyList<CatalogColumn>? source)
    {
        if (target is null || source is null) return true;
        if (source.Count < target.Count) return false;
        for (var i = 0; i < target.Count; i++)
            if (!target[i].Name.Equals(source[i].Name, StringComparison.OrdinalIgnoreCase)
                || !TableDiff.SameType(target[i].TypeText, source[i].TypeText)) return false;
        return true;
    }

    /// <summary>
    /// PostgreSQL cannot CREATE OR REPLACE a view that loses or retypes columns and refuses to drop or retype a column that a view
    /// uses: such views (and the views built on them) are dropped before the table changes and created again afterwards.
    /// </summary>
    private HashSet<string> ViewsToRecreate(List<ItemRec> views, List<ItemRec> selected)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (_d != Dialect.PgSql) return set;
        var broken = selected.Where(t => t.Kind == CompareKinds.Table && (t.Status == CompareStatus.Drop
                || (t.Diff is { } diff && (diff.Dropped.Count > 0 || diff.Matched.Any(m => m.TypeChanged || m.ComputedChanged)))))
            .Select(t => t.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var v in views.Where(v => v.Status == CompareStatus.Alter))
        {
            var refs = CompareSql.ReferencedNames(v.Tgt!.Ddl, _d);
            if (!ColumnsCompatible(v.Tgt.Columns, v.Src!.Columns) || broken.Any(refs.Contains)) set.Add(v.Id);
        }
        // views of the target that use a view that is rebuilt
        var all = _m.Items.Where(i => i.Kind == CompareKinds.View && i.Tgt is not null && i.Status != CompareStatus.Drop).ToList();
        var grew = true;
        while (grew)
        {
            grew = false;
            var names = all.Where(v => set.Contains(v.Id)).Select(v => v.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var v in all.Where(v => !set.Contains(v.Id) && v.Src is not null))
            {
                var refs = CompareSql.ReferencedNames(v.Tgt!.Ddl, _d);
                if (!names.Any(refs.Contains)) continue;
                set.Add(v.Id);
                grew = true;
                Warn(v, "info", $"View {v.Name} is dropped and created again because a view it uses is rebuilt.");
            }
        }
        // drop views that depend on a table which gets broken columns and are dropped anyway: nothing to add
        return set;
    }

    private void AddView(ItemRec v, bool recreate, DdlScriptContext ctx)
    {
        var src = v.Src!;
        var model = src.View!;
        var body = CompareSql.RewriteSchema(model.Body, _d, _m.SourceSnapshot.Schema, _m.TargetSchema);
        var editing = v.Status == CompareStatus.Alter && !recreate;
        var def = new ViewDefinition(_m.TargetSchema, src.Name, editing ? src.Name : null, body, model.Options);
        try
        {
            AddScript(v, _scripter.ScriptView(def, ctx));
        }
        catch (ArgumentException ex)
        {
            throw EngineException.Validation($"View {src.Name}: {ex.Message}", new { field = "items" });
        }
    }

    // ------------------------------------------------------------------ routines, triggers, sequences

    private bool CanReplace(ItemRec item, DdlScriptContext ctx)
    {
        switch (_d)
        {
            case Dialect.TSql:
                return item.Kind is CompareKinds.Proc or CompareKinds.Func or CompareKinds.Trigger && SupportsCreateOrAlter(ctx.ServerVersion);
            case Dialect.PlSql:
                return item.Kind is CompareKinds.Proc or CompareKinds.Func or CompareKinds.Trigger or CompareKinds.Package;
            case Dialect.PgSql:
                if (item.Kind is not (CompareKinds.Proc or CompareKinds.Func)) return false;
                return ReturnsClause(item.Src!.Ddl) == ReturnsClause(item.Tgt!.Ddl) && item.Kind == item.Tgt.Kind;
            default:
                return false;
        }
    }

    internal static bool SupportsCreateOrAlter(string? productVersion)
    {
        if (string.IsNullOrWhiteSpace(productVersion) || !Version.TryParse(productVersion.Trim(), out var v)) return true;
        return v.Major > 13 || (v.Major == 13 && v.Build >= 4001);
    }

    [GeneratedRegex(@"^\s*RETURNS\s+(?<t>.+?)\s*$", RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex ReturnsLine();

    private static string ReturnsClause(string ddl)
    {
        var m = ReturnsLine().Match(ddl);
        return m.Success ? string.Join(' ', m.Groups["t"].Value.ToLowerInvariant().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)) : "";
    }

    private void AddRoutine(ItemRec item, DdlScriptContext ctx)
    {
        var ddl = item.CreateDdl!;
        if (item.Status == CompareStatus.Create)
        {
            Add(item, Prep(ddl, item), DdlKinds.Create);
            return;
        }
        if (CanReplace(item, ctx))
        {
            var clause = _d == Dialect.TSql ? "OR ALTER" : "OR REPLACE";
            Add(item, Prep(CompareSql.WithOrReplace(ddl, _d, clause), item), DdlKinds.Alter);
            if (_d == Dialect.PgSql && item.Kind is CompareKinds.Proc or CompareKinds.Func)
                Warn(item, "info", "CREATE OR REPLACE keeps the grants of the routine.");
            return;
        }
        // no CREATE OR REPLACE: drop and create (triggers were dropped in the first step)
        if (item.Kind != CompareKinds.Trigger) Add(item, CompareDialect.Drop(_d, _m.TargetSchema, item.Tgt!, item.Kind), DdlKinds.Drop);
        Add(item, Prep(ddl, item), DdlKinds.Create);
        if (_d == Dialect.PgSql && item.Kind is CompareKinds.Proc or CompareKinds.Func)
            Warn(item, "warning", $"{item.Name} is dropped and created again because its return type changes; objects using it may need to be rebuilt.");
    }

    /// <summary>A definition as one executable statement: no trailing terminator (except where the dialect's blocks need it), no DEFINER.</summary>
    private string Prep(string ddl, ItemRec item)
    {
        var sql = ddl.Trim();
        if (_d == Dialect.MySql) sql = Definer().Replace(sql, "");
        if (_d == Dialect.PlSql && item.Kind is CompareKinds.Proc or CompareKinds.Func or CompareKinds.Package or CompareKinds.Trigger)
            return sql.TrimEnd().TrimEnd('/').TrimEnd();
        return CompareSql.TrimTerminator(sql);
    }

    [GeneratedRegex(@"\s*DEFINER\s*=\s*(`[^`]*`|'[^']*'|\S+?)@(`[^`]*`|'[^']*'|[^\s]+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Definer();

    // ------------------------------------------------------------------ sequences

    private void AddSequenceAlter(ItemRec sq)
    {
        var src = SequenceProps.Parse(sq.Src!.Ddl);
        var tgt = SequenceProps.Parse(sq.Tgt!.Ddl);
        if (src.DataType is not null && tgt.DataType is not null && !src.DataType.Equals(tgt.DataType, StringComparison.OrdinalIgnoreCase))
            Warn(sq, "warning", $"The data type of sequence {sq.Name} differs ({tgt.DataType} → {src.DataType}); change it by hand.");
        var parts = src.AlterClauses(tgt, _d);
        if (parts.Count == 0)
        {
            Warn(sq, "info", $"Sequence {sq.Name} differs only in its current/start value; nothing to alter.");
            return;
        }
        Add(sq, $"ALTER SEQUENCE {CompareDialect.Qualify(_d, _m.TargetSchema, sq.Name)} {string.Join(" ", parts)}", DdlKinds.Alter);
    }

    // ------------------------------------------------------------------ dependency order

    /// <summary>Stable topological order of objects by the names their definitions mention; cycles and unknowns keep the name order.</summary>
    private List<T> OrderByDependencies<T>(IReadOnlyCollection<T> nodes, Func<T, string> ddl, Func<T, string> name, bool dependentsFirst)
    {
        var list = nodes.OrderBy(name, StringComparer.OrdinalIgnoreCase).ToList();
        if (list.Count < 2) return list;
        var byName = new Dictionary<string, List<int>>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < list.Count; i++)
        {
            var n = BaseName(name(list[i]));
            if (!byName.TryGetValue(n, out var l)) byName[n] = l = [];
            l.Add(i);
        }
        var deps = new List<int>[list.Count];
        for (var i = 0; i < list.Count; i++)
        {
            deps[i] = [];
            foreach (var word in CompareSql.ReferencedNames(ddl(list[i]), _d))
                if (byName.TryGetValue(word, out var targets))
                    foreach (var j in targets.Where(j => j != i)) deps[i].Add(j);
        }
        var order = new List<int>();
        var state = new int[list.Count];
        void Visit(int i)
        {
            if (state[i] != 0) return;
            state[i] = 1;
            foreach (var j in deps[i].Distinct().OrderBy(x => x)) Visit(j);
            state[i] = 2;
            order.Add(i);
        }
        for (var i = 0; i < list.Count; i++) Visit(i);
        var sorted = order.Select(i => list[i]).ToList();
        if (dependentsFirst) sorted.Reverse();
        return sorted;
    }

    private static string BaseName(string name)
    {
        var p = name.IndexOf('(');
        return p > 0 ? name[..p] : name;
    }
}

/// <summary>Properties of a CREATE SEQUENCE, enough to script an ALTER SEQUENCE.</summary>
internal sealed partial class SequenceProps
{
    public string? DataType { get; private init; }
    public string? Increment { get; private init; }
    public string? Min { get; private init; }
    public string? Max { get; private init; }
    public bool Cycle { get; private init; }
    public string? Cache { get; private init; }

    [GeneratedRegex(@"\bAS\s+(?<v>[A-Za-z_][\w ]*?)(?=\s+(START|INCREMENT|MINVALUE|MAXVALUE|NO|CACHE|CYCLE|NOCYCLE|OWNED|;)|\s*;|\s*$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex TypeRx();
    [GeneratedRegex(@"\bINCREMENT(?:\s+BY)?\s+(?<v>-?\d+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex IncRx();
    [GeneratedRegex(@"\bMINVALUE\s+(?<v>-?\d+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MinRx();
    [GeneratedRegex(@"\bMAXVALUE\s+(?<v>-?\d+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MaxRx();
    [GeneratedRegex(@"\bCACHE\s+(?<v>\d+)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CacheRx();
    [GeneratedRegex(@"(?<![\w])(?<no>NO\s*)?CYCLE\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CycleRx();

    public static SequenceProps Parse(string ddl)
    {
        static string? V(Match m) => m.Success ? m.Groups["v"].Value.Trim() : null;
        var cycle = CycleRx().Match(ddl);
        return new SequenceProps
        {
            DataType = V(TypeRx().Match(ddl)),
            Increment = V(IncRx().Match(ddl)),
            Min = V(MinRx().Match(ddl)),
            Max = V(MaxRx().Match(ddl)),
            Cycle = cycle.Success && !cycle.Groups["no"].Success,
            Cache = V(CacheRx().Match(ddl)),
        };
    }

    /// <summary>The ALTER clauses that bring <paramref name="target"/> to this (the source's) properties; empty when nothing but the start differs.</summary>
    public List<string> AlterClauses(SequenceProps target, Dialect d)
    {
        var oracle = d == Dialect.PlSql;
        var parts = new List<string>();
        if (!string.Equals(Increment ?? "1", target.Increment ?? "1", StringComparison.Ordinal)) parts.Add($"INCREMENT BY {Increment ?? "1"}");
        if (!string.Equals(Min, target.Min, StringComparison.Ordinal)) parts.Add(Min is null ? (oracle ? "NOMINVALUE" : "NO MINVALUE") : $"MINVALUE {Min}");
        if (!string.Equals(Max, target.Max, StringComparison.Ordinal)) parts.Add(Max is null ? (oracle ? "NOMAXVALUE" : "NO MAXVALUE") : $"MAXVALUE {Max}");
        if (Cycle != target.Cycle) parts.Add(Cycle ? "CYCLE" : oracle ? "NOCYCLE" : "NO CYCLE");
        if (!string.Equals(Cache ?? "", target.Cache ?? "", StringComparison.Ordinal))
            parts.Add(Cache is null or "1" && !oracle ? "CACHE 1" : Cache is null ? "NOCACHE" : $"CACHE {Cache}");
        return parts;
    }
}
