using System.Text.RegularExpressions;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;

namespace DbStudio.Core.SchemaCompare;

/// <summary>One row of the result list with everything the script builder needs.</summary>
internal sealed class ItemRec
{
    public required string Id { get; init; }
    public required string Kind { get; init; }
    public required string Name { get; init; }
    public string Status { get; set; } = CompareStatus.Identical;
    public string? Detail { get; set; }
    public List<string> Changes { get; } = [];
    public List<CompareWarning> Warnings { get; } = [];

    // tables: both prepared (schema mapped to the target, masked by the options)
    public TableModel? SrcTable { get; set; }
    public TableModel? TgtTable { get; set; }
    public TableDiffResult? Diff { get; set; }
    /// <summary>Target foreign keys to drop and source foreign keys to add around the table's other changes (diff plus forced recreations).</summary>
    public List<ForeignKeyModel> FkDrop { get; } = [];
    public List<ForeignKeyModel> FkAdd { get; } = [];

    // everything else
    public DbObject? Src { get; set; }
    public DbObject? Tgt { get; set; }
    /// <summary>The source definition with the schema qualifiers rewritten to the target schema: what gets created.</summary>
    public string? CreateDdl { get; set; }

    public CompareItem ToWire() => new(Id, Kind, Name, Status, Changes, Warnings, Detail);
}

/// <summary>Diffs two snapshots into <see cref="ItemRec"/>s.</summary>
internal static partial class SchemaComparer
{
    // PK__Orders__3213E83F5F1A2B3C and UQ__...: 16 hex digits; FK__Orders__Cust__2E70E1FD, CK__..., DF__...: 8
    [GeneratedRegex(@"^((PK|UQ)__.+__[0-9A-Fa-f]{16}|(FK|CK|DF)__.+__[0-9A-Fa-f]{8})$", RegexOptions.CultureInvariant)]
    private static partial Regex SystemName();

    public static List<ItemRec> Compare(SchemaSnapshot src, SchemaSnapshot tgt, CompareOptions o, Dialect d, string providerId)
    {
        var items = new List<ItemRec>();
        CompareTables(src, tgt, o, d, providerId, items);
        CompareObjects(src, tgt, o, d, items);
        items.Sort((a, b) =>
        {
            var c = KindRank(a.Kind).CompareTo(KindRank(b.Kind));
            return c != 0 ? c : string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
        });
        return items;
    }

    public static int KindRank(string kind) => kind switch
    {
        CompareKinds.Type => 0, CompareKinds.Sequence => 1, CompareKinds.Table => 2, CompareKinds.View => 3, CompareKinds.Func => 4,
        CompareKinds.Proc => 5, CompareKinds.Package => 6, CompareKinds.Trigger => 7, _ => 9,
    };

    // ------------------------------------------------------------------ tables

    private sealed class Pair(ItemRec item, TableModel s, TableModel t, TableDiffResult diff)
    {
        public ItemRec Item { get; } = item;
        public TableModel S { get; } = s;
        public TableModel T { get; } = t;
        public TableDiffResult Diff { get; } = diff;
    }

