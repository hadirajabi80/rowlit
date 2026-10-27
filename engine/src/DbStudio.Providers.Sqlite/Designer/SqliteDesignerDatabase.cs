using System.Data.Common;
using System.Text.RegularExpressions;
using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using Microsoft.Data.Sqlite;

namespace DbStudio.Providers.Sqlite.Designer;

/// <summary>
/// SQLite side of the designer: table models from <c>pragma_table_xinfo</c>, <c>pragma_index_list/xinfo</c>,
/// <c>pragma_foreign_key_list</c> and the parsed <c>sqlite_master.sql</c>; apply in one transaction with
/// <c>PRAGMA foreign_keys</c> switched outside it and <c>PRAGMA foreign_key_check</c> verified before commit.
/// Every call opens its own short-lived connection.
/// </summary>
public sealed partial class SqliteDesignerDatabase : IDesignerDatabase
{
    public string ProviderId => "sqlite";

    private static Task<SqliteConnection> OpenAsync(ConnectionProfile profile, CancellationToken ct) =>
        SqliteConnections.OpenAsync(profile, forceReadOnly: false, ct);

    private static string Schema(string? schema) => string.IsNullOrWhiteSpace(schema) ? SqliteDdlScripter.MainSchema : schema;

    public async Task<DdlScriptContext> GetScriptContextAsync(ConnectionProfile profile, string? password, string? database, string? schema, string? table, CancellationToken ct)
    {
        await using var c = await OpenAsync(profile, ct).ConfigureAwait(false);
        var version = Convert.ToString(await ScalarAsync(c, "SELECT sqlite_version()", ct).ConfigureAwait(false));
        IReadOnlyList<DependentObject> dependents = [];
        if (!string.IsNullOrWhiteSpace(table)) dependents = await ReadDependentsAsync(c, Schema(schema), table, ct).ConfigureAwait(false);
        return new DdlScriptContext(version, SqliteDdlScripter.MainSchema, dependents);
    }

