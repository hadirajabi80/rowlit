using System.Text.RegularExpressions;
using DbStudio.Import.Generate;
using DbStudio.Import.Parsing;

namespace DbStudio.Import.Tests.Generate;

public sealed class GeneratorTests
{
    private static readonly DateTime Now = new(2026, 1, 15, 12, 0, 0);

    internal static ColumnContext Ctx(string kind, string name = "c", int? max = null, string type = "x") =>
        new(name, kind, type, max, 18, 2, int.MinValue, int.MaxValue, 1_000_000_000_000_000m);

    internal static IValueGenerator Make(string id, string kind, Dictionary<string, string?>? options = null, long? auto = null, int? max = null) =>
        GeneratorCatalog.Create(id, new GenArgs(options, Ctx(kind, max: max), auto, Now));

    private static List<object?> Take(IValueGenerator g, ulong seed, int n)
    {
        var rng = new Rng(seed);
        return Enumerable.Range(0, n).Select(i => g.Next(rng, i)).ToList();
    }

    [Fact]
    public void Same_seed_same_values_different_seed_different_values()
    {
        foreach (var id in new[] { "email", "full_name", "city", "sentence", "company", "street_address", "uuid" })
        {
            var g = Make(id, id == "uuid" ? Kinds.Text : Kinds.Text);
            var a = Take(g, 42, 30);
            var b = Take(g, 42, 30);
            var c = Take(g, 43, 30);
            Assert.Equal(a, b);
            Assert.NotEqual(a, c);
        }
    }

    [Fact]
    public void Rng_is_uniform_enough_and_stable()
    {
        var r = new Rng(7);
        Assert.Equal(new Rng(7).NextU64(), r.NextU64());
        var buckets = new int[10];
        for (var i = 0; i < 20000; i++) buckets[r.Next(10)]++;
        Assert.All(buckets, b => Assert.InRange(b, 1700, 2300));
        for (var i = 0; i < 1000; i++) Assert.InRange(r.NextLong(-5, 5), -5, 5);
        Assert.Equal(3, r.NextLong(3, 3));
    }

    [Fact]
    public void Numbers_have_the_clr_type_of_the_column_kind()
    {
        Assert.All(Take(Make("int", Kinds.Int, new() { ["min"] = "5", ["max"] = "9" }), 1, 200), v => { Assert.IsType<long>(v); Assert.InRange((long)v!, 5, 9); });
        Assert.All(Take(Make("int", Kinds.Decimal, new() { ["min"] = "5", ["max"] = "9" }), 1, 50), v => Assert.IsType<decimal>(v));
        Assert.All(Take(Make("int", Kinds.Float, new() { ["min"] = "5", ["max"] = "9" }), 1, 50), v => Assert.IsType<double>(v));
        Assert.All(Take(Make("int", Kinds.Text, new() { ["min"] = "5", ["max"] = "9" }), 1, 50), v => Assert.Matches("^[5-9]$", (string)v!));
        var dec = Take(Make("decimal", Kinds.Decimal, new() { ["min"] = "1.5", ["max"] = "2.5", ["decimals"] = "1" }), 3, 300);
        Assert.All(dec, v => { Assert.IsType<decimal>(v); Assert.InRange((decimal)v!, 1.5m, 2.5m); Assert.Equal(Math.Round((decimal)v!, 1), (decimal)v!); });
        Assert.Contains(dec, v => (decimal)v! == 1.5m);
        Assert.Contains(dec, v => (decimal)v! == 2.5m);
    }

