// The explorer's System Data Types group (SQL Server) against the mock engine, and the menus / targets of the Types folders.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initCommands } from '../../commands';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { useSystemTypes } from '../../store/systemTypes';
import { useTabs } from '../../store/tabs';
import { installMockEngine } from '../../test/mockServer';
import { contextMenuIdOf, Explorer, targetOfRow, useExplorer } from './Explorer';
import type { TreeRow } from './tree';

const mock = installMockEngine();

function row(label: string) {
  return screen.getAllByRole('treeitem').find((el) => el.querySelector('.tree-label')?.textContent === label);
}

async function expand(label: string) {
  const r = await waitFor(() => {
    const el = row(label);
    if (!el) throw new Error(`row ${label} not found`);
    return el;
  });
  fireEvent.click(r.querySelector('.tree-twisty')!);
}

beforeAll(async () => {
  await initCommands();
});

describe('System Data Types', () => {
  beforeEach(async () => {
    mock.reset();
    localStorage.clear();
    useExplorer.setState({ expanded: new Set(), collapsedFolders: new Set(), filter: '', selected: null });
    useCatalog.setState({ conns: {}, dbs: {} });
    useSystemTypes.setState({ byDb: {} });
    useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
    useTabs.setState({ tabs: [], activeId: null, seq: 0 });
    await useConnections.getState().load();
  });

  it('loads the built-in types of the database when the group is first expanded, grouped by category', async () => {
    render(<Explorer />);
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    await expand('Shop');
    await waitFor(() => expect(row('System Data Types')).toBeDefined());
    expect(mock.hits('/catalog/systemtypes')).toHaveLength(0); // nothing is read before the group is opened

    await expand('System Data Types');
    await waitFor(() => expect(row('Exact numerics')).toBeDefined());
    expect(mock.hits('/catalog/systemtypes')).toHaveLength(1);
    expect(mock.hits('/catalog/systemtypes')[0].url.searchParams.get('database')).toBe('Shop');
    expect(row('Date and time')).toBeDefined();
    expect(row('int')).toBeUndefined(); // categories start collapsed

    await expand('Exact numerics');
    await waitFor(() => expect(row('bigint')).toBeDefined());
    expect(row('decimal')?.querySelector('.tree-detail')?.textContent).toBe('precision up to 18');
    expect(mock.hits('/catalog/systemtypes')).toHaveLength(1);

    // read-only leaves: no context menu, nothing to open
    fireEvent.contextMenu(row('bigint')!);
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it('is not offered for other providers', async () => {
    render(<Explorer />);
    await expand('Shop (SQLite)');
    await waitFor(() => expect(row('Tables')).toBeDefined());
    expect(row('System Data Types')).toBeUndefined();
    expect(mock.hits('/catalog/systemtypes')).toHaveLength(0);
  });
});

describe('Types folder menus and targets', () => {
  const base: Omit<TreeRow, 'id' | 'kind' | 'label' | 'depth'> = { expandable: true, expanded: false, connectionId: 'c1', database: 'Shop', schema: 'dbo' };
  const folder = (typeKind?: string): TreeRow => ({
    ...base, id: `f${typeKind ?? ''}`, kind: 'folder', label: 'x', depth: 3, objectType: 'type', ...(typeKind ? { typeKind } : {}),
  });
  const object = (typeKind?: string): TreeRow => ({
    ...base, id: `o${typeKind ?? ''}`, kind: 'object', label: 'Phone', depth: 4, expandable: false, objectType: 'type', object: { t: 'type', n: 'Phone' },
    ...(typeKind ? { typeKind } : {}),
  });

  it('a kind sub-folder is a container target that remembers its kind (New type… starts from it)', () => {
    expect(targetOfRow(folder('table'))).toEqual({ kind: 'container', connectionId: 'c1', database: 'Shop', schema: 'dbo', objectType: 'type', typeKind: 'table' });
    expect(targetOfRow(folder())).toEqual({ kind: 'container', connectionId: 'c1', database: 'Shop', schema: 'dbo', objectType: 'type' });
    expect(contextMenuIdOf(folder('table'))).toBe('explorer.container');
  });

  it('types that report a kind get the type menu; other `type` objects keep the generic one', () => {
    expect(contextMenuIdOf(object('alias'))).toBe('explorer.type');
    expect(contextMenuIdOf(object())).toBe('explorer.object');
  });

  it('the System Data Types rows have no target or menu', () => {
    const group: TreeRow = { ...base, id: 'sty', kind: 'sfolder', label: 'System Data Types', depth: 2 };
    expect(targetOfRow(group)).toBeNull();
    expect(contextMenuIdOf(group)).toBeNull();
    expect(contextMenuIdOf({ ...group, kind: 'sysType' })).toBeNull();
  });
});
