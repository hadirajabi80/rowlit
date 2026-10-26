using DbStudio.Core.Queries;
using DbStudio.Core.Services;
using DbStudio.Federation.Contracts;
using DbStudio.Federation.Views;

namespace DbStudio.Federation.Tests.WpB;

public sealed class LinkedViewStoreTests : IDisposable
{
    private readonly WpBHarness _h = new();
    public void Dispose() => _h.Dispose();

    private static BuilderModel Model() => BuilderGoldenTests.Load("b-000-seed.json").Model;

    [Fact]
    public void Create_list_update_delete_round_trip()
    {
        var v = _h.Views.Save("l1", "new", new LinkedViewInput("Top customers", "by revenue", "SELECT 1", Model()));
        Assert.StartsWith("q_", v.Id, StringComparison.Ordinal);
        Assert.Equal(("l1", "Top customers", "by revenue", "SELECT 1"), (v.ConnectionId, v.Name, v.Description, v.Sql));
        Assert.NotNull(v.Builder);
        Assert.Equal(2, v.Builder!.Tables.Count);

        // The SQL is an ordinary saved query of the link under the "views" schema (explorer Queries node, Ctrl+P).
        var saved = Assert.Single(_h.Queries.List("l1"));
        Assert.Equal((LinkIds.ViewsSchema, (string?)null, "SELECT 1"), (saved.Schema, saved.Database, saved.Sql));

        // A second store instance reads the builder model back from linked-views.json.
        var other = new LinkedViewStore(new SavedQueryStore(_h.Paths), _h.Paths);
        Assert.Equal("customers", Assert.Single(other.List("l1")).Builder!.Tables[0].Table);

        var updated = _h.Views.Save("l1", v.Id, new LinkedViewInput("Top customers 2", null, "SELECT 2", null));
        Assert.Equal(("Top customers 2", (string?)null, "SELECT 2"), (updated.Name, updated.Description, updated.Sql));
        Assert.Null(updated.Builder);
        Assert.True(updated.UpdatedAt >= updated.CreatedAt);

        _h.Views.Delete("l1", v.Id);
        Assert.Empty(_h.Views.List("l1"));
        Assert.Empty(_h.Queries.List("l1"));
    }

    [Fact]
    public void Errors()
    {
        Assert.Equal(404, Assert.Throws<EngineException>(() => _h.Views.Get("l1", "q_missing")).Status);
        Assert.Equal(404, Assert.Throws<EngineException>(() => _h.Views.Delete("l1", "q_missing")).Status);
        Assert.Equal(404, Assert.Throws<EngineException>(() => _h.Views.Save("l1", "q_missing", new LinkedViewInput("x", null, "SELECT 1", null))).Status);
        Assert.Equal(400, Assert.Throws<EngineException>(() => _h.Views.Save("l1", "new", new LinkedViewInput("x", null, "  ", null))).Status);
        Assert.Equal(400, Assert.Throws<EngineException>(() => _h.Views.Save("l1", "new", null)).Status);
        _h.Views.Save("l1", "new", new LinkedViewInput("Same", null, "SELECT 1", null));
        Assert.Equal(400, Assert.Throws<EngineException>(() => _h.Views.Save("l1", "new", new LinkedViewInput("same", null, "SELECT 2", null))).Status);
        // Another link may reuse the name; a plain saved query in another schema is not a view.
        _h.Views.Save("l2", "new", new LinkedViewInput("Same", null, "SELECT 1", null));
        _h.Queries.Create("l1", new SavedQueryInput(null, "crm", "plain", "SELECT 3", null));
        Assert.Single(_h.Views.List("l1"));
    }

    [Fact]
    public void Views_of_a_deleted_link_go_with_it_and_orphans_are_ignored()
    {
        var a = _h.Views.Save("l1", "new", new LinkedViewInput("a", null, "SELECT 1", Model()));
        _h.Views.Save("l1", "new", new LinkedViewInput("b", null, "SELECT 1", null));
        _h.Views.Save("l2", "new", new LinkedViewInput("c", null, "SELECT 1", null));
        // Deleted from the Queries node: the metadata is ignored, then pruned.
        _h.Queries.Delete("l1", a.Id);
        Assert.Equal(["b"], _h.Views.List("l1").Select(v => v.Name));
        _h.Views.Save("l1", "new", new LinkedViewInput("d", null, "SELECT 1", null));
        Assert.DoesNotContain(a.Id, File.ReadAllText(_h.Views.FilePath), StringComparison.Ordinal);

        Assert.Equal(2, _h.Views.DeleteForLink("l1"));
        Assert.Empty(_h.Views.List("l1"));
        Assert.Single(_h.Views.List("l2"));
    }
}
