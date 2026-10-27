using DbStudio.Core.Designer;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.SchemaCompare;
using DbStudio.Providers.MySql;
using DbStudio.Providers.MySql.Designer;
using DbStudio.Providers.Oracle;
using DbStudio.Providers.Oracle.Designer;
using DbStudio.Providers.PostgreSql;
using DbStudio.Providers.PostgreSql.Designer;
using DbStudio.Providers.Sqlite;
using DbStudio.Providers.Sqlite.Designer;
using DbStudio.Providers.SqlServer;
using DbStudio.Providers.SqlServer.Designer;

namespace DbStudio.SchemaCompare.Tests;

/// <summary>
/// Script builder per dialect without a server: two hand-built snapshots are compared and scripted with the real provider
/// scripters, and the statements are checked (alter column type, NOT NULL with default, dropped column, foreign key order,
/// view rebuild, routine replace, batch separators).
/// </summary>
public sealed class ScriptBuilderGoldenTests
{
    public sealed record D(string Id, Dialect Dialect, IDbProvider Provider, IDdlScripter Scripter, string Schema, string Int, string Text100, string Text200, string? Version)
    {
        public override string ToString() => Id;
    }

    private static readonly Dictionary<string, D> Dialects = new()
    {
        ["postgresql"] = new("postgresql", Dialect.PgSql, new PostgreSqlProvider(), new PgDdlScripter(), "app", "integer", "varchar(100)", "varchar(200)", "16.4"),
        ["sqlserver"] = new("sqlserver", Dialect.TSql, new SqlServerProvider(), new SqlServerDdlScripter(), "app", "int", "nvarchar(100)", "nvarchar(200)", "16.0.4135.4"),
        ["mysql"] = new("mysql", Dialect.MySql, new MySqlProvider(), new MySqlDdlScripter("mysql"), "app", "int", "varchar(100)", "varchar(200)", "8.4.0"),
        ["oracle"] = new("oracle", Dialect.PlSql, new OracleProvider(), new OracleDdlScripter(), "APP", "NUMBER(10)", "VARCHAR2(100)", "VARCHAR2(200)", "23.0.0.0"),
        ["sqlite"] = new("sqlite", Dialect.Sqlite, new SqliteProvider(), new SqliteDdlScripter(), "main", "INTEGER", "VARCHAR(100)", "VARCHAR(200)", "3.46.1"),
    };

    public static TheoryData<string> All => new(Dialects.Keys);

    public static TheoryData<string> WithForeignKeyStatements => new(Dialects.Keys.Where(k => k != "sqlite"));

    // ------------------------------------------------------------------ helpers

    private static TableColumnModel Col(string name, string type, bool nullable = true, string? def = null) =>
        new() { Id = name, Name = name, Type = type, Nullable = nullable, Default = def };

    private static TableModel Table(D d, string name, params TableColumnModel[] columns) => new()
    {
        Schema = d.Schema, Name = name, Columns = columns.ToList(),
        PrimaryKey = new PrimaryKeyModel { Name = "pk_" + name, Columns = [columns[0].Name] },
    };

    private static SchemaSnapshot Snap(D d, IEnumerable<TableModel>? tables = null, IEnumerable<DbObject>? objects = null)
    {
        var s = new SchemaSnapshot { Database = null, Schema = d.Schema };
        foreach (var t in tables ?? []) s.Tables[t.Name] = t;
        foreach (var o in objects ?? []) s.Objects[o.Key] = o;
        return s;
    }

    private sealed class FakeDesignerDb(string providerId, string? version) : IDesignerDatabase
    {
        public string ProviderId => providerId;

        public Task<DdlScriptContext> GetScriptContextAsync(ConnectionProfile profile, string? password, string? database, string? schema, string? table, CancellationToken ct) =>
            Task.FromResult(new DdlScriptContext(version, schema, []));

        public Task<TableModel> ReadTableAsync(ConnectionProfile profile, string? password, string? database, string? schema, string name, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<ViewModel> ReadViewAsync(ConnectionProfile profile, string? password, string? database, string? schema, string name, CancellationToken ct) =>
            throw new NotSupportedException();

        public Task<DdlApplyResult> ApplyAsync(ConnectionProfile profile, string? password, DdlApplyRequest request, CancellationToken ct) =>
            throw new NotSupportedException();
    }

