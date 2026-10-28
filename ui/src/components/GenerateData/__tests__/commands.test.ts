// Generate data commands: registration, the explorer entry (added with extendContextMenu), where it applies and the tab it opens.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contextMenuEntries } from '../../../commands/menuModel';
import { getCommand, isEnabled, runCommand } from '../../../commands/registry';
import type { CommandTarget } from '../../../commands/types';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { getTabView } from '../../layout/tabViews';
import { registerGenerateDataCommands } from '../commands';
import { generateContext, GENERATE_VIEW_ID, tabTarget, type GenerateTabState } from '../open';

const conn = (id: string, providerId: string, readOnly = false) => ({
  id, name: id, providerId, color: null, folder: null, readOnly, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
}) as never;

const ref = (name: string, type: 'table' | 'view' = 'table', schema = 'public') => ({ database: 'shop', schema, name, type });
const table: CommandTarget = { kind: 'object', connectionId: 'pg', database: 'shop', ref: ref('orders') };

beforeAll(() => registerGenerateDataCommands());

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useConnections.setState({
    loaded: true, providers: [],
    connections: [conn('pg', 'postgresql'), conn('ro', 'postgresql', true), conn('rd', 'redis'), conn('cs', 'cassandra'), conn('lk', 'linked')],
  });
});

const tabs = () => useTabs.getState().tabs.filter((t): t is ViewTab => t.kind === 'view' && t.view === GENERATE_VIEW_ID);
const ids = (menu: string) => contextMenuEntries(menu).flatMap((e) => (typeof e === 'object' && 'command' in e ? [e.command] : []));

describe('generate data commands', () => {
  it('registers the command, the tab view and the explorer table entry', () => {
    expect(getCommand('data.generate')!.title).toBe('Generate data…');
    expect(getTabView(GENERATE_VIEW_ID)).toBeTruthy();
    expect(ids('explorer.table')).toContain('data.generate');
    expect(ids('explorer.view')).not.toContain('data.generate');
  });

  it('applies to tables of writable relational connections only', () => {
    expect(isEnabled('data.generate', table)).toBe(true);
    expect(isEnabled('data.generate', { ...table, ref: ref('v_open', 'view') } as CommandTarget)).toBe(false);
    expect(isEnabled('data.generate', { ...table, connectionId: 'ro' } as CommandTarget)).toBe(false); // read-only
    expect(isEnabled('data.generate', { ...table, connectionId: 'rd' } as CommandTarget)).toBe(false); // not relational
    expect(isEnabled('data.generate', { ...table, connectionId: 'cs' } as CommandTarget)).toBe(false); // no INSERT loader
    expect(isEnabled('data.generate', { ...table, connectionId: 'lk' } as CommandTarget)).toBe(false); // linked databases are read-only
    expect(isEnabled('data.generate', { kind: 'container', connectionId: 'pg', database: 'shop', schema: 'public' } as CommandTarget)).toBe(false);
    expect(isEnabled('data.generate', { kind: 'connection', connectionId: 'pg' } as CommandTarget)).toBe(false);
  });

  it('takes the table of the active object tab or Data tab when run from the palette', () => {
    expect(generateContext()).toBeNull();
    useTabs.getState().openObject('pg', 'shop', ref('customers'));
    expect(generateContext()).toEqual({ connectionId: 'pg', database: 'shop', schema: 'public', table: 'customers' });
    useTabs.getState().openView({
      view: 'data', title: 'Data: orders', connectionId: 'pg', database: 'shop', state: { schema: 'sales', name: 'orders' }, key: 'd1',
    });
    expect(generateContext()).toMatchObject({ connectionId: 'pg', schema: 'sales', table: 'orders' });
    useTabs.getState().openView({
      view: 'data', title: 'Data: v', connectionId: 'pg', database: 'shop', state: { schema: 'sales', name: 'v', type: 'view' }, key: 'd2',
    });
    expect(generateContext()).toBeNull();
  });

  it('opens one tab per table and focuses it on a second request', () => {
    runCommand('data.generate', table);
    runCommand('data.generate', table);
    expect(tabs()).toHaveLength(1);
    const tab = tabs()[0];
    expect(tab.title).toBe('Generate: orders');
    expect(tab.connectionId).toBe('pg');
    expect(tab.state as GenerateTabState).toEqual({ schema: 'public', table: 'orders' });
    expect(tabTarget(tab)).toEqual({ connectionId: 'pg', database: 'shop', schema: 'public', table: 'orders' });
    runCommand('data.generate', { ...table, ref: ref('customers') });
    expect(tabs()).toHaveLength(2);
    expect(useTabs.getState().activeId).toBe(tabs()[1].id);
  });
});