    [Fact]
    public void Wrong_ranges_and_options_are_reported_by_name()
    {
        var ex = Assert.Throws<ArgumentException>(() => Make("int", Kinds.Int, new() { ["min"] = "9", ["max"] = "1" }));
        Assert.Contains("below the minimum", ex.Message);
        ex = Assert.Throws<ArgumentException>(() => Make("int", Kinds.Int, new() { ["min"] = "abc" }));
        Assert.Contains("'min'", ex.Message);
        ex = Assert.Throws<ArgumentException>(() => Make("date", Kinds.Date, new() { ["from"] = "2024-05-01", ["to"] = "2024-01-01" }));
        Assert.Contains("before", ex.Message);
        ex = Assert.Throws<ArgumentException>(() => Make("email", Kinds.Int));
        Assert.Contains("cannot fill", ex.Message);
        Assert.Throws<ArgumentException>(() => Make("nope", Kinds.Text));
    }

    [Fact]
    public void Sequence_continues_after_the_auto_start_and_formats_text()
    {
        var g = Make("sequence", Kinds.Int, new() { ["start"] = "auto", ["step"] = "2" }, auto: 101);
        Assert.Equal([101L, 103L, 105L], Take(g, 1, 3).Cast<long>());
        g = Make("sequence", Kinds.Int, new() { ["start"] = "7" }, auto: 101);
        Assert.Equal(7L, Take(g, 1, 1)[0]);
        g = Make("sequence", Kinds.Text, new() { ["start"] = "1", ["prefix"] = "INV-", ["pad"] = "5" });
        Assert.Equal(["INV-00001", "INV-00002"], Take(g, 1, 2).Cast<string>());
        Assert.Equal(1L, Take(Make("sequence", Kinds.BigInt), 1, 1)[0]);
    }

    [Fact]
    public void Pattern_generates_strings_that_match_the_regex()
    {
        foreach (var pattern in new[] { @"[A-Z]{3}-\d{4}", @"(red|green|blue)-\d{2}", @"\a{2,5}@\w+\.(com|org)", @"[a-f0-9]{32}", @"\X{8}", @"A?B+C*" })
        {
            var g = Make("pattern", Kinds.Text, new() { ["pattern"] = pattern });
            foreach (var v in Take(g, 9, 100)) Assert.Matches("^" + pattern.Replace(@"\X", "[0-9A-F]").Replace(@"\a", "[a-z]") + "$", (string)v!);
        }
        Assert.Equal(26.0 * 26 * 26 * 10000, new PatternGenerator(@"[A-Z]{3}\d{4}").Cardinality);
        Assert.Equal(3.0, new PatternGenerator("(a|b|c)").Cardinality);
    }

    [Theory]
    [InlineData("(abc")]
    [InlineData("[abc")]
    [InlineData("a{2")]
    [InlineData("*a")]
    [InlineData("[z-a]")]
    [InlineData("a{5,2}")]
    [InlineData("[^a]")]
    [InlineData("a)")]
    public void Invalid_patterns_are_rejected(string pattern) =>
        Assert.Throws<ArgumentException>(() => Make("pattern", Kinds.Text, new() { ["pattern"] = pattern }));

    [Fact]
    public void Pattern_into_a_number_column_is_validated_up_front()
    {
        var g = Make("pattern", Kinds.Int, new() { ["pattern"] = @"[1-9]\d{4}" });
        Assert.All(Take(g, 1, 20), v => Assert.InRange((long)v!, 10000, 99999));
        Assert.Throws<ArgumentException>(() => Make("pattern", Kinds.Int, new() { ["pattern"] = "[A-Z]{3}" }));
    }

    [Fact]
    public void List_picks_from_values_and_coerces_to_the_column_kind()
    {
        var g = Make("list", Kinds.Text, new() { ["values"] = "new\npaid, partly\nvoid" });
        Assert.All(Take(g, 1, 100), v => Assert.Contains((string)v!, new[] { "new", "paid, partly", "void" }));
        g = Make("list", Kinds.Text, new() { ["values"] = "a,b,c" });
        Assert.Equal(new HashSet<object?> { "a", "b", "c" }, Take(g, 1, 100).ToHashSet());
        g = Make("list", Kinds.Int, new() { ["values"] = "1\n2\n3" });
        Assert.All(Take(g, 1, 30), v => Assert.IsType<long>(v));
        Assert.Throws<ArgumentException>(() => Make("list", Kinds.Int, new() { ["values"] = "1\nx" }));
        Assert.Throws<ArgumentException>(() => Make("list", Kinds.Text, new() { ["values"] = "  " }));
        g = Make("list", Kinds.Bool, new() { ["values"] = "true\nfalse" });
        Assert.All(Take(g, 1, 10), v => Assert.IsType<bool>(v));
    }

