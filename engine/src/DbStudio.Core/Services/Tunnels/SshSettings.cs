using System.Security.Cryptography;
using System.Text;
using DbStudio.Core.Models;

namespace DbStudio.Core.Services.Tunnels;

/// <summary>WP-SSH: the SSH hop of a profile (the <c>ssh.*</c> props and the two secrets restored by <see cref="ConnectionStore.WithSecrets"/>).</summary>
public sealed record SshSettings(
    string Host,
    int Port,
    string User,
    string Auth,
    string? KeyPath,
    string? Password,
    string? Passphrase,
    bool KeepAlive,
    int ConnectTimeoutSeconds)
{
    /// <summary>True when the profile asks for a tunnel (<c>ssh.enabled</c>).</summary>
    public static bool IsEnabled(ConnectionProfile profile) => profile.GetBool(SshFormFields.Enabled);

    /// <summary>"user@host" (":port" when not 22): shown as "via …" in the UI.</summary>
    public string Label => Port == SshFormFields.DefaultPort ? $"{User}@{Host}" : $"{User}@{Host}:{Port}";

    /// <summary>
    /// Identity of the SSH hop, secrets included (hashed): a tunnel is reused only while the settings it was opened with
    /// still hold, so editing the profile opens a new one.
    /// </summary>
    public string Fingerprint
    {
        get
        {
            var text = string.Join('\u001f', Host.ToLowerInvariant(), Port, User, Auth, KeyPath ?? "", Password ?? "", Passphrase ?? "", KeepAlive);
            return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..16];
        }
    }

    /// <summary>Reads and validates the SSH settings. Throws a validation <see cref="EngineException"/> naming the field.</summary>
    public static SshSettings From(ConnectionProfile profile)
    {
        var host = profile.GetString(SshFormFields.Host)?.Trim();
        if (string.IsNullOrEmpty(host)) throw EngineException.Validation("'SSH host' is required.", new { field = SshFormFields.Host });
        var port = profile.GetInt(SshFormFields.Port, SshFormFields.DefaultPort);
        if (port is < 1 or > 65535) throw EngineException.Validation($"SSH port {port} is out of range (1-65535).", new { field = SshFormFields.Port });
        var user = profile.GetString(SshFormFields.User)?.Trim();
        if (string.IsNullOrEmpty(user)) throw EngineException.Validation("'SSH user' is required.", new { field = SshFormFields.User });
        var auth = (profile.GetString(SshFormFields.Auth) ?? SshFormFields.AuthPassword).Trim().ToLowerInvariant();
        if (auth is not (SshFormFields.AuthPassword or SshFormFields.AuthKey))
            throw EngineException.Validation($"Unsupported SSH authentication '{auth}'.", new { field = SshFormFields.Auth });
        string? keyPath = null;
        if (auth == SshFormFields.AuthKey)
        {
            // Windows "Copy as path" wraps the path in quotes.
            keyPath = profile.GetString(SshFormFields.KeyPath)?.Trim().Trim('"').Trim();
            if (string.IsNullOrEmpty(keyPath)) throw EngineException.Validation("'Private key file' is required.", new { field = SshFormFields.KeyPath });
            if (keyPath.StartsWith('~')) keyPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), keyPath[1..].TrimStart('/', '\\'));
        }
        return new SshSettings(
            host,
            port,
            user,
            auth,
            keyPath,
            Blank(profile.GetString(SshFormFields.Password)),
            Blank(profile.GetString(SshFormFields.Passphrase)),
            profile.GetBool(SshFormFields.KeepAlive, true),
            Math.Clamp(profile.GetInt("connectTimeout", 15), 1, 120));
    }

    private static string? Blank(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
