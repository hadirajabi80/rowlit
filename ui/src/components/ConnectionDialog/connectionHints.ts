// One plain sentence under a failed "Test connection": the driver text says what the server answered, this says what to
// check next. Matching is on the driver wording of every provider (Npgsql, SqlClient, MySqlConnector, ODP.NET, ...); an
// unknown message gets no hint rather than a wrong one.

const RULES: { test: RegExp; hint: string }[] = [
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

/** What to check after a failed connection test, or null when the message is not one we recognise. */
export function connectionHint(message: string | null | undefined): string | null {
  const text = message ?? '';
  if (!text.trim()) return null;
  for (const r of RULES) if (r.test.test(text)) return r.hint;
  return null;
}
