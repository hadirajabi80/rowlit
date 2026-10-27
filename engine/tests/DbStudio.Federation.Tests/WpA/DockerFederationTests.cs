using System.Diagnostics;
using System.Globalization;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Federation.Contracts;
using DbStudio.Import.Run;

namespace DbStudio.Federation.Tests.WpA;

/// <summary>A sample server of the compose project dbstudio-it (engine/tests/docker/README.md).</summary>
internal sealed record Server(string Name, string ProviderId, string Host, int Port, Func<ConnectionProfile> Profile, string Password)
{
    public bool Reachable()
    {
        if (Environment.GetEnvironmentVariable("DBSTUDIO_IT") == "0") return false;
        try
        {
            using var c = new TcpClient();
            return c.ConnectAsync(Host, Port).Wait(TimeSpan.FromSeconds(2)) && c.Connected;
        }
        catch (Exception) { return false; }
    }

    private static ConnectionProfile P(string provider, Dictionary<string, JsonNode?> props) => new() { Name = "IT " + provider, ProviderId = provider, Props = props };

    public static readonly Server SqlServer = new("sqlserver", "sqlserver", "localhost", 14333, () => P("sqlserver", new()
        { ["server"] = "localhost,14333", ["auth"] = "sql", ["user"] = "sa", ["database"] = "shop", ["encrypt"] = "optional", ["trustServerCertificate"] = true }),
        "DbStudio_Dev_2026!");

    public static readonly Server PostgreSql = new("postgresql", "postgresql", "localhost", 15432, () => P("postgresql", new()
        { ["host"] = "localhost", ["port"] = 15432, ["database"] = "shop", ["user"] = "shop", ["sslMode"] = "disable" }), "shop");

    public static readonly Server MySql = new("mysql", "mysql", "localhost", 13306, () => P("mysql", new()
        { ["host"] = "localhost", ["port"] = 13306, ["database"] = "shop", ["user"] = "shop", ["sslMode"] = "none", ["allowPublicKeyRetrieval"] = true }), "shop");

    public static readonly Server MariaDb = new("mariadb", "mariadb", "localhost", 13307, () => P("mariadb", new()
        { ["host"] = "localhost", ["port"] = 13307, ["database"] = "shop", ["user"] = "shop", ["sslMode"] = "none", ["allowPublicKeyRetrieval"] = true }), "shop");

    public static readonly Server Oracle = new("oracle", "oracle", "localhost", 15211, () => P("oracle", new()
        { ["connectionType"] = "basic", ["host"] = "localhost", ["port"] = 15211, ["serviceName"] = "FREEPDB1", ["user"] = "shop", ["role"] = "normal" }), "shop");

    public static readonly Server ClickHouse = new("clickhouse", "clickhouse", "localhost", 18123, () => P("clickhouse", new()
        { ["host"] = "localhost", ["port"] = 18123, ["protocol"] = "http", ["database"] = "shop", ["user"] = "shop" }), "shop");
}

/// <summary>
/// Federated queries across the Docker sample servers (ShopSchema data: 5 customers, 6 orders — order 1 total 120.50 —
/// 4 products, 7 order lines). Skipped (not failed) when DBSTUDIO_IT=0 or a server is not running.
/// </summary>
public sealed class DockerFederationTests
{
    private static void Need(params Server[] servers)
    {
        foreach (var s in servers)
            Skip.IfNot(s.Reachable(), $"{s.Name} is not reachable (start engine/tests/docker/compose.yml or set DBSTUDIO_IT=0).");
    }

    /// <summary>Per customer: orders with lines, sum(qty × price) — the same on every server (ShopSchema).</summary>
    private static readonly (string Name, long Orders, decimal Amount)[] Expected =
        [("Alice", 2, 138.80m), ("Bob", 1, 199.00m), ("Chie", 1, 55.15m), ("Dora", 1, 199.00m)];

