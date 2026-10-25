using DbStudio.Core.Models;
using DbStudio.Core.Providers;

namespace DbStudio.Providers.PostgreSql.Tests;

public sealed class PgTypeUnitTests
{
    [Theory]
    [InlineData("e", TypeKinds.Enum)]
    [InlineData("d", TypeKinds.Domain)]
    [InlineData("c", TypeKinds.Composite)]
    [InlineData("r", TypeKinds.Range)]
    public void TypeKind_MapsTyptype(string typtype, string kind) => Assert.Equal(kind, PgCatalogReader.TypeKind(typtype));

    [Fact]
    public void MapTypeUsage_MergesPerObject_AndMapsRelationKinds()
    {
        var usage = PgCatalogReader.MapTypeUsage(
        [
            new("r", "public", "orders", "column status"),
            new("r", "public", "orders", "column prev_status"),
            new("v", "public", "open_orders", "column status"),
            new("c", "public", "wrapper", "column inner"),
            new("F", "public", "f_status", "parameter"),
            new("F", "public", "f_status", "return type"),
            new("T", "app", "list_status", "return type"),
            new("P", "public", "set_status", "parameter"),
            new("r", "public", "orders", "column status"),
        ]);
        Assert.Equal(
            ["app.list_status|tablefunc|return type", "public.f_status|func|parameter; return type", "public.open_orders|view|column status",
             "public.orders|table|column status; column prev_status", "public.set_status|proc|parameter", "public.wrapper|type|column inner"],
            usage.Select(u => $"{u.Schema}.{u.Name}|{u.Type}|{u.Usage}"));
    }

    [Fact]
    public void TypeUsedByRoutines_BindsTheTypeOidOnce() => Assert.DoesNotContain("$2", PgDependencyQueries.TypeUsedByRoutines);
}

