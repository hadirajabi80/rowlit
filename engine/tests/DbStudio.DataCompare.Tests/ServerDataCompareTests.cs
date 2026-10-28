using DbStudio.Core.DataCompare;

namespace DbStudio.DataCompare.Tests;

/// <summary>
/// Cross-provider comparisons against the docker sample servers (engine/tests/docker/compose.yml): the "items" sample with
/// the injected differences, sync, then compare again = no difference. Skipped when a server is unreachable or DBSTUDIO_IT=0.
/// </summary>
public sealed class ServerDataCompareTests
{
    public static TheoryData<Kind, Kind> Pairs => new()
    {
        { Kind.Pg, Kind.Pg },
        { Kind.Pg, Kind.MsSql },
        { Kind.MsSql, Kind.Pg },
        { Kind.MySql, Kind.Sqlite },
        { Kind.Sqlite, Kind.MySql },
    };

    [SkippableTheory]
    [MemberData(nameof(Pairs))]
    public async Task Injected_differences_are_found_and_synchronized(Kind source, Kind target)
    {
        Skip.IfNot(Scratch.Available(source), $"{source} is not reachable");
        Skip.IfNot(Scratch.Available(target), $"{target} is not reachable");
        var env = new TestEnv();
        await using var src = await Scratch.CreateAsync(env, source);
        await using var dst = await Scratch.CreateAsync(env, target);
        await src.SeedItemsAsync();
        await dst.SeedItemsAsync();
        await dst.MutateAsync();
        var svc = new DataCompareService(env);
        var request = new DataCompareRequest(src.Side("items"), dst.Side("items"));

        var r = await svc.CompareAsync(request, null, CancellationToken.None);
        Assert.Equal(new DataCompareCounts(592, 5, 3, 4, 0), r.Counts);
        Assert.Equal(DataOrderings.Server, r.Ordering);

        var applied = await svc.ApplyAsync(r.CompareId, null, CancellationToken.None);
        Assert.True(applied.Status == "ok", string.Join("; ", applied.Failures.Select(f => f.Message + " :: " + f.Sql)));
        var again = await svc.CompareAsync(request, null, CancellationToken.None);
        Assert.Equal(new DataCompareCounts(600, 0, 0, 0, 0), again.Counts);
    }

    [SkippableFact]
    public async Task Text_keys_sort_the_same_on_PostgreSQL_and_SQL_Server()
    {
        Skip.IfNot(Scratch.Available(Kind.Pg) && Scratch.Available(Kind.MsSql), "PostgreSQL and SQL Server are needed");
        var env = new TestEnv();
        await using var pg = await Scratch.CreateAsync(env, Kind.Pg);
        await using var ms = await Scratch.CreateAsync(env, Kind.MsSql);
        // mixed case, accents and punctuation: linguistic collations order these differently, binary ones agree
        string[] codes = ["a", "B", "b", "_x", "été", "Z", "z1", "10", "9", "a b", "a-b"];
        await pg.ExecAsync($"CREATE TABLE {pg.Q("k")} (code varchar(20) PRIMARY KEY, v int)",
            $"INSERT INTO {pg.Q("k")} VALUES {string.Join(", ", codes.Select((c, i) => $"('{c}', {i})"))}");
        await ms.ExecAsync($"CREATE TABLE {ms.Q("k")} (code nvarchar(20) COLLATE Latin1_General_CI_AS PRIMARY KEY, v int)",
            $"INSERT INTO {ms.Q("k")} VALUES {string.Join(", ", codes.Where(c => c != "B").Select((c, i) => $"(N'{c}', {(c == "z1" ? 99 : Array.IndexOf(codes, c))})"))}");
        var svc = new DataCompareService(env);
        var r = await svc.CompareAsync(new DataCompareRequest(pg.Side("k"), ms.Side("k")), null, CancellationToken.None);
        Assert.Equal(DataOrderings.Server, r.Ordering);
        Assert.Equal(new DataCompareCounts(codes.Length - 2, 1, 1, 0, 0), r.Counts);
    }
}
