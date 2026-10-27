using System.Globalization;
using System.Text.RegularExpressions;
using DbStudio.Core.Designer;

namespace DbStudio.Providers.MySql.Designer;

/// <summary>
/// MySQL / MariaDB table options the designer shows and sets (docs/qa/round-mysql.md #10): ENGINE, default character set
/// and collation, ROW_FORMAT and the AUTO_INCREMENT start value. They travel in <c>TableOptions.Extra</c> (name → text)
/// like the ClickHouse engine options; a blank or missing entry means "server default" and is not scripted.
/// </summary>
public static partial class MySqlTableOptions
{
    public const string Engine = "engine", Charset = "charset", Collation = "collation", RowFormat = "rowFormat", AutoIncrement = "autoIncrement";

    public static readonly IReadOnlyList<string> Keys = [Engine, Charset, Collation, RowFormat, AutoIncrement];

    /// <summary>ROW_FORMAT values of InnoDB (MariaDB adds PAGE, and Aria also takes FIXED / DYNAMIC).</summary>
    public static readonly IReadOnlyList<string> RowFormats = ["DEFAULT", "DYNAMIC", "COMPACT", "REDUNDANT", "COMPRESSED", "FIXED", "PAGE"];

    [GeneratedRegex(@"^[A-Za-z0-9_]{1,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex WordPattern();

    /// <summary>The model's non-blank options by key (trimmed); keys of other providers are ignored.</summary>
    public static Dictionary<string, string> From(TableModel? model)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (model?.Options.Extra is not { } x) return result;
        foreach (var key in Keys)
            if (x.FirstOrDefault(kv => kv.Key.Equals(key, StringComparison.OrdinalIgnoreCase)).Value is { } v && !string.IsNullOrWhiteSpace(v))
                result[key] = v.Trim();
        return result;
    }

    /// <summary>The options the designer shows for an existing table, from information_schema.TABLES.</summary>
    public static Dictionary<string, string> Read(string? engine, string? collation, string? rowFormat, long? autoIncrement)
    {
        var extra = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!string.IsNullOrWhiteSpace(engine)) extra[Engine] = engine.Trim();
        if (!string.IsNullOrWhiteSpace(collation))
        {
            extra[Collation] = collation.Trim();
            extra[Charset] = CharsetOf(collation);
        }
        if (!string.IsNullOrWhiteSpace(rowFormat)) extra[RowFormat] = rowFormat.Trim();
        if (autoIncrement is > 0) extra[AutoIncrement] = autoIncrement.Value.ToString(CultureInfo.InvariantCulture);
        return extra;
    }

    /// <summary>"utf8mb4_0900_ai_ci" → "utf8mb4"; "binary" → "binary".</summary>
    public static string CharsetOf(string collation)
    {
        var c = collation.Trim();
        var i = c.IndexOf('_');
        return i > 0 ? c[..i] : c;
    }

    /// <summary>Rejects values that are not plain words / numbers (they are written into the DDL unquoted).</summary>
    public static void Validate(IReadOnlyDictionary<string, string> options)
    {
        foreach (var (key, value) in options)
        {
            if (key.Equals(AutoIncrement, StringComparison.OrdinalIgnoreCase))
            {
                if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n < 1)
                    throw new ArgumentException($"AUTO_INCREMENT must be a positive whole number (got '{value}').");
            }
            else if (!WordPattern().IsMatch(value))
            {
                throw new ArgumentException($"'{value}' is not a valid {Label(key)}: use letters, digits and underscores only.");
            }
        }
    }

    private static string Label(string key) => key.ToLowerInvariant() switch
    {
        "engine" => "storage engine",
        "charset" => "character set",
        "collation" => "collation",
        "rowformat" => "ROW_FORMAT",
        _ => key,
    };

    /// <summary>The CREATE TABLE option clauses (after the closing parenthesis), in the order the server prints them.</summary>
    public static List<string> CreateClauses(TableModel t)
    {
        var o = From(t);
        Validate(o);
        var parts = new List<string>();
        if (o.TryGetValue(Engine, out var engine)) parts.Add("ENGINE = " + engine);
        if (o.TryGetValue(Charset, out var cs)) parts.Add("DEFAULT CHARSET = " + cs);
        if (o.TryGetValue(Collation, out var co)) parts.Add("COLLATE = " + co);
        if (o.TryGetValue(RowFormat, out var rf)) parts.Add("ROW_FORMAT = " + rf.ToUpperInvariant());
        if (o.TryGetValue(AutoIncrement, out var ai)) parts.Add("AUTO_INCREMENT = " + ai);
        return parts;
    }

    /// <summary>
    /// The ALTER TABLE option clauses for what changed (a cleared or untouched option is left alone) with the warnings that go
    /// with them. The character set and collation only change the table default; existing columns keep theirs.
    /// </summary>
    public static (List<string> Clauses, List<string> Warnings) AlterClauses(TableModel original, TableModel desired)
    {
        var from = From(original);
        var to = From(desired);
        Validate(to);
        var clauses = new List<string>();
        var warnings = new List<string>();
        bool Changed(string key) => to.TryGetValue(key, out var v) && (!from.TryGetValue(key, out var o) || !o.Equals(v, StringComparison.OrdinalIgnoreCase));
        if (Changed(Engine))
        {
            clauses.Add("ENGINE = " + to[Engine]);
            warnings.Add($"Changing the storage engine to {to[Engine]} rebuilds the table and can take long on a big table.");
        }
        if (Changed(Charset)) clauses.Add("DEFAULT CHARSET = " + to[Charset]);
        if (Changed(Collation)) clauses.Add("COLLATE = " + to[Collation]);
        if (Changed(Charset) || Changed(Collation))
            warnings.Add("The character set and collation only change the table default: existing columns keep theirs (use CONVERT TO CHARACTER SET in a script to convert them).");
        if (Changed(RowFormat))
        {
            clauses.Add("ROW_FORMAT = " + to[RowFormat].ToUpperInvariant());
            warnings.Add($"Changing ROW_FORMAT to {to[RowFormat].ToUpperInvariant()} rebuilds the table.");
        }
        if (Changed(AutoIncrement))
        {
            clauses.Add("AUTO_INCREMENT = " + to[AutoIncrement]);
            warnings.Add("AUTO_INCREMENT below the largest value already in the column is ignored by InnoDB.");
        }
        return (clauses, warnings);
    }
}