    [Fact]
    public void Bool_follows_the_probability_and_kind()
    {
        Assert.All(Take(Make("bool", Kinds.Bool, new() { ["trueP"] = "0" }), 1, 100), v => Assert.Equal(false, v));
        Assert.All(Take(Make("bool", Kinds.Bool, new() { ["trueP"] = "100" }), 1, 100), v => Assert.Equal(true, v));
        var share = Take(Make("bool", Kinds.Bool, new() { ["trueP"] = "80" }), 5, 5000).Count(v => (bool)v!) / 5000.0;
        Assert.InRange(share, 0.76, 0.84);
        Assert.All(Take(Make("bool", Kinds.Int), 1, 20), v => Assert.Contains((long)v!, new long[] { 0, 1 }));
        Assert.Throws<ArgumentException>(() => Make("bool", Kinds.Bool, new() { ["trueP"] = "101" }));
    }

    [Fact]
    public void Dates_stay_in_range_and_match_the_kind()
    {
        var opts = new Dictionary<string, string?> { ["from"] = "2024-03-01", ["to"] = "2024-03-31" };
        Assert.All(Take(Make("date", Kinds.Date, opts), 1, 200), v =>
        {
            var d = (DateTime)v!;
            Assert.Equal(d.Date, d);
            Assert.InRange(d, new DateTime(2024, 3, 1), new DateTime(2024, 3, 31));
        });
        Assert.All(Take(Make("datetime", Kinds.DateTime, opts), 1, 200), v =>
        {
            var d = (DateTime)v!;
            Assert.Equal(0, d.Ticks % TimeSpan.TicksPerSecond);
            Assert.InRange(d, new DateTime(2024, 3, 1), new DateTime(2024, 3, 31));
        });
        Assert.Contains(Take(Make("datetime", Kinds.DateTime, opts), 1, 50), v => ((DateTime)v!).TimeOfDay != TimeSpan.Zero);
        Assert.All(Take(Make("date", Kinds.Text, opts), 1, 20), v => Assert.Matches(@"^2024-03-\d\d$", (string)v!));
        Assert.All(Take(Make("date", Kinds.Date), 1, 50), v => Assert.InRange((DateTime)v!, new DateTime(2020, 1, 1), Now.Date)); // defaults: 2020-01-01 .. today
        Assert.All(Take(Make("time", Kinds.Time, new() { ["from"] = "09:00:00", ["to"] = "09:05:00" }), 1, 50), v => Assert.InRange((TimeSpan)v!, TimeSpan.FromHours(9), new TimeSpan(9, 5, 0)));
    }

    [Fact]
    public void Uuid_binary_and_json_have_the_right_shape()
    {
        var u = Take(Make("uuid", Kinds.Guid), 1, 50);
        Assert.All(u, v => Assert.Equal('4', ((Guid)v!).ToString()[14]));
        Assert.Equal(50, u.Distinct().Count());
        Assert.All(Take(Make("uuid", Kinds.Text), 1, 5), v => Assert.True(Guid.TryParse((string)v!, out _)));
        Assert.All(Take(Make("binary", Kinds.Binary, new() { ["length"] = "20" }), 1, 5), v => Assert.Equal(20, ((byte[])v!).Length));
        Assert.All(Take(Make("binary", Kinds.Binary, new() { ["length"] = "20" }, max: 8), 1, 5), v => Assert.Equal(8, ((byte[])v!).Length));
        Assert.All(Take(Make("json", Kinds.Json), 1, 20), v => System.Text.Json.JsonDocument.Parse((string)v!).Dispose());
    }

