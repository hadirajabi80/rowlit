using DbStudio.Core.DataCompare;
using DbStudio.Core.Services;

namespace DbStudio.DataCompare.Tests;

/// <summary>
/// End to end on SQLite files (no server needed, also with DBSTUDIO_IT=0): compare, page, script, apply, compare again;
/// both directions, query sides, duplicates, the engine-sort fallback, limits and read-only connections.
/// </summary>
public sealed class SqliteDataCompareTests
{
    private static async Task<(TestEnv Env, Scratch Src, Scratch Dst)> PairAsync(bool readOnlyTarget = false)
    {
        var env = new TestEnv();
        var src = await Scratch.CreateAsync(env, Kind.Sqlite);
        var dst = await Scratch.CreateAsync(env, Kind.Sqlite, readOnlyTarget);
        await src.SeedItemsAsync();
        await dst.SeedItemsAsync();
        await dst.MutateAsync();
        return (env, src, dst);
    }

    private static Task<DataCompareResult> CompareAsync(DataCompareService svc, Scratch src, Scratch dst, DataCompareOptions? options = null, string table = "items") =>
        svc.CompareAsync(new DataCompareRequest(src.Side(table), dst.Side(table), options), null, CancellationToken.None);

    [Fact]
    public async Task Compare_classifies_the_injected_differences_then_sync_makes_the_target_equal()
    {
        var (env, src, dst) = await PairAsync();
        await using var _1 = src;
        await using var _2 = dst;
        var svc = new DataCompareService(env);
        var progress = new List<DataCompareProgress>();
        var r = await svc.CompareAsync(new DataCompareRequest(src.Side("items"), dst.Side("items")), (p, _) => progress.Add(p), CancellationToken.None);

        Assert.Equal(new DataCompareCounts(592, 5, 3, 4, 0), r.Counts);
        Assert.Equal(["id"], r.KeyColumns);
        Assert.Equal(DataOrderings.Server, r.Ordering);
        Assert.Equal(600, r.SourceRows);
        Assert.Equal(601, r.TargetRows);
        Assert.Equal(12, r.KeptDifferences);
        Assert.False(r.TruncatedDiffs);
        Assert.True(r.Sync.ToTarget && r.Sync.ApplyToTarget);
        Assert.Contains(progress, p => p.Phase == "done");

        // the changed row 40 differs in qty and active, nothing else
        var cols = r.Columns.Select(c => c.Name).ToList();
        var row40 = r.Sample.Single(d => d.Class == DiffClasses.Changed && Equals(d.Source![0], 40L));
        Assert.Equal(new[] { cols.IndexOf("qty"), cols.IndexOf("active") }.Order(), row40.Changed!.Order());
        Assert.Equal([100L, 200L, 300L], r.Sample.Where(d => d.Class == DiffClasses.OnlyInSource).Select(d => (long)d.Source![0]!));
        Assert.Equal([9001L, 9002L, 9003L, 9004L], r.Sample.Where(d => d.Class == DiffClasses.OnlyInTarget).Select(d => (long)d.Target![0]!));

        var page = svc.Rows(r.CompareId, DiffClasses.OnlyInTarget, 1, 2);
        Assert.Equal(4, page.Total);
        Assert.Equal([9002L, 9003L], page.Rows.Select(x => (long)x.Target![0]!));
        Assert.Equal(12, svc.Rows(r.CompareId, null, 0, 100).Total);

        var script = svc.Script(r.CompareId, null);
        Assert.Equal((3L, 5L, 4L), (script.Inserts, script.Updates, script.Deletes));
        Assert.Equal(dst.ConnectionId, script.ConnectionId);
        Assert.Contains("DELETE FROM \"items\" WHERE \"id\" IN (9001, 9002, 9003, 9004);", script.Text);
        Assert.Contains("UPDATE \"items\" SET", script.Text);

        var applied = await svc.ApplyAsync(r.CompareId, null, CancellationToken.None);
        Assert.True(applied.Status == "ok", string.Join("; ", applied.Failures.Select(f => f.Message + " :: " + f.Sql)));
        Assert.Equal((3L, 5L, 4L), (applied.Inserted, applied.Updated, applied.Deleted));

        var again = await CompareAsync(svc, src, dst);
        Assert.Equal(new DataCompareCounts(600, 0, 0, 0, 0), again.Counts);
        Assert.Empty(again.Sample);
    }

