// "Click on a table opens the table, not its design": every list that shows objects (explorer, Objects tab, Ctrl+P,
// Find in database, dependencies, ER diagram) opens a table / view / materialized view / synonym / ClickHouse
// dictionary in the DATA tab; routines keep their object tab / editor; a column row keeps the structure on that column.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogObjectType, ObjectRef } from '../api/types';
import { initCommands } from '../commands';
import { getCommand, registerCommand } from '../commands/registry';
import { runObjectHit } from '../components/CommandPalette/CommandPalette';
import { DATA_VIEW, type DataTabState } from '../components/DataTab/open';
import { Explorer, useExplorer } from '../components/Explorer/Explorer';
import { ObjectListView } from '../components/ObjectList/ObjectListView';
import { openObjects } from '../components/ObjectList/open';
import { openObjectOf } from '../components/Search/open';
import { useCatalog } from '../store/catalog';
import { useConnections } from '../store/connections';
import { useSettings } from '../store/settings';
import { useTabs, type ViewTab } from '../store/tabs';
import { useUi } from '../store/ui';
import { installMockEngine } from '../test/mockServer';
import { openObjectDefault } from './actions';

installMockEngine({ frameDelay: 0 });
beforeAll(() => initCommands(), 60_000);
const SLOW = { timeout: 8000 };

const ref = (name: string, type: CatalogObjectType, schema: string | null = 'dbo'): ObjectRef => ({ database: 'Shop', schema, name, type });
const tabs = () => useTabs.getState().tabs;
const dataTabs = () => tabs().filter((t): t is ViewTab => t.kind === 'view' && t.view === DATA_VIEW);
const objectTabs = () => tabs().filter((t) => t.kind === 'object');
const dataState = (t: ViewTab) => t.state as DataTabState;

beforeEach(async () => {
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useUi.setState({ toasts: [] });
  await useSettings.getState().load();
  await useConnections.getState().load();
});

describe('openObjectDefault', () => {
  it.each<[CatalogObjectType]>([['table'], ['view'], ['mview'], ['synonym']])('a %s opens its data, not its structure', (type) => {
    openObjectDefault('c_prod', 'Shop', ref('customers', type));
    expect(objectTabs()).toHaveLength(0);
    expect(dataTabs()).toHaveLength(1);
    expect(dataState(dataTabs()[0])).toMatchObject({ schema: 'dbo', name: 'customers', type });
  });

  it('routines and other objects keep the object tab', () => {
    const others = ['proc', 'func', 'tablefunc', 'sequence', 'type', 'trigger'] as CatalogObjectType[]; // a table function needs arguments
    for (const type of others) openObjectDefault('c_prod', 'Shop', ref(`x_${type}`, type));
    expect(dataTabs()).toHaveLength(0);
    expect(objectTabs()).toHaveLength(others.length);
  });

  it('a column keeps the structure, on that column', () => {
    openObjectDefault('c_prod', 'Shop', ref('customers', 'table'), 'email');
    expect(dataTabs()).toHaveLength(0);
    expect(objectTabs()).toHaveLength(1);
  });

  it('a ClickHouse dictionary (catalog type "type") opens its data; a PostgreSQL type does not', () => {
    const c = useConnections.getState().connections[0];
    useConnections.setState({
      connections: [...useConnections.getState().connections, { ...c, id: 'c_ch', name: 'ClickHouse', providerId: 'clickhouse' }],
    });
    openObjectDefault('c_ch', 'shop', ref('product_dict', 'type', 'shop'));
    expect(dataTabs()).toHaveLength(1);
    openObjectDefault('c_pg', null, { database: null, schema: 'public', name: 'mood', type: 'type' });
    expect(dataTabs()).toHaveLength(1);
    expect(objectTabs()).toHaveLength(1);
  });

  it('opening a table whose data view is gone says so instead of doing nothing', () => {
    const cmd = getCommand('data.open')!;
    registerCommand({ ...cmd, when: () => false });
    try {
      openObjectDefault('c_prod', 'Shop', ref('customers', 'table'));
      expect(useUi.getState().toasts.some((t) => t.kind === 'error' && /Could not open the data of customers/.test(t.text))).toBe(true);
      expect(objectTabs()).toHaveLength(1); // falls back to the structure
    } finally {
      registerCommand(cmd);
    }
  });
});

describe('every entry point opens the data of a table', () => {
  it('Ctrl+P: Enter opens data; a routine still opens its object tab', () => {
    runObjectHit({ connectionId: 'c_prod', database: 'Shop', ref: ref('customers', 'table'), name: 'customers' } as Parameters<typeof runObjectHit>[0], 'open');
    expect(dataTabs()).toHaveLength(1);
    expect(objectTabs()).toHaveLength(0);
    runObjectHit({ connectionId: 'c_prod', database: 'Shop', ref: ref('GetCustomer', 'proc'), name: 'GetCustomer' } as Parameters<typeof runObjectHit>[0], 'open');
    expect(objectTabs()).toHaveLength(1);
  });

  it('Find in database: a result object opens its data', () => {
    openObjectOf({ connectionId: 'c_prod', database: 'Shop', schema: 'dbo', name: 'customers', type: 'table' });
    expect(dataTabs()).toHaveLength(1);
    expect(objectTabs()).toHaveLength(0);
  });

  it('Objects tab: Enter / double-click on a table, a view and a synonym opens data', async () => {
    const id = openObjects({ connectionId: 'c_prod', database: null, schema: 'dbo' });
    const Host = () => {
      const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab;
      return <ObjectListView tab={tab} theme="light" visible />;
    };
    render(<Host />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(5), SLOW);
    const row = (name: string) => screen.getAllByRole('option').find((o) => o.querySelector('.ol-name-text')?.textContent === name)!;
    for (const name of ['customers', 'customer_orders']) {
      const r = row(name);
      if (r) fireEvent.doubleClick(r);
    }
    await waitFor(() => expect(dataTabs().length).toBeGreaterThanOrEqual(1), SLOW);
    expect(dataTabs().some((t) => dataState(t).name === 'customers')).toBe(true);
    expect(objectTabs()).toHaveLength(0);
  });

  it('explorer: double-click on a table opens data; on a column row the structure on that column', async () => {
    useExplorer.setState({ expanded: new Set(), collapsedFolders: new Set(), filter: '', selected: null });
    useCatalog.setState({ conns: {}, dbs: {} });
    render(<Explorer />);
    const row = (label: string) => screen.getAllByRole('treeitem').find((el) => el.querySelector('.tree-label')?.textContent === label);
    const expand = async (label: string) => fireEvent.click((await waitFor(() => row(label) ?? Promise.reject(new Error(label)), SLOW))!.querySelector('.tree-twisty')!);
    await expand('Prod SQL');
    await expand('Shop');
    await expand('dbo');
    await expand('Tables');
    const table = await waitFor(() => row('customers') ?? Promise.reject(new Error('customers')), SLOW);
    fireEvent.doubleClick(table);
    expect(dataTabs()).toHaveLength(1);
    expect(dataState(dataTabs()[0])).toMatchObject({ schema: 'dbo', name: 'customers', type: 'table' });
    expect(objectTabs()).toHaveLength(0);
  });
});
