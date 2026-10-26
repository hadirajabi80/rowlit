using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Providers.Conformance;

namespace DbStudio.Providers.PostgreSql.Tests;

/// <summary>The session's default schema (search_path) against the seeded shop (public + sales); skipped without Docker.</summary>
public sealed class PgSchemaTests(PgFixture fixture) : IClassFixture<PgFixture>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);

    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "PostgreSQL not available.");

    private static async Task<RecordingSink> RunAsync(IDbSession s, params string[] sql)
    {
        var sink = new RecordingSink();
        await s.ExecuteAsync(new ExecuteRequest(sql.Select((x, i) => new SqlBatch(x, i + 1, 1)).ToList(), 1000, false, false, "script"), sink, CancellationToken.None).WaitAsync(Timeout);
        return sink;
    }

    [Theory]
    [InlineData("sales", "public", "SET search_path TO \"sales\", public")]
    [InlineData("sales", "\"$user\", public", "SET search_path TO \"sales\", \"$user\", public")]
    [InlineData("public", "\"$user\", public", "SET search_path TO \"public\", \"$user\"")]
    [InlineData("My Schema", "public", "SET search_path TO \"My Schema\", public")]
    [InlineData("a\"b", "\"a\"\"b\", public", "SET search_path TO \"a\"\"b\", public")]
    [InlineData("Sales", "sales, public", "SET search_path TO \"Sales\", sales, public")]
    public void BuildSetSearchPath_PutsTheSchemaFirst_AndKeepsTheStartupEntries(string schema, string startup, string expected)
    {
        Assert.Equal(expected, PgSession.BuildSetSearchPath(schema, startup));
    }

    [Fact]
    public void SplitSearchPath_KeepsQuotedCommas()
    {
        Assert.Equal(["\"a,b\"", "public"], PgSession.SplitSearchPath("\"a,b\", public"));
        Assert.Empty(PgSession.SplitSearchPath(""));
    }

    [Theory]
    [InlineData("SET search_path TO sales", true)]
    [InlineData("set search_path = 'a'", true)]
    [InlineData("RESET ALL", true)]
    [InlineData("ROLLBACK", true)]
    [InlineData("SELECT set_config('search_path','sales',false)", true)]
    [InlineData("SELECT * FROM customers", false)]
    [InlineData("INSERT INTO t VALUES (1)", false)]
    public void MayChangeSchema_OnlyForStatementsThatCan(string sql, bool expected) =>
        Assert.Equal(expected, PgSession.MayChangeSchema(sql));

    [SkippableFact]
    public async Task OpenSession_ReadsTheCurrentSchema_AndSearchPath()
    {
        RequireAvailable();
        await using var s = await fixture.OpenSessionAsync();
        Assert.Equal(SchemaMode.Session, s.SchemaMode);
        Assert.Equal("public", s.CurrentSchema);
        Assert.NotNull(s.SearchPath);
        Assert.Contains("public", s.SearchPath!);
    }

    [SkippableFact]
    public async Task ChangeSchema_SetsSearchPath_AndUnqualifiedNamesResolveThere()
    {
        RequireAvailable();
        await using var s = await fixture.OpenSessionAsync();
        await s.ChangeSchemaAsync("sales", CancellationToken.None);
        Assert.Equal("sales", s.CurrentSchema);
        Assert.Equal("sales", s.SearchPath![0]);
        Assert.Contains("public", s.SearchPath!); // the rest of the startup path stays

        // current_schema() on the server agrees
        var sink = await RunAsync(s, "SELECT current_schema()");
        Assert.Equal("sales", Convert.ToString(sink.ResultSets[0].Rows[0][0]));

        await s.ChangeSchemaAsync(null, CancellationToken.None); // reset
        Assert.Equal("public", s.CurrentSchema);
    }

    [SkippableFact]
    public async Task ChangeSchema_UnknownSchema_IsRejected_AndTheSessionKeepsItsPath()
    {
        RequireAvailable();
        await using var s = await fixture.OpenSessionAsync();
        var ex = await Assert.ThrowsAsync<EngineException>(() => s.ChangeSchemaAsync("no_such_schema_xyz", CancellationToken.None));
        Assert.Equal(ErrorCodes.Validation, ex.Code);
        Assert.Equal("public", s.CurrentSchema);
    }

    [SkippableFact]
    public async Task SetSearchPath_InABatch_IsPickedUp_AfterTheBatch()
    {
        RequireAvailable();
        await using var s = await fixture.OpenSessionAsync();
        await RunAsync(s, "SET search_path TO sales, public");
        Assert.Equal("sales", s.CurrentSchema);
        await RunAsync(s, "SET search_path TO public");
        Assert.Equal("public", s.CurrentSchema);
    }

    [SkippableFact]
    public async Task RolledBackSet_RestoresTheSchemaAfterRollback()
    {
        RequireAvailable();
        await using var s = await fixture.OpenSessionAsync(TransactionMode.Manual);
        // a write opens the engine's transaction; SET inside it is undone by the rollback
        await RunAsync(s, "CREATE TEMP TABLE zz_schema_tx (x int)", "SET search_path TO sales, public");
        Assert.True(s.TxOpen);
        Assert.Equal("sales", s.CurrentSchema);
        await s.RollbackAsync(CancellationToken.None);
        Assert.Equal("public", s.CurrentSchema);
    }

    [SkippableFact]
    public async Task RefreshSchema_ReadsWhatTheServerHas()
    {
        RequireAvailable();
        await using var s = await fixture.OpenSessionAsync();
        await s.ChangeSchemaAsync("sales", CancellationToken.None);
        Assert.Equal("sales", await s.RefreshSchemaAsync(CancellationToken.None));
    }
}
