import { beforeEach, describe, expect, it } from 'vitest';
import { contextMenuEntries } from '../../../commands/menuModel';
import { getCommand } from '../../../commands/registry';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { getTabView } from '../../layout/tabViews';
import { registerSchemaCompareCommands } from '../commands';
import { SCHEMA_COMPARE_VIEW_ID, type SchemaCompareTabState } from '../model';

const conn = (id: string, providerId: string) =>
  ({ id, name: id, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null }) as never;

beforeEach(() => {
  registerSchemaCompareCommands();
  useConnections.setState({ loaded: true, providers: [], connections: [conn('pg', 'postgresql'), conn('rd', 'redis')] });
  useTabs.setState({ tabs: [], activeId: null } as never);
});

describe('schema compare commands', () => {
  it('registers the view and adds "Compare schema…" to database / schema and connection menus', () => {
    expect(getTabView(SCHEMA_COMPARE_VIEW_ID)).toBeTruthy();
    for (const menu of ['explorer.container', 'explorer.connection']) {
      expect(contextMenuEntries(menu)).toContainEqual(expect.objectContaining({ command: 'schemaCompare.open' }));
    }
  });

  it('opens a tab with the explorer node as the source and an empty target', () => {
    const cmd = getCommand('schemaCompare.open')!;
    const target = { kind: 'container', connectionId: 'pg', database: 'shop', schema: 'sales' };
    expect(cmd.when?.(target as never)).toBe(true);
    cmd.run(target as never);
    const tab = useTabs.getState().tabs[0] as ViewTab;
    expect(tab.view).toBe(SCHEMA_COMPARE_VIEW_ID);
    expect(tab.title).toBe('Compare: sales');
    const state = tab.state as SchemaCompareTabState;
    expect(state.source).toEqual({ connectionId: 'pg', database: 'shop', schema: 'sales' });
    expect(state.target.connectionId).toBeNull();
  });

  it('is hidden on non-relational nodes but always available from the palette', () => {
    const cmd = getCommand('schemaCompare.open')!;
    expect(cmd.when?.({ kind: 'connection', connectionId: 'rd' } as never)).toBe(false);
    expect(cmd.when?.(undefined as never)).toBe(true);
  });
});
