import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '../../platform';
import { createBrowserPlatform } from '../../platform/browser';
import { useConnections } from '../../store/connections';
import { installMockEngine } from '../../test/mockServer';
import { CONNECTION_PALETTE } from '../../theme/connColors';
import { fileFilterExtensions } from '../../lib/fileFilter';
import { ConnectionDialog } from './ConnectionDialog';

const mock = installMockEngine();

async function loadStores() {
  useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
  await useConnections.getState().load();
}

describe('fileFilterExtensions', () => {
  it('reads the plain list and the "Label|*.ext|All files|*.*" dialog form', () => {
    expect(fileFilterExtensions('*.db;*.sqlite;*.sqlite3')).toEqual(['db', 'sqlite', 'sqlite3']);
    expect(fileFilterExtensions('Certificates|*.pem;*.crt;*.cer|All files|*.*')).toEqual(['pem', 'crt', 'cer']);
    expect(fileFilterExtensions('Secure connect bundle|*.zip')).toEqual(['zip']);
    expect(fileFilterExtensions(null)).toEqual([]);
  });
});

describe('ConnectionDialog', () => {
  beforeEach(async () => {
    mock.reset();
    await loadStores();
  });

  it('renders the provider form spec and honours visibleWhen', async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlserver' }} onClose={() => {}} />);
    expect(screen.getByLabelText(/^Server/)).toBeInTheDocument();
    expect(screen.getByLabelText('User')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();

    // the styled Select (user-04): open it, then pick the option like a user does
    await user.click(screen.getByLabelText('Authentication'));
    await user.click(screen.getAllByRole('option').find((o) => o.getAttribute('data-value') === 'windows')!);
    expect(screen.getByLabelText('Authentication')).toHaveAttribute('data-value', 'windows');
    expect(screen.queryByLabelText('User')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    // bool field rendered as a checkbox with its label, default from the spec
    expect(screen.getByRole('checkbox', { name: 'Trust server certificate' })).toBeChecked();
  });

  it('switches provider and shows that provider’s fields', async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlserver' }} onClose={() => {}} />);
    await user.click(screen.getByRole('option', { name: /SQLite/ }));
    expect(screen.getByLabelText(/Database file/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Server/)).not.toBeInTheDocument();
  });

  it('tests the connection and shows server info', async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlserver' }} onClose={() => {}} />);
    await user.type(screen.getByLabelText(/^Server/), 'sql-dev-02');
    await user.type(screen.getByLabelText('User'), 'sa');
    await user.click(screen.getByRole('button', { name: /Test connection/ }));
    const status = await screen.findByRole('status');
    expect(within(status).getByText(/Connected in \d+ ms/)).toBeInTheDocument();
    expect(within(status).getByText(/Microsoft SQL Server 2022/)).toBeInTheDocument();
    expect(within(status).getByText('sql-dev-02')).toBeInTheDocument();
    expect(mock.hits('/connections/test', 'POST')).toHaveLength(1);
  });

  it('shows the provider error when the test fails', async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlserver' }} onClose={() => {}} />);
    await user.type(screen.getByLabelText(/^Server/), 'nowhere');
    await user.click(screen.getByRole('button', { name: /Test connection/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Connection failed.*host not found/);
  });

  it('validates required fields and saves a new connection with color, folder and read-only', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlite' }} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Database file is required')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Database file/), 'C:\\data\\inventory.db');
    // name is suggested from the file name
    expect(screen.getByLabelText('Name')).toHaveValue('inventory');
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    await user.type(screen.getByLabelText('Folder'), 'Local');
    await user.click(screen.getByRole('checkbox', { name: /^Read-only \(Rowlit blocks statements that change data\)$/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const saved = mock.ctx.engine.connections.find((c) => c.name === 'inventory');
    expect(saved).toMatchObject({ providerId: 'sqlite', color: CONNECTION_PALETTE.find((p) => p.id === 'blue')!.hex, folder: 'Local', readOnly: true, props: { path: 'C:\\data\\inventory.db' } });
    expect(useConnections.getState().connections.some((c) => c.name === 'inventory')).toBe(true);
  });

  it('validates required fields before Test (no engine call) and marks them for assistive tech', async () => {
    const user = userEvent.setup();
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlite' }} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Test connection/ }));
    const field = screen.getByLabelText(/Database file/);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Database file is required');
    expect(mock.hits('/connections/test', 'POST')).toHaveLength(0);
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('lets the SQLite browse dialog name a new file once "Create the file" is ticked', async () => {
    const user = userEvent.setup();
    const showOpenDialog = vi.fn(async () => 'C:\\data\\new.db');
    setPlatform({ ...createBrowserPlatform(), hasFileSystem: true, showOpenDialog });
    try {
      render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlite' }} onClose={() => {}} />);
      await user.click(screen.getByRole('button', { name: 'Browse' }));
      expect(showOpenDialog).toHaveBeenLastCalledWith(expect.not.objectContaining({ createIfMissing: true }));
      await user.click(screen.getByRole('checkbox', { name: 'Create the file if it does not exist' }));
      await user.click(screen.getByRole('button', { name: 'Browse' }));
      expect(showOpenDialog).toHaveBeenLastCalledWith(expect.objectContaining({ createIfMissing: true }));
      expect(screen.getByLabelText(/Database file/)).toHaveValue('C:\\data\\new.db');
    } finally {
      setPlatform(null);
    }
  });

  it('uses one provider naming set and keeps the two SQLite read-only options apart', () => {
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'sqlite' }} onClose={() => {}} />);
    expect(screen.getByRole('option', { name: 'SQL Server' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Oracle' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Open file read-only' })).toBeInTheDocument();
    // design-r1-05: the engine guard has the one "Read-only" label every provider shows; the SQLite file mode is its own field
    expect(screen.getByRole('checkbox', { name: /^Read-only \(Rowlit blocks statements that change data\)$/ })).toBeInTheDocument();
  });

  it('edits an existing connection keeping the stored password', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConnectionDialog state={{ mode: 'edit', id: 'c_prod' }} onClose={onClose} />);
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('Prod SQL');
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', expect.stringMatching(/stored/));
    await user.clear(name);
    await user.type(name, 'Production');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const c = mock.ctx.engine.connections.find((x) => x.id === 'c_prod')!;
    expect(c.name).toBe('Production');
    expect(c.hasPassword).toBe(true);
  });

  describe('WP-SSH tunnel section', () => {
    const sshToggle = () => screen.getByRole('button', { name: /SSH tunnel/ });

    it('is collapsed, opens, and shows its fields only when switched on', async () => {
      const user = userEvent.setup();
      render(<ConnectionDialog state={{ mode: 'new', providerId: 'postgresql' }} onClose={() => {}} />);
      expect(sshToggle()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('checkbox', { name: 'Use SSH tunnel' })).not.toBeInTheDocument();
      await user.click(sshToggle());
      expect(sshToggle()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByLabelText(/^SSH host/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: 'Use SSH tunnel' }));
      expect(screen.getByLabelText(/^SSH host/)).toBeInTheDocument();
      expect(screen.getByLabelText('SSH port')).toHaveValue(22);
      expect(screen.getByLabelText('SSH password')).toBeInTheDocument();
      expect(screen.queryByLabelText(/Private key file/)).not.toBeInTheDocument();

      // collapsed again: the header says where it goes
      await user.type(screen.getByLabelText(/^SSH host/), 'bastion');
      await user.type(screen.getByLabelText(/^SSH user/), 'deploy');
      await user.click(sshToggle());
      expect(sshToggle()).toHaveTextContent('via deploy@bastion');
    });

    it('key authentication: the file picker fills the key path, and the props carry the SSH settings and secrets', async () => {
      const user = userEvent.setup();
      const showOpenDialog = vi.fn(async () => 'C:\\Users\\me\\.ssh\\id ed25519');
      setPlatform({ ...createBrowserPlatform(), hasFileSystem: true, showOpenDialog });
      const saved = { id: 'c_new', name: 'pg', providerId: 'postgresql', props: {}, readOnly: false, savePassword: true, hasPassword: false } as never;
      const save = vi.fn().mockResolvedValue(saved);
      useConnections.setState({ save });
      try {
        render(<ConnectionDialog state={{ mode: 'new', providerId: 'postgresql', connectAfter: false }} onClose={() => {}} />);
        await user.type(screen.getByLabelText(/^Host/), 'db.internal');
        await user.type(screen.getByLabelText(/^User/), 'shop');
        await user.click(sshToggle());
        await user.click(screen.getByRole('checkbox', { name: 'Use SSH tunnel' }));
        await user.type(screen.getByLabelText(/^SSH host/), 'bastion.example.com');
        await user.type(screen.getByLabelText(/^SSH user/), 'deploy');
        await user.click(screen.getByLabelText('SSH authentication'));
        await user.click(screen.getAllByRole('option').find((o) => o.getAttribute('data-value') === 'key')!);
        expect(screen.queryByLabelText('SSH password')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Browse' }));
        expect(screen.getByLabelText(/Private key file/)).toHaveValue('C:\\Users\\me\\.ssh\\id ed25519');
        await user.type(screen.getByLabelText('Key passphrase'), 'pass phrase');
        await user.click(screen.getByRole('button', { name: 'Create' }));
        await waitFor(() => expect(save).toHaveBeenCalled());
        const input = save.mock.calls[0][0];
        expect(input.props).toMatchObject({
          host: 'db.internal',
          'ssh.enabled': true,
          'ssh.host': 'bastion.example.com',
          'ssh.port': 22,
          'ssh.user': 'deploy',
          'ssh.auth': 'key',
          'ssh.keyPath': 'C:\\Users\\me\\.ssh\\id ed25519',
          sshPassphrase: 'pass phrase',
          'ssh.keepAlive': true,
        });
        expect(input.props.sshPassword).toBeUndefined();
        expect(input.password).toBeNull();
      } finally {
        setPlatform(null);
      }
    });

    it('a required SSH field in the collapsed section opens it on Save', async () => {
      const user = userEvent.setup();
      render(<ConnectionDialog state={{ mode: 'new', providerId: 'postgresql', connectAfter: false }} onClose={() => {}} />);
      await user.type(screen.getByLabelText(/^Host/), 'db');
      await user.type(screen.getByLabelText(/^User/), 'shop');
      await user.click(sshToggle());
      await user.click(screen.getByRole('checkbox', { name: 'Use SSH tunnel' }));
      await user.click(sshToggle());
      await user.click(screen.getByRole('button', { name: 'Create' }));
      expect(sshToggle()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('SSH host is required')).toBeInTheDocument();
    });

    it('Test names the failing hop and gives SSH advice', async () => {
      const user = userEvent.setup();
      render(<ConnectionDialog state={{ mode: 'new', providerId: 'postgresql' }} onClose={() => {}} />);
      await user.type(screen.getByLabelText(/^Host/), 'db');
      await user.type(screen.getByLabelText(/^User/), 'shop');
      await user.click(sshToggle());
      await user.click(screen.getByRole('checkbox', { name: 'Use SSH tunnel' }));
      await user.type(screen.getByLabelText(/^SSH host/), 'nowhere');
      await user.type(screen.getByLabelText(/^SSH user/), 'deploy');
      await user.click(screen.getByRole('button', { name: /Test connection/ }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('SSH connection failed (deploy@nowhere)');
      expect(alert).toHaveTextContent(/Check the SSH host and port/);

      await user.clear(screen.getByLabelText(/^SSH host/));
      await user.type(screen.getByLabelText(/^SSH host/), 'bastion');
      await user.click(screen.getByRole('button', { name: /Test connection/ }));
      expect(await screen.findByRole('status')).toHaveTextContent(/Connected in \d+ ms via SSH deploy@bastion/);
    });

    it('a provider without tunnels explains why in the section', async () => {
      const user = userEvent.setup();
      render(<ConnectionDialog state={{ mode: 'new', providerId: 'kafka' }} onClose={() => {}} />);
      await user.click(sshToggle());
      expect(screen.getByText(/not available for Kafka/)).toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: 'Use SSH tunnel' })).not.toBeInTheDocument();
    });
  });

  it('sends extra password-typed fields (key passphrase, OAuth token) as props, never as the main password', async () => {
    const user = userEvent.setup();
    const saved = { id: 'c_new', name: 'sf', providerId: 'snowflake', props: {}, readOnly: false, savePassword: true, hasPassword: false } as never;
    const save = vi.fn().mockResolvedValue(saved);
    useConnections.setState({ save });
    render(<ConnectionDialog state={{ mode: 'new', providerId: 'snowflake', connectAfter: false }} onClose={() => {}} />);
    await user.type(screen.getByLabelText(/^Account/), 'xy12345.eu-central-1');
    await user.type(screen.getByLabelText('User'), 'JSMITH');
    await user.click(screen.getByLabelText('Authentication'));
    await user.click(screen.getAllByRole('option').find((o) => o.getAttribute('data-value') === 'snowflake_jwt')!);
    await user.type(screen.getByLabelText('Private key file'), '/keys/rsa_key.p8');
    await user.type(screen.getByLabelText('Key passphrase'), 's3cret;pass');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    let input = save.mock.calls[0][0];
    expect(input.props).toMatchObject({ authenticator: 'snowflake_jwt', privateKeyFile: '/keys/rsa_key.p8', privateKeyPassphrase: 's3cret;pass' });
    expect(input.password).toBeNull();
    expect(input.props.token).toBeUndefined();

    // switching to OAuth: only the token field is sent (the passphrase belongs to the key-pair method)
    save.mockClear();
    await user.click(screen.getByLabelText('Authentication'));
    await user.click(screen.getAllByRole('option').find((o) => o.getAttribute('data-value') === 'oauth')!);
    await user.type(screen.getByLabelText('OAuth token'), 'tok-123');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    input = save.mock.calls[0][0];
    expect(input.props).toMatchObject({ authenticator: 'oauth', token: 'tok-123' });
    expect(input.props.privateKeyPassphrase).toBeUndefined();
    expect(input.password).toBeNull();
  });
});
