using System.Collections;
using System.Data.Common;
using System.Text.Json;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Federation.Pushdown;

namespace DbStudio.Federation.Runtime;

/// <summary>Result columns and values of federation queries as the console reports them (kinds per <see cref="TypeMap.ResultKind"/>).</summary>
internal static class ResultValues
{
    public static ColumnInfo[] Describe(DbDataReader reader)
    {
        var columns = new ColumnInfo[reader.FieldCount];
        for (var i = 0; i < columns.Length; i++)
        {
            string name;
            try { name = reader.GetName(i); } catch { name = $"column{i + 1}"; }
            string typeName;
            try { typeName = reader.GetDataTypeName(i); } catch { typeName = ""; }
            Type? clr;
            try { clr = reader.GetFieldType(i); } catch { clr = null; }
            var kind = TypeMap.ResultKind(typeName, clr);
            columns[i] = new ColumnInfo(name, i, TypeMap.ResultTypeText(typeName), kind, true);
        }
        AddDecimalPrecision(reader, columns);
        return columns;
    }

    /// <summary>
    /// DuckDB's reader names a DECIMAL(38,2) column just "DECIMAL"; the precision and scale come from the schema table.
    /// Without them materialize creates NUMERIC(38,10) for every decimal result (a total of 120.50 is stored as 120.5000000000).
    /// </summary>
    private static void AddDecimalPrecision(DbDataReader reader, ColumnInfo[] columns)
    {
        if (!columns.Any(c => c.Kind == ColumnKinds.Decimal)) return;
        try
        {
            var schema = reader.GetSchemaTable();
            if (schema is null || !schema.Columns.Contains("NumericPrecision") || !schema.Columns.Contains("NumericScale")) return;
            for (var i = 0; i < columns.Length && i < schema.Rows.Count; i++)
            {
                if (columns[i].Kind != ColumnKinds.Decimal) continue;
                var row = schema.Rows[i];
                if (row["NumericPrecision"] is DBNull || row["NumericScale"] is DBNull) continue;
                var precision = Convert.ToInt32(row["NumericPrecision"], System.Globalization.CultureInfo.InvariantCulture);
                var scale = Convert.ToInt32(row["NumericScale"], System.Globalization.CultureInfo.InvariantCulture);
                if (precision is < 1 or > 38 || scale < 0 || scale > precision) continue;
                columns[i] = columns[i] with { Precision = precision, Scale = scale };
            }
        }
        catch (Exception e) when (e is NotSupportedException or InvalidCastException or InvalidOperationException or FormatException or OverflowException)
        {
            // the type name alone is enough for the console; materialize falls back to NUMERIC(38,10)
        }
    }

    /// <summary>One cell as a wire value (blobs read from their stream, TIMESTAMPTZ as UTC offsets, lists/structs as JSON).</summary>
    public static object? Read(DbDataReader reader, int ordinal, ColumnInfo column)
    {
        if (reader.IsDBNull(ordinal)) return null;
        object value;
        try
        {
            value = reader.GetValue(ordinal);
        }
        catch (Exception e) when (e is InvalidCastException or OverflowException or NotSupportedException or FormatException)
        {
            try { return ValueConverter.Text(reader.GetString(ordinal)); } catch (Exception) { return null; }
        }
        // A DECIMAL(38,2) holding 120.50 comes out of the engine as 120.5: keep the column's scale so the grid shows 120.50
        // like the source table does.
        if (value is decimal money && column.Scale is > 0 and <= 28)
            return money.ToString("F" + column.Scale.Value.ToString(System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.InvariantCulture);
        return ToWire(value, column.Kind);
    }

    public static object? ToWire(object? value, string kind)
    {
        switch (value)
        {
            case null or DBNull:
                return null;
            case Stream s:
            {
                using var ms = new MemoryStream();
                s.CopyTo(ms);
                return new BinaryValue(ms.ToArray());
            }
            case DateTime dt when kind == ColumnKinds.DateTimeOffset:
                return ValueConverter.ToWire(new DateTimeOffset(DateTime.SpecifyKind(dt, DateTimeKind.Utc)));
            case string or byte[]:
                return ValueConverter.ToWire(value);
            case IDictionary or IList:
                try
                {
                    return ValueConverter.Text(JsonSerializer.Serialize(value, value.GetType(), CoreJson.Options));
                }
                catch (Exception e) when (e is NotSupportedException or JsonException or InvalidOperationException)
                {
                    return ValueConverter.Text(value.ToString() ?? "");
                }
            default:
                return ValueConverter.ToWire(value);
        }
    }
}