    private static decimal Dec(object? v) => v switch
    {
        string s => decimal.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture),
        double d => (decimal)d,
        null => throw new InvalidOperationException("null"),
        _ => Convert.ToDecimal(v, CultureInfo.InvariantCulture),
    };

    private static void AssertShopTotals(List<object?[]> rows)
    {
        Assert.Equal(Expected.Length, rows.Count);
        for (var i = 0; i < Expected.Length; i++)
        {
            Assert.Equal(Expected[i].Name, rows[i][0]);
            Assert.Equal(Expected[i].Orders, Convert.ToInt64(rows[i][1], CultureInfo.InvariantCulture));
            Assert.Equal(Expected[i].Amount, Dec(rows[i][2]));
        }
    }

    private const string ThreeWay = """
        SELECT c.name, count(DISTINCT o.id) AS orders, sum(l.qty * p.price) AS amount
        FROM cust.customers c
        JOIN ord.orders o ON o.customer_id = c.id
        JOIN ord.lines l ON l.order_id = o.id
        JOIN prod.products p ON p.id = l.product_id
        GROUP BY c.name
        ORDER BY c.name
        """;

    [SkippableFact]
    public async Task Sql_server_customers_x_postgresql_orders_x_mysql_products()
    {
        Need(Server.SqlServer, Server.PostgreSql, Server.MySql);
        await using var h = new FederationHarness();
        var ss = h.AddConnection(Server.SqlServer.Profile(), Server.SqlServer.Password);
        var pg = h.AddConnection(Server.PostgreSql.Profile(), Server.PostgreSql.Password);
        var my = h.AddConnection(Server.MySql.Profile(), Server.MySql.Password);
        var link = h.AddLink("Three servers", new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "cust", ConnectionId = ss, Database = "shop", Schema = "dbo", Tables = [new MountedTable { Name = "Customers", As = "customers" }] },
                new LinkMember { Alias = "ord", ConnectionId = pg, Database = "shop", Schema = "public",
                    Tables = [new MountedTable { Name = "orders" }, new MountedTable { Name = "order_lines", As = "lines" }] },
                new LinkMember { Alias = "prod", ConnectionId = my, Schema = "shop", Tables = [new MountedTable { Name = "products" }] },
            ],
        });
        var s = await h.OpenAsync(link);

        var sink = await FederationHarness.RunAsync(s, ThreeWay);
        AssertShopTotals(sink.Single());
        var messages = string.Join("\n", sink.Messages.Select(m => m.Text));
        Assert.True(messages.Contains("cust.customers: 5 rows from Microsoft SQL Server", StringComparison.Ordinal), messages);
        Assert.True(messages.Contains("ord.orders: 6 rows from PostgreSQL", StringComparison.Ordinal), messages);
        Assert.True(messages.Contains("prod.products: 4 rows from MySQL", StringComparison.Ordinal), messages);

        // order 1: total 120.50, pushed down to PostgreSQL (a new session: the first one would serve its cached copies)
        s = await h.OpenAsync(link);
        var one = await FederationHarness.RunAsync(s, "SELECT o.total, c.name FROM ord.orders o JOIN cust.customers c ON c.id = o.customer_id WHERE o.id = 1");
        var row = Assert.Single(one.Single());
        Assert.Equal(120.50m, Dec(row[0]));
        Assert.Equal("Alice", row[1]);
        var plan = ((Provider.FederatedSession)s).Context.LastPlan!;
        var orders = plan.Sources.Single(x => x.Table.Table == "orders");
        Assert.Contains("WHERE \"id\" = 1", orders.SourceQuery);
        Assert.Equal(1, orders.Rows);

        // a LEFT JOIN keeps customers without orders; a predicate on the right side in ON is pushed to PostgreSQL only
        s = await h.OpenAsync(link);
        var left = await FederationHarness.RunAsync(s, """
            SELECT c.name, count(o.id) AS n FROM cust.customers c
            LEFT JOIN ord.orders o ON o.customer_id = c.id AND o.total > 100
            GROUP BY c.name ORDER BY c.name
            """);
        var counts = left.Single().ToDictionary(r => (string)r[0]!, r => Convert.ToInt64(r[1], CultureInfo.InvariantCulture));
        Assert.Equal(new Dictionary<string, long> { ["Alice"] = 1, ["Bob"] = 1, ["Chie"] = 0, ["Dora"] = 1, ["Emil"] = 0 }, counts);
        plan = ((Provider.FederatedSession)s).Context.LastPlan!;
        Assert.Contains("\"total\" > 100", plan.Sources.Single(x => x.Table.Table == "orders").SourceQuery);
        Assert.DoesNotContain("WHERE", plan.Sources.Single(x => x.Table.Table == "customers").SourceQuery);
    }

    [SkippableFact]
    public async Task Oracle_customers_x_clickhouse_orders_x_mariadb_products()
    {
        Need(Server.Oracle, Server.ClickHouse, Server.MariaDb);
        await using var h = new FederationHarness();
        var ora = h.AddConnection(Server.Oracle.Profile(), Server.Oracle.Password);
        var ch = h.AddConnection(Server.ClickHouse.Profile(), Server.ClickHouse.Password);
        var maria = h.AddConnection(Server.MariaDb.Profile(), Server.MariaDb.Password);
        var link = h.AddLink("Three more", new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "cust", ConnectionId = ora, Schema = "SHOP", Tables = [new MountedTable { Name = "CUSTOMERS", As = "customers" }] },
                new LinkMember { Alias = "ord", ConnectionId = ch, Schema = "shop",
                    Tables = [new MountedTable { Name = "orders" }, new MountedTable { Name = "order_lines", As = "lines" }] },
                new LinkMember { Alias = "prod", ConnectionId = maria, Schema = "shop", Tables = [new MountedTable { Name = "products" }] },
            ],
        });
        var s = await h.OpenAsync(link);
        var sink = await FederationHarness.RunAsync(s, ThreeWay);
        AssertShopTotals(sink.Single());

        var one = await FederationHarness.RunAsync(s, "SELECT total FROM ord.orders WHERE id = 1");
        Assert.Equal(120.50m, Dec(Assert.Single(one.Single())[0]));
        // the cached copy (no filter) would serve the next query: drop it so the filter reaches Oracle
        Assert.Equal(1, await h.Runtime.RefreshSourcesAsync(link, s.SessionId, [new LinkTableRef("cust", "customers")], default));
        var oracle = await FederationHarness.RunAsync(s, "SELECT name FROM cust.customers WHERE id IN (2, 3) ORDER BY id LIMIT 5");
        Assert.Equal(["Bob", "Chie"], oracle.Single().Select(r => (string)r[0]!));
        var src = ((Provider.FederatedSession)s).Context.LastPlan!.Sources.Single();
        Assert.True(src.SourceQuery.Contains("\"ID\" IN (2, 3)", StringComparison.Ordinal) && src.SourceQuery.Contains("FETCH FIRST", StringComparison.Ordinal), src.SourceQuery);
    }

    [SkippableFact]
    public async Task Mixed_sql_server_postgresql_oracle_join_matches_the_native_join()
    {
        Need(Server.SqlServer, Server.PostgreSql, Server.Oracle);
        await using var h = new FederationHarness();
        var ss = h.AddConnection(Server.SqlServer.Profile(), Server.SqlServer.Password);
        var pg = h.AddConnection(Server.PostgreSql.Profile(), Server.PostgreSql.Password);
        var ora = h.AddConnection(Server.Oracle.Profile(), Server.Oracle.Password);
        var link = h.AddLink("Mixed", new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "ss", ConnectionId = ss, Database = "shop", Schema = "dbo", AllTables = true },
                new LinkMember { Alias = "pg", ConnectionId = pg, Database = "shop", Schema = "public", AllTables = true },
                new LinkMember { Alias = "ora", ConnectionId = ora, Schema = "SHOP", AllTables = true },
            ],
        });
        var s = await h.OpenAsync(link);
        // the same join on one server and across three gives the same rows
        var native = await FederationHarness.RunAsync(s, "SELECT o.Id, c.Name, o.Total FROM ss.Orders o JOIN ss.Customers c ON c.Id = o.CustomerId ORDER BY o.Id");
        var federated = await FederationHarness.RunAsync(s, "SELECT o.id, c.NAME, o.total FROM pg.orders o JOIN ora.CUSTOMERS c ON c.ID = o.customer_id ORDER BY o.id");
        var a = native.Single().Select(r => $"{Convert.ToInt64(r[0], CultureInfo.InvariantCulture)}|{r[1]}|{Dec(r[2])}").ToList();
        var b = federated.Single().Select(r => $"{Convert.ToInt64(r[0], CultureInfo.InvariantCulture)}|{r[1]}|{Dec(r[2])}").ToList();
        Assert.Equal(a, b);
        Assert.Equal(6, a.Count);
    }

    [SkippableFact]
    public async Task Cancel_stops_a_slow_postgresql_fetch_within_a_second()
    {
        Need(Server.PostgreSql);
        await using var h = new FederationHarness();
        var pg = h.AddConnection(Server.PostgreSql.Profile(), Server.PostgreSql.Password);
        var view = "fed_slow_" + Guid.NewGuid().ToString("N")[..8];
        await ExecAsync(h, pg, $"CREATE VIEW public.{view} AS SELECT 1 AS x, pg_sleep(60)::text AS s");
        try
        {
            var link = h.AddLink("Slow", new LinkDefinition { Members = [new LinkMember { Alias = "pg", ConnectionId = pg, Schema = "public", Tables = [new MountedTable { Name = view }] }] });
            var s = await h.OpenAsync(link);
            var run = FederationHarness.RunAsync(s, $"SELECT x FROM pg.{view}");
            await Task.Delay(1500);
            var sw = Stopwatch.StartNew();
            s.Cancel();
            var sink = await run.WaitAsync(TimeSpan.FromSeconds(15));
            Assert.True(sw.ElapsedMilliseconds < 1000, $"cancel took {sw.ElapsedMilliseconds} ms");
            Assert.Equal(BatchStatus.Cancelled, sink.Batches.Single());
        }
        finally
        {
            await ExecAsync(h, pg, $"DROP VIEW IF EXISTS public.{view}");
        }
    }

    [SkippableFact]
    public async Task Read_only_is_enforced_on_a_link_of_writable_servers()
    {
        Need(Server.PostgreSql);
        await using var h = new FederationHarness();
        var pg = h.AddConnection(Server.PostgreSql.Profile(), Server.PostgreSql.Password);
        var link = h.AddLink("RO", new LinkDefinition { Members = [new LinkMember { Alias = "pg", ConnectionId = pg, Schema = "public", Tables = [new MountedTable { Name = "orders" }] }] });
        var s = await h.OpenAsync(link);
        var sink = await FederationHarness.RunAsync(s, "UPDATE pg.orders SET total = 0", writesConfirmed: true);
        Assert.Equal(DbStudio.Core.Services.ErrorCodes.ReadOnly, Assert.Single(sink.Errors).Code);
        var check = await FederationHarness.RunAsync(s, "SELECT total FROM pg.orders WHERE id = 1");
        Assert.Equal(120.50m, Dec(Assert.Single(check.Single())[0]));
    }

    [SkippableFact]
    public async Task A_clickhouse_parametrised_view_says_why_it_cannot_be_queried()
    {
        // QA round: shop.orders_since mounts with no columns; querying it used to end with DuckDB's
        // "Table with name orders_since does not exist" after the member connections were already opened.
        Need(Server.ClickHouse);
        await using var h = new FederationHarness();
        var ch = h.AddConnection(Server.ClickHouse.Profile(), Server.ClickHouse.Password);
        var link = h.AddLink("CH", new LinkDefinition { Members = [new LinkMember { Alias = "ch", ConnectionId = ch, Schema = "shop", AllTables = true }] });
        var s = await h.OpenAsync(link);
        var sink = await FederationHarness.RunAsync(s, "SELECT count(*) FROM ch.orders_since");
        var error = Assert.Single(sink.Errors);
        Assert.Contains("ch.orders_since has no columns", error.Message, StringComparison.Ordinal);
        // the other tables of the member are not affected
        var ok = await FederationHarness.RunAsync(s, "SELECT count(*) FROM ch.orders");
        Assert.Equal(6L, Convert.ToInt64(Assert.Single(ok.Single())[0], CultureInfo.InvariantCulture));
    }

    [SkippableFact]
    public async Task Large_clickhouse_table_spills_under_a_512_mb_limit()
    {
        Need(Server.ClickHouse);
        await using var h = new FederationHarness(s => { s["memoryLimitMb"] = 512; s["threads"] = 4; });
        var ch = h.AddConnection(Server.ClickHouse.Profile(), Server.ClickHouse.Password);
        var table = "fed_big_" + Guid.NewGuid().ToString("N")[..8];
        const int rows = 1_000_000;
        await ExecAsync(h, ch, $"CREATE TABLE shop.{table} (n UInt64, k String, payload String) ENGINE = MergeTree ORDER BY n");
        try
        {
            await ExecAsync(h, ch, $"INSERT INTO shop.{table} SELECT number, toString(number % 1000), randomPrintableASCII(700) FROM numbers({rows})");
            var link = h.AddLink("Big", new LinkDefinition { Members = [new LinkMember { Alias = "ch", ConnectionId = ch, Schema = "shop", Tables = [new MountedTable { Name = table, As = "big" }] }] });
            var s = await h.OpenAsync(link);
            var limit = await FederationHarness.RunAsync(s, "SELECT current_setting('memory_limit')");
            Assert.StartsWith("512", (string)limit.Single()[0][0]!);

            var sw = Stopwatch.StartNew();
            var sink = await FederationHarness.RunAsync(s, "SELECT k, count(*) AS c, max(length(payload)) AS m, sum(n) AS total FROM ch.big GROUP BY k ORDER BY k");
            var result = sink.Single();
            Assert.Equal(1000, result.Count);
            Assert.All(result, r => Assert.Equal(1000L, Convert.ToInt64(r[1], CultureInfo.InvariantCulture)));
            var sum = result.Sum(r => decimal.Parse(Convert.ToString(r[3], CultureInfo.InvariantCulture)!, CultureInfo.InvariantCulture));
            Assert.Equal((decimal)rows * (rows - 1) / 2, sum);
            var plan = ((Provider.FederatedSession)s).Context.LastPlan!;
            Assert.Equal(rows, plan.Sources.Single().Rows);
            Assert.False(plan.Sources.Single().Truncated);

            // ~700 MB of payload in a 512 MB budget: the table lives partly in the spill directory
            var spilled = await FederationHarness.RunAsync(s, "SELECT coalesce(sum(size), 0) FROM duckdb_temporary_files()");
            var bytes = Convert.ToInt64(spilled.Single()[0][0], CultureInfo.InvariantCulture);
            Assert.True(bytes > 0, "nothing was spilled");
            Console.WriteLine($"spill: {bytes / (1024 * 1024)} MiB, {sw.ElapsedMilliseconds} ms");
        }
        finally
        {
            await ExecAsync(h, ch, $"DROP TABLE IF EXISTS shop.{table}");
        }
    }

    private static async Task ExecAsync(FederationHarness h, string connectionId, string sql)
    {
        var profile = h.Connections.WithSecrets(h.Connections.Get(connectionId));
        var provider = h.Providers.Get(profile.ProviderId);
        await using var c = await ImportConnections.OpenAsync(provider, profile, h.Connections.GetPassword(connectionId), null, h.Services, default);
        await using var cmd = c.Db.CreateCommand();
        cmd.CommandText = sql;
        cmd.CommandTimeout = 600;
        await cmd.ExecuteNonQueryAsync();
    }
}
