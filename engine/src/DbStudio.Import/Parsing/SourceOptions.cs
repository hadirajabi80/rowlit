using System.Text;

namespace DbStudio.Import.Parsing;

/// <summary>Source file options of the Import Wizard (wire shape: ui/src/components/ImportWizard/types.ts SourceOptions).</summary>
public sealed class SourceOptions
{
    public string Format { get; set; } = "";
    public string? Encoding { get; set; }
    public string? Delimiter { get; set; }
    public string? Quote { get; set; }
    public string? Escape { get; set; }
    public bool? HasHeader { get; set; }
    public int? SkipRows { get; set; }
    public string? Sheet { get; set; }
    public string? JsonPath { get; set; }
    public bool? Trim { get; set; }
    public List<string>? NullTokens { get; set; }
    public List<string>? DateFormats { get; set; }
    public string? DecimalSeparator { get; set; }
    public string? ThousandsSeparator { get; set; }
    public bool? NormalizeDigits { get; set; }

    public static readonly string[] DefaultNullTokens = ["", "NULL", "null"];

    public bool Header => HasHeader ?? true;
    public int Skip => Math.Max(0, SkipRows ?? 0);
    public bool TrimValues => Trim ?? false;
    public bool Digits => NormalizeDigits ?? true;
    public IReadOnlyList<string> Nulls => NullTokens ?? [.. DefaultNullTokens];

    public SourceOptions Clone() => new()
    {
        Format = Format, Encoding = Encoding, Delimiter = Delimiter, Quote = Quote, Escape = Escape, HasHeader = HasHeader,
        SkipRows = SkipRows, Sheet = Sheet, JsonPath = JsonPath, Trim = Trim, NullTokens = NullTokens?.ToList(),
        DateFormats = DateFormats?.ToList(), DecimalSeparator = DecimalSeparator, ThousandsSeparator = ThousandsSeparator,
        NormalizeDigits = NormalizeDigits,
    };

    /// <summary>"csv" | "tsv" | "xlsx" | "json" | "ndjson" from a file name; null when unknown.</summary>
    public static string? FormatOf(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".csv" => "csv",
        ".tsv" or ".tab" => "tsv",
        ".txt" => "csv",
        ".xlsx" or ".xlsm" => "xlsx",
        ".json" => "json",
        ".ndjson" or ".jsonl" => "ndjson",
        _ => null,
    };
}

/// <summary>Encoding names of the wizard to <see cref="System.Text.Encoding"/>, and detection of an unknown file encoding.</summary>
public static class Encodings
{
    static Encodings() => System.Text.Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static Encoding Resolve(string? name)
    {
        switch ((name ?? "").Trim().ToLowerInvariant())
        {
            case "" or "auto": return new UTF8Encoding(false);
            case "utf-8" or "utf8": return new UTF8Encoding(false);
            case "utf-16" or "utf-16le" or "utf16": return new UnicodeEncoding(false, false);
            case "utf-16be": return new UnicodeEncoding(true, false);
            case "ascii" or "us-ascii": return System.Text.Encoding.ASCII;
        }
        try { return System.Text.Encoding.GetEncoding(name!); }
        catch (ArgumentException) { throw new ArgumentException($"Unknown text encoding '{name}'."); }
    }

    /// <summary>
    /// BOM (UTF-8, UTF-16 LE/BE), else UTF-8 when the sample is valid UTF-8 (a pure-ASCII sample is UTF-8), else Windows-1252.
    /// Returns the encoding name and the BOM length to skip.
    /// </summary>
    public static (string Name, int BomLength) Detect(ReadOnlySpan<byte> sample)
    {
        if (sample.Length >= 3 && sample[0] == 0xEF && sample[1] == 0xBB && sample[2] == 0xBF) return ("utf-8", 3);
        if (sample.Length >= 2 && sample[0] == 0xFF && sample[1] == 0xFE) return ("utf-16", 2);
        if (sample.Length >= 2 && sample[0] == 0xFE && sample[1] == 0xFF) return ("utf-16be", 2);
        // UTF-16 without BOM: many zero bytes at alternating positions.
        if (sample.Length >= 4)
        {
            int even = 0, odd = 0, n = Math.Min(sample.Length, 4096);
            for (var i = 0; i < n; i++) if (sample[i] == 0) { if (i % 2 == 0) even++; else odd++; }
            if (odd > n / 4 && even == 0) return ("utf-16", 0);
            if (even > n / 4 && odd == 0) return ("utf-16be", 0);
        }
        return (IsValidUtf8(sample) ? "utf-8" : "windows-1252", 0);
    }

    private static bool IsValidUtf8(ReadOnlySpan<byte> data)
    {
        // A sample cut in the middle of a character must not fail: ignore an incomplete tail.
        var end = data.Length;
        var back = 0;
        while (back < 3 && end - back > 0 && (data[end - 1 - back] & 0xC0) == 0x80) back++;
        if (end - back > 0 && data[end - 1 - back] >= 0xC0) end = end - back - 1;
        return System.Text.Unicode.Utf8.IsValid(data[..end]);
    }
}
