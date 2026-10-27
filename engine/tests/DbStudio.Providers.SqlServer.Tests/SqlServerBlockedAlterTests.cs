using DbStudio.Core.Designer;
using DbStudio.Providers.SqlServer.Designer;
using DbStudio.Providers.SqlServer.Tests.M15;

namespace DbStudio.Providers.SqlServer.Tests;

/// <summary>
/// SQL Server refuses a bare ALTER COLUMN on a column used by an index, key, check or computed column. The scripter drops
/// those objects first and recreates them afterwards (and warns about it).
/// </summary>
public sealed class SqlServerBlockedAlterTests
{
    private static readonly SqlServerDdlScripter Scripter = new();
    private static readonly DdlScriptContext Context = new("16.0.4135.4", "dbo");

    private static TableModel Table() => new()
    {
        Schema = "dbo",
        Name = "Items",
        Columns =
        [
            new() { Id = "Id", Name = "Id", Type = "int", Nullable = false },
            new() { Id = "Code", Name = "Code", Type = "varchar(20)", Nullable = false },
            new() { Id = "Qty", Name = "Qty", Type = "int", Nullable = false },
            new() { Id = "Label", Name = "Label", Type = "nvarchar(50)", Nullable = true },
            new() { Id = "CodeUpper", Name = "CodeUpper", Type = "varchar(20)", Nullable = true, Computed = new ComputedModel("upper([Code])", false) },
        ],
        PrimaryKey = new PrimaryKeyModel { Name = "PK_Items", Columns = ["Id"], Clustered = true },
        Uniques = [new UniqueModel { Name = "UQ_Items_Code", Columns = ["Code"] }],
        Indexes =
        [
            new IndexModel { Name = "IX_Items_Qty", Columns = [new IndexColumnModel("Qty")], Include = ["Label"] },
            new IndexModel { Name = "IX_Items_Upper", Columns = [new IndexColumnModel("CodeUpper")] },
        ],
        Checks = [new CheckModel { Name = "CK_Items_Qty", Expression = "([Qty]>(0))" }],
    };

    private static TableModel With(TableModel t, string column, Func<TableColumnModel, TableColumnModel> change) =>
        t with { Columns = t.Columns.Select(c => c.Name == column ? change(c) : c).ToList() };

    private static List<string> Sql(TableScript s) => s.Statements.Select(x => x.Sql).ToList();

    [Fact]
    public void TypeChange_OfAnIndexedColumn_DropsAndRecreatesTheIndexAroundTheAlter()
    {
        var original = Table();
        var script = Scripter.ScriptTable(original, With(original, "Qty", c => c with { Type = "bigint" }), Context);
        var sql = Sql(script);

        var dropIx = sql.IndexOf("DROP INDEX [IX_Items_Qty] ON [dbo].[Items]");
        var dropCk = sql.IndexOf("ALTER TABLE [dbo].[Items] DROP CONSTRAINT [CK_Items_Qty]");
        var alter = sql.IndexOf("ALTER TABLE [dbo].[Items] ALTER COLUMN [Qty] bigint NOT NULL");
        var addCk = sql.IndexOf("ALTER TABLE [dbo].[Items] ADD CONSTRAINT [CK_Items_Qty] CHECK ([Qty]>(0))");
        var addIx = sql.IndexOf("CREATE NONCLUSTERED INDEX [IX_Items_Qty] ON [dbo].[Items] ([Qty] ASC) INCLUDE ([Label])");
        Assert.True(dropIx >= 0 && dropCk >= 0 && alter > dropIx && alter > dropCk && addCk > alter && addIx > alter, string.Join("\n", sql));
        Assert.Contains(script.Warnings, w => w.Contains("IX_Items_Qty", StringComparison.Ordinal) && w.Contains("CK_Items_Qty", StringComparison.Ordinal));
        // Unrelated objects are left alone.
        Assert.DoesNotContain(sql, s => s.Contains("PK_Items", StringComparison.Ordinal) || s.Contains("UQ_Items_Code", StringComparison.Ordinal) || s.Contains("IX_Items_Upper", StringComparison.Ordinal));
        SqlServerScripterGoldenTests.AssertParses(script.Statements);
    }

    [Fact]
    public void TypeChange_OfAColumnUsedByAComputedColumn_DropsAndReaddsTheComputedColumnAndItsIndex()
    {
        var original = Table();
        var script = Scripter.ScriptTable(original, With(original, "Code", c => c with { Type = "varchar(40)", Collation = "Latin1_General_CI_AS" }), Context);
        var sql = Sql(script);

        var dropIx = sql.IndexOf("DROP INDEX [IX_Items_Upper] ON [dbo].[Items]");
        var dropUq = sql.IndexOf("ALTER TABLE [dbo].[Items] DROP CONSTRAINT [UQ_Items_Code]");
        var dropComputed = sql.IndexOf("ALTER TABLE [dbo].[Items] DROP COLUMN [CodeUpper]");
        var alter = sql.FindIndex(s => s.StartsWith("ALTER TABLE [dbo].[Items] ALTER COLUMN [Code] varchar(40) COLLATE Latin1_General_CI_AS NOT NULL", StringComparison.Ordinal));
        var addComputed = sql.FindIndex(s => s.StartsWith("ALTER TABLE [dbo].[Items] ADD [CodeUpper] AS (upper([Code]))", StringComparison.Ordinal));
        var addUq = sql.FindIndex(s => s.StartsWith("ALTER TABLE [dbo].[Items] ADD CONSTRAINT [UQ_Items_Code] UNIQUE ([Code])", StringComparison.Ordinal));
        var addIx = sql.FindIndex(s => s.StartsWith("CREATE NONCLUSTERED INDEX [IX_Items_Upper]", StringComparison.Ordinal));
        Assert.True(dropIx >= 0 && dropUq >= 0 && dropComputed > dropIx && alter > dropComputed && alter > dropUq, string.Join("\n", sql));
        Assert.True(addComputed > alter && addUq > alter && addIx > addComputed, string.Join("\n", sql));
        SqlServerScripterGoldenTests.AssertParses(script.Statements);
    }

