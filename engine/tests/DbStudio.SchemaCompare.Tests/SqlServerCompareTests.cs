using DbStudio.Core.SchemaCompare;

namespace DbStudio.SchemaCompare.Tests;

/// <summary>Scratch schemas cmp_src / cmp_dst in the SQL Server sample database (dbo and Sales of "shop" are never touched).</summary>
public sealed class SqlServerCompareTests
{
    private static IEnumerable<string> Common(string s) =>
    [
        $"CREATE SCHEMA {s}",
        $"CREATE TABLE {s}.countries (id int NOT NULL PRIMARY KEY, name nvarchar(100) NOT NULL)",
    ];

    private static IEnumerable<string> Source(string s) => Common(s).Concat(
    [
        $"CREATE SEQUENCE {s}.order_numbers AS int START WITH 1000 INCREMENT BY 1",
        $"CREATE TABLE {s}.customers (id int IDENTITY(1,1) NOT NULL PRIMARY KEY, name nvarchar(100) NOT NULL, email nvarchar(200) NULL UNIQUE, phone nvarchar(30) NULL, " +
        $"country_id int NULL REFERENCES {s}.countries (id), created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT ck_customers_name CHECK (LEN(name) > 0))",
        $"CREATE TABLE {s}.products (id int NOT NULL PRIMARY KEY, name nvarchar(100) NOT NULL, price decimal(10,2) NULL, sku nvarchar(20) NULL UNIQUE)",
        $"CREATE TABLE {s}.orders (id int NOT NULL PRIMARY KEY, customer_id int NOT NULL REFERENCES {s}.customers (id) ON DELETE CASCADE, " +
        $"total decimal(12,2) NOT NULL DEFAULT 0, status nvarchar(20) NOT NULL DEFAULT 'new')",
        $"CREATE INDEX ix_orders_customer ON {s}.orders (customer_id, total)",
        $"CREATE TABLE {s}.order_lines (order_id int NOT NULL REFERENCES {s}.orders (id), product_id int NOT NULL REFERENCES {s}.products (id), qty int NOT NULL, PRIMARY KEY (order_id, product_id))",
        $"CREATE TABLE {s}.reviews (id int NOT NULL PRIMARY KEY, customer_id int NOT NULL REFERENCES {s}.customers (id), body nvarchar(max) NULL)",
        $"CREATE VIEW {s}.customer_orders AS SELECT c.id AS customer_id, c.name, COUNT(o.id) AS orders FROM {s}.customers c LEFT JOIN {s}.orders o ON o.customer_id = c.id GROUP BY c.id, c.name",
        $"CREATE VIEW {s}.v_new_only AS SELECT id, name FROM {s}.countries",
        $"CREATE FUNCTION {s}.fn_tax (@amount decimal(12,2)) RETURNS decimal(12,2) AS BEGIN RETURN @amount * 0.19 END",
        $"CREATE FUNCTION {s}.fn_only_source () RETURNS int AS BEGIN RETURN 1 END",
        $"CREATE FUNCTION {s}.orders_of (@customerId int) RETURNS TABLE AS RETURN (SELECT id, total FROM {s}.orders WHERE customer_id = @customerId)",
        $"CREATE PROCEDURE {s}.get_customer @id int AS SELECT * FROM {s}.customers WHERE id = @id",
        $"CREATE PROCEDURE {s}.touch_order @id int AS UPDATE {s}.orders SET total = total WHERE id = @id",
        $"CREATE TRIGGER {s}.trg_orders_check ON {s}.orders AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted WHERE total < 0) THROW 50000, 'negative total', 1; END",
    ]);