    /// <summary>
    /// Triggers on the table, plus views and triggers of other tables whose SQL mentions it, plus (transitively) the views and
    /// triggers mentioning one of those views: a rebuild's RENAME makes SQLite re-check every view and trigger of the schema
    /// ("error in view v: no such table"), so a view over a dependent view must be dropped and recreated with it.
    /// </summary>
    internal static async Task<IReadOnlyList<DependentObject>> ReadDependentsAsync(SqliteConnection c, string schema, string table, CancellationToken ct)
    {
        var all = new List<(string Type, string Name, string Table, string Sql)>();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = $"SELECT type, name, tbl_name, sql FROM {SqliteNames.Quote(schema)}.sqlite_master WHERE type IN ('trigger','view') AND sql IS NOT NULL ORDER BY type DESC, name";
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false)) all.Add((r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3)));
        }

        static Regex Word(string name) => new(@"(?<![\w$])[""\[`]?" + Regex.Escape(name) + @"[""\]`]?(?![\w$])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        var found = new HashSet<int>();
        var tableWord = Word(table);
        for (var i = 0; i < all.Count; i++)
            if ((all[i].Type == "trigger" && all[i].Table.Equals(table, StringComparison.OrdinalIgnoreCase)) || tableWord.IsMatch(all[i].Sql)) found.Add(i);

        // Views (and the triggers on them) found so far pull in whatever mentions their names.
        var expanded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var grew = true; grew;)
        {
            grew = false;
            foreach (var i in found.Where(i => all[i].Type == "view" && !expanded.Contains(all[i].Name)).ToList())
            {
                expanded.Add(all[i].Name);
                var viewWord = Word(all[i].Name);
                for (var j = 0; j < all.Count; j++)
                    if (!found.Contains(j) && viewWord.IsMatch(all[j].Sql)) { found.Add(j); grew = true; }
            }
        }

        return found.OrderBy(i => i)
            .Select(i => new DependentObject(all[i].Type, all[i].Name, all[i].Sql,
                all[i].Type == "trigger" && all[i].Table.Equals(table, StringComparison.OrdinalIgnoreCase)))
            .ToList();
    }

    public async Task<TableModel> ReadTableAsync(ConnectionProfile profile, string? password, string? database, string? schema, string name, CancellationToken ct)
    {
        await using var c = await OpenAsync(profile, ct).ConfigureAwait(false);
        return await ReadTableAsync(c, Schema(schema), name, ct).ConfigureAwait(false);
    }

    internal static async Task<TableModel> ReadTableAsync(SqliteConnection c, string schema, string name, CancellationToken ct)
    {
        var s = SqliteNames.Quote(schema);
        string? createSql = null;
        string? actualName = null;
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = $"SELECT name, sql FROM {s}.sqlite_master WHERE type = 'table' AND name = $n COLLATE NOCASE";
            cmd.Parameters.AddWithValue("$n", name);
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (await r.ReadAsync(ct).ConfigureAwait(false))
            {
                actualName = r.GetString(0);
                createSql = r.IsDBNull(1) ? null : r.GetString(1);
            }
        }
        if (actualName is null) throw EngineException.NotFound($"Table {schema}.{name}");
        var parsed = SqliteCreateTableParser.Parse(createSql);
        var q = SqliteNames.Quote(actualName);

        // Columns
        var columns = new List<TableColumnModel>();
        var pkCols = new List<(int Ordinal, string Name)>();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = $"SELECT cid, name, type, \"notnull\", dflt_value, pk, hidden FROM pragma_table_xinfo($t, $s) ORDER BY cid";
            cmd.Parameters.AddWithValue("$t", actualName);
            cmd.Parameters.AddWithValue("$s", schema);
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false))
            {
                var hidden = r.GetInt32(6);
                if (hidden == 1) continue; // virtual-table hidden column
                var colName = r.GetString(1);
                parsed.Columns.TryGetValue(colName, out var pc);
                var computed = hidden is 2 or 3 && pc?.GeneratedExpression is { } expr ? new ComputedModel(expr, hidden == 3) : null;
                var pk = r.GetInt32(5);
                if (pk > 0) pkCols.Add((pk, colName));
                columns.Add(new TableColumnModel
                {
                    Id = colName,
                    Name = colName,
                    Type = r.IsDBNull(2) ? "" : r.GetString(2),
                    Nullable = r.GetInt32(3) == 0,
                    Default = computed is null && !r.IsDBNull(4) ? r.GetString(4) : null,
                    Computed = computed,
                    Collation = pc?.Collation,
                    Autoincrement = pc?.Autoincrement ?? false,
                });
            }
        }

        // Indexes and unique constraints
        var indexes = new List<IndexModel>();
        var uniques = new List<UniqueModel>();
        var indexList = new List<(string Name, bool Unique, string Origin)>();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT name, \"unique\", origin FROM pragma_index_list($t, $s) ORDER BY seq DESC";
            cmd.Parameters.AddWithValue("$t", actualName);
            cmd.Parameters.AddWithValue("$s", schema);
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false)) indexList.Add((r.GetString(0), r.GetInt32(1) != 0, r.GetString(2)));
        }
        foreach (var (ixName, unique, origin) in indexList)
        {
            if (origin == "pk") continue;
            var cols = new List<IndexColumnModel>();
            await using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT name, \"desc\" FROM pragma_index_xinfo($i, $s) WHERE key = 1 ORDER BY seqno";
                cmd.Parameters.AddWithValue("$i", ixName);
                cmd.Parameters.AddWithValue("$s", schema);
                await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await r.ReadAsync(ct).ConfigureAwait(false))
                    cols.Add(new IndexColumnModel(r.IsDBNull(0) ? "(expression)" : r.GetString(0), r.GetInt32(1) != 0));
            }
            if (origin == "u")
            {
                var names = cols.Select(x => x.Name).ToList();
                var match = parsed.Uniques.FirstOrDefault(u => u.Columns.Count == names.Count && u.Columns.Zip(names).All(p => p.First.Equals(p.Second, StringComparison.OrdinalIgnoreCase)));
                uniques.Add(new UniqueModel { Name = match?.Name, Columns = names });
                continue;
            }
            string? ixSql = null;
            await using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = $"SELECT sql FROM {s}.sqlite_master WHERE type = 'index' AND name = $i";
                cmd.Parameters.AddWithValue("$i", ixName);
                ixSql = await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false) as string;
            }
            indexes.Add(new IndexModel
            {
                Name = ixName,
                Columns = cols,
                Unique = unique,
                Filter = SqliteCreateTableParser.IndexFilter(ixSql),
            });
        }
        indexes.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));

        // Foreign keys
        var fkRows = new List<(int Id, int Seq, string Table, string From, string? To, string OnUpdate, string OnDelete)>();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete FROM pragma_foreign_key_list($t, $s) ORDER BY id, seq";
            cmd.Parameters.AddWithValue("$t", actualName);
            cmd.Parameters.AddWithValue("$s", schema);
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false))
                fkRows.Add((r.GetInt32(0), r.GetInt32(1), r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4), r.GetString(5), r.GetString(6)));
        }
        var foreignKeys = new List<ForeignKeyModel>();
        foreach (var g in fkRows.GroupBy(x => x.Id).OrderByDescending(g => g.Key))
        {
            var rows = g.OrderBy(x => x.Seq).ToList();
            var cols = rows.Select(x => x.From).ToList();
            var refTable = rows[0].Table;
            var parsedFk = parsed.ForeignKeys.FirstOrDefault(f => f.RefTable.Equals(refTable, StringComparison.OrdinalIgnoreCase)
                                                                  && f.Columns.Count == cols.Count
                                                                  && f.Columns.Zip(cols).All(p => p.First.Equals(p.Second, StringComparison.OrdinalIgnoreCase)));
            foreignKeys.Add(new ForeignKeyModel
            {
                Name = parsedFk?.Name,
                Columns = cols,
                RefTable = refTable,
                RefColumns = rows.All(x => x.To is not null) ? rows.Select(x => x.To!).ToList() : parsedFk?.RefColumns.ToList() ?? [],
                OnDelete = ReferentialActions.Normalize(rows[0].OnDelete),
                OnUpdate = ReferentialActions.Normalize(rows[0].OnUpdate),
            });
        }

        var pkColumns = pkCols.OrderBy(p => p.Ordinal).Select(p => p.Name).ToList();
        return new TableModel
        {
            Schema = schema,
            Name = actualName,
            Options = new TableOptions { WithoutRowid = parsed.WithoutRowid, Strict = parsed.Strict },
            Columns = columns,
            PrimaryKey = pkColumns.Count > 0 ? new PrimaryKeyModel { Name = parsed.PrimaryKeyName, Columns = pkColumns, Clustered = true } : null,
            Uniques = uniques,
            Indexes = indexes,
            ForeignKeys = foreignKeys,
            Checks = parsed.Checks.Select(ck => new CheckModel { Name = ck.Name, Expression = ck.Expression }).ToList(),
        };
    }

    public async Task<ViewModel> ReadViewAsync(ConnectionProfile profile, string? password, string? database, string? schema, string name, CancellationToken ct)
    {
        await using var c = await OpenAsync(profile, ct).ConfigureAwait(false);
        var sch = Schema(schema);
        await using var cmd = c.CreateCommand();
        cmd.CommandText = $"SELECT name, sql FROM {SqliteNames.Quote(sch)}.sqlite_master WHERE type = 'view' AND name = $n COLLATE NOCASE";
        cmd.Parameters.AddWithValue("$n", name);
        await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        if (!await r.ReadAsync(ct).ConfigureAwait(false)) throw EngineException.NotFound($"View {sch}.{name}");
        var sql = r.IsDBNull(1) ? "" : r.GetString(1);
        var viewName = r.GetString(0);
        var (body, columns) = SqliteCreateTableParser.ViewParts(sql);
        // CREATE VIEW v (a, b) AS ...: the column list renames the SELECT's columns. Unless the SELECT already yields those
        // names, the body is wrapped so that saving from the designer keeps them (docs/qa/round-sqlite.md O2).
        if (columns is not null && !await SelectYieldsViewColumnsAsync(c, sch, viewName, body, ct).ConfigureAwait(false))
            body = SqliteCreateTableParser.BodyWithColumns(SqliteNames.Quote(viewName), body, columns);
        return new ViewModel(sch, viewName, body, new ViewOptions(), sql);
    }

    private static async Task<bool> SelectYieldsViewColumnsAsync(SqliteConnection c, string schema, string view, string body, CancellationToken ct)
    {
        try
        {
            var viewColumns = new List<string>();
            await using (var info = c.CreateCommand())
            {
                info.CommandText = $"SELECT name FROM pragma_table_info($v, $s) ORDER BY cid";
                info.Parameters.AddWithValue("$v", view);
                info.Parameters.AddWithValue("$s", schema);
                await using var ir = await info.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await ir.ReadAsync(ct).ConfigureAwait(false)) viewColumns.Add(ir.GetString(0));
            }
            await using var probe = c.CreateCommand();
            probe.CommandText = $"SELECT * FROM (\n{body}\n) LIMIT 0";
            await using var pr = await probe.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (pr.FieldCount != viewColumns.Count) return false;
            for (var i = 0; i < pr.FieldCount; i++)
                if (!string.Equals(pr.GetName(i), viewColumns[i], StringComparison.OrdinalIgnoreCase)) return false;
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }

    [GeneratedRegex(@"^\s*PRAGMA\s+(?:\w+\.)?foreign_keys\s*=\s*(ON|OFF|1|0|TRUE|FALSE|YES|NO)\s*;?\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex ForeignKeysPragma();

    [GeneratedRegex(@"^\s*PRAGMA\s+(?:\w+\.)?foreign_key_check\b", RegexOptions.IgnoreCase)]
    private static partial Regex ForeignKeyCheckPragma();

    public async Task<DdlApplyResult> ApplyAsync(ConnectionProfile profile, string? password, DdlApplyRequest request, CancellationToken ct)
    {
        await using var c = await OpenAsync(profile, ct).ConfigureAwait(false);

        // PRAGMA foreign_keys is a no-op inside a transaction: switch it around the transaction instead.
        var body = new List<string>(request.Statements.Count);
        bool? fkOff = null;
        foreach (var sql in request.Statements)
        {
            var m = ForeignKeysPragma().Match(sql ?? "");
            if (m.Success)
            {
                var on = m.Groups[1].Value.ToUpperInvariant() is "ON" or "1" or "TRUE" or "YES";
                if (!on) fkOff = true;
                body.Add(""); // keep statement indexes stable
                continue;
            }
            body.Add(sql ?? "");
        }

        // PRAGMA foreign_key_check reports every violation of the database, including ones that were there before (data loaded
        // with foreign keys off): only violations that are new compared to this baseline fail the apply.
        Dictionary<(string Table, string Parent), int>? baseline = null;
        if (body.Any(s => ForeignKeyCheckPragma().IsMatch(s))) baseline = CountViolations(await ReadViolationsAsync(c, ct).ConfigureAwait(false));

        var before = Convert.ToInt64(await ScalarAsync(c, "PRAGMA foreign_keys", ct).ConfigureAwait(false));
        if (fkOff == true) await ExecAsync(c, "PRAGMA foreign_keys = OFF", ct).ConfigureAwait(false);
        try
        {
            var runner = new DdlApplyRunner
            {
                MapError = (ex, _) => SqliteProvider.ToError(ex),
                // A console holding a lock must not make the apply hang: wait up to the busy timeout, and let a cancel
                // (request aborted) end the driver's busy-retry loop, which sqlite3_interrupt alone does not.
                CommandTimeoutSeconds = SqliteConnections.BusyTimeoutSeconds(profile),
                Execute = async (cmd, token) =>
                {
                    await using var stopWaiting = token.Register(static c => SqliteConnections.StopBusyWait((DbCommand)c!), cmd);
                    if (!ForeignKeyCheckPragma().IsMatch(cmd.CommandText))
                    {
                        await cmd.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                        return;
                    }
                    var violations = new List<(string Table, string Row, string Parent)>();
                    await using (var r = await cmd.ExecuteReaderAsync(token).ConfigureAwait(false))
                        while (await r.ReadAsync(token).ConfigureAwait(false))
                            violations.Add((Convert.ToString(r.GetValue(0)) ?? "", Convert.ToString(r.GetValue(1)) ?? "", Convert.ToString(r.GetValue(2)) ?? ""));
                    var problems = NewViolations(violations, baseline).Take(5).Select(v => $"{v.Table} row {v.Row} → {v.Parent}").ToList();
                    if (problems.Count > 0)
                        throw new ForeignKeyCheckException("Foreign key check failed: " + string.Join("; ", problems) + ".");
                },
            };
            return await runner.RunAsync(c, body, request.Transactional, ct).ConfigureAwait(false);
        }
        finally
        {
            if (fkOff == true)
            {
                try { await ExecAsync(c, before != 0 ? "PRAGMA foreign_keys = ON" : "PRAGMA foreign_keys = OFF", CancellationToken.None).ConfigureAwait(false); }
                catch (SqliteException) { /* the connection closes right after */ }
            }
        }
    }

    private sealed class ForeignKeyCheckException(string message) : Exception(message);

    private static async Task<List<(string Table, string Row, string Parent)>> ReadViolationsAsync(SqliteConnection c, CancellationToken ct)
    {
        var list = new List<(string, string, string)>();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "PRAGMA foreign_key_check";
        await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
        while (await r.ReadAsync(ct).ConfigureAwait(false))
            list.Add((Convert.ToString(r.GetValue(0)) ?? "", Convert.ToString(r.GetValue(1)) ?? "", Convert.ToString(r.GetValue(2)) ?? ""));
        return list;
    }

    private static Dictionary<(string Table, string Parent), int> CountViolations(IEnumerable<(string Table, string Row, string Parent)> violations) =>
        violations.GroupBy(v => (v.Table, v.Parent)).ToDictionary(g => g.Key, g => g.Count());

    /// <summary>
    /// Violations beyond those of the baseline. Row ids change across a rebuild, so the comparison is per (child table, parent
    /// table): a group with more rows than before is reported in full, one with the same or fewer is not.
    /// </summary>
    internal static IEnumerable<(string Table, string Row, string Parent)> NewViolations(
        IReadOnlyList<(string Table, string Row, string Parent)> now, Dictionary<(string Table, string Parent), int>? baseline)
    {
        if (baseline is null) return now;
        var counts = CountViolations(now);
        return now.Where(v => counts[(v.Table, v.Parent)] > baseline.GetValueOrDefault((v.Table, v.Parent)));
    }

    private static async Task<object?> ScalarAsync(SqliteConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        return await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false);
    }

    private static async Task ExecAsync(DbConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }
}
