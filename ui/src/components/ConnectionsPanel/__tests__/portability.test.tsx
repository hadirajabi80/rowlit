// WP-5: export / import of connections: the pure helpers, the commands and menu entries, and both dialogs with the engine
// calls replaced (the engine side has its own xunit suite: ConnectionsPortabilityTests).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile } from '../../../api/types';
import { initCommands } from '../../../commands';
import { CONTEXT_MENUS, MENUS } from '../../../commands/menuModel';
import { getCommand, isEnabled } from '../../../commands/registry';
import { createBrowserPlatform } from '../../../platform/browser';
import { setPlatform } from '../../../platform';
import { useConnections } from '../../../store/connections';
import { useUi } from '../../../store/ui';
import { ExportConnectionsDialog } from '../ExportConnectionsDialog';
import { ImportConnectionsDialog } from '../ImportConnectionsDialog';
import {
  actionsOf, exportGroups, importSummary, passphraseProblem, portabilityApi, preselectionOf,
  type ExportResultDto, type ImportPreviewDto, type ImportPreviewItem, type ImportResultDto,
} from '../portability';

function conn(id: string, name: string, folder: string | null = null, providerId = 'postgresql', props: Record<string, unknown> = {}): ConnectionProfile {
  return { id, name, providerId, color: null, folder, readOnly: false, props, hasPassword: false, savePassword: true, createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null } as ConnectionProfile;
}

const CONNS = [
  conn('c1', 'Shop', 'Prod'),
  conn('c2', 'Billing', 'Prod', 'postgresql', { 'ssh.enabled': true }),
  conn('c3', 'Scratch', null, 'sqlite'),
  conn('c4', 'Link', null, 'linked'),
];

beforeAll(() => initCommands(), 60_000);
beforeEach(() => {
  useConnections.setState({ loaded: true, providers: [], connections: CONNS });
  useUi.setState({ toasts: [] });
});
afterEach(() => {
  cleanup();
  setPlatform(null);
  vi.restoreAllMocks();
});

describe('helpers', () => {
  it('passphraseProblem asks for eight characters and a matching repeat', () => {
    expect(passphraseProblem('', '')).toMatch(/Enter/);
    expect(passphraseProblem('short', 'short')).toMatch(/at least 8/);
    expect(passphraseProblem('long enough', 'long enougH')).toMatch(/differ/);
    expect(passphraseProblem('long enough', 'long enough')).toBeNull();
  });

  it('exportGroups: no folder first, folders by name, linked databases left out', () => {
    const groups = exportGroups([...CONNS, conn('c5', 'Alpha', 'Dev')]);
    expect(groups.map((g) => g.folder)).toEqual(['', 'Dev', 'Prod']);
    expect(groups[0].connections.map((c) => c.name)).toEqual(['Scratch']);
    expect(groups[2].connections.map((c) => c.name)).toEqual(['Billing', 'Shop']);
  });

  it('preselectionOf follows a folder or a connection argument', () => {
    expect(preselectionOf({ folder: 'Prod' }, CONNS)).toEqual(['c1', 'c2']);
    expect(preselectionOf({ kind: 'connection', connectionId: 'c3' }, CONNS)).toEqual(['c3']);
    expect(preselectionOf({ connectionId: 'gone' }, CONNS)).toEqual([]);
    expect(preselectionOf(undefined, CONNS)).toEqual([]);
  });

  it('actionsOf sends every row with the choice, skip for rows with a problem', () => {
    const item = (ref: string, over: Partial<ImportPreviewItem> = {}): ImportPreviewItem => ({
      ref, name: ref, providerId: 'sqlite', folder: null, color: null, readOnly: false, hasSecrets: false, ssh: false, action: 'new', existingId: null, problem: null, ...over,
    });
    expect(actionsOf([item('1'), item('2', { action: 'update', existingId: 'x' }), item('3', { action: 'skip', problem: 'unknown' }), item('4')], { '1': 'skip', '3': 'new' }))
      .toEqual([{ ref: '1', action: 'skip' }, { ref: '2', action: 'update' }, { ref: '3', action: 'skip' }, { ref: '4', action: 'new' }]);
  });

  it('importSummary', () => {
    expect(importSummary({ created: 2, updated: 1, skipped: 0 })).toBe('2 new, 1 updated');
    expect(importSummary({ created: 0, updated: 0, skipped: 0 })).toBe('Nothing imported');
  });
});

describe('commands and menus', () => {
  it('are registered, in the File menu and on an explorer folder', () => {
    expect(getCommand('connections.export')!.title).toBe('Export connections…');
    expect(getCommand('connections.import')!.title).toBe('Import connections…');
    const file = MENUS.find((m) => m.id === 'file')!;
    for (const id of ['connections.export', 'connections.import']) expect(file.items.some((i) => 'command' in i && i.command === id)).toBe(true);
    expect(CONTEXT_MENUS['explorer.folder'].some((e) => typeof e === 'object' && 'command' in e && e.command === 'connections.export')).toBe(true);
  });

  it('export needs a connection, import is always available', () => {
    expect(isEnabled('connections.export')).toBe(true);
    useConnections.setState({ connections: [] });
    expect(isEnabled('connections.export')).toBe(false);
    expect(isEnabled('connections.import')).toBe(true);
  });
});