    private static IEnumerable<string> Target(string s) => Common(s).Concat(
    [
        $"CREATE SEQUENCE {s}.order_numbers AS int START WITH 1000 INCREMENT BY 5",
        $"CREATE TABLE {s}.customers (id int IDENTITY(1,1) NOT NULL PRIMARY KEY, name nvarchar(100) NOT NULL, email nvarchar(100) NULL UNIQUE, nickname nvarchar(30) NULL, " +
        $"country_id int NULL REFERENCES {s}.countries (id), created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT ck_customers_name CHECK (LEN(name) > 1))",
        $"CREATE TABLE {s}.products (id int NOT NULL PRIMARY KEY, name nvarchar(100) NOT NULL, price decimal(8,2) NULL, sku nvarchar(20) NULL)",
        $"CREATE TABLE {s}.orders (id int NOT NULL PRIMARY KEY, customer_id int NOT NULL REFERENCES {s}.customers (id), " +
        $"total decimal(12,2) NOT NULL DEFAULT 0, status nvarchar(20) NOT NULL DEFAULT 'new')",
        $"CREATE INDEX ix_orders_customer ON {s}.orders (customer_id)",
        $"CREATE TABLE {s}.order_lines (order_id int NOT NULL REFERENCES {s}.orders (id), product_id int NOT NULL REFERENCES {s}.products (id), qty int NOT NULL, PRIMARY KEY (order_id, product_id))",
        $"CREATE TABLE {s}.legacy_audit (id int NOT NULL PRIMARY KEY, customer_id int NULL REFERENCES {s}.customers (id), note nvarchar(max) NULL)",
        $"CREATE VIEW {s}.customer_orders AS SELECT c.id AS customer_id, c.name FROM {s}.customers c",
        $"CREATE VIEW {s}.v_old AS SELECT id FROM {s}.countries",
        $"CREATE FUNCTION {s}.fn_tax (@amount decimal(12,2)) RETURNS decimal(12,2) AS BEGIN RETURN @amount * 0.2 END",
        $"CREATE FUNCTION {s}.fn_only_target () RETURNS int AS BEGIN RETURN 2 END",
        $"CREATE FUNCTION {s}.orders_of (@customerId int) RETURNS TABLE AS RETURN (SELECT id, total FROM {s}.orders WHERE customer_id = @customerId)",
        $"CREATE PROCEDURE {s}.get_customer @id int AS SELECT * FROM {s}.customers WHERE id = @id",
        $"CREATE PROCEDURE {s}.touch_order @id int AS UPDATE {s}.orders SET total = total WHERE id = @id",
        $"CREATE TRIGGER {s}.trg_old ON {s}.orders AFTER DELETE AS BEGIN SET NOCOUNT ON; END",
    ]);

    private static IEnumerable<string> Cleanup(string s) =>
    [
        $@"DECLARE @sql nvarchar(max) = N'';
SELECT @sql += N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(f.name) + N';'
FROM sys.foreign_keys f JOIN sys.tables t ON t.object_id = f.parent_object_id WHERE SCHEMA_NAME(t.schema_id) = N'{s}';
SELECT @sql += N'DROP VIEW ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N';' FROM sys.views WHERE SCHEMA_NAME(schema_id) = N'{s}';
SELECT @sql += N'DROP ' + CASE WHEN type = 'P' THEN N'PROCEDURE' ELSE N'FUNCTION' END + N' ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N';' FROM sys.objects WHERE type IN ('P','FN','IF','TF') AND SCHEMA_NAME(schema_id) = N'{s}';
SELECT @sql += N'DROP TABLE ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N';' FROM sys.tables WHERE SCHEMA_NAME(schema_id) = N'{s}';
SELECT @sql += N'DROP SEQUENCE ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(name) + N';' FROM sys.sequences WHERE SCHEMA_NAME(schema_id) = N'{s}';
IF SCHEMA_ID(N'{s}') IS NOT NULL SET @sql += N'DROP SCHEMA {s};';
EXEC (@sql);",
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
        ["func:fn_tax"] = CompareStatus.Alter,
        ["func:fn_only_source"] = CompareStatus.Create,
        ["func:fn_only_target"] = CompareStatus.Drop,
        ["trigger:trg_orders_check"] = CompareStatus.Create,
        ["trigger:trg_old"] = CompareStatus.Drop,
        ["sequence:order_numbers"] = CompareStatus.Alter,
    };

    [SkippableFact]
    public async Task Compare_Script_Apply_ThenIdentical()
    {
        var ms = Servers.MsSql;
        Skip.IfNot(await Servers.ReachableAsync("localhost", 14333), "SQL Server sample server is not reachable.");
        using var env = new CompareEnv();
        var conn = env.Add("mssql", "sqlserver", Servers.MsSqlProps(), ms.Password);
        var (result, script) = await ScratchRunner.RunAsync(env, new Scratch(conn, "shop", "cmp_src", "cmp_dst", Source, Target, Cleanup, Expected));
        Assert.True(result.TransactionalDdl);
        Assert.Contains("GO", script.Text);
    }
}
