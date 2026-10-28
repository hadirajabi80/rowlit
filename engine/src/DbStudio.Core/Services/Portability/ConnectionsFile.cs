using System.Text.Json.Nodes;

namespace DbStudio.Core.Services.Portability;

// WP-5 wire shapes. The file (`*.rowlit-connections.json`) is the same JSON the API returns from /connections/export.
// Wire mirror: ui/src/components/ConnectionsPanel/portability.ts.

/// <summary>Constants of the connections file format.</summary>
public static class ConnectionsFormat
{
    public const string Format = "rowlit-connections";
    public const int Version = 1;
    public const string PasswordsNone = "none", PasswordsEncrypted = "encrypted";
    public const string ActionNew = "new", ActionUpdate = "update", ActionSkip = "skip";
    /// <summary>Provider id of linked databases: their members are connection ids of this machine, so they are not exported.</summary>
    public const string LinkedProviderId = "linked";
    public const int MaxFileBytes = 8 * 1024 * 1024, MaxConnections = 2000;
}

/// <summary>
/// The file. <see cref="Passwords"/> says whether secrets are included (<c>none</c> by default); when <c>encrypted</c>,
/// <see cref="Encryption"/> holds the KDF/cipher parameters and <see cref="Secrets"/> the base64 AES-GCM ciphertext (tag
/// appended) of a JSON map <c>ref → { key → value }</c>. Everything else is plain text.
/// </summary>
public sealed class ConnectionsFile
{
    public string Format { get; set; } = "";
    public int Version { get; set; }
    public string App { get; set; } = "Rowlit";
    public DateTimeOffset ExportedAt { get; set; }
    public string Passwords { get; set; } = ConnectionsFormat.PasswordsNone;
    public EncryptionInfo? Encryption { get; set; }
    public string? Secrets { get; set; }
    public List<ExportedConnection> Connections { get; set; } = [];
}

/// <summary>One connection of the file; <see cref="Ref"/> is local to the file (the ids of this machine are not exported).</summary>
public sealed class ExportedConnection
{
    public string Ref { get; set; } = "";
    public string Name { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string? Color { get; set; }
    public string? Folder { get; set; }
    public bool ReadOnly { get; set; }
    public bool SavePassword { get; set; } = true;
    /// <summary>True when the encrypted secrets hold a password (or another secret) for this connection.</summary>
    public bool HasSecrets { get; set; }
    /// <summary>Non-secret props, SSH tunnel settings included (<c>ssh.*</c>).</summary>
    public Dictionary<string, JsonNode?> Props { get; set; } = new();
}

/// <summary><c>POST /connections/export</c>: <paramref name="Ids"/> null or empty = every connection.</summary>
public sealed record ExportRequest(IReadOnlyList<string>? Ids, bool IncludeSecrets = false, string? Passphrase = null);

/// <summary>The file as text, ready to be written to disk, plus what went into it.</summary>
public sealed record ExportResult(string FileName, string Content, int Count, int SecretsIncluded, IReadOnlyList<string> Skipped);

/// <summary><c>POST /connections/import/preview</c>: reads the file and proposes an action per connection.</summary>
public sealed record ImportPreviewRequest(string? Content, string? Passphrase = null);

/// <param name="Encrypted">The file carries encrypted passwords.</param>
/// <param name="Unlocked">The passphrase was given and right: the passwords will be imported.</param>
/// <param name="Version">Version of the file format.</param>
public sealed record ImportPreview(bool Encrypted, bool Unlocked, int Version, DateTimeOffset? ExportedAt, IReadOnlyList<ImportPreviewItem> Items);

/// <param name="Action">The proposed action: <c>new</c>, <c>update</c> (the saved connection with the same name) or <c>skip</c> (cannot be imported, see <paramref name="Problem"/>).</param>
/// <param name="ExistingId">The saved connection <c>update</c> would replace.</param>
/// <param name="Ssh">The connection uses an SSH tunnel.</param>
public sealed record ImportPreviewItem(
    string Ref,
    string Name,
    string ProviderId,
    string? Folder,
    string? Color,
    bool ReadOnly,
    bool HasSecrets,
    bool Ssh,
    string Action,
    string? ExistingId,
    string? Problem);

/// <summary><c>POST /connections/import</c>: <paramref name="Actions"/> overrides the proposal per ref (a missing ref takes the proposal).</summary>
public sealed record ImportRequest(string? Content, string? Passphrase = null, IReadOnlyList<ImportAction>? Actions = null);

public sealed record ImportAction(string Ref, string Action);

public sealed record ImportResult(int Created, int Updated, int Skipped, IReadOnlyList<ImportItemResult> Items, IReadOnlyList<ImportError> Errors, bool PasswordsImported);

/// <param name="Action">What was done: <c>new</c>, <c>update</c> or <c>skip</c>.</param>
public sealed record ImportItemResult(string Ref, string Name, string Action, string? Id);

public sealed record ImportError(string Ref, string Name, string Message);
