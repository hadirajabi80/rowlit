namespace DbStudio.Core.DataCompare;

/// <summary>Rows of one side in key order (null at the end). Rows of both sides share one column layout.</summary>
public interface IRowSource
{
    ValueTask<object?[]?> NextAsync(CancellationToken ct);
}

/// <summary>A side delivered its rows out of key order (the servers' collations disagree with the comparer).</summary>
public sealed class OrderViolationException(string side)
    : Exception($"The {side} rows did not arrive in key order.")
{
    public string Side { get; } = side;
}

/// <summary>Receives the classified rows of a merge join, in key order.</summary>
public interface IMergeSink
{
    void Equal(object?[] source, object?[] target);
    void Changed(object?[] source, object?[] target, int[] changed);
    void OnlyInSource(object?[] source);
    void OnlyInTarget(object?[] target);
    /// <summary>Rows sharing a key on at least one side: they cannot be matched one to one (never synced).</summary>
    void Duplicate(IReadOnlyList<object?[]> source, IReadOnlyList<object?[]> target);
}

/// <summary>A column whose values are compared.</summary>
public readonly record struct ComparedColumn(int Index, ValueFamily Family, bool Padded);

/// <summary>A row source over a list (in-memory sides and tests).</summary>
public sealed class ListRowSource(IEnumerable<object?[]> rows) : IRowSource
{
    private readonly IEnumerator<object?[]> _e = rows.GetEnumerator();

    public ValueTask<object?[]?> NextAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return ValueTask.FromResult(_e.MoveNext() ? _e.Current : null);
    }
}

/// <summary>
/// Sort-merge join of two key-ordered row streams: one pass, constant memory (only the current key run of each side is
/// held). Rows with the same key on one side form a run; a run longer than one row is a duplicate key. A key that goes
/// backwards raises <see cref="OrderViolationException"/>.
/// </summary>
public static class MergeJoin
{
    public static async Task RunAsync(IRowSource source, IRowSource target, KeyComparer keys, IReadOnlyList<ComparedColumn> compared,
        ValueComparer values, IMergeSink sink, CancellationToken ct)
    {
        var src = new RunReader(source, keys, "source");
        var tgt = new RunReader(target, keys, "target");
        var a = await src.NextRunAsync(ct).ConfigureAwait(false);
        var b = await tgt.NextRunAsync(ct).ConfigureAwait(false);
        var changed = new List<int>();
        while (a is not null || b is not null)
        {
            ct.ThrowIfCancellationRequested();
            var c = a is null ? 1 : b is null ? -1 : keys.Compare(a[0], b[0]);
            if (c < 0)
            {
                if (a!.Count > 1) sink.Duplicate(a, []);
                else sink.OnlyInSource(a[0]);
                a = await src.NextRunAsync(ct).ConfigureAwait(false);
            }
            else if (c > 0)
            {
                if (b!.Count > 1) sink.Duplicate([], b);
                else sink.OnlyInTarget(b[0]);
                b = await tgt.NextRunAsync(ct).ConfigureAwait(false);
            }
            else
            {
                if (a!.Count > 1 || b!.Count > 1) sink.Duplicate(a, b!);
                else
                {
                    changed.Clear();
                    var s = a[0];
                    var t = b[0];
                    foreach (var col in compared)
                        if (!values.AreEqual(col.Family, col.Padded, s[col.Index], t[col.Index])) changed.Add(col.Index);
                    if (changed.Count == 0) sink.Equal(s, t);
                    else sink.Changed(s, t, [.. changed]);
                }
                a = await src.NextRunAsync(ct).ConfigureAwait(false);
                b = await tgt.NextRunAsync(ct).ConfigureAwait(false);
            }
        }
    }

    private sealed class RunReader(IRowSource rows, KeyComparer keys, string side)
    {
        private object?[]? _peek;
        private bool _started;

        public async ValueTask<List<object?[]>?> NextRunAsync(CancellationToken ct)
        {
            if (!_started)
            {
                _started = true;
                _peek = await rows.NextAsync(ct).ConfigureAwait(false);
            }
            if (_peek is null) return null;
            var run = new List<object?[]>(1) { _peek };
            while (true)
            {
                var next = await rows.NextAsync(ct).ConfigureAwait(false);
                if (next is null)
                {
                    _peek = null;
                    break;
                }
                var c = keys.Compare(run[0], next);
                if (c == 0)
                {
                    run.Add(next);
                    continue;
                }
                if (c > 0) throw new OrderViolationException(side);
                _peek = next;
                break;
            }
            return run;
        }
    }
}
