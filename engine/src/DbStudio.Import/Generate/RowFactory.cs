using System.Globalization;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;

namespace DbStudio.Import.Generate;

/// <summary>One column the factory fills (skipped columns are not part of the setup).</summary>
internal sealed record ColumnSetup(TargetCol Target, ColumnContext Context, string Generator, IReadOnlyDictionary<string, string?> Options, double NullPercent,
    bool Unique, string? ForeignKey);

/// <summary>The values of a foreign key's parent table (one tuple per sampled parent row, in the order of the key's columns).</summary>
internal sealed record FkSetup(string Name, IReadOnlyList<string> Columns, List<object?[]> Tuples);

/// <summary>Converts values read from the database (int, short, Guid, DateOnly ...) to the CLR type the import writers expect for a column kind.</summary>
internal static class ValueNormalizer
{
    public static object? To(object? v, string kind)
    {
        if (v is null or DBNull) return null;
        try
        {
            switch (kind)
            {
                case Kinds.Int or Kinds.BigInt: return v is long l ? l : Convert.ToInt64(v, CultureInfo.InvariantCulture);
                case Kinds.Decimal: return v is decimal m ? m : Convert.ToDecimal(v, CultureInfo.InvariantCulture);
                case Kinds.Float: return v is double d ? d : Convert.ToDouble(v, CultureInfo.InvariantCulture);
                case Kinds.Bool: return v is bool b ? b : Convert.ToInt64(v, CultureInfo.InvariantCulture) != 0;
                case Kinds.Date or Kinds.DateTime:
                    return v switch
                    {
                        DateTime dt => dt,
                        DateTimeOffset dto => dto.DateTime,
                        DateOnly d2 => d2.ToDateTime(TimeOnly.MinValue),
                        _ => Convert.ToDateTime(v, CultureInfo.InvariantCulture),
                    };
                case Kinds.Time:
                    return v switch { TimeSpan t => t, TimeOnly to => to.ToTimeSpan(), _ => TimeSpan.Parse(Convert.ToString(v, CultureInfo.InvariantCulture)!, CultureInfo.InvariantCulture) };
                case Kinds.Guid: return v is Guid g ? g : Guid.Parse(Convert.ToString(v, CultureInfo.InvariantCulture)!);
                case Kinds.Binary: return v as byte[] ?? throw new InvalidCastException("Not a byte array.");
                default: return v is string s ? s : CellConverter.Text(v);
            }
        }
        catch (Exception ex) when (ex is FormatException or InvalidCastException or OverflowException)
        {
            throw new GenerateExhaustedException($"A parent value ({CellConverter.Text(v)}) does not fit the column type: {ex.Message}");
        }
    }
}

/// <summary>Draws the foreign key values of a row: random parent tuples, or without replacement when the key must be unique.</summary>
internal sealed class FkPool
{
    private readonly FkSetup _setup;
    private readonly SparsePermutation? _perm;
    private readonly Rng _rng;
    private readonly double _nullP;

    public FkPool(FkSetup setup, bool unique, double nullPercent, ulong seed, int stream)
    {
        _setup = setup;
        _rng = Rng.ForStream(seed, 10_000 + stream);
        _nullP = Math.Clamp(nullPercent, 0, 100) / 100.0;
        if (unique && setup.Tuples.Count > 0) _perm = new SparsePermutation(setup.Tuples.Count);
    }

    public string Name => _setup.Name;
    public IReadOnlyList<string> Columns => _setup.Columns;

    /// <summary>The tuple for the next row, or null (the NULL share, or a parent without rows).</summary>
    public object?[]? Pick(long row)
    {
        var roll = _nullP > 0 ? _rng.NextDouble() : 1;
        if (roll < _nullP || _setup.Tuples.Count == 0) return null;
        if (_perm is not null)
        {
            if (_perm.Exhausted)
                throw new GenerateExhaustedException(
                    $"Foreign key {_setup.Name} must be unique but its parent table only has {_setup.Tuples.Count:N0} rows to choose from (row {row + 1:N0}). Generate fewer rows or add parent rows first.");
            return _setup.Tuples[(int)_perm.Next(_rng)];
        }
        return _setup.Tuples[_rng.Next(_setup.Tuples.Count)];
    }
}

/// <summary>
/// Produces the rows: one generator per column (each with its own random stream, so changing one column's generator does
/// not reshuffle the others), foreign key tuples, null shares, distinct values and distinct combinations.
/// </summary>
internal sealed class RowFactory
{
    private const int MaxRowAttempts = 50;

    private sealed class Slot
    {
        public required TargetCol Target;
        public IValueGenerator? Gen;
        public Rng? Stream;
        public FkPool? Pool;
        public int PoolSlot;
        public double NullP;
    }

    private readonly Slot[] _slots;
    private readonly FkPool[] _pools;
    private readonly int[][] _compositeKeys;
    private readonly HashSet<(ulong, ulong)>[] _compositeSeen;

    public IReadOnlyList<TargetCol> Columns { get; }

    private RowFactory(Slot[] slots, FkPool[] pools, int[][] composite)
    {
        _slots = slots;
        _pools = pools;
        _compositeKeys = composite;
        _compositeSeen = composite.Select(_ => new HashSet<(ulong, ulong)>()).ToArray();
        Columns = slots.Select(s => s.Target).ToList();
    }

