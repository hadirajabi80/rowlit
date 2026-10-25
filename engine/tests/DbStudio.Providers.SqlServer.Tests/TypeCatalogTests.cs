using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Providers.Conformance;
using DbStudio.Providers.SqlServer.TSql;

namespace DbStudio.Providers.SqlServer.Tests;

/// <summary>User-defined types (SSMS: Programmability › Types): DDL text, usage mapping, categories. No server needed.</summary>
public sealed class TypeDdlTests
{
    [Fact]
    public void AliasType_NotNullAndNullable()
    {
        Assert.Equal("CREATE TYPE [dbo].[Phone] FROM nvarchar(20) NOT NULL;\n", TSqlTypeDdl.AliasType("[dbo].[Phone]", "nvarchar(20)", false));
        Assert.Equal("CREATE TYPE [dbo].[Money2] FROM decimal(19,4) NULL;\n", TSqlTypeDdl.AliasType("[dbo].[Money2]", "decimal(19,4)", true));
    }

    private static string PhoneList() => TSqlTypeDdl.TableType("[dbo].[PhoneList]",
        [
            new SqlServerColumnDefinition("Ordinal", "int", false),
            new SqlServerColumnDefinition("Label", "nvarchar(30)", false, DefaultDefinition: "(N'mobile')", DefaultName: "DF__ignored"),
            new SqlServerColumnDefinition("Number", "[dbo].[Phone]", true),
            new SqlServerColumnDefinition("Id", "int", false, IsIdentity: true, IdentitySeed: 10, IdentityIncrement: 2),
            new SqlServerColumnDefinition("Calc", "int", true, ComputedDefinition: "([Ordinal]*(2))"),
        ],
        [
            new SqlServerIndexDefinition("PK__TT_PhoneList__3214EC07", true, true, false, "CLUSTERED", [new SqlServerIndexColumn("Ordinal")], []),
            new SqlServerIndexDefinition("UQ__x", true, false, true, "NONCLUSTERED", [new SqlServerIndexColumn("Id", true)], []),
            new SqlServerIndexDefinition("IX_PhoneList_Number", false, false, false, "NONCLUSTERED", [new SqlServerIndexColumn("Number")], []),
        ],
        [new SqlServerCheckDefinition("CK__TT_PhoneList__Ordin__2A4B4B5E", "([Ordinal]>(0))")]);

    [Fact]
    public void TableType_HasUnnamedConstraints_AndInlineIndexes()
    {
        var ddl = PhoneList();
        Assert.StartsWith("CREATE TYPE [dbo].[PhoneList] AS TABLE (\n", ddl);
        Assert.Contains("    [Ordinal] int NOT NULL,\n", ddl);
        Assert.Contains("[Label] nvarchar(30) NOT NULL DEFAULT (N'mobile')", ddl);
        Assert.DoesNotContain("DF__ignored", ddl);
        Assert.Contains("[Number] [dbo].[Phone] NULL", ddl);
        Assert.Contains("[Id] int IDENTITY(10,2) NOT NULL", ddl);
        Assert.Contains("[Calc] AS ([Ordinal]*(2))", ddl);
        Assert.Contains("    PRIMARY KEY CLUSTERED ([Ordinal] ASC),\n", ddl);
        Assert.Contains("    UNIQUE NONCLUSTERED ([Id] DESC),\n", ddl);
        Assert.Contains("    CHECK ([Ordinal]>(0)),\n", ddl);
        Assert.Contains("    INDEX [IX_PhoneList_Number] NONCLUSTERED ([Number] ASC)\n);\n", ddl);
        Assert.DoesNotContain("CONSTRAINT", ddl);
    }

    [Fact]
    public void TableType_IsValidTsql() => Assert.Empty(ScriptDomDiagnostics.Analyze(PhoneList()));

    [Fact]
    public void ClrType_UsesExternalName()
    {
        var ddl = TSqlTypeDdl.ClrType("[dbo].[Point]", "Geo", "Acme.Point");
        Assert.Equal("CREATE TYPE [dbo].[Point]\nEXTERNAL NAME [Geo].[Acme.Point];\n", ddl);
        Assert.Empty(ScriptDomDiagnostics.Analyze(ddl));
    }

    [Fact]
    public void XmlSchemaCollection_EscapesQuotes_AndConcatenatesSchemas()
    {
        var ddl = TSqlTypeDdl.XmlSchemaCollection("[dbo].[NoteSchema]", ["<xs:schema a='1'/>", "<xs:schema b='2'/>"]);
        Assert.Equal("CREATE XML SCHEMA COLLECTION [dbo].[NoteSchema] AS N'<xs:schema a=''1''/><xs:schema b=''2''/>';\n", ddl);
        Assert.Empty(ScriptDomDiagnostics.Analyze(ddl));
    }

