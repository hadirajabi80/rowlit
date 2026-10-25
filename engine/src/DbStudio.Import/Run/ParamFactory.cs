using System.Data;
using System.Data.Common;
using System.Globalization;
using DbStudio.Core.Models;
using DbStudio.Import.Parsing;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Npgsql;
using NpgsqlTypes;
using Oracle.ManagedDataAccess.Client;

namespace DbStudio.Import.Run;

/// <summary>Creates the bind parameters of an import statement with the driver type each target kind needs.</summary>
internal static class ParamFactory
{
    public static void Add(DbCommand cmd, ImportDialect d, int index, object? value, TargetCol col)
    {
        DbParameter p;
        switch (cmd)
        {
            case SqlCommand sc: p = SqlParam(sc, value, col); break;
            case NpgsqlCommand nc: p = PgParam(nc, value, col); break;
            case SqliteCommand: p = SqliteParam(cmd, value, col); break;
            default: p = Generic(cmd, d, value, col); break;
        }
        p.ParameterName = d.ParameterName(index);
        cmd.Parameters.Add(p);
    }

    private static SqlParameter SqlParam(SqlCommand cmd, object? v, TargetCol col)
    {
        var p = cmd.CreateParameter();
        p.SqlDbType = col.Kind switch
        {
            Kinds.Bool => SqlDbType.Bit,
            Kinds.Int or Kinds.BigInt => SqlDbType.BigInt,
            Kinds.Decimal => SqlDbType.Decimal,
            Kinds.Float => SqlDbType.Float,
            Kinds.Date => SqlDbType.Date,
            Kinds.DateTime => SqlDbType.DateTime2,
            Kinds.Time => SqlDbType.Time,
            Kinds.Guid => SqlDbType.UniqueIdentifier,
            Kinds.Binary => SqlDbType.VarBinary,
            _ => SqlDbType.NVarChar,
        };
        if (p.SqlDbType == SqlDbType.Decimal)
        {
            p.Precision = 38;
            p.Scale = v is decimal m ? (byte)((decimal.GetBits(m)[3] >> 16) & 0xFF) : (byte)0;
        }
        if (p.SqlDbType is SqlDbType.NVarChar or SqlDbType.VarBinary)
        {
            var len = v is string s ? s.Length : v is byte[] b ? b.Length : 1;
            p.Size = len > 4000 ? -1 : Math.Max(1, len);
        }
        p.Value = v ?? DBNull.Value;
        return p;
    }

    private static NpgsqlParameter PgParam(NpgsqlCommand cmd, object? v, TargetCol col)
    {
        var p = cmd.CreateParameter();
        switch (col.Kind)
        {
            case Kinds.Json:
                p.NpgsqlDbType = col.TypeText.Contains("jsonb", StringComparison.OrdinalIgnoreCase) ? NpgsqlDbType.Jsonb : NpgsqlDbType.Json;
                break;
            case Kinds.Other:
                p.NpgsqlDbType = NpgsqlDbType.Unknown; // sent as untyped text: the server picks the column's type
                break;
            case Kinds.Date:
                p.NpgsqlDbType = NpgsqlDbType.Date;
                if (v is DateTime d) v = DateOnly.FromDateTime(d);
                break;
            case Kinds.DateTime:
                p.NpgsqlDbType = col.TypeText.Contains("with time zone", StringComparison.OrdinalIgnoreCase) || col.TypeText.Equals("timestamptz", StringComparison.OrdinalIgnoreCase)
                    ? NpgsqlDbType.TimestampTz : NpgsqlDbType.Timestamp;
                if (p.NpgsqlDbType == NpgsqlDbType.TimestampTz && v is DateTime t) v = DateTime.SpecifyKind(t, DateTimeKind.Utc);
                break;
            case Kinds.Time: p.NpgsqlDbType = NpgsqlDbType.Time; break;
            case Kinds.Bool: p.NpgsqlDbType = NpgsqlDbType.Boolean; break;
            case Kinds.Int: p.NpgsqlDbType = NpgsqlDbType.Bigint; break;
            case Kinds.BigInt: p.NpgsqlDbType = NpgsqlDbType.Bigint; break;
            case Kinds.Decimal: p.NpgsqlDbType = NpgsqlDbType.Numeric; break;
            case Kinds.Float: p.NpgsqlDbType = NpgsqlDbType.Double; break;
            case Kinds.Guid: p.NpgsqlDbType = NpgsqlDbType.Uuid; break;
            case Kinds.Binary: p.NpgsqlDbType = NpgsqlDbType.Bytea; break;
            default: p.NpgsqlDbType = NpgsqlDbType.Text; break;
        }
        p.Value = v ?? DBNull.Value;
        return p;
    }

