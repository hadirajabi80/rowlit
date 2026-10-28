// Data compare command: registration, menu entries, where it applies and what the opened tab starts with.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contextMenuEntries, MENUS } from '../../../commands/menuModel';
import { getCommand, isEnabled, runCommand } from '../../../commands/registry';
import type { CommandTarget } from '../../../commands/types';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { getTabView } from '../../layout/tabViews';
import { registerDataCompareCommands } from '../commands';
import { DATA_COMPARE_VIEW_ID, EMPTY_DATA_SIDE, type DataCompareTabState } from '../open';

const conn = (id: string, providerId: string) => ({
  id, name: id, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
}) as never;

const table: CommandTarget = { kind: 'object', connectionId: 'pg', database: 'shop', ref: { database: 'shop', schema: 'public', name: 'orders', type: 'table' } };

beforeAll(() => registerDataCompareCommands());

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useConnections.setState({ loaded: true, providers: [], connections: [conn('pg', 'postgresql'), conn('rd', 'redis')] });
});

const tabs = () => useTabs.getState().tabs.filter((t): t is ViewTab => t.kind === 'view' && t.view === DATA_COMPARE_VIEW_ID);
const ids = (menu: string) => contextMenuEntries(menu).flatMap((e) => (typeof e === 'object' && 'command' in e ? [e.command] : []));

describe('data compare command', () => {
  it('registers the command, the tab view, the explorer entries and the Database menu item', () => {
    expect(getCommand('data.compare')!.title).toBe('Compare data…');
    expect(getTabView(DATA_COMPARE_VIEW_ID)).toBeTruthy();
    for (const m of ['explorer.table', 'explorer.view', 'explorer.container']) expect(ids(m)).toContain('data.compare');
    const db = MENUS.find((m) => m.id === 'database')!;
    expect(db.items.some((i) => 'command' in i && i.command === 'data.compare')).toBe(true);
  });

  it('opens a tab with the explorer table as the source and an empty target', () => {
    runCommand('data.compare', table);
    const tab = tabs()[0];
    expect(tab.title).toBe('Compare data: orders');
    expect(tab.connectionId).toBe('pg');
    const state = tab.state as DataCompareTabState;
    expect(state.source).toEqual({ ...EMPTY_DATA_SIDE, connectionId: 'pg', database: 'shop', schema: 'public', table: 'orders' });
    expect(state.target).toEqual(EMPTY_DATA_SIDE);
  });

  it('is unavailable on non-relational connections and opens empty from the palette', () => {
    expect(isEnabled('data.compare', { kind: 'connection', connectionId: 'rd' } as CommandTarget)).toBe(false);
    expect(isEnabled('data.compare', { kind: 'connection', connectionId: 'pg' } as CommandTarget)).toBe(true);
    runCommand('data.compare');
    expect(tabs()[0].title).toBe('Compare data');
    expect((tabs()[0].state as DataCompareTabState).source).toEqual(EMPTY_DATA_SIDE);
  });
});
