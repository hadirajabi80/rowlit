using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Import.Generate;

namespace DbStudio.Import.Tests.Generate;

/// <summary>End-to-end generate runs through the real service, catalog, job manager and import writers over SQLite (always runs).</summary>
public sealed class GenerateSqliteTests : IDisposable
{
    private readonly Harness _h = new();
    public void Dispose() => _h.Dispose();

    private const string Schema = """
        CREATE TABLE customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            age INTEGER CHECK (age >= 21 AND age <= 65),
            status TEXT NOT NULL CHECK (status IN ('new', 'active', 'closed')),
            created_at TEXT,
            is_active INTEGER
        );
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            total NUMERIC,
            placed DATE,
            note TEXT
        );
        """;

    private async Task<string> NewDb()
    {
        var cid = _h.NewSqlite(out _);
        foreach (var stmt in Schema.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) await _h.ExecAsync(cid, stmt);
        return cid;
    }

    private async Task<GenerateRequest> RequestFromPlan(string cid, string table, long rows, long seed = 7, Action<GenerateColumn>? tweak = null)
    {
        var plan = await _h.Generate.PlanAsync(cid, null, null, table, default);
        foreach (var c in plan.Columns) tweak?.Invoke(c);
        return new GenerateRequest { ConnectionId = cid, Table = table, Rows = rows, Seed = seed, Columns = plan.Columns.ToList() };
    }

    private async Task<GenerateSummary> Run(GenerateRequest req)
    {
        var jobId = _h.Generate.Start(req, null);
        await _h.Jobs.WaitAsync(jobId);
        var done = _h.Events.Done(jobId) ?? throw new InvalidOperationException("The job did not finish.");
        if (done.Status != ExecutionStatus.Ok) throw new InvalidOperationException($"Job {done.Status}: {done.Error}");
        LastJob = jobId;
        return done.Result!.Value.Deserialize<GenerateSummary>(CoreJson.Options)!;
    }

    private string LastJob = "";

    [Fact]
    public async Task Plan_infers_generators_from_names_types_and_constraints()
    {
        var cid = await NewDb();
        var plan = await _h.Generate.PlanAsync(cid, null, null, "customers", default);
        Assert.True(plan.CanGenerate);
        Assert.Equal(1000, plan.DefaultRows);
        var by = plan.Columns.ToDictionary(c => c.Name);
        Assert.Equal(7, by.Count);
        Assert.Equal("skip", by["id"].Generator);               // AUTOINCREMENT key: left to the database
        Assert.True(by["id"].IsIdentity || by["id"].IsPk);
        Assert.Equal("full_name", by["name"].Generator);         // table "customers" is people
        Assert.Equal("email", by["email"].Generator);
        Assert.True(by["email"].Unique);                         // UNIQUE column
        Assert.Equal("int", by["age"].Generator);
        Assert.Equal(("21", "65"), (by["age"].Options["min"], by["age"].Options["max"])); // CHECK range
        Assert.Equal("list", by["status"].Generator);            // CHECK IN list
        Assert.Equal("new\nactive\nclosed", by["status"].Options["values"]);
        Assert.True(plan.Seed > 0);
    }

    [Fact]
    public async Task Plan_links_foreign_keys_and_warns_about_an_empty_parent()
    {
        var cid = await NewDb();
        var plan = await _h.Generate.PlanAsync(cid, null, null, "orders", default);
        var fk = Assert.Single(plan.ForeignKeys);
        Assert.Equal("customers", fk.RefTable);
        Assert.False(fk.ParentHasRows);
        var col = plan.Columns.First(c => c.Name == "customer_id");
        Assert.Equal("foreignKey", col.Generator);
        Assert.Contains(plan.Warnings, w => w.Contains("customers") && w.Contains("no rows"));
        await _h.ExecAsync(cid, "INSERT INTO customers (name, email, status) VALUES ('A', 'a@x', 'new')");
        plan = await _h.Generate.PlanAsync(cid, null, null, "orders", default);
        Assert.True(plan.ForeignKeys[0].ParentHasRows);
        Assert.DoesNotContain(plan.Warnings, w => w.Contains("no rows"));
    }

