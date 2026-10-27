// SQL Server: `USE other` run from the editor moves the session's database; the console follows, otherwise the next run's
// ensure() would switch the session straight back to the tab's database.
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnections } from '../store/connections';
import { useSessions } from '../store/sessions';
import { useTabs, type ConsoleTab } from '../store/tabs';
import { installMockEngine } from '../test/mockServer';
import { followSessionDatabase } from './actions';

installMockEngine({ frameDelay: 0 });

function consoleTab(id: string, connectionId: string, database: string | null): ConsoleTab {
  return { kind: 'console', id, title: id, connectionId, database, text: '', savedText: '', filePath: null, txMode: 'auto', maxRows: null, schema: 'Sales' };
}

const tab = () => useTabs.getState().tabs[0] as ConsoleTab;

describe('followSessionDatabase', () => {
  beforeEach(async () => {
    await useConnections.getState().load();
    useSessions.setState({ sessions: { s_1: { sessionId: 's_1', connectionId: 'c_prod', database: 'Shop' } as never }, byTab: { t_a: 's_1' } });
    useTabs.setState({ tabs: [consoleTab('t_a', 'c_prod', 'Shop')], activeId: 't_a', mru: [], closed: [] });
  });

  it('moves the tab to the database a USE selected and forgets the editor schema of the old one', () => {
    expect(followSessionDatabase('s_1', 'Shop', 'Warehouse')).toBe(true);
    expect(tab().database).toBe('Warehouse');
    expect(tab().schema).toBeNull();
  });

  it('does nothing when the tab is already there (case-insensitive) or the database did not change', () => {
    expect(followSessionDatabase('s_1', 'Shop', 'shop')).toBe(false);
    expect(followSessionDatabase('s_1', 'Shop', 'Shop')).toBe(false);
    expect(followSessionDatabase('s_1', 'Shop', null)).toBe(false);
    expect(followSessionDatabase('s_1', null, 'Warehouse')).toBe(false);
    expect(tab().database).toBe('Shop');
    expect(tab().schema).toBe('Sales');
  });

  it('only follows consoles of SQL Server connections', () => {
    useTabs.setState({ tabs: [consoleTab('t_a', 'c_shop', 'main')], activeId: 't_a', mru: [], closed: [] }); // SQLite
    expect(followSessionDatabase('s_1', 'main', 'other')).toBe(false);
    expect(tab().database).toBe('main');
    expect(followSessionDatabase('s_unknown', 'Shop', 'Warehouse')).toBe(false);
  });
});