    private sealed record Run(List<ItemRec> Items, BuiltScript Script, string Text)
    {
        public List<string> Sql => Script.Statements.Select(s => s.Sql).ToList();

        public int IndexOf(Func<string, bool> predicate) => Sql.FindIndex(s => predicate(s));

        public string Dump() => string.Join("\n---\n", Sql) + "\n=== warnings ===\n" + string.Join("\n", Script.Warnings.Select(w => $"{w.Severity} {w.ItemId}: {w.Message}"));
    }

    private static async Task<Run> CompareAndScript(D d, SchemaSnapshot src, SchemaSnapshot tgt, CompareOptions? options = null)
    {
        var o = options ?? new CompareOptions();
        var profile = new ConnectionProfile { Id = "c_" + d.Id, Name = d.Id, ProviderId = d.Id };
        var ctx = new ProviderContext(profile, null, d.Provider, new FakeDesignerDb(d.Id, d.Version), d.Scripter);
        var items = SchemaComparer.Compare(src, tgt, o, d.Dialect, d.Id);
        var model = new ComparisonModel
        {
            Id = "cmp_test", Source = ctx, Target = ctx, SourceEndpoint = new CompareEndpoint(profile.Id, null, "src"), TargetEndpoint = new CompareEndpoint(profile.Id, null, d.Schema),
            SourceSnapshot = src, TargetSnapshot = tgt, Options = o, Items = items, ClientId = "",
        };
        var built = await ScriptBuilder.BuildAsync(model, null, CancellationToken.None);
        return new Run(items, built, ScriptText.Build(model, built));
    }

    private static bool Has(string sql, params string[] parts) => parts.All(p => sql.Contains(p, StringComparison.OrdinalIgnoreCase));

    // ------------------------------------------------------------------ tables

    [Theory, MemberData(nameof(All))]
    public async Task AlterColumnType_NarrowingIsDataLoss(string id)
    {
        var d = Dialects[id];
        var tgt = Snap(d, [Table(d, "customers", Col("id", d.Int, false), Col("email", d.Text200))]);
        var src = Snap(d, [Table(d, "customers", Col("id", d.Int, false), Col("email", d.Text100))]);
        var run = await CompareAndScript(d, src, tgt);

        var item = Assert.Single(run.Items);
        Assert.Equal(CompareStatus.Alter, item.Status);
        Assert.Contains(item.Changes, c => c.Contains("email", StringComparison.Ordinal) && c.Contains("type", StringComparison.Ordinal));
        Assert.Contains(run.Script.Warnings, w => w.Severity == "dataLoss" && w.Message.Contains("Narrowing", StringComparison.Ordinal));
        if (d.Dialect == Dialect.Sqlite)
            Assert.True(run.IndexOf(s => Has(s, "CREATE TABLE", "customers__new")) >= 0, run.Dump());
        else
            Assert.True(run.IndexOf(s => Has(s, "ALTER TABLE", "customers") && Has(s, "email") && Has(s, d.Text100.Split('(')[0])) >= 0, run.Dump());
    }

    [Theory, MemberData(nameof(All))]
    public async Task WideningColumnType_IsNotDataLoss(string id)
    {
        var d = Dialects[id];
        var tgt = Snap(d, [Table(d, "customers", Col("id", d.Int, false), Col("email", d.Text100))]);
        var src = Snap(d, [Table(d, "customers", Col("id", d.Int, false), Col("email", d.Text200))]);
        var run = await CompareAndScript(d, src, tgt);
        Assert.DoesNotContain(run.Script.Warnings, w => w.Severity == "dataLoss");
        Assert.NotEmpty(run.Sql);
    }

    [Theory, MemberData(nameof(All))]
    public async Task AddNotNullColumn_WithDefault_HasNoWarning_WithoutDefault_Warns(string id)
    {
        var d = Dialects[id];
        var tgt = Snap(d, [Table(d, "orders", Col("id", d.Int, false))]);
        var src = Snap(d, [Table(d, "orders", Col("id", d.Int, false), Col("status", d.Text100, false, "'new'"), Col("note", d.Text100, false))]);
        var run = await CompareAndScript(d, src, tgt);

        var adds = run.Sql.Where(s => Has(s, "status")).ToList();
        Assert.True(adds.Count > 0, run.Dump());
        Assert.Contains(adds, s => Has(s, "DEFAULT", "'new'"));
        Assert.DoesNotContain(run.Script.Warnings, w => w.Message.Contains("New NOT NULL column status", StringComparison.Ordinal));
        Assert.Contains(run.Script.Warnings, w => w.Severity == "warning" && w.Message.Contains("New NOT NULL column note has no default", StringComparison.Ordinal));
    }

