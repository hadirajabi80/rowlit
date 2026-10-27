using DbStudio.Core.LocalHistory;
using DbStudio.Core.Services;
using Microsoft.Data.Sqlite;

namespace DbStudio.Core.Tests.LocalHistory;

/// <summary>Local history of editors (WP-6): snapshots, dedupe, caps, labels, pruning, persistence.</summary>
public sealed class LocalHistoryServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "dbstudio-localhistory", Guid.NewGuid().ToString("N"));

    private LocalHistoryService NewService() => new(new AppPaths(_dir));

    private static SnapshotInput In(string key, string text, string reason = "run", string? label = null, string? title = null) =>
        new(key, text, reason, label, title);

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try { Directory.Delete(_dir, true); } catch (IOException) { }
    }

    [Fact]
    public async Task Add_StoresCompressedTextAndReadsItBack_AcrossInstances()
    {
        var text = "SELECT 'Persian: سلام' AS greeting\n" + string.Concat(Enumerable.Repeat("FROM dual WHERE 1 = 1\n", 200));
        long id;
        using (var svc = NewService())
        {
            var r = await svc.AddAsync(In("t:1", text, "save", title: "Console 1"));
            Assert.True(r.Added);
            id = r.Id;
        }
        using var again = NewService();
        var s = await again.GetAsync(id);
        Assert.Equal(text, s.Text);
        Assert.Equal("save", s.Reason);
        Assert.Equal("Console 1", s.Title);
        Assert.Equal(text.Length, s.Size);
        Assert.True(LocalHistoryService.Compress(text).Length < text.Length / 4);
    }

    [Fact]
    public async Task Add_IdenticalToTheLatestOfTheKey_IsNotStoredTwice_ButTheOtherKeyIsIndependent()
    {
        using var svc = NewService();
        var a = await svc.AddAsync(In("t:1", "select 1"));
        var dup = await svc.AddAsync(In("t:1", "select 1", "close"));
        var other = await svc.AddAsync(In("t:2", "select 1"));
        var changed = await svc.AddAsync(In("t:1", "select 2"));
        var back = await svc.AddAsync(In("t:1", "select 1")); // equal to an older one, not the latest: stored

        Assert.True(a.Added);
        Assert.False(dup.Added);
        Assert.Equal(a.Id, dup.Id);
        Assert.True(other.Added);
        Assert.True(changed.Added);
        Assert.True(back.Added);
        Assert.Equal(3, (await svc.ListAsync(["t:1"], 100, null)).Count);
    }

    [Fact]
    public async Task Add_DuplicateWithALabel_LabelsTheExistingSnapshot()
    {
        using var svc = NewService();
        var a = await svc.AddAsync(In("k", "select 1"));
        var dup = await svc.AddAsync(In("k", "select 1", "manual", "before refactor"));
        Assert.False(dup.Added);
        Assert.Equal("before refactor", (await svc.GetAsync(a.Id)).Label);
    }

    [Fact]
    public async Task List_UnionsKeys_NewestFirst_AndPages()
    {
        using var svc = NewService();
        for (var i = 0; i < 5; i++) await svc.AddAsync(In(i % 2 == 0 ? "t:1" : "f:C:\\a b\\x.sql", $"select {i}"));
        await svc.AddAsync(In("someone else", "select 99"));

        var all = await svc.ListAsync(["t:1", "f:C:\\a b\\x.sql"], 100, null);
        Assert.Equal(5, all.Count);
        Assert.Equal(all.OrderByDescending((x) => x.Id).Select((x) => x.Id), all.Select((x) => x.Id));
        var page = await svc.ListAsync(["t:1", "f:C:\\a b\\x.sql"], 2, all[1].Id);
        Assert.Equal(2, page.Count);
        Assert.Equal(all[2].Id, page[0].Id);
        Assert.DoesNotContain(all, (x) => x.Key == "someone else");
    }

    [Fact]
    public async Task PerKeyCap_KeepsTheNewest_AndNeverTrimsLabelled()
    {
        using var svc = NewService();
        var first = await svc.AddAsync(In("k", "v0", label: "keep me"));
        for (var i = 1; i <= LocalHistoryService.DefaultPerKey + 10; i++) await svc.AddAsync(In("k", $"v{i}"));

        var list = await svc.ListAsync(["k"], LocalHistoryService.MaxListLimit, null);
        Assert.Equal(LocalHistoryService.DefaultPerKey + 1, list.Count); // 200 unlabelled + the labelled one
        Assert.Contains(list, (x) => x.Id == first.Id);
        Assert.Equal($"v{LocalHistoryService.DefaultPerKey + 10}", (await svc.GetAsync(list[0].Id)).Text);
        Assert.DoesNotContain(list, (x) => x.Size == 2 && x.Id != first.Id && x.Id < list[^2].Id); // v1..v9 are gone
    }

    [Fact]
    public async Task Label_SetsAndClears_AndUnknownIdIsFalse()
    {
        using var svc = NewService();
        var a = await svc.AddAsync(In("k", "select 1"));
        Assert.True(await svc.LabelAsync(a.Id, "  v1 release  "));
        Assert.Equal("v1 release", (await svc.GetAsync(a.Id)).Label);
        Assert.True(await svc.LabelAsync(a.Id, "   "));
        Assert.Null((await svc.GetAsync(a.Id)).Label);
        Assert.False(await svc.LabelAsync(999, "x"));
        await Assert.ThrowsAsync<EngineException>(() => svc.LabelAsync(a.Id, new string('x', LocalHistoryService.MaxLabelLength + 1)));
    }

    [Fact]
    public async Task Delete_AndClear()
    {
        using var svc = NewService();
        var a = await svc.AddAsync(In("k", "1"));
        await svc.AddAsync(In("k", "2", label: "named"));
        await svc.AddAsync(In("j", "3"));

        Assert.True(await svc.DeleteAsync(a.Id));
        Assert.False(await svc.DeleteAsync(a.Id));
        Assert.Equal(1, await svc.ClearAsync(["k"]));
        Assert.Empty(await svc.ListAsync(["k"], 10, null));
        Assert.Single(await svc.ListAsync(["j"], 10, null));
        var ex = await Assert.ThrowsAsync<EngineException>(() => svc.GetAsync(a.Id));
        Assert.Equal(404, ex.Status);
    }

    [Fact]
    public async Task Prune_RemovesOldUnlabelled_ButKeepsLabelledAndRecent()
    {
        using var svc = NewService();
        var old = await svc.AddAsync(In("k", "old"), DateTimeOffset.UtcNow.AddDays(-40));
        var oldNamed = await svc.AddAsync(In("k", "old named", label: "milestone"), DateTimeOffset.UtcNow.AddDays(-45));
        var recent = await svc.AddAsync(In("k", "recent"), DateTimeOffset.UtcNow.AddDays(-2));

        var r = await svc.PruneAsync(new PruneRequest(30, null, null));
        Assert.Equal(1, r.Removed);
        var ids = (await svc.ListAsync(["k"], 10, null)).Select((x) => x.Id).ToList();
        Assert.DoesNotContain(old.Id, ids);
        Assert.Contains(oldNamed.Id, ids);
        Assert.Contains(recent.Id, ids);

        // a shorter retention drops the recent one as well
        await svc.PruneAsync(new PruneRequest(1, null, null));
        Assert.DoesNotContain(recent.Id, (await svc.ListAsync(["k"], 10, null)).Select((x) => x.Id));
    }

    [Fact]
    public async Task Prune_TotalSizeCap_DropsOldestFirst()
    {
        using var svc = NewService();
        var rng = new Random(7);
        string Noise() => new(Enumerable.Range(0, 300_000).Select((_) => (char)rng.Next('a', 'z' + 1)).ToArray()); // barely compressible
        var ids = new List<long>();
        for (var i = 0; i < 6; i++) ids.Add((await svc.AddAsync(In("k", Noise()))).Id);

        var r = await svc.PruneAsync(new PruneRequest(null, 1024 * 1024, null));
        Assert.True(r.Removed >= 1);
        Assert.True(r.Bytes <= 1024 * 1024);
        var left = (await svc.ListAsync(["k"], 10, null)).Select((x) => x.Id).ToList();
        Assert.Contains(ids[^1], left);
        Assert.DoesNotContain(ids[0], left);
    }

    [Fact]
    public async Task Prune_PerKeyOverride()
    {
        using var svc = NewService();
        for (var i = 0; i < 6; i++) await svc.AddAsync(In("k", $"v{i}"));
        await svc.PruneAsync(new PruneRequest(null, null, 2));
        Assert.Equal(2, (await svc.ListAsync(["k"], 10, null)).Count);
    }

    [Theory]
    [InlineData(null, "x", "run", "key")]
    [InlineData("", "x", "run", "key")]
    [InlineData("k", null, "run", "text")]
    [InlineData("k", "x", "bogus", "reason")]
    public async Task Add_ValidatesTheBody(string? key, string? text, string reason, string field)
    {
        using var svc = NewService();
        var ex = await Assert.ThrowsAsync<EngineException>(() => svc.AddAsync(new SnapshotInput(key, text, reason, null, null)));
        Assert.Equal(400, ex.Status);
        Assert.Contains(field, System.Text.Json.JsonSerializer.Serialize(ex.Detail));
    }

    [Fact]
    public async Task Add_RejectsHugeText_AndAcceptsEmptyAndUnicode()
    {
        using var svc = NewService();
        await Assert.ThrowsAsync<EngineException>(() => svc.AddAsync(In("k", new string('x', LocalHistoryService.MaxTextChars + 1))));
        var empty = await svc.AddAsync(In("k", ""));
        Assert.True(empty.Added);
        Assert.Equal("", (await svc.GetAsync(empty.Id)).Text);
        var fa = await svc.AddAsync(In("k", "SELECT N'پرس‌وجو' -- 😀"));
        Assert.Equal("SELECT N'پرس‌وجو' -- 😀", (await svc.GetAsync(fa.Id)).Text);
    }

    [Fact]
    public void Module_IsDiscoveredAndMapsTheRoutes()
    {
        var modules = EngineModules.Discover(typeof(LocalHistoryModule).Assembly);
        Assert.Contains(modules, (m) => m is LocalHistoryModule);
    }
}
