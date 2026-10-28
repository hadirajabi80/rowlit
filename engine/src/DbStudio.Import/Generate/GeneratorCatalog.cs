using System.Globalization;
using System.Text;
using DbStudio.Import.Parsing;

namespace DbStudio.Import.Generate;

/// <summary>Produces the values of one column (already of the CLR type the import writers expect for the column's kind).</summary>
internal interface IValueGenerator
{
    object? Next(Rng rng, long row);

    /// <summary>How many distinct values it can produce (<see cref="double.PositiveInfinity"/>: practically unlimited).</summary>
    double Cardinality { get; }
}

internal sealed class FuncGen(Func<Rng, long, object?> f, double cardinality = double.PositiveInfinity) : IValueGenerator
{
    public object? Next(Rng rng, long row) => f(rng, row);
    public double Cardinality => cardinality;
}

/// <summary>A dense integer range (the unique wrapper draws from it without replacement when it is crowded).</summary>
internal sealed class IntRangeGen(long min, long max, ColumnContext col) : IValueGenerator
{
    public long Min => min;
    public long Max => max;
    public ColumnContext Col => col;
    public double Cardinality => (double)max - min + 1;
    public object? Next(Rng rng, long row) => col.Num(rng.NextLong(min, max));
}

/// <summary>The target column as the generators see it.</summary>
internal sealed record ColumnContext(string Name, string Kind, string TypeText, int? MaxLength, int Precision, int Scale, long IntMin, long IntMax, decimal DecMax)
{
    private static readonly CellConverter Converter = new(new ValueParser(new SourceOptions()));
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public bool IsNumeric => Kind is Kinds.Int or Kinds.BigInt or Kinds.Decimal or Kinds.Float;
    public bool IsTextual => Kind is Kinds.Text or Kinds.Other;

    public object? Num(long v) => Kind switch
    {
        Kinds.Int or Kinds.BigInt => v,
        Kinds.Decimal => (decimal)v,
        Kinds.Float => (double)v,
        _ => v.ToString(Inv),
    };

    public object? Dec(decimal v) => Kind switch
    {
        Kinds.Int or Kinds.BigInt => (long)Math.Round(v, MidpointRounding.AwayFromZero),
        Kinds.Decimal => v,
        Kinds.Float => (double)v,
        _ => v.ToString("0.############", Inv),
    };

    /// <summary>Converts a text value (list entry, constant) to the column's kind.</summary>
    public object? Coerce(string? s)
    {
        if (s is null) return null;
        if (s.Length == 0 && !IsTextual && Kind != Kinds.Json) return null;
        try
        {
            return Converter.Convert(s, Kind);
        }
        catch (ValueConversionException ex)
        {
            throw new ArgumentException($"'{s}' does not fit column '{Name}' ({TypeText}): {ex.Message}");
        }
    }
}

/// <summary>Typed access to the options of a generator (invalid values throw <see cref="ArgumentException"/> naming the option).</summary>
internal sealed class GenArgs(IReadOnlyDictionary<string, string?>? options, ColumnContext col, long? autoStart, DateTime now)
{
    private readonly IReadOnlyDictionary<string, string?> _options = options is null
        ? new Dictionary<string, string?>()
        : new Dictionary<string, string?>(options, StringComparer.OrdinalIgnoreCase);

    public ColumnContext Col => col;
    public DateTime Now => now;
    /// <summary>First value of a sequence whose start option is "auto" (the table's maximum plus one).</summary>
    public long? AutoStart => autoStart;

    public string? Opt(string key) => _options.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v : null;
    public bool Has(string key) => Opt(key) is not null;
    public string Str(string key, string fallback) => _options.TryGetValue(key, out var v) && v is not null && v.Length > 0 ? v : fallback;

    public long Long(string key, long fallback)
    {
        var s = Opt(key);
        if (s is null) return fallback;
        if (long.TryParse(s.Trim(), NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var v)) return v;
        throw new ArgumentException($"Option '{key}' must be a whole number (got '{s}').");
    }