    [Fact]
    public async Task Sync_to_the_source_and_selected_classes_only()
    {
        var (env, src, dst) = await PairAsync();
        await using var _1 = src;
        await using var _2 = dst;
        var svc = new DataCompareService(env);
        var r = await CompareAsync(svc, src, dst);

        // only bring the target's extra rows into the source
        var script = svc.Script(r.CompareId, new DataSyncRequest([DiffClasses.OnlyInTarget], SyncDirections.ToSource));
        Assert.Equal((4L, 0L, 0L), (script.Inserts, script.Updates, script.Deletes));
        Assert.Equal(src.ConnectionId, script.ConnectionId);
        var applied = await svc.ApplyAsync(r.CompareId, new DataApplyRequest([DiffClasses.OnlyInTarget], SyncDirections.ToSource), CancellationToken.None);
        Assert.Equal("ok", applied.Status);

        var again = await CompareAsync(svc, src, dst);
        Assert.Equal(new DataCompareCounts(596, 5, 3, 0, 0), again.Counts);
        Assert.Throws<EngineException>(() => svc.Script(r.CompareId, new DataSyncRequest([DiffClasses.Duplicate])));
    }

    [Fact]
    public async Task Two_tables_of_one_file_compare_and_sync()
    {
        var env = new TestEnv();
        await using var db = await Scratch.CreateAsync(env, Kind.Sqlite);
        await db.SeedItemsAsync("items");
        await db.SeedItemsAsync("items_copy");
        await db.MutateAsync("items_copy");
        var svc = new DataCompareService(env);
        var r = await svc.CompareAsync(new DataCompareRequest(db.Side("items"), db.Side("items_copy")), null, CancellationToken.None);
        Assert.Equal(new DataCompareCounts(592, 5, 3, 4, 0), r.Counts);
        Assert.Equal("ok", (await svc.ApplyAsync(r.CompareId, null, CancellationToken.None)).Status);
        var again = await svc.CompareAsync(new DataCompareRequest(db.Side("items"), db.Side("items_copy")), null, CancellationToken.None);
        Assert.Equal(0, again.Counts.Differences);
    }

    [Fact]
    public async Task Options_ignore_columns_tolerances_and_filters()
    {
        var (env, src, dst) = await PairAsync();
        await using var _1 = src;
        await using var _2 = dst;
        await dst.ExecAsync("UPDATE items SET price = price + 0.004 WHERE id = 50", "UPDATE items SET name = upper(name) WHERE id = 51");
        var svc = new DataCompareService(env);

        var plain = await CompareAsync(svc, src, dst);
        Assert.Equal(7, plain.Counts.Changed);

        var relaxed = await CompareAsync(svc, src, dst, new DataCompareOptions { NumericTolerance = 0.01, IgnoreCase = true, IgnoreColumns = ["note", "qty", "active"] });
        // 10 (price 999.99) and 20 (renamed) still differ; 30/33 (note), 40 (qty/active), 50 (tolerance), 51 (case) do not
        Assert.Equal(2, relaxed.Counts.Changed);
        Assert.False(relaxed.Columns.Single(c => c.Name == "note").Compared);

        var only = await CompareAsync(svc, src, dst, new DataCompareOptions { Columns = ["note"] });
        Assert.Equal(2, only.Counts.Changed);

        var filtered = await svc.CompareAsync(new DataCompareRequest(src.Side("items", "id <= 100"), dst.Side("items", "id <= 100")), null, CancellationToken.None);
        Assert.Equal(new DataCompareCounts(92, 7, 1, 0, 0), filtered.Counts); // 50 and 51 were changed above
    }

    [Fact]
    public async Task Engine_ordering_gives_the_same_result()
    {
        var (env, src, dst) = await PairAsync();
        await using var _1 = src;
        await using var _2 = dst;
        var svc = new DataCompareService(env);
        var r = await CompareAsync(svc, src, dst, new DataCompareOptions { Ordering = DataOrderings.Engine });
        Assert.Equal(DataOrderings.Engine, r.Ordering);
        Assert.Equal(new DataCompareCounts(592, 5, 3, 4, 0), r.Counts);
        Assert.Equal(600, r.SourceRows);
    }