describe('ExportConnectionsDialog', () => {
  const result: ExportResultDto = { fileName: 'connections.rowlit-connections.json', content: '{"format":"rowlit-connections"}', count: 3, secretsIncluded: 0, skipped: [] };
  let save: ReturnType<typeof vi.fn>;
  let exportSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    save = vi.fn(async () => 'C:\\out\\connections.rowlit-connections.json');
    setPlatform({ ...createBrowserPlatform(), saveFile: save } as never);
    exportSpy = vi.spyOn(portabilityApi, 'exportConnections').mockResolvedValue(result);
  });

  const exportButton = () => screen.getByRole('button', { name: /Export…/ });

  it('lists the exportable connections by folder, all ticked, and leaves passwords out by default', async () => {
    const onClose = vi.fn();
    render(<ExportConnectionsDialog onClose={onClose} />);
    const list = screen.getByRole('group', { name: 'Connections to export' });
    expect(within(list).getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).length).toBeGreaterThanOrEqual(3);
    expect(within(list).queryByText('Link')).toBeNull();
    expect(screen.getByText(/1 linked database cannot be exported/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Include passwords/)).not.toBeChecked();
    expect(screen.queryByLabelText('Passphrase')).toBeNull();

    fireEvent.click(exportButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(exportSpy).toHaveBeenCalledWith({ ids: ['c3', 'c2', 'c1'], includeSecrets: false, passphrase: undefined });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: result.fileName, content: result.content }));
    expect(useUi.getState().toasts.some((t) => t.text.startsWith('Exported 3 connections'))).toBe(true);
  });

  it('exports only the ticked connections; a preselection (folder) ticks just those', async () => {
    render(<ExportConnectionsDialog preselect={['c1', 'c2']} onClose={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /^Shop/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Scratch/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /^Shop/ }));
    fireEvent.click(exportButton());
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
    expect(exportSpy.mock.calls[0][0].ids).toEqual(['c2']);
  });

  it('cannot export with nothing ticked', () => {
    render(<ExportConnectionsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(exportButton()).toBeDisabled();
  });

  it('passwords need a passphrase of eight characters entered twice', async () => {
    render(<ExportConnectionsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Include passwords/));
    expect(screen.getByText(/Whoever has the file and the passphrase/)).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'short' } });
    expect(screen.getByRole('status')).toHaveTextContent('at least 8');
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a long passphrase' } });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'a long passphrasX' } });
    expect(screen.getByRole('status')).toHaveTextContent('differ');
    expect(exportButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'a long passphrase' } });
    expect(exportButton()).toBeEnabled();
    fireEvent.click(exportButton());
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
    expect(exportSpy.mock.calls[0][0]).toMatchObject({ includeSecrets: true, passphrase: 'a long passphrase' });
  });

  it('unchecking passwords again drops the passphrase from the request', async () => {
    render(<ExportConnectionsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText(/Include passwords/));
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a long passphrase' } });
    fireEvent.click(screen.getByLabelText(/Include passwords/));
    fireEvent.click(exportButton());
    await waitFor(() => expect(exportSpy).toHaveBeenCalled());
    expect(exportSpy.mock.calls[0][0]).toMatchObject({ includeSecrets: false, passphrase: undefined });
  });

  it('stays open when the save dialog is cancelled, and shows an engine error', async () => {
    const onClose = vi.fn();
    save.mockResolvedValueOnce(null);
    render(<ExportConnectionsDialog onClose={onClose} />);
    fireEvent.click(exportButton());
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();

    exportSpy.mockRejectedValueOnce(new Error('The passphrase must have at least 8 characters.'));
    fireEvent.click(exportButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters');
  });
});

