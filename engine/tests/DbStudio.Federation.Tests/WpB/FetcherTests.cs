using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Fetchers;
using DbStudio.Sources.Elasticsearch;
using DbStudio.Sources.Mongo;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;

namespace DbStudio.Federation.Tests.WpB;

internal static class Ctx
{
    public static readonly FederationLimits Limits = new(2_000_000, TimeSpan.FromSeconds(60), 0, 0, Path.GetTempPath(), false);

    public static SourceContext For(LinkMember member, ConnectionProfile? profile = null, Core.Providers.IDataSourceProvider? source = null, long maxRows = 2_000_000) => new()
    {
        Member = member,
        Profile = profile,
        Source = source,
        Limits = Limits with { MaxRowsPerSource = maxRows },
        Services = new ServiceCollection().BuildServiceProvider(),
    };

    public static FetchRequest Request(SourceTable table, IReadOnlyList<string> columns, IReadOnlyList<PushdownPredicate>? predicates = null, long? limit = null, long maxRows = 2_000_000) => new()
    {
        Table = table,
        Columns = columns,
        Predicates = predicates ?? [],
        Limit = limit,
        MaxRows = maxRows,
        Timeout = TimeSpan.FromSeconds(60),
    };

    public static PushdownPredicate P(string column, string op, params (string Kind, string Value)[] values) =>
        new(column, op, values.Select(v => new PushdownLiteral(v.Kind, v.Value)).ToList());
}

