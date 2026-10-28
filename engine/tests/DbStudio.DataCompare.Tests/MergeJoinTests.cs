using DbStudio.Core.DataCompare;

namespace DbStudio.DataCompare.Tests;

/// <summary>The sort-merge join on in-memory sides: classes, composite keys, NULL keys, duplicates, order violations.</summary>
public sealed class MergeJoinTests
{
    private sealed class Recorder : IMergeSink
    {
        public List<string> Events { get; } = [];
        public void Equal(object?[] source, object?[] target) => Events.Add($"= {Key(source)}");
        public void Changed(object?[] source, object?[] target, int[] changed) => Events.Add($"~ {Key(source)} [{string.Join(",", changed)}]");
        public void OnlyInSource(object?[] source) => Events.Add($"< {Key(source)}");
        public void OnlyInTarget(object?[] target) => Events.Add($"> {Key(target)}");
        public void Duplicate(IReadOnlyList<object?[]> source, IReadOnlyList<object?[]> target) =>
            Events.Add($"! {Key(source.Count > 0 ? source[0] : target[0])} {source.Count}/{target.Count}");
        private static string Key(object?[] r) => r[0]?.ToString() ?? "null";
    }

    private static async Task<List<string>> Run(IEnumerable<object?[]> src, IEnumerable<object?[]> tgt, KeyComparer? keys = null)
    {
        keys ??= new KeyComparer([ValueFamily.Numeric], [false], [0]);
        var rec = new Recorder();
        await MergeJoin.RunAsync(new ListRowSource(src), new ListRowSource(tgt), keys,
            [new ComparedColumn(1, ValueFamily.Text, false)], new ValueComparer(new DataCompareOptions()), rec, CancellationToken.None);
        return rec.Events;
    }

    [Fact]
    public async Task Classifies_equal_changed_and_one_sided_rows_in_key_order()
    {
        var events = await Run(
            [[1, "a"], [2, "b"], [4, "d"], [6, "f"]],
            [[1, "a"], [2, "B"], [3, "c"], [6, "f"], [7, "g"]]);
        Assert.Equal(["= 1", "~ 2 [1]", "> 3", "< 4", "= 6", "> 7"], events);
    }

    [Fact]
    public async Task Empty_sides_are_all_one_sided()
    {
        Assert.Equal(["< 1", "< 2"], await Run([[1, "a"], [2, "b"]], []));
        Assert.Equal(["> 5"], await Run([], [[5, "x"]]));
        Assert.Empty(await Run([], []));
    }

    [Fact]
    public async Task Null_keys_sort_first_and_match_each_other()
    {
        var events = await Run([[null, "a"], [1, "b"]], [[null, "z"], [1, "b"]]);
        Assert.Equal(["~ null [1]", "= 1"], events);
    }

    [Fact]
    public async Task Composite_keys_match_on_every_column()
    {
        var keys = new KeyComparer([ValueFamily.Numeric, ValueFamily.Text], [false, false], [0, 2]);
        var rec = new Recorder();
        await MergeJoin.RunAsync(
            new ListRowSource([[1, "v", "a"], [1, "v", "b"], [2, "v", "a"]]),
            new ListRowSource([[1, "v", "b"], [2, "w", "a"], [2, "v", "c"]]),
            keys, [new ComparedColumn(1, ValueFamily.Text, false)], new ValueComparer(new DataCompareOptions()), rec, CancellationToken.None);
        Assert.Equal(["< 1", "= 1", "~ 2 [1]", "> 2"], rec.Events);
    }

    [Fact]
    public async Task Duplicate_keys_are_reported_and_not_matched()
    {
        var events = await Run(
            [[1, "a"], [2, "b"], [2, "b2"], [3, "c"]],
            [[1, "a"], [2, "b"], [3, "c"], [3, "c2"], [4, "d"], [4, "d2"]]);
        Assert.Equal(["= 1", "! 2 2/1", "! 3 1/2", "! 4 0/2"], events);
    }

    [Fact]
    public async Task A_key_going_backwards_is_an_order_violation()
    {
        var ex = await Assert.ThrowsAsync<OrderViolationException>(() => Run([[1, "a"], [3, "c"], [2, "b"]], [[1, "a"], [2, "b"], [3, "c"]]));
        Assert.Equal("source", ex.Side);
        var ex2 = await Assert.ThrowsAsync<OrderViolationException>(() => Run([[1, "a"]], [["b", "x"], ["a", "y"]],
            new KeyComparer([ValueFamily.Text], [false], [0])));
        Assert.Equal("target", ex2.Side);
    }
}
