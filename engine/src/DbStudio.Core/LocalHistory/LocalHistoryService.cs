using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using DbStudio.Core.Services;
using Microsoft.Data.Sqlite;

namespace DbStudio.Core.LocalHistory;

/// <summary>Why a snapshot was taken (wire value of <c>reason</c>).</summary>
public static class SnapshotReasons
{
    public const string Run = "run";
    public const string Save = "save";
    public const string Close = "close";
    public const string Auto = "auto";
    public const string Restore = "restore";
    public const string Manual = "manual";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) { Run, Save, Close, Auto, Restore, Manual };
}

/// <summary>One snapshot without its text (list rows). <see cref="Size"/> is the length of the text in characters.</summary>
public sealed record SnapshotInfo(long Id, string Key, string At, string Reason, string? Label, int Size, string? Title);

/// <summary>One snapshot with its text.</summary>
public sealed record SnapshotText(long Id, string Key, string At, string Reason, string? Label, int Size, string? Title, string Text);

/// <summary>POST /local-history body.</summary>
public sealed record SnapshotInput(string? Key, string? Text, string? Reason, string? Label, string? Title);

/// <summary>PATCH /local-history/{id} body: <c>label</c> null or blank clears the label.</summary>
public sealed record SnapshotPatch(string? Label);

/// <summary>POST /local-history/prune body; absent members use the defaults.</summary>
public sealed record PruneRequest(int? Days, long? MaxBytes, int? PerKey);

/// <summary>What a snapshot request did: <see cref="Added"/> false = the text equals the key's latest snapshot.</summary>
public sealed record AddResult(long Id, bool Added);

/// <summary>What a prune removed.</summary>
public sealed record PruneResult(int Removed, long Bytes);

/// <summary>
/// Local history of editors (DataGrip's signature safety net) in <c>local-history.db</c> next to <c>history.db</c>: one row
/// per snapshot of an editor's text, keyed by the tab identity the UI derives (saved query id, file path, object, or the
/// console tab id). Text is stored gzip-compressed. Identical consecutive texts are not stored twice, each key keeps at
/// most <see cref="DefaultPerKey"/> unlabelled snapshots, and <see cref="PruneAsync"/> enforces an age and a total size
/// cap. A labelled snapshot is never pruned or trimmed: a label is the user saying "keep this".
/// </summary>
public sealed class LocalHistoryService : IDisposable
{
    public const int MaxKeyLength = 1024;
    public const int MaxLabelLength = 200;
    public const int MaxTitleLength = 200;
    public const int MaxTextChars = 5_000_000;
    public const int DefaultPerKey = 200;
    public const int DefaultDays = 30;
    public const long DefaultMaxBytes = 20L * 1024 * 1024;
    public const int MaxListLimit = 500;

    private readonly string _connectionString;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private bool _initialized;

    public LocalHistoryService(AppPaths paths)
    {
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(paths.DataDir, "local-history.db"),
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString();
    }

    private async Task<SqliteConnection> OpenAsync(CancellationToken ct)
    {
        var c = new SqliteConnection(_connectionString);
        await c.OpenAsync(ct).ConfigureAwait(false);
        if (!_initialized)
        {
            await ExecAsync(c, """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS snapshots (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  key TEXT NOT NULL,
                  at TEXT NOT NULL,
                  reason TEXT NOT NULL,
                  label TEXT,
                  title TEXT,
                  size INTEGER NOT NULL,
                  hash TEXT NOT NULL,
                  bytes INTEGER NOT NULL,
                  data BLOB NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_snapshots_key ON snapshots(key, id);
                CREATE INDEX IF NOT EXISTS ix_snapshots_at ON snapshots(at);
                """, ct).ConfigureAwait(false);
            _initialized = true;
            // Disk growth is capped once per engine start, whatever the UI does later.
            await PruneCoreAsync(c, DateTimeOffset.UtcNow.AddDays(-DefaultDays), DefaultMaxBytes, DefaultPerKey, ct).ConfigureAwait(false);
        }
        return c;
    }

