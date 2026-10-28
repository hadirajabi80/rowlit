using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services.Tunnels;

namespace DbStudio.Core.Services.Portability;

/// <summary>
/// WP-5: export / import of saved connections as a team file. Connection settings (SSH tunnel included) are plain JSON.
/// Passwords and the other secrets (SSH password, key passphrase, SASL…) leave the machine only when the caller asks and
/// gives a passphrase; they are then sealed with <see cref="PassphraseBox"/> (PBKDF2-SHA256 + AES-256-GCM). Secrets and
/// passphrases are never logged, never part of an exception message and never returned by the preview.
/// </summary>
public sealed class ConnectionsPortabilityService(ConnectionStore store, SourceRegistry sources)
{
    // ---- export ---------------------------------------------------------------------------------------------------------

    public ExportResult Export(ExportRequest? request)
    {
        request ??= new ExportRequest(null);
        var passphrase = request.IncludeSecrets ? RequirePassphrase(request.Passphrase) : null;

        var all = store.List();
        var chosen = new List<ConnectionProfile>();
        if (request.Ids is { Count: > 0 })
        {
            foreach (var id in request.Ids.Distinct(StringComparer.Ordinal))
                chosen.Add(all.FirstOrDefault(c => c.Id == id) ?? throw EngineException.NotFound($"Connection '{id}'"));
        }
        else chosen.AddRange(all);

        var skipped = chosen.Where(IsLinked).Select(c => c.Name).ToList();
        chosen = chosen.Where(c => !IsLinked(c)).ToList();
        if (chosen.Count == 0) throw EngineException.Validation("There is no connection to export.", new { field = "ids" });

        var file = new ConnectionsFile { Format = ConnectionsFormat.Format, Version = ConnectionsFormat.Version, ExportedAt = DateTimeOffset.UtcNow };
        var secrets = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        var n = 0;
        foreach (var p in chosen)
        {
            var reference = (++n).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var item = new ExportedConnection
            {
                Ref = reference,
                Name = p.Name,
                ProviderId = p.ProviderId,
                Color = p.Color,
                Folder = p.Folder,
                ReadOnly = p.ReadOnly,
                SavePassword = p.SavePassword,
                // saved profiles never hold secret props (ConnectionStore strips them); drop any that slipped in anyway
                Props = p.Props.Where(kv => !store.IsSecretProp(p.ProviderId, kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone()),
            };
            if (request.IncludeSecrets && store.SecretsOf(p) is { Count: > 0 } own)
            {
                secrets[reference] = own.ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);
                item.HasSecrets = true;
            }
            file.Connections.Add(item);
        }

        if (secrets.Count > 0)
        {
            var plain = JsonSerializer.SerializeToUtf8Bytes(secrets);
            var (info, sealedBytes) = PassphraseBox.Seal(plain, passphrase!, ConnectionsFormat.Format, ConnectionsFormat.Version);
            System.Security.Cryptography.CryptographicOperations.ZeroMemory(plain);
            file.Passwords = ConnectionsFormat.PasswordsEncrypted;
            file.Encryption = info;
            file.Secrets = Convert.ToBase64String(sealedBytes);
        }

        var content = JsonSerializer.Serialize(file, CoreJson.Indented);
        return new ExportResult($"connections-{DateTime.Now:yyyy-MM-dd}.rowlit-connections.json", content, file.Connections.Count, secrets.Count, skipped);
    }

    // ---- import ---------------------------------------------------------------------------------------------------------

    public ImportPreview Preview(ImportPreviewRequest? request)
    {
        var (file, secrets) = Read(request?.Content, request?.Passphrase);
        var items = Plan(file);
        return new ImportPreview(
            file.Passwords == ConnectionsFormat.PasswordsEncrypted,
            secrets is not null,
            file.Version,
            file.ExportedAt == default ? null : file.ExportedAt,
            items.Select(i => i.Item).ToList());
    }

    public ImportResult Import(ImportRequest? request)
    {
        var (file, secrets) = Read(request?.Content, request?.Passphrase);
        var plan = Plan(file);
        var overrides = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var a in request?.Actions ?? [])
        {
            if (string.IsNullOrEmpty(a.Ref)) continue;
            var action = a.Action?.Trim().ToLowerInvariant();
            if (action is not (ConnectionsFormat.ActionNew or ConnectionsFormat.ActionUpdate or ConnectionsFormat.ActionSkip))
                throw EngineException.Validation($"Unknown import action '{a.Action}'.", new { field = "actions" });
            overrides[a.Ref] = action;
        }

