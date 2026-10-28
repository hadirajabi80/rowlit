using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;

namespace DbStudio.Transfer.Tests;

/// <summary>
/// Transfers that need no server: SQLite files as source and target, and .sql dumps in every target dialect. These run
/// always (also with DBSTUDIO_IT=0).
/// </summary>
public sealed class SqliteTransferTests
{
    private static async Task<(TestEnv Env, Scratch Src)> SeededAsync()
    {
        var env = new TestEnv();
        var src = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        await src.SeedLibraryAsync();
        return (env, src);
    }

    private static List<TransferTableSpec> Library() => new[] { "authors", "books", "big" }.Select(n => new TransferTableSpec(n)).ToList();

    private static string TempFile(string ext) => Path.Combine(Path.GetTempPath(), Scratch.NewName("dump") + ext);

    [Fact]
    public async Task Overrides_exclusions_filters_and_target_names_reach_the_target()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        await using var dst = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        var svc = new TransferService(env);
        var tables = new List<TransferTableSpec>
        {
            new("authors"),
            new("books", TargetName: "livres", Where: "id < 3", ColumnTypes: new() { ["title"] = "varchar(300)" }, ExcludedColumns: ["rating"]),
        };
        var spec = new TransferSpec(src.AsSource(), dst.AsTarget(), tables, new TransferOptions { NameCase = NameCases.Keep });
        var plan = await svc.PlanAsync(spec, CancellationToken.None);
        var books = plan.Tables.Single(t => t.SourceName == "books");
        Assert.Equal("livres", books.TargetName);
        var title = books.Columns.Single(c => c.Name == "title");
        Assert.True(title.Overridden);
        Assert.Equal("varchar(300)", title.TargetType);
        Assert.True(books.Columns.Single(c => c.Name == "rating").Excluded);
        Assert.Contains(books.CreateStatements, s => s.Contains("varchar(300)", StringComparison.OrdinalIgnoreCase) && !s.Contains("\"rating\"", StringComparison.Ordinal));

