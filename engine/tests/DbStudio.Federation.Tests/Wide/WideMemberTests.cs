using System.Reflection;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Fetchers;
using DbStudio.Federation.Runtime;
using DbStudio.Federation.Tests.WpA;
using DbStudio.Sources.Mongo;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;

namespace DbStudio.Federation.Tests.Wide;

/// <summary>Scopes: version 1 links read as version 2 (allTables → schema), members normalized.</summary>
public sealed class ScopeMigrationTests
{
    [Fact]
    public void Version_1_members_get_a_scope_from_allTables()
    {
        var profile = new ConnectionProfile { Name = "old", ProviderId = LinkIds.ProviderId };
        profile.Props[LinkProps.Version] = JsonValue.Create(1);
        profile.Props[LinkProps.Members] = JsonNode.Parse("""
            [ { "alias": "crm", "connectionId": "c1", "schema": "dbo", "allTables": true, "tables": [ { "name": "Customers", "as": "customers" } ] },
              { "alias": "shop", "connectionId": "c2", "tables": [ { "name": "orders" } ] },
              { "alias": "f", "kind": "files", "tables": [ { "name": "C:/x.csv", "as": "x" } ] } ]
            """);
        var def = LinkDefinition.FromProfile(profile);
        Assert.Equal(LinkDefinition.CurrentVersion, def.Version);
        Assert.Equal(LinkScopes.Schema, def.Members[0].Scope);
        Assert.True(def.Members[0].AllTables);
        Assert.Equal("customers", Assert.Single(def.Members[0].Tables).LinkName); // overrides kept
        Assert.Equal(LinkScopes.Tables, def.Members[1].Scope);
        Assert.False(def.Members[1].AllTables);
        Assert.Equal(LinkScopes.Tables, def.Members[2].Scope);
        Assert.False(def.Members[2].IsWide);

        // written back as version 2: scope plus allTables (older builds mount the schema)
        var copy = new ConnectionProfile { Name = "new", ProviderId = LinkIds.ProviderId };
        (def with { Members = [.. def.Members, new LinkMember { Alias = "big", ConnectionId = "c3", Scope = LinkScopes.Database, Database = "shop" }.Normalized()] }).WriteTo(copy.Props);
        Assert.Equal(2, (int)copy.Props[LinkProps.Version]!);
        var big = copy.Props[LinkProps.Members]!.AsArray()[3]!;
        Assert.Equal("database", (string)big["scope"]!);
        Assert.True((bool)big["allTables"]!);
        var again = LinkDefinition.FromProfile(copy);
        Assert.True(again.Members[3].IsWide);
        Assert.Equal(LinkScopes.Database, again.Members[3].EffectiveScope);
    }

    [Theory]
    [InlineData("sqlserver", LinkScopes.Database, "schema")]
    [InlineData("sqlserver", LinkScopes.Connection, "database,schema")]
    [InlineData("postgresql", LinkScopes.Connection, "database,schema")]
    [InlineData("oracle", LinkScopes.Database, "schema")]
    [InlineData("oracle", LinkScopes.Connection, "schema")]
    [InlineData("sqlite", LinkScopes.Database, "schema")]
    [InlineData("mysql", LinkScopes.Database, "")]
    [InlineData("mysql", LinkScopes.Connection, "schema")]
    [InlineData("mongodb", LinkScopes.Database, "")]
    [InlineData("mongodb", LinkScopes.Connection, "schema")]
    [InlineData("elasticsearch", LinkScopes.Connection, "")]
    [InlineData("sqlserver", LinkScopes.Schema, "")]
    public void Levels_per_provider(string provider, string scope, string levels) =>
        Assert.Equal(levels, string.Join(",", MemberScopes.Levels(provider, scope)));
}

/// <summary>Engine names of wide members and the statement rewrite (pure).</summary>
public sealed class LinkNamesTests
{
    private static WideLayout Db() => new()
    {
        Alias = "crm", Levels = ["schema"], FixedDatabase = "shop", DefaultPath = ["dbo"], Schemas = ["dbo", "sales", "Archive"],
    };