    [Theory]
    [InlineData("nvarchar", 40, 0, 0, "nvarchar(20)")]
    [InlineData("nvarchar", -1, 0, 0, "nvarchar(max)")]
    [InlineData("decimal", 9, 19, 4, "decimal(19,4)")]
    [InlineData("int", 4, 10, 0, "int")]
    public void AliasBaseText_RendersLengthAndPrecision(string baseName, int maxLength, int precision, int scale, string expected) =>
        Assert.Equal(expected, SqlServerCatalogReader.AliasBaseText(baseName, maxLength, precision, scale));

    [Fact]
    public void AliasBaseText_WithoutBase_IsSqlVariant() => Assert.Equal("sql_variant", SqlServerCatalogReader.AliasBaseText(null, 0, 0, 0));

    [Theory]
    [InlineData("int", "Exact numerics")]
    [InlineData("float", "Approximate numerics")]
    [InlineData("datetime2", "Date and time")]
    [InlineData("varchar", "Character strings")]
    [InlineData("sysname", "Unicode character strings")]
    [InlineData("varbinary", "Binary strings")]
    [InlineData("geography", "Spatial geography types")]
    [InlineData("hierarchyid", "CLR data types")]
    [InlineData("uniqueidentifier", "Other data types")]
    [InlineData("XML", "Other data types")]
    public void SystemTypeCategory_FollowsSsms(string name, string category) => Assert.Equal(category, SqlServerCatalogReader.SystemTypeCategory(name));

    [Fact]
    public void MapTypeUsage_MergesPerObject_MapsTableTypeHolders_AndDropsNoise()
    {
        var rows = new List<SqlServerCatalogReader.TypeUsageRow>
        {
            new("dbo", "Customers", "U", null, null, "Phone", null),
            new("dbo", "Customers", "U", null, null, "Fax", null),
            new("dbo", "SavePhones", "P", null, null, "@Fallback", 3),
            new("dbo", "SavePhones", "P", null, null, null, null),               // body reference: dropped, a parameter says more
            new("dbo", "NormalizePhone", "FN", null, null, "", 0),
            new("dbo", "NormalizePhone", "FN", null, null, "@raw", 1),
            new("dbo", "TT_PhoneList_1", "TT", "dbo", "PhoneList", "Number", null), // the internal table-type object
            new("dbo", "TT_Orphan", "TT", null, null, "X", null),                // no owning type: skipped
            new("dbo", "Trg", "TR", null, null, null, null),                     // body only: kept
            new("dbo", "Odd", "D", null, null, "c", null),                       // unknown object type: skipped
        };
        var usage = SqlServerCatalogReader.MapTypeUsage(rows);
        Assert.Equal(
            ["dbo.Customers|table|column Phone; column Fax", "dbo.NormalizePhone|func|return value; parameter @raw", "dbo.PhoneList|type|column Number",
             "dbo.SavePhones|proc|parameter @Fallback", "dbo.Trg|trigger|referenced in body"],
            usage.Select(u => $"{u.Schema}.{u.Name}|{u.Type}|{u.Usage}"));
    }

    [Fact]
    public void TypeQueries_AreSchemaScopedOrKeyed()
    {
        foreach (var name in new[] { "UserTypes", "UserTypes2005", "ClrTypes", "XmlSchemaCollections" })
            Assert.Contains("@sid", SqlServerCatalogQueries.All[name]);
        Assert.Contains("@tid", SqlServerCatalogQueries.TypeUsage);
        Assert.Contains("@xid", SqlServerCatalogQueries.XmlSchemaUsage);
        Assert.DoesNotContain("table_types", SqlServerCatalogQueries.TypeUsage2005);
        Assert.DoesNotContain("table_types", SqlServerCatalogQueries.UserTypes2005);
        Assert.DoesNotContain("table_types", SqlServerCatalogQueries.UserTypeByName2005);
    }
}