    [Fact]
    public async Task Generates_rows_that_satisfy_types_checks_and_uniqueness()
    {
        var cid = await NewDb();
        var req = await RequestFromPlan(cid, "customers", 2500);
        var s = await Run(req);
        Assert.Equal("completed", s.Outcome);
        Assert.Equal(2500, s.RowsWritten);
        Assert.True(s.Committed);
        Assert.Equal(2500L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers"));
        Assert.Equal(2500L, await _h.ScalarAsync(cid, "SELECT COUNT(DISTINCT email) FROM customers"));
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers WHERE status NOT IN ('new','active','closed')"));
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers WHERE age < 21 OR age > 65"));
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers WHERE name IS NULL OR name = ''"));
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers WHERE email NOT LIKE '%@%'"));
        Assert.NotNull(await _h.ScalarAsync(cid, "SELECT created_at FROM customers LIMIT 1")); // nullable column: most rows have a value
        Assert.True(_h.Events.Progress(LastJob) > 0);
        Assert.Equal("completed", s.Outcome);
    }

    [Fact]
    public async Task The_same_seed_gives_the_same_data_and_the_preview_matches_the_run()
    {
        var cid = await NewDb();
        var req = await RequestFromPlan(cid, "customers", 300, seed: 99);
        req.PreviewRows = 10;
        var preview = await _h.Generate.PreviewAsync(req, default);
        Assert.Equal(10, preview.Rows.Count);
        Assert.Equal(99, preview.Seed);
        Assert.Equal(["name", "email", "age", "status", "created_at", "is_active"], preview.Columns.Select(c => c.Name));

        await Run(req);
        var first = (string)(await _h.ScalarAsync(cid, "SELECT group_concat(email, '|') FROM (SELECT email FROM customers ORDER BY id)"))!;
        var emails = preview.Rows.Select(r => r[1]).ToList();
        Assert.StartsWith(string.Join("|", emails), first);

        req.TruncateFirst = true;
        var s = await Run(req);
        Assert.True(s.Truncated);
        var second = (string)(await _h.ScalarAsync(cid, "SELECT group_concat(email, '|') FROM (SELECT email FROM customers ORDER BY id)"))!;
        Assert.Equal(first, second);
        Assert.Equal(300L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers"));

        req.Seed = 100;
        await Run(req);
        Assert.NotEqual(first, (string)(await _h.ScalarAsync(cid, "SELECT group_concat(email, '|') FROM (SELECT email FROM customers ORDER BY id)"))!);
    }

    [Fact]
    public async Task Append_without_truncate_keeps_existing_rows()
    {
        var cid = await NewDb();
        await Run(await RequestFromPlan(cid, "customers", 100, seed: 1));
        var s = await Run(await RequestFromPlan(cid, "customers", 50, seed: 2));
        Assert.False(s.Truncated);
        Assert.Equal(150L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers"));
        Assert.Equal(150L, await _h.ScalarAsync(cid, "SELECT COUNT(DISTINCT email) FROM customers"));
    }

    [Fact]
    public async Task Foreign_key_columns_reference_existing_parent_rows()
    {
        var cid = await NewDb();
        await Run(await RequestFromPlan(cid, "customers", 40));
        var req = await RequestFromPlan(cid, "orders", 1500, seed: 5);
        var s = await Run(req);
        Assert.Equal("completed", s.Outcome);
        Assert.Equal(1500L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM orders"));
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM orders WHERE customer_id NOT IN (SELECT id FROM customers)"));
        Assert.True((long)(await _h.ScalarAsync(cid, "SELECT COUNT(DISTINCT customer_id) FROM orders"))! > 30); // spread over the parents
        // ids continue after the table's maximum: the second run starts after the first
        var maxBefore = (long)(await _h.ScalarAsync(cid, "SELECT MAX(id) FROM orders"))!;
        Assert.Equal(1500, maxBefore);
        await Run(await RequestFromPlan(cid, "orders", 10, seed: 6));
        Assert.Equal(1510L, await _h.ScalarAsync(cid, "SELECT MAX(id) FROM orders"));
        Assert.Equal(1510L, await _h.ScalarAsync(cid, "SELECT COUNT(DISTINCT id) FROM orders"));
    }

    [Fact]
    public async Task Truncating_restarts_a_sequence_at_one()
    {
        var cid = await NewDb();
        await Run(await RequestFromPlan(cid, "customers", 20));
        var req = await RequestFromPlan(cid, "orders", 30, seed: 3);
        await Run(req);
        req.TruncateFirst = true;
        await Run(req);
        Assert.Equal(1L, await _h.ScalarAsync(cid, "SELECT MIN(id) FROM orders"));
        Assert.Equal(30L, await _h.ScalarAsync(cid, "SELECT MAX(id) FROM orders"));
    }

    [Fact]
    public async Task A_self_reference_with_truncate_starts_from_no_parents()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE emp (id INTEGER PRIMARY KEY, boss_id INTEGER REFERENCES emp(id), name TEXT)");
        await _h.ExecAsync(cid, "INSERT INTO emp (id, boss_id, name) VALUES (1, NULL, 'x')");
        var req = await RequestFromPlan(cid, "emp", 10);
        req.TruncateFirst = true;
        var s = await Run(req);
        Assert.Equal("completed", s.Outcome);
        Assert.Equal(10L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM emp"));
        Assert.Equal(10L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM emp WHERE boss_id IS NULL")); // the old row is gone, parents were empty
    }

    [Fact]
    public async Task A_required_parent_without_rows_is_refused_with_a_clear_message()
    {
        var cid = await NewDb();
        var req = await RequestFromPlan(cid, "orders", 10);
        var ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(req, default));
        Assert.Equal(400, ex.Status);
        Assert.Contains("customers", ex.Message);
        Assert.Contains("no rows", ex.Message);
    }

    [Fact]
    public async Task Not_enough_unique_values_is_refused_before_anything_is_written()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE codes (id INTEGER PRIMARY KEY, code INTEGER UNIQUE)");
        var req = await RequestFromPlan(cid, "codes", 50, tweak: c =>
        {
            if (c.Name == "code") { c.Generator = "int"; c.Options = new() { ["min"] = "1", ["max"] = "10" }; }
        });
        var ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(req, default));
        Assert.Contains("50", ex.Message);
        Assert.Contains("10", ex.Message);
        var plan = await _h.Generate.PlanAsync(cid, null, null, "codes", default);
        Assert.True(plan.Columns.First(c => c.Name == "code").Unique);
        // exactly enough values works and uses every one of them
        req.Rows = 10;
        var s = await Run(req);
        Assert.Equal("completed", s.Outcome);
        Assert.Equal(10L, await _h.ScalarAsync(cid, "SELECT COUNT(DISTINCT code) FROM codes"));
        Assert.Equal(1L, await _h.ScalarAsync(cid, "SELECT MIN(code) FROM codes"));
        Assert.Equal(10L, await _h.ScalarAsync(cid, "SELECT MAX(code) FROM codes"));
    }

    [Fact]
    public async Task Rows_the_server_rejects_stop_the_run_or_are_skipped_and_reported()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE r (id INTEGER PRIMARY KEY, x INTEGER)");
        await _h.ExecAsync(cid, "CREATE TRIGGER r_check BEFORE INSERT ON r WHEN NEW.x >= 6 BEGIN SELECT RAISE(ABORT, 'x too big'); END");
        Action<GenerateColumn> tweak = c => { if (c.Name == "x") { c.Generator = "int"; c.Options = new() { ["min"] = "1", ["max"] = "10" }; c.NullPercent = 0; } };

        var req = await RequestFromPlan(cid, "r", 200, tweak: tweak);
        var s = await Run(req);
        Assert.Equal("failed", s.Outcome);
        Assert.Contains("x too big", s.Error);
        Assert.True(s.RolledBack);
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM r"));   // nothing is left behind
        Assert.Equal(0L, s.RowsWritten);

        req.OnError = "skip";
        s = await Run(req);
        Assert.Equal("completedWithErrors", s.Outcome);
        Assert.True(s.ErrorCount > 0);
        Assert.Equal(200, s.RowsWritten + s.RowsSkipped);
        Assert.Equal(s.RowsWritten, (long)(await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM r"))!);
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM r WHERE x >= 6"));
        Assert.True(s.HasErrorReport);
        Assert.NotEmpty(s.ErrorsSample);
        Assert.NotNull(_h.Generate.ErrorReportPath(LastJob));
        Assert.Contains("x too big", File.ReadAllText(_h.Generate.ErrorReportPath(LastJob)!));
    }

    [Fact]
    public async Task Cancelling_rolls_everything_back()
    {
        var cid = await NewDb();
        var req = await RequestFromPlan(cid, "customers", 3_000_000);
        req.BatchSize = 500;
        var jobId = _h.Generate.Start(req, null);
        for (var i = 0; i < 400 && _h.Events.Progress(jobId) < 3; i++) await Task.Delay(25);
        Assert.True(_h.Events.Progress(jobId) >= 3, "the job never reported progress");
        Assert.True(_h.Jobs.Cancel(jobId));
        await _h.Jobs.WaitAsync(jobId);
        var done = _h.Events.Done(jobId)!;
        // the job result is still delivered as a summary of the cancelled run
        var summary = done.Result?.Deserialize<GenerateSummary>(CoreJson.Options);
        if (summary is not null)
        {
            Assert.Equal("cancelled", summary.Outcome);
            Assert.True(summary.RolledBack);
        }
        Assert.Equal(0L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM customers"));
    }

    [Fact]
    public async Task Per_batch_commits_keep_what_was_written_before_a_failure()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE b (id INTEGER PRIMARY KEY, x INTEGER)");
        await _h.ExecAsync(cid, "CREATE TRIGGER b_check BEFORE INSERT ON b WHEN NEW.x = 999 BEGIN SELECT RAISE(ABORT, 'poison'); END");
        var req = await RequestFromPlan(cid, "b", 1000, tweak: c =>
        {
            if (c.Name == "x") { c.Generator = "sequence"; c.Options = new() { ["start"] = "500", ["step"] = "1" }; c.NullPercent = 0; }
        });
        req.Transaction = false;
        req.BatchSize = 100;
        var s = await Run(req);
        Assert.Equal("failed", s.Outcome);
        Assert.False(s.RolledBack);
        Assert.True(s.Committed);
        Assert.Equal(499L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM b")); // 500..998 written, the poisoned row stops the run
    }

    [Fact]
    public async Task Validation_errors_name_the_problem()
    {
        var cid = await NewDb();
        var good = await RequestFromPlan(cid, "customers", 10);

        var bad = await RequestFromPlan(cid, "customers", 10, tweak: c => { if (c.Name == "age") c.Generator = "email"; });
        var ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(bad, default));
        Assert.Contains("cannot fill column 'age'", ex.Message);

        bad = await RequestFromPlan(cid, "customers", 10, tweak: c => { if (c.Name == "age") c.Options = new() { ["min"] = "x" }; });
        ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(bad, default));
        Assert.Contains("'min'", ex.Message);

        bad = await RequestFromPlan(cid, "customers", 10, tweak: c => { if (c.Name == "age") c.Generator = "nope"; });
        ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(bad, default));
        Assert.Contains("Unknown generator", ex.Message);

        bad = await RequestFromPlan(cid, "customers", 10, tweak: c => { if (c.Name == "name") c.Generator = "foreignKey"; });
        ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(bad, default));
        Assert.Contains("not part of a foreign key", ex.Message);

        good.Columns.Add(new GenerateColumn { Name = "ghost", Generator = "word" });
        ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(good, default));
        Assert.Contains("no column 'ghost'", ex.Message);

