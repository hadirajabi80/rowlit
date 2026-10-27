using System.Globalization;
using System.Numerics;

namespace DbStudio.Core.Params;

/// <summary>
/// A decimal parameter value that <see cref="decimal"/> cannot hold exactly: more than 28-29 significant digits, a
/// magnitude above 7.9E+28 or below 1E-28, or NaN / Infinity (PostgreSQL numeric). An int parameter outside the
/// <see cref="long"/> range (MySQL BIGINT UNSIGNED, Cassandra varint, NUMBER(38)) is one too.
/// <see cref="ParamValues.ToClr"/> returns it instead of rounding or failing; each provider binds <see cref="Text"/>
/// (or <see cref="Unscaled"/> / <see cref="Scale"/>) to its own big-number type.
/// </summary>
public sealed class ExactDecimal : IFormattable, IEquatable<ExactDecimal>
{
    /// <summary>Most digits a value may expand to (a written exponent cannot make the text explode).</summary>
    public const int MaxDigits = 20_000;

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private ExactDecimal(BigInteger unscaled, int scale, string? special)
    {
        Unscaled = unscaled;
        Scale = scale;
        Special = special;
        Text = special ?? Format(unscaled, scale);
    }

    /// <summary>Plain decimal text without exponent ("-12.3400", trailing zeros as written), or NaN / Infinity / -Infinity.</summary>
    public string Text { get; }

    /// <summary>The digits as an integer: the value is Unscaled / 10^Scale. Zero for NaN / Infinity.</summary>
    public BigInteger Unscaled { get; }

    /// <summary>Digits after the point (0 or more).</summary>
    public int Scale { get; }

    /// <summary>"NaN", "Infinity" or "-Infinity"; null for a number.</summary>
    public string? Special { get; }

    public bool IsFinite => Special is null;

    /// <summary>True for a finite value without a fractional part ("12", "1.00", "1E+30").</summary>
    public bool IsInteger => IsFinite && (Scale == 0 || BigInteger.Remainder(Unscaled, BigInteger.Pow(10, Scale)).IsZero);

    /// <summary>Number of digits of <see cref="Unscaled"/> (at least 1).</summary>
    public int Precision => IsFinite ? BigInteger.Abs(Unscaled).ToString(Inv).Length : 0;

    /// <summary>The integer value of an <see cref="IsInteger"/> value.</summary>
    public BigInteger ToBigInteger() =>
        IsInteger ? BigInteger.Divide(Unscaled, BigInteger.Pow(10, Scale)) : throw new InvalidOperationException($"{Text} is not an integer.");

    /// <summary>The same value with scale 0 (<see cref="IsInteger"/> values only).</summary>
    public ExactDecimal ToInteger() => Scale == 0 ? this : new ExactDecimal(ToBigInteger(), 0, null);

    /// <summary>
    /// Parses decimal text: an optional sign, digits with an optional point, an optional exponent (<c>1.5E+40</c>), or
    /// NaN / Infinity / Inf (any case, Infinity with a sign). Surrounding white space is ignored.
    /// </summary>
    public static bool TryParse(string? text, out ExactDecimal value)
    {
        value = null!;
        if (text is null) return false;
        var t = text.Trim();
        if (t.Length == 0) return false;
        var special = t.ToLowerInvariant() switch
        {
            "nan" or "+nan" or "-nan" => "NaN",
            "infinity" or "+infinity" or "inf" or "+inf" => "Infinity",
            "-infinity" or "-inf" => "-Infinity",
            _ => null,
        };
        if (special is not null)
        {
            value = new ExactDecimal(BigInteger.Zero, 0, special);
            return true;
        }

        var i = 0;
        var negative = false;
        if (t[0] is '+' or '-') { negative = t[0] == '-'; i++; }
        var digits = new System.Text.StringBuilder(t.Length);
        var fraction = 0;
        var point = false;
        for (; i < t.Length; i++)
        {
            var c = t[i];
            if (char.IsAsciiDigit(c)) { digits.Append(c); if (point) fraction++; }
            else if (c == '.' && !point) point = true;
            else break;
        }
        if (digits.Length == 0) return false;
        long exponent = 0;
        if (i < t.Length)
        {
            if (t[i] is not ('e' or 'E')) return false;
            if (!long.TryParse(t.AsSpan(i + 1), NumberStyles.AllowLeadingSign, Inv, out exponent)) return false;
            if (exponent is > MaxDigits or < -MaxDigits) return false;
        }

        var scale = fraction - exponent;
        var significant = digits.ToString().TrimStart('0');
        if (significant.Length + Math.Max(0, -scale) > MaxDigits || scale > MaxDigits) return false;
        var unscaled = significant.Length == 0 ? BigInteger.Zero : BigInteger.Parse(significant, NumberStyles.None, Inv);
        if (scale < 0)
        {
            unscaled *= BigInteger.Pow(10, (int)-scale);
            scale = 0;
        }
        value = new ExactDecimal(negative ? -unscaled : unscaled, (int)scale, null);
        return true;
    }

    /// <summary>
    /// True when <paramref name="m"/> (parsed from <paramref name="text"/>) keeps every significant digit of the text:
    /// System.Decimal rounds after 28-29 digits and turns 1E-40 into 0 without failing; an overflow fails the parse, so
    /// comparing the significant digits is enough.
    /// </summary>
    public static bool HoldsExactly(decimal m, string text) =>
        SignificantDigits(text) == SignificantDigits(m.ToString(Inv));

    /// <summary>"-001.2300E+5" → "123": the mantissa digits without sign, point, leading and trailing zeros.</summary>
    private static string SignificantDigits(string text)
    {
        var e = text.IndexOfAny(['e', 'E']);
        var mantissa = e < 0 ? text : text[..e];
        return new string(mantissa.Where(char.IsAsciiDigit).ToArray()).Trim('0');
    }

    private static string Format(BigInteger unscaled, int scale)
    {
        var negative = unscaled.Sign < 0;
        var digits = BigInteger.Abs(unscaled).ToString(Inv);
        if (scale > 0)
        {
            digits = digits.PadLeft(scale + 1, '0');
            digits = digits[..^scale] + "." + digits[^scale..];
        }
        return negative ? "-" + digits : digits;
    }

    public override string ToString() => Text;

    string IFormattable.ToString(string? format, IFormatProvider? formatProvider) => Text;

    public bool Equals(ExactDecimal? other) => other is not null && other.Text == Text;

    public override bool Equals(object? obj) => obj is ExactDecimal other && Equals(other);

    public override int GetHashCode() => Text.GetHashCode(StringComparison.Ordinal);
}