    /// <param name="compositeKeys">Column-name sets (unique indexes over several columns) whose combinations must be distinct.</param>
    /// <param name="autoStarts">First value of a sequence whose start is "auto", per column name.</param>
    /// <exception cref="ArgumentException">An option is invalid or a generator does not fit its column.</exception>
    /// <exception cref="GenerateExhaustedException">A unique column cannot supply <paramref name="rows"/> distinct values.</exception>
    public static RowFactory Create(IReadOnlyList<ColumnSetup> setups, IReadOnlyList<FkSetup> fks, IReadOnlyList<IReadOnlyList<string>> compositeKeys,
        long rows, long seed, IReadOnlyDictionary<string, long>? autoStarts, DateTime now)
    {
        var useed = unchecked((ulong)seed);
        var pools = new List<FkPool>();
        var slots = new List<Slot>();
        var poolByName = new Dictionary<string, FkPool>(StringComparer.OrdinalIgnoreCase);

        foreach (var fk in fks)
        {
            var members = setups.Where(s => s.ForeignKey is not null && string.Equals(s.ForeignKey, fk.Name, StringComparison.OrdinalIgnoreCase)).ToList();
            if (members.Count == 0) continue;
            var unique = members.Count == 1 && members[0].Unique;
            var nullP = members.All(m => m.Target.Nullable) ? members[0].NullPercent : 0;
            var pool = new FkPool(fk, unique, nullP, useed, pools.Count);
            pools.Add(pool);
            poolByName[fk.Name] = pool;
        }

        for (var i = 0; i < setups.Count; i++)
        {
            var s = setups[i];
            var slot = new Slot { Target = s.Target, NullP = s.Target.Nullable ? Math.Clamp(s.NullPercent, 0, 100) / 100.0 : 0 };
            if (s.Generator.Equals(GeneratorCatalog.ForeignKey, StringComparison.OrdinalIgnoreCase))
            {
                if (s.ForeignKey is null || !poolByName.TryGetValue(s.ForeignKey, out var pool))
                    throw new ArgumentException($"Column '{s.Target.Name}' is not part of a foreign key, so it cannot take parent table values.");
                var idx = pool.Columns.ToList().FindIndex(c => string.Equals(c, s.Target.Name, StringComparison.OrdinalIgnoreCase));
                if (idx < 0) throw new ArgumentException($"Column '{s.Target.Name}' is not part of foreign key {pool.Name}.");
                slot.Pool = pool;
                slot.PoolSlot = idx;
            }
            else
            {
                long? auto = autoStarts is not null && autoStarts.TryGetValue(s.Target.Name, out var a) ? a : null;
                var gen = GeneratorCatalog.Create(s.Generator, new GenArgs(s.Options, s.Context, auto, now));
                var isSequence = s.Generator.Equals("sequence", StringComparison.OrdinalIgnoreCase);
                var label = GeneratorCatalog.All.First(g => g.Id.Equals(s.Generator, StringComparison.OrdinalIgnoreCase)).Label;
                if (s.Unique && !isSequence) gen = new UniqueGenerator(gen, rows, s.Target.Name, label);
                slot.Gen = gen;
                slot.Stream = Rng.ForStream(useed, i);
            }
            slots.Add(slot);
        }

        var names = slots.Select(sl => sl.Target.Name).ToList();
        var composite = new List<int[]>();
        foreach (var key in compositeKeys)
        {
            var idx = key.Select(k => names.FindIndex(n => string.Equals(n, k, StringComparison.OrdinalIgnoreCase))).ToArray();
            if (idx.Length >= 2 && idx.All(i => i >= 0)) composite.Add(idx);
        }
        return new RowFactory(slots.ToArray(), pools.ToArray(), composite.ToArray());
    }

    /// <summary>Row number <paramref name="row"/> (0-based): values in <see cref="Columns"/> order.</summary>
    public object?[] Row(long row)
    {
        for (var attempt = 0; attempt < MaxRowAttempts; attempt++)
        {
            var picks = new object?[_pools.Length][];
            for (var p = 0; p < _pools.Length; p++) picks[p] = _pools[p].Pick(row)!;
            var values = new object?[_slots.Length];
            for (var i = 0; i < _slots.Length; i++)
            {
                var s = _slots[i];
                if (s.Pool is not null)
                {
                    var tuple = picks[Array.IndexOf(_pools, s.Pool)];
                    values[i] = tuple is null ? null : ValueNormalizer.To(tuple[s.PoolSlot], s.Target.Kind);
                    continue;
                }
                var isNull = s.NullP > 0 && s.Stream!.NextDouble() < s.NullP;
                values[i] = isNull ? null : Fit(s.Gen!.Next(s.Stream!, row), s.Target);
            }
            if (IsNewCombination(values)) return values;
        }
        throw new GenerateExhaustedException(
            $"Could not find a new distinct combination for row {row + 1:N0} of a unique index over several columns. Widen the value ranges or lower the row count.");
    }

    private static object? Fit(object? v, TargetCol target)
    {
        if (v is string s && target.MaxLength is > 0 and var max && s.Length > max) return s[..max].TrimEnd();
        return v;
    }

    private bool IsNewCombination(object?[] values)
    {
        if (_compositeKeys.Length == 0) return true;
        var prints = new (ulong, ulong)?[_compositeKeys.Length];
        for (var k = 0; k < _compositeKeys.Length; k++)
        {
            var key = _compositeKeys[k];
            if (key.Any(i => values[i] is null)) continue; // NULLs never collide
            var text = string.Join('\u0001', key.Select(i => Fingerprint.Of(values[i]!)).Select(f => $"{f.Item1:x}.{f.Item2:x}"));
            var print = Fingerprint.Of(text);
            if (_compositeSeen[k].Contains(print)) return false;
            prints[k] = print;
        }
        for (var k = 0; k < prints.Length; k++)
            if (prints[k] is { } p) _compositeSeen[k].Add(p);
        return true;
    }
}
