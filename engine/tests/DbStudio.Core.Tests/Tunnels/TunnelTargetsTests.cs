using System.Text.Json.Nodes;
using DbStudio.Core.Models;
using DbStudio.Core.Services;
using DbStudio.Core.Services.Tunnels;

namespace DbStudio.Core.Tests.Tunnels;

/// <summary>WP-SSH: per-provider target and rewrite rules (no network).</summary>
public sealed class TunnelTargetsTests
{
    private static ConnectionProfile P(string provider, params (string Key, JsonNode? Value)[] props)
    {
        var p = new ConnectionProfile { Id = "c_1", Name = "n", ProviderId = provider };
        foreach (var (k, v) in props) p.Props[k] = v;
        p.Props[SshFormFields.Enabled] = true;
        p.Props[SshFormFields.Host] = "bastion";
        p.Props[SshFormFields.User] = "me";
        return p;
    }

    private static string Unsupported(ConnectionProfile p)
    {
        var ex = Assert.Throws<EngineException>(() => TunnelTargets.Target(p));
        Assert.Equal(ErrorCodes.NotSupported, ex.Code);
        return ex.Message;
    }

    [Theory]
    [InlineData("postgresql", 5432)]
    [InlineData("mysql", 3306)]
    [InlineData("mariadb", 3306)]
    [InlineData("oracle", 1521)]
    [InlineData("redis", 6379)]
    public void HostPort_providers_default_ports_and_rewrite(string provider, int defaultPort)
    {
        var p = P(provider, ("host", "db.internal"));
        Assert.Equal(new TunnelEndpoint("db.internal", defaultPort), TunnelTargets.Target(p));
        p.Props["port"] = 7000;
        Assert.Equal(new TunnelEndpoint("db.internal", 7000), TunnelTargets.Target(p));

        var r = TunnelTargets.Rewrite(p, "127.0.0.1", 50001);
        Assert.Equal("127.0.0.1", r.GetString("host"));
        Assert.Equal(50001, r.GetInt("port", 0));
        Assert.Equal("db.internal", p.GetString("host")); // the original is untouched
        Assert.Equal("bastion", r.GetString(SshFormFields.Host));
    }

    [Fact]
    public void Postgres_multi_host_and_unix_socket_are_refused()
    {
        Assert.Contains("one host", Unsupported(P("postgresql", ("host", "a,b"))));
        Assert.Contains("Unix socket", Unsupported(P("postgresql", ("host", "/var/run/postgresql"))));
    }

    [Theory]
    [InlineData("db.internal", "db.internal", 1433)]
    [InlineData("db.internal,14333", "db.internal", 14333)]
    [InlineData("tcp:db.internal,1500", "db.internal", 1500)]
    [InlineData(@"db.internal\SQLEXPRESS,1450", "db.internal", 1450)]
    [InlineData(".", "localhost", 1433)]
    [InlineData("(local),1433", "localhost", 1433)]
    public void SqlServer_server_forms(string server, string host, int port)
    {
        var p = P("sqlserver", ("server", server));
        Assert.Equal(new TunnelEndpoint(host, port), TunnelTargets.Target(p));
        Assert.Equal("127.0.0.1,50002", TunnelTargets.Rewrite(p, "127.0.0.1", 50002).GetString("server"));
    }

    [Fact]
    public void SqlServer_named_instance_without_port_and_pipes_are_refused()
    {
        Assert.Contains("named instance", Unsupported(P("sqlserver", ("server", @"db\SQLEXPRESS"))));
        Assert.Contains("np:", Unsupported(P("sqlserver", ("server", @"np:\\db\pipe\sql\query"))));
        Assert.Contains("LocalDB", Unsupported(P("sqlserver", ("server", @"(localdb)\MSSQLLocalDB,1433"))));
    }

    [Fact]
    public void Oracle_needs_the_basic_connection_type()
    {
        Assert.Contains("Basic", Unsupported(P("oracle", ("connectionType", "tns"), ("tnsAlias", "PROD"))));
    }

    [Fact]
    public void ClickHouse_pins_the_protocol_and_reads_urls()
    {
        var https = P("clickhouse", ("host", "ch.internal"), ("port", 8443));
        Assert.Equal(new TunnelEndpoint("ch.internal", 8443), TunnelTargets.Target(https));
        var r = TunnelTargets.Rewrite(https, "127.0.0.1", 50003);
        Assert.Equal("https", r.GetString("protocol")); // not inferred from the random local port
        Assert.Equal(50003, r.GetInt("port", 0));

        var url = P("clickhouse", ("host", "https://abc.cloud:9440"));
        Assert.Equal(new TunnelEndpoint("abc.cloud", 9440), TunnelTargets.Target(url));
        Assert.Equal("127.0.0.1", TunnelTargets.Rewrite(url, "127.0.0.1", 1).GetString("host"));

        Assert.Equal(new TunnelEndpoint("ch", 8123), TunnelTargets.Target(P("clickhouse", ("host", "ch"))));
    }

