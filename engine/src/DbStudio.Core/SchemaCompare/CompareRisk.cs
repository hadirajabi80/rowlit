using DbStudio.Core.Designer;

namespace DbStudio.Core.SchemaCompare;

/// <summary>Judges whether changing a column type can lose data or fail (narrowing, conversion between families).</summary>
internal static class CompareRisk
{
    private enum Family { Other, Text, Integer, Decimal, Float, DateTime, Binary, Bool }

    private static readonly Dictionary<string, (Family Family, int Rank)> Types = new(StringComparer.Ordinal)
    {
        ["char"] = (Family.Text, 0), ["nchar"] = (Family.Text, 0), ["varchar"] = (Family.Text, 0), ["nvarchar"] = (Family.Text, 0),
        ["varchar2"] = (Family.Text, 0), ["nvarchar2"] = (Family.Text, 0), ["character"] = (Family.Text, 0), ["character varying"] = (Family.Text, 0),
        ["text"] = (Family.Text, 99), ["ntext"] = (Family.Text, 99), ["clob"] = (Family.Text, 99), ["nclob"] = (Family.Text, 99),
        ["longtext"] = (Family.Text, 99), ["mediumtext"] = (Family.Text, 98), ["tinytext"] = (Family.Text, 1), ["string"] = (Family.Text, 99),
        ["tinyint"] = (Family.Integer, 1), ["smallint"] = (Family.Integer, 2), ["mediumint"] = (Family.Integer, 3), ["int"] = (Family.Integer, 4),
        ["integer"] = (Family.Integer, 4), ["bigint"] = (Family.Integer, 8), ["int2"] = (Family.Integer, 2), ["int4"] = (Family.Integer, 4), ["int8"] = (Family.Integer, 8),
        ["decimal"] = (Family.Decimal, 0), ["numeric"] = (Family.Decimal, 0), ["number"] = (Family.Decimal, 0), ["money"] = (Family.Decimal, 0),
        ["smallmoney"] = (Family.Decimal, 0),
        ["real"] = (Family.Float, 4), ["float"] = (Family.Float, 8), ["double"] = (Family.Float, 8), ["double precision"] = (Family.Float, 8),
        ["date"] = (Family.DateTime, 1), ["time"] = (Family.DateTime, 1), ["datetime"] = (Family.DateTime, 3), ["datetime2"] = (Family.DateTime, 3),
        ["smalldatetime"] = (Family.DateTime, 2), ["timestamp"] = (Family.DateTime, 3), ["timestamptz"] = (Family.DateTime, 3),
        ["timestamp with time zone"] = (Family.DateTime, 3), ["timestamp without time zone"] = (Family.DateTime, 3), ["datetimeoffset"] = (Family.DateTime, 4),
        ["binary"] = (Family.Binary, 0), ["varbinary"] = (Family.Binary, 0), ["blob"] = (Family.Binary, 99), ["bytea"] = (Family.Binary, 99),
        ["image"] = (Family.Binary, 99), ["raw"] = (Family.Binary, 0), ["longblob"] = (Family.Binary, 99),
        ["bit"] = (Family.Bool, 0), ["boolean"] = (Family.Bool, 0), ["bool"] = (Family.Bool, 0),
    };

    /// <summary>null when the change cannot lose data; else why it can.</summary>
    public static string? TypeChange(string oldType, string newType)
    {
        if (TableDiff.SameType(oldType, newType)) return null;
        var (ob, oa) = DdlText.ParseType(oldType);
        var (nb, na) = DdlText.ParseType(newType);
        ob = TableDiff.NormalizeType(ob);
        nb = TableDiff.NormalizeType(nb);
        var hasOld = Types.TryGetValue(ob, out var o);
        var hasNew = Types.TryGetValue(nb, out var n);
        if (!hasOld || !hasNew)
            return ob == nb ? null : $"Changing {oldType} to {newType} may convert or lose data.";

        if (o.Family == n.Family)
        {
            switch (o.Family)
            {
                case Family.Text:
                case Family.Binary:
                {
                    var ol = Length(ob, oa, o.Rank);
                    var nl = Length(nb, na, n.Rank);
                    return nl < ol ? $"Narrowing {oldType} to {newType}: longer values are truncated or rejected." : null;
                }
                case Family.Integer:
                    return n.Rank < o.Rank ? $"Narrowing {oldType} to {newType}: values out of range are rejected." : null;
                case Family.Decimal:
                {
                    var op = DdlText.ArgInt(oa, 0) ?? 38;
                    var np = DdlText.ArgInt(na, 0) ?? 38;
                    var os = DdlText.ArgInt(oa, 1) ?? 0;
                    var ns = DdlText.ArgInt(na, 1) ?? 0;
                    return np - ns < op - os || ns < os ? $"Narrowing {oldType} to {newType}: values are rounded or rejected." : null;
                }
                case Family.Float:
                    return n.Rank < o.Rank ? $"Narrowing {oldType} to {newType}: precision is lost." : null;
                case Family.DateTime:
                    return n.Rank < o.Rank ? $"Changing {oldType} to {newType} drops part of the date or time." : null;
                default:
                    return null;
            }
        }
        // widening between numeric families is harmless
        if (o.Family == Family.Integer && n.Family is Family.Decimal or Family.Float) return null;
        if (o.Family == Family.Decimal && n.Family == Family.Float) return null;
        if (o.Family is Family.Integer or Family.Decimal or Family.Float or Family.DateTime or Family.Bool && n.Family == Family.Text) return null;
        return $"Changing {oldType} to {newType} converts existing data; rows that do not convert make the change fail.";
    }

    private static long Length(string baseType, IReadOnlyList<string> args, int rank)
    {
        if (rank == 99) return long.MaxValue;
        if (args.Count > 0 && args[0].Equals("max", StringComparison.OrdinalIgnoreCase)) return long.MaxValue;
        if (DdlText.ArgInt(args, 0) is { } v) return v;
        return baseType is "char" or "nchar" or "character" or "binary" ? 1 : rank > 0 ? rank : 1;
    }
}