/// <summary>The seeded shop database (dbo.Phone, dbo.PhoneList, dbo.IdList, dbo.NoteSchema). Skipped without Docker.</summary>
public sealed class SqlServerTypeIntegrationTests(SqlServerFixture fixture) : IClassFixture<SqlServerFixture>
{
    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "SQL Server not available.");

    private static ObjectRef Ref(string name) => new("shop", "dbo", name, ObjectTypes.Type);

    [SkippableFact]
    public async Task LoadSchema_ReportsKindAndDefinitionSummary()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var dbo = await reader.LoadSchemaAsync("shop", "dbo", CancellationToken.None);
        var types = dbo.Objects.Where(o => o.Type == ObjectTypes.Type).ToDictionary(o => o.Name);

        Assert.Equal(TypeKinds.Alias, types["Phone"].Kind);
        Assert.Equal("nvarchar(20) not null", types["Phone"].BaseType);
        Assert.Equal(TypeKinds.Table, types["PhoneList"].Kind);
        Assert.Equal(["Ordinal", "Label", "Number"], types["PhoneList"].Columns.Select(c => c.Name));
        Assert.Equal(TypeKinds.Table, types["IdList"].Kind);
        Assert.Equal(TypeKinds.XmlSchema, types["NoteSchema"].Kind);
    }

    [SkippableFact]
    public async Task AliasType_Details_ListProperties_AndUsers()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var d = await reader.GetObjectDetailsAsync(Ref("Phone"), CancellationToken.None);
        var info = Assert.IsType<TypeDetails>(d.TypeInfo);
        Assert.Equal(TypeKinds.Alias, info.Kind);
        Assert.Equal("nvarchar(20)", info.Properties.Single(p => p.Name == "Base type").Value);
        Assert.Equal("no", info.Properties.Single(p => p.Name == "Nullable").Value);
        Assert.Equal("40", info.Properties.Single(p => p.Name == "Max length (bytes)").Value);
        Assert.Equal("none", info.Properties.Single(p => p.Name == "Bound default").Value);

        // used by: a table type column, a procedure parameter, a function parameter and return value
        Assert.Contains(info.UsedBy, u => u is { Name: "PhoneList", Type: ObjectTypes.Type } && u.Usage == "column Number");
        Assert.Contains(info.UsedBy, u => u is { Name: "SavePhones", Type: ObjectTypes.Proc } && u.Usage.Contains("parameter @Fallback"));
        Assert.Contains(info.UsedBy, u => u is { Name: "NormalizePhone", Type: ObjectTypes.Func } && u.Usage.Contains("return value") && u.Usage.Contains("parameter @raw"));
    }

    [SkippableFact]
    public async Task TableType_Details_HaveColumnsIndexesChecks_AndTheProceduresUsingIt()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var d = await reader.GetObjectDetailsAsync(Ref("PhoneList"), CancellationToken.None);
        Assert.Equal(["Ordinal", "Label", "Number"], d.Columns.Select(c => c.Name));
        Assert.True(d.Columns.Single(c => c.Name == "Ordinal").IsPk);
        Assert.Equal("dbo.Phone", d.Columns.Single(c => c.Name == "Number").Type.Replace("[", "").Replace("]", ""));
        Assert.Contains(d.Indexes, i => i.IsPrimaryKey);
        Assert.Contains(d.Indexes, i => i is { Name: "IX_PhoneList_Number", Unique: false });
        var info = d.TypeInfo!;
        Assert.Equal(TypeKinds.Table, info.Kind);
        Assert.Equal("Check constraints", info.ItemsTitle);
        Assert.Contains("Ordinal", Assert.Single(info.Items).Detail);
        Assert.Contains(info.UsedBy, u => u is { Name: "SavePhones", Type: ObjectTypes.Proc } && u.Usage == "parameter @Phones");

        var idList = await reader.GetObjectDetailsAsync(Ref("IdList"), CancellationToken.None);
        Assert.Contains(idList.TypeInfo!.UsedBy, u => u.Name == "AddOrderLines");
    }

    [SkippableFact]
    public async Task TypeDdl_IsValidTsql_ForEveryKind()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var alias = await reader.GetDdlAsync(Ref("Phone"), CancellationToken.None);
        Assert.Equal("CREATE TYPE [dbo].[Phone] FROM nvarchar(20) NOT NULL;\n", alias.Ddl);

        var table = await reader.GetDdlAsync(Ref("PhoneList"), CancellationToken.None);
        Assert.Contains("CREATE TYPE [dbo].[PhoneList] AS TABLE (", table.Ddl);
        Assert.Contains("[Label] nvarchar(30) NOT NULL DEFAULT (N'mobile')", table.Ddl);
        Assert.Contains("PRIMARY KEY CLUSTERED ([Ordinal] ASC)", table.Ddl);
        Assert.Contains("INDEX [IX_PhoneList_Number] NONCLUSTERED ([Number] ASC)", table.Ddl);
        Assert.Contains("CHECK ([Ordinal]>(0))", table.Ddl);

        var xml = await reader.GetDdlAsync(Ref("NoteSchema"), CancellationToken.None);
        Assert.StartsWith("CREATE XML SCHEMA COLLECTION [dbo].[NoteSchema] AS N'", xml.Ddl);
        Assert.Contains("name=\"note\"", xml.Ddl);

        foreach (var ddl in new[] { alias.Ddl, table.Ddl, xml.Ddl, (await reader.GetDdlAsync(Ref("IdList"), CancellationToken.None)).Ddl })
            Assert.Empty(ScriptDomDiagnostics.Analyze(ddl));
    }

    [SkippableFact]
    public async Task XmlSchemaCollection_Details_ListNamespaces()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var d = await reader.GetObjectDetailsAsync(Ref("NoteSchema"), CancellationToken.None);
        var info = d.TypeInfo!;
        Assert.Equal(TypeKinds.XmlSchema, info.Kind);
        Assert.Equal("1", info.Properties.Single(p => p.Name == "Target namespaces").Value);
        Assert.Equal("(no namespace)", Assert.Single(info.Items).Name);
    }

    [SkippableFact]
    public async Task UnknownType_IsNotFound()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        await Assert.ThrowsAsync<DbStudio.Core.Services.EngineException>(() => reader.GetObjectDetailsAsync(Ref("NoSuchType"), CancellationToken.None));
    }

    [SkippableFact]
    public async Task SystemTypes_AreListedWithTheirCategory()
    {
        RequireAvailable();
        await using var reader = await fixture.OpenCatalogAsync();
        var list = await reader.ListSystemTypesAsync("shop", CancellationToken.None);
        var nvarchar = list.Single(t => t.Name == "nvarchar");
        Assert.Equal("Unicode character strings", nvarchar.Category);
        Assert.Equal(8000, nvarchar.MaxLength);
        Assert.Equal("int", list.Single(t => t.Name == "int").Name);
        Assert.Equal(19, list.Single(t => t.Name == "bigint").Precision);
        Assert.DoesNotContain(list, t => t.Name is "Phone" or "IdList");
    }

    [SkippableFact]
    public async Task ObjectList_IncludesTypes_WithKind()
    {
        RequireAvailable();
        await using var r = await new SqlServerProvider().OpenObjectListReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var all = await r.ListAsync("shop", "dbo", null, CancellationToken.None);
        var types = all.Where(i => i.Type == ObjectTypes.Type).ToDictionary(i => i.Name);
        Assert.Equal(TypeKinds.Alias, types["Phone"].Kind);
        Assert.Equal("nvarchar(20) not null", types["Phone"].Comment);
        Assert.Equal(TypeKinds.Table, types["PhoneList"].Kind);
        Assert.Equal(TypeKinds.XmlSchema, types["NoteSchema"].Kind);
        Assert.NotNull(types["NoteSchema"].Created);

        var onlyTypes = await r.ListAsync("shop", null, ObjectTypes.Type, CancellationToken.None);
        Assert.All(onlyTypes, i => Assert.Equal(ObjectTypes.Type, i.Type));
        Assert.Contains(onlyTypes, i => i.Name == "Phone");
        var tables = await r.ListAsync("shop", "dbo", ObjectTypes.Table, CancellationToken.None);
        Assert.DoesNotContain(tables, i => i.Type == ObjectTypes.Type);
    }

    [SkippableFact]
    public async Task Dependencies_OfAType_ListWhoUsesIt_AndWhatATableTypeUses()
    {
        RequireAvailable();
        await using var r = await new SqlServerProvider().OpenDependencyReaderAsync(fixture.Profile!, fixture.Password, CancellationToken.None);
        var phone = await r.GetDependenciesAsync(Ref("Phone"), CancellationToken.None);
        Assert.Contains(phone.UsedBy, d => d.Object.Name == "SavePhones" && d.Object.Type == ObjectTypes.Proc);
        Assert.Contains(phone.UsedBy, d => d.Object.Name == "PhoneList" && d.Object.Type == ObjectTypes.Type);

        var list = await r.GetDependenciesAsync(Ref("PhoneList"), CancellationToken.None);
        Assert.Contains(list.Uses, d => d.Object is { Name: "Phone", Type: ObjectTypes.Type });
        Assert.Contains(list.UsedBy, d => d.Object.Name == "SavePhones");

        var xml = await r.GetDependenciesAsync(Ref("NoteSchema"), CancellationToken.None);
        Assert.Empty(xml.UsedBy);
    }
}