/// <summary>Files member: CSV / TSV / JSON / NDJSON through Import's readers (no DuckDB file access).</summary>
public sealed class FileFetcherTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("rowlit-files-").FullName;
    public void Dispose() { try { Directory.Delete(_dir, true); } catch (IOException) { } }

    private string Write(string name, string text)
    {
        var p = Path.Combine(_dir, name);
        File.WriteAllText(p, text);
        return p;
    }

    [Fact]
    public async Task Csv_catalog_infers_kinds_and_fetch_converts()
    {
        var csv = Write("people.csv", "id,name,amount,born,active\n1,Ann,10.50,2001-02-03,true\n2,Bob,,1999-12-31,false\n3,\"C, D\",7,2000-01-01,true\n");
        var tsv = Write("t.tsv", "a\tb\nx\t1\n");
        var member = new LinkMember
        {
            Alias = "f", Kind = LinkMemberKinds.Files,
            Tables = [new MountedTable { Name = csv, As = "people" }, new MountedTable { Name = tsv, As = "t" }, new MountedTable { Name = Path.Combine(_dir, "missing.csv"), As = "m" },
                new MountedTable { Name = Write("p.parquet", "x"), As = "p" }],
        };
        var f = new FileFetcher();
        var ctx = Ctx.For(member);
        var cat = await f.LoadCatalogAsync(ctx, default);
        Assert.Equal(["people", "t"], cat.Tables.Select(t => t.LinkName));
        Assert.Contains(cat.Warnings, w => w.Contains("missing.csv", StringComparison.Ordinal));
        Assert.Contains(cat.Warnings, w => w.Contains("Parquet", StringComparison.Ordinal));
        var people = cat.Tables[0];
        Assert.Equal(["int", "string", "decimal", "date", "bool"], people.Columns.Select(c => c.Kind));
        Assert.Equal("file", people.Type);

        var proposed = Ctx.Request(people, ["name", "amount", "born"], [Ctx.P("id", PushdownOps.Eq, ("int", "1"))], limit: 1);
        var accepted = f.Accept(ctx, proposed);
        Assert.Empty(accepted.Predicates);
        Assert.Null(accepted.Limit); // a dropped predicate drops the limit

        var app = new CapturingAppender();
        var r = await f.FetchAsync(ctx, Ctx.Request(people, ["name", "amount", "born"]), app, null, default);
        Assert.Equal((3L, false), (r.Rows, r.Truncated));
        Assert.Equal(["Ann", 10.50m, new DateTime(2001, 2, 3)], app.Rows[0]);
        Assert.Null(app.Rows[1][1]);
        Assert.Equal("C, D", app.Rows[2][0]);

        app = new CapturingAppender();
        r = await f.FetchAsync(ctx, Ctx.Request(people, ["id"], maxRows: 2), app, null, default);
        Assert.Equal((2L, true), (r.Rows, r.Truncated));
        app = new CapturingAppender();
        r = await f.FetchAsync(ctx, Ctx.Request(people, ["id"], limit: 1), app, null, default);
        Assert.Equal((1L, false), (r.Rows, r.Truncated));
        Assert.Contains("people.csv", f.Describe(ctx, Ctx.Request(people, ["id"])), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Json_and_ndjson()
    {
        var json = Write("a.json", """{"rows":[{"id":1,"tags":["x"],"name":"Ann"},{"id":2,"name":null}]}""");
        var nd = Write("b.ndjson", "{\"k\":\"a\",\"v\":1.5}\n{\"k\":\"b\",\"v\":2}\n");
        var member = new LinkMember { Alias = "f", Kind = LinkMemberKinds.Files, Tables = [new MountedTable { Name = json, As = "a" }, new MountedTable { Name = nd, As = "b" }] };
        var f = new FileFetcher();
        var cat = await f.LoadCatalogAsync(Ctx.For(member), default);
        Assert.Equal(2, cat.Tables.Count);
        var b = cat.Tables[1];
        Assert.Equal(["k", "v"], b.Columns.Select(c => c.Name));
        var app = new CapturingAppender();
        await f.FetchAsync(Ctx.For(member), Ctx.Request(b, ["v", "k"]), app, null, default);
        Assert.Equal([1.5m, "a"], app.Rows[0]);
        var a = cat.Tables[0];
        Assert.Contains("id", a.Columns.Select(c => c.Name));
    }

    [Fact]
    public async Task Relative_paths_are_refused()
    {
        var member = new LinkMember { Alias = "f", Kind = LinkMemberKinds.Files, Tables = [new MountedTable { Name = "rel.csv", As = "r" }] };
        var cat = await new FileFetcher().LoadCatalogAsync(Ctx.For(member), default);
        Assert.Empty(cat.Tables);
        Assert.Contains(cat.Warnings, w => w.Contains("absolute", StringComparison.Ordinal));
    }
}

/// <summary>Pure push-down rules of the Mongo and Elasticsearch fetchers (no server).</summary>
public sealed class DocumentPushdownTests
{
    private static readonly SourceTable Orders = new("orders", "orders", null, "shop", "collection",
    [
        new("_id", "objectId", "string", false, true), new("status", "string", "string", true), new("total", "double", "float", true),
        new("createdAt", "date", "datetime", true), new("phone", "long|string", "string", true), new("items", "array", "json", true),
    ], ["_id"], []);

    [Fact]
    public void Mongo_pushes_single_typed_fields_only()
    {
        var f = new MongoFetcher();
        var ctx = Ctx.For(new LinkMember { Alias = "m", Schema = "shop" });
        var proposed = Ctx.Request(Orders, ["status", "total"],
        [
            Ctx.P("status", PushdownOps.In, ("string", "paid"), ("string", "shipped")),
            Ctx.P("total", PushdownOps.Between, ("decimal", "10.5"), ("int", "100")),
            Ctx.P("createdAt", PushdownOps.Ge, ("datetime", "2025-01-01T00:00:00")),
            Ctx.P("_id", PushdownOps.Eq, ("string", "c0ffee000000000000000001")),
            Ctx.P("status", PushdownOps.IsNotNull),
            Ctx.P("status", PushdownOps.Like, ("string", "pa%")),
        ], limit: 5);
        var accepted = f.Accept(ctx, proposed);
        Assert.Equal(6, accepted.Predicates.Count);
        Assert.Equal(5, accepted.Limit);
        var pipeline = MongoFetcher.Pipeline(accepted);
        var text = string.Join(" ", pipeline.Select(s => s.ToJson()));
        Assert.True(text.Contains("\"$in\" : [\"paid\", \"shipped\"]", StringComparison.Ordinal), text);
        Assert.True(text.Contains("\"$gte\" : { \"$numberDecimal\" : \"10.5\" }, \"$lte\" : 100", StringComparison.Ordinal), text);
        Assert.True(text.Contains("{ \"$oid\" : \"c0ffee000000000000000001\" }", StringComparison.Ordinal), text);
        Assert.True(text.Contains("\"pattern\" : \"^pa.*$\", \"options\" : \"s\"", StringComparison.Ordinal), text);
        Assert.True(text.Contains("{ \"$project\" : { \"status\" : 1, \"total\" : 1, \"_id\" : 0 } }", StringComparison.Ordinal), text);
        Assert.True(text.Contains("{ \"$limit\" : 5 }", StringComparison.Ordinal), text);

        // mixed-type field, wrong literal kind, json field, bad ObjectId: not pushed, and the limit goes too
        var mixed = f.Accept(ctx, Ctx.Request(Orders, ["phone"],
            [Ctx.P("phone", PushdownOps.Eq, ("string", "5")), Ctx.P("total", PushdownOps.Eq, ("string", "x")), Ctx.P("items", PushdownOps.IsNotNull), Ctx.P("_id", PushdownOps.Eq, ("string", "nope"))], limit: 3));
        Assert.Equal(["items"], mixed.Predicates.Select(p => p.Column)); // IS NOT NULL works on any field
        Assert.Null(mixed.Limit);
        Assert.Contains("aggregate([", f.Describe(ctx, accepted), StringComparison.Ordinal);
    }

    [Fact]
    public void Mongo_infers_top_level_fields()
    {
        var docs = new[]
        {
            BsonDocument.Parse("{ name: 'a', n: 1, x: 1.5, nested: { a: 1 }, when: ISODate('2025-01-01T00:00:00Z') }"),
            BsonDocument.Parse("{ _id: ObjectId('c0ffee000000000000000001'), name: 'b', n: NumberLong(2), x: 2, d: NumberDecimal('1.25') }"),
            BsonDocument.Parse("{ _id: 3, name: null, n: 3, x: 'oops' }"),
        };
        var cols = MongoFetcher.Infer(docs);
        Assert.Equal(["_id", "name", "n", "x", "nested", "when", "d"], cols.Select(c => c.Name));
        Assert.Equal(["string", "string", "int", "string", "json", "datetime", "decimal"], cols.Select(c => c.Kind));
        Assert.Equal("int|objectId", cols[0].SourceType);
        Assert.Equal("{ \"a\" : 1 }", MongoFetcher.Clr(docs[0]["nested"], "json"));
        Assert.Equal(new DateTime(2025, 1, 1), MongoFetcher.Clr(docs[0]["when"], "datetime"));
        Assert.Equal("c0ffee000000000000000001", MongoFetcher.Clr(docs[1]["_id"], "string"));
    }

    [Fact]
    public void Mongo_empty_collection_still_has_an_id_column()
    {
        // QA round: an empty collection used to mount with no columns, and `select count(*) from mg.sessions` failed with
        // "table does not exist" instead of returning 0.
        var cols = MongoFetcher.Infer([]);
        var id = Assert.Single(cols);
        Assert.Equal(("_id", ColumnKinds.String, true), (id.Name, id.Kind, id.IsPk));
    }

    [Fact]
    public void Elastic_clauses()
    {
        var mapping = JsonDocument.Parse("""
            { "shop-customers": { "mappings": { "properties": {
                "name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
                "notes": { "type": "text" }, "tier": { "type": "keyword" }, "age": { "type": "long" }, "createdAt": { "type": "date" },
                "address": { "properties": { "city": { "type": "keyword" }, "geo": { "type": "geo_point" } } },
                "items": { "type": "nested", "properties": { "sku": { "type": "keyword" } } }
            } } } }
            """).RootElement;
        var cols = ElasticFetcher.Columns(mapping);
        Assert.Equal(["_id", "name", "notes", "tier", "age", "createdAt", "address.city", "address.geo", "items"], cols.Select(c => c.Name));
        Assert.Equal(["string", "string", "string", "string", "int", "datetime", "string", "json", "json"], cols.Select(c => c.Kind));
        var table = new SourceTable("shop-customers", "customers", null, null, "index", cols, ["_id"], []);
        var f = new ElasticFetcher();
        var ctx = Ctx.For(new LinkMember { Alias = "es" });
        var accepted = f.Accept(ctx, Ctx.Request(table, ["name", "age"],
        [
            Ctx.P("name", PushdownOps.Eq, ("string", "Ann")),
            Ctx.P("tier", PushdownOps.In, ("string", "gold"), ("string", "silver")),
            Ctx.P("age", PushdownOps.Between, ("int", "18"), ("int", "65")),
            Ctx.P("createdAt", PushdownOps.Lt, ("datetime", "2025-01-01T00:00:00")),
            Ctx.P("address.city", PushdownOps.Ne, ("string", "Paris")),
            Ctx.P("tier", PushdownOps.IsNotNull),
        ], limit: 7));
        Assert.Equal(6, accepted.Predicates.Count);
        Assert.Equal(7, accepted.Limit);
        var body = ElasticFetcher.Body(accepted, 7).ToJsonString();
        Assert.Contains("{\"term\":{\"name.keyword\":\"Ann\"}}", body, StringComparison.Ordinal);
        Assert.Contains("{\"terms\":{\"tier\":[\"gold\",\"silver\"]}}", body, StringComparison.Ordinal);
        Assert.Contains("{\"range\":{\"age\":{\"gte\":18,\"lte\":65}}}", body, StringComparison.Ordinal);
        Assert.Contains("{\"range\":{\"createdAt\":{\"lt\":\"2025-01-01T00:00:00.000Z\"}}}", body, StringComparison.Ordinal);
        Assert.Contains("{\"bool\":{\"must_not\":[{\"term\":{\"address.city\":\"Paris\"}}]}}", body, StringComparison.Ordinal);
        Assert.Contains("{\"exists\":{\"field\":\"tier\"}}", body, StringComparison.Ordinal);
        Assert.Contains("\"_source\":[\"name\",\"age\"]", body, StringComparison.Ordinal);

        var dropped = f.Accept(ctx, Ctx.Request(table, ["notes"], [Ctx.P("notes", PushdownOps.Eq, ("string", "x")), Ctx.P("age", PushdownOps.Like, ("string", "1%"))], limit: 2));
        Assert.Empty(dropped.Predicates);
        Assert.Null(dropped.Limit);

        var src = JsonDocument.Parse("""{ "address": { "city": "Berlin" }, "a.b": 1, "tags": ["x", "y"] }""").RootElement;
        Assert.Equal("Berlin", ElasticFetcher.Clr(ElasticFetcher.Lookup(src, "address.city"), "string"));
        Assert.Equal(1L, ElasticFetcher.Clr(ElasticFetcher.Lookup(src, "a.b"), "int"));
        Assert.Equal("[\"x\", \"y\"]", ElasticFetcher.Clr(ElasticFetcher.Lookup(src, "tags"), "string"));
        Assert.Null(ElasticFetcher.Lookup(src, "address.zip"));
    }
}

/// <summary>Docker IT: the Mongo and Elasticsearch fetchers against the dbstudio-it shop seeds (skipped when not running).</summary>
public sealed class DockerFetcherTests
{
    private static ConnectionProfile Mongo() => new()
    {
        Id = "c_mongo_it", Name = "IT mongo", ProviderId = "mongodb",
        Props = new() { ["uri"] = "mongodb://localhost:27018/?directConnection=true", ["database"] = "shop" },
    };

    private static ConnectionProfile Es() => new()
    {
        Id = "c_es_it", Name = "IT es", ProviderId = "elasticsearch", Props = new() { ["url"] = "http://localhost:19200" },
    };

    [SkippableFact]
    public async Task Mongo_catalog_and_fetch()
    {
        Skip.IfNot(Docker.Reachable("localhost", 27018), "MongoDB (dbstudio-it, port 27018) is not running.");
        var member = new LinkMember { Alias = "docs", ConnectionId = "c_mongo_it", Schema = "shop", Tables = [new MountedTable { Name = "orders" }, new MountedTable { Name = "products", As = "items" }, new MountedTable { Name = "nope" }] };
        var ctx = Ctx.For(member, Mongo(), new MongoProvider());
        var f = new MongoFetcher();
        var cat = await f.LoadCatalogAsync(ctx, default);
        Assert.Equal(["orders", "items"], cat.Tables.Select(t => t.LinkName));
        Assert.Contains(cat.Warnings, w => w.Contains("nope", StringComparison.Ordinal));
        var orders = cat.Tables[0];
        Assert.Equal(["_id"], orders.PrimaryKey);
        Assert.True(orders.RowEstimate >= 1000);
        var status = orders.Columns.Single(c => c.Name == "status");
        Assert.Equal(("string", "string"), (status.Kind, status.SourceType));
        Assert.Equal("float", orders.Columns.Single(c => c.Name == "total").Kind);
        Assert.Equal("json", orders.Columns.Single(c => c.Name == "items").Kind);

        var all = new CapturingAppender();
        var r = await f.FetchAsync(ctx, f.Accept(ctx, Ctx.Request(orders, ["_id", "status"])), all, null, default);
        Assert.Equal(orders.RowEstimate, r.Rows);
        var paid = all.Rows.Count(x => (string?)x[1] == "paid");

        var app = new CapturingAppender();
        var req = f.Accept(ctx, Ctx.Request(orders, ["status", "total", "items"], [Ctx.P("status", PushdownOps.Eq, ("string", "paid"))]));
        r = await f.FetchAsync(ctx, req, app, null, default);
        Assert.Equal(paid, r.Rows);
        Assert.All(app.Rows, x => Assert.Equal("paid", x[0]));
        Assert.All(app.Rows, x => Assert.True(x[1] is double or long, x[1]?.GetType().Name)); // a few seeded totals are integers
        Assert.StartsWith("[", (string)app.Rows[0][2]!, StringComparison.Ordinal);
        Assert.Contains("$match", r.SourceQuery, StringComparison.Ordinal);

        app = new CapturingAppender();
        r = await f.FetchAsync(ctx, f.Accept(ctx, Ctx.Request(orders, ["_id"], maxRows: 10)), app, null, default);
        Assert.Equal((10L, true), (r.Rows, r.Truncated));
        Assert.Matches("^[0-9a-f]{24}$", (string)app.Rows[0][0]!);

        app = new CapturingAppender();
        r = await f.FetchAsync(ctx, f.Accept(ctx, Ctx.Request(orders, ["_id"], limit: 3)), app, null, default);
        Assert.Equal((3L, false), (r.Rows, r.Truncated));

        var products = cat.Tables[1];
        Assert.Equal("decimal", products.Columns.Single(c => c.Name == "price").Kind);
        Assert.Equal("string", products.Columns.Single(c => c.Name == "rating").Kind); // int | double | string
        app = new CapturingAppender();
        await f.FetchAsync(ctx, f.Accept(ctx, Ctx.Request(products, ["sku", "price", "stock"], [Ctx.P("sku", PushdownOps.Eq, ("string", "SKU-0001"))])), app, null, default);
        var row = Assert.Single(app.Rows);
        Assert.IsType<decimal>(row[1]);
        Assert.IsType<long>(row[2]);
    }

    [SkippableFact]
    public async Task Elasticsearch_catalog_and_fetch()
    {
        Skip.IfNot(Docker.Reachable("localhost", 19200), "Elasticsearch (dbstudio-it --profile search, port 19200) is not running.");
        var member = new LinkMember { Alias = "es", ConnectionId = "c_es_it", Tables = [new MountedTable { Name = "shop-orders", As = "orders" }, new MountedTable { Name = "shop-customers", As = "customers" }, new MountedTable { Name = "nope-index" }] };
        var ctx = Ctx.For(member, Es(), new EsProvider());
        var f = new ElasticFetcher();
        var cat = await f.LoadCatalogAsync(ctx, default);
        Assert.Equal(["orders", "customers"], cat.Tables.Select(t => t.LinkName));
        Assert.Contains(cat.Warnings, w => w.Contains("nope-index", StringComparison.Ordinal));
        var orders = cat.Tables[0];
        Assert.Equal(2000, orders.RowEstimate);
        Assert.Equal(["_id", "createdAt", "customerId", "items", "status", "total"], orders.Columns.Select(c => c.Name).Order(StringComparer.Ordinal));

        var all = new CapturingAppender();
        var r = await f.FetchAsync(ctx, f.Accept(ctx, Ctx.Request(orders, ["_id", "status", "total"])), all, null, default);
        Assert.Equal(2000L, r.Rows); // two scroll pages
        Assert.Equal(2000, all.Rows.Select(x => (string)x[0]!).Distinct().Count());
        var paid = all.Rows.Count(x => (string?)x[1] == "paid");
        var big = all.Rows.Count(x => (string?)x[1] == "paid" && (double)x[2]! >= 100);

        var app = new CapturingAppender();
        var req = f.Accept(ctx, Ctx.Request(orders, ["status", "total", "createdAt"], [Ctx.P("status", PushdownOps.Eq, ("string", "paid")), Ctx.P("total", PushdownOps.Ge, ("int", "100"))]));
        Assert.Equal(2, req.Predicates.Count);
        r = await f.FetchAsync(ctx, req, app, null, default);
        Assert.Equal(big, r.Rows);
        Assert.All(app.Rows, x => Assert.IsType<DateTime>(x[2]));
        Assert.True(paid > big);

        app = new CapturingAppender();
        r = await f.FetchAsync(ctx, f.Accept(ctx, Ctx.Request(orders, ["_id"], maxRows: 1500)), app, null, default);
        Assert.Equal((1500L, true), (r.Rows, r.Truncated));

        var customers = cat.Tables[1];
        Assert.Contains("address.city", customers.Columns.Select(c => c.Name));
        app = new CapturingAppender();
        r = await f.FetchAsync(ctx, f.Accept(ctx, Ctx.Request(customers, ["name", "address.city", "tags"], limit: 5)), app, null, default);
        Assert.Equal(5L, r.Rows);
        Assert.All(app.Rows, x => Assert.False(string.IsNullOrEmpty((string?)x[1])));
    }
}
