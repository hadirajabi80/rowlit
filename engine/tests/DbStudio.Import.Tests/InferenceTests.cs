using DbStudio.Import.Parsing;

namespace DbStudio.Import.Tests;

public class InferenceTests
{
    private static InferredType Infer(IEnumerable<object?> values, SourceOptions? o = null, bool more = false)
    {
        var p = new ColumnProfiler(new ValueParser(o ?? new SourceOptions()));
        foreach (var v in values) p.Add(v);
        return p.Infer(more);
    }

    [Fact]
    public void Integers_become_int_or_bigint()
    {
        Assert.Equal(Kinds.Int, Infer(["1", "22", "-3", null]).Kind);
        Assert.True(Infer(["1", null]).Nullable);
        Assert.False(Infer(["1", "2"]).Nullable);
        Assert.Equal(Kinds.BigInt, Infer(["1", "3000000000"]).Kind);
        Assert.Equal(Kinds.BigInt, Infer(["1", "5000000000"], more: true).Kind);
        Assert.Equal(Kinds.BigInt, Infer(["150000000"], more: true).Kind);
    }

    [Fact]
    public void Leading_zero_numbers_stay_text()
    {
        var t = Infer(["0912345678", "0935000000"]);
        Assert.Equal(Kinds.Text, t.Kind);
        Assert.Equal(Kinds.Int, Infer(["0", "10"]).Kind);
        Assert.Equal(Kinds.Decimal, Infer(["0.5", "10"]).Kind);
    }

    [Fact]
    public void Decimals_carry_precision_and_scale()
    {
        var t = Infer(["1.5", "123.456", "2"]);
        Assert.Equal(Kinds.Decimal, t.Kind);
        Assert.Equal(3, t.Scale);
        Assert.True(t.Precision >= 6);
        Assert.Equal(Kinds.Float, Infer(["1e5", "2.5"]).Kind);
    }

    [Fact]
    public void Decimal_comma_and_thousands_separators()
    {
        var o = new SourceOptions { DecimalSeparator = ",", ThousandsSeparator = "." };
        var t = Infer(["1.234,50", "10,5"], o);
        Assert.Equal(Kinds.Decimal, t.Kind);
        Assert.Equal(2, t.Scale);
        Assert.Equal(Kinds.Text, Infer(["1.234,50", "10,5"]).Kind);
    }

    [Fact]
    public void Persian_digits_are_numbers()
    {
        Assert.Equal(Kinds.Int, Infer(["۱۲۳", "۴۵"]).Kind);
        Assert.Equal(Kinds.Decimal, Infer(["۱٫۵", "۲"]).Kind);
        Assert.Equal(Kinds.Text, Infer(["۱۲۳", "۴۵"], new SourceOptions { NormalizeDigits = false }).Kind);
    }

    [Fact]
    public void Booleans_dates_times_guids()
    {
        Assert.Equal(Kinds.Bool, Infer(["true", "FALSE", "yes", "no"]).Kind);
        Assert.Equal(Kinds.Text, Infer(["1", "0", "yes"]).Kind);
        Assert.Equal(Kinds.Date, Infer(["2024-01-05", "2023-12-31"]).Kind);
        Assert.Equal(Kinds.DateTime, Infer(["2024-01-05", "2023-12-31 10:20:30"]).Kind);
        Assert.Equal(Kinds.DateTime, Infer(["2024-01-05T10:20:30Z"]).Kind);
        Assert.Equal(Kinds.Date, Infer(["01/31/2024", "12/1/2023"]).Kind);
        Assert.Equal(Kinds.Time, Infer(["10:20", "23:59:59"]).Kind);
        Assert.Equal(Kinds.Guid, Infer(["3f2504e0-4f89-11d3-9a0c-0305e82c3301"]).Kind);
        Assert.Equal(Kinds.Text, Infer(["3/4", "5/6"]).Kind);
    }

    [Fact]
    public void User_date_formats_are_honoured()
    {
        var o = new SourceOptions { DateFormats = ["dd/MM/yyyy"] };
        Assert.Equal(Kinds.Date, Infer(["31/01/2024", "01/12/2023"], o).Kind);
        Assert.Equal(Kinds.Text, Infer(["31/01/2024"]).Kind);
    }

