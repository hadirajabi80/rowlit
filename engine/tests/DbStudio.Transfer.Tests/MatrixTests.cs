using DbStudio.Core.Transfer;

namespace DbStudio.Transfer.Tests;

/// <summary>The library sample copied between every pair of SQL Server, PostgreSQL, MySQL and SQLite scratch areas.</summary>
public sealed class MatrixTests
{
    public static IEnumerable<object[]> Pairs()
    {
        Kind[] kinds = [Kind.MsSql, Kind.Pg, Kind.MySql, Kind.Sqlite];
        foreach (var s in kinds)
            foreach (var t in kinds)
                yield return [s, t];
    }

    [SkippableTheory]
    [MemberData(nameof(Pairs))]
    public async Task Library_sample_survives_the_copy(Kind source, Kind target)
    {
        Skip.IfNot(Scratch.Available(source) && Scratch.Available(target), "sample server not reachable");
        var env = new TestEnv();
        await using var src = await Scratch.CreateEmptyAsync(env, source);
        await using var dst = await Scratch.CreateEmptyAsync(env, target);
        await src.SeedLibraryAsync();

        var svc = new TransferService(env);
        var spec = new TransferSpec(src.AsSource(), dst.AsTarget(),
            new[] { "authors", "books", "big" }.Select(n => new TransferTableSpec(n)).ToList(),
            new TransferOptions { NameCase = NameCases.Keep, BatchSize = 250 });
        var plan = await svc.PlanAsync(spec, CancellationToken.None);
        Assert.All(plan.Tables, t => Assert.True(t.Error is null, $"{t.SourceName}: {t.Error}"));
        Assert.True(plan.Tables.Select(t => t.SourceName).ToList().IndexOf("authors") < plan.Tables.Select(t => t.SourceName).ToList().IndexOf("books"),
            "parent tables come first");

        var result = await svc.RunAsync(spec, null, CancellationToken.None);
        Assert.True(result.Status == TransferStatus.Ok, Describe(result));
        Assert.Equal(3 + 3 + Scratch.BigRows, result.TotalRows);

        Assert.Equal(Scratch.BigRows.ToString(), Scratch.Norm(Single(await dst.QueryAsync($"SELECT COUNT(*) FROM {dst.Q("big")}"))));
        var expected = await src.QueryAsync($"SELECT id, name, bio, born FROM {src.Q("authors")} ORDER BY id");
        var actual = await dst.QueryAsync($"SELECT id, name, bio, born FROM {dst.Q("authors")} ORDER BY id");
        AssertRows(expected, actual, "authors");
        Assert.StartsWith("O'Brien \\ back\\slash\nnew line", Scratch.Norm(actual[1][1]));

        var cols = "id, author_id, title, price, rating, pages, big, is_published, published_at, cover, ext_id";
        expected = await src.QueryAsync($"SELECT {cols} FROM {src.Q("books")} ORDER BY id");
        actual = await dst.QueryAsync($"SELECT {cols} FROM {dst.Q("books")} ORDER BY id");
        AssertRows(expected, actual, "books");
        Assert.Equal("1", Scratch.Norm(actual[0][7]));
        Assert.Equal("12.5", Scratch.Norm(actual[0][3]));
        Assert.Equal("2026-01-05 10:00:00.123", Scratch.Norm(actual[0][8]));
        Assert.Equal("000102FF", Scratch.Norm(actual[0][9]));
        Assert.Equal("9007199254740993", Scratch.Norm(actual[0][6]));
        Assert.Equal("-9007199254740993", Scratch.Norm(actual[1][6]));
        Assert.Equal("f47ac10b-58cc-4372-a567-0e02b2c3d479", Scratch.Norm(actual[0][10]).ToLowerInvariant());

        // the default of the created column and the key / index structure arrived
        Assert.All(await dst.QueryAsync($"SELECT created FROM {dst.Q("books")}"), r => Assert.NotNull(r[0]));
        var big = await dst.QueryAsync($"SELECT id, payload FROM {dst.Q("big")} ORDER BY id");
        Assert.Equal(Scratch.BigRows, big.Count);
        Assert.Equal("row 777", Scratch.Norm(big[776][1]));

        // the identity continues after the copied values
        await InsertAuthorAsync(dst);
        Assert.Equal("4", Scratch.Norm(Single(await dst.QueryAsync($"SELECT MAX(id) FROM {dst.Q("authors")}"))));
    }

    private static async Task InsertAuthorAsync(Scratch s) => await s.ExecAsync($"INSERT INTO {s.Q("authors")} (name) VALUES ('Zed')");

    private static object? Single(List<object?[]> rows) => rows[0][0];

    private static void AssertRows(List<object?[]> expected, List<object?[]> actual, string table)
    {
        Assert.Equal(expected.Count, actual.Count);
        for (var r = 0; r < expected.Count; r++)
            for (var c = 0; c < expected[r].Length; c++)
                Assert.True(Scratch.Norm(expected[r][c]) == Scratch.Norm(actual[r][c]),
                    $"{table} row {r} column {c}: expected '{Trim(Scratch.Norm(expected[r][c]))}' but was '{Trim(Scratch.Norm(actual[r][c]))}'");
    }

    private static string Trim(string s) => s.Length > 80 ? s[..80] + "…" : s;

    internal static string Describe(TransferResult r) =>
        r.Status + "\n" + string.Join("\n", r.Errors.Select(e => $"{e.Table}/{e.Phase}: {e.Message}\n    {e.Sql}")) + "\n" +
        string.Join("\n", r.Tables.Select(t => $"{t.Name}: {t.Status} {t.Rows} {t.Error}"));
}