    [Theory, MemberData(nameof(All))]
    public async Task DropColumn_IsDataLoss(string id)
    {
        var d = Dialects[id];
        var tgt = Snap(d, [Table(d, "customers", Col("id", d.Int, false), Col("nickname", d.Text100))]);
        var src = Snap(d, [Table(d, "customers", Col("id", d.Int, false))]);
        var run = await CompareAndScript(d, src, tgt);
        Assert.Contains(run.Script.Warnings, w => w.Severity == "dataLoss" && w.Message == "Dropping column nickname deletes its data.");
        if (d.Dialect != Dialect.Sqlite) Assert.Contains(run.Sql, s => Has(s, "DROP", "nickname"));
        Assert.Contains("DATA LOSS WARNINGS", run.Text);
    }

    [Theory, MemberData(nameof(All))]
    public async Task DropTable_IsDataLoss(string id)
    {
        var d = Dialects[id];
        var tgt = Snap(d, [Table(d, "legacy", Col("id", d.Int, false))]);
        var run = await CompareAndScript(d, Snap(d), tgt);
        Assert.Equal(CompareStatus.Drop, Assert.Single(run.Items).Status);
        Assert.Contains(run.Sql, s => Has(s, "DROP TABLE", "legacy"));
        Assert.Contains(run.Script.Warnings, w => w.Severity == "dataLoss");
    }

