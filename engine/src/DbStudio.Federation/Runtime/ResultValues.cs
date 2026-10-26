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
        return columns;
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
