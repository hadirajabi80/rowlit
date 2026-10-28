using System.Globalization;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Transfer;

namespace DbStudio.Transfer.Tests;

/// <summary>Which sample server a scratch area lives on.</summary>
public enum Kind { MsSql, Pg, MySql, Sqlite }

/// <summary>
/// A scratch schema (SQL Server / PostgreSQL), database (MySQL) or file (SQLite) the test creates and drops. Holds the
/// "library" sample: authors (identity key), books (foreign key, many column types) and a bigger table for batching.
/// </summary>
public sealed class Scratch : IAsyncDisposable
{
    public const int BigRows = 1200;

    private readonly TestEnv _env;
    private readonly Func<Task> _drop;

    private Scratch(TestEnv env, Kind kind, string connectionId, string? database, string schema, Func<Task> drop)
    {
        _env = env;
        Kind = kind;
        ConnectionId = connectionId;
        Database = database;
        Schema = schema;
        _drop = drop;
    }

    public Kind Kind { get; }
    public string ConnectionId { get; }
    public string? Database { get; }
    public string Schema { get; }
    public Dialect Dialect => Kind switch { Kind.MsSql => Dialect.TSql, Kind.Pg => Dialect.PgSql, Kind.MySql => Dialect.MySql, _ => Dialect.Sqlite };

    public static bool Available(Kind kind) => kind switch
    {
        Kind.MsSql => Servers.Reachable(Servers.MsSql),
        Kind.Pg => Servers.Reachable(Servers.Pg),
        Kind.MySql => Servers.Reachable(Servers.MySql),
        _ => !Servers.Disabled,
    };

    public static string NewName(string prefix = "xfer") => prefix + "_" + Guid.NewGuid().ToString("N")[..8];

    /// <summary>Registers the connection of <paramref name="kind"/> in <paramref name="env"/> (idempotent) and creates an empty scratch area.</summary>
    public static async Task<Scratch> CreateEmptyAsync(TestEnv env, Kind kind, string? name = null)
    {
        name ??= NewName();
        switch (kind)
        {
            case Kind.MsSql:
            {
                var id = "c_ms";
                if (!Has(env, id)) env.Add(Servers.MsSqlProfile(id), Servers.MsSqlPassword);
                await env.ExecAsync(id, "shop", $"CREATE SCHEMA [{name}]");
                return new Scratch(env, kind, id, "shop", name, async () =>
                {
                    var tables = await env.QueryAsync(id, "shop", $"SELECT t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = '{name}'");
                    // foreign keys first, then the tables, then the schema
                    var fks = await env.QueryAsync(id, "shop", $"SELECT OBJECT_NAME(parent_object_id), name FROM sys.foreign_keys WHERE SCHEMA_NAME(schema_id) = '{name}'");
                    foreach (var fk in fks) await env.ExecAsync(id, "shop", $"ALTER TABLE [{name}].[{fk[0]}] DROP CONSTRAINT [{fk[1]}]");
                    foreach (var t in tables) await env.ExecAsync(id, "shop", $"DROP TABLE [{name}].[{t[0]}]");
                    await env.ExecAsync(id, "shop", $"DROP SCHEMA [{name}]");
                });
            }
            case Kind.Pg:
            {
                var id = "c_pg";
                if (!Has(env, id)) env.Add(Servers.PgProfile(id), Servers.PgPassword);
                await env.ExecAsync(id, "shop", $"CREATE SCHEMA {name}");
                return new Scratch(env, kind, id, "shop", name, () => env.ExecAsync(id, "shop", $"DROP SCHEMA IF EXISTS {name} CASCADE"));
            }
            case Kind.MySql:
            {
                var id = "c_my";
                if (!Has(env, id)) env.Add(Servers.MySqlProfile(id, null), Servers.MySqlPassword);
                await env.ExecAsync(id, null, $"CREATE DATABASE `{name}`");
                return new Scratch(env, kind, id, null, name, () => env.ExecAsync(id, null, $"DROP DATABASE IF EXISTS `{name}`"));
            }
            default:
            {
                var id = "c_lite_" + name;
                var path = Path.Combine(Path.GetTempPath(), name + ".db");
                env.Add(Servers.SqliteProfile(path, id), null);
                return new Scratch(env, kind, id, null, "main", () =>
                {
                    Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
                    foreach (var f in Directory.GetFiles(Path.GetTempPath(), name + ".db*")) { try { File.Delete(f); } catch (IOException) { } }
                    return Task.CompletedTask;
                });
            }
        }
    }