    private static WideLayout Conn() => new()
    {
        Alias = "ms", Levels = ["database", "schema"], DefaultPath = ["Shop", "dbo"], Databases = ["Shop", "Staging"], Schemas = ["dbo", "Sales"],
    };

    private static string Rw(string sql) => LinkNames.Rewrite(sql, new Dictionary<string, WideLayout>(StringComparer.OrdinalIgnoreCase) { ["crm"] = Db(), ["ms"] = Conn() });

    [Fact]
    public void Engine_names_leave_the_defaults_out()
    {
        var db = Db();
        Assert.Equal("customers", db.EngineName(db.Container(["dbo"]), "customers"));
        Assert.Equal("sales.orders", db.EngineName(db.Container(["sales"]), "orders"));
        var c = Conn();
        Assert.Equal("customers", c.EngineName(c.Container(["Shop", "dbo"]), "customers"));
        Assert.Equal("Sales.orders", c.EngineName(c.Container(["Shop", "Sales"]), "orders"));
        Assert.Equal("Staging.dbo.orders", c.EngineName(c.Container(["Staging", "dbo"]), "orders"));
        Assert.Equal(["Staging", "dbo", "orders"], c.PathOf(c.Container(["Staging", "dbo"]), "orders"));

        var loc = c.Locate("Staging.dbo.fs.files");
        Assert.NotNull(loc);
        Assert.Equal("Staging", loc!.Value.Container.Database);
        Assert.Equal("dbo", loc.Value.Container.Schema);
        Assert.Equal("fs.files", loc.Value.Table);
        Assert.Equal("Sales", c.Locate("sales.orders")!.Value.Container.Schema);
        Assert.Null(c.Locate("nowhere.orders"));
        Assert.Equal("sales", db.Locate("sales.orders")!.Value.Container.Schema);
        Assert.Equal("shop", db.Locate("sales.orders")!.Value.Container.Database);
    }

    [Fact]
    public void Three_and_four_part_names_become_engine_tables()
    {
        Assert.Equal("SELECT * FROM crm.\"sales.orders\" AS orders", Rw("SELECT * FROM crm.sales.orders"));
        Assert.Equal("SELECT o.id FROM crm.\"sales.orders\" o WHERE o.id > 1", Rw("SELECT o.id FROM crm.sales.orders o WHERE o.id > 1"));
        Assert.Equal("SELECT * FROM crm.\"sales.orders\" AS x", Rw("SELECT * FROM crm.sales.orders AS x"));
        // the default schema is the two-part name
        Assert.Equal("SELECT * FROM crm.customers", Rw("SELECT * FROM crm.dbo.customers"));
        // whole connection: another database, the default database's other schema, the defaults
        Assert.Equal("SELECT * FROM ms.\"Staging.dbo.orders\" AS orders JOIN ms.\"Sales.orders\" AS orders2 ON true",
            Rw("SELECT * FROM ms.Staging.dbo.orders JOIN ms.Sales.orders AS orders2 ON true"));
        Assert.Equal("SELECT * FROM ms.customers", Rw("SELECT * FROM ms.shop.dbo.customers"));
        // quoted parts, case-insensitive schema names
        Assert.Equal("SELECT * FROM crm.\"Archive.Old Orders\" AS \"Old Orders\"", Rw("SELECT * FROM crm.\"archive\".\"Old Orders\""));
        // a comma-separated FROM list
        Assert.Equal("SELECT 1 FROM crm.customers c, crm.\"sales.orders\" AS orders WHERE true",
            Rw("SELECT 1 FROM crm.customers c, crm.sales.orders WHERE true"));
    }

    [Fact]
    public void Columns_qualified_with_the_full_name_use_the_implicit_alias()
    {
        Assert.Equal("SELECT orders.amount FROM crm.\"sales.orders\" AS orders", Rw("SELECT crm.sales.orders.amount FROM crm.sales.orders"));
        Assert.Equal("SELECT crm.customers.id FROM crm.customers", Rw("SELECT crm.dbo.customers.id FROM crm.dbo.customers"));
    }