describe('ImportConnectionsDialog', () => {
  const item = (ref: string, over: Partial<ImportPreviewItem> = {}): ImportPreviewItem => ({
    ref, name: `conn ${ref}`, providerId: 'postgresql', folder: null, color: null, readOnly: false, hasSecrets: false, ssh: false, action: 'new', existingId: null, problem: null, ...over,
  });
  const plain: ImportPreviewDto = {
    encrypted: false, unlocked: false, version: 1, exportedAt: null,
    items: [item('1', { name: 'Shop', action: 'update', existingId: 'c1', folder: 'Prod', ssh: true }), item('2', { name: 'Fresh' }), item('3', { name: 'Mystery', action: 'skip', problem: "This Rowlit does not know the provider 'x'." })],
  };
  const done: ImportResultDto = { created: 1, updated: 1, skipped: 1, items: [], errors: [{ ref: '3', name: 'Mystery', message: 'unknown provider' }], passwordsImported: false };
  let previewSpy: ReturnType<typeof vi.spyOn>;
  let importSpy: ReturnType<typeof vi.spyOn>;

  function chooseFile(content = '{"format":"rowlit-connections"}') {
    setPlatform({ ...createBrowserPlatform(), openTextFile: vi.fn(async () => ({ name: 'team.rowlit-connections.json', path: null, content })) } as never);
  }

  beforeEach(() => {
    chooseFile();
    previewSpy = vi.spyOn(portabilityApi, 'previewImport').mockResolvedValue(plain);
    importSpy = vi.spyOn(portabilityApi, 'importConnections').mockResolvedValue(done);
    vi.spyOn(useConnections.getState(), 'load').mockResolvedValue();
  });

  async function pick() {
    fireEvent.click(screen.getByRole('button', { name: /Choose file/ }));
    await screen.findByRole('table', { name: 'Connections in the file' });
  }

  it('previews the file: proposal per row, SSH marker, rows that cannot be imported are skipped with their reason', async () => {
    render(<ImportConnectionsDialog onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
    await pick();
    expect(previewSpy).toHaveBeenCalledWith('{"format":"rowlit-connections"}');
    expect(screen.getByText('team.rowlit-connections.json')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Action for Shop' })).toHaveTextContent('Replace “Shop”');
    expect(screen.getByRole('combobox', { name: 'Action for Fresh' })).toHaveTextContent('Import as new');
    const mystery = screen.getByRole('combobox', { name: 'Action for Mystery' });
    expect(mystery).toBeDisabled();
    expect(mystery).toHaveTextContent('Skip');
    expect(screen.getByText(/does not know the provider/)).toBeInTheDocument();
    expect(screen.getByText('SSH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import 2 connections/ })).toBeEnabled();
    expect(screen.queryByLabelText(/Passphrase/)).toBeNull(); // not encrypted
  });

  it('imports with the chosen actions and shows the result', async () => {
    const onClose = vi.fn();
    render(<ImportConnectionsDialog onClose={onClose} />);
    await pick();
    fireEvent.click(screen.getByRole('combobox', { name: 'Action for Shop' }));
    fireEvent.click(screen.getByRole('option', { name: 'Skip' }));
    expect(screen.getByRole('button', { name: /^Import 1 connection$/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Import 1 connection$/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('1 new, 1 updated, 1 skipped');
    expect(importSpy).toHaveBeenCalledWith('{"format":"rowlit-connections"}', [
      { ref: '1', action: 'skip' }, { ref: '2', action: 'new' }, { ref: '3', action: 'skip' },
    ], undefined);
    expect(screen.getByText(/unknown provider/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('reports a file that is not a connections file and stays on the picker', async () => {
    previewSpy.mockRejectedValueOnce(new Error('This is not a Rowlit connections file.'));
    render(<ImportConnectionsDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose file/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a Rowlit connections file');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('asks for the passphrase of an encrypted file: a wrong one is an inline error, the right one unlocks the passwords', async () => {
    const encrypted: ImportPreviewDto = { ...plain, encrypted: true, items: plain.items.map((i) => ({ ...i, hasSecrets: i.ref !== '3' })) };
    previewSpy.mockResolvedValueOnce(encrypted);
    render(<ImportConnectionsDialog onClose={() => {}} />);
    await pick();
    expect(screen.getByText(/imported without their passwords/)).toBeInTheDocument();

    const field = screen.getByLabelText(/Passphrase/);
    fireEvent.change(field, { target: { value: 'wrong passphrase' } });
    previewSpy.mockRejectedValueOnce(new Error('Wrong passphrase, or the file was modified.'));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong passphrase');
    expect(screen.getByRole('table')).toBeInTheDocument(); // still previewable without passwords

    fireEvent.change(field, { target: { value: 'right passphrase' } });
    expect(screen.queryByRole('alert')).toBeNull();
    previewSpy.mockResolvedValueOnce({ ...encrypted, unlocked: true });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText(/Unlocked: the passwords in this file will be imported/)).toBeInTheDocument();
    expect(previewSpy).toHaveBeenLastCalledWith('{"format":"rowlit-connections"}', 'right passphrase');

    fireEvent.click(screen.getByRole('button', { name: /^Import 2 connections/ }));
    await waitFor(() => expect(importSpy).toHaveBeenCalled());
    expect(importSpy.mock.calls[0][2]).toBe('right passphrase');
  });

  it('an encrypted file imported without unlocking sends no passphrase', async () => {
    previewSpy.mockResolvedValueOnce({ ...plain, encrypted: true });
    render(<ImportConnectionsDialog onClose={() => {}} />);
    await pick();
    fireEvent.click(screen.getByRole('button', { name: /^Import 2 connections/ }));
    await waitFor(() => expect(importSpy).toHaveBeenCalled());
    expect(importSpy.mock.calls[0][2]).toBeUndefined();
  });

  it('reads a dropped file', async () => {
    render(<ImportConnectionsDialog onClose={() => {}} />);
    const file = new File(['{"format":"rowlit-connections","dropped":true}'], 'dropped.json', { type: 'application/json' });
    fireEvent.drop(screen.getByTestId('cp-drop'), { dataTransfer: { files: [file] } });
    await screen.findByRole('table', { name: 'Connections in the file' });
    expect(previewSpy).toHaveBeenCalledWith('{"format":"rowlit-connections","dropped":true}');
    expect(screen.getByText('dropped.json')).toBeInTheDocument();
  });
});
