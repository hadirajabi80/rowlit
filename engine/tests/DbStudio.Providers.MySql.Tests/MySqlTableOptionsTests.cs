using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Providers.Conformance.M15;
using DbStudio.Providers.MySql.Designer;

namespace DbStudio.Providers.MySql.Tests;

/// <summary>ENGINE, charset, collation, ROW_FORMAT and AUTO_INCREMENT in the designer (docs/qa/round-mysql.md #10).</summary>
public sealed class MySqlTableOptionsTests
{
    private static readonly MySqlDdlScripter Scripter = new();
    private static readonly DdlScriptContext Context = new("8.4.3", "shop");

    private static TableModel WithOptions(TableModel t, params (string Key, string Value)[] options) =>
        t with { Options = t.Options with { Extra = options.ToDictionary(o => o.Key, o => o.Value) } };

    [Fact]
    public void Create_ScriptsTheChosenOptions_InServerOrder_AndSkipsBlankOnes()
    {
        var orders = DesignerCases.Orders(Dialect.MySql);
        var desired = WithOptions(orders, ("engine", "InnoDB"), ("charset", "utf8mb4"), ("collation", "utf8mb4_unicode_ci"), ("rowFormat", "dynamic"), ("autoIncrement", "1000"), ("ttl", "ignored"));
        var sql = Scripter.ScriptTable(null, desired, Context).Statements.Single().Sql;
        Assert.Contains("\n) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = DYNAMIC AUTO_INCREMENT = 1000", sql, StringComparison.Ordinal);

        var bare = Scripter.ScriptTable(null, WithOptions(orders, ("engine", ""), ("charset", " ")), Context).Statements.Single().Sql;
        Assert.DoesNotContain("ENGINE", bare, StringComparison.Ordinal);
        Assert.DoesNotContain("CHARSET", bare, StringComparison.Ordinal);
    }

    [Fact]
    public void Create_PutsTheOptionsBeforeTheTableComment()
    {
        var orders = DesignerCases.Orders(Dialect.MySql) with { Comment = "Customer orders" };
        var sql = Scripter.ScriptTable(null, WithOptions(orders, ("engine", "InnoDB")), Context).Statements.Single().Sql;
        Assert.Contains(") ENGINE = InnoDB COMMENT = 'Customer orders'", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void Alter_ScriptsOnlyWhatChanged_WithAWarningEach()
    {
        var orders = WithOptions(DesignerCases.Orders(Dialect.MySql), ("engine", "InnoDB"), ("charset", "utf8mb4"), ("collation", "utf8mb4_0900_ai_ci"), ("rowFormat", "Dynamic"), ("autoIncrement", "42"));
        var desired = WithOptions(orders, ("engine", "MyISAM"), ("charset", "utf8mb4"), ("collation", "utf8mb4_0900_ai_ci"), ("rowFormat", "DYNAMIC"), ("autoIncrement", "500"));
        var script = Scripter.ScriptTable(orders, desired, Context);
        var alter = Assert.Single(script.Statements);
        Assert.Equal("ALTER TABLE `shop`.`Orders`\n    ENGINE = MyISAM,\n    AUTO_INCREMENT = 500", alter.Sql);
        Assert.Contains(script.Warnings, w => w.Contains("rebuilds the table", StringComparison.Ordinal));
        Assert.Contains(script.Warnings, w => w.Contains("AUTO_INCREMENT below", StringComparison.Ordinal));
        Assert.DoesNotContain(script.Warnings, w => w.Contains("character set", StringComparison.Ordinal));
    }

    [Fact]
    public void Alter_CharsetAndCollation_ChangeTheTableDefaultOnly_AndSayWhy()
    {
        var orders = WithOptions(DesignerCases.Orders(Dialect.MySql), ("charset", "latin1"), ("collation", "latin1_swedish_ci"));
        var desired = WithOptions(orders, ("charset", "utf8mb4"), ("collation", "utf8mb4_unicode_ci"));
        var script = Scripter.ScriptTable(orders, desired, Context);
        Assert.Equal("ALTER TABLE `shop`.`Orders`\n    DEFAULT CHARSET = utf8mb4,\n    COLLATE = utf8mb4_unicode_ci", Assert.Single(script.Statements).Sql);
        Assert.Contains(script.Warnings, w => w.Contains("existing columns keep theirs", StringComparison.Ordinal));
    }

    [Fact]
    public void Alter_ANewOptionJoinsOtherColumnChanges_InOneStatement_AndAnUnchangedModelScriptsNothing()
    {
        var orders = WithOptions(DesignerCases.Orders(Dialect.MySql), ("engine", "InnoDB"));
        Assert.Empty(Scripter.ScriptTable(orders, orders with { }, Context).Statements);
        // clearing a field leaves the server value alone: nothing to script
        var cleared = Scripter.ScriptTable(orders, WithOptions(orders, ("engine", "")), Context);
        Assert.Empty(cleared.Statements);

        var script = Scripter.ScriptTable(orders, WithOptions(orders with { Comment = "x" }, ("engine", "InnoDB"), ("rowFormat", "COMPRESSED")), Context);
        var alter = Assert.Single(script.Statements);
        Assert.Contains("COMMENT = 'x'", alter.Sql, StringComparison.Ordinal);
        Assert.Contains("ROW_FORMAT = COMPRESSED", alter.Sql, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("engine", "InnoDB; DROP TABLE x")]
    [InlineData("collation", "utf8 mb4")]
    [InlineData("rowFormat", "DYNAMIC,")]
    [InlineData("autoIncrement", "0")]
    [InlineData("autoIncrement", "12; --")]
    [InlineData("autoIncrement", "-5")]
    public void InvalidValues_AreRefused_BeforeTheyReachTheDdl(string key, string value)
    {
        var orders = DesignerCases.Orders(Dialect.MySql);
        Assert.Throws<ArgumentException>(() => Scripter.ScriptTable(null, WithOptions(orders, (key, value)), Context));
        Assert.Throws<ArgumentException>(() => Scripter.ScriptTable(orders, WithOptions(orders, (key, value)), Context));
    }

    [Fact]
    public void Read_ReportsEngineCharsetCollationRowFormatAndTheNextAutoIncrement()
    {
        var x = MySqlTableOptions.Read("InnoDB", "utf8mb4_0900_ai_ci", "Dynamic", 1001);
        Assert.Equal("InnoDB", x["engine"]);
        Assert.Equal("utf8mb4", x["charset"]);
        Assert.Equal("utf8mb4_0900_ai_ci", x["collation"]);
        Assert.Equal("Dynamic", x["rowFormat"]);
        Assert.Equal("1001", x["autoIncrement"]);

        var bare = MySqlTableOptions.Read(null, null, null, null);
        Assert.Empty(bare);
        Assert.Equal("binary", MySqlTableOptions.CharsetOf("binary"));
        Assert.Equal("latin1", MySqlTableOptions.CharsetOf("latin1_swedish_ci"));
    }

    [Fact]
    public void ARoundTrippedModel_ShowsNoOptionChange()
    {
        // what ReadTableAsync reports, compared with itself after the case of ROW_FORMAT was retyped
        var read = MySqlTableOptions.Read("InnoDB", "utf8mb4_0900_ai_ci", "Dynamic", 7);
        var orders = DesignerCases.Orders(Dialect.MySql) with { Options = new TableOptions { Extra = read } };
        var typed = orders with { Options = new TableOptions { Extra = new Dictionary<string, string>(read) { ["rowFormat"] = "DYNAMIC", ["engine"] = "innodb" } } };
        Assert.Empty(Scripter.ScriptTable(orders, typed, Context).Statements);
    }
}
