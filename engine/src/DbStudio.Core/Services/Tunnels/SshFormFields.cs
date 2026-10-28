using System.Text.Json.Nodes;
using DbStudio.Core.Models;

namespace DbStudio.Core.Services.Tunnels;

/// <summary>
/// WP-SSH: the "SSH tunnel" block of a provider's connection form. Providers add it with one line
/// (<c>SshFormFields.Append(spec)</c>); the fields carry <see cref="FormField.Section"/> = <see cref="Section"/> so the dialog
/// renders them in their own collapsible block. The two secrets are password-typed, so <see cref="ConnectionStore"/>
/// strips them from connections.json and keeps them in the secret store like any other extra secret (D12).
/// </summary>
public static class SshFormFields
{
    public const string Section = "ssh";

    public const string Enabled = "ssh.enabled", Host = "ssh.host", Port = "ssh.port", User = "ssh.user", Auth = "ssh.auth",
        KeyPath = "ssh.keyPath", KeepAlive = "ssh.keepAlive", Password = "sshPassword", Passphrase = "sshPassphrase",
        Unsupported = "ssh.unsupported";

    public const string AuthPassword = "password", AuthKey = "key";
    public const int DefaultPort = 22;

    private const string DefaultHelp = "Connect through an SSH server (bastion / jump host); Rowlit forwards a local port to the database.";

    private static readonly Dictionary<string, string> On = new() { [Enabled] = "true" };
    private static readonly Dictionary<string, string> OnPassword = new() { [Enabled] = "true", [Auth] = AuthPassword };
    private static readonly Dictionary<string, string> OnKey = new() { [Enabled] = "true", [Auth] = AuthKey };

    /// <summary>The block, with <paramref name="help"/> (provider limits) under the switch.</summary>
    public static IReadOnlyList<FormField> Fields(string? help = null) =>
    [
        new(Enabled, "Use SSH tunnel", "bool", Default: JsonValue.Create(false), Help: help ?? DefaultHelp, Section: Section),
        new(Host, "SSH host", "text", Required: true, Placeholder: "bastion.example.com", VisibleWhen: On, Section: Section),
        new(Port, "SSH port", "number", Default: JsonValue.Create(DefaultPort), VisibleWhen: On, Section: Section),
        new(User, "SSH user", "text", Required: true, VisibleWhen: On, Section: Section),
        new(Auth, "SSH authentication", "select", Default: JsonValue.Create(AuthPassword),
            Options: [new(AuthPassword, "Password"), new(AuthKey, "Private key")], VisibleWhen: On, Section: Section),
        new(Password, "SSH password", "password", VisibleWhen: OnPassword, Section: Section),
        new(KeyPath, "Private key file", "file", Required: true, Placeholder: @"C:\Users\me\.ssh\id_ed25519", VisibleWhen: OnKey,
            Help: "OpenSSH (ed25519, ECDSA, RSA) or PEM keys. PuTTY .ppk files are not supported: export them as OpenSSH with PuTTYgen.",
            Section: Section),
        new(Passphrase, "Key passphrase", "password", VisibleWhen: OnKey, Help: "Empty when the key is not encrypted.", Section: Section),
        new(KeepAlive, "Send keep-alives", "bool", Default: JsonValue.Create(true), VisibleWhen: On,
            Help: "Every 30 s, so idle firewalls and NAT do not drop the tunnel.", Section: Section),
    ];

    /// <summary><paramref name="spec"/> followed by the SSH block.</summary>
    public static ConnectionFormSpec Append(ConnectionFormSpec spec, string? help = null) => new([.. spec.Fields, .. Fields(help)]);

    /// <summary>
    /// <paramref name="spec"/> followed by a read-only note in the SSH block (providers whose protocol cannot go through one
    /// forwarded port, e.g. Kafka brokers that advertise their own addresses).
    /// </summary>
    public static ConnectionFormSpec WithUnsupportedNote(ConnectionFormSpec spec, string reason) =>
        new([.. spec.Fields, new FormField(Unsupported, "SSH tunnel", "note", Help: reason, Section: Section)]);
}
