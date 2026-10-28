# SSH tunnel walkthrough (WP-1, Rowlit 1.7)

Connections can go through an SSH server (bastion / jump host). The engine opens an SSH session with SSH.NET, listens on
`127.0.0.1:<random>` and forwards every driver connection of the profile through the session (`direct-tcpip`, like
`ssh -L`). The database host is resolved by the SSH server.

## Servers

```powershell
docker compose -f engine/tests/docker/compose.yml --profile ssh up -d postgres mysql ssh
```

Bastion: `localhost:12222`, user `rowlit`, password `rowlit`. Behind it the samples are reachable by service name
(`postgres:5432`, `mysql:3306`, `mssql:1433`, `oracle:1521`, `clickhouse:8123`, `redis:6379`, `mongo:27017`).

## Steps

| # | Do | Expect |
|---|---|---|
| 1 | New connection, PostgreSQL. Host `postgres`, port `5432`, user/password `shop`. Open **SSH tunnel** (collapsed by default), tick **Use SSH tunnel**. | SSH host, port (22), user, authentication (Password), SSH password, Send keep-alives appear. |
| 2 | SSH host `localhost`, port `12222`, user `rowlit`, password `rowlit`. **Test connection**. | "Connected in … ms via SSH rowlit@localhost:12222", PostgreSQL 17 server info. |
| 3 | Change the SSH password to `wrong`, Test. | "SSH connection failed (rowlit@localhost:12222)", "SSH authentication failed …", hint about the SSH user and password. |
| 4 | Restore the password, set the database host to `nosuchhost`, Test. | "Connection failed behind the SSH tunnel (via …)", a detail line "The SSH server … could not reach nosuchhost:5432: …", hint that the SSH server resolves the host. |
| 5 | Restore `postgres`, Connect. Run `SELECT inet_server_addr(), now()`; open the explorer, a table's Data tab, the designer, Activity. | All work (they all open through the tunnel). Explorer tooltip of the connection ends with "via SSH rowlit@localhost:12222"; Active connections shows "via rowlit@localhost:12222". |
| 6 | Close the dialog, reopen Edit. | The SSH section is open; the SSH password field says "stored, leave empty to keep". `%APPDATA%\Rowlit\connections.json` has the `ssh.*` keys but no `sshPassword`. |
| 7 | `docker restart dbstudio-it-ssh-1`, then run a query again. | The session's old socket is gone, so the query reports a lost connection and the session reopens (the 1.6.2 recovery); the tunnel reconnects the SSH session on the same local port, so the next query works without reconnecting by hand. |
| 8 | Authentication **Private key**: generate `ssh-keygen -t ed25519 -f "$env:TEMP\rowlit key"`, copy the `.pub` line into the container's `/config/.ssh/authorized_keys`, pick the key with the Browse button (path with a space), Test without and with the passphrase. | Without: "The private key … is encrypted: enter its passphrase." With: connected. A `.ppk` file: "PuTTY key (.ppk), which is not supported: export it as an OpenSSH key". |
| 9 | Host key change: `docker compose … rm -sf ssh` and `up -d ssh` again (new host keys), Test. | Refused: "The SSH host key of localhost:12222 changed …", with the path of `ssh-known-hosts.json`. Remove the entry from that file, Test again: connected. |
| 10 | Redis connection, mode Cluster, SSH on, Save. | Refused with "SSH tunnels are not available for Redis Cluster: …". Same for Sentinel; MongoDB `mongodb+srv://…`; several hosts (PostgreSQL `a,b`, Cassandra two contact points, two Elasticsearch URLs); SQL Server `host\INSTANCE` without a port; Oracle TNS alias. |
| 11 | Kafka connection, open SSH tunnel. | A note: "SSH tunnels are not available for Kafka: the brokers advertise their own addresses …"; no switch. |
| 12 | Leave the connection idle (no sessions, pools cleared by the idle policy) for 10+ minutes. | Engine log: "SSH tunnel for … closed (idle)". The next query opens it again. |

## Scope and limits (MVP)

- Providers: PostgreSQL, MySQL, MariaDB, SQL Server (host or host,port; a named instance needs its port), Oracle (Basic
  connection type), ClickHouse (HTTP/HTTPS), Cassandra (one contact point; the driver talks to that node only), Redis
  (standalone), MongoDB (`mongodb://` with one host; Rowlit adds `directConnection=true` and drops `replicaSet`),
  Elasticsearch (one node URL).
- Not available: Kafka, Redis Cluster/Sentinel, `mongodb+srv://`, Snowflake, SQLite. Linked databases use their member
  connections, so a member with a tunnel is fetched through it.
- TLS through a tunnel: the driver connects to 127.0.0.1, so certificate host-name checks fail unless "Trust server
  certificate" / "Skip certificate validation" is on (the hint says so).
- Host keys are trusted on first use (`ssh-known-hosts.json` in the data folder); a changed key is refused. There is no
  UI to forget a key yet.
- Keys: OpenSSH (ed25519, ECDSA, RSA) and PEM. PuTTY `.ppk` is not supported. No SSH agent, no jump chains (ProxyJump),
  no HTTP/SOCKS proxy (the resolver is built so a proxy resolver can sit next to the SSH one).

## Automated coverage

- `engine/tests/DbStudio.Core.Tests/Tunnels/TunnelTargetsTests.cs`: target/rewrite rules per provider, unsupported
  configurations, settings validation, the form block.
- `engine/tests/DbStudio.Core.Tests/Tunnels/SshTunnelServiceTests.cs`: against an in-process SSH server
  (Microsoft.DevTunnels.Ssh): password and key logins (PEM, encrypted OpenSSH key from ssh-keygen, .ppk refused), bytes
  through the tunnel, reuse, 8 concurrent sockets, idle and superseded tunnels closing, reconnect on the same local port
  after the SSH session drops, host key TOFU and change, unreachable server, the failing hop of Test, secrets kept out of
  connections.json.
- `engine/tests/DbStudio.Core.Tests/Tunnels/ConnectionOpenCallSitesTests.cs`: every engine file that reads a connection
  password resolves the profile through the tunnel resolver.
- `engine/tests/DbStudio.Providers.PostgreSql.Tests/PgSshTunnelTests.cs`: live, PostgreSQL through the compose OpenSSH
  bastion (set `DBSTUDIO_SSH_HOST=localhost`).
- UI: `ConnectionDialog.test.tsx` (section, fields, key file picker, props sent, validation opens the section, hop in
  the test result, Kafka note), `connectionHints.test.ts` (SSH and behind-the-tunnel hints).
