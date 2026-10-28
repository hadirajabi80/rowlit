using System.Globalization;
using System.Text.Json.Nodes;
using DbStudio.Core.Models;

namespace DbStudio.Core.Services.Tunnels;

/// <summary>The server behind the tunnel, as the SSH server resolves it ("localhost" = the SSH server itself).</summary>
public sealed record TunnelEndpoint(string Host, int Port);

/// <summary>
/// WP-SSH: per provider, where the database server is (<see cref="Target"/>) and how to point a profile at the local end of
/// the tunnel instead (<see cref="Rewrite"/>). Pure functions over the provider's form-spec keys, so every provider keeps
/// building its connection string as before. A configuration one forwarded port cannot carry (several hosts, discovery
/// through other addresses, named pipes…) throws <see cref="Unsupported"/> with the reason.
/// </summary>
public static class TunnelTargets
{
    /// <summary>Providers whose connections can go through an SSH tunnel.</summary>
    public static readonly IReadOnlySet<string> Supported = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "postgresql", "mysql", "mariadb", "sqlserver", "oracle", "clickhouse", "cassandra", "redis", "mongodb", "elasticsearch",
    };

    /// <summary>The local end of every tunnel.</summary>
    public const string LocalHost = "127.0.0.1";

    public static EngineException Unsupported(string message) =>
        new(400, ErrorCodes.NotSupported, message, new { field = SshFormFields.Enabled, hop = "ssh" });

    public static TunnelEndpoint Target(ConnectionProfile p)
    {
        var id = p.ProviderId.ToLowerInvariant();
        return id switch
        {
            "postgresql" => HostPort(p, "PostgreSQL", 5432),
            "mysql" or "mariadb" => HostPort(p, id == "mysql" ? "MySQL" : "MariaDB", 3306),
            "sqlserver" => SqlServer(p),
            "oracle" => Oracle(p),
            "clickhouse" => ClickHouse(p).Endpoint,
            "cassandra" => Cassandra(p),
            "redis" => Redis(p),
            "mongodb" => Mongo(p).Endpoint,
            "elasticsearch" => Elastic(p).Endpoint,
            "kafka" => throw Unsupported("SSH tunnels are not available for Kafka: the brokers advertise their own addresses, which one forwarded port cannot reach."),
            _ => throw Unsupported($"SSH tunnels are not available for {p.ProviderId} connections."),
        };
    }

    /// <summary>A copy of <paramref name="p"/> whose server address is <paramref name="host"/>:<paramref name="port"/> (the local forward).</summary>
    public static ConnectionProfile Rewrite(ConnectionProfile p, string host, int port)
    {
        var copy = Copy(p);
        var props = copy.Props;
        switch (p.ProviderId.ToLowerInvariant())
        {
            case "postgresql":
            case "mysql":
            case "mariadb":
            case "oracle":
            case "redis":
                props["host"] = host;
                props["port"] = port;
                break;
            case "sqlserver":
                props["server"] = $"{host},{port.ToString(CultureInfo.InvariantCulture)}";
                break;
            case "clickhouse":
                // pin the protocol: it is otherwise inferred from the port (8443 = https), which is now a random local one
                props["protocol"] = ClickHouse(p).Protocol;
                props["host"] = host;
                props["port"] = port;
                break;
            case "cassandra":
                props["contactPoints"] = host;
                props.Remove("host");
                props["port"] = port;
                break;
            case "mongodb":
                props["uri"] = Mongo(p).RewriteTo(host, port);
                break;
            case "elasticsearch":
                props["url"] = Elastic(p).RewriteTo(host, port);
                break;
            default:
                throw Unsupported($"SSH tunnels are not available for {p.ProviderId} connections.");
        }
        return copy;
    }

    /// <summary>A deep copy (props cloned).</summary>
    public static ConnectionProfile Copy(ConnectionProfile p) => new()
    {
        Id = p.Id,
        Name = p.Name,
        ProviderId = p.ProviderId,
        Color = p.Color,
        Folder = p.Folder,
        ReadOnly = p.ReadOnly,
        Props = p.Props.ToDictionary(kv => kv.Key, kv => kv.Value?.DeepClone()),
        HasPassword = p.HasPassword,
        SavePassword = p.SavePassword,
        CreatedAt = p.CreatedAt,
        LastUsedAt = p.LastUsedAt,
    };

    // ------------------------------------------------------------------ providers

    private static TunnelEndpoint HostPort(ConnectionProfile p, string product, int defaultPort)
    {
        var host = p.GetString("host")?.Trim();
        if (string.IsNullOrEmpty(host)) throw EngineException.Validation("Host is required.", new { field = "host" });
        if (host.Contains(',')) throw Unsupported($"Through an SSH tunnel, {product} connects to one host: remove the other hosts from '{host}'.");
        if (host.StartsWith('/')) throw Unsupported($"'{host}' is a Unix socket; an SSH tunnel forwards a TCP port (use the server's host name or localhost).");
        return new TunnelEndpoint(host, Port(p, "port", defaultPort));
    }

    private static int Port(ConnectionProfile p, string key, int fallback)
    {
        var port = p.GetInt(key, fallback);
        if (port is < 1 or > 65535) throw EngineException.Validation($"Port {port} is out of range (1-65535).", new { field = key });
        return port;
    }

    private static TunnelEndpoint SqlServer(ConnectionProfile p)
    {
        var server = p.GetString("server")?.Trim();
        if (string.IsNullOrEmpty(server)) throw EngineException.Validation("Server is required.", new { field = "server" });
        var s = server;
        if (s.StartsWith("tcp:", StringComparison.OrdinalIgnoreCase)) s = s[4..].Trim();
        else if (s.IndexOf(':') is var colon and > 0 && s[..colon] is var proto && proto.All(char.IsLetter) && !s.StartsWith('['))
            throw Unsupported($"'{proto}:' connections cannot go through an SSH tunnel: use a TCP server name (host or host,port).");
        var comma = s.LastIndexOf(',');
        var hostPart = comma >= 0 ? s[..comma].Trim() : s;
        int? port = null;
        if (comma >= 0)
        {
            if (!int.TryParse(s[(comma + 1)..].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var n) || n is < 1 or > 65535)
                throw EngineException.Validation($"'{server}': the port after the comma is not valid.", new { field = "server" });
            port = n;
        }
        var slash = hostPart.IndexOf('\\');
        if (slash >= 0)
        {
            if (port is null)
                throw Unsupported($"'{server}' is a named instance, found through the SQL Server Browser (UDP 1434), which an SSH tunnel cannot carry: give the instance's port, e.g. {hostPart[..slash]},1433.");
            hostPart = hostPart[..slash];
        }
        if (hostPart.StartsWith("(localdb)", StringComparison.OrdinalIgnoreCase))
            throw Unsupported("LocalDB runs on this computer and cannot go through an SSH tunnel.");
        if (hostPart is "." or "(local)" || hostPart.Length == 0) hostPart = "localhost";
        return new TunnelEndpoint(hostPart, port ?? 1433);
    }

    private static TunnelEndpoint Oracle(ConnectionProfile p)
    {
        var type = (p.GetString("connectionType") ?? "basic").Trim().ToLowerInvariant();
        if (type is not ("basic" or ""))
            throw Unsupported("Through an SSH tunnel, Oracle needs the Basic connection type (host, port and service name or SID): a TNS alias or connect descriptor can name other addresses.");
        return HostPort(p, "Oracle", 1521);
    }

    private static (TunnelEndpoint Endpoint, string Protocol) ClickHouse(ConnectionProfile p)
    {
        var raw = p.GetString("host")?.Trim();
        if (string.IsNullOrEmpty(raw)) throw EngineException.Validation("Host is required.", new { field = "host" });
        // same rules as ChConnections.Protocol / Host / Port
        var proto = p.GetString("protocol")?.Trim().ToLowerInvariant();
        if (proto is not ("http" or "https")) proto = p.GetInt("port", 8123) is 8443 or 443 ? "https" : "http";
        var fallback = proto == "https" ? 8443 : 8123;
        var host = raw;
        if (Uri.TryCreate(raw, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
        {
            host = uri.Host;
            if (!uri.IsDefaultPort && !p.Props.ContainsKey("port")) fallback = uri.Port;
        }
        return (new TunnelEndpoint(host, Port(p, "port", fallback)), proto);
    }

    private static TunnelEndpoint Cassandra(ConnectionProfile p)
    {
        if (!string.IsNullOrWhiteSpace(p.GetString("cloudSecureBundle")))
            throw Unsupported("A secure connect bundle (Astra) cannot go through an SSH tunnel.");
        var points = p.GetList("contactPoints").Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
        if (points.Count == 0 && p.GetString("host") is { } h)
            points.AddRange(h.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        if (points.Count == 0) throw EngineException.Validation("Contact points are required.", new { field = "contactPoints" });
        if (points.Count > 1)
            throw Unsupported("Through an SSH tunnel, Cassandra connects to a single contact point: keep one node in 'Contact points'.");
        return new TunnelEndpoint(points[0], Port(p, "port", 9042));
    }

    private static TunnelEndpoint Redis(ConnectionProfile p)
    {
        var mode = (p.GetString("mode") ?? "standalone").Trim().ToLowerInvariant();
        if (mode == "cluster")
            throw Unsupported("SSH tunnels are not available for Redis Cluster: the nodes redirect clients to their own addresses, which one forwarded port cannot reach.");
        if (mode == "sentinel")
            throw Unsupported("SSH tunnels are not available for Redis Sentinel: the sentinels hand out the master's own address, which one forwarded port cannot reach. Connect to the master in standalone mode.");
        return HostPort(p, "Redis", 6379);
    }

    /// <summary>A parsed <c>mongodb://</c> URI with one host.</summary>
    internal sealed record MongoUri(string UserInfo, TunnelEndpoint Endpoint, string Path, string Query)
    {
        public string RewriteTo(string host, int port)
        {
            var pairs = Query.Length == 0 ? [] : Query.Split('&', StringSplitOptions.RemoveEmptyEntries).ToList();
            // the driver must talk to the forwarded port only, not discover the replica set members' own addresses
            pairs.RemoveAll(x => x.StartsWith("directConnection=", StringComparison.OrdinalIgnoreCase) || x.StartsWith("replicaSet=", StringComparison.OrdinalIgnoreCase));
            pairs.Add("directConnection=true");
            var auth = UserInfo.Length > 0 ? UserInfo + "@" : "";
            return $"mongodb://{auth}{host}:{port.ToString(CultureInfo.InvariantCulture)}{(Path.Length > 0 ? Path : "/")}?{string.Join('&', pairs)}";
        }
    }

    internal static MongoUri Mongo(ConnectionProfile p)
    {
        var uri = p.GetString("uri")?.Trim();
        if (string.IsNullOrEmpty(uri)) throw EngineException.Validation("The connection string is required.", new { field = "uri" });
        if (uri.StartsWith("mongodb+srv://", StringComparison.OrdinalIgnoreCase))
            throw Unsupported("SSH tunnels are not available for mongodb+srv:// connection strings: the hosts come from DNS records the tunnel cannot follow. Use mongodb://host:port of one member instead.");
        const string scheme = "mongodb://";
        if (!uri.StartsWith(scheme, StringComparison.OrdinalIgnoreCase))
            throw EngineException.Validation("The connection string must start with mongodb://.", new { field = "uri" });
        var rest = uri[scheme.Length..];
        var end = rest.IndexOfAny(['/', '?']);
        var authority = end < 0 ? rest : rest[..end];
        var tail = end < 0 ? "" : rest[end..];
        var at = authority.LastIndexOf('@');
        var userInfo = at >= 0 ? authority[..at] : "";
        var hosts = at >= 0 ? authority[(at + 1)..] : authority;
        var list = hosts.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (list.Length == 0) throw EngineException.Validation("The connection string has no host.", new { field = "uri" });
        if (list.Length > 1)
            throw Unsupported("Through an SSH tunnel, MongoDB connects to one host (direct connection, no replica-set discovery): keep one host in the connection string.");
        var q = tail.IndexOf('?');
        var path = q < 0 ? tail : tail[..q];
        var query = q < 0 ? "" : tail[(q + 1)..];
        return new MongoUri(userInfo, SplitHostPort(list[0], 27017, "uri"), path, query);
    }

    internal sealed record EsUrl(string Scheme, TunnelEndpoint Endpoint, string Path)
    {
        public string RewriteTo(string host, int port) => $"{Scheme}://{host}:{port.ToString(CultureInfo.InvariantCulture)}{Path}";
    }

    internal static EsUrl Elastic(ConnectionProfile p)
    {
        var raw = p.GetList("url");
        if (raw.Count == 0) throw EngineException.Validation("An Elasticsearch URL is required (http://host:9200).", new { field = "url" });
        if (raw.Count > 1)
            throw Unsupported("Through an SSH tunnel, Elasticsearch connects to one node: keep one URL.");
        var s = raw[0].Trim();
        if (!s.Contains("://", StringComparison.Ordinal)) s = "http://" + s;
        if (!Uri.TryCreate(s, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || string.IsNullOrEmpty(uri.Host))
            throw EngineException.Validation($"'{raw[0]}' is not an http(s) URL.", new { field = "url" });
        return new EsUrl(uri.Scheme, new TunnelEndpoint(uri.IdnHost.Trim('[', ']'), uri.Port), uri.AbsolutePath.TrimEnd('/'));
    }

    /// <summary>"host", "host:port", "[::1]:port".</summary>
    internal static TunnelEndpoint SplitHostPort(string s, int defaultPort, string field)
    {
        s = s.Trim();
        if (s.StartsWith('['))
        {
            var close = s.IndexOf(']');
            if (close < 0) throw EngineException.Validation($"'{s}' is not a valid address.", new { field });
            var host6 = s[1..close];
            var after = s[(close + 1)..];
            return new TunnelEndpoint(host6, after.StartsWith(':') ? ParsePort(after[1..], s, field) : defaultPort);
        }
        var colon = s.LastIndexOf(':');
        if (colon > 0 && s.IndexOf(':') == colon) return new TunnelEndpoint(s[..colon], ParsePort(s[(colon + 1)..], s, field));
        return new TunnelEndpoint(s, defaultPort);
    }

    private static int ParsePort(string text, string whole, string field) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n is >= 1 and <= 65535
            ? n
            : throw EngineException.Validation($"'{whole}': the port is not valid.", new { field });
}