    [Fact]
    public void Text_generators_use_the_built_in_lists_only()
    {
        Assert.All(Take(Make("email", Kinds.Text), 1, 200), v => Assert.Matches(@"^[a-z]+([._][a-z]+)?\d*@(mail\.|test\.)?example\.(com|org|net)$", (string)v!));
        Assert.All(Take(Make("phone", Kinds.Text, new() { ["format"] = "+1-###-###-####" }), 1, 50), v => Assert.Matches(@"^\+1-[2-9]\d\d-\d{3}-\d{4}$", (string)v!));
        Assert.All(Take(Make("postal_code", Kinds.Text), 1, 50), v => Assert.Matches(@"^\d{5}$", (string)v!));
        Assert.All(Take(Make("ipv4", Kinds.Text), 1, 50), v => Assert.True(System.Net.IPAddress.TryParse((string)v!, out _)));
        Assert.All(Take(Make("sentence", Kinds.Text), 1, 50), v => Assert.Matches(@"^[A-Z][a-z ]+\.$", (string)v!));
        Assert.All(Take(Make("url", Kinds.Text), 1, 50), v => Assert.StartsWith("https://www.", (string)v!));
        Assert.All(Take(Make("title", Kinds.Text), 1, 50), v => Assert.Matches(@"^([A-Z][a-z]* ?){2,4}$", (string)v!));
    }

    [Fact]
    public void Constant_and_null()
    {
        Assert.All(Take(Make("constant", Kinds.Text, new() { ["value"] = "x" }), 1, 5), v => Assert.Equal("x", v));
        Assert.All(Take(Make("constant", Kinds.Int, new() { ["value"] = "42" }), 1, 5), v => Assert.Equal(42L, v));
        Assert.All(Take(Make("constant", Kinds.Int, new() { ["value"] = "" }), 1, 5), v => Assert.Null(v));
        Assert.All(Take(Make("null", Kinds.Date), 1, 5), v => Assert.Null(v));
    }

    [Fact]
    public void Every_generator_works_with_default_options_for_its_kinds()
    {
        var expected = new Dictionary<string, Type>
        {
            [Kinds.Int] = typeof(long), [Kinds.BigInt] = typeof(long), [Kinds.Decimal] = typeof(decimal), [Kinds.Float] = typeof(double), [Kinds.Bool] = typeof(bool),
            [Kinds.Date] = typeof(DateTime), [Kinds.DateTime] = typeof(DateTime), [Kinds.Time] = typeof(TimeSpan), [Kinds.Guid] = typeof(Guid), [Kinds.Binary] = typeof(byte[]),
            [Kinds.Json] = typeof(string), [Kinds.Text] = typeof(string), [Kinds.Other] = typeof(string),
        };
        foreach (var info in GeneratorCatalog.All)
        {
            if (info.Id is GeneratorCatalog.Skip or GeneratorCatalog.ForeignKey or "null") continue;
            foreach (var kind in info.Kinds)
            {
                // The sample list / pattern are text; constant "" is null.
                if (info.Id is "list" or "pattern" && kind is not (Kinds.Text or Kinds.Other or Kinds.Json)) continue;
                if (info.Id == "constant") continue;
                var g = GeneratorCatalog.Create(info.Id, new GenArgs(GeneratorCatalog.DefaultOptions(info.Id), Ctx(kind), 1, Now));
                foreach (var v in Take(g, 3, 20))
                {
                    Assert.NotNull(v);
                    if (kind == Kinds.Json && info.Id != "json") continue;
                    Assert.True(expected[kind].IsInstanceOfType(v), $"{info.Id} for {kind} returned {v!.GetType().Name}");
                }
            }
        }
    }

