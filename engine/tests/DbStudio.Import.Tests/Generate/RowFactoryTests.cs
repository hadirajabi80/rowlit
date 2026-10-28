using DbStudio.Import.Generate;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;

namespace DbStudio.Import.Tests.Generate;

public sealed class RowFactoryTests
{
    private static readonly DateTime Now = new(2026, 1, 15);

    private static ColumnSetup Col(string name, string kind, string generator, Dictionary<string, string?>? options = null, double nullP = 0, bool unique = false,
        string? fk = null, bool nullable = true, int? max = null)
    {
        var target = new TargetCol(name, kind, "x", max, nullable, false, false);
        return new ColumnSetup(target, GeneratorTests.Ctx(kind, name, max), generator, options ?? [], nullP, unique, fk);
    }

    private static RowFactory Make(IReadOnlyList<ColumnSetup> cols, long rows = 100, long seed = 1, IReadOnlyList<FkSetup>? fks = null,
        IReadOnlyList<IReadOnlyList<string>>? composite = null, Dictionary<string, long>? auto = null) =>
        RowFactory.Create(cols, fks ?? [], composite ?? [], rows, seed, auto, Now);

    [Fact]
    public void Rows_are_deterministic_for_a_seed_and_independent_per_column()
    {
        ColumnSetup[] a = [Col("id", Kinds.Int, "sequence"), Col("email", Kinds.Text, "email"), Col("city", Kinds.Text, "city")];
        ColumnSetup[] b = [Col("id", Kinds.Int, "sequence"), Col("email", Kinds.Text, "email"), Col("city", Kinds.Text, "country")]; // city generator replaced
        var f1 = Make(a);
        var f2 = Make(a);
        var f3 = Make(b);
        for (var i = 0; i < 50; i++)
        {
            var r1 = f1.Row(i);
            Assert.Equal(r1, f2.Row(i));
            var r3 = f3.Row(i);
            Assert.Equal(r1[1], r3[1]); // the other column's stream is untouched
        }
        Assert.NotEqual(Make(a, seed: 2).Row(0)[1], Make(a, seed: 1).Row(0)[1]);
    }

    [Fact]
    public void Null_share_applies_to_nullable_columns_only()
    {
        var f = Make([Col("a", Kinds.Text, "word", nullP: 30), Col("b", Kinds.Text, "word", nullP: 30, nullable: false), Col("c", Kinds.Text, "word", nullP: 100), Col("d", Kinds.Text, "word")], rows: 4000);
        var rows = Enumerable.Range(0, 4000).Select(i => f.Row(i)).ToList();
        Assert.InRange(rows.Count(r => r[0] is null) / 4000.0, 0.26, 0.34);
        Assert.All(rows, r => Assert.NotNull(r[1]));
        Assert.All(rows, r => Assert.Null(r[2]));
        Assert.All(rows, r => Assert.NotNull(r[3]));
    }

    [Fact]
    public void Text_is_cut_to_the_column_length()
    {
        var f = Make([Col("t", Kinds.Text, "paragraph", max: 20)]);
        for (var i = 0; i < 20; i++)
        {
            var v = (string)f.Row(i)[0]!;
            Assert.InRange(v.Length, 1, 20);
            Assert.Equal(v.TrimEnd(), v);
        }
    }

    [Fact]
    public void Unique_columns_never_repeat()
    {
        var f = Make([Col("code", Kinds.Int, "int", new() { ["min"] = "1", ["max"] = "500" }, unique: true), Col("mail", Kinds.Text, "email", unique: true)], rows: 500);
        var rows = Enumerable.Range(0, 500).Select(i => f.Row(i)).ToList();
        Assert.Equal(500, rows.Select(r => r[0]).Distinct().Count());
        Assert.Equal(500, rows.Select(r => r[1]).Distinct().Count());
    }

    [Fact]
    public void Too_few_values_for_a_unique_column_fails_before_any_row()
    {
        var ex = Assert.Throws<GenerateExhaustedException>(() =>
            Make([Col("code", Kinds.Int, "int", new() { ["min"] = "1", ["max"] = "10" }, unique: true)], rows: 100));
        Assert.Contains("code", ex.Message);
    }

    [Fact]
    public void Composite_unique_keys_yield_distinct_combinations_then_stop_gracefully()
    {
        var cols = new[]
        {
            Col("a", Kinds.Int, "int", new() { ["min"] = "1", ["max"] = "3" }),
            Col("b", Kinds.Int, "int", new() { ["min"] = "1", ["max"] = "3" }),
        };
        var f = Make(cols, rows: 9, composite: [["a", "b"]]);
        var combos = Enumerable.Range(0, 9).Select(i => f.Row(i)).Select(r => (r[0], r[1])).ToList();
        Assert.Equal(9, combos.Distinct().Count());
        var ex = Assert.Throws<GenerateExhaustedException>(() => f.Row(9));
        Assert.Contains("row 10", ex.Message);
    }

