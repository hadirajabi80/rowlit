using System.Diagnostics;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;

namespace DbStudio.Federation.Tests.WpA;

/// <summary>
/// End to end over two SQLite member databases (no Docker): the linked provider, its console session, the catalog,
/// push-down, caps, the source cache, read-only enforcement and cancellation.
/// </summary>
public sealed class FederatedSessionTests : IAsyncLifetime
{
    private FederationHarness _h = null!;
    private string _link = "";
    private string _crm = "";
    private string _shop = "";

    private const string CrmSeed = """
        CREATE TABLE countries (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, country_id INTEGER REFERENCES countries(id));
        INSERT INTO countries VALUES (1, 'Germany'), (2, 'France'), (3, 'Japan');
        INSERT INTO customers VALUES (1, 'Alice', 'alice@example.com', 1), (2, 'Bob', NULL, 2), (3, 'Chie', 'chie@example.jp', 3),
            (4, 'Dora', 'dora@example.com', 1), (5, 'Emil', NULL, NULL);
        """;

    private const string ShopSeed = """
        CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL, order_date TEXT NOT NULL, total NUMERIC(12,2) NOT NULL);
        CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price NUMERIC(10,2));
        CREATE TABLE order_lines (order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL,
            PRIMARY KEY (order_id, product_id));
        INSERT INTO orders VALUES (1, 1, '2026-01-05 10:00:00', 120.50), (2, 1, '2026-02-11 09:30:00', 19.50), (3, 2, '2026-02-12 14:00:00', 199.00),
            (4, 3, '2026-03-01 08:15:00', 54.15), (5, 4, '2026-03-02 17:45:00', 5.25), (6, 4, '2026-03-03 12:00:00', 249.00);
        INSERT INTO products VALUES (1, 'Keyboard', 49.90), (2, 'Mouse', 19.50), (3, 'Monitor', 199.00), (4, 'Cable', 5.25);
        INSERT INTO order_lines VALUES (1, 1, 2), (1, 2, 1), (2, 2, 1), (3, 3, 1), (4, 1, 1), (4, 4, 1), (6, 3, 1);
        CREATE TABLE big (n INTEGER, payload TEXT);
        WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5000) INSERT INTO big SELECT x, 'row ' || x FROM c;
        CREATE VIEW slow AS SELECT count(*) AS n FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 2000000000) SELECT x FROM c);
        """;