    [Fact]
    public void Widening_AVarcharUnderAnIndexOrUnique_NeedsNoRecreate_ButTheKeyAndComputedColumnAreRedone()
    {
        var original = Table();
        var script = Scripter.ScriptTable(original, With(original, "Code", c => c with { Type = "varchar(30)" }), Context);
        var sql = Sql(script);
        Assert.Contains("ALTER TABLE [dbo].[Items] ALTER COLUMN [Code] varchar(30) NOT NULL", sql);
        Assert.DoesNotContain(sql, s => s.Contains("UQ_Items_Code", StringComparison.Ordinal));
        // the computed column reads Code, which is still refused
        Assert.Contains("ALTER TABLE [dbo].[Items] DROP COLUMN [CodeUpper]", sql);
    }

    [Fact]
    public void Widening_WithNothingElseAttached_IsABareAlter()
    {
        var original = Table();
        var script = Scripter.ScriptTable(original, With(original, "Label", c => c with { Type = "nvarchar(100)" }), Context);
        var sql = Sql(script);
        // Label is only an INCLUDE column of an index: widening is allowed under it
        Assert.Equal(["ALTER TABLE [dbo].[Items] ALTER COLUMN [Label] nvarchar(100) NULL"], sql);
        Assert.Empty(script.Warnings);
    }

    [Fact]
    public void NullabilityChange_OfAKeyColumn_RecreatesTheKeyAndTheIndex_ButNotChecks()
    {
        var original = Table() with { Columns = Table().Columns.Select(c => c.Name == "Qty" ? c with { Nullable = true } : c).ToList() };
        var desired = With(original, "Qty", c => c with { Nullable = false });
        var script = Scripter.ScriptTable(original, desired, Context);
        var sql = Sql(script);
        Assert.Contains("DROP INDEX [IX_Items_Qty] ON [dbo].[Items]", sql);
        Assert.Contains("ALTER TABLE [dbo].[Items] ALTER COLUMN [Qty] int NOT NULL", sql);
        Assert.DoesNotContain(sql, s => s.Contains("CK_Items_Qty", StringComparison.Ordinal));
    }

    [Fact]
    public void PrimaryKeyColumnTypeChange_RecreatesTheKey_AndWarnsAboutInboundForeignKeys()
    {
        var original = Table();
        var script = Scripter.ScriptTable(original, With(original, "Id", c => c with { Type = "bigint" }), Context);
        var sql = Sql(script);
        var drop = sql.IndexOf("ALTER TABLE [dbo].[Items] DROP CONSTRAINT [PK_Items]");
        var alter = sql.IndexOf("ALTER TABLE [dbo].[Items] ALTER COLUMN [Id] bigint NOT NULL");
        var add = sql.FindIndex(s => s.StartsWith("ALTER TABLE [dbo].[Items] ADD CONSTRAINT [PK_Items] PRIMARY KEY CLUSTERED ([Id])", StringComparison.Ordinal));
        Assert.True(drop >= 0 && alter > drop && add > alter, string.Join("\n", sql));
        Assert.Contains(script.Warnings, w => w.Contains("Foreign keys of other tables", StringComparison.Ordinal));
    }

    [Fact]
    public void ColumnRename_WithATypeChange_RecreatesWithTheNewName()
    {
        var original = Table();
        var script = Scripter.ScriptTable(original, With(original, "Qty", c => c with { Name = "Quantity", Type = "bigint" }) with
        {
            Indexes = [new IndexModel { Name = "IX_Items_Qty", Columns = [new IndexColumnModel("Quantity")], Include = ["Label"] }, original.Indexes[1]],
            Checks = [new CheckModel { Name = "CK_Items_Qty", Expression = "([Quantity]>(0))" }],
        }, Context);
        var sql = Sql(script);
        Assert.Contains("DROP INDEX [IX_Items_Qty] ON [dbo].[Items]", sql);
        Assert.Contains("CREATE NONCLUSTERED INDEX [IX_Items_Qty] ON [dbo].[Items] ([Quantity] ASC) INCLUDE ([Label])", sql);
        Assert.True(sql.IndexOf("ALTER TABLE [dbo].[Items] ALTER COLUMN [Quantity] bigint NOT NULL") > sql.IndexOf("EXEC sys.sp_rename N'[dbo].[Items].[Qty]', N'Quantity', N'COLUMN'"));
    }
}
