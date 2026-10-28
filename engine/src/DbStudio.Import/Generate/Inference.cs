using System.Globalization;
using System.Text.RegularExpressions;
using DbStudio.Core.Models;
using DbStudio.Import.Parsing;
using DbStudio.Import.Run;

namespace DbStudio.Import.Generate;

/// <summary>What a CHECK constraint or an enum type says about a column.</summary>
internal sealed record ColumnHint(List<string>? Values = null, decimal? Min = null, decimal? Max = null, bool MinExclusive = false, bool MaxExclusive = false);

/// <summary>Numeric limits of a declared column type.</summary>
internal static class TypeBounds
{
    private static readonly Regex Parens = new(@"\(\s*(\d+)\s*(?:,\s*(-?\d+)\s*)?\)", RegexOptions.Compiled);

    public static ColumnContext Context(ImportDialect d, ColumnDetail c, TargetCol tc)
    {
        var t = (c.Type ?? "").Trim().ToLowerInvariant();
        var m = Parens.Match(t);
        int? p = m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : null;
        int? s = m.Success && m.Groups[2].Success ? int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) : null;
        var bare = Regex.Replace(t, @"\(.*?\)", "").Replace("unsigned", "").Replace("zerofill", "").Trim();
        var unsigned = t.Contains("unsigned", StringComparison.Ordinal);
        var (imin, imax) = IntBounds(d, bare, unsigned, p, s);

        int precision = 18, scale = 2;
        decimal decMax = 1_000_000_000_000_000m;
        if (tc.Kind == Kinds.Decimal)
        {
            if (bare is "money") { precision = 19; scale = 4; }
            else if (bare is "smallmoney") { precision = 10; scale = 4; }
            else if (p is { } pp) { precision = Math.Clamp(pp, 1, 38); scale = Math.Clamp(s ?? 0, 0, precision); }
            else if (d.Dialect == Dialect.TSql) { precision = 18; scale = 0; }
            decMax = DecimalMax(precision, scale);
        }
        return new ColumnContext(tc.Name, tc.Kind, c.Type ?? "", tc.MaxLength, precision, scale, imin, imax, decMax);
    }

    public static decimal DecimalMax(int precision, int scale)
    {
        var intDigits = Math.Clamp(precision - scale, 0, 27);
        var max = 1m;
        for (var i = 0; i < intDigits; i++) max *= 10;
        var step = 1m;
        for (var i = 0; i < Math.Min(scale, 27); i++) step /= 10;
        return max - step;
    }

    private static (long, long) IntBounds(ImportDialect d, string bare, bool unsigned, int? p, int? s)
    {
        switch (bare)
        {
            case "tinyint": return d.Dialect == Dialect.TSql || unsigned ? (0, 255) : (-128, 127);
            case "int8" when d.Dialect == Dialect.ClickHouse: return (-128, 127);
            case "uint8": return (0, 255);
            case "smallint" or "int2" or "smallserial" or "serial2" or "int16": return unsigned ? (0, 65535) : (-32768, 32767);
            case "uint16": return (0, 65535);
            case "mediumint": return unsigned ? (0, 16777215) : (-8388608, 8388607);
            case "int" or "integer" or "int4" or "serial" or "serial4" or "int32" when d.Dialect != Dialect.PlSql:
                return unsigned ? (0, uint.MaxValue) : (int.MinValue, int.MaxValue);
            case "uint32": return (0, uint.MaxValue);
            case "number" when d.Dialect == Dialect.PlSql && p is { } pr && (s ?? 0) == 0:
            {
                var lim = (long)Math.Pow(10, Math.Min(pr, 18)) - 1;
                return (-lim, lim);
            }
            default: return unsigned ? (0, long.MaxValue) : (long.MinValue, long.MaxValue);
        }
    }
}