        int created = 0, updated = 0, skipped = 0;
        var results = new List<ImportItemResult>();
        var errors = new List<ImportError>();
        var passwordsImported = false;
        var claimed = new HashSet<string>(StringComparer.Ordinal); // saved connections already updated by this import

        foreach (var (item, source) in plan)
        {
            var action = item.Problem is not null ? ConnectionsFormat.ActionSkip : overrides.GetValueOrDefault(item.Ref) ?? item.Action;
            if (action == ConnectionsFormat.ActionSkip)
            {
                skipped++;
                results.Add(new ImportItemResult(item.Ref, item.Name, ConnectionsFormat.ActionSkip, null));
                if (item.Problem is not null) errors.Add(new ImportError(item.Ref, item.Name, item.Problem));
                continue;
            }

            try
            {
                var own = secrets is not null && secrets.TryGetValue(item.Ref, out var s) ? s : null;
                var (profile, password, hadSecret) = Build(source, own);
                var existing = action == ConnectionsFormat.ActionUpdate ? FindByName(profile.Name, claimed) : null;
                if (existing is not null)
                {
                    claimed.Add(existing.Id);
                    var saved = store.Update(existing.Id, profile, password);
                    updated++;
                    results.Add(new ImportItemResult(item.Ref, saved.Name, ConnectionsFormat.ActionUpdate, saved.Id));
                }
                else
                {
                    profile.Name = UniqueName(profile.Name);
                    var saved = store.Create(profile, password);
                    created++;
                    results.Add(new ImportItemResult(item.Ref, saved.Name, ConnectionsFormat.ActionNew, saved.Id));
                }
                passwordsImported |= hadSecret;
            }
            catch (EngineException ex)
            {
                errors.Add(new ImportError(item.Ref, item.Name, ex.Message));
                results.Add(new ImportItemResult(item.Ref, item.Name, ConnectionsFormat.ActionSkip, null));
                skipped++;
            }
        }
        return new ImportResult(created, updated, skipped, results, errors, passwordsImported);
    }

    // ---- reading the file -----------------------------------------------------------------------------------------------

    /// <summary>Parses and checks the file; decrypts the secrets when it has some and the passphrase is given (400 when it is wrong).</summary>
    private static (ConnectionsFile File, Dictionary<string, Dictionary<string, string>>? Secrets) Read(string? content, string? passphrase)
    {
        if (string.IsNullOrWhiteSpace(content)) throw EngineException.Validation("The connections file is empty.", new { field = "content" });
        if (Encoding.UTF8.GetByteCount(content) > ConnectionsFormat.MaxFileBytes)
            throw EngineException.Validation("The connections file is too large (8 MB at most).", new { field = "content" });
        ConnectionsFile? file;
        try
        {
            file = JsonSerializer.Deserialize<ConnectionsFile>(content, CoreJson.Options);
        }
        catch (JsonException)
        {
            throw NotAConnectionsFile();
        }
        if (file is null || !string.Equals(file.Format, ConnectionsFormat.Format, StringComparison.Ordinal) || file.Connections is null) throw NotAConnectionsFile();
        if (file.Version < 1 || file.Version > ConnectionsFormat.Version)
            throw EngineException.Validation($"This file was made by a newer Rowlit (format version {file.Version}); update Rowlit to import it.", new { field = "content" });
        if (file.Connections.Count > ConnectionsFormat.MaxConnections)
            throw EngineException.Validation($"The file lists more than {ConnectionsFormat.MaxConnections} connections.", new { field = "content" });

        Dictionary<string, Dictionary<string, string>>? secrets = null;
        if (file.Passwords == ConnectionsFormat.PasswordsEncrypted && !string.IsNullOrEmpty(passphrase))
        {
            if (file.Encryption is null || string.IsNullOrEmpty(file.Secrets))
                throw EngineException.Validation("The encrypted passwords of this file are missing.", new { field = "content" });
            byte[] sealedBytes;
            try
            {
                sealedBytes = Convert.FromBase64String(file.Secrets);
            }
            catch (FormatException)
            {
                throw EngineException.Validation("The encrypted passwords of this file are damaged.", new { field = "content" });
            }
            var plain = PassphraseBox.Open(sealedBytes, file.Encryption, passphrase, file.Format, file.Version);
            try
            {
                secrets = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(plain) ?? new();
            }
            catch (JsonException)
            {
                throw EngineException.Validation("The encrypted passwords of this file are damaged.", new { field = "content" });
            }
            finally
            {
                System.Security.Cryptography.CryptographicOperations.ZeroMemory(plain);
            }
        }
        return (file, secrets);
    }

    private static EngineException NotAConnectionsFile() =>
        EngineException.Validation("This is not a Rowlit connections file.", new { field = "content" });

    // ---- planning -------------------------------------------------------------------------------------------------------

    private List<(ImportPreviewItem Item, ExportedConnection Source)> Plan(ConnectionsFile file)
    {
        var existing = store.List();
        var claimed = new HashSet<string>(StringComparer.Ordinal);
        var seenRefs = new HashSet<string>(StringComparer.Ordinal);
        var plan = new List<(ImportPreviewItem, ExportedConnection)>();
        var n = 0;
        foreach (var c in file.Connections)
        {
            n++;
            if (c is null) continue;
            var reference = string.IsNullOrEmpty(c.Ref) || !seenRefs.Add(c.Ref) ? $"#{n}" : c.Ref;
            seenRefs.Add(reference);
            c.Ref = reference;
            var name = (c.Name ?? "").Trim();
            c.Props ??= new();
            string? problem = null;
            if (name.Length == 0) problem = "The connection has no name.";
            else if (string.Equals(c.ProviderId, ConnectionsFormat.LinkedProviderId, StringComparison.OrdinalIgnoreCase))
                problem = "Linked databases are not imported (they refer to connections of the other machine).";
            else if (sources.Find(c.ProviderId) is null)
                problem = $"This Rowlit does not know the provider '{c.ProviderId}'.";

            ConnectionProfile? match = null;
            if (problem is null)
            {
                match = existing.FirstOrDefault(e => !claimed.Contains(e.Id) && NameEquals(e.Name, name));
                if (match is not null) claimed.Add(match.Id);
            }
            var action = problem is not null ? ConnectionsFormat.ActionSkip : match is not null ? ConnectionsFormat.ActionUpdate : ConnectionsFormat.ActionNew;
            var ssh = c.Props.TryGetValue(SshFormFields.Enabled, out var v) && v is JsonValue jv && (jv.TryGetValue<bool>(out var b) ? b : bool.TryParse(jv.ToString(), out var pb) && pb);
            plan.Add((new ImportPreviewItem(reference, name, c.ProviderId ?? "", Blank(c.Folder), Blank(c.Color), c.ReadOnly, c.HasSecrets, ssh, action, match?.Id, problem), c));
        }
        return plan;
    }

    /// <summary>The profile to save (no secret props, the id left empty) with the password and whether any secret was applied.</summary>
    private (ConnectionProfile Profile, string? Password, bool HadSecret) Build(ExportedConnection source, Dictionary<string, string>? secrets)
    {
        var providerId = sources.Get(source.ProviderId).Id;
        var profile = new ConnectionProfile
        {
            Name = source.Name.Trim(),
            ProviderId = providerId,
            Color = Blank(source.Color),
            Folder = Blank(source.Folder),
            ReadOnly = source.ReadOnly,
            SavePassword = source.SavePassword,
            // a hand-edited file could carry secrets in the clear: only the decrypted ones count
            Props = source.Props.Where(kv => !store.IsSecretProp(providerId, kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone()),
        };
        string? password = null;
        var hadSecret = false;
        if (secrets is not null)
        {
            foreach (var (key, value) in secrets)
            {
                if (string.IsNullOrEmpty(value) || !store.IsSecretProp(providerId, key)) continue;
                hadSecret = true;
                if (key.Equals("password", StringComparison.OrdinalIgnoreCase)) password = value;
                else profile.Props[key] = JsonValue.Create(value);
            }
        }
        return (profile, password, hadSecret);
    }

    private ConnectionProfile? FindByName(string name, HashSet<string> claimed) =>
        store.List().FirstOrDefault(e => !claimed.Contains(e.Id) && NameEquals(e.Name, name));

    /// <summary>"name", else "name (2)", "name (3)"… so a second import of the same file as "new" does not produce look-alikes.</summary>
    private string UniqueName(string name)
    {
        var taken = store.List().Select(c => c.Name.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!taken.Contains(name)) return name;
        for (var i = 2; ; i++)
        {
            var candidate = $"{name} ({i})";
            if (!taken.Contains(candidate)) return candidate;
        }
    }

    private static bool NameEquals(string a, string b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
    private static bool IsLinked(ConnectionProfile p) => string.Equals(p.ProviderId, ConnectionsFormat.LinkedProviderId, StringComparison.OrdinalIgnoreCase);
    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    private static string RequirePassphrase(string? passphrase)
    {
        if (string.IsNullOrEmpty(passphrase)) throw EngineException.Validation("A passphrase is required to include passwords.", new { field = "passphrase" });
        if (passphrase.Length < PassphraseBox.MinPassphraseLength)
            throw EngineException.Validation($"The passphrase must have at least {PassphraseBox.MinPassphraseLength} characters.", new { field = "passphrase" });
        return passphrase;
    }
}