    [Fact]
    public void Cassandra_single_contact_point()
    {
        var p = P("cassandra", ("contactPoints", "node1"));
        Assert.Equal(new TunnelEndpoint("node1", 9042), TunnelTargets.Target(p));
        var r = TunnelTargets.Rewrite(p, "127.0.0.1", 50004);
        Assert.Equal(["127.0.0.1"], r.GetList("contactPoints"));
        Assert.Equal(50004, r.GetInt("port", 0));
        Assert.Contains("single contact point", Unsupported(P("cassandra", ("contactPoints", new JsonArray("a", "b")))));
        Assert.Contains("secure connect bundle", Unsupported(P("cassandra", ("cloudSecureBundle", @"C:\b.zip"))));
    }

    [Fact]
    public void Redis_cluster_and_sentinel_have_a_clear_message()
    {
        Assert.Contains("Redis Cluster", Unsupported(P("redis", ("mode", "cluster"), ("nodes", "a:1"))));
        Assert.Contains("Sentinel", Unsupported(P("redis", ("mode", "sentinel"), ("sentinels", "a:1"))));
    }

    [Fact]
    public void Mongo_single_host_rewrites_to_a_direct_connection()
    {
        var p = P("mongodb", ("uri", "mongodb://u:p%40ss@db.internal:27018/shop?replicaSet=rs0&authSource=admin"));
        Assert.Equal(new TunnelEndpoint("db.internal", 27018), TunnelTargets.Target(p));
        var uri = TunnelTargets.Rewrite(p, "127.0.0.1", 50005).GetString("uri");
        Assert.Equal("mongodb://u:p%40ss@127.0.0.1:50005/shop?authSource=admin&directConnection=true", uri);

        Assert.Equal(new TunnelEndpoint("h", 27017), TunnelTargets.Target(P("mongodb", ("uri", "mongodb://h"))));
        Assert.Equal("mongodb://127.0.0.1:9/?directConnection=true", TunnelTargets.Rewrite(P("mongodb", ("uri", "mongodb://h")), "127.0.0.1", 9).GetString("uri"));
        Assert.Contains("mongodb+srv://", Unsupported(P("mongodb", ("uri", "mongodb+srv://cluster0.example.net/"))));
        Assert.Contains("one host", Unsupported(P("mongodb", ("uri", "mongodb://a:1,b:2/?replicaSet=rs0"))));
    }

    [Fact]
    public void Elasticsearch_single_url_keeps_scheme_and_path()
    {
        var p = P("elasticsearch", ("url", "https://es.internal:9243/prefix/"));
        Assert.Equal(new TunnelEndpoint("es.internal", 9243), TunnelTargets.Target(p));
        Assert.Equal("https://127.0.0.1:50006/prefix", TunnelTargets.Rewrite(p, "127.0.0.1", 50006).GetString("url"));
        Assert.Equal(new TunnelEndpoint("es", 9200), TunnelTargets.Target(P("elasticsearch", ("url", "es:9200"))));
        Assert.Contains("one node", Unsupported(P("elasticsearch", ("url", "http://a:9200,http://b:9200"))));
    }

    [Theory]
    [InlineData("kafka", "Kafka")]
    [InlineData("snowflake", "snowflake")]
    [InlineData("sqlite", "sqlite")]
    public void Providers_without_tunnels_explain_why(string provider, string mention)
    {
        Assert.Contains(mention, Unsupported(P(provider, ("bootstrapServers", "k:9092"))));
    }

    [Fact]
    public void Settings_validate_and_label()
    {
        var p = P("postgresql", ("host", "h"));
        var s = SshSettings.From(p);
        Assert.Equal("me@bastion", s.Label);
        Assert.Equal(SshFormFields.AuthPassword, s.Auth);
        Assert.True(s.KeepAlive);
        p.Props[SshFormFields.Port] = 2222;
        Assert.Equal("me@bastion:2222", SshSettings.From(p).Label);
        Assert.NotEqual(s.Fingerprint, SshSettings.From(p).Fingerprint);

        p.Props[SshFormFields.Auth] = "key";
        var ex = Assert.Throws<EngineException>(() => SshSettings.From(p));
        Assert.Contains("Private key file", ex.Message);
        p.Props[SshFormFields.KeyPath] = "\"C:\\Users\\me\\.ssh\\id ed25519\"";
        Assert.Equal(@"C:\Users\me\.ssh\id ed25519", SshSettings.From(p).KeyPath); // quotes of "Copy as path" removed, spaces kept

        p.Props.Remove(SshFormFields.User);
        Assert.Contains("SSH user", Assert.Throws<EngineException>(() => SshSettings.From(p)).Message);
    }

    [Fact]
    public void Form_block_is_appended_in_its_section_with_password_typed_secrets()
    {
        var spec = SshFormFields.Append(new ConnectionFormSpec([new FormField("host", "Host", "text")]), "limits");
        Assert.Equal("host", spec.Fields[0].Key);
        var ssh = spec.Fields.Skip(1).ToList();
        Assert.All(ssh, f => Assert.Equal(SshFormFields.Section, f.Section));
        Assert.Equal("limits", ssh[0].Help);
        Assert.Equal("password", ssh.Single(f => f.Key == SshFormFields.Password).Type);
        Assert.Equal("password", ssh.Single(f => f.Key == SshFormFields.Passphrase).Type);
        Assert.Equal("file", ssh.Single(f => f.Key == SshFormFields.KeyPath).Type);

        var note = SshFormFields.WithUnsupportedNote(new ConnectionFormSpec([]), "why").Fields.Single();
        Assert.Equal(("note", "why", SshFormFields.Section), (note.Type, note.Help, note.Section));
    }
}
