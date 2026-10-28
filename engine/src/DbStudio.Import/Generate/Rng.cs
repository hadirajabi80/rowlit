namespace DbStudio.Import.Generate;

/// <summary>
/// SplitMix64 pseudo random numbers. Own implementation (not <see cref="Random"/>) so that a seed yields the same data on
/// every runtime version: previews, tests and a re-run with the same seed all agree.
/// </summary>
internal sealed class Rng(ulong seed)
{
    private ulong _state = seed;

    public ulong NextU64()
    {
        unchecked
        {
            _state += 0x9E3779B97F4A7C15UL;
            var z = _state;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 31);
        }
    }

    /// <summary>[0, 1).</summary>
    public double NextDouble() => (NextU64() >> 11) * (1.0 / (1UL << 53));

    /// <summary>Uniform in [min, max] (inclusive).</summary>
    public long NextLong(long min, long max)
    {
        if (max <= min) return min;
        unchecked
        {
            var span = (ulong)max - (ulong)min + 1UL;
            if (span == 0) return (long)NextU64(); // the whole long range
            return (long)((ulong)min + NextU64() % span);
        }
    }

    /// <summary>[0, n).</summary>
    public int Next(int n) => n <= 1 ? 0 : (int)(NextU64() % (ulong)n);

    public bool Chance(double probability) => probability > 0 && NextDouble() < probability;

    public T Pick<T>(IReadOnlyList<T> list) => list[Next(list.Count)];

    /// <summary>A generator for column <paramref name="index"/> that does not depend on the other columns' streams.</summary>
    public static Rng ForStream(ulong seed, int index)
    {
        var r = new Rng(seed ^ (0xD1B54A32D192ED03UL * (ulong)(index + 1)));
        r.NextU64();
        return r;
    }
}

/// <summary>Lazily shuffled permutation of [0, n) (sparse Fisher-Yates): unique values from a dense range without allocating the range.</summary>
internal sealed class SparsePermutation(long n)
{
    private readonly Dictionary<long, long> _swapped = [];
    private long _taken;

    public long Count => n;
    public bool Exhausted => _taken >= n;

    public long Next(Rng rng)
    {
        if (Exhausted) throw new InvalidOperationException("The permutation is exhausted.");
        var j = rng.NextLong(_taken, n - 1);
        var vj = _swapped.TryGetValue(j, out var a) ? a : j;
        var vi = _swapped.TryGetValue(_taken, out var b) ? b : _taken;
        _swapped[j] = vi;
        _swapped.Remove(_taken);
        _taken++;
        return vj;
    }
}