    private static DbParameter SqliteParam(DbCommand cmd, object? v, TargetCol col)
    {
        var p = cmd.CreateParameter();
        p.Value = v switch
        {
            null => DBNull.Value,
            bool b => b ? 1L : 0L,
            DateTime dt when col.Kind == Kinds.Date => dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            DateTime dt => dt.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", CultureInfo.InvariantCulture),
            TimeSpan ts => ts.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture),
            Guid g => g.ToString(),
            decimal m => (double)m,
            _ => v,
        };
        return p;
    }

    private static DbParameter Generic(DbCommand cmd, ImportDialect d, object? v, TargetCol col)
    {
        var p = cmd.CreateParameter();
        if (d.Dialect == Dialect.Snowflake)
        {
            (p.DbType, v) = v switch
            {
                null => (DbType.String, null),
                bool b => (DbType.Boolean, b),
                long l => (DbType.Int64, l),
                decimal m => (DbType.Decimal, m),
                double db => (DbType.Double, db),
                DateTime dt when col.Kind == Kinds.Date => (DbType.Date, dt.Date),
                DateTime dt => (DbType.DateTime, dt),
                TimeSpan ts => (DbType.String, ts.ToString("c", CultureInfo.InvariantCulture)),
                byte[] bytes => (DbType.Binary, bytes),
                Guid g => (DbType.String, g.ToString()),
                _ => (DbType.String, v),
            };
        }
        else if (v is bool bb && d.Dialect == Dialect.MySql) v = bb ? 1 : 0;
        p.Value = v ?? DBNull.Value;
        return p;
    }

    // ---- Oracle array binding

    /// <summary>One bind parameter holding the values of a column of all rows of the batch.</summary>
    public static void AddOracleArray(OracleCommand cmd, ImportDialect d, int index, IReadOnlyList<object?[]> rows, int column, TargetCol col)
    {
        var n = rows.Count;
        var status = new OracleParameterStatus[n];
        var p = new OracleParameter { ParameterName = d.ParameterName(index) };
        switch (col.Kind)
        {
            case Kinds.Bool:
                p.OracleDbType = OracleDbType.Int16;
                p.Value = Fill(rows, column, status, v => v is true ? (short)1 : (short)0, (short)0);
                break;
            case Kinds.Int or Kinds.BigInt:
                p.OracleDbType = OracleDbType.Int64;
                p.Value = Fill(rows, column, status, v => (long)v, 0L);
                break;
            case Kinds.Decimal:
                p.OracleDbType = OracleDbType.Decimal;
                p.Value = Fill(rows, column, status, v => (decimal)v, 0m);
                break;
            case Kinds.Float:
                p.OracleDbType = OracleDbType.BinaryDouble;
                p.Value = Fill(rows, column, status, v => (double)v, 0d);
                break;
            case Kinds.Date or Kinds.DateTime:
                p.OracleDbType = col.TypeText.StartsWith("date", StringComparison.OrdinalIgnoreCase) ? OracleDbType.Date : OracleDbType.TimeStamp;
                p.Value = Fill(rows, column, status, v => (DateTime)v, DateTime.MinValue);
                break;
            case Kinds.Time:
                p.OracleDbType = OracleDbType.Varchar2;
                p.Value = Fill(rows, column, status, v => ((TimeSpan)v).ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture), "");
                break;
            case Kinds.Guid:
                if (col.TypeText.StartsWith("raw", StringComparison.OrdinalIgnoreCase))
                {
                    p.OracleDbType = OracleDbType.Raw;
                    p.Value = Fill(rows, column, status, v => ((Guid)v).ToByteArray(), Array.Empty<byte>());
                }
                else
                {
                    p.OracleDbType = OracleDbType.Varchar2;
                    p.Value = Fill(rows, column, status, v => ((Guid)v).ToString(), "");
                }
                break;
            case Kinds.Binary:
                p.OracleDbType = OracleDbType.Raw;
                p.Value = Fill(rows, column, status, v => (byte[])v, Array.Empty<byte>());
                break;
            default:
                var national = col.TypeText.StartsWith("n", StringComparison.OrdinalIgnoreCase);
                p.OracleDbType = national ? OracleDbType.NVarchar2 : OracleDbType.Varchar2;
                p.Value = Fill(rows, column, status, v => v as string ?? CellConverter.Text(v), "");
                break;
        }
        p.ArrayBindStatus = status;
        cmd.Parameters.Add(p);
    }

    private static T[] Fill<T>(IReadOnlyList<object?[]> rows, int column, OracleParameterStatus[] status, Func<object, T> map, T nullValue)
    {
        var a = new T[rows.Count];
        for (var i = 0; i < a.Length; i++)
        {
            var v = rows[i][column];
            if (v is null) { a[i] = nullValue; status[i] = OracleParameterStatus.NullInsert; }
            else { a[i] = map(v); status[i] = OracleParameterStatus.Success; }
        }
        return a;
    }
}
