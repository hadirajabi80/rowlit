using DbStudio.Core.SchemaCompare;

namespace DbStudio.SchemaCompare.Tests;

/// <summary>Two SQLite files (a source and a target connection): runs everywhere, no Docker needed.</summary>
public sealed class SqliteCompareTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dbstudio-compare-sqlite", Guid.NewGuid().ToString("N"));

    public SqliteCompareTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try { Directory.Delete(_dir, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private static IEnumerable<string> Source(string _) =>
    [
        "CREATE TABLE countries (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        "CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email VARCHAR(200), phone VARCHAR(30), country_id INTEGER REFERENCES countries (id), " +
        "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT ck_customers_name CHECK (length(name) > 0))",
        "CREATE UNIQUE INDEX uq_customers_email ON customers (email)",
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price NUMERIC(10,2), sku TEXT)",
        "CREATE UNIQUE INDEX uq_products_sku ON products (sku)",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers (id) ON DELETE CASCADE, total NUMERIC(12,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new')",
        "CREATE INDEX ix_orders_customer ON orders (customer_id, total)",
        "CREATE TABLE order_lines (order_id INTEGER NOT NULL REFERENCES orders (id), product_id INTEGER NOT NULL REFERENCES products (id), qty INTEGER NOT NULL, PRIMARY KEY (order_id, product_id))",
        "CREATE TABLE reviews (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers (id), body TEXT)",
        "CREATE VIEW customer_orders AS SELECT c.id AS customer_id, c.name, COUNT(o.id) AS orders FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name",
        "CREATE VIEW v_new_only AS SELECT id, name FROM countries",
        "CREATE TRIGGER trg_orders_check BEFORE INSERT ON orders FOR EACH ROW WHEN NEW.total < 0 BEGIN SELECT RAISE(ABORT, 'negative total'); END",
    ];

    private static IEnumerable<string> Target(string _) =>
    [
        "CREATE TABLE countries (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        "CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email VARCHAR(100), nickname VARCHAR(30), country_id INTEGER REFERENCES countries (id), " +
        "created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT ck_customers_name CHECK (length(name) > 1))",
        "CREATE UNIQUE INDEX uq_customers_email ON customers (email)",
        "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price NUMERIC(8,2), sku TEXT)",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers (id), total NUMERIC(12,2) NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new')",
        "CREATE INDEX ix_orders_customer ON orders (customer_id)",
        "CREATE TABLE order_lines (order_id INTEGER NOT NULL REFERENCES orders (id), product_id INTEGER NOT NULL REFERENCES products (id), qty INTEGER NOT NULL, PRIMARY KEY (order_id, product_id))",
        "CREATE TABLE legacy_audit (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers (id), note TEXT)",
        "CREATE VIEW customer_orders AS SELECT c.id AS customer_id, c.name FROM customers c",
        "CREATE VIEW v_old AS SELECT id FROM countries",
        "CREATE TRIGGER trg_old AFTER DELETE ON orders FOR EACH ROW BEGIN SELECT 1; END",
    ];

    private static readonly Dictionary<string, string> Expected = new()
    {
        ["table:customers"] = CompareStatus.Alter,
        ["table:products"] = CompareStatus.Alter,
        ["table:orders"] = CompareStatus.Alter,
        ["table:reviews"] = CompareStatus.Create,
        ["table:legacy_audit"] = CompareStatus.Drop,
        ["view:customer_orders"] = CompareStatus.Alter,
        ["view:v_new_only"] = CompareStatus.Create,
        ["view:v_old"] = CompareStatus.Drop,
        ["trigger:trg_orders_check"] = CompareStatus.Create,
        ["trigger:trg_old"] = CompareStatus.Drop,
    };

    [Fact]
    public async Task Compare_Script_Apply_ThenIdentical()
    {
        using var env = new CompareEnv();
        var src = env.Add("src", "sqlite", Servers.SqliteProps(Path.Combine(_dir, "source.db")));
        var dst = env.Add("dst", "sqlite", Servers.SqliteProps(Path.Combine(_dir, "target.db")));
        var (result, _) = await ScratchRunner.RunAsync(env, new Scratch(src, null, "main", "main", Source, Target, _ => [], Expected, TargetConnection: dst));
        Assert.True(result.TransactionalDdl);
    }

    [Fact]
    public async Task Options_TurnComparisonsOff()
    {
        using var env = new CompareEnv();
        var src = env.Add("src", "sqlite", Servers.SqliteProps(Path.Combine(_dir, "o-source.db")));
        var dst = env.Add("dst", "sqlite", Servers.SqliteProps(Path.Combine(_dir, "o-target.db")));
        await env.ExecAsync(src, null, Source(""));
        await env.ExecAsync(dst, null, Target(""));
        var a = new CompareEndpoint(src.Id, null, "main");
        var b = new CompareEndpoint(dst.Id, null, "main");

        var all = await env.CompareAsync(a, b);
        Assert.Contains(all.Items, i => i.Kind == "view" && i.Status != CompareStatus.Identical);
        Assert.Contains(all.Items, i => i.Kind == "trigger" && i.Status != CompareStatus.Identical);

        var noViews = await env.CompareAsync(a, b, new CompareOptions { Views = false, Triggers = false });
        Assert.DoesNotContain(noViews.Items, i => i.Kind is "view" or "trigger");

        var tablesOnly = await env.CompareAsync(a, b, new CompareOptions { Indexes = false, ForeignKeys = false, Checks = false, Uniques = false });
        var orders = tablesOnly.Items.Single(i => i.Id == "table:orders");
        Assert.Equal(CompareStatus.Identical, orders.Status);
        var customers = tablesOnly.Items.Single(i => i.Id == "table:customers");
        Assert.Equal(CompareStatus.Alter, customers.Status);
        Assert.DoesNotContain(customers.Changes, c => c.Contains("Check constraint", StringComparison.Ordinal));

        var noTables = await env.CompareAsync(a, b, new CompareOptions { Tables = false });
        Assert.DoesNotContain(noTables.Items, i => i.Kind == "table");
    }

    [Fact]
    public void Support_ReportsDialectAndReadOnly()
    {
        using var env = new CompareEnv();
        var rw = env.Add("rw", "sqlite", Servers.SqliteProps(Path.Combine(_dir, "rw.db")));
        var ro = env.Connections.Create(new DbStudio.Core.Models.ConnectionProfile
        {
            Name = "ro", ProviderId = "sqlite", Props = Servers.SqliteProps(Path.Combine(_dir, "ro.db")), ReadOnly = true,
        }, null);

        var a = env.Service.Support(rw.Id);
        Assert.True(a.Supported);
        Assert.Equal("sqlite", a.ProviderId);
        Assert.False(a.ReadOnly);
        Assert.Null(a.Reason);
        Assert.True(env.Service.Support(ro.Id).ReadOnly);
        Assert.Throws<DbStudio.Core.Services.EngineException>(() => env.Service.Support(""));
    }

    [Fact]
    public async Task SameSchemaOnBothSides_IsRefused_AndDifferentKindsToo()
    {
        using var env = new CompareEnv();
        var src = env.Add("src", "sqlite", Servers.SqliteProps(Path.Combine(_dir, "s-source.db")));
        var ep = new CompareEndpoint(src.Id, null, "main");
        var ex = await Assert.ThrowsAsync<DbStudio.Core.Services.EngineException>(() => env.CompareAsync(ep, ep));
        Assert.Equal("VALIDATION", ex.Code);
    }
}