    [Fact]
    public void Generator_kinds_are_known_and_listed_once()
    {
        var ids = GeneratorCatalog.All.Select(g => g.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.True(GeneratorCatalog.Supports("email", Kinds.Text));
        Assert.False(GeneratorCatalog.Supports("email", Kinds.Int));
        Assert.True(GeneratorCatalog.Supports("sequence", Kinds.BigInt));
        Assert.Contains(GeneratorCatalog.All, g => g.Id == "foreignKey");
    }

    // ---------------------------------------------------------------- unique

    [Fact]
    public void Unique_int_range_uses_every_value_exactly_once_when_crowded()
    {
        var inner = Make("int", Kinds.Int, new() { ["min"] = "1", ["max"] = "1000" });
        var u = new UniqueGenerator(inner, 1000, "n", "Whole number");
        var values = Take(u, 5, 1000).Cast<long>().ToList();
        Assert.Equal(1000, values.Distinct().Count());
        Assert.Equal(1, values.Min());
        Assert.Equal(1000, values.Max());
        Assert.NotEqual(Enumerable.Range(1, 1000).Select(i => (long)i), values); // shuffled
    }

    [Fact]
    public void Unique_text_retries_until_a_new_value()
    {
        var u = new UniqueGenerator(Make("email", Kinds.Text), 5000, "email", "Email address");
        var v = Take(u, 3, 5000);
        Assert.Equal(5000, v.Distinct().Count());
    }

    [Fact]
    public void Unique_fails_early_when_the_generator_cannot_supply_enough_values()
    {
        var ex = Assert.Throws<GenerateExhaustedException>(() => new UniqueGenerator(Make("int", Kinds.Int, new() { ["min"] = "1", ["max"] = "10" }), 50, "code", "Whole number"));
        Assert.Contains("50", ex.Message);
        Assert.Contains("10", ex.Message);
        Assert.Contains("code", ex.Message);
        Assert.Throws<GenerateExhaustedException>(() => new UniqueGenerator(Make("list", Kinds.Text, new() { ["values"] = "a\nb\nc" }), 4, "c", "List"));
        // Enough on paper (cardinality estimate) but the generator keeps repeating: fails with a message at run time, not a hang.
        var many = new UniqueGenerator(new FuncGen((r, _) => "same", 1000), 10, "dup", "Broken");
        var rng = new Rng(1);
        many.Next(rng, 0);
        var ex2 = Assert.Throws<GenerateExhaustedException>(() => many.Next(rng, 1));
        Assert.Contains("row 2", ex2.Message);
    }

    [Fact]
    public void Unique_allows_many_nulls()
    {
        var inner = new FuncGen((r, row) => row % 2 == 0 ? null : (object)row, 100);
        var u = new UniqueGenerator(inner, 10, "x", "x");
        var rng = new Rng(1);
        for (var i = 0; i < 10; i++) u.Next(rng, i);
    }

    [Fact]
    public void Sparse_permutation_visits_every_index_once()
    {
        var p = new SparsePermutation(500);
        var rng = new Rng(11);
        var seen = new HashSet<long>();
        while (!p.Exhausted) Assert.True(seen.Add(p.Next(rng)));
        Assert.Equal(500, seen.Count);
        Assert.Equal(Enumerable.Range(0, 500).Select(i => (long)i).ToHashSet(), seen);
        Assert.Throws<InvalidOperationException>(() => p.Next(rng));
    }

    [Fact]
    public void Fingerprint_distinguishes_values()
    {
        Assert.NotEqual(Fingerprint.Of("a"), Fingerprint.Of("b"));
        Assert.Equal(Fingerprint.Of("abc"), Fingerprint.Of("abc"));
        Assert.NotEqual(Fingerprint.Of(1L), Fingerprint.Of(2L));
        Assert.Equal(Fingerprint.Of(new byte[] { 1, 2 }), Fingerprint.Of(new byte[] { 1, 2 }));
    }
}