    [Fact]
    public async Task A_server_order_the_comparer_disagrees_with_falls_back_to_the_engine()
    {
        var env = new TestEnv();
        await using var a = await Scratch.CreateAsync(env, Kind.Sqlite);
        await using var b = await Scratch.CreateAsync(env, Kind.Sqlite);
        // SQLite sorts integers before text in an INTEGER column; the comparer sorts '10x' as text before '2'
        foreach (var s in new[] { a, b })
            await s.ExecAsync("CREATE TABLE m (k integer NOT NULL, v text)",
                "INSERT INTO m VALUES (1, 'a'), (2, 'b'), ('10x', 'c')");
        await b.ExecAsync("UPDATE m SET v = 'B' WHERE k = 2");
        var svc = new DataCompareService(env);
        var r = await svc.CompareAsync(new DataCompareRequest(a.Side("m"), b.Side("m"), new DataCompareOptions { KeyColumns = ["k"] }), null, CancellationToken.None);
        Assert.Equal(DataOrderings.Engine, r.Ordering);
        Assert.Equal(new DataCompareCounts(2, 1, 0, 0, 0), r.Counts);
        Assert.Contains(r.Notes, n => n.Contains("sorted by the engine", StringComparison.Ordinal));

        var forced = await Assert.ThrowsAsync<EngineException>(() =>
            svc.CompareAsync(new DataCompareRequest(a.Side("m"), b.Side("m"), new DataCompareOptions { KeyColumns = ["k"], Ordering = DataOrderings.Server }), null, CancellationToken.None));
        Assert.Contains("engine ordering", forced.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Keys_of_different_kinds_are_sorted_by_the_engine()
    {
        var env = new TestEnv();
        await using var a = await Scratch.CreateAsync(env, Kind.Sqlite);
        await using var b = await Scratch.CreateAsync(env, Kind.Sqlite);
        await a.ExecAsync("CREATE TABLE t (id integer PRIMARY KEY, v text)", "INSERT INTO t VALUES (1, 'a'), (2, 'b'), (10, 'c')");
        await b.ExecAsync("CREATE TABLE t (id varchar(10) PRIMARY KEY, v text)", "INSERT INTO t VALUES ('1', 'a'), ('10', 'c'), ('2', 'x')");
        var svc = new DataCompareService(env);
        var r = await svc.CompareAsync(new DataCompareRequest(a.Side("t"), b.Side("t")), null, CancellationToken.None);
        Assert.Equal(DataOrderings.Engine, r.Ordering);
        Assert.Equal(new DataCompareCounts(2, 1, 0, 0, 0), r.Counts);
    }

    [Fact]
    public async Task Duplicate_keys_without_a_primary_key_are_reported_and_not_synced()
    {
        var env = new TestEnv();
        await using var a = await Scratch.CreateAsync(env, Kind.Sqlite);
        await using var b = await Scratch.CreateAsync(env, Kind.Sqlite);
        await a.ExecAsync("CREATE TABLE p (code text, qty integer)", "INSERT INTO p VALUES ('a', 1), ('b', 2), ('b', 3), ('c', 4)");
        await b.ExecAsync("CREATE TABLE p (code text, qty integer)", "INSERT INTO p VALUES ('a', 1), ('b', 2), ('c', 5), (NULL, 9)");
        var svc = new DataCompareService(env);

        var noKey = await Assert.ThrowsAsync<EngineException>(() => svc.CompareAsync(new DataCompareRequest(a.Side("p"), b.Side("p")), null, CancellationToken.None));
        Assert.Contains("primary key", noKey.Message, StringComparison.Ordinal);
        var preview = await svc.PreviewAsync(new DataCompareRequest(a.Side("p"), b.Side("p")), CancellationToken.None);
        Assert.Empty(preview.KeyColumns);
        Assert.Equal(["code", "qty"], preview.Columns.Select(c => c.Name));

        var r = await svc.CompareAsync(new DataCompareRequest(a.Side("p"), b.Side("p"), new DataCompareOptions { KeyColumns = ["code"] }), null, CancellationToken.None);
        Assert.Equal(new DataCompareCounts(1, 1, 0, 1, 3), r.Counts);
        Assert.Contains(r.Notes, n => n.Contains("share their key", StringComparison.Ordinal));
        var script = svc.Script(r.CompareId, null);
        Assert.Equal((0L, 1L, 1L), (script.Inserts, script.Updates, script.Deletes));
        Assert.Contains("\"code\" IS NULL", script.Text);
    }

    [Fact]
    public async Task A_query_side_is_compared_but_only_the_table_side_can_be_synced()
    {
        var (env, src, dst) = await PairAsync();
        await using var _1 = src;
        await using var _2 = dst;
        var svc = new DataCompareService(env);
        var req = new DataCompareRequest(src.QuerySide("SELECT id, code, name FROM items WHERE id <= 50;"), dst.Side("items", "id <= 50"),
            new DataCompareOptions { KeyColumns = ["id"] });
        var preview = await svc.PreviewAsync(req, CancellationToken.None);
        Assert.False(preview.Sync.ToSource);
        Assert.Contains("query", preview.Sync.ToSourceReason, StringComparison.Ordinal);
        Assert.Contains(preview.Notes, n => n.StartsWith("Only in the target", StringComparison.Ordinal));

        var r = await svc.CompareAsync(req, null, CancellationToken.None);
        Assert.Equal(new DataCompareCounts(49, 1, 0, 0, 0), r.Counts); // row 20 was renamed
        Assert.Throws<EngineException>(() => svc.Script(r.CompareId, new DataSyncRequest(null, SyncDirections.ToSource)));
        Assert.Contains("UPDATE \"items\" SET \"name\" = 'Item 20 é' WHERE \"id\" = 20;", svc.Script(r.CompareId, null).Text);
    }

    [Fact]
    public async Task Limits_keep_the_first_differences_and_counts_stay_exact()
    {
        var (env, src, dst) = await PairAsync();
        await using var _1 = src;
        await using var _2 = dst;
        var svc = new DataCompareService(env);
        var r = await CompareAsync(svc, src, dst, new DataCompareOptions { MaxDifferences = 3 });
        Assert.True(r.TruncatedDiffs);
        Assert.Equal(3, r.KeptDifferences);
        Assert.Equal(12, r.Counts.Differences);
        Assert.Contains(svc.Script(r.CompareId, null).Warnings, w => w.Contains("compare again", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_read_only_target_can_be_scripted_but_not_applied()
    {
        var (env, src, dst) = await PairAsync(readOnlyTarget: true);
        await using var _1 = src;
        await using var _2 = dst;
        var svc = new DataCompareService(env);
        var r = await CompareAsync(svc, src, dst);
        Assert.True(r.Sync.ToTarget);
        Assert.False(r.Sync.ApplyToTarget);
        Assert.Equal(12, svc.Script(r.CompareId, null).Inserts + svc.Script(r.CompareId, null).Updates + svc.Script(r.CompareId, null).Deletes);
        var ex = await Assert.ThrowsAsync<EngineException>(() => svc.ApplyAsync(r.CompareId, null, CancellationToken.None));
        Assert.Equal(ErrorCodes.ReadOnly, ex.Code);
    }

    [Fact]
    public async Task Requests_are_validated()
    {
        var (env, src, dst) = await PairAsync();
        await using var _1 = src;
        await using var _2 = dst;
        var svc = new DataCompareService(env);
        async Task<string> Fails(DataCompareRequest req) => (await Assert.ThrowsAsync<EngineException>(() => svc.CompareAsync(req, null, CancellationToken.None))).Message;

        Assert.Contains("same table", await Fails(new DataCompareRequest(src.Side("items"), src.Side("items"))));
        Assert.Contains("target table", await Fails(new DataCompareRequest(src.Side("items"), dst.Side(" "))));
        Assert.Contains("single condition", await Fails(new DataCompareRequest(src.Side("items", "1=1; DELETE FROM items"), dst.Side("items"))));
        Assert.Contains("was not found", await Fails(new DataCompareRequest(src.Side("nope"), dst.Side("items"))));
        Assert.Contains("not on both sides", await Fails(new DataCompareRequest(src.Side("items"), dst.Side("items"), new DataCompareOptions { KeyColumns = ["zzz"] })));
        Assert.Contains("maxDifferences", await Fails(new DataCompareRequest(src.Side("items"), dst.Side("items"), new DataCompareOptions { MaxDifferences = 0 })));
        var gone = Assert.Throws<EngineException>(() => svc.Rows("dcmp_nope", null, 0, 10));
        Assert.Equal(404, gone.Status);
    }
}
