using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Providers.Conformance;

namespace DbStudio.Providers.Oracle.Tests;

/// <summary>The session's default schema on Oracle is its CURRENT_SCHEMA (the same value as CurrentDatabase).</summary>
public sealed class OracleSchemaTests(OracleFixture fixture) : IClassFixture<OracleFixture>
{
    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "Oracle not available.");

    [SkippableFact]
    public async Task CurrentSchema_MirrorsTheCurrentSchema_AndChangeSchemaSetsIt()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        Assert.Equal(SchemaMode.Session, session.SchemaMode);
        Assert.Equal("SHOP", session.CurrentSchema);
        Assert.Equal(session.CurrentDatabase, session.CurrentSchema);
        Assert.Null(session.SearchPath);

        await session.ChangeSchemaAsync("SYSTEM", CancellationToken.None);
        Assert.Equal("SYSTEM", session.CurrentSchema);
        Assert.Equal("SYSTEM", session.CurrentDatabase);
        Assert.Equal("SYSTEM", await session.RefreshSchemaAsync(CancellationToken.None));

        await session.ChangeSchemaAsync(null, CancellationToken.None); // back to the login's own schema
        Assert.Equal("SHOP", session.CurrentSchema);
        Assert.Equal(SessionState.Idle, session.State);
    }

    [SkippableFact]
    public async Task AlterSessionInABatch_UpdatesTheSchema()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = new RecordingSink();
        await session.ExecuteAsync(new ExecuteRequest([new SqlBatch("ALTER SESSION SET CURRENT_SCHEMA = SYSTEM", 1, 1)], 10, true, false, "script"), sink, CancellationToken.None);
        Assert.Equal("SYSTEM", session.CurrentSchema);
    }
}