    public decimal Decimal(string key, decimal fallback)
    {
        var s = Opt(key);
        if (s is null) return fallback;
        if (decimal.TryParse(s.Trim(), NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var v)) return v;
        throw new ArgumentException($"Option '{key}' must be a number (got '{s}').");
    }

    public double Percent(string key, double fallback)
    {
        var v = (double)Decimal(key, (decimal)fallback);
        if (v is < 0 or > 100) throw new ArgumentException($"Option '{key}' must be between 0 and 100.");
        return v;
    }

    public DateTime Date(string key, DateTime fallback)
    {
        var s = Opt(key)?.Trim();
        if (s is null) return fallback;
        if (s.Equals("today", StringComparison.OrdinalIgnoreCase)) return now.Date;
        if (s.Equals("now", StringComparison.OrdinalIgnoreCase)) return now;
        if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d))
            return DateTime.SpecifyKind(d, DateTimeKind.Unspecified);
        throw new ArgumentException($"Option '{key}' must be a date such as 2024-03-15 (got '{s}').");
    }

    public TimeSpan Time(string key, TimeSpan fallback)
    {
        var s = Opt(key)?.Trim();
        if (s is null) return fallback;
        if (TimeSpan.TryParse(s, CultureInfo.InvariantCulture, out var t) && t >= TimeSpan.Zero && t < TimeSpan.FromDays(1)) return t;
        throw new ArgumentException($"Option '{key}' must be a time of day such as 09:30:00 (got '{s}').");
    }

    /// <summary>Entries of a list option: one per line; a single line is split at commas.</summary>
    public List<string> Items(string key)
    {
        var s = Opt(key);
        if (s is null) return [];
        var parts = s.Contains('\n', StringComparison.Ordinal)
            ? s.Replace("\r", "", StringComparison.Ordinal).Split('\n')
            : s.Split(',');
        return parts.Select(p => p.Trim()).Where(p => p.Length > 0).ToList();
    }
}

/// <summary>Thrown when a column cannot produce the requested number of distinct values.</summary>
internal sealed class GenerateExhaustedException(string message) : Exception(message);

/// <summary>
/// The generators the Generate-data dialog offers. Each has an id, the column kinds it can fill, options with defaults and
/// a factory. Texts come from the small built-in lists in <see cref="WordLists"/>.
/// </summary>
public static class GeneratorCatalog
{
    private static readonly string[] Numbers = [Kinds.Int, Kinds.BigInt, Kinds.Decimal, Kinds.Float];
    private static readonly string[] NumbersAndText = [Kinds.Int, Kinds.BigInt, Kinds.Decimal, Kinds.Float, Kinds.Text, Kinds.Other];
    private static readonly string[] TextKinds = [Kinds.Text, Kinds.Other];
    private static readonly string[] AllKinds =
        [Kinds.Int, Kinds.BigInt, Kinds.Decimal, Kinds.Float, Kinds.Bool, Kinds.Date, Kinds.DateTime, Kinds.Time, Kinds.Guid, Kinds.Binary, Kinds.Json, Kinds.Text, Kinds.Other];

    public const string Skip = "skip";
    public const string ForeignKey = "foreignKey";

    internal sealed record Def(string Id, string Label, string Group, string[] Kinds, GeneratorOption[] Options, Func<GenArgs, IValueGenerator>? Create);

    private static GeneratorOption O(string key, string label, string type, string? def = null, string? help = null) => new(key, label, type, def, help);