    [Fact]
    public void Leaves_alone_what_is_not_a_wide_name()
    {
        foreach (var sql in new[]
                 {
                     "SELECT 'crm.sales.orders' AS s, \"crm.sales.orders\" FROM shop.orders -- crm.sales.orders",
                     "SELECT * FROM crm.customers",
                     "SELECT crm.id FROM crm.customers crm",   // crm.id: two parts
                     "SELECT * FROM crm.nope.orders",           // nope is no schema of crm: DuckDB reports it
                     "SELECT * FROM other.sales.orders",        // not a wide member
                     "SELECT * FROM crm.\"sales.orders\"",       // the engine spelling already
                 })
            Assert.Equal(sql, Rw(sql));
    }

    [Fact]
    public void Finds_the_engine_names_a_statement_needs()
    {
        var sql = Rw("SELECT * FROM crm.sales.orders o JOIN ms.Staging.dbo.orders s ON o.id = s.id JOIN crm.customers c ON true");
        var refs = LinkNames.EngineReferences(sql, ["crm", "ms"]).Select(r => r.ToString()).ToList();
        Assert.Equal(["crm.sales.orders", "ms.Staging.dbo.orders", "crm.customers"], refs);
        Assert.Equal(["crm"], LinkNames.NamedAliases("SELECT * FROM crm.sales.orders, shop.x", ["crm", "ms"]).ToList());
    }
}

/// <summary>A whole SQLite database (main + an attached file) as one member: lazy discovery, push-down, browse, resolve.</summary>
public sealed class WideSqliteTests : IAsyncLifetime
{
    private readonly FederationHarness _h = new();
    private string _link = "";

