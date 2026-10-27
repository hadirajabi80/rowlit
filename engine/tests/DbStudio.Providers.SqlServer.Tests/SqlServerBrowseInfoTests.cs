using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Providers.Conformance;

namespace DbStudio.Providers.SqlServer.Tests;

/// <summary>
/// Where the columns of a console result come from (the base table, schema and key that make a result editable) and the
/// describe path: no phantom key column, and no session poisoning by a trailing line comment. Skipped without Docker.
/// </summary>
public sealed class SqlServerBrowseInfoTests(SqlServerFixture fixture) : IClassFixture<SqlServerFixture>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);

    private void RequireAvailable() => Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "SQL Server not available.");

    private static async Task<RecordingSink> RunAsync(IDbSession session, params string[] statements)
    {
        var sink = new RecordingSink();
        var line = 1;
        var batches = statements.Select(s => { var b = new SqlBatch(s, line, 1); line += s.Count(c => c == '\n') + 1; return b; }).ToArray();
        await session.ExecuteAsync(new ExecuteRequest(batches, 100, false, false, "script"), sink, CancellationToken.None).WaitAsync(Timeout);
        return sink;
    }

    [SkippableFact]
    public async Task ConsoleSelect_ReportsBaseTable_SchemaAndKey()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = await RunAsync(session, "SELECT * FROM dbo.Customers");
        Assert.Empty(sink.Errors);
        var cols = Assert.Single(sink.ResultSets).Columns;
        Assert.Equal(4, cols.Length);
        Assert.All(cols, c => Assert.Equal(("dbo", "Customers"), (c.Schema, c.Table)));
        Assert.Equal(new[] { "Id" }, cols.Where(c => c.IsKey).Select(c => c.Name));
    }

    [SkippableFact]
    public async Task ConsoleSelect_ComputedColumn_HasNoTable_AndNoHiddenKeyColumnLeaks()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = await RunAsync(session, "SELECT 1 AS one, Name FROM dbo.Customers");
        var rs = Assert.Single(sink.ResultSets);
        Assert.Equal(new[] { "one", "Name" }, rs.Columns.Select(c => c.Name));   // no appended "Id"
        Assert.Null(rs.Columns[0].Table);
        Assert.Equal("Customers", rs.Columns[1].Table);
        Assert.All(rs.Rows, r => Assert.Equal(2, r.Length));
    }

    [SkippableFact]
    public async Task ConsoleSelect_Join_ReportsBothTables()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = await RunAsync(session, "SELECT c.Id AS CustomerId, o.Id AS OrderId FROM dbo.Customers c JOIN dbo.Orders o ON o.CustomerId = c.Id");
        var cols = Assert.Single(sink.ResultSets).Columns;
        Assert.Equal(new[] { "Customers", "Orders" }, cols.Select(c => c.Table));
    }

    [SkippableFact]
    public async Task ConsoleSelect_OfAnotherDatabase_IsNoEditTarget()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = await RunAsync(session,
            "CREATE TABLE tempdb.dbo.qa_browse_xdb (Id INT PRIMARY KEY, V INT)",
            "SELECT * FROM tempdb.dbo.qa_browse_xdb",
            "DROP TABLE tempdb.dbo.qa_browse_xdb");
        Assert.Empty(sink.Errors);
        var cols = Assert.Single(sink.ResultSets).Columns;
        Assert.All(cols, c => Assert.Null(c.Table));
        Assert.All(cols, c => Assert.False(c.IsKey));
    }

    [SkippableFact]
    public async Task ConsoleSelect_WithTrailingLineComment_KeepsSessionClean()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = await RunAsync(session, "SELECT Name FROM dbo.Customers -- trailing comment", "SELECT Name FROM dbo.Customers; SELECT 2 AS two");
        Assert.Empty(sink.Errors);
        Assert.Equal(3, sink.ResultSets.Count);
        Assert.All(sink.ResultSets, rs => Assert.NotEmpty(rs.Rows));
    }

    [SkippableFact]
    public async Task ConsoleSelect_Failing_ReportsTheServersOwnError()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var sink = await RunAsync(session, "SELECT * FROM dbo.NoSuchTableXyz", "SELECT Id FROM dbo.Customers WHERE Id >");
        Assert.Equal(2, sink.Errors.Count);
        Assert.Equal("208", sink.Errors[0].Error.Code);
        Assert.DoesNotContain("SET", sink.Errors[1].Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [SkippableFact]
    public async Task TestConnection_WithMistypedDatabase_FailsAtOnce()
    {
        RequireAvailable();
        var profile = SqlServerBackend.Profile(fixture.Endpoint!, "no_such_database_xyz");
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var result = await fixture.Provider.TestAsync(profile, fixture.Endpoint!.Password, CancellationToken.None).WaitAsync(Timeout);
        Assert.False(result.Ok);
        Assert.Equal(4060, result.Error!.ProviderCode);
        // The driver's default connect retry waits 10 s before it reports a missing database.
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(8), $"Test connection took {sw.Elapsed.TotalSeconds:F1} s.");
    }

    [SkippableFact]
    public async Task Describe_DoesNotAddTheHiddenKeyColumn()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var cols = await ((AdoSessionBase)session).DescribeAsync("SELECT 1 AS one, Name FROM dbo.Customers", null, CancellationToken.None);
        Assert.Equal(new[] { "one", "Name" }, cols.Select(c => c.Name));
    }

    [SkippableFact]
    public async Task Describe_WithTrailingLineComment_DoesNotPoisonTheSession()
    {
        RequireAvailable();
        await using var session = await fixture.OpenSessionAsync();
        var cols = await ((AdoSessionBase)session).DescribeAsync("SELECT Id FROM dbo.Customers -- trailing comment", null, CancellationToken.None);
        Assert.Single(cols);
        var sink = await RunAsync(session, "SELECT Name FROM dbo.Customers");
        Assert.NotEmpty(Assert.Single(sink.ResultSets).Rows);   // FMTONLY would have left it empty
    }
}