    private static readonly Def[] Defs =
    [
        new("sequence", "Sequence", "Numbers", NumbersAndText,
            [O("start", "Start at", "number", "auto", "auto = the table's highest value + 1 (1 when truncating)"), O("step", "Step", "number", "1"),
             O("prefix", "Text prefix", "text", null, "text columns only"), O("pad", "Pad to width", "number", null, "text columns only")], Sequence),
        new("int", "Whole number", "Numbers", NumbersAndText, [O("min", "Minimum", "number", "1"), O("max", "Maximum", "number", "100000")], IntRange),
        new("decimal", "Decimal number", "Numbers", NumbersAndText, [O("min", "Minimum", "number", "0"), O("max", "Maximum", "number", "1000"), O("decimals", "Decimals", "number", "2")], DecimalRange),
        new("bool", "Boolean", "Numbers", [Kinds.Bool, Kinds.Int, Kinds.BigInt, Kinds.Text], [O("trueP", "Chance of true (%)", "number", "50")], Bool),
        new("date", "Date", "Dates", [Kinds.Date, Kinds.DateTime, Kinds.Text], [O("from", "From", "date", "2020-01-01"), O("to", "To", "date", "today")], g => DateGen(g, withTime: false)),
        new("datetime", "Date and time", "Dates", [Kinds.DateTime, Kinds.Date, Kinds.Text], [O("from", "From", "datetime", "2020-01-01"), O("to", "To", "datetime", "now")], g => DateGen(g, withTime: true)),
        new("time", "Time of day", "Dates", [Kinds.Time, Kinds.Text], [O("from", "From", "time", "00:00:00"), O("to", "To", "time", "23:59:59")], TimeGen),
        new("first_name", "First name", "People", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.FirstNames), WordLists.FirstNames.Length)),
        new("last_name", "Last name", "People", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.LastNames), WordLists.LastNames.Length)),
        new("full_name", "Full name", "People", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.FirstNames) + " " + r.Pick(WordLists.LastNames), WordLists.FirstNames.Length * (double)WordLists.LastNames.Length)),
        new("username", "User name", "People", TextKinds, [], g => Text(g, (r, _) => Username(r), 1e9)),
        new("email", "Email address", "People", TextKinds, [], g => Text(g, (r, _) => Email(r), 1e9)),
        new("phone", "Phone number", "People", TextKinds, [O("format", "Format (# = digit)", "text", "(###) ###-####")], Phone),
        new("job_title", "Job title", "People", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.JobTitles), WordLists.JobTitles.Length)),
        new("company", "Company", "People", TextKinds, [], g => Text(g, (r, _) => Company(r), 1e5)),
        new("city", "City", "Places", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.Cities), WordLists.Cities.Length)),
        new("country", "Country", "Places", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.Countries), WordLists.Countries.Length)),
        new("street_address", "Street address", "Places", TextKinds, [], g => Text(g, (r, _) => $"{r.NextLong(1, 9999)} {r.Pick(WordLists.Streets)} {r.Pick(WordLists.StreetSuffixes)}", 1e6)),
        new("postal_code", "Postal code", "Places", TextKinds, [], g => Text(g, (r, _) => r.NextLong(0, 99999).ToString("00000", CultureInfo.InvariantCulture), 1e5)),
        new("url", "URL", "Internet", TextKinds, [], g => Text(g, (r, _) => $"https://www.{Slug(r)}.{r.Pick(WordLists.Tlds)}/{r.Pick(WordLists.Lorem)}", 1e6)),
        new("domain", "Domain name", "Internet", TextKinds, [], g => Text(g, (r, _) => $"{Slug(r)}.{r.Pick(WordLists.Tlds)}", 1e4)),
        new("ipv4", "IPv4 address", "Internet", TextKinds, [], g => Text(g, (r, _) => $"{r.NextLong(1, 254)}.{r.NextLong(0, 255)}.{r.NextLong(0, 255)}.{r.NextLong(1, 254)}", 1e9)),
        new("uuid", "UUID", "Internet", [Kinds.Guid, Kinds.Text, Kinds.Other], [], Uuid),
        new("word", "Word", "Text", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.Lorem), WordLists.Lorem.Length)),
        new("title", "Title", "Text", TextKinds, [], g => Text(g, (r, _) => TitleCase(Words(r, (int)r.NextLong(2, 4))), 1e8)),
        new("sentence", "Sentence", "Text", TextKinds, [], g => Text(g, (r, _) => Sentence(r), 1e15)),
        new("paragraph", "Paragraph", "Text", TextKinds, [], g => Text(g, (r, _) => Paragraph(r), 1e30)),
        new("color", "Color name", "Text", TextKinds, [], g => Text(g, (r, _) => r.Pick(WordLists.Colors), WordLists.Colors.Length)),
        new("pattern", "Pattern", "Text", [Kinds.Text, Kinds.Other, Kinds.Int, Kinds.BigInt, Kinds.Decimal, Kinds.Float],
            [O("pattern", "Pattern (regex subset)", "text", @"[A-Z]{3}-\d{4}", @"\d \w \a \A, [A-Z0-9], (a|b), {n,m}, ? * +")], Pattern),
        new("list", "Pick from a list", "Text", AllKinds.Where(k => k != Kinds.Binary).ToArray(), [O("values", "Values (one per line)", "multiline", "one\ntwo\nthree")], List),
        new("json", "JSON object", "Other", [Kinds.Json, Kinds.Text, Kinds.Other], [], Json),
        new("binary", "Random bytes", "Other", [Kinds.Binary], [O("length", "Length (bytes)", "number", "16")], Binary),
        new("constant", "Constant", "Other", AllKinds, [O("value", "Value", "text", "")], Constant),
        new("null", "Always NULL", "Other", AllKinds, [], _ => new FuncGen((_, _) => null, 1)),
        new(ForeignKey, "Parent table value", "Special", AllKinds, [], null),
        new(Skip, "Skip (leave to the database)", "Special", AllKinds, [], null),
    ];

    private static readonly Dictionary<string, Def> ById = Defs.ToDictionary(d => d.Id, StringComparer.OrdinalIgnoreCase);

    /// <summary>The generators for the UI's drop-downs (GET /generate/generators).</summary>
    public static IReadOnlyList<GeneratorInfo> All { get; } =
        Defs.Select(d => new GeneratorInfo(d.Id, d.Label, d.Group, d.Kinds, d.Options)).ToList();

    public static bool Exists(string id) => ById.ContainsKey(id);

    public static bool Supports(string id, string kind) => ById.TryGetValue(id, out var d) && d.Kinds.Contains(kind);

    /// <summary>Default option values of a generator (what the dialog shows when it is chosen).</summary>
    public static Dictionary<string, string?> DefaultOptions(string id) =>
        ById.TryGetValue(id, out var d) ? d.Options.ToDictionary(o => o.Key, o => o.Default) : [];

    internal static IValueGenerator Create(string id, GenArgs args)
    {
        if (!ById.TryGetValue(id, out var def)) throw new ArgumentException($"Unknown generator '{id}'.");
        if (def.Create is null) throw new ArgumentException($"'{id}' is not a value generator.");
        if (!def.Kinds.Contains(args.Col.Kind))
            throw new ArgumentException($"The generator '{def.Label}' cannot fill column '{args.Col.Name}' ({args.Col.TypeText}).");
        return def.Create(args);
    }

    // ---------------------------------------------------------------- numbers

    private static IValueGenerator Sequence(GenArgs g)
    {
        var step = g.Long("step", 1);
        var start = g.Has("start") && !g.Str("start", "auto").Equals("auto", StringComparison.OrdinalIgnoreCase) ? g.Long("start", 1) : g.AutoStart ?? 1;
        var col = g.Col;
        if (col.IsTextual)
        {
            var prefix = g.Str("prefix", "");
            var pad = (int)Math.Clamp(g.Long("pad", 0), 0, 64);
            return new FuncGen((_, row) => prefix + (start + row * step).ToString(CultureInfo.InvariantCulture).PadLeft(pad, '0'));
        }
        return new FuncGen((_, row) => col.Num(start + row * step));
    }

    private static IValueGenerator IntRange(GenArgs g)
    {
        var col = g.Col;
        var min = g.Long("min", Math.Max(1, col.IntMin));
        var max = g.Long("max", Math.Min(100000, col.IntMax));
        if (max < min) throw new ArgumentException($"Maximum ({max}) is below the minimum ({min}).");
        return new IntRangeGen(min, max, col);
    }

    private static IValueGenerator DecimalRange(GenArgs g)
    {
        var col = g.Col;
        var min = g.Decimal("min", 0);
        var max = g.Decimal("max", Math.Min(1000, col.DecMax));
        var decimals = (int)Math.Clamp(g.Long("decimals", Math.Min(col.Scale, 2)), 0, 10);
        if (max < min) throw new ArgumentException($"Maximum ({max}) is below the minimum ({min}).");
        var card = (double)(max - min) * Math.Pow(10, decimals) + 1;
        return new FuncGen((r, _) =>
        {
            var v = min + (decimal)r.NextDouble() * (max - min);
            v = Math.Round(v, decimals, MidpointRounding.AwayFromZero);
            if (v > max) v = max;
            if (v < min) v = min;
            return col.Dec(v);
        }, card);
    }

    private static IValueGenerator Bool(GenArgs g)
    {
        var p = g.Percent("trueP", 50) / 100.0;
        var kind = g.Col.Kind;
        return new FuncGen((r, _) =>
        {
            var b = r.Chance(p);
            return kind switch
            {
                Kinds.Bool => b,
                Kinds.Int or Kinds.BigInt => b ? 1L : 0L,
                _ => b ? "true" : "false",
            };
        }, 2);
    }

    // ---------------------------------------------------------------- dates

    private static IValueGenerator DateGen(GenArgs g, bool withTime)
    {
        var to = g.Date("to", withTime ? g.Now : g.Now.Date);
        var from = g.Date("from", new DateTime(2020, 1, 1));
        if (to < from) throw new ArgumentException($"'To' ({to:yyyy-MM-dd}) is before 'From' ({from:yyyy-MM-dd}).");
        var kind = g.Col.Kind;
        var timePart = withTime && kind != Kinds.Date;
        var spanSeconds = (long)(to - from).TotalSeconds;
        var spanDays = (long)(to.Date - from.Date).TotalDays;
        var card = timePart ? spanSeconds + 1.0 : spanDays + 1.0;
        return new FuncGen((r, _) =>
        {
            var v = timePart ? from.AddSeconds(r.NextLong(0, spanSeconds)) : from.Date.AddDays(r.NextLong(0, spanDays));
            v = DateTime.SpecifyKind(timePart ? new DateTime(v.Ticks - v.Ticks % TimeSpan.TicksPerSecond) : v.Date, DateTimeKind.Unspecified);
            return kind == Kinds.Text ? v.ToString(timePart ? "yyyy-MM-dd HH:mm:ss" : "yyyy-MM-dd", CultureInfo.InvariantCulture) : v;
        }, card);
    }

    private static IValueGenerator TimeGen(GenArgs g)
    {
        var from = g.Time("from", TimeSpan.Zero);
        var to = g.Time("to", new TimeSpan(23, 59, 59));
        if (to < from) throw new ArgumentException("'To' is before 'From'.");
        var span = (long)(to - from).TotalSeconds;
        var text = g.Col.Kind == Kinds.Text;
        return new FuncGen((r, _) =>
        {
            var t = from + TimeSpan.FromSeconds(r.NextLong(0, span));
            t = new TimeSpan(t.Ticks - t.Ticks % TimeSpan.TicksPerSecond);
            return text ? t.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture) : t;
        }, span + 1.0);
    }

    // ---------------------------------------------------------------- text

    private static IValueGenerator Text(GenArgs g, Func<Rng, long, string> f, double card) => new FuncGen((r, row) => f(r, row), card);

    private static string Lower(string s) => new(s.Where(char.IsLetter).Select(char.ToLowerInvariant).ToArray());

    private static string Email(Rng r)
    {
        var f = Lower(r.Pick(WordLists.FirstNames));
        var l = Lower(r.Pick(WordLists.LastNames));
        var sep = r.Pick(new[] { ".", "_", "" });
        var local = r.Next(3) switch { 0 => f + sep + l, 1 => f[..1] + l, _ => l + sep + f };
        if (r.Chance(0.5)) local += r.Next(1000).ToString(CultureInfo.InvariantCulture);
        return local + "@" + r.Pick(WordLists.Domains);
    }

    private static string Username(Rng r)
    {
        var f = Lower(r.Pick(WordLists.FirstNames));
        var l = Lower(r.Pick(WordLists.LastNames));
        return r.Next(3) switch
        {
            0 => f + "_" + l,
            1 => f[..1] + l + r.Next(1000).ToString(CultureInfo.InvariantCulture),
            _ => f + r.Next(10000).ToString(CultureInfo.InvariantCulture),
        };
    }

    private static string Company(Rng r) => $"{r.Pick(WordLists.CompanyPrefixes)} {r.Pick(WordLists.CompanyNouns)} {r.Pick(WordLists.CompanySuffixes)}";

    private static string Slug(Rng r) => (r.Pick(WordLists.CompanyPrefixes) + r.Pick(WordLists.CompanyNouns)).ToLowerInvariant();

    private static IValueGenerator Phone(GenArgs g)
    {
        var format = g.Str("format", "(###) ###-####");
        var hashes = format.Count(c => c == '#');
        return new FuncGen((r, _) =>
        {
            var sb = new StringBuilder(format.Length);
            var first = true;
            foreach (var c in format)
            {
                if (c != '#') { sb.Append(c); continue; }
                sb.Append((char)('0' + (first ? r.Next(8) + 2 : r.Next(10)))); // a leading 2-9
                first = false;
            }
            return sb.ToString();
        }, Math.Pow(10, hashes));
    }

    private static string Words(Rng r, int n)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < n; i++)
        {
            if (i > 0) sb.Append(' ');
            sb.Append(r.Pick(WordLists.Lorem));
        }
        return sb.ToString();
    }

    private static string TitleCase(string s) =>
        string.Join(' ', s.Split(' ').Select(w => w.Length == 0 ? w : char.ToUpperInvariant(w[0]) + w[1..]));

    private static string Sentence(Rng r)
    {
        var s = Words(r, (int)r.NextLong(6, 14));
        return char.ToUpperInvariant(s[0]) + s[1..] + ".";
    }

    private static string Paragraph(Rng r)
    {
        var n = (int)r.NextLong(3, 6);
        var sb = new StringBuilder();
        for (var i = 0; i < n; i++)
        {
            if (i > 0) sb.Append(' ');
            sb.Append(Sentence(r));
        }
        return sb.ToString();
    }

    private static IValueGenerator Uuid(GenArgs g)
    {
        var kind = g.Col.Kind;
        return new FuncGen((r, _) =>
        {
            var bytes = new byte[16];
            BitConverter.GetBytes(r.NextU64()).CopyTo(bytes, 0);
            BitConverter.GetBytes(r.NextU64()).CopyTo(bytes, 8);
            bytes[7] = (byte)((bytes[7] & 0x0F) | 0x40); // version 4
            bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80); // variant 1
            var guid = new Guid(bytes);
            return kind == Kinds.Guid ? guid : guid.ToString();
        });
    }

    private static IValueGenerator Pattern(GenArgs g)
    {
        var gen = new PatternGenerator(g.Str("pattern", @"[A-Z]{3}-\d{4}"));
        var col = g.Col;
        if (col.IsTextual) return gen;
        // Numbers from a pattern (\d{5}): validate one sample now so a bad combination fails before any row is written.
        var probe = (string)gen.Next(new Rng(1), 0)!;
        col.Coerce(probe);
        return new FuncGen((r, row) => col.Coerce((string)gen.Next(r, row)!), gen.Cardinality);
    }

    private static IValueGenerator List(GenArgs g)
    {
        var items = g.Items("values");
        if (items.Count == 0) throw new ArgumentException($"The list for column '{g.Col.Name}' is empty.");
        var values = items.Select(g.Col.Coerce).ToArray();
        var distinct = values.Select(v => v?.ToString()).Distinct().Count();
        return new FuncGen((r, _) => values[r.Next(values.Length)], distinct);
    }

    private static IValueGenerator Constant(GenArgs g)
    {
        var v = g.Col.Coerce(g.Str("value", ""));
        return new FuncGen((_, _) => v, 1);
    }

    private static IValueGenerator Json(GenArgs g)
    {
        return new FuncGen((r, _) =>
        {
            var name = r.Pick(WordLists.FirstNames) + " " + r.Pick(WordLists.LastNames);
            var tags = string.Join(",", Enumerable.Range(0, r.Next(3) + 1).Select(_ => "\"" + r.Pick(WordLists.Lorem) + "\""));
            return string.Create(CultureInfo.InvariantCulture,
                $"{{\"id\":{r.NextLong(1, 99999)},\"name\":\"{name}\",\"active\":{(r.Chance(0.5) ? "true" : "false")},\"score\":{Math.Round(r.NextDouble() * 100, 2)},\"tags\":[{tags}]}}");
        });
    }

    private static IValueGenerator Binary(GenArgs g)
    {
        var length = (int)Math.Clamp(g.Long("length", 16), 1, 65536);
        if (g.Col.MaxLength is { } max && max > 0 && length > max) length = max;
        return new FuncGen((r, _) =>
        {
            var b = new byte[length];
            for (var i = 0; i < length; i += 8)
            {
                var chunk = BitConverter.GetBytes(r.NextU64());
                Array.Copy(chunk, 0, b, i, Math.Min(8, length - i));
            }
            return b;
        });
    }
}