    private static bool Has(TestEnv env, string id)
    {
        try { env.Resolve(id); return true; }
        catch (EngineException) { return false; }
    }

    public TransferSource AsSource() => new(ConnectionId, Database, Kind == Kind.Sqlite ? null : Schema);

    public TransferTarget AsTarget() => new(ConnectionId, Database, Kind == Kind.Sqlite ? null : Schema);

    public string Q(string table) => TransferSql.Qualified(Dialect, Kind == Kind.Sqlite ? null : Schema, table);

    public Task ExecAsync(params string[] sql) => _env.ExecAsync(ConnectionId, Database, sql);

    public Task<List<object?[]>> QueryAsync(string sql) => _env.QueryAsync(ConnectionId, Database, sql);

    public Task<object?> ScalarAsync(string sql) => _env.ScalarAsync(ConnectionId, Database, sql);

    public async ValueTask DisposeAsync()
    {
        try { await _drop(); }
        catch (Exception) { /* best effort: scratch areas have random names */ }
    }

    // ------------------------------------------------------------------ the library sample

    /// <summary>Creates authors / books / big in the scratch area and fills them.</summary>
    public async Task SeedLibraryAsync()
    {
        var d = Dialect;
        string authorsId, authorsType, bioType, dateType, priceType, floatType, boolType, tsType, blobType, uuidType, createdDefault, titleType, bigintType, bigTable;
        switch (Kind)
        {
            case Kind.MsSql:
                authorsId = "int identity(1,1) not null primary key"; authorsType = "nvarchar(100)"; bioType = "nvarchar(max)"; dateType = "date";
                priceType = "decimal(12,2)"; floatType = "float"; boolType = "bit"; tsType = "datetime2(3)"; blobType = "varbinary(max)"; uuidType = "uniqueidentifier";
                createdDefault = "datetime2(7) not null default sysdatetime()"; titleType = "nvarchar(200)"; bigintType = "bigint"; bigTable = "payload nvarchar(50)";
                break;
            case Kind.Pg:
                authorsId = "integer generated by default as identity primary key"; authorsType = "varchar(100)"; bioType = "text"; dateType = "date";
                priceType = "numeric(12,2)"; floatType = "double precision"; boolType = "boolean"; tsType = "timestamp(3)"; blobType = "bytea"; uuidType = "uuid";
                createdDefault = "timestamp not null default now()"; titleType = "varchar(200)"; bigintType = "bigint"; bigTable = "payload varchar(50)";
                break;
            case Kind.MySql:
                authorsId = "int not null auto_increment primary key"; authorsType = "varchar(100)"; bioType = "longtext"; dateType = "date";
                priceType = "decimal(12,2)"; floatType = "double"; boolType = "boolean"; tsType = "datetime(3)"; blobType = "longblob"; uuidType = "char(36)";
                createdDefault = "datetime not null default current_timestamp"; titleType = "varchar(200)"; bigintType = "bigint"; bigTable = "payload varchar(50)";
                break;
            default:
                authorsId = "integer primary key autoincrement"; authorsType = "varchar(100)"; bioType = "text"; dateType = "date";
                priceType = "decimal(12,2)"; floatType = "real"; boolType = "boolean"; tsType = "datetime"; blobType = "blob"; uuidType = "char(36)";
                createdDefault = "datetime not null default current_timestamp"; titleType = "varchar(200)"; bigintType = "bigint"; bigTable = "payload varchar(50)";
                break;
        }
        await ExecAsync(
            $"CREATE TABLE {Q("authors")} (id {authorsId}, name {authorsType} not null, bio {bioType} null, born {dateType} null)",
            $"CREATE TABLE {Q("books")} (id int not null primary key, author_id int null, title {titleType} not null, price {priceType} null, rating {floatType} null, " +
            $"pages smallint null, big {bigintType} null, is_published {boolType} null, published_at {tsType} null, cover {blobType} null, ext_id {uuidType} null, created {createdDefault}, " +
            $"constraint fk_books_authors foreign key (author_id) references {Q("authors")} (id))",
            $"CREATE TABLE {Q("big")} (id int not null primary key, {bigTable})",
            $"CREATE INDEX ix_books_title ON {Q("books")} (title)");

        TargetColumn C(string name, string type, bool identity = false) => new(name, TypeMapper.Parse(d, type), type, identity, false);
        var authorCols = new[] { C("id", "int", true), C("name", authorsType), C("bio", bioType), C("born", dateType) };
        var bio = string.Concat(Enumerable.Repeat("long bio éü ", 700));
        object?[][] authors =
        [
            [1, "Ada Lovelace", bio, "1815-12-10"],
            [2, "O'Brien \\ back\\slash\nnew line", null, null],
            [3, "مشتری ویژه", "text", "2000-02-29"],
        ];
        await ExecAsync(TransferSql.BuildInsert(d, Q("authors"), authorCols, authors, new InsertMode(Kind != Kind.Sqlite, false)).ToArray());

        var bookCols = new[]
        {
            C("id", "int"), C("author_id", "int"), C("title", titleType), C("price", priceType), C("rating", floatType), C("pages", "smallint"), C("big", bigintType),
            C("is_published", boolType), C("published_at", tsType), C("cover", blobType), C("ext_id", uuidType),
        };
        object?[][] books =
        [
            [1, 1, "Notes", "12.50", 3.5, 300, "9007199254740993", true, "2026-01-05T10:00:00.123", new BinaryValue([0, 1, 2, 255]), "f47ac10b-58cc-4372-a567-0e02b2c3d479"],
            [2, 1, "Tëst \"quotes\" and 'single'", "-0.01", -0.001, -5, "-9007199254740993", false, null, new BinaryValue([]), null],
            [3, 2, "Third", null, null, null, null, null, "1999-12-31T23:59:59", null, null],
        ];
        await ExecAsync(TransferSql.BuildInsert(d, Q("books"), bookCols, books, new InsertMode(false, false)).ToArray());

        var bigCols = new[] { C("id", "int"), C("payload", "varchar(50)") };
        for (var from = 1; from <= BigRows; from += 400)
        {
            var rows = Enumerable.Range(from, Math.Min(400, BigRows - from + 1)).Select(i => new object?[] { i, "row " + i }).ToArray();
            await ExecAsync(TransferSql.BuildInsert(d, Q("big"), bigCols, rows, new InsertMode(false, false)).ToArray());
        }
    }

    // ------------------------------------------------------------------ comparison

    /// <summary>Normalizes a wire value so values from different providers compare equal.</summary>
    public static string Norm(object? v)
    {
        switch (v)
        {
            case null: return "<null>";
            case bool b: return b ? "1" : "0";
            case BinaryValue bin: return Convert.ToHexString(bin.Full);
            case TruncatedValue t: return t.Full;
            case string s:
                if (DateTime.TryParseExact(s, ["yyyy-MM-dd'T'HH:mm:ss.FFFFFFF", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm:ss.FFFFFFF", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd"],
                        CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
                    return dt.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
                if (System.Text.RegularExpressions.Regex.IsMatch(s, @"^-?\d+(\.\d+)?$") && decimal.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var dec))
                    return dec.ToString("0.#############################", CultureInfo.InvariantCulture);
                return s;
            case double dd: return ((decimal)dd).ToString("0.#############################", CultureInfo.InvariantCulture);
            case float ff: return ((decimal)ff).ToString("0.#############################", CultureInfo.InvariantCulture);
            case IFormattable f: return f.ToString(null, CultureInfo.InvariantCulture);
            default: return v.ToString() ?? "";
        }
    }
}
