// Transfer commands: registration, menu entries, where they apply and what the opened tab starts with.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contextMenuEntries, MENUS } from '../../../commands/menuModel';
import { getCommand, isEnabled, runCommand } from '../../../commands/registry';
import type { CommandTarget } from '../../../commands/types';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { getTabView } from '../../layout/tabViews';
import { registerTransferCommands } from '../commands';
import { TRANSFER_VIEW_ID, transferContext, type TransferTabState } from '../open';

const conn = (id: string, providerId: string) => ({
  id, name: id, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
}) as never;

const ref = (name: string, type: 'table' | 'view' = 'table', schema = 'public') => ({ database: 'shop', schema, name, type });
const multi: CommandTarget = { kind: 'object', connectionId: 'pg', database: 'shop', ref: ref('orders'), refs: [ref('orders'), ref('v_open', 'view'), ref('other', 'table', 'sales')] };
const schema: CommandTarget = { kind: 'container', connectionId: 'pg', database: 'shop', schema: 'public' };

beforeAll(() => registerTransferCommands());

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useConnections.setState({ loaded: true, providers: [], connections: [conn('pg', 'postgresql'), conn('rd', 'redis')] });
});

const tabs = () => useTabs.getState().tabs.filter((t): t is ViewTab => t.kind === 'view' && t.view === TRANSFER_VIEW_ID);
const ids = (menu: string) => contextMenuEntries(menu).flatMap((e) => (typeof e === 'object' && 'command' in e ? [e.command] : []));

describe('transfer commands', () => {
  it('registers commands, the tab view, the explorer entries and the Database menu item', () => {
    expect(getCommand('transfer.open')!.title).toBe('Transfer data…');
    expect(getCommand('transfer.dump')!.title).toBe('Dump to SQL file…');
    expect(getTabView(TRANSFER_VIEW_ID)).toBeTruthy();
    for (const m of ['explorer.table', 'explorer.view', 'explorer.container', 'explorer.connection']) {
      expect(ids(m)).toContain('transfer.open');
      expect(ids(m)).toContain('transfer.dump');
    }
    const db = MENUS.find((m) => m.id === 'database')!;
    expect(db.items.some((i) => 'command' in i && i.command === 'transfer.open')).toBe(true);
  });

  it('pre-ticks the selected tables and views of one schema', () => {
    expect(transferContext(multi)).toEqual({
      connectionId: 'pg', database: 'shop', schema: 'public', tables: [{ name: 'orders', type: 'table' }, { name: 'v_open', type: 'view' }],
    });
    runCommand('transfer.open', multi);
    const tab = tabs()[0];
    expect(tab.title).toBe('Transfer: public');
    expect(tab.connectionId).toBe('pg');
    expect((tab.state as TransferTabState).tables).toHaveLength(2);
    expect((tab.state as TransferTabState).targetKind).toBe('connection');
  });

  it('opens a dump from a schema and is unavailable on non-relational connections', () => {
    runCommand('transfer.dump', schema);
    const tab = tabs()[0];
    expect(tab.title).toBe('Dump: public');
    expect((tab.state as TransferTabState)).toEqual({ schema: 'public', tables: [], targetKind: 'file' });
    expect(isEnabled('transfer.open', { kind: 'connection', connectionId: 'rd' } as CommandTarget)).toBe(false);
    expect(isEnabled('transfer.open', { kind: 'connection', connectionId: 'pg' } as CommandTarget)).toBe(true);
  });
});
