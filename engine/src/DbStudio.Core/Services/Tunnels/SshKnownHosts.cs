using System.Text.Json;

namespace DbStudio.Core.Services.Tunnels;

/// <summary>
/// WP-SSH: trust on first use for SSH host keys, in <c>ssh-known-hosts.json</c> of the data folder. The first connection to
/// a host:port remembers its key (algorithm + SHA-256 fingerprint); a later connection presenting another key is refused,
/// because that is what a man in the middle looks like. <see cref="Forget"/> removes an entry (the server was reinstalled).
/// Thread-safe; writes are atomic.
/// </summary>
public sealed class SshKnownHosts
{
    private readonly string? _file;
    private readonly object _gate = new();
    private Dictionary<string, Entry>? _entries;

    /// <param name="file">Null = in memory only (tests).</param>
    public SshKnownHosts(string? file) => _file = file;

    public static SshKnownHosts For(AppPaths paths) => new(Path.Combine(paths.DataDir, "ssh-known-hosts.json"));

    public string? FilePath => _file;

    public sealed record Entry(string Algorithm, string Fingerprint, DateTimeOffset FirstSeen);

    public enum Verdict { Trusted, New, Changed }

    public static string Key(string host, int port) => $"[{host.ToLowerInvariant()}]:{port}";

    /// <summary>Checks a presented key; a new host is remembered. <paramref name="known"/> is the stored entry when it differs.</summary>
    public Verdict Check(string host, int port, string algorithm, string fingerprint, out Entry? known)
    {
        lock (_gate)
        {
            var map = Load();
            var key = Key(host, port);
            if (map.TryGetValue(key, out var entry))
            {
                known = entry;
                if (string.Equals(entry.Fingerprint, fingerprint, StringComparison.Ordinal)) return Verdict.Trusted;
                return Verdict.Changed;
            }
            known = null;
            map[key] = new Entry(algorithm, fingerprint, DateTimeOffset.UtcNow);
            Save();
            return Verdict.New;
        }
    }

    public Entry? Find(string host, int port)
    {
        lock (_gate) return Load().GetValueOrDefault(Key(host, port));
    }

    public bool Forget(string host, int port)
    {
        lock (_gate)
        {
            var removed = Load().Remove(Key(host, port));
            if (removed) Save();
            return removed;
        }
    }

    private Dictionary<string, Entry> Load()
    {
        if (_entries is not null) return _entries;
        _entries = new Dictionary<string, Entry>(StringComparer.Ordinal);
        if (_file is not null && File.Exists(_file))
        {
            try
            {
                var doc = JsonSerializer.Deserialize<Dictionary<string, Entry>>(File.ReadAllText(_file), CoreJson.Options);
                if (doc is not null) foreach (var (k, v) in doc) _entries[k] = v;
            }
            catch (JsonException)
            {
                File.Copy(_file, _file + ".corrupt", overwrite: true);
            }
        }
        return _entries;
    }

    private void Save()
    {
        if (_file is null) return;
        AtomicFile.WriteAllText(_file, JsonSerializer.Serialize(_entries, CoreJson.Indented));
    }
}