        var result = await svc.RunAsync(spec, null, CancellationToken.None);
        Assert.True(result.Status == TransferStatus.Ok, MatrixTests.Describe(result));
        Assert.Equal(3 + 2, result.TotalRows);
        var rows = await dst.QueryAsync("SELECT id, title FROM \"livres\" ORDER BY id");
        Assert.Equal(2, rows.Count);
        Assert.Equal("Notes", rows[0][1]);
        var cols = await dst.QueryAsync("SELECT name FROM pragma_table_info('livres')");
        Assert.DoesNotContain(cols, r => Equals(r[0], "rating"));
    }

    [Fact]
    public async Task Upsert_updates_rows_with_the_same_key_and_inserts_the_rest()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        await using var dst = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        await dst.ExecAsync("CREATE TABLE big (id int not null primary key, payload varchar(50))", "INSERT INTO big VALUES (1, 'stale'), (99999, 'keep')");
        var svc = new TransferService(env);
        var spec = new TransferSpec(src.AsSource(), dst.AsTarget(), [new TransferTableSpec("big")],
            new TransferOptions { CreateMode = CreateModes.SkipExisting, DataMode = DataModes.Upsert, NameCase = NameCases.Keep });
        var result = await svc.RunAsync(spec, null, CancellationToken.None);
        Assert.True(result.Status == TransferStatus.Ok, MatrixTests.Describe(result));
        Assert.Equal("row 1", await dst.ScalarAsync("SELECT payload FROM big WHERE id = 1"));
        Assert.Equal("keep", await dst.ScalarAsync("SELECT payload FROM big WHERE id = 99999"));
        Assert.Equal((Scratch.BigRows + 1).ToString(), Scratch.Norm(await dst.ScalarAsync("SELECT COUNT(*) FROM big")));
    }

    [Fact]
    public async Task Truncate_replaces_the_rows_of_an_existing_table()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        await using var dst = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        await dst.ExecAsync("CREATE TABLE big (id int not null primary key, payload varchar(50))", "INSERT INTO big VALUES (99999, 'gone')");
        var svc = new TransferService(env);
        var spec = new TransferSpec(src.AsSource(), dst.AsTarget(), [new TransferTableSpec("big")],
            new TransferOptions { CreateMode = CreateModes.None, DataMode = DataModes.Truncate, NameCase = NameCases.Keep });
        var result = await svc.RunAsync(spec, null, CancellationToken.None);
        Assert.True(result.Status == TransferStatus.Ok, MatrixTests.Describe(result));
        Assert.Equal(Scratch.BigRows.ToString(), Scratch.Norm(await dst.ScalarAsync("SELECT COUNT(*) FROM big")));
        Assert.Null(await dst.ScalarAsync("SELECT payload FROM big WHERE id = 99999"));
    }

    [Fact]
    public async Task An_existing_table_fails_the_plan_unless_told_otherwise()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        await using var dst = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        await dst.ExecAsync("CREATE TABLE big (id int)");
        var svc = new TransferService(env);
        var spec = new TransferSpec(src.AsSource(), dst.AsTarget(), [new TransferTableSpec("big")], new TransferOptions { NameCase = NameCases.Keep });
        var plan = await svc.PlanAsync(spec, CancellationToken.None);
        Assert.Contains("already exists", plan.Tables[0].Error);
        Assert.True(plan.Tables[0].ExistsInTarget);
        await Assert.ThrowsAsync<EngineException>(() => svc.RunAsync(spec, null, CancellationToken.None));

        var drop = spec with { Options = new TransferOptions { CreateMode = CreateModes.DropExisting, NameCase = NameCases.Keep } };
        var result = await svc.RunAsync(drop, null, CancellationToken.None);
        Assert.True(result.Status == TransferStatus.Ok, MatrixTests.Describe(result));
        Assert.Equal(Scratch.BigRows.ToString(), Scratch.Norm(await dst.ScalarAsync("SELECT COUNT(*) FROM big")));
    }

    [Fact]
    public async Task Cancel_mid_table_stops_and_reports_cancelled()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        await using var dst = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        var svc = new TransferService(env);
        using var cts = new CancellationTokenSource();
        var spec = new TransferSpec(src.AsSource(), dst.AsTarget(), [new TransferTableSpec("big")], new TransferOptions { NameCase = NameCases.Keep, BatchSize = 1 });
        var phases = new List<string>();
        var result = await svc.RunAsync(spec, (p, done, total) =>
        {
            phases.Add(p.Phase);
            if (p.Phase == "data" && p.TableDone > 0) cts.Cancel();
        }, cts.Token);
        Assert.Equal(TransferStatus.Cancelled, result.Status);
        Assert.Contains("data", phases);
        var copied = long.Parse(Scratch.Norm(await dst.ScalarAsync("SELECT COUNT(*) FROM big")));
        Assert.InRange(copied, 1, Scratch.BigRows - 1);
    }

    [Fact]
    public async Task Progress_reports_counting_structure_data_and_overall_totals()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        await using var dst = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        var svc = new TransferService(env);
        var events = new List<(TransferProgress P, long Done, long? Total)>();
        var spec = new TransferSpec(src.AsSource(), dst.AsTarget(), Library(), new TransferOptions { NameCase = NameCases.Keep });
        var result = await svc.RunAsync(spec, (p, d, t) => events.Add((p, d, t)), CancellationToken.None);
        Assert.True(result.Status == TransferStatus.Ok, MatrixTests.Describe(result));
        Assert.Equal("counting", events[0].P.Phase);
        Assert.Contains(events, e => e.P.Phase == "structure" && e.P.Table == "books");
        var last = events.Last(e => e.P.Phase == "data");
        Assert.Equal(3 + 3 + Scratch.BigRows, last.Total);
        Assert.Equal(last.Total, last.Done);
        // the wire form of a progress event is camelCase JSON
        Assert.Contains("\"tableIndex\":", TransferService.ProgressJson(last.P));
    }

    // ------------------------------------------------------------------ SQL dump

    [Theory]
    [InlineData("sqlite")]
    [InlineData("postgresql")]
    [InlineData("mysql")]
    [InlineData("mariadb")]
    [InlineData("sqlserver")]
    [InlineData("oracle")]
    [InlineData("clickhouse")]
    public async Task Dump_writes_a_script_in_the_chosen_dialect(string provider)
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        var path = TempFile(".sql");
        try
        {
            var svc = new TransferService(env);
            var spec = new TransferSpec(src.AsSource(), new TransferTarget(FilePath: path, DumpProvider: provider), Library(), new TransferOptions());
            svc.Check(spec);
            var result = await svc.RunAsync(spec, null, CancellationToken.None);
            Assert.True(result.Status == TransferStatus.Ok, MatrixTests.Describe(result));
            Assert.Equal(Path.GetFullPath(path), result.FilePath);
            Assert.True(result.FileBytes > 0);
            Assert.False(File.Exists(path + ".partial"));
            var text = await File.ReadAllTextAsync(path);
            Assert.StartsWith("-- Rowlit data transfer", text);
            Assert.Contains("CREATE TABLE", text, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("row 1200", text);
            switch (provider)
            {
                case "sqlserver":
                    Assert.Contains("\nGO\n", text);
                    Assert.Contains("SET IDENTITY_INSERT", text);
                    Assert.Contains("N'Ada Lovelace'", text);
                    break;
                case "postgresql":
                    Assert.Contains("OVERRIDING SYSTEM VALUE", text);
                    Assert.Contains("setval(pg_get_serial_sequence", text);
                    Assert.Contains("FOREIGN KEY", text, StringComparison.OrdinalIgnoreCase);
                    break;
                case "mysql" or "mariadb":
                    Assert.Contains("`authors`", text);
                    Assert.Contains("O''Brien \\\\ back\\\\slash", text);
                    break;
                case "oracle":
                    Assert.Contains("INSERT ALL", text);
                    Assert.Contains("\"AUTHORS\"", text);
                    break;
                case "clickhouse":
                    Assert.Contains("MergeTree", text);
                    Assert.DoesNotContain("FOREIGN KEY", text, StringComparison.OrdinalIgnoreCase);
                    break;
            }
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task A_sqlite_dump_runs_on_an_empty_database_and_reproduces_the_rows()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        await using var dst = await Scratch.CreateEmptyAsync(env, Kind.Sqlite);
        var path = TempFile(".sql");
        try
        {
            var svc = new TransferService(env);
            var spec = new TransferSpec(src.AsSource(), new TransferTarget(FilePath: path, DumpProvider: "sqlite"), Library(),
                new TransferOptions { NameCase = NameCases.Keep });
            var result = await svc.RunAsync(spec, null, CancellationToken.None);
            Assert.True(result.Status == TransferStatus.Ok, MatrixTests.Describe(result));

            await dst.ExecAsync(await File.ReadAllTextAsync(path));
            foreach (var (table, cols) in new[] { ("authors", "id, name, bio, born"), ("books", "id, author_id, title, price, rating, big, is_published, published_at, cover, ext_id"), ("big", "id, payload") })
            {
                var expected = await src.QueryAsync($"SELECT {cols} FROM {table} ORDER BY id");
                var actual = await dst.QueryAsync($"SELECT {cols} FROM {table} ORDER BY id");
                Assert.Equal(expected.Count, actual.Count);
                for (var r = 0; r < expected.Count; r++)
                    Assert.Equal(expected[r].Select(Scratch.Norm), actual[r].Select(Scratch.Norm));
            }
            // foreign key and index arrived
            Assert.NotEmpty(await dst.QueryAsync("SELECT * FROM pragma_foreign_key_list('books')"));
            Assert.Contains(await dst.QueryAsync("SELECT name FROM pragma_index_list('books')"), r => Equals(r[0], "ix_books_title"));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task A_dump_into_a_missing_directory_is_refused()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        var path = Path.Combine(Path.GetTempPath(), Scratch.NewName("nodir"), "x.sql");
        var svc = new TransferService(env);
        var spec = new TransferSpec(src.AsSource(), new TransferTarget(FilePath: path, DumpProvider: "sqlite"), Library());
        var ex = await Assert.ThrowsAsync<EngineException>(() => svc.RunAsync(spec, null, CancellationToken.None));
        Assert.Contains("Directory does not exist", ex.Message);
    }

    // ------------------------------------------------------------------ support

    [Fact]
    public async Task Support_tells_sources_from_targets()
    {
        var (env, src) = await SeededAsync();
        await using var _ = src;
        var svc = new TransferService(env);
        var s = svc.Support(src.ConnectionId);
        Assert.True(s.AsSource);
        Assert.True(s.AsTarget);
        Assert.Null(s.Reason);
        Assert.Equal("sqlite", s.ProviderId);

        var ro = Servers.SqliteProfile(Path.Combine(Path.GetTempPath(), "ro.db"), "c_ro");
        ro.ReadOnly = true;
        env.Add(ro, null);
        var r = svc.Support("c_ro");
        Assert.True(r.AsSource);
        Assert.False(r.AsTarget);
        Assert.Contains("read-only", r.Reason);

        env.Add(new ConnectionProfile { Id = "c_sf", Name = "SF", ProviderId = "snowflake" }, null);
        var sf = svc.Support("c_sf");
        Assert.True(sf.AsSource);
        Assert.False(sf.AsTarget);
        Assert.Contains("source only", sf.Reason);
        var spec = new TransferSpec(src.AsSource(), new TransferTarget("c_sf"), Library());
        Assert.Contains("source only", Assert.Throws<EngineException>(() => svc.Check(spec)).Message);
        var dump = new TransferSpec(src.AsSource(), new TransferTarget(FilePath: "x.sql", DumpProvider: "snowflake"), Library());
        Assert.Throws<EngineException>(() => svc.Check(dump));

        Assert.Equal(TransferService.TargetProviders.Order(), svc.DumpDialects().Select(d => d.Provider).Order());
        Assert.Throws<EngineException>(() => svc.Support("nope"));
    }
}
