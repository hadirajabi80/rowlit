using DbStudio.Core.Transfer;

namespace DbStudio.Transfer.Tests;

/// <summary>
/// Copies the docker sample shop (SQL Server dbo / PostgreSQL public / MySQL shop) between providers into scratch schemas
/// that the test creates and drops. The shop data itself is only read.
/// </summary>
public sealed class ShopTransferTests
{
    private static readonly string[] ShopTables = ["Countries", "Customers", "Products", "Orders", "OrderLines"];

    private static string Scratch() => "xfer_" + Guid.NewGuid().ToString("N")[..8];

    private static List<TransferTableSpec> Tables(params string[] names) => names.Select(n => new TransferTableSpec(n)).ToList();

    [SkippableFact]
    public async Task SqlServer_to_PostgreSql_copies_structure_data_keys_and_identity()
    {
        Skip.IfNot(Servers.Reachable(Servers.MsSql) && Servers.Reachable(Servers.Pg), "SQL Server / PostgreSQL sample servers not reachable");
        var env = new TestEnv().Add(Servers.MsSqlProfile(), Servers.MsSqlPassword).Add(Servers.PgProfile(), Servers.PgPassword);
        var schema = Scratch();
        var svc = new TransferService(env);
        try
        {
            var spec = new TransferSpec(new TransferSource("c_ms", "shop", "dbo"), new TransferTarget("c_pg", "shop", schema), Tables(ShopTables),
                new TransferOptions { CreateMode = CreateModes.FailIfExists, DataMode = DataModes.Append });
            var plan = await svc.PlanAsync(spec, CancellationToken.None);
            Assert.All(plan.Tables, t => Assert.Null(t.Error));
            var customers = plan.Tables.Single(t => t.SourceName == "Customers");
            Assert.Equal("customers", customers.TargetName);
            Assert.Contains(customers.Columns, c => c.Name == "Email" && c.TargetName == "email" && c.TargetType == "varchar(200)");

            var result = await svc.RunAsync(spec, null, CancellationToken.None);
            Assert.True(result.Status == TransferStatus.Ok, string.Join("\n", result.Errors.Select(e => $"{e.Table}/{e.Phase}: {e.Message}\n{e.Sql}")));
            Assert.Equal(3 + 5 + 4 + 6 + 7, result.TotalRows);

            Assert.Equal(5L, Convert.ToInt64(await env.ScalarAsync("c_pg", "shop", $"SELECT count(*) FROM {schema}.customers")));
            var rows = await env.QueryAsync("c_pg", "shop", $"SELECT id, name, email, countryid FROM {schema}.customers ORDER BY id");
            Assert.Equal("Alice", rows[0][1]);
            Assert.Null(rows[1][2]);
            // identity preserved: next insert continues after the copied values
            await env.ExecAsync("c_pg", "shop", $"INSERT INTO {schema}.customers (name) VALUES ('Zed')");
            Assert.Equal(6L, Convert.ToInt64(await env.ScalarAsync("c_pg", "shop", $"SELECT max(id) FROM {schema}.customers")));
            // foreign keys came after the data
            Assert.Equal(4L, Convert.ToInt64(await env.ScalarAsync("c_pg", "shop",
                $"SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema = '{schema}' AND constraint_type = 'FOREIGN KEY'")));
            Assert.Equal("120.50", Convert.ToString(await env.ScalarAsync("c_pg", "shop", $"SELECT total FROM {schema}.orders WHERE id = 1")));
        }
        finally
        {
            await env.ExecAsync("c_pg", "shop", $"DROP SCHEMA IF EXISTS {schema} CASCADE");
        }
    }
}