    public Task InitializeAsync()
    {
        var archive = Path.Combine(_h.Dir, "archive.db");
        using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={archive};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL, note TEXT);
                INSERT INTO orders VALUES (1, 1, 5.0, 'small'), (2, 1, 25.0, 'big'), (3, 2, 40.0, 'bigger');
                CREATE TABLE "Old Orders" (id INTEGER, total REAL);
                INSERT INTO "Old Orders" VALUES (9, 1.5);
                """;
            cmd.ExecuteNonQuery();
        }
        var main = Path.Combine(_h.Dir, "main.db");
        using (var c = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={main};Pooling=False"))
        {
            c.Open();
            using var cmd = c.CreateCommand();
            cmd.CommandText = "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO customers VALUES (1, 'Ada'), (2, 'Bo');";
            cmd.ExecuteNonQuery();
        }
        var shop = _h.AddConnection(new ConnectionProfile
        {
            Name = "Shop file", ProviderId = "sqlite",
            Props = new() { ["path"] = main, ["attach"] = new JsonArray(JsonValue.Create("archive=" + archive)) },
        }, null);
        var crm = _h.AddSqlite("crm", "CREATE TABLE regions (customer_id INTEGER, region TEXT); INSERT INTO regions VALUES (1, 'north'), (2, 'south');");
        _link = _h.AddLink("wide", new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "shop", ConnectionId = shop, Scope = LinkScopes.Database },
                new LinkMember { Alias = "crm", ConnectionId = crm, Scope = LinkScopes.Database },
            ],
        });
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await _h.DisposeAsync();

    [Fact]
    public async Task The_catalog_holds_only_the_default_schema()
    {
        var catalog = await _h.Runtime.CatalogAsync(_link, false, default);
        var shop = catalog.Schemas[0];
        Assert.Null(shop.Error);
        Assert.Equal(LinkScopes.Database, shop.Scope);
        Assert.Equal(["schema"], shop.Levels);
        Assert.Equal(["main"], shop.DefaultPath);
        Assert.Equal(["customers"], shop.Tables.Select(t => t.LinkName)); // the attached schema is not read yet
        Assert.Null(shop.Tables[0].Path);

        var top = await _h.Runtime.BrowseAsync(_link, new LinkBrowseRequest("shop"), default);
        Assert.Equal("schema", top.Level);
        Assert.Contains(top.Children, c => c is { Name: "main", IsDefault: true });
        Assert.Contains(top.Children, c => c is { Name: "archive", IsDefault: false });
        var archive = await _h.Runtime.BrowseAsync(_link, new LinkBrowseRequest("shop", ["archive"]), default);
        Assert.Null(archive.Level);
        var orders = archive.Tables.Single(t => t.Name == "orders");
        Assert.Equal("archive.orders", orders.LinkName);
        Assert.Equal(["archive", "orders"], orders.Path);
        Assert.Contains(orders.Columns, c => c.Name == "total");

        var resolved = await _h.Runtime.ResolveTablesAsync(_link, [new("shop", "archive.Old Orders"), new("shop", "customers"), new("shop", "archive.none")], default);
        Assert.Equal(["archive.Old Orders", "customers"], resolved.Tables.Select(t => t.Table.LinkName));
        Assert.Equal("shop.archive.none", Assert.Single(resolved.Missing).ToString());
    }

    [Fact]
    public async Task Three_part_names_query_and_push_down()
    {
        var session = await _h.OpenAsync(_link);
        var sink = await FederationHarness.RunAsync(session, """
            SELECT c.name, o.total, r.region
            FROM shop.archive.orders o
            JOIN shop.customers c ON c.id = o.customer_id
            JOIN crm.main.regions r ON r.customer_id = c.id
            WHERE o.total > 10
            ORDER BY o.total
            """);
        var rows = sink.Single();
        Assert.Equal(2, rows.Count);
        Assert.Equal("Ada", rows[0][0]);
        Assert.Equal("north", rows[0][2]);
        Assert.Equal("Bo", rows[1][0]);
        Assert.Contains(sink.Messages, m => m.Text.StartsWith("shop.archive.orders:", StringComparison.Ordinal));

        // the implicit alias of a three-part name, a quoted name, the default schema written out
        var implicitAlias = (await FederationHarness.RunAsync(session, "SELECT orders.note FROM shop.archive.orders WHERE orders.id = 3")).Single();
        Assert.Equal("bigger", Assert.Single(implicitAlias)[0]);
        Assert.Single((await FederationHarness.RunAsync(session, "SELECT * FROM shop.archive.\"Old Orders\"")).Single());
        Assert.Equal(2, (await FederationHarness.RunAsync(session, "SELECT * FROM shop.main.customers")).Single().Count);

        // the plan: projection and the filter pushed to the archive table
        var plan = await _h.Runtime.PlanAsync(_link, "SELECT o.id FROM shop.archive.orders o WHERE o.total > 10 AND o.note LIKE 'b%'", null, default);
        var src = Assert.Single(plan.Sources);
        Assert.Equal("shop.archive.orders", src.Table.ToString());
        Assert.Equal(["id", "total", "note"], src.Columns.OrderBy(c => c == "id" ? 0 : c == "total" ? 1 : 2));
        Assert.Equal(2, src.Predicates.Count);
        Assert.Contains("\"archive\"", src.SourceQuery, StringComparison.Ordinal);
        Assert.Contains("> 10", src.SourceQuery, StringComparison.Ordinal);

        // still read-only
        var write = await FederationHarness.RunAsync(session, "DELETE FROM shop.archive.orders");
        Assert.Equal(ErrorCodes.ReadOnly, Assert.Single(write.Errors).Code);
    }

    [Fact]
    public async Task Builder_sql_round_trips_through_resolve()
    {
        var resolved = await _h.Runtime.ResolveSqlAsync(_link, "SELECT o.id FROM shop.archive.orders AS o", default);
        Assert.Equal("SELECT o.id FROM shop.\"archive.orders\" AS o", resolved.Sql);
        var table = resolved.Catalog.Schemas[0].Tables.Single(t => t.LinkName == "archive.orders");
        Assert.Equal(["archive", "orders"], table.Path);
        var builder = Builder.BuilderCatalog.From(resolved.Catalog);
        Assert.Equal("shop.archive.orders", builder.TableSql("shop", "archive.orders"));
        Assert.Equal("shop.customers", builder.TableSql("shop", "customers"));
    }

    [Fact]
    public async Task Validation_of_scopes()
    {
        var crm = _h.Runtime.Definition(_link).Members[1].ConnectionId;
        var def = new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "f", Kind = LinkMemberKinds.Files, Scope = LinkScopes.Database, Tables = [new MountedTable { Name = "C:/a.csv", As = "a" }] },
                new LinkMember { Alias = "t", ConnectionId = crm, Scope = LinkScopes.Tables },
                new LinkMember { Alias = "w", ConnectionId = crm, Scope = LinkScopes.Database },
                new LinkMember { Alias = "x", ConnectionId = crm, Scope = "galaxy" },
            ],
        };
        var r = await _h.Runtime.ValidateAsync(def, null, true, default);
        Assert.False(r.Ok);
        Assert.Contains(r.Problems, p => p is { Code: LinkProblemCodes.ScopeInvalid, Member: 0 });
        Assert.Contains(r.Problems, p => p is { Code: LinkProblemCodes.NoTables, Member: 1, Severity: "error" });
        Assert.DoesNotContain(r.Problems, p => p.Member == 2 && p.Severity == "error");
        Assert.Contains(r.Problems, p => p is { Code: LinkProblemCodes.ScopeInvalid, Member: 3 });
        Assert.Equal(1, r.Members[2].Tables); // the default schema of the wide member: regions
    }
}

/// <summary>MongoDB: a whole database = every collection; a whole connection spans the databases (over a fake gateway).</summary>
public sealed class WideMongoTests : IAsyncLifetime
{
    private readonly FederationHarness _h = new();

    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await _h.DisposeAsync();

    private static readonly Dictionary<string, string[]> Collections = new()
    {
        ["shop"] = ["orders", "customers", "system.views"],
        ["media"] = ["fs.files"],
        ["admin"] = ["system.users"],
    };

    private LinkRuntime.MemberHandle Handle(LinkMember member)
    {
        var profile = new ConnectionProfile { Id = "c_mongo", Name = "Mongo", ProviderId = "mongodb", Props = new() { ["database"] = "shop" } };
        var gateway = FakeGateway.Create();
        var source = FakeSource.Create(profile, gateway);
        var context = new SourceContext
        {
            Member = member, Profile = profile, Source = source, Services = new ServiceCollection().BuildServiceProvider(),
            Limits = new FederationLimits(1000, TimeSpan.FromSeconds(30), 0, 0, _h.Dir, false),
        };
        return new LinkRuntime.MemberHandle(0, member, "mongodb", new MongoFetcher(), context, null, "MongoDB");
    }

    [Fact]
    public async Task Whole_database_mounts_every_collection()
    {
        var member = new LinkMember { Alias = "mg", ConnectionId = "c_mongo", Scope = LinkScopes.Database, Schema = "shop" }.Normalized();
        var h = Handle(member);
        var layout = await _h.Runtime.LayoutAsync(null, h, false, default);
        Assert.Empty(layout.Levels);
        var cat = await _h.Runtime.ContainerAsync(null, h, layout, layout.Container([]), false, default);
        Assert.Equal(["customers", "orders"], cat.Tables.Select(t => t.LinkName).Order());
        Assert.All(cat.Tables, t => Assert.Null(t.Path));
    }

    [Fact]
    public async Task Whole_connection_names_database_dot_collection()
    {
        var member = new LinkMember { Alias = "mg", ConnectionId = "c_mongo", Scope = LinkScopes.Connection }.Normalized();
        var h = Handle(member);
        var layout = await _h.Runtime.LayoutAsync(null, h, false, default);
        Assert.Equal(["schema"], layout.Levels);
        Assert.Equal(["shop"], layout.DefaultPath);
        Assert.Equal(["media", "shop"], layout.Schemas); // admin / local / config left out

        var media = await _h.Runtime.ContainerAsync(null, h, layout, layout.Container(["media"]), false, default);
        var files = Assert.Single(media.Tables);
        Assert.Equal("media.fs.files", files.LinkName);
        Assert.Equal(["media", "fs.files"], files.Path);
        Assert.Equal("media", files.Schema);

        // mg.media."fs.files" → that collection; a fetch context reads the media database
        Assert.Equal("SELECT * FROM mg.\"media.fs.files\" AS \"fs.files\"",
            LinkNames.Rewrite("SELECT * FROM mg.media.\"fs.files\"", new Dictionary<string, WideLayout> { ["mg"] = layout }));
        var fetch = LinkRuntime.FetchContext(h, files);
        Assert.Equal("media", fetch.Member.Schema);
        Assert.Equal(LinkScopes.Schema, fetch.Member.Scope);
    }

    /// <summary>The handful of gateway calls the fetcher makes.</summary>
    public class FakeGateway : DispatchProxy
    {
        public static IMongoGateway Create() => DispatchProxy.Create<IMongoGateway, FakeGateway>();

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            IReadOnlyList<BsonDocument> docs;
            switch (method!.Name)
            {
                case nameof(IMongoGateway.ListDatabasesAsync):
                    docs = Collections.Keys.Select(k => new BsonDocument("name", k)).Append(new BsonDocument("name", "local")).ToList();
                    return Task.FromResult(docs);
                case nameof(IMongoGateway.ListCollectionsAsync):
                    docs = (Collections.GetValueOrDefault((string)args![0]!) ?? []).Select(n => new BsonDocument { ["name"] = n, ["type"] = "collection" }).ToList();
                    return Task.FromResult(docs);
                case nameof(IMongoGateway.FindAsync):
                    docs = [new BsonDocument { ["_id"] = ObjectId.GenerateNewId(), ["n"] = 1 }];
                    return Task.FromResult(docs);
                case nameof(IMongoGateway.EstimatedCountAsync):
                    return Task.FromResult(1L);
                case nameof(IAsyncDisposable.DisposeAsync):
                    return ValueTask.CompletedTask;
                case "get_Client":
                    return null;
                default:
                    throw new NotSupportedException(method.Name);
            }
        }
    }

    /// <summary>A MongoDB provider that hands out a client over <see cref="FakeGateway"/>.</summary>
    public class FakeSource : DispatchProxy
    {
        private ConnectionProfile _profile = null!;
        private IMongoGateway _gateway = null!;

        public static IDataSourceProvider Create(ConnectionProfile profile, IMongoGateway gateway)
        {
            var p = DispatchProxy.Create<IDataSourceProvider, FakeSource>();
            var f = (FakeSource)(object)p;
            f._profile = profile;
            f._gateway = gateway;
            return p;
        }

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method!.Name switch
        {
            nameof(IDataSourceProvider.OpenAsync) => Task.FromResult<IDataSourceClient>(
                new MongoClientHandle(_profile.Id, _profile, _gateway, new ServerInfo("7.0", null, "fake", null, "shop"))),
            "get_Id" => "mongodb",
            "get_DisplayName" => "MongoDB",
            _ => throw new NotSupportedException(method.Name),
        };
    }
}

/// <summary>Live: a whole SQL Server database joined with a whole PostgreSQL database (Docker sample "shop"; skipped when not running).</summary>
public sealed class DockerWideTests
{
    [SkippableFact]
    public async Task Whole_sql_server_shop_x_whole_postgresql_shop()
    {
        foreach (var s in new[] { Server.SqlServer, Server.PostgreSql })
            Skip.IfNot(s.Reachable(), $"{s.Name} is not reachable (start engine/tests/docker/compose.yml or set DBSTUDIO_IT=0).");
        await using var h = new FederationHarness();
        var ss = h.AddConnection(Server.SqlServer.Profile(), Server.SqlServer.Password);
        var pg = h.AddConnection(Server.PostgreSql.Profile(), Server.PostgreSql.Password);
        var link = h.AddLink("Two whole databases", new LinkDefinition
        {
            Members =
            [
                new LinkMember { Alias = "ms", ConnectionId = ss, Database = "shop", Scope = LinkScopes.Database },
                new LinkMember { Alias = "srv", ConnectionId = ss, Scope = LinkScopes.Connection },
                new LinkMember { Alias = "pg", ConnectionId = pg, Database = "shop", Scope = LinkScopes.Database },
            ],
        });
        var session = await h.OpenAsync(link);
        var sink = await FederationHarness.RunAsync(session, """
            SELECT c.name, count(DISTINCT o.id) AS orders, sum(l.qty * p.price) AS amount
            FROM ms.dbo.Customers c
            JOIN pg.public.orders o ON o.customer_id = c.id
            JOIN pg.order_lines l ON l.order_id = o.id
            JOIN pg.public.products p ON p.id = l.product_id
            GROUP BY c.name
            ORDER BY c.name
            """);
        var rows = sink.Single();
        Assert.Equal(["Alice", "Bob", "Chie", "Dora"], rows.Select(r => (string)r[0]!));

        // the whole connection reaches the same table as srv.shop.dbo.Customers; the filter is pushed to SQL Server
        var one = await FederationHarness.RunAsync(session, "SELECT c.name FROM srv.shop.dbo.Customers c WHERE c.id = 1");
        Assert.Equal("Alice", Assert.Single(one.Single())[0]);
        var plan = ((Provider.FederatedSession)session).Context.LastPlan!;
        Assert.Contains("= 1", Assert.Single(plan.Sources).SourceQuery, StringComparison.Ordinal);
    }
}

/// <summary>Native scripts of wide members: one IMPORT FOREIGN SCHEMA per remote schema, one foreign server per database.</summary>
public sealed class WideNativeScriptTests
{
    private static ConnectionProfile P(string provider, Dictionary<string, JsonNode?> props) => new() { Id = "c_" + provider, Name = provider, ProviderId = provider, Props = props };

    [Fact]
    public void Postgres_whole_database_imports_every_schema()
    {
        var member = new Native.NativeLinkSource("pg", "postgresql", P("postgresql", new() { ["host"] = "pg", ["database"] = "shop", ["user"] = "u" }), "shop", null, true, [], null,
            LinkScopes.Database, [new(null, "public"), new(null, "sales")]);
        var r = Native.NativeLinkScripter.Script(Dialect.PgSql, "postgresql", member, null, null);
        Assert.Contains("IMPORT FOREIGN SCHEMA \"public\" FROM SERVER pg INTO pg_public;", r.Script, StringComparison.Ordinal);
        Assert.Contains("IMPORT FOREIGN SCHEMA \"sales\" FROM SERVER pg INTO pg_sales;", r.Script, StringComparison.Ordinal);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(r.Script, "CREATE SERVER"));
        Assert.DoesNotContain("LIMIT TO", r.Script, StringComparison.Ordinal);
    }

    [Fact]
    public void Sql_server_whole_connection_gets_a_server_per_database_over_tds_fdw()
    {
        var member = new Native.NativeLinkSource("ms", "sqlserver", P("sqlserver", new() { ["server"] = "mssql,1433", ["auth"] = "sql", ["user"] = "sa", ["database"] = "shop" }),
            null, null, true, [], null, LinkScopes.Connection, [new("shop", "dbo"), new("shop", "sales"), new("hr", "dbo")]);
        var r = Native.NativeLinkScripter.Script(Dialect.PgSql, "postgresql", member, null, null);
        Assert.Equal(2, System.Text.RegularExpressions.Regex.Matches(r.Script, "CREATE SERVER").Count);
        Assert.Contains("database 'hr'", r.Script, StringComparison.Ordinal);
        Assert.Contains("INTO ms_hr_dbo;", r.Script, StringComparison.Ordinal);
        Assert.DoesNotContain("sa_password", r.Script, StringComparison.Ordinal);

        var linked = Native.NativeLinkScripter.Script(Dialect.TSql, "sqlserver", member, null, null);
        Assert.DoesNotContain("@catalog", linked.Script, StringComparison.Ordinal);
        Assert.Contains(linked.Notes, n => n.Contains("every database and schema", StringComparison.Ordinal));
    }
}