/// <summary>Enums, domains, composites and ranges of the seeded shop (public.order_status, email_address, positive_int, address, price_range).</summary>
public sealed class PgTypeIntegrationTests(PgFixture fixture) : IClassFixture<PgFixture>
{
    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "PostgreSQL not available.");

    private static ObjectRef Ref(string name) => new(null, "public", name, ObjectTypes.Type);

    [SkippableFact]
    public async Task LoadSchema_ReportsKindAndSummary()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var pub = await reader.LoadSchemaAsync(null, "public", CancellationToken.None);
        var types = pub.Objects.Where(o => o.Type == ObjectTypes.Type).ToDictionary(o => o.Name);
        Assert.Equal((TypeKinds.Enum, "4 labels"), (types["order_status"].Kind, types["order_status"].BaseType));
        Assert.Equal((TypeKinds.Domain, "text"), (types["email_address"].Kind, types["email_address"].BaseType));
        Assert.Equal((TypeKinds.Domain, "integer"), (types["positive_int"].Kind, types["positive_int"].BaseType));
        Assert.Equal((TypeKinds.Composite, "3 attributes"), (types["address"].Kind, types["address"].BaseType));
        Assert.Equal(["street", "city", "zip"], types["address"].Columns.Select(c => c.Name));
        Assert.Equal((TypeKinds.Range, "numeric"), (types["price_range"].Kind, types["price_range"].BaseType));
        Assert.StartsWith("domain over text", types["email_address"].Comment); // the explorer tooltip / IntelliSense keep reading this
    }

    [SkippableFact]
    public async Task Enum_Details_ListLabels_AndColumnsUsingIt()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var d = await reader.GetObjectDetailsAsync(Ref("order_status"), CancellationToken.None);
        Assert.Equal(["new", "paid", "shipped", "cancelled"], d.Columns.Select(c => c.Name));
        var info = d.TypeInfo!;
        Assert.Equal(TypeKinds.Enum, info.Kind);
        Assert.Equal("4", info.Properties.Single(p => p.Name == "Labels").Value);
        Assert.Contains(info.UsedBy, u => u is { Name: "orders", Type: ObjectTypes.Table } && u.Usage == "column status");
    }

    [SkippableFact]
    public async Task Domain_Details_HaveBaseDefaultAndConstraints()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var d = await reader.GetObjectDetailsAsync(Ref("positive_int"), CancellationToken.None);
        var info = d.TypeInfo!;
        Assert.Equal(TypeKinds.Domain, info.Kind);
        Assert.Equal("integer", info.Properties.Single(p => p.Name == "Base type").Value);
        Assert.Equal("no", info.Properties.Single(p => p.Name == "Nullable").Value);
        Assert.Equal("1", info.Properties.Single(p => p.Name == "Default").Value);
        Assert.Equal("Constraints", info.ItemsTitle);
        var check = Assert.Single(info.Items);
        Assert.Equal("positive_int_check", check.Name);
        Assert.Contains("VALUE > 0", check.Detail);

        var email = await reader.GetObjectDetailsAsync(Ref("email_address"), CancellationToken.None);
        Assert.Contains(email.TypeInfo!.UsedBy, u => u is { Name: "customers", Type: ObjectTypes.Table } && u.Usage == "column email");
    }

    [SkippableFact]
    public async Task Composite_And_Range_Details()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var a = await reader.GetObjectDetailsAsync(Ref("address"), CancellationToken.None);
        Assert.Equal(["street", "city", "zip"], a.Columns.Select(c => c.Name));
        Assert.Equal("character varying(10)", a.Columns.Single(c => c.Name == "zip").Type.Replace("varchar", "character varying"));
        Assert.Equal(TypeKinds.Composite, a.TypeInfo!.Kind);
        Assert.Equal("Postal address", a.TypeInfo.Properties.Single(p => p.Name == "Comment").Value);
        Assert.Contains(a.TypeInfo.UsedBy, u => u is { Name: "format_address", Type: ObjectTypes.Func } && u.Usage == "parameter");

        var r = await reader.GetObjectDetailsAsync(Ref("price_range"), CancellationToken.None);
        Assert.Equal(TypeKinds.Range, r.TypeInfo!.Kind);
        Assert.Equal("numeric", r.TypeInfo.Properties.Single(p => p.Name == "Subtype").Value);
        Assert.Contains(r.TypeInfo.UsedBy, u => u is { Name: "price_span" } && u.Usage == "return type");
    }

    [SkippableFact]
    public async Task UnknownType_IsNotFound()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        await Assert.ThrowsAsync<DbStudio.Core.Services.EngineException>(() => reader.GetObjectDetailsAsync(Ref("no_such_type"), CancellationToken.None));
    }

    [SkippableFact]
    public async Task Ddl_ForEveryKind()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        Assert.Contains("CREATE TYPE public.address AS (", (await reader.GetDdlAsync(Ref("address"), CancellationToken.None)).Ddl);
        Assert.Contains("CREATE TYPE public.price_range AS RANGE (SUBTYPE = numeric)", (await reader.GetDdlAsync(Ref("price_range"), CancellationToken.None)).Ddl);
        var domain = (await reader.GetDdlAsync(Ref("positive_int"), CancellationToken.None)).Ddl;
        Assert.Contains("CREATE DOMAIN public.positive_int AS integer DEFAULT 1 NOT NULL", domain);
        Assert.Contains("CONSTRAINT positive_int_check CHECK", domain);
    }

    [SkippableFact]
    public async Task ObjectListAndDependencies_ReportKindAndRoutineUsers()
    {
        RequireAvailable();
        await using var r = await new PostgreSqlProvider().OpenObjectListReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var types = (await r.ListAsync(null, "public", ObjectTypes.Type, CancellationToken.None)).ToDictionary(i => i.Name);
        Assert.Equal(TypeKinds.Enum, types["order_status"].Kind);
        Assert.Equal(TypeKinds.Domain, types["email_address"].Kind);
        Assert.Equal(TypeKinds.Composite, types["address"].Kind);
        Assert.Equal(TypeKinds.Range, types["price_range"].Kind);

        await using var deps = await new PostgreSqlProvider().OpenDependencyReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var g = await deps.GetDependenciesAsync(Ref("address"), CancellationToken.None);
        Assert.Contains(g.UsedBy, d => d.Object is { Name: "format_address", Type: ObjectTypes.Func } && d.Detail == "parameter");
    }
}
