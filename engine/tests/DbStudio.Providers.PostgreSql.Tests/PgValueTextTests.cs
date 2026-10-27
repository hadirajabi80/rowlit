using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Providers.Conformance;

namespace DbStudio.Providers.PostgreSql.Tests;

/// <summary>PgBinaryText without a server: numeric digits, civil dates (BC, beyond 9999, infinity), time of day.</summary>
public sealed class PgBinaryTextUnitTests
{
    private static byte[] NumericBytes(short weight, ushort sign, short dscale, params short[] digits)
    {
        var bytes = new List<byte>();
        void Short(short v) { bytes.Add((byte)(v >> 8)); bytes.Add((byte)v); }
        Short((short)digits.Length);
        Short(weight);
        Short((short)sign);
        Short(dscale);
        foreach (var d in digits) Short(d);
        return bytes.ToArray();
    }

    [Theory]
    [InlineData("12345.678", 1, 0, 3, new short[] { 1, 2345, 6780 })]
    [InlineData("-0.0001", -1, 0x4000, 4, new short[] { 1 })]
    [InlineData("0.00", 0, 0, 2, new short[0])]
    [InlineData("100000000", 2, 0, 0, new short[] { 1 })]
    [InlineData("123456789012345678901234567890.123456789", 7, 0, 9, new short[] { 12, 3456, 7890, 1234, 5678, 9012, 3456, 7890, 1234, 5678, 9000 })]
    public void Numeric_IsExact(string expected, short weight, int sign, short dscale, short[] digits) =>
        Assert.Equal(expected, PgBinaryText.Numeric(NumericBytes(weight, (ushort)sign, dscale, digits)));

    [Theory]
    [InlineData(0xC000, "NaN")]
    [InlineData(0xD000, "Infinity")]
    [InlineData(0xF000, "-Infinity")]
    public void Numeric_SpecialValues(int sign, string expected) =>
        Assert.Equal(expected, PgBinaryText.Numeric(NumericBytes(0, (ushort)sign, 0)));

    [Theory]
    [InlineData(0, "2000-01-01")]
    [InlineData(-1, "1999-12-31")]
    [InlineData(366, "2001-01-01")]
    [InlineData(int.MaxValue, "infinity")]
    [InlineData(int.MinValue, "-infinity")]
    [InlineData(-730119, "0001-01-01")]
    [InlineData(-730120, "0001-12-31 BC")]
    public void Date_UsesTheProlepticGregorianCalendar(int days, string expected) => Assert.Equal(expected, PgBinaryText.Date(days));

    [Theory]
    [InlineData(0L, false, "2000-01-01 00:00:00")]
    [InlineData(1_500_000L, false, "2000-01-01 00:00:01.5")]
    [InlineData(-1L, false, "1999-12-31 23:59:59.999999")]
    [InlineData(0L, true, "2000-01-01 00:00:00+00")]
    [InlineData(long.MaxValue, true, "infinity")]
    [InlineData(long.MinValue, false, "-infinity")]
    public void Timestamp_Text(long micros, bool withZone, string expected) => Assert.Equal(expected, PgBinaryText.Timestamp(micros, withZone));

    [Theory]
    [InlineData(86_400_000_000L, "24:00:00")]
    [InlineData(3_723_000_000L, "01:02:03")]
    [InlineData(45_000_500_000L, "12:30:00.5")]
    public void TimeOfDay_AllowsTwentyFourHours(long micros, string expected) => Assert.Equal(expected, PgBinaryText.TimeOfDay(micros));
}

/// <summary>
/// Every wire value that Npgsql's CLR mapping loses or cannot read must come out as PostgreSQL's own text
/// (<c>expr::text</c>): arrays with NULL elements, composites, records, numerics beyond decimal, infinite and
/// out-of-range dates, inet masks, MAC addresses, ranges.
/// </summary>
public sealed class PgValueTextTests : IClassFixture<PgFixture>
{
    private readonly PgFixture fixture;

    public PgValueTextTests(PgFixture fixture)
    {
        this.fixture = fixture;
        // Npgsql loads the type catalog once per connection string: a distinct application name makes these sessions see
        // the types the fixture seed created after the first connection of the assembly.
        fixture.Profile?.Props.TryAdd("applicationName", "pg-value-text-tests");
    }

    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(60);

