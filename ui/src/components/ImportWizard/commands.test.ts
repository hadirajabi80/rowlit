// Import commands: availability per connection / target, what each opens, and the menu entries they add.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerImportCommands } from './commands';
import { contextMenuEntries } from '../../commands/menuModel';
import { getCommand, isEnabled, runCommand } from '../../commands/registry';
import type { CommandTarget } from '../../commands/types';
import { setPlatform } from '../../platform';
import { createBrowserPlatform } from '../../platform/browser';
import { useConnections } from '../../store/connections';
import { useTabs, type ViewTab } from '../../store/tabs';
import { getTabView } from '../layout/tabViews';
import { IMPORT_VIEW_ID, type ImportTabState } from './open';

const conn = (id: string, providerId: string, readOnly = false) => ({
  id, name: id, providerId, color: null, folder: null, readOnly, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
}) as never;

const table: CommandTarget = { kind: 'object', connectionId: 'pg', database: 'shop', ref: { database: 'shop', schema: 'public', name: 'orders', type: 'table' } };
const view: CommandTarget = { kind: 'object', connectionId: 'pg', database: 'shop', ref: { database: 'shop', schema: 'public', name: 'v', type: 'view' } };
const schema: CommandTarget = { kind: 'container', connectionId: 'pg', database: 'shop', schema: 'public' };

beforeAll(() => {
  registerImportCommands();
});

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useConnections.setState({
    loaded: true, providers: [],
    connections: [conn('pg', 'postgresql'), conn('ro', 'postgresql', true), conn('rd', 'redis'), conn('cs', 'cassandra'), conn('my', 'mysql')],
  });
});

afterEach(() => setPlatform(null));

const tabs = () => useTabs.getState().tabs.filter((t): t is ViewTab => t.kind === 'view' && t.view === IMPORT_VIEW_ID);

describe('registration', () => {
  it('registers the commands, the tab view and the context menu entries', () => {
    for (const id of ['import.open', 'import.openNew', 'import.openFile']) expect(getCommand(id)).toBeTruthy();
    expect(getCommand('import.open')!.title).toBe('Import data…');
    expect(getCommand('import.openNew')!.title).toBe('Import into new table…');
    expect(getCommand('import.open')!.category).toBe('Database');
    expect(getTabView(IMPORT_VIEW_ID)).toBeTruthy();
    const ids = (menu: string) => contextMenuEntries(menu).flatMap((e) => (typeof e === 'object' && 'command' in e ? [e.command] : []));
    expect(ids('explorer.table')).toContain('import.open');
    expect(ids('explorer.container')).toContain('import.openNew');
    expect(ids('explorer.connection')).toContain('import.openNew');
  });
});

describe('availability', () => {
  it('is available for tables, schemas and connections of writable relational connections', () => {
    expect(isEnabled('import.open', table)).toBe(true);
    expect(isEnabled('import.open', schema)).toBe(true);
    expect(isEnabled('import.open', { kind: 'connection', connectionId: 'my' })).toBe(true);
    expect(isEnabled('import.openNew', table)).toBe(true);
    expect(isEnabled('import.openNew', schema)).toBe(true);
  });

  it('is hidden for read-only, non-relational and unsupported connections', () => {
    for (const cid of ['ro', 'rd', 'cs', 'unknown']) {
      const t = { ...table, connectionId: cid } as CommandTarget;
      expect(isEnabled('import.open', t)).toBe(false);
      expect(isEnabled('import.openNew', t)).toBe(false);
      expect(isEnabled('import.open', { kind: 'connection', connectionId: cid })).toBe(false);
    }
  });

  it('does not apply to views, query folders or source nodes', () => {
    expect(isEnabled('import.open', view)).toBe(false);
    expect(isEnabled('import.open', { ...schema, queries: true })).toBe(false);
    expect(isEnabled('import.open', { kind: 'source', connectionId: 'rd', providerId: 'redis', nodeType: 'db', path: ['0'] })).toBe(false);
  });

  it('falls back to the first writable relational connection from the palette', () => {
    expect(isEnabled('import.open')).toBe(true);
    useConnections.setState({ connections: [conn('rd', 'redis'), conn('ro', 'postgresql', true)] });
    expect(isEnabled('import.open')).toBe(false);
  });
});

describe('opening', () => {
  it('a table opens the wizard on that table (existing mode), every run in its own tab', () => {
    runCommand('import.open', table);
    runCommand('import.open', table);
    const t = tabs();
    expect(t).toHaveLength(2);
    expect(t[0].key).not.toBe(t[1].key);
    expect(t[0]).toMatchObject({ connectionId: 'pg', database: 'shop', title: 'Import: orders' });
    expect(t[0].state as ImportTabState).toEqual({ path: null, targetMode: 'existing', schema: 'public', table: 'orders' });
  });

  it('a schema opens the new-table mode, and "into new table" ignores the table of a table node', () => {
    runCommand('import.open', schema);
    runCommand('import.openNew', table);
    const [a, b] = tabs();
    expect(a.state as ImportTabState).toEqual({ path: null, targetMode: 'new', schema: 'public', table: null });
    expect(b.state as ImportTabState).toMatchObject({ targetMode: 'new', schema: 'public', table: null });
    expect(a.title).toBe('Import data');
  });

  it('import.openFile asks for the file first on desktop and stops when cancelled', async () => {
    const showOpenDialog = vi.fn<(o: unknown) => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce('C:\\data\\people.csv');
    setPlatform({ ...createBrowserPlatform(), hasFileSystem: true, showOpenDialog });
    await runCommand('import.openFile', schema);
    expect(tabs()).toHaveLength(0);
    await runCommand('import.openFile', schema);
    expect(showOpenDialog.mock.calls[0][0]).toMatchObject({ filters: expect.arrayContaining([expect.objectContaining({ extensions: expect.arrayContaining(['csv', 'xlsx']) })]) });
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].title).toBe('Import: people.csv');
    expect((tabs()[0].state as ImportTabState).path).toBe('C:\\data\\people.csv');
  });

  it('import.openFile opens the wizard without a path in the browser (no file system)', async () => {
    await runCommand('import.openFile', schema);
    expect(tabs()).toHaveLength(1);
    expect((tabs()[0].state as ImportTabState).path).toBeNull();
  });
});
