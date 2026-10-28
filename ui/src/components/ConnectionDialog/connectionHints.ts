// One plain sentence under a failed "Test connection": the driver text says what the server answered, this says what to
// check next. Matching is on the driver wording of every provider (Npgsql, SqlClient, MySqlConnector, ODP.NET, ...); an
// unknown message gets no hint rather than a wrong one.

type Rule = { test: RegExp; hint: string };

const RULES: Rule[] = [
  // Credentials first: "Access denied for user" and "password authentication failed" also mention the server.
  {
    test: /password authentication failed|login failed|access denied for user|authentication failed|ORA-01017|invalid (?:user|credentials|username)|incorrect password|28P01/i,
    hint: 'Check the user name and password. Passwords are case-sensitive.',
  },
  {
    test: /certificate|\bssl\b|\btls\b|handshake/i,
    hint: 'The secure connection could not be set up. Check the encryption / SSL setting, and for a self-signed certificate allow trusting the server certificate.',
  },
  {
    test: /does not exist|cannot open database|unknown database|ORA-12514|ORA-12505|invalid catalog|3D000/i,
    hint: 'Check the database name (or service name): the server is reachable, but it does not know it.',
  },
  {
    test: /failed to connect|connection refused|actively refused|timed out|timeout|no such host|name or service not known|host is unknown|unreachable|could not open a connection|network-related|ORA-12541|ORA-12170/i,
    hint: 'Check the host and port, that the server is running, and that a firewall or VPN is not blocking this computer.',
  },
];

/** WP-SSH: the SSH hop failed (engine TestConnectionResult.hop = 'ssh'). */
const SSH_RULES: Rule[] = [
  {
    test: /host key .* changed/i,
    hint: 'The SSH server presented a different host key than the first time. If the server was not reinstalled, do not connect: someone may be intercepting the connection.',
  },
  {
    test: /ppk|passphrase|private key/i,
    hint: 'Check the private key file and its passphrase. Use an OpenSSH or PEM key; PuTTY keys must be exported as OpenSSH first.',
  },
  {
    test: /authentication failed|permission denied/i,
    hint: 'Check the SSH user and password (or key). The SSH login is separate from the database login.',
  },
  {
    test: /not reachable|did not answer|timed out|refused|no such host/i,
    hint: 'Check the SSH host and port (usually 22), and that this computer can reach the SSH server.',
  },
];

/** WP-SSH: the SSH login worked, the database behind it failed (hop = 'db'). */
const TUNNEL_DB_RULES: Rule[] = [
  {
    test: /could not reach|connection refused|actively refused|closed the connection|end of stream|reading from stream|forcibly closed|connect failed/i,
    hint: 'The SSH login worked, but the SSH server could not reach the database. The database host is resolved by the SSH server: use the name or address it sees (for example localhost when the database runs on the SSH server).',
  },
  {
    test: /certificate|\bssl\b|\btls\b|handshake|remote name/i,
    hint: 'Through a tunnel the driver connects to 127.0.0.1, which the server certificate does not name: allow trusting the server certificate (or skip certificate validation) for this connection.',
  },
];

/**
 * What to check after a failed connection test, or null when the message is not one we recognise. `hop` is the engine's
 * TestConnectionResult.hop when the connection uses an SSH tunnel.
 */
export function connectionHint(message: string | null | undefined, hop?: 'ssh' | 'db' | null): string | null {
  const text = message ?? '';
  if (!text.trim()) return null;
  const rules = hop === 'ssh' ? SSH_RULES : hop === 'db' ? [...TUNNEL_DB_RULES, ...RULES] : RULES;
  for (const r of rules) if (r.test.test(text)) return r.hint;
  return null;
}