    private static void CompareTables(SchemaSnapshot src, SchemaSnapshot tgt, CompareOptions o, Dialect d, string providerId, List<ItemRec> items)
    {
        var pairs = new List<Pair>();
        var names = src.Tables.Keys.Union(tgt.Tables.Keys, StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var key in names)
        {
            src.Tables.TryGetValue(key, out var s0);
            tgt.Tables.TryGetValue(key, out var t0);
            var name = (t0 ?? s0)!.Name;
            var id = CompareIds.Key(CompareKinds.Table, name);
            if (s0 is not null && t0 is null)
            {
                var s = Prepare(s0, o, d, src.Schema, tgt.Schema, isSource: true);
                var item = new ItemRec { Id = id, Kind = CompareKinds.Table, Name = s0.Name, Status = CompareStatus.Create, SrcTable = s };
                item.Changes.Add($"New table with {s.Columns.Count} column{(s.Columns.Count == 1 ? "" : "s")}");
                items.Add(item);
            }
            else if (s0 is null && t0 is not null)
            {
                var t = Prepare(t0, o, d, tgt.Schema, tgt.Schema, isSource: false);
                var item = new ItemRec { Id = id, Kind = CompareKinds.Table, Name = t0.Name, Status = CompareStatus.Drop, TgtTable = t };
                item.Changes.Add("Table only exists in the target");
                item.Warnings.Add(new CompareWarning("dataLoss", $"Dropping table {t0.Name} deletes all of its rows."));
                items.Add(item);
            }
            else
            {
                var s = Prepare(s0!, o, d, src.Schema, tgt.Schema, isSource: true);
                var t = Prepare(t0!, o, d, tgt.Schema, tgt.Schema, isSource: false);
                if (!o.Columns) s = s with { Columns = t.Columns.Select(c => c with { }).ToList() };
                else s = KeepTargetColumnOrder(s, t);
                s = DropDanglingReferences(s);
                if (o.IgnoreConstraintNames) s = AlignNames(s, t);
                var diff = TableDiff.Compute(t, s);
                var item = new ItemRec
                {
                    Id = id, Kind = CompareKinds.Table, Name = t0!.Name, SrcTable = s, TgtTable = t, Diff = diff,
                    Status = diff.IsEmpty ? CompareStatus.Identical : CompareStatus.Alter,
                };
                pairs.Add(new Pair(item, s, t, diff));
                items.Add(item);
            }
        }

        foreach (var p in pairs)
        {
            p.Item.FkDrop.AddRange(p.Diff.ForeignKeysDropped);
            p.Item.FkAdd.AddRange(p.Diff.ForeignKeysAdded);
        }
        if (d != Dialect.Sqlite) ForceDependentForeignKeys(pairs);

        foreach (var p in pairs.Where(p => p.Item.Status == CompareStatus.Alter))
            Describe(p, d);
        // a forced recreation can make an otherwise identical table "different"
        foreach (var p in pairs.Where(p => p.Item.Status == CompareStatus.Identical && (p.Item.FkDrop.Count > 0 || p.Item.FkAdd.Count > 0)))
        {
            p.Item.Status = CompareStatus.Alter;
            Describe(p, d);
        }
    }

    private static TableModel Prepare(TableModel m, CompareOptions o, Dialect d, string ownSchema, string targetSchema, bool isSource)
    {
        // SQL Server names unnamed constraints PK__Orders__3213E83F...: such a source name is blanked, so it matches whatever the target
        // called its key (the target keeps its real names: they are needed to drop a key).
        string? Name(string? n) => isSource && d == Dialect.TSql && n is not null && SystemName().IsMatch(n) ? null : n;
        string? RefSchema(string? s) => s is null ? null : isSource && s.Equals(ownSchema, StringComparison.OrdinalIgnoreCase) ? targetSchema : s;
        // the source's own-schema qualifiers (PostgreSQL types "src.status_t", defaults "nextval('src.seq')") point at the target schema
        var rewrite = isSource && !ownSchema.Equals(targetSchema, StringComparison.Ordinal);
        string? Rw(string? s) => rewrite && s is not null ? RewriteExpression(s, d, ownSchema, targetSchema) : s;
        var prepared = m with
        {
            Schema = targetSchema,
            Comment = o.Comments ? m.Comment : null,
            Options = m.Options with { Tablespace = null },
            Columns = m.Columns.Select(c => c with
            {
                Id = c.Name,
                Type = Rw(c.Type)!,
                Default = o.Defaults ? Rw(c.Default) : null,
                DefaultName = null,
                Computed = c.Computed is null ? null : c.Computed with { Expression = Rw(c.Computed.Expression)! },
                Comment = o.Comments ? c.Comment : null,
                Collation = o.IgnoreCollation ? null : c.Collation,
            }).ToList(),
            PrimaryKey = o.PrimaryKeys && m.PrimaryKey is { Columns.Count: > 0 } pk ? pk with { Name = Name(pk.Name) } : null,
            Uniques = o.Uniques ? m.Uniques.Select(u => u with { Name = Name(u.Name) }).ToList() : [],
            Checks = o.Checks ? m.Checks.Select(c => c with { Name = Name(c.Name), Expression = Rw(c.Expression)! }).ToList() : [],
            Indexes = o.Indexes ? m.Indexes.Select(i => i with { Filter = Rw(i.Filter) }).ToList() : [],
            ForeignKeys = o.ForeignKeys ? m.ForeignKeys.Select(f => f with { Name = Name(f.Name), RefSchema = RefSchema(f.RefSchema) }).ToList() : [],
        };
        return prepared;
    }