/// <summary>Keeps the values of a column distinct (nulls excepted).</summary>
internal sealed class UniqueGenerator : IValueGenerator
{
    private const int MaxAttempts = 200;
    private readonly IValueGenerator _inner;
    private readonly string _column;
    private readonly string _label;
    private readonly HashSet<(ulong, ulong)> _seen = [];
    private readonly SparsePermutation? _perm;
    private readonly IntRangeGen? _range;

    public UniqueGenerator(IValueGenerator inner, long rows, string column, string label)
    {
        _inner = inner;
        _column = column;
        _label = label;
        if (inner.Cardinality < rows)
            throw new GenerateExhaustedException(
                $"Column '{column}' needs {rows:N0} distinct values but '{label}' can only produce {inner.Cardinality:N0}. Widen the range, choose another generator or lower the row count.");
        if (inner is IntRangeGen r && r.Cardinality <= rows * 4.0 && r.Cardinality < 50_000_000)
        {
            _range = r;
            _perm = new SparsePermutation((long)r.Cardinality);
        }
    }

    public double Cardinality => _inner.Cardinality;

    public object? Next(Rng rng, long row)
    {
        if (_perm is not null && _range is not null) return _range.Col.Num(_range.Min + _perm.Next(rng));
        for (var i = 0; i < MaxAttempts; i++)
        {
            var v = _inner.Next(rng, row);
            if (v is null) return null;
            if (_seen.Add(Fingerprint.Of(v))) return v;
        }
        throw new GenerateExhaustedException(
            $"Column '{_column}': could not find a new distinct value for row {row + 1:N0} with '{_label}' after {MaxAttempts} attempts (it runs out of values). Widen the range or choose another generator.");
    }
}

/// <summary>128-bit fingerprint of a value (distinct-value tracking without keeping the values).</summary>
internal static class Fingerprint
{
    public static (ulong, ulong) Of(object v)
    {
        var text = v switch
        {
            string s => s,
            byte[] b => Convert.ToHexString(b),
            DateTime d => d.Ticks.ToString(CultureInfo.InvariantCulture),
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => v.ToString() ?? "",
        };
        return Of(text);
    }

    public static (ulong, ulong) Of(string s)
    {
        ulong a = 14695981039346656037UL, b = 0x9E3779B97F4A7C15UL;
        unchecked
        {
            foreach (var c in s)
            {
                a = (a ^ c) * 1099511628211UL;
                b = (b ^ c) * 0xFF51AFD7ED558CCDUL;
                b ^= b >> 29;
            }
        }
        return (a, b);
    }
}