    [Theory, MemberData(nameof(WithForeignKeyStatements))]
    public async Task NewTablesWithForeignKeys_CreateBothBeforeTheKey(string id)
    {
        var d = Dialects[id];
        var parent = Table(d, "parent", Col("id", d.Int, false));
        // "a_child" sorts before "parent": the key must still come after both CREATE TABLEs
        var child = Table(d, "a_child", Col("id", d.Int, false), Col("parent_id", d.Int)) with
        {
            ForeignKeys = [new ForeignKeyModel { Name = "fk_child_parent", Columns = ["parent_id"], RefSchema = d.Schema, RefTable = "parent", RefColumns = ["id"] }],
        };
        var run = await CompareAndScript(d, Snap(d, [parent, child]), Snap(d));

        var createParent = run.IndexOf(s => Has(s, "CREATE TABLE", "parent") && !Has(s, "a_child"));
        var createChild = run.IndexOf(s => Has(s, "CREATE TABLE", "a_child"));
        var fk = run.IndexOf(s => Has(s, "fk_child_parent") && Has(s, "FOREIGN KEY"));
        Assert.True(createParent >= 0 && createChild >= 0 && fk > createParent && fk > createChild, run.Dump());
        Assert.DoesNotContain("fk_child_parent", run.Sql[createChild], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Sqlite_NewTables_AreCreatedParentFirst()
    {
        var d = Dialects["sqlite"];
        var parent = Table(d, "parent", Col("id", d.Int, false));
        var child = Table(d, "a_child", Col("id", d.Int, false), Col("parent_id", d.Int)) with
        {
            ForeignKeys = [new ForeignKeyModel { Name = "fk_child_parent", Columns = ["parent_id"], RefSchema = "main", RefTable = "parent", RefColumns = ["id"] }],
        };
        var run = await CompareAndScript(d, Snap(d, [parent, child]), Snap(d));
        var createParent = run.IndexOf(s => Has(s, "CREATE TABLE", "\"parent\""));
        var createChild = run.IndexOf(s => Has(s, "CREATE TABLE", "a_child"));
        Assert.True(createParent >= 0 && createChild > createParent, run.Dump());
        Assert.Contains("REFERENCES", run.Sql[createChild], StringComparison.OrdinalIgnoreCase);
    }

    [Theory, MemberData(nameof(WithForeignKeyStatements))]
    public async Task RetypedKeyColumn_DropsAndRecreatesTheForeignKeyAroundIt(string id)
    {
        var d = Dialects[id];
        var bigger = d.Dialect switch { Dialect.PlSql => "NUMBER(19)", Dialect.PgSql => "bigint", _ => "bigint" };
        TableModel Child(string type) => Table(d, "child", Col("id", d.Int, false), Col("parent_id", type)) with
        {
            ForeignKeys = [new ForeignKeyModel { Name = "fk_child_parent", Columns = ["parent_id"], RefSchema = d.Schema, RefTable = "parent", RefColumns = ["id"] }],
        };
        var tgt = Snap(d, [Table(d, "parent", Col("id", d.Int, false)), Child(d.Int)]);
        var src = Snap(d, [Table(d, "parent", Col("id", bigger, false)), Child(bigger)]);
        var run = await CompareAndScript(d, src, tgt);

        var dropFk = run.IndexOf(s => Has(s, "DROP", "fk_child_parent"));
        var retype = run.IndexOf(s => Has(s, "ALTER TABLE", "parent") && !Has(s, "fk_child_parent") && Has(s, "id"));
        var addFk = run.IndexOf(s => Has(s, "ADD", "fk_child_parent"));
        Assert.True(dropFk >= 0 && retype > dropFk && addFk > retype, run.Dump());
    }

    // ------------------------------------------------------------------ views

    private static DbObject View(D d, string name, string body, params string[] columns)
    {
        var ddl = $"CREATE VIEW {name} AS {body}";
        return new DbObject(CompareKinds.View, "view:" + name, name, ddl, Columns: columns.Select(c => new CatalogColumn(c, d.Int, true, false)).ToList(),
            View: new ViewModel(d.Schema, name, body, new ViewOptions(), ddl));
    }

    [Fact]
    public async Task PostgreSql_ViewLosingAColumn_IsDroppedAndCreated()
    {
        var d = Dialects["postgresql"];
        var tgt = Snap(d, objects: [View(d, "v_customers", "SELECT id, name FROM app.customers", "id", "name")]);
        var src = Snap(d, objects: [View(d, "v_customers", "SELECT id FROM app.customers", "id")]);
        var run = await CompareAndScript(d, src, tgt);

        var drop = run.IndexOf(s => Has(s, "DROP VIEW", "v_customers"));
        var create = run.IndexOf(s => Has(s, "CREATE", "VIEW", "v_customers"));
        Assert.True(drop >= 0 && create > drop, run.Dump());
    }

    [Fact]
    public async Task PostgreSql_ViewAddingAColumn_IsReplacedInPlace()
    {
        var d = Dialects["postgresql"];
        var tgt = Snap(d, objects: [View(d, "v_customers", "SELECT id FROM app.customers", "id")]);
        var src = Snap(d, objects: [View(d, "v_customers", "SELECT id, name FROM app.customers", "id", "name")]);
        var run = await CompareAndScript(d, src, tgt);
        Assert.DoesNotContain(run.Sql, s => Has(s, "DROP VIEW"));
        Assert.Contains(run.Sql, s => Has(s, "CREATE OR REPLACE VIEW", "v_customers"));
    }

    [Fact]
    public async Task SqlServer_ChangedView_IsCreateOrAlter()
    {
        var d = Dialects["sqlserver"];
        var tgt = Snap(d, objects: [View(d, "v_customers", "SELECT id FROM app.customers", "id")]);
        var src = Snap(d, objects: [View(d, "v_customers", "SELECT id, name FROM app.customers", "id", "name")]);
        var run = await CompareAndScript(d, src, tgt);
        Assert.Contains(run.Sql, s => Has(s, "CREATE OR ALTER VIEW", "v_customers"));
        Assert.Contains("\nGO", run.Text);
    }

    [Fact]
    public async Task Sqlite_ChangedView_IsDroppedBeforeTableRebuilds_AndCreatedAfter()
    {
        var d = Dialects["sqlite"];
        var tgt = Snap(d, [Table(d, "customers", Col("id", d.Int, false), Col("email", d.Text200))],
            [View(d, "v_customers", "SELECT id FROM customers", "id")]);
        var src = Snap(d, [Table(d, "customers", Col("id", d.Int, false), Col("email", d.Text100))],
            [View(d, "v_customers", "SELECT id, email FROM customers", "id", "email")]);
        var run = await CompareAndScript(d, src, tgt);

        var drop = run.IndexOf(s => Has(s, "DROP VIEW", "v_customers"));
        var rebuild = run.IndexOf(s => Has(s, "RENAME TO"));
        var create = run.IndexOf(s => Has(s, "CREATE VIEW", "v_customers"));
        Assert.True(drop >= 0 && rebuild > drop && create > rebuild, run.Dump());
        Assert.Single(run.Sql, s => Has(s, "CREATE VIEW", "v_customers"));
    }

    // ------------------------------------------------------------------ routines

    private static DbObject Routine(string kind, string key, string name, string ddl) => new(kind, key, name, ddl);

    [Fact]
    public async Task PostgreSql_ChangedFunction_IsCreateOrReplace()
    {
        var d = Dialects["postgresql"];
        const string key = "func:fn_tax(amount numeric)";
        var tgt = Snap(d, objects: [Routine("func", key, "fn_tax(amount numeric)", "CREATE FUNCTION app.fn_tax(amount numeric)\n RETURNS numeric\n LANGUAGE sql\nAS $$ SELECT amount * 0.2 $$")]);
        var src = Snap(d, objects: [Routine("func", key, "fn_tax(amount numeric)", "CREATE FUNCTION app.fn_tax(amount numeric)\n RETURNS numeric\n LANGUAGE sql\nAS $$ SELECT amount * 0.19 $$")]);
        var run = await CompareAndScript(d, src, tgt);
        Assert.Equal(CompareStatus.Alter, Assert.Single(run.Items).Status);
        Assert.Contains(run.Sql, s => Has(s, "CREATE OR REPLACE FUNCTION", "fn_tax", "0.19"));
        Assert.DoesNotContain(run.Sql, s => Has(s, "DROP FUNCTION"));
    }

    [Fact]
    public async Task PostgreSql_FunctionWithNewReturnType_IsDroppedAndCreated()
    {
        var d = Dialects["postgresql"];
        const string key = "func:fn_one()";
        var tgt = Snap(d, objects: [Routine("func", key, "fn_one()", "CREATE FUNCTION app.fn_one()\n RETURNS integer\n LANGUAGE sql\nAS $$ SELECT 1 $$")]);
        var src = Snap(d, objects: [Routine("func", key, "fn_one()", "CREATE FUNCTION app.fn_one()\n RETURNS bigint\n LANGUAGE sql\nAS $$ SELECT 1 $$")]);
        var run = await CompareAndScript(d, src, tgt);
        var drop = run.IndexOf(s => Has(s, "DROP FUNCTION", "\"fn_one\"()"));
        var create = run.IndexOf(s => Has(s, "CREATE FUNCTION", "fn_one", "bigint"));
        Assert.True(drop >= 0 && create > drop, run.Dump());
    }

    [Fact]
    public async Task SqlServer_ChangedProcedure_IsCreateOrAlter_OnOldServersDropAndCreate()
    {
        var d = Dialects["sqlserver"];
        var tgt = Snap(d, objects: [Routine("proc", "proc:touch", "touch", "CREATE PROCEDURE app.touch @id int AS SELECT 1")]);
        var src = Snap(d, objects: [Routine("proc", "proc:touch", "touch", "CREATE PROCEDURE app.touch @id int AS SELECT 2")]);
        var run = await CompareAndScript(d, src, tgt);
        Assert.Contains(run.Sql, s => Has(s, "CREATE OR ALTER PROCEDURE", "touch"));

        var old = d with { Version = "12.0.6024.0" };
        var run2 = await CompareAndScript(old, src, tgt);
        var drop = run2.IndexOf(s => Has(s, "DROP PROCEDURE", "touch"));
        var create = run2.IndexOf(s => Has(s, "CREATE PROCEDURE", "touch") && !Has(s, "OR ALTER"));
        Assert.True(drop >= 0 && create > drop, run2.Dump());
    }

    [Fact]
    public async Task Oracle_ChangedProcedure_IsCreateOrReplace_TerminatedWithSlash()
    {
        var d = Dialects["oracle"];
        var tgt = Snap(d, objects: [Routine("proc", "proc:TOUCH", "TOUCH", "CREATE PROCEDURE \"APP\".\"TOUCH\" AS BEGIN NULL; END;")]);
        var src = Snap(d, objects: [Routine("proc", "proc:TOUCH", "TOUCH", "CREATE PROCEDURE \"APP\".\"TOUCH\" AS BEGIN DBMS_OUTPUT.PUT_LINE('x'); END;")]);
        var run = await CompareAndScript(d, src, tgt);
        Assert.Contains(run.Sql, s => Has(s, "CREATE OR REPLACE PROCEDURE", "TOUCH"));
        Assert.Contains("END;\n/", run.Text);
        Assert.False(run.Script.TransactionalDdl);
    }

    [Theory]
    [InlineData("mysql")]
    public async Task MySql_ChangedFunction_IsDroppedAndCreated_WithDelimiterInTheText(string id)
    {
        var d = Dialects[id];
        var tgt = Snap(d, objects: [Routine("func", "func:fn_tax", "fn_tax", "CREATE DEFINER=`root`@`%` FUNCTION `fn_tax`(amount DECIMAL(12,2)) RETURNS decimal(12,2)\n    DETERMINISTIC\nBEGIN RETURN amount * 0.2; END")]);
        var src = Snap(d, objects: [Routine("func", "func:fn_tax", "fn_tax", "CREATE DEFINER=`root`@`%` FUNCTION `fn_tax`(amount DECIMAL(12,2)) RETURNS decimal(12,2)\n    DETERMINISTIC\nBEGIN RETURN amount * 0.19; END")]);
        var run = await CompareAndScript(d, src, tgt);
        var drop = run.IndexOf(s => Has(s, "DROP FUNCTION", "fn_tax"));
        var create = run.IndexOf(s => Has(s, "CREATE FUNCTION", "fn_tax", "0.19"));
        Assert.True(drop >= 0 && create > drop, run.Dump());
        Assert.DoesNotContain("DEFINER", run.Sql[create], StringComparison.OrdinalIgnoreCase);
        Assert.Contains("DELIMITER $$", run.Text);
        Assert.False(run.Script.TransactionalDdl);
    }

    // ------------------------------------------------------------------ selection and options

    [Fact]
    public async Task OnlyTheSelectedItemsAreScripted()
    {
        var d = Dialects["postgresql"];
        var tgt = Snap(d, [Table(d, "a", Col("id", d.Int, false)), Table(d, "b", Col("id", d.Int, false))]);
        var src = Snap(d, [Table(d, "a", Col("id", d.Int, false), Col("x", d.Int)), Table(d, "b", Col("id", d.Int, false), Col("y", d.Int))]);
        var profile = new ConnectionProfile { Id = "c", Name = "pg", ProviderId = d.Id };
        var ctx = new ProviderContext(profile, null, d.Provider, new FakeDesignerDb(d.Id, d.Version), d.Scripter);
        var items = SchemaComparer.Compare(src, tgt, new CompareOptions(), d.Dialect, d.Id);
        var model = new ComparisonModel
        {
            Id = "cmp", Source = ctx, Target = ctx, SourceEndpoint = new CompareEndpoint("c"), TargetEndpoint = new CompareEndpoint("c"),
            SourceSnapshot = src, TargetSnapshot = tgt, Options = new CompareOptions(), Items = items, ClientId = "",
        };
        var built = await ScriptBuilder.BuildAsync(model, ["table:b"], CancellationToken.None);
        Assert.Equal(1, built.ItemCount);
        Assert.All(built.Statements, s => Assert.Equal("table:b", s.ItemId));
    }

    [Fact]
    public async Task IgnoreWhitespaceAndCase_MakeCosmeticRoutineDifferencesIdentical()
    {
        var d = Dialects["sqlserver"];
        var tgt = Snap(d, objects: [Routine("proc", "proc:p", "p", "CREATE PROCEDURE app.p AS\n  SELECT   1")]);
        var src = Snap(d, objects: [Routine("proc", "proc:p", "p", "create procedure app.p as select 1")]);
        var same = await CompareAndScript(d, src, tgt);
        Assert.Equal(CompareStatus.Identical, Assert.Single(same.Items).Status);
        Assert.Empty(same.Sql);

        var strict = await CompareAndScript(d, src, tgt, new CompareOptions { IgnoreWhitespace = false, IgnoreCase = false });
        Assert.Equal(CompareStatus.Alter, Assert.Single(strict.Items).Status);
    }

    [Theory]
    [InlineData("13.0.4001.0", true)]
    [InlineData("13.0.1601.5", false)]
    [InlineData("16.0.4135.4", true)]
    [InlineData(null, true)]
    public void CreateOrAlter_NeedsSqlServer2016Sp1(string? version, bool expected) =>
        Assert.Equal(expected, ScriptBuilder.SupportsCreateOrAlter(version));
}