    private static string RewriteExpression(string expression, Dialect d, string from, string to)
    {
        var text = CompareSql.RewriteSchema(expression, d, from, to);
        if (d != Dialect.PgSql) return text;
        // regclass literals: nextval('src.seq'::regclass) / nextval('"src"."seq"'::regclass)
        var q = DialectInfo.QuoteIdentifier(d, to);
        var plain = Regex.IsMatch(to, "^[a-z_][a-z0-9_$]*$");
        text = Regex.Replace(text, $@"'{Regex.Escape(from)}\.", "'" + (plain ? to : q) + ".", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        text = Regex.Replace(text, $@"'""{Regex.Escape(from)}""\.", "'" + q + ".", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return text;
    }

    /// <summary>
    /// Column order is not compared: columns the target has keep its order, new ones follow in the source's order (that is where
    /// ALTER TABLE ADD puts them, and most servers cannot reorder columns at all).
    /// </summary>
    private static TableModel KeepTargetColumnOrder(TableModel s, TableModel t)
    {
        var position = t.Columns.Select((c, i) => (c.Name, i)).ToDictionary(x => x.Name, x => x.i, StringComparer.OrdinalIgnoreCase);
        var ordered = s.Columns.Select((c, i) => (Col: c, Key: position.TryGetValue(c.Name, out var p) ? p : int.MaxValue / 2 + i)).OrderBy(x => x.Key).Select(x => x.Col).ToList();
        return s with { Columns = ordered };
    }

    /// <summary>With "Columns" off the source takes the target's columns: constraints on columns the target lacks cannot be scripted.</summary>
    private static TableModel DropDanglingReferences(TableModel s)
    {
        var cols = new HashSet<string>(s.Columns.Select(c => c.Name), StringComparer.OrdinalIgnoreCase);
        bool Has(IEnumerable<string> c) => c.All(cols.Contains);
        return s with
        {
            PrimaryKey = s.PrimaryKey is not null && Has(s.PrimaryKey.Columns) ? s.PrimaryKey : null,
            Uniques = s.Uniques.Where(u => Has(u.Columns)).ToList(),
            Indexes = s.Indexes.Where(i => Has(i.Columns.Select(c => c.Name)) && Has(i.Include)).ToList(),
            ForeignKeys = s.ForeignKeys.Where(f => Has(f.Columns)).ToList(),
        };
    }

    /// <summary>"Ignore constraint names": a source key / index that equals a target one except for its name takes the target's name.</summary>
    private static TableModel AlignNames(TableModel s, TableModel t)
    {
        static bool Same(IReadOnlyList<string> a, IReadOnlyList<string> b) =>
            a.Count == b.Count && a.Zip(b).All(p => p.First.Equals(p.Second, StringComparison.OrdinalIgnoreCase));
        var usedFk = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var usedIx = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var usedUq = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var usedCk = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        return s with
        {
            PrimaryKey = s.PrimaryKey is not null && t.PrimaryKey is not null && Same(s.PrimaryKey.Columns, t.PrimaryKey.Columns)
                ? s.PrimaryKey with { Name = t.PrimaryKey.Name } : s.PrimaryKey,
            Uniques = s.Uniques.Select(u =>
            {
                var hit = t.Uniques.FirstOrDefault(x => Same(x.Columns, u.Columns) && usedUq.Add(x.Name ?? ""));
                return hit is null ? u : u with { Name = hit.Name };
            }).ToList(),
            Checks = s.Checks.Select(c =>
            {
                var hit = t.Checks.FirstOrDefault(x => TableDiff.SameExpression(x.Expression, c.Expression) && usedCk.Add(x.Name ?? ""));
                return hit is null ? c : c with { Name = hit.Name };
            }).ToList(),
            Indexes = s.Indexes.Select(i =>
            {
                var hit = t.Indexes.FirstOrDefault(x => x.Unique == i.Unique && x.Clustered == i.Clustered && x.Columns.Count == i.Columns.Count
                    && x.Columns.Zip(i.Columns).All(p => p.First.Name.Equals(p.Second.Name, StringComparison.OrdinalIgnoreCase) && p.First.Desc == p.Second.Desc)
                    && TableDiff.SameExpression(x.Filter, i.Filter) && usedIx.Add(x.Name));
                return hit is null ? i : i with { Name = hit.Name };
            }).ToList(),
            ForeignKeys = s.ForeignKeys.Select(f =>
            {
                var hit = t.ForeignKeys.FirstOrDefault(x => SameFk(x, f) && usedFk.Add(x.Name ?? ""));
                return hit is null ? f : f with { Name = hit.Name };
            }).ToList(),
        };
    }

    private static bool SameFk(ForeignKeyModel o, ForeignKeyModel d) =>
        o.Columns.Count == d.Columns.Count && o.Columns.Zip(d.Columns).All(p => p.First.Equals(p.Second, StringComparison.OrdinalIgnoreCase))
        && o.RefTable.Equals(d.RefTable, StringComparison.OrdinalIgnoreCase)
        && o.RefColumns.Count == d.RefColumns.Count && o.RefColumns.Zip(d.RefColumns).All(p => p.First.Equals(p.Second, StringComparison.OrdinalIgnoreCase))
        && ReferentialActions.Normalize(o.OnDelete) == ReferentialActions.Normalize(d.OnDelete)
        && ReferentialActions.Normalize(o.OnUpdate) == ReferentialActions.Normalize(d.OnUpdate);

    private static bool SameSet(IEnumerable<string> a, IEnumerable<string> b)
    {
        var x = a.ToList();
        var y = b.ToList();
        return x.Count == y.Count && x.All(v => y.Contains(v, StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>
    /// A foreign key cannot stay while a column it uses (or the key it references) is retyped or its key replaced: those keys are
    /// dropped before the table changes and created again afterwards, even though the key itself is identical on both sides.
    /// </summary>
    private static void ForceDependentForeignKeys(List<Pair> pairs)
    {
        var byName = pairs.ToDictionary(p => p.T.Name, StringComparer.OrdinalIgnoreCase);
        var redefined = pairs.ToDictionary(p => p.T.Name, p => p.Diff.Matched
            .Where(m => m.TypeChanged || m.ComputedChanged || m.CollationChanged || m.IdentityChanged)
            .Select(m => m.Old.Name).ToHashSet(StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase);
        var keysChanged = pairs.ToDictionary(p => p.T.Name, p =>
        {
            var sets = new List<List<string>>();
            if (p.Diff.PrimaryKeyDropped is { } pk) sets.Add(pk.Columns);
            if (p.Diff.PrimaryKeyAdded is { } pka) sets.Add(pka.Columns);
            sets.AddRange(p.Diff.UniquesDropped.Select(u => u.Columns));
            sets.AddRange(p.Diff.IndexesDropped.Where(i => i.Unique).Select(i => i.Columns.Select(c => c.Name).ToList()));
            return sets;
        }, StringComparer.OrdinalIgnoreCase);

        foreach (var p in pairs)
        {
            foreach (var f in p.T.ForeignKeys)
            {
                if (p.Item.FkDrop.Contains(f)) continue;
                var affected = f.Columns.Any(redefined[p.T.Name].Contains);
                if (!affected && byName.TryGetValue(f.RefTable, out var r))
                {
                    affected = f.RefColumns.Any(redefined[r.T.Name].Contains) || keysChanged[r.T.Name].Any(set => SameSet(set, f.RefColumns));
                    if (affected && r.Item.Status == CompareStatus.Identical) affected = false;
                }
                if (!affected) continue;
                var counterpart = p.S.ForeignKeys.FirstOrDefault(x => SameFk(f, x) || (f.Name is not null && string.Equals(f.Name, x.Name, StringComparison.OrdinalIgnoreCase)));
                p.Item.FkDrop.Add(f);
                if (counterpart is not null) p.Item.FkAdd.Add(counterpart);
                p.Item.Warnings.Add(new CompareWarning("info",
                    $"Foreign key {f.Name ?? f.RefTable} is dropped and created again because a column it uses changes."));
            }
        }
    }

    private static void Describe(Pair p, Dialect d)
    {
        var item = p.Item;
        var t = p.T;
        var s = p.S;
        foreach (var ch in p.Diff.Changes) item.Changes.Add(Text(ch));
        // forced recreations that TableDiff does not know of
        foreach (var f in item.FkDrop.Where(f => !p.Diff.ForeignKeysDropped.Contains(f)))
            item.Changes.Add($"Foreign key {f.Name ?? f.RefTable}: dropped and created again");

        foreach (var col in p.Diff.Dropped)
            item.Warnings.Add(new CompareWarning("dataLoss", $"Dropping column {col.Name} deletes its data."));
        foreach (var m in p.Diff.Matched)
        {
            if (m.TypeChanged && CompareRisk.TypeChange(m.Old.Type, m.New.Type) is { } risk)
                item.Warnings.Add(new CompareWarning("dataLoss", $"Column {m.New.Name}: {risk}"));
            if (m.NullabilityChanged && !m.New.Nullable)
                item.Warnings.Add(new CompareWarning("warning", $"Column {m.New.Name} becomes NOT NULL: this fails if it contains NULLs."));
            if (m.ComputedChanged)
                item.Warnings.Add(new CompareWarning("warning", $"Column {m.New.Name}: the generated expression changes."));
            if (m.IdentityChanged && m.Old.Identity is not null && m.New.Identity is null)
                item.Warnings.Add(new CompareWarning("warning", $"Column {m.New.Name} stops being an identity column; new rows need explicit values."));
        }
        foreach (var col in p.Diff.Added.Where(c => !c.Nullable && c.Default is null && c.Computed is null && c.Identity is null))
            item.Warnings.Add(new CompareWarning("warning", $"New NOT NULL column {col.Name} has no default: adding it fails when the table has rows."));
        if (p.Diff.PrimaryKeyDropped is not null && p.Diff.PrimaryKeyAdded is null)
            item.Warnings.Add(new CompareWarning("warning", "The primary key is dropped."));
        if (p.Diff.ColumnsReordered && d is Dialect.PgSql)
            item.Warnings.Add(new CompareWarning("info", "Column order differs; PostgreSQL keeps the existing order."));
        _ = t; _ = s;
    }

    private static string Text(TableChange c) => c.Kind switch
    {
        TableChangeKinds.TableCommentChanged => "Table comment changed",
        TableChangeKinds.OptionsChanged => "Table options changed",
        TableChangeKinds.TableRenamed => $"Table renamed ({c.Detail})",
        TableChangeKinds.ColumnAdded => $"Column {c.Target} added ({c.Detail})",
        TableChangeKinds.ColumnDropped => $"Column {c.Target} dropped",
        TableChangeKinds.ColumnRenamed => $"Column renamed ({c.Detail})",
        TableChangeKinds.ColumnTypeChanged => $"Column {c.Target}: type {c.Detail}",
        TableChangeKinds.ColumnNullabilityChanged => $"Column {c.Target}: {c.Detail}",
        TableChangeKinds.ColumnDefaultChanged => $"Column {c.Target}: default changed to {c.Detail}",
        TableChangeKinds.ColumnIdentityChanged => $"Column {c.Target}: identity changed",
        TableChangeKinds.ColumnComputedChanged => $"Column {c.Target}: generated expression changed",
        TableChangeKinds.ColumnCollationChanged => $"Column {c.Target}: collation changed to {c.Detail}",
        TableChangeKinds.ColumnCommentChanged => $"Column {c.Target}: comment changed",
        TableChangeKinds.ColumnsReordered => "Column order differs",
        TableChangeKinds.PrimaryKeyAdded => $"Primary key added ({c.Detail})",
        TableChangeKinds.PrimaryKeyDropped => "Primary key dropped",
        TableChangeKinds.UniqueAdded => $"Unique constraint {c.Target} added ({c.Detail})",
        TableChangeKinds.UniqueDropped => $"Unique constraint {c.Target} dropped",
        TableChangeKinds.IndexAdded => $"Index {c.Target} added ({c.Detail})",
        TableChangeKinds.IndexDropped => $"Index {c.Target} dropped",
        TableChangeKinds.ForeignKeyAdded => $"Foreign key {c.Target} added {c.Detail}",
        TableChangeKinds.ForeignKeyDropped => $"Foreign key {c.Target} dropped",
        TableChangeKinds.CheckAdded => $"Check constraint {c.Target} added ({c.Detail})",
        TableChangeKinds.CheckDropped => $"Check constraint {c.Target} dropped",
        _ => c.Kind + (c.Detail is null ? "" : ": " + c.Detail),
    };

    // ------------------------------------------------------------------ views, routines, triggers, sequences, types

    private static void CompareObjects(SchemaSnapshot src, SchemaSnapshot tgt, CompareOptions o, Dialect d, List<ItemRec> items)
    {
        var keys = src.Objects.Keys.Union(tgt.Objects.Keys, StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var key in keys)
        {
            src.Objects.TryGetValue(key, out var s);
            tgt.Objects.TryGetValue(key, out var t);
            var any = (t ?? s)!;
            var rec = new ItemRec { Id = any.Key, Kind = any.Kind, Name = any.Name, Src = s, Tgt = t, Detail = (t ?? s)!.OnTable };
            if (s is not null) rec.CreateDdl = RewriteForTarget(s.Ddl, d, src.Schema, tgt.Schema);
            if (s is not null && t is null)
            {
                rec.Status = CompareStatus.Create;
                rec.Changes.Add($"{Label(any.Kind)} only exists in the source");
            }
            else if (s is null && t is not null)
            {
                rec.Status = CompareStatus.Drop;
                rec.Changes.Add($"{Label(any.Kind)} only exists in the target");
                if (any.Kind == CompareKinds.Sequence)
                    rec.Warnings.Add(new CompareWarning("warning", $"Dropping sequence {any.Name} loses its current value."));
            }
            else
            {
                var differences = Differences(s!, t!, o, d, src.Schema, tgt.Schema);
                if (differences.Count == 0) rec.Status = CompareStatus.Identical;
                else
                {
                    rec.Status = CompareStatus.Alter;
                    rec.Changes.AddRange(differences);
                }
            }
            if (s is not null && !src.Schema.Equals(tgt.Schema, StringComparison.OrdinalIgnoreCase) && rec.Status is CompareStatus.Create or CompareStatus.Alter
                && CompareSql.MentionsSchemaQualifier(rec.CreateDdl ?? "", src.Schema))
                rec.Warnings.Add(new CompareWarning("warning", $"The definition still mentions the schema '{src.Schema}' (for example inside a body): check it before applying."));
            items.Add(rec);
        }
    }

    private static string Label(string kind) => kind switch
    {
        CompareKinds.View => "View", CompareKinds.Proc => "Procedure", CompareKinds.Func => "Function", CompareKinds.Trigger => "Trigger",
        CompareKinds.Sequence => "Sequence", CompareKinds.Type => "Type", CompareKinds.Package => "Package", _ => "Object",
    };

    public static string RewriteForTarget(string ddl, Dialect d, string sourceSchema, string targetSchema) =>
        sourceSchema.Equals(targetSchema, StringComparison.Ordinal) ? ddl : CompareSql.RewriteSchema(ddl, d, sourceSchema, targetSchema);

    private static List<string> Differences(DbObject s, DbObject t, CompareOptions o, Dialect d, string srcSchema, string tgtSchema)
    {
        var list = new List<string>();
        if (s.Kind == CompareKinds.View && s.View is not null && t.View is not null)
        {
            if (Canon(s.View.Body, d, o, srcSchema) != Canon(t.View.Body, d, o, tgtSchema)) list.Add("View query differs");
            if (s.View.Options.CheckOption != t.View.Options.CheckOption) list.Add("WITH CHECK OPTION differs");
            if (s.View.Options.SchemaBinding != t.View.Options.SchemaBinding) list.Add("SCHEMABINDING differs");
            return list;
        }
        var a = CanonDdl(s.Ddl, d, o, srcSchema);
        var b = CanonDdl(t.Ddl, d, o, tgtSchema);
        if (a != b)
        {
            list.Add(s.Kind switch
            {
                CompareKinds.Sequence => "Sequence properties differ",
                CompareKinds.Trigger => "Trigger definition differs",
                CompareKinds.Type => "Type definition differs",
                _ => "Definition differs",
            });
        }
        return list;
    }

    private static string Canon(string body, Dialect d, CompareOptions o, string ownSchema) =>
        CompareSql.Normalize(CompareSql.RewriteSchema(body, d, ownSchema, null), d, o.IgnoreWhitespace, o.IgnoreCase, o.IgnoreComments);

    /// <summary>Header-less canonical form: the object kind, then the text after the name (own-schema qualifiers removed).</summary>
    private static string CanonDdl(string ddl, Dialect d, CompareOptions o, string ownSchema)
    {
        var text = CompareSql.RewriteSchema(ddl, d, ownSchema, null);
        var rest = CompareSql.CanonicalBody(text, d, out var kind);
        return kind + "|" + CompareSql.Normalize(rest, d, o.IgnoreWhitespace, o.IgnoreCase, o.IgnoreComments);
    }
}
