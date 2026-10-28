using DbStudio.Core.DataCompare;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;

namespace DbStudio.DataCompare.Tests;

/// <summary>Key ordering and value equality across the wire forms of different providers.</summary>
public sealed class ComparerTests
{
    private static CanonType T(Dialect d, string type) => TypeMapper.Parse(d, type);

    [Theory]
    [InlineData("int", "integer", ValueFamily.Numeric)]
    [InlineData("decimal(10,2)", "real", ValueFamily.Float)]
    [InlineData("bit", "integer", ValueFamily.Bool)]
    [InlineData("datetime2", "text", ValueFamily.Temporal)]
    [InlineData("uniqueidentifier", "text", ValueFamily.Guid)]
    [InlineData("nvarchar(50)", "text", ValueFamily.Text)]
    [InlineData("varbinary(16)", "blob", ValueFamily.Binary)]
    public void Pick_chooses_the_family_of_a_cross_provider_pair(string tsql, string sqlite, ValueFamily expected) =>
        Assert.Equal(expected, ValueFamilies.Pick(T(Dialect.TSql, tsql), T(Dialect.Sqlite, sqlite)));

    [Fact]
    public void Keys_order_nulls_first_numbers_by_value_and_text_by_code_point()
    {
        Assert.True(KeyComparer.CompareValue(ValueFamily.Numeric, false, null, 1) < 0);
        Assert.Equal(0, KeyComparer.CompareValue(ValueFamily.Numeric, false, null, null));
        Assert.True(KeyComparer.CompareValue(ValueFamily.Numeric, false, 9, "10") < 0);           // decimal wire is a string
        Assert.Equal(0, KeyComparer.CompareValue(ValueFamily.Numeric, false, "12.50", 12.5));
        Assert.True(KeyComparer.CompareValue(ValueFamily.Text, false, "B", "a") < 0);              // binary collation: upper before lower
        Assert.True(KeyComparer.CompareValue(ValueFamily.Text, false, "z", "é") < 0);
        // a supplementary character sorts after U+FFFD in code point order (UTF-16 ordinal says otherwise)
        Assert.True(KeyComparer.CompareValue(ValueFamily.Text, false, "�", "\U0001F600") < 0);
        Assert.True(string.CompareOrdinal("�", "\U0001F600") > 0);
        // CHAR padding is not data
        Assert.Equal(0, KeyComparer.CompareValue(ValueFamily.Text, true, "ab   ", "ab"));
        // GUIDs: SQL Server upper case, PostgreSQL lower case
        Assert.Equal(0, KeyComparer.CompareValue(ValueFamily.Guid, false, "6F9619FF-8B86-D011-B42D-00C04FC964FF", "6f9619ff-8b86-d011-b42d-00c04fc964ff"));
        Assert.True(KeyComparer.CompareValue(ValueFamily.Binary, false, new BinaryValue([1, 2]), new BinaryValue([1, 3])) < 0);
        Assert.True(KeyComparer.CompareValue(ValueFamily.Temporal, false, "2024-01-01 10:00:00", "2024-01-01T09:00:00-02:00") < 0);
    }

    [Fact]
    public void Composite_keys_compare_column_by_column()
    {
        var k = new KeyComparer([ValueFamily.Text, ValueFamily.Numeric], [false, false], [2, 0]);
        Assert.True(k.Compare([1, "x", "a"], [0, "y", "b"]) < 0);
        Assert.True(k.Compare([2, "x", "a"], [1, "y", "a"]) > 0);
        Assert.Equal(0, k.Compare([5L, "x", "a"], ["5", "y", "a"]));
    }

    [Fact]
    public void Values_are_equal_across_wire_forms()
    {
        var v = new ValueComparer(new DataCompareOptions());
        Assert.True(v.AreEqual(ValueFamily.Numeric, false, "12.50", 12.5));
        Assert.True(v.AreEqual(ValueFamily.Numeric, false, 3L, 3));
        Assert.False(v.AreEqual(ValueFamily.Numeric, false, "12.51", "12.5"));
        Assert.True(v.AreEqual(ValueFamily.Bool, false, true, 1L));
        Assert.True(v.AreEqual(ValueFamily.Bool, false, false, "0"));
        Assert.True(v.AreEqual(ValueFamily.Temporal, false, "2024-03-01T10:00:00", "2024-03-01 10:00:00"));
        Assert.True(v.AreEqual(ValueFamily.Temporal, false, "2024-03-01", "2024-03-01T00:00:00"));
        Assert.False(v.AreEqual(ValueFamily.Temporal, false, "2024-03-01T10:00:00.123", "2024-03-01T10:00:00"));
        Assert.True(v.AreEqual(ValueFamily.Guid, false, "6F9619FF-8B86-D011-B42D-00C04FC964FF", "6f9619ff-8b86-d011-b42d-00c04fc964ff"));
        Assert.True(v.AreEqual(ValueFamily.Json, false, "{\"a\": 1, \"b\": [1,2]}", "{\"b\":[1,2],\"a\":1}"));
        Assert.True(v.AreEqual(ValueFamily.Binary, false, new BinaryValue([1, 2, 3]), new BinaryValue([1, 2, 3])));
        Assert.True(v.AreEqual(ValueFamily.Text, true, "ab  ", "ab"));
        Assert.False(v.AreEqual(ValueFamily.Text, false, "ab  ", "ab"));
        Assert.True(v.AreEqual(ValueFamily.Text, false, new TruncatedValue(new string('x', 40_000)), new string('x', 40_000)));
        Assert.False(v.AreEqual(ValueFamily.Text, false, null, ""));
        Assert.True(v.AreEqual(ValueFamily.Float, false, "NaN", double.NaN));
    }

    [Fact]
    public void Options_relax_the_value_comparison()
    {
        var v = new ValueComparer(new DataCompareOptions
        {
            TrimText = true, IgnoreCase = true, EmptyAsNull = true, NumericTolerance = 0.01, TimeToleranceMs = 500,
        });
        Assert.True(v.AreEqual(ValueFamily.Text, false, "  Hello ", "hello"));
        Assert.True(v.AreEqual(ValueFamily.Text, false, "", null));
        Assert.True(v.AreEqual(ValueFamily.Numeric, false, "10.005", "10.01"));
        Assert.False(v.AreEqual(ValueFamily.Numeric, false, "10.00", "10.02"));
        Assert.True(v.AreEqual(ValueFamily.Float, false, 0.1 + 0.2, 0.3));
        Assert.True(v.AreEqual(ValueFamily.Temporal, false, "2024-03-01T10:00:00.4", "2024-03-01T10:00:00"));
        Assert.False(v.AreEqual(ValueFamily.Temporal, false, "2024-03-01T10:00:01", "2024-03-01T10:00:00"));
    }
}