        good.Columns.RemoveAt(good.Columns.Count - 1);
        good.Rows = 0;
        ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(good, default));
        Assert.Contains("Rows must be between", ex.Message);

        good.Rows = 10;
        good.Table = "missing_table";
        await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(good, default));

        foreach (var c in good.Columns) c.Generator = "skip";
        good.Table = "customers";
        ex = await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PreviewAsync(good, default));
        Assert.Contains("nothing to generate", ex.Message);
    }

    [Fact]
    public async Task Read_only_connections_cannot_generate()
    {
        var cid = await NewDb();
        var req = await RequestFromPlan(cid, "customers", 5);
        var profile = _h.Connections.Get(cid);
        _h.Connections.Update(cid, new ConnectionProfile { Name = profile.Name, ProviderId = profile.ProviderId, Props = profile.Props, ReadOnly = true }, null);
        var plan = await _h.Generate.PlanAsync(cid, null, null, "customers", default);
        Assert.False(plan.CanGenerate);
        Assert.Contains("read-only", plan.Reason);
        var ex = Assert.Throws<EngineException>(() => _h.Generate.Start(req, null));
        Assert.Contains("read-only", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Skipped_columns_use_their_database_defaults()
    {
        var cid = _h.NewSqlite(out _);
        await _h.ExecAsync(cid, "CREATE TABLE d (id INTEGER PRIMARY KEY, tag TEXT NOT NULL DEFAULT 'dflt', n INTEGER)");
        var req = await RequestFromPlan(cid, "d", 20, tweak: c => { if (c.Name == "tag") c.Generator = "skip"; });
        var s = await Run(req);
        Assert.Equal("completed", s.Outcome);
        Assert.Equal(20L, await _h.ScalarAsync(cid, "SELECT COUNT(*) FROM d WHERE tag = 'dflt'"));
    }

    [Fact]
    public async Task Non_relational_or_unknown_connections_are_rejected()
    {
        await Assert.ThrowsAsync<EngineException>(() => _h.Generate.PlanAsync("nope", null, null, "t", default));
    }

    [Fact]
    public void Endpoint_catalog_lists_generators_with_options()
    {
        var all = GeneratorCatalog.All;
        var email = all.First(g => g.Id == "email");
        Assert.Contains("text", email.Kinds);
        var seq = all.First(g => g.Id == "sequence");
        Assert.Equal("auto", seq.Options.First(o => o.Key == "start").Default);
        var json = JsonSerializer.Serialize(all, CoreJson.Options);
        Assert.Contains("\"kinds\":[", json);
        Assert.Contains("\"group\":", json);
    }

}
