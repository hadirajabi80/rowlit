using System.Numerics;
using System.Text.Json.Nodes;
using DbStudio.Core.Params;
using DbStudio.Core.Services;
using DbStudio.Providers.Sqlite.Params;
using Microsoft.Data.Sqlite;

namespace DbStudio.Core.Tests.Params;

/// <summary>Big-number parameters: values System.Decimal / long cannot hold are passed on exactly (docs/qa round-mysql 9, round-postgresql 15, round-cassandra C).</summary>
public sealed class ExactDecimalTests
{
    private static QueryParam P(string kind, object value) => new("a", kind, JsonValue.Create(value));

    [Theory]
    [InlineData("12345678901234567890123456789012345.123456789012345678901234567890", "12345678901234567890123456789012345.123456789012345678901234567890")]
    [InlineData("-0.333333333333333333333333333333333333333", "-0.333333333333333333333333333333333333333")]
    [InlineData("1.5E-40", "0.00000000000000000000000000000000000000015")]
    [InlineData("1.5e+40", "15000000000000000000000000000000000000000")]
    [InlineData("NaN", "NaN")]
    [InlineData("-Infinity", "-Infinity")]
    [InlineData("inf", "Infinity")]
    public void Decimal_TooLongForSystemDecimal_IsKeptExactly(string input, string expected)
    {
        var value = Assert.IsType<ExactDecimal>(ParamValues.ToClr(P("decimal", input)));
        Assert.Equal(expected, value.Text);
    }

    [Fact]
    public void Decimal_ThatFits_StaysSystemDecimal()
    {
        Assert.Equal(12.50m, ParamValues.ToClr(P("decimal", "12.50")));
        Assert.Equal(1500m, ParamValues.ToClr(P("decimal", "1.5E+3")));
        Assert.Equal(12345678901234567890.25m, ParamValues.ToClr(P("decimal", "12345678901234567890.25")));
    }

    [Fact]
    public void Decimal_JsonNumberWithManyDigits_IsKeptExactly()
    {
        var p = new QueryParam("a", "decimal", JsonNode.Parse("123456789012345678901234567890.5"));
        Assert.Equal("123456789012345678901234567890.5", Assert.IsType<ExactDecimal>(ParamValues.ToClr(p)).Text);
    }

    [Fact]
    public void Int_AboveTheLongRange_IsAnExactInteger()
    {
        var value = Assert.IsType<ExactDecimal>(ParamValues.ToClr(P("int", "18446744073709551615")));
        Assert.True(value.IsInteger);
        Assert.Equal(BigInteger.Parse("18446744073709551615"), value.ToBigInteger());
        Assert.Equal("1000000000000000000000000000000", Assert.IsType<ExactDecimal>(ParamValues.ToClr(P("int", "1.0E+30"))).Text);
        Assert.Equal(42L, ParamValues.ToClr(P("int", "42")));
    }

    [Theory]
    [InlineData("decimal", "12abc")]
    [InlineData("decimal", "1e")]
    [InlineData("decimal", "1e99999999")]
    [InlineData("int", "1.5")]
    [InlineData("int", "NaN")]
    public void InvalidNumbers_StillFailValidation(string kind, string input)
    {
        var ex = Assert.Throws<EngineException>(() => ParamValues.Validate([P(kind, input)]));
        Assert.Equal(ErrorCodes.Validation, ex.Code);
    }

    [Fact]
    public void Properties()
    {
        Assert.True(ExactDecimal.TryParse("-123.4500", out var x));
        Assert.Equal(new BigInteger(-1234500), x.Unscaled);
        Assert.Equal(4, x.Scale);
        Assert.Equal(7, x.Precision);
        Assert.False(x.IsInteger);
        Assert.True(ExactDecimal.TryParse("7.000", out var whole));
        Assert.True(whole.IsInteger);
        Assert.Equal("7", whole.ToInteger().Text);
        Assert.Equal("0.000", ExactDecimal.TryParse("0.000", out var zero) ? zero.Text : null);
        Assert.Equal("12.3400", ExactDecimal.TryParse("  +00012.3400  ", out var padded) ? padded.Text : null);
        Assert.Equal("-12.3400", string.Format(System.Globalization.CultureInfo.GetCultureInfo("de-DE"), "{0}", ExactDecimal.TryParse("-12.3400", out var de) ? de : null));
    }

    [Fact]
    public void Sqlite_BindsTheExactText()
    {
        using var conn = new SqliteConnection("Data Source=:memory:");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT typeof(:a), :a";
        SqliteParamBinder.Instance.Bind(cmd, [P("decimal", "123456789012345678901234567890.123456789")], new ParamBindCursor());
        using var reader = cmd.ExecuteReader();
        Assert.True(reader.Read());
        Assert.Equal("text", reader.GetString(0));
        Assert.Equal("123456789012345678901234567890.123456789", reader.GetString(1));
    }
}
