using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Providers.Conformance;

namespace DbStudio.Providers.SqlServer.Tests;

/// <summary>The session's default schema on SQL Server: read from the server, read-only (no per-session change).</summary>
public sealed class SqlServerSchemaTests(SqlServerFixture fixture) : IClassFixture<SqlServerFixture>
{
    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "SQL Server not available.");

    [Theory]
    [InlineData("USE master", true)]
    [InlineData("use [shop];\nSELECT 1", true)]
    [InlineData("EXECUTE AS USER = 'x'", true)]
    [InlineData("REVERT", true)]
    [InlineData("SELECT * FROM Customers", false)]
    [InlineData("SELECT 'refuse' AS reuse", false)]
    public void MayChangeSchema_OnlyForUseAndImpersonation(string sql, bool expected) =>
        Assert.Equal(expected, SqlServerSession.MayChangeSchema(sql));

    [SkippableFact]
    public async Task OpenSession_ReadsSchemaName_AsReadOnlyMode()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        Assert.Equal(SchemaMode.ReadOnly, session.SchemaMode);
        Assert.Equal("dbo", session.CurrentSchema);
        Assert.Null(session.SearchPath);
        Assert.Equal("dbo", await session.RefreshSchemaAsync(CancellationToken.None));
    }

    [SkippableFact]
    public async Task ChangeSchema_IsNotSupported_WithTheDefaultSchemaExplanation()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var ex = await Assert.ThrowsAsync<NotSupportedException>(() => session.ChangeSchemaAsync("Sales", CancellationToken.None));
        Assert.Contains("default schema", ex.Message);
        Assert.Equal("dbo", session.CurrentSchema);
        Assert.Equal(SessionState.Idle, session.State);
    }

    [SkippableFact]
    public async Task UseDatabase_ReadsTheSchemaOfTheNewDatabase()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = new RecordingSink();
        await session.ExecuteAsync(new ExecuteRequest([new SqlBatch("USE master;", 1, 1)], 10, true, false, "script"), sink, CancellationToken.None);
        Assert.Equal("master", session.CurrentDatabase, StringComparer.OrdinalIgnoreCase);
        Assert.Equal("dbo", session.CurrentSchema); // sa maps to dbo in every database
        await session.ChangeDatabaseAsync("shop", CancellationToken.None);
        Assert.Equal("dbo", session.CurrentSchema);
    }
}
