using DbStudio.Core.Models;
using DbStudio.Core.Providers;

namespace DbStudio.Providers.Sqlite.Tests;

/// <summary>Single-level providers offer no separate default schema: NOT_SUPPORTED cleanly, nothing tracked.</summary>
public sealed class SqliteSchemaTests(SqliteFixture fixture) : IClassFixture<SqliteFixture>
{
    [Fact]
    public async Task NoSeparateSchema_ChangeIsNotSupported_AndNothingIsTracked()
    {
        await using var session = await fixture.OpenSessionAsync();
        Assert.Equal(SchemaMode.None, session.SchemaMode);
        Assert.Null(session.CurrentSchema);
        Assert.Null(session.SearchPath);
        Assert.Null(await session.RefreshSchemaAsync(CancellationToken.None));
        await Assert.ThrowsAsync<NotSupportedException>(() => session.ChangeSchemaAsync("main", CancellationToken.None));
        Assert.Equal(SessionState.Idle, session.State);
    }
}