    public async Task InitializeAsync()
    {
        _h = new FederationHarness();
        _crm = _h.AddSqlite("crm", CrmSeed);
        _shop = _h.AddSqlite("shop", ShopSeed);
        _link = _h.AddLink("Sales", new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "crm", ConnectionId = _crm, AllTables = true },
                new LinkMember
                {
                    Alias = "shop", ConnectionId = _shop,
                    Tables =
                    [
                        new MountedTable { Name = "orders" }, new MountedTable { Name = "products" }, new MountedTable { Name = "order_lines", As = "lines" },
                        new MountedTable { Name = "big" }, new MountedTable { Name = "slow" },
                    ],
                },
            ],
            Relations = [new VirtualRelation { Id = "r1", Name = "orders_customers", From = new("shop", "orders"), FromColumns = ["customer_id"], To = new("crm", "customers"), ToColumns = ["id"] }],
        });
        await Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _h.DisposeAsync();

    [Fact]
    public void Linked_provider_is_registered()
    {
        var p = _h.Linked;
        Assert.Equal(Dialect.DuckDb, p.Dialect);
        Assert.Empty(p.FormSpec.Fields);
        Assert.Contains(_h.Providers.All, x => x.Id == "linked");
    }

    [Fact]
    public async Task Cross_member_join_with_group_by()
    {
        var s = await _h.OpenAsync(_link);
        var sink = await FederationHarness.RunAsync(s, """
            SELECT c.name, count(DISTINCT o.id) AS orders, sum(l.qty * p.price) AS amount
            FROM crm.customers c
            JOIN shop.orders o ON o.customer_id = c.id
            JOIN shop.lines l ON l.order_id = o.id
            JOIN shop.products p ON p.id = l.product_id
            GROUP BY c.name ORDER BY c.name
            """);
        var rows = sink.Single();
        Assert.Equal(4, rows.Count);
        Assert.Equal(["Alice", 2L, "138.80"], rows[0].Select(Normalize));
        Assert.Equal(["Bob", 1L, "199.00"], rows[1].Select(Normalize));
        Assert.Equal(["Chie", 1L, "55.15"], rows[2].Select(Normalize));
        Assert.Equal(["Dora", 1L, "199.00"], rows[3].Select(Normalize));
        Assert.Contains(sink.Messages, m => m.Text.StartsWith("crm.customers: 5 rows from SQLite", StringComparison.Ordinal));
        Assert.Equal(ColumnKinds.Decimal, sink.ResultSets[0][2].Kind);
    }

    [Fact]
    public async Task Decimal_results_keep_their_scale()
    {
        // QA round: DECIMAL(38,2) holding 120.50 reached the grid as "120.5" (and a sum of 140.00 as "140"), and materialize
        // had no scale to build the target column from (it fell back to NUMERIC(38,10)).
        var s = await _h.OpenAsync(_link);
        var sink = await FederationHarness.RunAsync(s, "SELECT o.total, sum(o.total) AS everything FROM shop.orders o WHERE o.id = 1 GROUP BY o.total");
        Assert.Equal([2, 2], sink.ResultSets[0].Select(c => c.Scale));
        Assert.Equal(["120.50", "120.50"], sink.Single()[0].Select(v => (string)v!));
    }

    private static object? Normalize(object? v) => v switch
    {
        int i => (long)i,
        double d => d.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
        string s when decimal.TryParse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var m) =>
            m.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture),
        _ => v,
    };

    [Fact]
    public async Task Order_one_total_and_where_push_down()
    {
        var s = await _h.OpenAsync(_link);
        var sink = await FederationHarness.RunAsync(s, "SELECT o.total, c.name FROM shop.orders o JOIN crm.customers c ON c.id = o.customer_id WHERE o.id = 1");
        var rows = sink.Single();
        Assert.Single(rows);
        Assert.Equal(120.50m, decimal.Parse((string)rows[0][0]!, System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal("Alice", rows[0][1]);
        var plan = ((Provider.FederatedSession)s).Context.LastPlan!;
        var orders = plan.Sources.Single(x => x.Table.Table == "orders");
        Assert.Contains("WHERE \"id\" = 1", orders.SourceQuery);
        Assert.Equal(["id", "customer_id", "total"], orders.Columns);
        Assert.Equal(1, orders.Rows);
    }

    [Fact]
    public async Task Catalog_reader_lists_aliases_tables_and_relations()
    {
        var profile = _h.Connections.Get(_link);
        await using var reader = await _h.Linked.OpenCatalogReaderAsync(profile, null, default);
        var schemas = await reader.ListSchemasAsync(null, default);
        Assert.Equal(["crm", "shop"], schemas.Select(x => x.Name));
        Assert.Equal("crm", await reader.GetDefaultSchemaAsync(null, default));
        Assert.Empty(await reader.ListDatabasesAsync(default));
        var shop = await reader.LoadSchemaAsync(null, "shop", default);
        Assert.Contains(shop.Objects, o => o.Name == "lines");
        var orders = shop.Objects.Single(o => o.Name == "orders");
        Assert.Equal("DECIMAL(38,2)", orders.Columns.Single(c => c.Name == "total").TypeText);
        Assert.Contains(orders.ForeignKeys, fk => fk.RefSchema == "crm" && fk.RefTable == "customers");
        var lines = shop.Objects.Single(o => o.Name == "lines");
        Assert.Contains(lines.ForeignKeys, fk => fk.RefSchema == "shop" && fk.RefTable == "orders");
        Assert.Equal("view", shop.Objects.Single(o => o.Name == "slow").Type);
        var ddl = await reader.GetDdlAsync(new ObjectRef(null, "shop", "orders", "table"), default);
        Assert.Contains("CREATE TABLE shop.orders", ddl.Ddl);
    }

    [Fact]
    public async Task Row_cap_truncates_and_warns()
    {
        await using var h = new FederationHarness(s => s["maxRowsPerSource"] = 100);
        var shop = h.AddSqlite("shop", ShopSeed);
        var link = h.AddLink("Capped", new LinkDefinition { Members = [new LinkMember { Alias = "s", ConnectionId = shop, Tables = [new MountedTable { Name = "big" }] }] });
        var session = await h.OpenAsync(link);
        var sink = await FederationHarness.RunAsync(session, "SELECT count(*) FROM s.big");
        Assert.Equal(100L, Convert.ToInt64(sink.Single()[0][0]));
        Assert.Contains(sink.Messages, m => m.Severity == MessageSeverity.Warning && m.Text.Contains("only the first 100 rows", StringComparison.Ordinal));
        var plan = ((Provider.FederatedSession)session).Context.LastPlan!;
        Assert.True(plan.Sources[0].Truncated);
        Assert.Contains(plan.Warnings, w => w.Code == PlanWarningCodes.RowCap);
    }

    [Fact]
    public async Task Limit_is_pushed_for_single_table_queries()
    {
        var s = await _h.OpenAsync(_link);
        var sink = await FederationHarness.RunAsync(s, "SELECT n FROM shop.big WHERE n > 10 LIMIT 3");
        Assert.Equal(3, sink.Single().Count);
        var src = ((Provider.FederatedSession)s).Context.LastPlan!.Sources.Single();
        Assert.Equal(3, src.Limit);
        Assert.EndsWith("WHERE \"n\" > 10 LIMIT 3", src.SourceQuery);
        Assert.Contains(sink.Messages, m => m.Text.Contains("LIMIT without ORDER BY", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Sources_are_cached_per_session_until_refreshed()
    {
        var s = await _h.OpenAsync(_link);
        var first = await FederationHarness.RunAsync(s, "SELECT count(*) FROM crm.customers");
        Assert.Equal(5L, Convert.ToInt64(first.Single()[0][0]));
        // the member changes; the session keeps its copy
        await using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_h.Connections.Get(_crm).GetString("path")};Pooling=False"))
        {
            await c.OpenAsync();
            await using var cmd = c.CreateCommand();
            cmd.CommandText = "INSERT INTO customers VALUES (6, 'Finn', NULL, 2)";
            await cmd.ExecuteNonQueryAsync();
        }
        var second = await FederationHarness.RunAsync(s, "SELECT count(*) FROM crm.customers");
        Assert.Equal(5L, Convert.ToInt64(second.Single()[0][0]));
        Assert.Contains(second.Messages, m => m.Text.Contains("session cache", StringComparison.Ordinal));
        Assert.True(((Provider.FederatedSession)s).Context.LastPlan!.Sources[0].Cached);

        // a narrower query (more predicates, fewer columns) is served from the cached superset
        var narrower = await FederationHarness.RunAsync(s, "SELECT id FROM crm.customers WHERE id > 3");
        Assert.Equal(2, narrower.Single().Count);

        Assert.Equal(1, await _h.Runtime.RefreshSourcesAsync(_link, s.SessionId, null, default));
        var third = await FederationHarness.RunAsync(s, "SELECT count(*) FROM crm.customers");
        Assert.Equal(6L, Convert.ToInt64(third.Single()[0][0]));
    }

    [Fact]
    public async Task Columns_expressions_read_whole_tables()
    {
        var s = await _h.OpenAsync(_link);
        // COLUMNS('regex') is resolved by DuckDB against the table's columns: the analyzer fetches them all
        var sink = await FederationHarness.RunAsync(s, "SELECT columns('^e.*') FROM crm.customers ORDER BY 1 NULLS LAST LIMIT 1");
        Assert.Equal("alice@example.com", sink.Single()[0][0]);
    }

    [Theory]
    [InlineData("INSERT INTO crm.customers VALUES (9, 'x', NULL, NULL)")]
    [InlineData("CREATE TABLE crm.x (a INT)")]
    [InlineData("DROP TABLE crm.customers")]
    [InlineData("ATTACH 'C:/temp/x.db' AS x")]
    [InlineData("COPY crm.customers TO 'C:/temp/x.csv'")]
    [InlineData("INSTALL httpfs")]
    public async Task Writes_are_refused_even_when_confirmed(string sql)
    {
        var s = await _h.OpenAsync(_link);
        var sink = await FederationHarness.RunAsync(s, sql, writesConfirmed: true);
        var error = Assert.Single(sink.Errors);
        Assert.Equal(ErrorCodes.ReadOnly, error.Code);
        Assert.Equal(BatchStatus.Error, sink.Batches.Single());
    }

    [Fact]
    public async Task No_transactions_and_no_database_switch()
    {
        var s = await _h.OpenAsync(_link);
        await Assert.ThrowsAsync<NotSupportedException>(() => s.SetTransactionModeAsync(TransactionMode.Manual, default));
        await Assert.ThrowsAsync<NotSupportedException>(() => s.ChangeDatabaseAsync("x", default));
        await Assert.ThrowsAsync<NotSupportedException>(() => s.ChangeSchemaAsync("shop", default));
        Assert.Equal(TransactionMode.Auto, s.TxMode);
        Assert.Equal(SchemaMode.None, s.SchemaMode);
        await s.CommitAsync(default);
        Assert.True(await s.PingAsync(default));
    }

    [Fact]
    public async Task Open_query_refuses_writes_and_streams_reads()
    {
        await Assert.ThrowsAsync<EngineException>(() => _h.Runtime.OpenQueryAsync(_link, "DELETE FROM crm.customers", null, new LinkQueryOptions(), default));
        await using var q = await _h.Runtime.OpenQueryAsync(_link, "SELECT name FROM crm.customers WHERE id <= 2 ORDER BY id", null, new LinkQueryOptions(), default);
        var names = new List<string>();
        while (await q.Reader.ReadAsync()) names.Add(q.Reader.GetString(0));
        Assert.Equal(["Alice", "Bob"], names);
        Assert.Equal("name", q.Columns.Single().Name);
        Assert.Single(q.Plan.Sources);
    }

    [Fact]
    public async Task Plan_describes_without_fetching()
    {
        var plan = await _h.Runtime.PlanAsync(_link, "SELECT c.name FROM crm.customers c LEFT JOIN shop.orders o ON o.customer_id = c.id AND o.total > 100", null, default);
        Assert.True(plan.Parsed);
        Assert.Equal("duckdb", plan.Engine);
        var orders = plan.Sources.Single(s => s.Table.Table == "orders");
        Assert.Contains("\"total\" > 100", orders.SourceQuery);
        Assert.Null(orders.Rows);
        var customers = plan.Sources.Single(s => s.Table.Table == "customers");
        Assert.Empty(customers.Predicates);
    }

    [Fact]
    public async Task Validation_reports_problems_and_probes_members()
    {
        var bad = new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "Bad Alias", ConnectionId = _crm, AllTables = true },
                new LinkMember { Alias = "main", ConnectionId = "c_missing", Tables = [new MountedTable { Name = "x" }] },
                new LinkMember { Alias = "loop", ConnectionId = _link, AllTables = true },
                new LinkMember { Alias = "s", ConnectionId = _shop },
            ],
            Relations = [new VirtualRelation { Id = "r", From = new("s", "orders"), FromColumns = ["a"], To = new("zz", "t"), ToColumns = ["b"] }],
        };
        var r = await _h.Runtime.ValidateAsync(bad, null, false, default);
        Assert.False(r.Ok);
        var codes = r.Problems.Select(p => p.Code).ToHashSet();
        Assert.Contains(LinkProblemCodes.AliasInvalid, codes);
        Assert.Contains(LinkProblemCodes.AliasReserved, codes);
        Assert.Contains(LinkProblemCodes.MemberMissing, codes);
        Assert.Contains(LinkProblemCodes.MemberLinked, codes);
        Assert.Contains(LinkProblemCodes.NoTables, codes);
        Assert.Contains(LinkProblemCodes.RelationInvalid, codes);

        var good = _h.Runtime.Definition(_link);
        var probed = await _h.Runtime.ValidateAsync(good, _link, true, default);
        Assert.True(probed.Ok, string.Join("; ", probed.Problems.Select(p => p.Message)));
        Assert.All(probed.Members, m => Assert.True(m.Reachable));
        Assert.Equal(5, probed.Members[1].Tables);

        var test = await _h.Linked.TestAsync(_h.Connections.Get(_link), null, default);
        Assert.True(test.Ok, test.Error?.Message);
    }

    [Fact]
    public async Task Cancel_stops_a_running_fetch_within_a_second()
    {
        var s = await _h.OpenAsync(_link);
        var run = FederationHarness.RunAsync(s, "SELECT n FROM shop.slow");
        await Task.Delay(700);
        var sw = Stopwatch.StartNew();
        s.Cancel();
        var sink = await run.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(sw.ElapsedMilliseconds < 1000, $"cancel took {sw.ElapsedMilliseconds} ms");
        Assert.Equal(BatchStatus.Cancelled, sink.Batches.Single());
        // the session is usable afterwards
        Assert.Equal(5L, Convert.ToInt64((await FederationHarness.RunAsync(s, "SELECT count(*) FROM crm.customers")).Single()[0][0]));
    }

    [Fact]
    public async Task Cancel_stops_a_running_engine_query_within_a_second()
    {
        var s = await _h.OpenAsync(_link);
        var run = FederationHarness.RunAsync(s, "SELECT count(*) FROM crm.countries, range(100000000000)");
        await Task.Delay(700);
        var sw = Stopwatch.StartNew();
        s.Cancel();
        var sink = await run.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.True(sw.ElapsedMilliseconds < 1000, $"cancel took {sw.ElapsedMilliseconds} ms");
        Assert.Equal(BatchStatus.Cancelled, sink.Batches.Single());
    }

    [Fact]
    public async Task Parameters_bind_and_are_applied_by_the_engine()
    {
        var s = await _h.OpenAsync(_link);
        var sink = await FederationHarness.RunAsync(s, "SELECT name FROM crm.customers WHERE id = $id", parameters: [new("id", "int", 3)]);
        Assert.Equal("Chie", sink.Single()[0][0]);
    }

    [Fact]
    public async Task A_failing_member_is_named_in_the_error()
    {
        var link = _h.AddLink("Broken", new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "ok", ConnectionId = _crm, AllTables = true },
                new LinkMember { Alias = "gone", ConnectionId = _h.AddConnection(new ConnectionProfile { Name = "gone", ProviderId = "sqlite",
                    Props = new() { ["path"] = Path.Combine(_h.Dir, "nope", "missing.db") } }, null), AllTables = true },
            ],
        });
        var s = await _h.OpenAsync(link);
        var sink = await FederationHarness.RunAsync(s, "SELECT * FROM gone.t");
        var error = Assert.Single(sink.Errors);
        Assert.Contains("gone", error.Message);
        // the healthy member still works
        Assert.Equal(5L, Convert.ToInt64((await FederationHarness.RunAsync(s, "SELECT count(*) FROM ok.customers")).Single()[0][0]));
    }
}
