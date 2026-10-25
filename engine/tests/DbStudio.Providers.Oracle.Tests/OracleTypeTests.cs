using DbStudio.Core.Models;
using DbStudio.Core.Providers;

namespace DbStudio.Providers.Oracle.Tests;

public sealed class OracleTypeUnitTests
{
    [Theory]
    [InlineData("OBJECT", null, TypeKinds.Object)]
    [InlineData("COLLECTION", "VARYING ARRAY", TypeKinds.Varray)]
    [InlineData("COLLECTION", "TABLE", TypeKinds.Nested)]
    [InlineData("XMLTYPE", null, TypeKinds.Object)]
    public void TypeKindOf_FollowsTypecodeAndCollectionKind(string typecode, string? coll, string kind) =>
        Assert.Equal(kind, OracleCatalogReader.TypeKindOf(typecode, coll));

    [Fact]
    public void CollectionText_DescribesVarrayAndNestedTable()
    {
        Assert.Equal("VARRAY(5) OF VARCHAR2(30)", OracleCatalogReader.CollectionText(TypeKinds.Varray, 5, "VARCHAR2(30)"));
        Assert.Equal("TABLE OF NUMBER(10)", OracleCatalogReader.CollectionText(TypeKinds.Nested, null, "NUMBER(10)"));
    }

    [Fact]
    public void MapTypeUsage_MergesPerObject_KeepsOtherSchemas_AndSkipsUnknownKinds()
    {
        var usage = OracleCatalogReader.MapTypeUsage(
        [
            new("SHOP", "FORMAT_ADDRESS", "FUNCTION", "parameter P_ADDR"),
            new("SHOP", "FORMAT_ADDRESS", "FUNCTION", "return value"),
            new("SHOP", "CUSTOMERS", "TABLE", "column ADDR"),
            new("SHOP", "CUSTOMERS", "TABLE", "column ADDR"),
            new("SHOP", "ORDER_API", "PACKAGE", "GET: parameter P_ID"),
            new("SHOP", "ADDRESS_LIST", "TYPE", "element type"),
            new("APP", "AUDIT", "TABLE", "column ADDR"),
            new("SHOP", "JAVA", "JAVA CLASS", "x"),
        ], "SHOP");
        Assert.Equal(
            ["SHOP.ADDRESS_LIST|type|element type", "SHOP.CUSTOMERS|table|column ADDR", "SHOP.FORMAT_ADDRESS|func|parameter P_ADDR; return value",
             "SHOP.ORDER_API|package|GET: parameter P_ID", "APP.AUDIT|table|column ADDR"],
            usage.Select(u => $"{u.Schema}.{u.Name}|{u.Type}|{u.Usage}"));
    }
}

/// <summary>The seeded SHOP schema: ADDRESS_T (object + body), PHONE_LIST (VARRAY), ID_TABLE (nested table), FORMAT_ADDRESS.</summary>
public sealed class OracleTypeIntegrationTests(OracleFixture fixture) : IClassFixture<OracleFixture>
{
    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "Oracle not available.");

    private ObjectRef Ref(string name) => new(null, fixture.ShopSchema, name, ObjectTypes.Type);

    [SkippableFact]
    public async Task LoadSchema_ReportsKindSummaryAndAttributes()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var schema = await reader.LoadSchemaAsync(null, fixture.ShopSchema, CancellationToken.None);
        var types = schema.Objects.Where(o => o.Type == ObjectTypes.Type).ToDictionary(o => o.Name);
        Assert.Equal((TypeKinds.Object, "3 attributes, 1 method"), (types["ADDRESS_T"].Kind, types["ADDRESS_T"].BaseType));
        Assert.Equal(["STREET", "CITY", "ZIP"], types["ADDRESS_T"].Columns.Select(c => c.Name));
        Assert.Equal("VARCHAR2(100)", types["ADDRESS_T"].Columns[0].TypeText);
        Assert.Equal((TypeKinds.Varray, "VARRAY(5) OF VARCHAR2(30)"), (types["PHONE_LIST"].Kind, types["PHONE_LIST"].BaseType));
        Assert.Equal((TypeKinds.Nested, "TABLE OF NUMBER(10)"), (types["ID_TABLE"].Kind, types["ID_TABLE"].BaseType));
    }

    [SkippableFact]
    public async Task ObjectType_Details_HaveAttributesMethodsAndUsers()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var d = await reader.GetObjectDetailsAsync(Ref("ADDRESS_T"), CancellationToken.None);
        Assert.Equal(["STREET", "CITY", "ZIP"], d.Columns.Select(c => c.Name));
        var info = d.TypeInfo!;
        Assert.Equal(TypeKinds.Object, info.Kind);
        Assert.Equal("3", info.Properties.Single(p => p.Name == "Attributes").Value);
        Assert.Equal("Methods", info.ItemsTitle);
        Assert.Equal("ONE_LINE", Assert.Single(info.Items).Name);
        Assert.Contains("function", info.Items[0].Detail);
        Assert.Contains(info.UsedBy, u => u is { Name: "FORMAT_ADDRESS", Type: ObjectTypes.Func } && u.Usage == "parameter P_ADDR");
        Assert.NotNull(d.Created);
    }

    [SkippableFact]
    public async Task CollectionTypes_Details_DescribeTheElementType()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var phones = (await reader.GetObjectDetailsAsync(Ref("PHONE_LIST"), CancellationToken.None)).TypeInfo!;
        Assert.Equal(TypeKinds.Varray, phones.Kind);
        Assert.Equal("VARCHAR2(30)", phones.Properties.Single(p => p.Name == "Element type").Value);
        Assert.Equal("5", phones.Properties.Single(p => p.Name == "Maximum elements").Value);
        var ids = (await reader.GetObjectDetailsAsync(Ref("ID_TABLE"), CancellationToken.None)).TypeInfo!;
        Assert.Equal(TypeKinds.Nested, ids.Kind);
        Assert.Equal("TABLE OF NUMBER(10)", ids.Properties.Single(p => p.Name == "Definition").Value);
    }

    [SkippableFact]
    public async Task Ddl_OfAnObjectType_IncludesTheBody()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var ddl = (await reader.GetDdlAsync(Ref("ADDRESS_T"), CancellationToken.None)).Ddl;
        Assert.Contains("CREATE OR REPLACE", ddl);
        Assert.Contains("TYPE", ddl);
        Assert.Contains("TYPE BODY", ddl);
        Assert.Contains("ONE_LINE", ddl);
        var varray = (await reader.GetDdlAsync(Ref("PHONE_LIST"), CancellationToken.None)).Ddl;
        Assert.Contains("VARRAY", varray);
    }

    [SkippableFact]
    public async Task UnknownType_IsNotFound()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        await Assert.ThrowsAnyAsync<Exception>(() => reader.GetObjectDetailsAsync(Ref("NO_SUCH_TYPE"), CancellationToken.None));
    }

    [SkippableFact]
    public async Task ObjectList_ReportsTheKind()
    {
        RequireAvailable();
        await using var r = await new OracleProvider().OpenObjectListReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var types = (await r.ListAsync(null, fixture.ShopSchema, ObjectTypes.Type, CancellationToken.None)).ToDictionary(i => i.Name);
        Assert.Equal(TypeKinds.Object, types["ADDRESS_T"].Kind);
        Assert.Equal(TypeKinds.Varray, types["PHONE_LIST"].Kind);
        Assert.Equal(TypeKinds.Nested, types["ID_TABLE"].Kind);
    }
}