    [Fact]
    public void Composite_keys_with_a_null_part_never_collide()
    {
        var cols = new[] { Col("a", Kinds.Int, "int", new() { ["min"] = "1", ["max"] = "1" }), Col("b", Kinds.Int, "null") };
        var f = Make(cols, rows: 20, composite: [["a", "b"]]);
        for (var i = 0; i < 20; i++) f.Row(i);
    }

    [Fact]
    public void Foreign_key_values_come_from_the_parent_sample()
    {
        var parents = Enumerable.Range(1, 5).Select(i => new object?[] { i, "P" + i }).ToList();
        var fk = new FkSetup("fk_orders_customer", ["customer_id", "customer_code"], parents);
        var f = Make([Col("id", Kinds.Int, "sequence"), Col("customer_id", Kinds.Int, "foreignKey", fk: "fk_orders_customer"), Col("customer_code", Kinds.Text, "foreignKey", fk: "fk_orders_customer")],
            rows: 300, fks: [fk]);
        var seen = new HashSet<long>();
        for (var i = 0; i < 300; i++)
        {
            var r = f.Row(i);
            var id = Assert.IsType<long>(r[1]); // int from the database becomes the column's long
            Assert.Equal("P" + id, r[2]);       // the tuple is picked as a whole
            seen.Add(id);
        }
        Assert.Equal(5, seen.Count);
    }

    [Fact]
    public void Foreign_key_values_are_converted_to_the_column_type()
    {
        var fk = new FkSetup("fk", ["g"], [[Guid.Parse("11111111-1111-1111-1111-111111111111")], [Guid.Parse("22222222-2222-2222-2222-222222222222")]]);
        var asText = Make([Col("g", Kinds.Text, "foreignKey", fk: "fk")], fks: [fk]);
        Assert.IsType<string>(asText.Row(0)[0]);
        var shorts = new FkSetup("fk", ["n"], [[(short)3], [(short)4]]);
        Assert.IsType<long>(Make([Col("n", Kinds.Int, "foreignKey", fk: "fk")], fks: [shorts]).Row(0)[0]);
        var dates = new FkSetup("fk", ["d"], [[new DateOnly(2020, 1, 2)]]);
        Assert.Equal(new DateTime(2020, 1, 2), Make([Col("d", Kinds.Date, "foreignKey", fk: "fk")], fks: [dates]).Row(0)[0]);
    }

    [Fact]
    public void Unique_foreign_key_uses_each_parent_once_and_stops_when_they_run_out()
    {
        var fk = new FkSetup("fk", ["pid"], Enumerable.Range(1, 3).Select(i => new object?[] { i }).ToList());
        var f = Make([Col("pid", Kinds.Int, "foreignKey", fk: "fk", unique: true)], rows: 3, fks: [fk]);
        var ids = Enumerable.Range(0, 3).Select(i => f.Row(i)[0]).ToList();
        Assert.Equal(3, ids.Distinct().Count());
        var ex = Assert.Throws<GenerateExhaustedException>(() => f.Row(3));
        Assert.Contains("parent table only has 3", ex.Message);
    }

    [Fact]
    public void Foreign_key_without_parent_rows_gives_null()
    {
        var fk = new FkSetup("fk", ["pid"], []);
        var f = Make([Col("pid", Kinds.Int, "foreignKey", fk: "fk")], fks: [fk]);
        Assert.Null(f.Row(0)[0]);
    }

    [Fact]
    public void Foreign_key_null_share()
    {
        var fk = new FkSetup("fk", ["pid"], Enumerable.Range(1, 3).Select(i => new object?[] { i }).ToList());
        var f = Make([Col("pid", Kinds.Int, "foreignKey", fk: "fk", nullP: 50)], rows: 2000, fks: [fk]);
        var share = Enumerable.Range(0, 2000).Count(i => f.Row(i)[0] is null) / 2000.0;
        Assert.InRange(share, 0.44, 0.56);
    }

    [Fact]
    public void Foreign_key_generator_on_a_column_without_a_key_is_an_error()
    {
        Assert.Throws<ArgumentException>(() => Make([Col("x", Kinds.Int, "foreignKey")]));
    }

    [Fact]
    public void Sequence_uses_the_auto_start()
    {
        var f = Make([Col("id", Kinds.Int, "sequence", new() { ["start"] = "auto" })], auto: new() { ["id"] = 501 });
        Assert.Equal([501L, 502L, 503L], new[] { 0, 1, 2 }.Select(i => (long)f.Row(i)[0]!));
    }

    [Fact]
    public void Value_normalizer_converts_driver_values()
    {
        Assert.Equal(5L, ValueNormalizer.To((short)5, Kinds.Int));
        Assert.Equal(5m, ValueNormalizer.To(5, Kinds.Decimal));
        Assert.Equal(true, ValueNormalizer.To(1, Kinds.Bool));
        Assert.Equal("7", ValueNormalizer.To(7, Kinds.Text));
        Assert.Equal(new TimeSpan(1, 2, 3), ValueNormalizer.To(new TimeOnly(1, 2, 3), Kinds.Time));
        Assert.Null(ValueNormalizer.To(DBNull.Value, Kinds.Int));
        Assert.Throws<GenerateExhaustedException>(() => ValueNormalizer.To("abc", Kinds.Guid));
    }
}
