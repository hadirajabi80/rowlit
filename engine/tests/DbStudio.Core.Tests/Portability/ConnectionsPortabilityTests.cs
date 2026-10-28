using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Providers;
using DbStudio.Core.Services;
using DbStudio.Core.Services.Portability;
using DbStudio.Core.Services.Tunnels;
using DbStudio.Core.Tests.M2;
using DbStudio.Providers.Sqlite;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace DbStudio.Core.Tests.Portability;

/// <summary>WP-5: the connections file (export, preview, import) over real stores; encryption round trip and failure modes.</summary>
public sealed class ConnectionsPortabilityTests : IDisposable
{
    private const string Pass = "correct horse battery";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "dbstudio-portability-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    /// <summary>A machine: its own data dir, secret store and stores. "redis" is a fake keyvalue provider with SSH and SASL secrets.</summary>
    private sealed record Machine(ConnectionStore Store, ConnectionsPortabilityService Svc, InMemorySecretStore Secrets);

    private Machine NewMachine(string name)
    {
        var redis = new FakeSourceProvider("redis", SourceKind.KeyValue, [new FormField("saslPassword", "SASL password", "password"), .. SshFormFields.Fields()]);
        var registry = new SourceRegistry(new ProviderRegistry([new SqliteProvider()]), [redis]);
        var secrets = new InMemorySecretStore();
        var store = new ConnectionStore(new AppPaths(Path.Combine(_root, name)), secrets, registry);
        return new Machine(store, new ConnectionsPortabilityService(store, registry), secrets);
    }

    private static ConnectionProfile Cache(string name = "cache", string folder = "Prod") => new()
    {
        Name = name,
        ProviderId = "redis",
        Color = "#ef4444",
        Folder = folder,
        ReadOnly = true,
        Props = new()
        {
            ["host"] = "redis.internal",
            ["port"] = 6380,
            [SshFormFields.Enabled] = true,
            [SshFormFields.Host] = "bastion.example.com",
            [SshFormFields.Port] = 2222,
            [SshFormFields.User] = "deploy",
            [SshFormFields.Auth] = SshFormFields.AuthKey,
            [SshFormFields.KeyPath] = "C:\\keys\\id_ed25519",
            [SshFormFields.Passphrase] = "key-pass-phrase-123",
            ["saslPassword"] = "sasl-secret-456",
        },
    };

    private static ConnectionProfile Lite(string name = "local") => new() { Name = name, ProviderId = "sqlite", Props = new() { ["path"] = "C:\\data\\x.db" } };

    private static string Seed(Machine m)
    {
        var id = m.Store.Create(Cache(), "redis-password-789").Id;
        m.Store.Create(Lite(), null);
        return id;
    }

    private static void AssertNoPlaintext(string content)
    {
        foreach (var secret in new[] { "redis-password-789", "key-pass-phrase-123", "sasl-secret-456" })
            Assert.DoesNotContain(secret, content);
    }

    // ---- export ---------------------------------------------------------------------------------------------------------

    [Fact]
    public void Export_without_passwords_by_default_keeps_settings_and_the_ssh_tunnel_but_no_secret()
    {
        var m = NewMachine("a");
        Seed(m);

        var result = m.Svc.Export(new ExportRequest(null));

        AssertNoPlaintext(result.Content);
        Assert.Equal(2, result.Count);
        Assert.Equal(0, result.SecretsIncluded);
        Assert.EndsWith(".rowlit-connections.json", result.FileName);
        var file = JsonSerializer.Deserialize<ConnectionsFile>(result.Content, CoreJson.Options)!;
        Assert.Equal("rowlit-connections", file.Format);
        Assert.Equal(ConnectionsFormat.PasswordsNone, file.Passwords);
        Assert.Null(file.Secrets);
        Assert.Null(file.Encryption);
        var cache = file.Connections.Single(c => c.Name == "cache");
        Assert.Equal("Prod", cache.Folder);
        Assert.Equal("#ef4444", cache.Color);
        Assert.True(cache.ReadOnly);
        Assert.False(cache.HasSecrets);
        Assert.Equal("bastion.example.com", cache.Props[SshFormFields.Host]!.GetValue<string>());
        Assert.Equal("C:\\keys\\id_ed25519", cache.Props[SshFormFields.KeyPath]!.GetValue<string>());
        Assert.False(cache.Props.ContainsKey("saslPassword"));
        Assert.False(cache.Props.ContainsKey(SshFormFields.Passphrase));
        Assert.False(cache.Props.ContainsKey(SshFormFields.Password));
    }

