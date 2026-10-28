import { describe, expect, it } from 'vitest';
import { connectionHint } from './connectionHints';

describe('connectionHint (what to check after a failed test)', () => {
  it('wrong credentials, on every provider wording', () => {
    for (const m of [
      'password authentication failed for user "shop"',
      "Login failed for user 'sa'.",
      "Access denied for user 'shop'@'172.22.0.1' (using password: YES)",
      'ORA-01017: invalid username/password; logon denied',
    ]) expect(connectionHint(m), m).toMatch(/user name and password/);
  });

  it('a server that cannot be reached', () => {
    for (const m of ['Failed to connect to 127.0.0.1:15439', 'No such host is known.', 'Connect Timeout expired.', 'No connection could be made because the target machine actively refused it'])
      expect(connectionHint(m), m).toMatch(/host and port/);
  });

  it('an unknown database, and certificate problems', () => {
    expect(connectionHint('database "nodb" does not exist')).toMatch(/database name/);
    expect(connectionHint('The certificate chain was issued by an authority that is not trusted.')).toMatch(/trusting the server certificate/);
  });

  it('WP-SSH: the SSH hop gets SSH advice, not database advice', () => {
    expect(connectionHint('SSH authentication failed for me@bastion: Permission denied (password).', 'ssh')).toMatch(/SSH user and password/);
    expect(connectionHint('The SSH server bastion:22 is not reachable: No such host is known.', 'ssh')).toMatch(/SSH host and port/);
    expect(connectionHint("The private key 'id_ed25519' is encrypted: enter its passphrase.", 'ssh')).toMatch(/passphrase/);
    expect(connectionHint("'key.ppk' is a PuTTY key (.ppk), which is not supported", 'ssh')).toMatch(/OpenSSH/);
    expect(connectionHint('The SSH host key of bastion:22 changed: it was ...', 'ssh')).toMatch(/intercepting/);
    expect(connectionHint('SSH tunnels are not available for Redis Cluster: ...', 'ssh')).toBeNull(); // the message says it all
  });

  it('WP-SSH: the database behind the tunnel', () => {
    expect(connectionHint('Exception while reading from stream The SSH server me@b could not reach db:5432: connect failed', 'db')).toMatch(/resolved by the SSH server/);
    expect(connectionHint('The remote certificate is invalid because of errors in the certificate chain: RemoteCertificateNameMismatch', 'db')).toMatch(/127\.0\.0\.1/);
    expect(connectionHint('password authentication failed for user "shop"', 'db')).toMatch(/user name and password/);
  });

  it('says nothing about a message it does not recognise', () => {
    expect(connectionHint('Something unusual happened')).toBeNull();
    expect(connectionHint(null)).toBeNull();
    expect(connectionHint('  ')).toBeNull();
  });
});
