using DbStudio.Core.Security;
using DbStudio.Core.Services;

namespace DbStudio.Core.Tests.Security;

public sealed class SecuritySqlTests
{
    [Fact]
    public void PostgreSql_create_masks_password_and_quotes_name()
    {
        var r = SecuritySql.Script("postgresql", new("create", "user", "odd\"name", Password: "s'ecret"));
        Assert.Equal("CREATE USER \"odd\"\"name\" LOGIN PASSWORD 's''ecret'", Assert.Single(r.Statements));
        Assert.Equal("CREATE USER \"odd\"\"name\" LOGIN PASSWORD '********'", Assert.Single(r.PreviewStatements));
    }

    [Fact]
    public void MySql_accounts_include_host_and_escape_it()
    {
        var r = SecuritySql.Script("mysql", new("create", "user", "alice", Host: "local'host", Password: "pw"));
        Assert.Equal("CREATE USER 'alice'@'local''host' IDENTIFIED BY 'pw'", Assert.Single(r.Statements));
    }

    [Fact]
    public void SqlServer_login_and_user_are_distinct()
    {
        Assert.StartsWith("CREATE LOGIN [alice] WITH PASSWORD", Assert.Single(SecuritySql.Script("sqlserver", new("create", "login", "alice", Password: "pw")).Statements));
        Assert.StartsWith("CREATE USER [alice] WITH PASSWORD", Assert.Single(SecuritySql.Script("sqlserver", new("create", "user", "alice", Password: "pw")).Statements));
    }

    [Theory]
    [InlineData("postgresql", "GRANT SELECT, UPDATE ON TABLE \"public\".\"orders\" TO \"analyst\" WITH GRANT OPTION")]
    [InlineData("mysql", "GRANT SELECT, UPDATE ON `shop`.`orders` TO 'analyst'@'%'")]
    [InlineData("sqlserver", "GRANT SELECT, UPDATE ON OBJECT::[dbo].[orders] TO [analyst]")]
    public void Grant_scripts_are_dialect_specific(string provider, string expected)
    {
        var r = SecuritySql.Script(provider, new("grant", "user", "analyst", Database: "shop", Schema: provider == "postgresql" ? "public" : "dbo", Object: "orders", ObjectType: "table", Privileges: ["select", "update"], Grantable: provider == "postgresql"));
        Assert.Equal(expected, Assert.Single(r.Statements));
    }

    [Fact]
    public void Read_only_provider_has_no_write_scripts() =>
        Assert.Throws<EngineException>(() => SecuritySql.Script("oracle", new("drop", "user", "alice")));

    [Fact]
    public void Privileges_cannot_inject_sql() =>
        Assert.Throws<EngineException>(() => SecuritySql.Script("postgresql", new("grant", "user", "alice", Schema: "public", Object: "t", Privileges: ["SELECT; DROP TABLE x"] )));

    [Fact]
    public void Listing_matrix_matches_supported_providers()
    {
        foreach (var p in SecuritySql.Providers) Assert.NotEmpty(SecuritySql.List(p));
        Assert.Empty(SecuritySql.List("sqlite"));
    }
}
