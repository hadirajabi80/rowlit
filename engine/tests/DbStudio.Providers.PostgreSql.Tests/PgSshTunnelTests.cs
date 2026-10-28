using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services.Tunnels;
using DbStudio.Providers.Conformance;

namespace DbStudio.Providers.PostgreSql.Tests;

/// <summary>
/// WP-SSH live test: PostgreSQL through a real OpenSSH bastion, the compose services <c>ssh</c> + <c>postgres</c>
/// (<c>docker compose -f engine/tests/docker/compose.yml --profile ssh up -d postgres ssh</c>). Runs when
/// DBSTUDIO_SSH_HOST is set (e.g. localhost); DBSTUDIO_SSH_PORT (12222), DBSTUDIO_SSH_USER / DBSTUDIO_SSH_PASSWORD
/// (rowlit / rowlit), and the database as the bastion sees it: DBSTUDIO_SSH_PG_HOST (postgres) / DBSTUDIO_SSH_PG_PORT (5432).
/// </summary>
public sealed class PgSshTunnelTests
{
    private static string Env(string name, string fallback) => Environment.GetEnvironmentVariable(name) is { Length: > 0 } v ? v : fallback;

    private static ConnectionProfile Profile(string sshPassword)
    {
        var e = new PgBackend.Endpoint(Env("DBSTUDIO_SSH_PG_HOST", "postgres"), int.Parse(Env("DBSTUDIO_SSH_PG_PORT", "5432")), PgBackend.User,
            Env("DBSTUDIO_PG_PASSWORD", PgBackend.DefaultPassword));
        var p = PgBackend.Profile(e, id: "c_it_pg_ssh");
        p.Props[SshFormFields.Enabled] = true;
        p.Props[SshFormFields.Host] = Env("DBSTUDIO_SSH_HOST", "");
        p.Props[SshFormFields.Port] = int.Parse(Env("DBSTUDIO_SSH_PORT", "12222"));
        p.Props[SshFormFields.User] = Env("DBSTUDIO_SSH_USER", "rowlit");
        p.Props[SshFormFields.Password] = sshPassword;
        return p;
    }

    [SkippableFact]
    public async Task Postgres_through_an_openssh_bastion()
    {
        Skip.If(Environment.GetEnvironmentVariable("DBSTUDIO_IT") == "0", "Integration tests disabled (DBSTUDIO_IT=0).");
        Skip.If(string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DBSTUDIO_SSH_HOST")), "DBSTUDIO_SSH_HOST is not set (compose profile \"ssh\").");
        var dir = Directory.CreateTempSubdirectory("rowlit-ssh-it-");
        await using var tunnels = new SshTunnelService(new SshKnownHosts(Path.Combine(dir.FullName, "known.json")), sweepInterval: Timeout.InfiniteTimeSpan);
        var provider = new PostgreSqlProvider();
        var password = Env("DBSTUDIO_PG_PASSWORD", PgBackend.DefaultPassword);

        var test = await TunnelConnectionTest.RunAsync(new DbStudio.Core.Services.RelationalSourceAdapter(provider), tunnels, Profile(Env("DBSTUDIO_SSH_PASSWORD", "rowlit")), password,
            CancellationToken.None, CancellationToken.None);
        Assert.True(test.Ok, test.Error?.Message + " " + test.Error?.Detail);
        Assert.Contains("PostgreSQL", test.ServerInfo!.Version);

        var resolved = await tunnels.ResolveAsync(Profile(Env("DBSTUDIO_SSH_PASSWORD", "rowlit")), CancellationToken.None);
        await using var session = await provider.OpenSessionAsync(resolved, password, new SessionOptions("s_ssh", null, TransactionMode.Auto, false), CancellationToken.None);
        var sink = new RecordingSink();
        var summary = await session.ExecuteAsync(new ExecuteRequest([new SqlBatch("SELECT count(*) FROM customers", 1, 1)], 0, true, false, "script"), sink, CancellationToken.None);
        Assert.Equal(ExecutionStatus.Ok, summary.Status);

        var bad = await TunnelConnectionTest.RunAsync(new DbStudio.Core.Services.RelationalSourceAdapter(provider), tunnels, Profile("wrong-password"), password, CancellationToken.None, CancellationToken.None);
        Assert.Equal("ssh", bad.Hop);
        dir.Delete(true);
    }
}
