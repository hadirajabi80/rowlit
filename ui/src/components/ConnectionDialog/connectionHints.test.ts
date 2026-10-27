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

  it('says nothing about a message it does not recognise', () => {
    expect(connectionHint('Something unusual happened')).toBeNull();
    expect(connectionHint(null)).toBeNull();
    expect(connectionHint('  ')).toBeNull();
  });
});