    private static async Task ExecAsync(SqliteConnection c, string sql, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    public static byte[] Compress(string text)
    {
        var raw = Encoding.UTF8.GetBytes(text);
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Fastest, leaveOpen: true)) gz.Write(raw);
        return ms.ToArray();
    }

    public static string Decompress(byte[] data)
    {
        using var input = new MemoryStream(data);
        using var gz = new GZipStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream();
        gz.CopyTo(output);
        return Encoding.UTF8.GetString(output.ToArray());
    }

    private static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    private static string FormatTime(DateTimeOffset t) => t.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static string? CleanLabel(string? label)
    {
        var t = label?.Trim();
        if (string.IsNullOrEmpty(t)) return null;
        if (t.Length > MaxLabelLength) throw EngineException.Validation($"A label is at most {MaxLabelLength} characters.", new { field = "label" });
        return t;
    }

    /// <summary>Stores a snapshot unless the text equals the key's latest one (then a given label is put on that one).</summary>
    public async Task<AddResult> AddAsync(SnapshotInput? input, DateTimeOffset? now = null, CancellationToken ct = default)
    {
        var key = input?.Key?.Trim();
        if (string.IsNullOrEmpty(key)) throw EngineException.Validation("key is required.", new { field = "key" });
        if (key.Length > MaxKeyLength) throw EngineException.Validation($"key is at most {MaxKeyLength} characters.", new { field = "key" });
        var text = input!.Text;
        if (text is null) throw EngineException.Validation("text is required.", new { field = "text" });
        if (text.Length > MaxTextChars) throw EngineException.Validation($"text is larger than {MaxTextChars:N0} characters.", new { field = "text" });
        var reason = input.Reason ?? SnapshotReasons.Auto;
        if (!SnapshotReasons.All.Contains(reason)) throw EngineException.Validation($"reason must be one of {string.Join(", ", SnapshotReasons.All.Order())}.", new { field = "reason" });
        var label = CleanLabel(input.Label);
        var title = input.Title?.Trim();
        if (title is { Length: > MaxTitleLength }) title = title[..MaxTitleLength];
        if (string.IsNullOrEmpty(title)) title = null;

        var hash = Hash(text);
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var c = await OpenAsync(ct).ConfigureAwait(false);
            await using (var last = c.CreateCommand())
            {
                last.CommandText = "SELECT id, hash, label FROM snapshots WHERE key = $k ORDER BY id DESC LIMIT 1";
                last.Parameters.AddWithValue("$k", key);
                await using var r = await last.ExecuteReaderAsync(ct).ConfigureAwait(false);
                if (await r.ReadAsync(ct).ConfigureAwait(false) && r.GetString(1) == hash)
                {
                    var id = r.GetInt64(0);
                    var hasLabel = !r.IsDBNull(2);
                    await r.DisposeAsync().ConfigureAwait(false);
                    if (label is not null && !hasLabel) await SetLabelAsync(c, id, label, ct).ConfigureAwait(false);
                    return new AddResult(id, false);
                }
            }

            var data = Compress(text);
            long newId;
            await using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = """
                    INSERT INTO snapshots (key, at, reason, label, title, size, hash, bytes, data)
                    VALUES ($k, $at, $r, $l, $t, $s, $h, $b, $d);
                    SELECT last_insert_rowid();
                    """;
                cmd.Parameters.AddWithValue("$k", key);
                cmd.Parameters.AddWithValue("$at", FormatTime(now ?? DateTimeOffset.UtcNow));
                cmd.Parameters.AddWithValue("$r", reason);
                cmd.Parameters.AddWithValue("$l", (object?)label ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$t", (object?)title ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$s", text.Length);
                cmd.Parameters.AddWithValue("$h", hash);
                cmd.Parameters.AddWithValue("$b", data.Length);
                cmd.Parameters.AddWithValue("$d", data);
                newId = Convert.ToInt64(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false), CultureInfo.InvariantCulture);
            }
            await TrimKeyAsync(c, key, DefaultPerKey, ct).ConfigureAwait(false);
            return new AddResult(newId, true);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task TrimKeyAsync(SqliteConnection c, string key, int perKey, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = """
            DELETE FROM snapshots WHERE key = $k AND label IS NULL
              AND id NOT IN (SELECT id FROM snapshots WHERE key = $k AND label IS NULL ORDER BY id DESC LIMIT $n)
            """;
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$n", perKey);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    private static async Task SetLabelAsync(SqliteConnection c, long id, string? label, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE snapshots SET label = $l WHERE id = $i";
        cmd.Parameters.AddWithValue("$l", (object?)label ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$i", id);
        await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
    }

    /// <summary>Snapshots of any of <paramref name="keys"/>, newest first, without their text.</summary>
    /// <param name="before">Return entries with id &lt; before (paging).</param>
    public async Task<IReadOnlyList<SnapshotInfo>> ListAsync(IReadOnlyList<string> keys, int limit, long? before, CancellationToken ct = default)
    {
        if (keys.Count == 0) throw EngineException.Validation("key is required.", new { field = "key" });
        limit = Math.Clamp(limit, 1, MaxListLimit);
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var c = await OpenAsync(ct).ConfigureAwait(false);
            await using var cmd = c.CreateCommand();
            var names = new List<string>();
            for (var i = 0; i < keys.Count; i++)
            {
                names.Add($"$k{i}");
                cmd.Parameters.AddWithValue($"$k{i}", keys[i]);
            }
            var sql = new StringBuilder($"SELECT id, key, at, reason, label, size, title FROM snapshots WHERE key IN ({string.Join(',', names)})");
            if (before is not null)
            {
                sql.Append(" AND id < $before");
                cmd.Parameters.AddWithValue("$before", before.Value);
            }
            sql.Append(" ORDER BY id DESC LIMIT $limit");
            cmd.Parameters.AddWithValue("$limit", limit);
            cmd.CommandText = sql.ToString();
            var list = new List<SnapshotInfo>();
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false))
                list.Add(new SnapshotInfo(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4), r.GetInt32(5), r.IsDBNull(6) ? null : r.GetString(6)));
            return list;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<SnapshotText> GetAsync(long id, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var c = await OpenAsync(ct).ConfigureAwait(false);
            await using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT id, key, at, reason, label, size, title, data FROM snapshots WHERE id = $i";
            cmd.Parameters.AddWithValue("$i", id);
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            if (!await r.ReadAsync(ct).ConfigureAwait(false)) throw EngineException.NotFound($"Snapshot {id}");
            return new SnapshotText(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4), r.GetInt32(5),
                r.IsDBNull(6) ? null : r.GetString(6), Decompress((byte[])r.GetValue(7)));
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Sets or clears (null / blank) the label of a snapshot; false when it does not exist.</summary>
    public async Task<bool> LabelAsync(long id, string? label, CancellationToken ct = default)
    {
        var clean = CleanLabel(label);
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var c = await OpenAsync(ct).ConfigureAwait(false);
            await using var cmd = c.CreateCommand();
            cmd.CommandText = "UPDATE snapshots SET label = $l WHERE id = $i";
            cmd.Parameters.AddWithValue("$l", (object?)clean ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$i", id);
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<bool> DeleteAsync(long id, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var c = await OpenAsync(ct).ConfigureAwait(false);
            await using var cmd = c.CreateCommand();
            cmd.CommandText = "DELETE FROM snapshots WHERE id = $i";
            cmd.Parameters.AddWithValue("$i", id);
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false) > 0;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Removes every snapshot (labelled ones too) of the given keys; returns how many.</summary>
    public async Task<int> ClearAsync(IReadOnlyList<string> keys, CancellationToken ct = default)
    {
        if (keys.Count == 0) throw EngineException.Validation("key is required.", new { field = "key" });
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var c = await OpenAsync(ct).ConfigureAwait(false);
            await using var cmd = c.CreateCommand();
            var names = new List<string>();
            for (var i = 0; i < keys.Count; i++)
            {
                names.Add($"$k{i}");
                cmd.Parameters.AddWithValue($"$k{i}", keys[i]);
            }
            cmd.CommandText = $"DELETE FROM snapshots WHERE key IN ({string.Join(',', names)})";
            return await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Drops unlabelled snapshots older than <paramref name="days"/> and, oldest first, enough others to stay within
    /// <paramref name="maxBytes"/> of compressed text; also applies the per-key cap. Labelled snapshots are never pruned.
    /// </summary>
    public async Task<PruneResult> PruneAsync(PruneRequest? request, CancellationToken ct = default)
    {
        var days = request?.Days ?? DefaultDays;
        var maxBytes = request?.MaxBytes ?? DefaultMaxBytes;
        var perKey = request?.PerKey ?? DefaultPerKey;
        if (days < 1 || days > 3650) throw EngineException.Validation("days must be between 1 and 3650.", new { field = "days" });
        if (maxBytes < 1024 * 1024) throw EngineException.Validation("maxBytes must be at least 1 MB.", new { field = "maxBytes" });
        if (perKey < 1 || perKey > 10_000) throw EngineException.Validation("perKey must be between 1 and 10000.", new { field = "perKey" });
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            await using var c = await OpenAsync(ct).ConfigureAwait(false);
            return await PruneCoreAsync(c, DateTimeOffset.UtcNow.AddDays(-days), maxBytes, perKey, ct).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    private static async Task<PruneResult> PruneCoreAsync(SqliteConnection c, DateTimeOffset cutoff, long maxBytes, int perKey, CancellationToken ct)
    {
        var removed = 0;
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "DELETE FROM snapshots WHERE label IS NULL AND at < $cut";
            cmd.Parameters.AddWithValue("$cut", FormatTime(cutoff));
            removed += await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = """
                DELETE FROM snapshots WHERE label IS NULL AND id IN (
                  SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY key ORDER BY id DESC) AS n FROM snapshots WHERE label IS NULL) WHERE n > $n)
                """;
            cmd.Parameters.AddWithValue("$n", perKey);
            removed += await cmd.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
        }
        long total;
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT COALESCE(SUM(bytes), 0) FROM snapshots";
            total = Convert.ToInt64(await cmd.ExecuteScalarAsync(ct).ConfigureAwait(false), CultureInfo.InvariantCulture);
        }
        while (total > maxBytes)
        {
            // Oldest unlabelled snapshots first, in batches.
            var ids = new List<(long Id, long Bytes)>();
            await using (var cmd = c.CreateCommand())
            {
                cmd.CommandText = "SELECT id, bytes FROM snapshots WHERE label IS NULL ORDER BY id LIMIT 200";
                await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
                while (await r.ReadAsync(ct).ConfigureAwait(false)) ids.Add((r.GetInt64(0), r.GetInt64(1)));
            }
            if (ids.Count == 0) break;
            foreach (var (id, bytes) in ids)
            {
                if (total <= maxBytes) break;
                await using var del = c.CreateCommand();
                del.CommandText = "DELETE FROM snapshots WHERE id = $i";
                del.Parameters.AddWithValue("$i", id);
                removed += await del.ExecuteNonQueryAsync(ct).ConfigureAwait(false);
                total -= bytes;
            }
        }
        return new PruneResult(removed, total);
    }

    public void Dispose() => _gate.Dispose();
}
