// WP-SSH: the SSH tunnel props of a connection profile (engine SshFormFields: ssh.enabled, ssh.host, ssh.port, ssh.user).

/** The switch of the SSH block. */
export const SSH_ENABLED = 'ssh.enabled';

/** "user@host" (":port" when not 22) of a profile's SSH tunnel, or null when it has none. */
export function sshVia(props: Record<string, unknown> | undefined | null): string | null {
  if (!props || props[SSH_ENABLED] !== true) return null;
  const str = (k: string) => (typeof props[k] === 'string' ? (props[k] as string).trim() : '');
  const host = str('ssh.host');
  if (!host) return null;
  const user = str('ssh.user');
  const raw = props['ssh.port'];
  const port = raw === undefined || raw === null || raw === '' ? 22 : Number(raw);
  return `${user ? `${user}@` : ''}${host}${port !== 22 ? `:${port}` : ''}`;
}