/// <summary>
/// Chooses a generator for every column from its type, name and constraints (the starting point the user edits).
/// Pure: no connection, deterministic for a given <c>now</c>.
/// </summary>
internal static class Inference
{
    private static readonly Regex PersonTable = new(@"user|customer|person|people|employee|staff|contact|member|author|student|patient|client|teacher|doctor|owner|passenger|guest|actor|artist|player|worker|account|lead|applicant|candidate", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex CompanyTable = new(@"compan|organi[sz]ation|vendor|supplier|business|employer|firm|brand|manufactur", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SelfNumbered = new(@"nextval|\.nextval|auto_?increment|identity|generated|sequence|serial", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex EnumItem = new(@"'((?:[^']|'')*)'", RegexOptions.Compiled);

    private sealed record Choice(string Generator, Dictionary<string, string?>? Options = null, string? Note = null);

    public static GenerateColumn Infer(ImportDialect d, string table, ColumnDetail c, TargetCol tc, ColumnContext cc, string? foreignKey, bool soloUnique,
        ColumnHint? hint, DateTime now)
    {
        var col = new GenerateColumn
        {
            Name = c.Name, Type = c.Type ?? "", Kind = tc.Kind, Nullable = c.Nullable, IsPk = c.IsPk, IsIdentity = c.IsIdentity, IsComputed = c.IsComputed,
            HasDefault = c.Default is not null, Unique = soloUnique && !c.IsIdentity && !c.IsComputed,
        };
        if (c.IsComputed) return Set(col, new Choice(GeneratorCatalog.Skip, null, "Computed column: the database fills it."));
        if (c.IsIdentity) return Set(col, new Choice(GeneratorCatalog.Skip, null, "Identity column: the database numbers the rows."));
        // A numeric key the database numbers itself (PostgreSQL serial / nextval, Oracle sequence default, SQLite and MySQL auto
        // increment shown as a default): writing explicit values would leave its counter behind, so the next ordinary insert collides.
        if (foreignKey is null && (c.IsPk || soloUnique) && tc.Kind is Kinds.Int or Kinds.BigInt && c.Default is { } dflt && SelfNumbered.IsMatch(dflt))
            return Set(col, new Choice(GeneratorCatalog.Skip, null, "Numbered by a database default (sequence): left to the database."));
        if (foreignKey is not null)
        {
            col.ForeignKey = foreignKey;
            return Set(col, new Choice(GeneratorCatalog.ForeignKey, null, "Picks existing values of the parent table."));
        }

        var choice = Choose(d, table, c, tc, cc, soloUnique || c.IsPk, hint, now);
        Set(col, choice);
        if (c.Nullable && !c.IsPk && !soloUnique && choice.Generator != GeneratorCatalog.Skip) col.NullPercent = 5;
        return col;
    }

    private static GenerateColumn Set(GenerateColumn col, Choice ch)
    {
        col.Generator = ch.Generator;
        col.Options = ch.Options ?? GeneratorCatalog.DefaultOptions(ch.Generator);
        if (ch.Options is not null)
            foreach (var (k, v) in GeneratorCatalog.DefaultOptions(ch.Generator)) col.Options.TryAdd(k, v);
        col.Note = ch.Note;
        return col;
    }

    private static Choice Choose(ImportDialect d, string table, ColumnDetail c, TargetCol tc, ColumnContext cc, bool isKey, ColumnHint? hint, DateTime now)
    {
        var n = Norm(c.Name);
        if (hint?.Values is { Count: > 0 } vals && tc.Kind != Kinds.Binary)
            return new Choice("list", new() { ["values"] = string.Join("\n", vals) }, "Values allowed by a CHECK constraint or enum type.");

        switch (tc.Kind)
        {
            case Kinds.Int or Kinds.BigInt or Kinds.Decimal or Kinds.Float:
                return Numeric(n, tc, cc, isKey, hint);
            case Kinds.Bool:
                return new Choice("bool", new() { ["trueP"] = BoolChance(n).ToString(CultureInfo.InvariantCulture) });
            case Kinds.Date or Kinds.DateTime:
                return Dates(n, tc, now);
            case Kinds.Time:
                return new Choice("time", new() { ["from"] = "08:00:00", ["to"] = "18:00:00" });
            case Kinds.Guid:
                return new Choice("uuid");
            case Kinds.Binary:
                return new Choice("binary", new() { ["length"] = Math.Min(16, tc.MaxLength ?? 16).ToString(CultureInfo.InvariantCulture) });
            case Kinds.Json:
                return new Choice("json");
            default:
                return Textual(d, table, c, tc, n, isKey);
        }
    }

    // ---------------------------------------------------------------- numbers

    private static Choice Numeric(string n, TargetCol tc, ColumnContext cc, bool isKey, ColumnHint? hint)
    {
        var whole = tc.Kind is Kinds.Int or Kinds.BigInt;
        if (isKey && (whole || cc.Scale == 0 && tc.Kind == Kinds.Decimal))
            return new Choice("sequence", new() { ["start"] = "auto", ["step"] = "1" }, "Key column: consecutive numbers continuing after the table's highest value.");

        (decimal Min, decimal Max, int Dec)? r = null;
        if (n is "age") r = (18, 80, 0);
        else if (n is "year" or "yr") r = (1990, DateTime.UtcNow.Year, 0);
        else if (n is "month") r = (1, 12, 0);
        else if (n is "day") r = (1, 28, 0);
        else if (n is "hour") r = (0, 23, 0);
        else if (n.EndsWith("quantity", StringComparison.Ordinal) || n is "qty" or "units" or "stock" or "instock" or "unitsinstock" || n.EndsWith("count", StringComparison.Ordinal) && !n.EndsWith("account", StringComparison.Ordinal)) r = (1, 100, 0);
        else if (n.Contains("salary", StringComparison.Ordinal) || n is "wage" or "income") r = (30000, 150000, 0);
        else if (n.Contains("price", StringComparison.Ordinal) || n.Contains("cost", StringComparison.Ordinal)) r = (1, 500, 2);
        else if (n.Contains("total", StringComparison.Ordinal) || n.Contains("amount", StringComparison.Ordinal) || n.Contains("balance", StringComparison.Ordinal) || n is "revenue" or "payment" or "budget") r = (1, 10000, 2);
        else if (n.Contains("fee", StringComparison.Ordinal) || n.Contains("freight", StringComparison.Ordinal) || n.Contains("charge", StringComparison.Ordinal)) r = (1, 200, 2);
        else if (n.Contains("percent", StringComparison.Ordinal) || n is "pct") r = (0, 100, 0);
        else if (n.Contains("discount", StringComparison.Ordinal) || n is "rate" or "taxrate" or "tax") r = (0, 30, 2);
        else if (n.Contains("rating", StringComparison.Ordinal) || n is "score" or "stars") r = (1, 5, whole ? 0 : 1);
        else if (n is "latitude" or "lat") r = (-90, 90, 6);
        else if (n is "longitude" or "lng" or "lon" or "long") r = (-180, 180, 6);
        else if (n.Contains("weight", StringComparison.Ordinal)) r = (1, 150, 2);
        else if (n.Contains("height", StringComparison.Ordinal) || n.Contains("length", StringComparison.Ordinal) || n.Contains("width", StringComparison.Ordinal)) r = (1, 200, whole ? 0 : 1);
        else if (n.EndsWith("id", StringComparison.Ordinal) && whole) r = (1, 1000, 0);

        decimal min, max;
        int dec;
        if (r is { } rr) (min, max, dec) = rr;
        else if (whole) { min = Math.Max(1, cc.IntMin); max = Math.Min(100000, cc.IntMax); dec = 0; }
        else { min = 0; max = Math.Min(1000, cc.DecMax); dec = Math.Min(cc.Scale, 2); }

        // The column type bounds the range (tinyint, decimal(5,2)...), then a CHECK constraint narrows it.
        if (whole) { min = Math.Max(min, cc.IntMin); max = Math.Min(max, cc.IntMax); }
        else { max = Math.Min(max, cc.DecMax); min = Math.Max(min, -cc.DecMax); dec = Math.Min(dec, cc.Scale); }
        if (hint is not null)
        {
            var step = whole || dec == 0 ? 1m : 1m / (decimal)Math.Pow(10, dec);
            if (hint.Min is { } hmin) min = Math.Max(min, hint.MinExclusive ? hmin + step : hmin);
            if (hint.Max is { } hmax) max = Math.Min(max, hint.MaxExclusive ? hmax - step : hmax);
            if (hint.Min is { } hm && hm > max) max = hm + (whole ? 100 : 100m);
            if (hint.Max is { } hx && hx < min) min = hx - 100;
        }
        if (max < min) (min, max) = (max, min);

        var inv = CultureInfo.InvariantCulture;
        if (whole || dec == 0 && tc.Kind != Kinds.Float)
            return new Choice("int", new() { ["min"] = ((long)min).ToString(inv), ["max"] = ((long)max).ToString(inv) }, hint is null ? null : "Range narrowed by a CHECK constraint.");
        return new Choice("decimal", new() { ["min"] = min.ToString(inv), ["max"] = max.ToString(inv), ["decimals"] = dec.ToString(inv) }, hint is null ? null : "Range narrowed by a CHECK constraint.");
    }

    private static int BoolChance(string n)
    {
        if (n.Contains("active", StringComparison.Ordinal) || n.Contains("enabled", StringComparison.Ordinal) || n.Contains("visible", StringComparison.Ordinal)
            || n.Contains("published", StringComparison.Ordinal) || n.Contains("verified", StringComparison.Ordinal) || n.Contains("available", StringComparison.Ordinal)) return 85;
        if (n.Contains("deleted", StringComparison.Ordinal) || n.Contains("archived", StringComparison.Ordinal) || n.Contains("banned", StringComparison.Ordinal)
            || n.Contains("blocked", StringComparison.Ordinal) || n.Contains("locked", StringComparison.Ordinal) || n.Contains("admin", StringComparison.Ordinal)
            || n.Contains("discontinued", StringComparison.Ordinal)) return 5;
        return 50;
    }

    // ---------------------------------------------------------------- dates

    private static Choice Dates(string n, TargetCol tc, DateTime now)
    {
        var today = now.Date;
        string from, to;
        if (n.Contains("birth", StringComparison.Ordinal) || n is "dob") { from = "1950-01-01"; to = today.AddYears(-18).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
        else if (n.StartsWith("end", StringComparison.Ordinal) || n.Contains("expir", StringComparison.Ordinal) || n.Contains("due", StringComparison.Ordinal)
                 || n.Contains("deadline", StringComparison.Ordinal) || n.Contains("deliver", StringComparison.Ordinal) || n.Contains("ship", StringComparison.Ordinal)
                 || n.Contains("required", StringComparison.Ordinal))
        { from = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); to = today.AddYears(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
        else { from = today.AddYears(-2).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); to = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture); }
        var withTime = tc.Kind == Kinds.DateTime && !(n.Contains("birth", StringComparison.Ordinal) || n is "dob" || n.EndsWith("date", StringComparison.Ordinal) && !n.EndsWith("datetime", StringComparison.Ordinal));
        return new Choice(withTime ? "datetime" : "date", new() { ["from"] = from, ["to"] = to });
    }

    // ---------------------------------------------------------------- text

    private static Choice Textual(ImportDialect d, string table, ColumnDetail c, TargetCol tc, string n, bool isKey)
    {
        var type = (c.Type ?? "").ToLowerInvariant();
        var max = tc.MaxLength;

        // MySQL enum('a','b') / set('a','b')
        if (type.StartsWith("enum", StringComparison.Ordinal) || type.StartsWith("set", StringComparison.Ordinal))
        {
            var items = EnumItem.Matches(c.Type ?? "").Select(m => m.Groups[1].Value.Replace("''", "'", StringComparison.Ordinal)).ToList();
            if (items.Count > 0) return new Choice("list", new() { ["values"] = string.Join("\n", items) }, "Values of the enum type.");
        }
        if (type.StartsWith("xml", StringComparison.Ordinal))
            return new Choice("constant", new() { ["value"] = "<row><value>sample</value></row>" }, "XML column: a small well-formed document.");

        var byName = ByName(table, n, max);
        if (byName is not null) return Fit(byName, max);
        if (isKey)
        {
            var len = max is > 0 ? Math.Min(max.Value, 10) : 10;
            return new Choice("pattern", new() { ["pattern"] = len >= 3 ? $"[A-Z0-9]{{{len}}}" : $"[a-z]{{{Math.Max(1, len)}}}" }, "Key column: random unique codes.");
        }
        return Fit(new Choice(max is null or > 255 ? "paragraph" : "sentence"), max);
    }

    /// <summary>Downgrades a long text generator when the column is short.</summary>
    private static Choice Fit(Choice ch, int? max)
    {
        if (max is not { } m || m <= 0) return ch;
        if (ch.Generator == "paragraph") return m >= 255 ? ch : Fit(new Choice("sentence"), m);
        if (ch.Generator == "sentence") return m >= 80 ? ch : m >= 24 ? new Choice("title") : new Choice("word");
        if (ch.Generator == "title") return m >= 24 ? ch : new Choice("word");
        return ch;
    }

    private static Choice? ByName(string table, string n, int? max)
    {
        static bool Any(string n, params string[] parts) => parts.Any(p => n.Contains(p, StringComparison.Ordinal));
        if (Any(n, "email") || n is "mail") return new Choice("email");
        if (n is "firstname" or "fname" or "givenname" or "forename") return new Choice("first_name");
        if (n is "lastname" or "lname" or "surname" or "familyname") return new Choice("last_name");
        if (n is "fullname" or "displayname" or "contactname" or "customername" or "employeename" or "personname" or "authorname" or "clientname" or "membername" or "username2")
            return new Choice("full_name");
        if (n is "username" or "login" or "handle" or "nickname" or "screenname" or "userid2") return new Choice("username");
        if (Any(n, "phone", "mobile", "telephone") || n is "tel" or "fax" or "cell" or "whatsapp") return new Choice("phone");
        if (n is "city" or "town" || n.EndsWith("city", StringComparison.Ordinal)) return new Choice("city");
        if (n is "countrycode" or "countryiso") return new Choice("pattern", new() { ["pattern"] = "[A-Z]{2}" });
        if (n is "country" or "countryname" || n.EndsWith("country", StringComparison.Ordinal)) return new Choice("country");
        if (n is "zip" or "zipcode" or "postal" or "postalcode" or "postcode") return new Choice("postal_code");
        if (n is "address" or "address1" or "addressline1" or "street" or "streetaddress" or "addr") return new Choice("street_address");
        if (n is "jobtitle" or "job" or "position" or "occupation" or "jobname" or "role") return new Choice("job_title");
        if (n is "company" or "companyname" or "organization" or "organisation" or "employer" or "vendor" or "suppliername" or "business" or "orgname")
            return new Choice("company");
        if (Any(n, "website", "homepage") || n is "url" or "link" or "uri" or "weburl" or "image" or "imageurl" or "photo" or "avatar" or "picture" or "thumbnail")
            return new Choice("url");
        if (n is "domain" or "hostname" or "host") return new Choice("domain");
        if (n is "ip" or "ipaddress" or "ipv4" or "clientip") return new Choice("ipv4");
        if (n is "uuid" or "guid") return new Choice("uuid");
        if (n is "color" or "colour") return new Choice("color");
        if (n is "gender" or "sex") return new Choice("list", new() { ["values"] = "Female\nMale" });
        if (n is "status") return new Choice("list", new() { ["values"] = "active\ninactive\npending" });
        if (n is "category" or "categoryname") return new Choice("list", new() { ["values"] = string.Join("\n", WordLists.Categories) });
        if (n is "type" or "kind") return new Choice("list", new() { ["values"] = "standard\npremium\nbasic\ncustom" });
        if (n is "currency" or "currencycode") return new Choice("list", new() { ["values"] = "USD\nEUR\nGBP\nJPY" });
        if (n is "language" or "lang" or "locale") return new Choice("list", new() { ["values"] = "en\nfr\nde\nes\nit\npt\nja" });
        if (n is "password" or "passwordhash" or "hash" or "token" or "secret" or "apikey") return new Choice("pattern", new() { ["pattern"] = "[a-f0-9]{32}" });
        if (n is "sku" or "code" or "barcode" or "productcode" or "reference" or "ref" || n.EndsWith("code", StringComparison.Ordinal))
            return new Choice("pattern", new() { ["pattern"] = @"[A-Z]{3}-\d{5}" });
        if (n.EndsWith("number", StringComparison.Ordinal) || n is "orderno" or "invoiceno" or "trackingno")
            return new Choice("pattern", new() { ["pattern"] = @"[A-Z]{2}\d{8}" });
        if (n is "description" or "desc" or "comment" or "comments" or "note" or "notes" or "bio" or "about" or "summary" or "details" or "body" or "content" or "message" or "remarks" or "review" or "text")
            return new Choice(max is null or >= 400 ? "paragraph" : "sentence");
        if (n is "subject" or "headline" or "caption" or "label" or "slug") return new Choice("title");
        if (n is "name" or "title")
        {
            if (n == "title") return new Choice("title");
            if (PersonTable.IsMatch(table)) return new Choice("full_name");
            if (CompanyTable.IsMatch(table)) return new Choice("company");
            if (table.Contains("cit", StringComparison.OrdinalIgnoreCase)) return new Choice("city");
            if (table.Contains("countr", StringComparison.OrdinalIgnoreCase)) return new Choice("country");
            return new Choice("title");
        }
        if (n.EndsWith("name", StringComparison.Ordinal))
        {
            if (PersonTable.IsMatch(n)) return new Choice("full_name");
            return new Choice("title");
        }
        return null;
    }

    private static string Norm(string s) => new(s.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
}
