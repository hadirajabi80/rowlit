using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Native;

namespace DbStudio.Federation.Tests.WpB;

/// <summary>
/// Native link scripts per target/member pair, compared with the snapshots in WpB/Snapshots/native-*.sql (regenerate with
/// GOLDEN_WRITE=1 and review the diff). Secrets are placeholders, the password never appears.
/// </summary>
public sealed class NativeLinkScripterTests
{
    private const string SecretPassword = "S3cret-never-shown";

    private static ConnectionProfile Profile(string provider, Dictionary<string, JsonNode?> props) =>
        new() { Id = "c_" + provider, Name = provider + " sample", ProviderId = provider, Props = props };

    private static readonly Dictionary<string, ConnectionProfile> Members = new()
    {
        ["sqlserver"] = Profile("sqlserver", new() { ["server"] = "db.example.com,14333", ["auth"] = "sql", ["user"] = "sa", ["database"] = "shop", ["password"] = SecretPassword }),
        ["postgresql"] = Profile("postgresql", new() { ["host"] = "pg.example.com", ["port"] = 15432, ["database"] = "shop", ["user"] = "shop" }),
        ["mysql"] = Profile("mysql", new() { ["host"] = "localhost", ["port"] = 13306, ["database"] = "shop", ["user"] = "shop" }),
        ["oracle"] = Profile("oracle", new() { ["host"] = "ora.example.com", ["port"] = 15211, ["serviceName"] = "FREEPDB1", ["user"] = "shop" }),
    };

    private static readonly IReadOnlyList<SourceTable> MySqlTables =
    [
        new("customers", "customers", null, "shop", "table",
            [new("id", "int", "int", false, true), new("name", "varchar(100)", "string", false), new("email", "varchar(200)", "string", true)], ["id"], []),
        new("orders", "orders", null, "shop", "table",
            [new("id", "int", "int", false, true), new("total", "decimal(10,2)", "decimal", true)], ["id"], []),
    ];

    public static TheoryData<string, Dialect, string, string, string?> Cases() => new()
    {
        { "mssql-from-sqlserver", Dialect.TSql, "sqlserver", "sqlserver", null },
        { "mssql-from-postgresql", Dialect.TSql, "sqlserver", "postgresql", null },
        { "mssql-from-oracle", Dialect.TSql, "sqlserver", "oracle", null },
        { "pg-from-postgresql", Dialect.PgSql, "postgresql", "postgresql", null },
        { "pg-from-mysql", Dialect.PgSql, "postgresql", "mysql", null },
        { "pg-from-oracle", Dialect.PgSql, "postgresql", "oracle", null },
        { "pg-from-sqlserver", Dialect.PgSql, "postgresql", "sqlserver", null },
        { "oracle-from-oracle", Dialect.PlSql, "oracle", "oracle", null },
        { "oracle-from-postgresql", Dialect.PlSql, "oracle", "postgresql", null },
        { "mysql-from-mysql", Dialect.MySql, "mysql", "mysql", null },
        { "mariadb-from-mysql", Dialect.MySql, "mariadb", "mysql", "crm_fed" },
        { "clickhouse-from-postgresql", Dialect.ClickHouse, "clickhouse", "postgresql", null },
        { "clickhouse-from-mysql", Dialect.ClickHouse, "clickhouse", "mysql", null },
    };

    private static NativeLinkSource Source(string provider) => new(
        "crm", provider, Members[provider], null, provider == "postgresql" ? "public" : null, false,
        [new MountedTable { Name = "customers" }, new MountedTable { Name = "orders", As = "sales" }],
        provider == "mysql" ? MySqlTables : null);

    [Theory]
    [MemberData(nameof(Cases))]
    public void Script_matches_its_snapshot(string snapshot, Dialect target, string targetProvider, string memberProvider, string? name)
    {
        var r = NativeLinkScripter.Script(target, targetProvider, Source(memberProvider), null, name);
        Assert.Equal(target, r.Dialect);
        Assert.Contains(NativeLinkScripter.PasswordPlaceholder, r.Script, StringComparison.Ordinal);
        Assert.Contains(NativeLinkScripter.PasswordPlaceholder, r.Placeholders);
        Assert.All(r.Placeholders, p => Assert.Contains(p, r.Script, StringComparison.Ordinal));
        Assert.DoesNotContain(SecretPassword, r.Script, StringComparison.Ordinal);
        Assert.Equal(r.Kind, r.AvailableKinds[0]);
        var text = $"-- kind: {r.Kind}\n-- placeholders: {string.Join(", ", r.Placeholders)}\n{string.Concat(r.Notes.Select(n => "-- note: " + n + "\n"))}{r.Script}";
        var path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "WpB", "Snapshots", $"native-{snapshot}.sql");
        if (Environment.GetEnvironmentVariable("GOLDEN_WRITE") == "1")
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, text);
            return;
        }
        Assert.True(File.Exists(path), $"missing snapshot {path} (run with GOLDEN_WRITE=1)");
        Assert.Equal(File.ReadAllText(path).ReplaceLineEndings("\n"), text);
    }

    [Theory]
    [InlineData(Dialect.Sqlite, "sqlite", "postgresql")]
    [InlineData(Dialect.MySql, "mysql", "postgresql")]
    [InlineData(Dialect.ClickHouse, "clickhouse", "oracle")]
    [InlineData(Dialect.PgSql, "postgresql", "clickhouse")]
    public void Impossible_pairs_are_400(Dialect target, string targetProvider, string memberProvider)
    {
        var profile = Profile(memberProvider, new() { ["host"] = "h" });
        var e = Assert.Throws<EngineException>(() => NativeLinkScripter.Script(target, targetProvider,
            new NativeLinkSource("crm", memberProvider, profile, null, null, true, [], null), null, null));
        Assert.Equal(400, e.Status);
    }

    [Fact]
    public void Unknown_kind_and_bad_names_are_refused()
    {
        Assert.Equal(400, Assert.Throws<EngineException>(() => NativeLinkScripter.Script(Dialect.PgSql, "postgresql", Source("postgresql"), NativeLinkKinds.LinkedServer, null)).Status);
        Assert.Equal(400, Assert.Throws<EngineException>(() => NativeLinkScripter.Script(Dialect.PgSql, "postgresql", Source("postgresql"), null, "x'; DROP")).Status);
    }

    [Fact]
    public void Windows_authentication_member_gets_a_user_placeholder()
    {
        var p = Profile("sqlserver", new() { ["server"] = "srv", ["auth"] = "windows" });
        var r = NativeLinkScripter.Script(Dialect.TSql, "sqlserver", new NativeLinkSource("crm", "sqlserver", p, "shop", null, true, [], null), null, null);
        Assert.Contains(NativeLinkScripter.UserPlaceholder, r.Placeholders);
        Assert.Contains("@rmtuser = N'<user>'", r.Script, StringComparison.Ordinal);
    }

    [Fact]
    public void All_tables_member_imports_the_whole_schema()
    {
        var r = NativeLinkScripter.Script(Dialect.PgSql, "postgresql", Source("postgresql") with { AllTables = true }, null, null);
        Assert.Contains("IMPORT FOREIGN SCHEMA \"public\" FROM SERVER crm INTO crm;", r.Script, StringComparison.Ordinal);
    }
}