    public static IEnumerable<object[]> Expressions() =>
    [
        ["'{1,2,NULL}'::int[]"],
        ["'{{1,2},{3,NULL}}'::int[]"],
        ["'{}'::int[]"],
        ["'[0:2]={1,2,3}'::int[]"],
        ["ARRAY['2025-01-01'::date, NULL]"],
        ["ARRAY[1.5, NULL]::numeric[]"],
        ["ARRAY[true, NULL, false]"],
        ["ARRAY['a b', 'c,d', '', 'NULL', 'q\"x', 'b\\s', NULL]"],
        ["ARRAY[[1.5, 2.5], [3.5, 4.5]]::float8[]"],
        ["ARRAY['2025-05-05 10:20:30.5'::timestamp, NULL]"],
        ["ARRAY['11111111-2222-3333-4444-555555555555'::uuid, NULL]"],
        ["ARRAY['\\xdead'::bytea, NULL]"],
        ["'{new,NULL}'::order_status[]"],
        ["ROW('a', 1, NULL, 2.50, true)"],
        ["ROW(ROW(1, 'x'), ARRAY[1, 2], ARRAY['a b', NULL])"],
        ["'10.1.2.3/24'::inet"],
        ["'10.1.2.3'::inet::text"],
        ["'10.0.0.0/8'::cidr"],
        ["'2001:db8::1/64'::inet"],
        ["'08:00:2b:01:02:03'::macaddr"],
        ["'08:00:2b:01:02:03:04:05'::macaddr8"],
        ["ARRAY['10.1.2.3/24'::inet, NULL]"],
        ["'[2025-01-01,2025-02-01)'::daterange"],
        ["'[2025-01-01 10:00,2025-02-01)'::tsrange"],
        ["'[1.5,2.5]'::numrange"],
        ["'(,5)'::int4range"],
        ["'[2025-01-01,)'::daterange"],
        ["'empty'::int4range"],
        ["'{[1,3),[5,7)}'::int4multirange"],
        ["'{}'::int4multirange"],
        ["'NaN'::numeric"],
        ["'Infinity'::numeric"],
        ["'-Infinity'::numeric"],
        ["123456789012345678901234567890.123456789::numeric"],
        ["(-1234567890123456789012345678901234567890.5)::numeric"],
        ["0.00000000000000000000000000000001::numeric"],
        ["12::numeric(10,4)"],
        ["'infinity'::date"],
        ["'-infinity'::date"],
        ["'9999-12-31'::date"],
        ["'5874897-12-31'::date"],
        ["'0001-01-01 BC'::date"],
        ["'4713-01-01 BC'::date"],
        ["'infinity'::timestamp"],
        ["'-infinity'::timestamp"],
        ["'infinity'::timestamptz"],
        ["'0044-03-15 12:00:00 BC'::timestamp"],
        ["'24:00:00'::time"],
        ["ARRAY['24:00:00'::time, NULL]"],
    ];

    [SkippableTheory]
    [MemberData(nameof(Expressions))]
    public async Task Value_RendersAsPostgreSqlText(string expression)
    {
        Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "PostgreSQL not available.");
        await using var s = await fixture.OpenSessionAsync();
        var sink = new RecordingSink();
        var summary = await s.ExecuteAsync(new ExecuteRequest([new SqlBatch($"SELECT {expression} AS v, ({expression})::text AS t", 1, 1)], 10, true, false, "statement"),
            sink, CancellationToken.None).WaitAsync(Timeout);
        Assert.True(summary.Status == ExecutionStatus.Ok, sink.Describe());
        var row = sink.ResultSets.Single().Rows.Single();
        Assert.Equal(row[1], row[0]);
    }

    [SkippableFact]
    public async Task TypeCreatedInTheSession_IsReadableRightAway()
    {
        Skip.IfNot(fixture.IsAvailable, fixture.SkipReason ?? "PostgreSQL not available.");
        await using var s = await fixture.OpenSessionAsync();
        async Task<RecordingSink> Run(string sql)
        {
            var sink = new RecordingSink();
            var summary = await s.ExecuteAsync(new ExecuteRequest([new SqlBatch(sql, 1, 1)], 10, true, false, "statement"), sink, CancellationToken.None).WaitAsync(Timeout);
            Assert.True(summary.Status == ExecutionStatus.Ok, sink.Describe());
            return sink;
        }
        try
        {
            await Run("CREATE TYPE public.zz_reload_mood AS ENUM ('a b', 'c')");
            var sink = await Run("SELECT ARRAY['a b'::zz_reload_mood, NULL] AS e, ARRAY['c'::zz_reload_mood] AS f");
            var row = sink.ResultSets.Single().Rows.Single();
            Assert.Equal(["{\"a b\",NULL}", "{c}"], row.Select(v => v?.ToString()));
        }
        finally
        {
            await Run("DROP TYPE IF EXISTS public.zz_reload_mood");
        }
    }

    [Theory]
    [InlineData("CREATE TYPE t AS (a int)", true)]
    [InlineData("ALTER TYPE public.mood ADD VALUE 'z'", true)]
    [InlineData("DROP DOMAIN d", true)]
    [InlineData("CREATE EXTENSION IF NOT EXISTS hstore", true)]
    [InlineData("SELECT 'CREATE TYPE x'", false)]
    [InlineData("CREATE TABLE t (a int)", false)]
    [InlineData("SELECT 1; CREATE DOMAIN d AS int", true)]
    public void DefinesTypes_DetectsTypeDdl(string sql, bool expected) => Assert.Equal(expected, PgSession.DefinesTypes(sql));
}