    [Fact]
    public void Export_of_selected_ids_and_unknown_id()
    {
        var m = NewMachine("a");
        var id = Seed(m);
        var one = m.Svc.Export(new ExportRequest([id]));
        Assert.Equal(1, one.Count);
        Assert.Contains("redis.internal", one.Content);
        Assert.DoesNotContain("C:\\\\data", one.Content);
        var ex = Assert.Throws<EngineException>(() => m.Svc.Export(new ExportRequest(["nope"])));
        Assert.Equal(404, ex.Status);
    }

    [Fact]
    public void Linked_databases_are_not_exported()
    {
        var m = NewMachine("a");
        // "linked" is not a provider of this registry, so write it the way the Federation module would: straight into the file
        File.WriteAllText(Path.Combine(_root, "a", "connections.json"),
            """{"version":1,"connections":[{"id":"c_link","name":"my link","providerId":"linked","props":{"members":[]}},{"id":"c_lite","name":"lite","providerId":"sqlite","props":{"path":"x.db"}}]}""");
        var fresh = new ConnectionStore(new AppPaths(Path.Combine(_root, "a")), m.Secrets, new SourceRegistry(new ProviderRegistry([new SqliteProvider()]), []));
        var result = new ConnectionsPortabilityService(fresh, new SourceRegistry(new ProviderRegistry([new SqliteProvider()]), [])).Export(new ExportRequest(null));
        Assert.Equal(1, result.Count);
        Assert.Equal(["my link"], result.Skipped);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    public void Export_with_passwords_needs_a_passphrase_of_eight_characters(string? passphrase)
    {
        var m = NewMachine("a");
        Seed(m);
        var ex = Assert.Throws<EngineException>(() => m.Svc.Export(new ExportRequest(null, true, passphrase)));
        Assert.Equal(ErrorCodes.Validation, ex.Code);
        Assert.Equal("passphrase", JsonSerializer.SerializeToElement(ex.Detail).GetProperty("field").GetString());
    }

    [Fact]
    public void Export_with_passwords_seals_every_secret_and_the_file_leaks_none()
    {
        var m = NewMachine("a");
        Seed(m);

        var result = m.Svc.Export(new ExportRequest(null, true, Pass));

        AssertNoPlaintext(result.Content);
        Assert.DoesNotContain(Pass, result.Content);
        Assert.Equal(1, result.SecretsIncluded);
        var file = JsonSerializer.Deserialize<ConnectionsFile>(result.Content, CoreJson.Options)!;
        Assert.Equal(ConnectionsFormat.PasswordsEncrypted, file.Passwords);
        Assert.Equal("pbkdf2-sha256", file.Encryption!.Kdf);
        Assert.Equal("aes-256-gcm", file.Encryption.Cipher);
        Assert.Equal(600_000, file.Encryption.Iterations);
        Assert.NotEmpty(file.Secrets!);
        Assert.True(file.Connections.Single(c => c.Name == "cache").HasSecrets);
        Assert.False(file.Connections.Single(c => c.Name == "local").HasSecrets);
        // two exports of the same data never share salt, nonce or ciphertext
        var again = JsonSerializer.Deserialize<ConnectionsFile>(m.Svc.Export(new ExportRequest(null, true, Pass)).Content, CoreJson.Options)!;
        Assert.NotEqual(file.Encryption.Salt, again.Encryption!.Salt);
        Assert.NotEqual(file.Encryption.Nonce, again.Encryption.Nonce);
        Assert.NotEqual(file.Secrets, again.Secrets);
    }

    [Fact]
    public void Export_with_passwords_but_none_stored_writes_a_plain_file()
    {
        var m = NewMachine("a");
        m.Store.Create(Lite(), null);
        var result = m.Svc.Export(new ExportRequest(null, true, Pass));
        var file = JsonSerializer.Deserialize<ConnectionsFile>(result.Content, CoreJson.Options)!;
        Assert.Equal(0, result.SecretsIncluded);
        Assert.Equal(ConnectionsFormat.PasswordsNone, file.Passwords);
    }

    // ---- import ---------------------------------------------------------------------------------------------------------

    [Fact]
    public void Round_trip_with_passwords_restores_every_secret_and_setting_on_another_machine()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null, true, Pass)).Content;

        var b = NewMachine("b");
        var preview = b.Svc.Preview(new ImportPreviewRequest(content, Pass));
        Assert.True(preview.Encrypted);
        Assert.True(preview.Unlocked);
        Assert.All(preview.Items, i => Assert.Equal("new", i.Action));
        Assert.Contains(preview.Items, i => i.Name == "cache" && i.Ssh && i.HasSecrets);

        var result = b.Svc.Import(new ImportRequest(content, Pass));

        Assert.Equal((2, 0, 0), (result.Created, result.Updated, result.Skipped));
        Assert.True(result.PasswordsImported);
        Assert.Empty(result.Errors);
        var cache = b.Store.List().Single(c => c.Name == "cache");
        Assert.Equal("redis-password-789", b.Store.GetPassword(cache.Id));
        Assert.Equal("key-pass-phrase-123", b.Store.GetSecret(cache.Id, SshFormFields.Passphrase));
        Assert.Equal("sasl-secret-456", b.Store.GetSecret(cache.Id, "saslPassword"));
        Assert.True(cache.HasPassword);
        Assert.Equal("Prod", cache.Folder);
        Assert.Equal("#ef4444", cache.Color);
        Assert.True(cache.ReadOnly);
        Assert.Equal("redis.internal", cache.GetString("host"));
        Assert.Equal(6380, cache.GetInt("port", 0));
        Assert.True(cache.GetBool(SshFormFields.Enabled));
        Assert.Equal("bastion.example.com", cache.GetString(SshFormFields.Host));
        Assert.Equal(2222, cache.GetInt(SshFormFields.Port, 0));
        Assert.Equal("deploy", cache.GetString(SshFormFields.User));
        Assert.Equal("C:\\keys\\id_ed25519", cache.GetString(SshFormFields.KeyPath));
        // the saved profile on disk holds none of the secrets
        AssertNoPlaintext(File.ReadAllText(Path.Combine(_root, "b", "connections.json")));
        // the tunnel settings are usable as imported
        var withSecrets = b.Store.WithSecrets(cache);
        Assert.Equal("key-pass-phrase-123", SshSettings.From(withSecrets).Passphrase);
    }

    [Fact]
    public void Import_of_a_plain_file_never_brings_passwords()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null)).Content;
        var b = NewMachine("b");

        var preview = b.Svc.Preview(new ImportPreviewRequest(content));
        Assert.False(preview.Encrypted);
        Assert.False(preview.Unlocked);
        var result = b.Svc.Import(new ImportRequest(content));

        Assert.Equal(2, result.Created);
        Assert.False(result.PasswordsImported);
        var cache = b.Store.List().Single(c => c.Name == "cache");
        Assert.Null(b.Store.GetPassword(cache.Id));
        Assert.False(cache.HasPassword);
        Assert.Null(b.Store.GetSecret(cache.Id, "saslPassword"));
    }

    [Fact]
    public void Encrypted_file_imported_without_a_passphrase_brings_the_connections_but_not_the_passwords()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null, true, Pass)).Content;
        var b = NewMachine("b");

        var preview = b.Svc.Preview(new ImportPreviewRequest(content));
        Assert.True(preview.Encrypted);
        Assert.False(preview.Unlocked);

        var result = b.Svc.Import(new ImportRequest(content, null));
        Assert.Equal(2, result.Created);
        Assert.False(result.PasswordsImported);
        Assert.Null(b.Store.GetPassword(b.Store.List().Single(c => c.Name == "cache").Id));
    }

    [Fact]
    public void Wrong_passphrase_is_a_clear_error_on_preview_and_import_and_nothing_is_imported()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null, true, Pass)).Content;
        var b = NewMachine("b");

        foreach (var attempt in new Action[]
        {
            () => b.Svc.Preview(new ImportPreviewRequest(content, "not the passphrase")),
            () => b.Svc.Import(new ImportRequest(content, "not the passphrase")),
        })
        {
            var ex = Assert.Throws<EngineException>(attempt);
            Assert.Equal(400, ex.Status);
            Assert.Contains("Wrong passphrase", ex.Message);
            Assert.Equal("passphrase", JsonSerializer.SerializeToElement(ex.Detail).GetProperty("field").GetString());
            Assert.DoesNotContain("not the passphrase", ex.Message);
        }
        Assert.Empty(b.Store.List());
    }

    [Fact]
    public void A_modified_file_fails_authentication()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null, true, Pass)).Content;
        var b = NewMachine("b");

        // flip one ciphertext byte
        var file = JsonSerializer.Deserialize<ConnectionsFile>(content, CoreJson.Options)!;
        var bytes = Convert.FromBase64String(file.Secrets!);
        bytes[0] ^= 0x01;
        file.Secrets = Convert.ToBase64String(bytes);
        var tampered = JsonSerializer.Serialize(file, CoreJson.Options);
        Assert.Contains("Wrong passphrase", Assert.Throws<EngineException>(() => b.Svc.Preview(new ImportPreviewRequest(tampered, Pass))).Message);

        // the KDF settings are authenticated too
        file = JsonSerializer.Deserialize<ConnectionsFile>(content, CoreJson.Options)!;
        file.Encryption = file.Encryption! with { Iterations = file.Encryption.Iterations + 1 };
        var other = JsonSerializer.Serialize(file, CoreJson.Options);
        Assert.Throws<EngineException>(() => b.Svc.Preview(new ImportPreviewRequest(other, Pass)));

        // absurd iteration counts are refused before any work is done
        file.Encryption = file.Encryption with { Iterations = int.MaxValue };
        Assert.Contains("out of range", Assert.Throws<EngineException>(() => b.Svc.Preview(new ImportPreviewRequest(JsonSerializer.Serialize(file, CoreJson.Options), Pass))).Message);
    }

    [Fact]
    public void Update_by_name_keeps_the_id_and_the_stored_passwords_when_the_file_has_none()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null)).Content;

        var b = NewMachine("b");
        var mine = b.Store.Create(Cache("CACHE", "Old folder"), "my-own-password");
        var other = b.Store.Create(Lite("elsewhere"), null);

        var preview = b.Svc.Preview(new ImportPreviewRequest(content));
        var item = preview.Items.Single(i => i.Name == "cache");
        Assert.Equal("update", item.Action); // names match case-insensitively
        Assert.Equal(mine.Id, item.ExistingId);
        Assert.Equal("new", preview.Items.Single(i => i.Name == "local").Action);

        var result = b.Svc.Import(new ImportRequest(content));

        Assert.Equal((1, 1, 0), (result.Created, result.Updated, result.Skipped));
        Assert.Equal(mine.Id, result.Items.Single(i => i.Action == "update").Id);
        var updated = b.Store.Get(mine.Id);
        Assert.Equal("cache", updated.Name);
        Assert.Equal("Prod", updated.Folder);
        Assert.Equal("my-own-password", b.Store.GetPassword(mine.Id)); // the file had no password: keep
        Assert.Equal("sasl-secret-456", b.Store.GetSecret(mine.Id, "saslPassword")); // so are the extra secrets of the existing one
        Assert.Equal(3, b.Store.List().Count);
        Assert.NotNull(b.Store.Find(other.Id));
    }

    [Fact]
    public void Update_with_passwords_replaces_them()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null, true, Pass)).Content;
        var b = NewMachine("b");
        var mine = b.Store.Create(Cache(), "stale");

        var result = b.Svc.Import(new ImportRequest(content, Pass));

        Assert.Equal(1, result.Updated);
        Assert.Equal("redis-password-789", b.Store.GetPassword(mine.Id));
    }

    [Fact]
    public void Actions_override_the_proposal_and_a_new_connection_gets_a_unique_name()
    {
        var a = NewMachine("a");
        Seed(a);
        var content = a.Svc.Export(new ExportRequest(null)).Content;
        var b = NewMachine("b");
        b.Store.Create(Cache(), null);

        var result = b.Svc.Import(new ImportRequest(content, null, [new ImportAction("1", "new"), new ImportAction("2", "skip")]));

        Assert.Equal((1, 0, 1), (result.Created, result.Updated, result.Skipped));
        Assert.Equal(["cache", "cache (2)"], b.Store.List().Select(c => c.Name).Order().ToArray());
        Assert.DoesNotContain(b.Store.List(), c => c.Name == "local");
        // importing the same file again as new never overwrites
        b.Svc.Import(new ImportRequest(content, null, [new ImportAction("1", "new"), new ImportAction("2", "skip")]));
        Assert.Contains(b.Store.List(), c => c.Name == "cache (3)");
    }

    [Fact]
    public void Two_connections_of_a_file_with_one_name_do_not_both_update_the_same_saved_one()
    {
        var m = NewMachine("a");
        var file = new ConnectionsFile
        {
            Format = ConnectionsFormat.Format,
            Version = ConnectionsFormat.Version,
            Connections =
            [
                new() { Ref = "1", Name = "dup", ProviderId = "sqlite", Props = new() { ["path"] = "a.db" } },
                new() { Ref = "2", Name = "dup", ProviderId = "sqlite", Props = new() { ["path"] = "b.db" } },
            ],
        };
        m.Store.Create(Lite("dup"), null);
        var result = m.Svc.Import(new ImportRequest(JsonSerializer.Serialize(file, CoreJson.Options)));
        Assert.Equal((1, 1, 0), (result.Created, result.Updated, result.Skipped));
        Assert.Equal(2, m.Store.List().Count);
    }

    [Fact]
    public void Unknown_providers_are_proposed_as_skip_and_reported()
    {
        var m = NewMachine("a");
        var file = new ConnectionsFile
        {
            Format = ConnectionsFormat.Format,
            Version = ConnectionsFormat.Version,
            Connections =
            [
                new() { Ref = "1", Name = "lite", ProviderId = "sqlite", Props = new() { ["path"] = "a.db" } },
                new() { Ref = "2", Name = "mystery", ProviderId = "nosuchdb", Props = new() },
                new() { Ref = "3", Name = "link", ProviderId = "linked", Props = new() },
                new() { Ref = "4", Name = "", ProviderId = "sqlite", Props = new() },
            ],
        };
        var content = JsonSerializer.Serialize(file, CoreJson.Options);

        var preview = m.Svc.Preview(new ImportPreviewRequest(content));
        Assert.Equal(["new", "skip", "skip", "skip"], preview.Items.Select(i => i.Action).ToArray());
        Assert.All(preview.Items.Skip(1), i => Assert.NotNull(i.Problem));

        // even an explicit "new" cannot import them
        var result = m.Svc.Import(new ImportRequest(content, null, [new ImportAction("2", "new"), new ImportAction("3", "update")]));
        Assert.Equal((1, 0, 3), (result.Created, result.Updated, result.Skipped));
        Assert.Equal(3, result.Errors.Count);
        Assert.Single(m.Store.List());
    }

    [Fact]
    public void A_connection_the_store_refuses_is_reported_and_the_others_still_import()
    {
        var m = NewMachine("a");
        var file = new ConnectionsFile
        {
            Format = ConnectionsFormat.Format,
            Version = ConnectionsFormat.Version,
            Connections =
            [
                new() { Ref = "1", Name = "no host", ProviderId = "redis", Props = new() }, // "Host" is required
                new() { Ref = "2", Name = "fine", ProviderId = "sqlite", Props = new() { ["path"] = "a.db" } },
            ],
        };
        var result = m.Svc.Import(new ImportRequest(JsonSerializer.Serialize(file, CoreJson.Options)));
        Assert.Equal((1, 0, 1), (result.Created, result.Updated, result.Skipped));
        var error = Assert.Single(result.Errors);
        Assert.Equal("no host", error.Name);
        Assert.Contains("Host", error.Message);
    }

    [Fact]
    public void A_hand_edited_file_cannot_smuggle_secrets_in_the_props_when_no_passphrase_unlocked_it()
    {
        var m = NewMachine("a");
        var file = new ConnectionsFile
        {
            Format = ConnectionsFormat.Format,
            Version = ConnectionsFormat.Version,
            Connections =
            [
                new()
                {
                    Ref = "1", Name = "edited", ProviderId = "redis",
                    Props = new() { ["host"] = "h", ["password"] = "plain-1", ["saslPassword"] = "plain-2", [SshFormFields.Password] = "plain-3" },
                },
            ],
        };
        var result = m.Svc.Import(new ImportRequest(JsonSerializer.Serialize(file, CoreJson.Options)));
        Assert.Equal(1, result.Created);
        var saved = m.Store.List().Single();
        Assert.Null(m.Store.GetPassword(saved.Id));
        Assert.Null(m.Store.GetSecret(saved.Id, "saslPassword"));
        Assert.Null(m.Store.GetSecret(saved.Id, SshFormFields.Password));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json at all")]
    [InlineData("{\"hello\":1}")]
    [InlineData("[1,2]")]
    [InlineData("{\"format\":\"something-else\",\"version\":1,\"connections\":[]}")]
    public void Files_that_are_not_connection_files_are_refused(string content)
    {
        var m = NewMachine("a");
        var ex = Assert.Throws<EngineException>(() => m.Svc.Preview(new ImportPreviewRequest(content)));
        Assert.Equal(ErrorCodes.Validation, ex.Code);
        Assert.Throws<EngineException>(() => m.Svc.Import(new ImportRequest(content)));
    }

    [Fact]
    public void A_newer_format_version_is_refused_with_a_hint()
    {
        var m = NewMachine("a");
        var ex = Assert.Throws<EngineException>(() => m.Svc.Preview(new ImportPreviewRequest("""{"format":"rowlit-connections","version":99,"connections":[]}""")));
        Assert.Contains("newer Rowlit", ex.Message);
    }

    [Fact]
    public void Unknown_import_action_is_a_validation_error()
    {
        var m = NewMachine("a");
        m.Store.Create(Lite(), null);
        var content = m.Svc.Export(new ExportRequest(null)).Content;
        var ex = Assert.Throws<EngineException>(() => m.Svc.Import(new ImportRequest(content, null, [new ImportAction("1", "delete")])));
        Assert.Equal("actions", JsonSerializer.SerializeToElement(ex.Detail).GetProperty("field").GetString());
    }

    // ---- HTTP -----------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Endpoints_export_preview_and_report_a_wrong_passphrase_as_400()
    {
        var m = NewMachine("http");
        Seed(m);
        await using var app = await StartAsync(m);
        var http = app.GetTestClient();
        http.BaseAddress = new Uri("http://localhost/api/v1/");

        var res = await http.PostAsJsonAsync("connections/export", new { ids = (string[]?)null, includeSecrets = true, passphrase = Pass }, CoreJson.Options);
        Assert.Equal(200, (int)res.StatusCode);
        var exported = JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(2, exported.GetProperty("count").GetInt32());
        Assert.Equal(1, exported.GetProperty("secretsIncluded").GetInt32());
        var content = exported.GetProperty("content").GetString()!;
        AssertNoPlaintext(content);

        var ok = await http.PostAsJsonAsync("connections/import/preview", new { content, passphrase = Pass }, CoreJson.Options);
        var preview = JsonDocument.Parse(await ok.Content.ReadAsStringAsync()).RootElement;
        Assert.True(preview.GetProperty("unlocked").GetBoolean());
        Assert.Equal(2, preview.GetProperty("items").GetArrayLength());
        Assert.Equal("update", preview.GetProperty("items")[0].GetProperty("action").GetString());

        var bad = await http.PostAsJsonAsync("connections/import/preview", new { content, passphrase = "nope nope nope" }, CoreJson.Options);
        Assert.Equal(400, (int)bad.StatusCode);
        var error = JsonDocument.Parse(await bad.Content.ReadAsStringAsync()).RootElement.GetProperty("error");
        Assert.Equal("VALIDATION", error.GetProperty("code").GetString());
        Assert.Equal("passphrase", error.GetProperty("detail").GetProperty("field").GetString());
        Assert.DoesNotContain("nope nope nope", error.GetRawText());

        var short1 = await http.PostAsJsonAsync("connections/export", new { includeSecrets = true, passphrase = "abc" }, CoreJson.Options);
        Assert.Equal(400, (int)short1.StatusCode);
    }

    private static async Task<WebApplication> StartAsync(Machine m)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();
        var s = builder.Services;
        s.Configure<JsonOptions>(o => CoreJson.Configure(o.SerializerOptions));
        s.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
        s.AddSingleton(m.Svc);
        var app = builder.Build();
        app.Use(async (ctx, next) =>
        {
            try { await next(ctx); }
            catch (EngineException ex)
            {
                ctx.Response.StatusCode = ex.Status;
                await ctx.Response.WriteAsJsonAsync(new { error = new { code = ex.Code, message = ex.Message, detail = ex.Detail } }, CoreJson.Options);
            }
        });
        // only the two endpoints that need the service alone are mapped (import also resets catalog and source clients)
        var module = new ConnectionsPortabilityModule();
        module.MapEndpoints(app.MapGroup("/api/v1"));
        await app.StartAsync();
        return app;
    }
}