    [Fact]
    public void Typed_values_from_xlsx_and_json()
    {
        Assert.Equal(Kinds.Int, Infer([1L, 2L]).Kind);
        Assert.Equal(Kinds.Decimal, Infer([1L, 2.5m]).Kind);
        Assert.Equal(Kinds.Float, Infer([1.5d]).Kind);
        Assert.Equal(Kinds.Bool, Infer([true, false]).Kind);
        Assert.Equal(Kinds.Date, Infer([new DateTime(2024, 1, 1), new DateTime(2024, 1, 2)]).Kind);
        Assert.Equal(Kinds.DateTime, Infer([new DateTime(2024, 1, 1, 5, 0, 0)]).Kind);
        Assert.Equal(Kinds.Time, Infer([TimeSpan.FromHours(3)]).Kind);
        Assert.Equal(Kinds.Text, Infer([1L, "x"]).Kind);
    }

    [Fact]
    public void Text_length_is_bucketed_and_empty_columns_are_detected()
    {
        Assert.Equal(16, Infer(["abc"]).Length);
        Assert.Equal(64, Infer([new string('x', 40)]).Length);
        Assert.Equal(5000, Infer([new string('x', 5000)]).Length);
        Assert.Equal(Kinds.Empty, Infer([null, ""]).Kind);
        Assert.Equal(Kinds.Text, Infer(["علی", "مریم"]).Kind);
    }
}

public class ConverterTests
{
    private static CellConverter Make(SourceOptions? o = null) => new(new ValueParser(o ?? new SourceOptions()));

    [Fact]
    public void Converts_to_target_kinds()
    {
        var c = Make();
        Assert.Equal(42L, c.Convert("42", Kinds.Int));
        Assert.Equal(42L, c.Convert("042", Kinds.BigInt));
        Assert.Equal(42L, c.Convert(42.0, Kinds.Int));
        Assert.Equal(1.25m, c.Convert("1.25", Kinds.Decimal));
        Assert.Equal(2.5d, c.Convert("2.5", Kinds.Float));
        Assert.Equal(true, c.Convert("Yes", Kinds.Bool));
        Assert.Equal(false, c.Convert(0L, Kinds.Bool));
        Assert.Equal(new DateTime(2024, 1, 31), c.Convert("2024-01-31", Kinds.Date));
        Assert.Equal(new DateTime(2024, 1, 31), c.Convert(new DateTime(2024, 1, 31, 5, 0, 0), Kinds.Date));
        Assert.Equal(new DateTime(2024, 1, 31, 10, 30, 0), c.Convert("2024-01-31 10:30:00", Kinds.DateTime));
        Assert.Equal(TimeSpan.FromMinutes(90), c.Convert("01:30", Kinds.Time));
        Assert.Equal(Guid.Parse("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), c.Convert("3f2504e0-4f89-11d3-9a0c-0305e82c3301", Kinds.Guid));
        Assert.Equal(new byte[] { 0xDE, 0xAD }, c.Convert("0xDEAD", Kinds.Binary));
        Assert.Equal("5", c.Convert(5L, Kinds.Text));
        Assert.Equal("2024-01-02", c.Convert(new DateTime(2024, 1, 2), Kinds.Text));
        Assert.Null(c.Convert(null, Kinds.Int));
    }

    [Fact]
    public void Number_formats_dates_and_persian_digits()
    {
        var c = Make(new SourceOptions { DecimalSeparator = ",", ThousandsSeparator = ".", DateFormats = ["dd/MM/yyyy"] });
        Assert.Equal(1234.5m, c.Convert("1.234,5", Kinds.Decimal));
        Assert.Equal(new DateTime(2024, 3, 9), c.Convert("09/03/2024", Kinds.Date));
        Assert.Equal(123L, Make().Convert("۱۲۳", Kinds.Int));
        Assert.Equal(new DateTime(2024, 3, 9), Make().Convert("۲۰۲۴-۰۳-۰۹", Kinds.Date));
    }

    [Theory]
    [InlineData("abc", Kinds.Int)]
    [InlineData("1.5", Kinds.Int)]
    [InlineData("x", Kinds.Decimal)]
    [InlineData("maybe", Kinds.Bool)]
    [InlineData("31/02/2024", Kinds.Date)]
    [InlineData("nope", Kinds.Guid)]
    [InlineData("25:00", Kinds.Time)]
    public void Invalid_values_throw_a_descriptive_error(string value, string kind)
    {
        var ex = Assert.Throws<ValueConversionException>(() => Make().Convert(value, kind));
        Assert.Contains(value, ex.Message);
    }
}
