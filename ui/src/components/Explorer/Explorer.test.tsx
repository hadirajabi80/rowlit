import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { CONNECTION_FOLDERS_KEY } from '../../store/connectionFolders';
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { useTabs } from '../../store/tabs';
import { installMockEngine } from '../../test/mockServer';
import { Explorer, useExplorer } from './Explorer';

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

describe('Explorer', () => {
  beforeEach(async () => {
    mock.reset();
    localStorage.clear();
    useExplorer.setState({ expanded: new Set(), collapsedFolders: new Set(), filter: '', selected: null });
    useCatalog.setState({ conns: {}, dbs: {} });
    useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
    useTabs.setState({ tabs: [], activeId: null, seq: 0 });
    useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
    useUi.setState({ toasts: [] });
    await useConnections.getState().load();
  });

  it('shows every saved connection as a root (grouped by folder) without loading any catalog', () => {
    render(<Explorer />);
    expect(row('Shop (SQLite)')).toBeDefined();
    expect(row('Work')).toBeDefined(); // folder
    expect(row('Prod SQL')).toBeDefined();
    expect(row('Oracle Shop')).toBeDefined();
    expect(mock.ctx.requests.filter((r) => r.url.pathname.includes('/catalog'))).toHaveLength(0);
  });

  it('creates an empty folder from the explorer and persists it across a settings reload', async () => {
    useConnections.setState({ connections: [] });
    render(<Explorer />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: '  Production  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(row('Production')).toBeDefined();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(mock.ctx.engine.settings.ui?.[CONNECTION_FOLDERS_KEY]).toEqual(['Production']));
    await act(async () => {
      useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
      await useSettings.getState().load();
    });
    expect(row('Production')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Production' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    expect(screen.getByRole('alert')).toHaveTextContent('already exists');
  });

  it('drags a saved server into a collapsed folder, preserves its profile, and can move it back out', async () => {
    useSettings.setState({ settings: { ...useSettings.getState().settings, ui: { [CONNECTION_FOLDERS_KEY]: ['Production'] } } });
    useExplorer.setState({ collapsedFolders: new Set(['Production']) });
    render(<Explorer />);
    const original = useConnections.getState().connections.find((c) => c.id === 'c_prod')!;
    const data = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[], effectAllowed: '', dropEffect: '',
      setData(type: string, value: string) { data.set(type, value); this.types.push(type); },
      getData(type: string) { return data.get(type) ?? ''; },
    };
    fireEvent.dragStart(row('Prod SQL')!, { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('move');
    fireEvent.dragOver(row('Production')!, { dataTransfer });
    expect(row('Production')).toHaveClass('connection-drop-target');
    fireEvent.drop(row('Production')!, { dataTransfer });
    await waitFor(() => expect(useConnections.getState().connections.find((c) => c.id === original.id)?.folder).toBe('Production'));
    const moved = useConnections.getState().connections.find((c) => c.id === original.id)!;
    expect(moved).toMatchObject({ ...original, folder: 'Production' });
    expect(row('Production')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Prod SQL')).toHaveAttribute('aria-level', '2');
    fireEvent.drop(screen.getByRole('tree', { name: 'Connections' }), { dataTransfer });
    await waitFor(() => expect(useConnections.getState().connections.find((c) => c.id === original.id)?.folder).toBeNull());
    expect(row('Prod SQL')).toHaveAttribute('aria-level', '1');
    expect(row('Production')).toBeDefined();
    expect(mock.hits('/sessions')).toHaveLength(0);
    await waitFor(() => expect(mock.ctx.engine.settings.ui?.[CONNECTION_FOLDERS_KEY]).toContain('Work'));
  });

  it('keeps the connection in its original folder when saving the move fails', async () => {
    mock.server.use(http.put('*/connections/:id', () => HttpResponse.json({ error: { message: 'Could not save', code: 'IO_ERROR' } }, { status: 500 })));
    render(<Explorer />);
    const original = useConnections.getState().connections.find((c) => c.id === 'c_shop')!;
    const dataTransfer = { types: ['application/x-rowlit-connection'], getData: () => original.id };
    fireEvent.drop(row('Work')!, { dataTransfer });
    await waitFor(() => expect(useUi.getState().toasts.some((t) => t.text === 'Could not move connection')).toBe(true));
    expect(useConnections.getState().connections.find((c) => c.id === original.id)?.folder).toBe(original.folder);
  });

  it('loads databases, schemas and objects lazily, one level per expansion', async () => {
    render(<Explorer />);
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    expect(row('master')).toBeDefined();
    expect(mock.hits('/catalog/databases')).toHaveLength(1);
    expect(mock.hits('/catalog/schemas')).toHaveLength(0);
    expect(mock.hits('/catalog')).toHaveLength(0);

    await expand('Shop');
    await waitFor(() => expect(row('dbo')).toBeDefined());
    expect(row('Sales')).toBeDefined();
    expect(mock.hits('/catalog/schemas')).toHaveLength(1);
    expect(mock.hits('/catalog')).toHaveLength(0);

    await expand('dbo');
    await waitFor(() => expect(row('Tables')).toBeDefined());
    expect(row('Procedures')).toBeDefined();
    const catalogCalls = mock.hits('/catalog');
    expect(catalogCalls).toHaveLength(1);
    expect(catalogCalls[0].url.searchParams.get('schemas')).toBe('dbo');
    expect(catalogCalls[0].url.searchParams.get('database')).toBe('Shop');
    // Sales was never expanded, so it was never fetched.
    expect(useCatalog.getState().dbs[`c_prod\u0001Shop`].loaded.Sales).toBeUndefined();

    await expand('Tables');
    await waitFor(() => expect(row('customers')).toBeDefined());
    await expand('customers');
    await waitFor(() => expect(row('email')).toBeDefined());
    // Columns come from the already loaded snapshot: no extra request.
    expect(mock.hits('/catalog')).toHaveLength(1);
  });

  it('keeps a single Oracle schema explicit and loads objects only after it expands', async () => {
    mock.server.use(http.get('*/api/v1/connections/c_ora/catalog/schemas', () => HttpResponse.json({ database: null, defaultSchema: 'SHOP', schemas: [{ name: 'SHOP', loaded: false, objectCount: 1 }] })));
    render(<Explorer />);
    await expand('Oracle Shop');
    await waitFor(() => expect(row('SHOP')).toBeDefined());
    expect(row('Tables')).toBeUndefined();
    expect(mock.hits('/catalog/schemas')).toHaveLength(1);
    expect(mock.hits('/catalog')).toHaveLength(0);

    await expand('SHOP');
    await waitFor(() => expect(row('Tables')).toBeDefined());
    const catalogCalls = mock.hits('/catalog');
    expect(catalogCalls).toHaveLength(1);
    expect(catalogCalls[0].url.searchParams.get('schemas')).toBe('SHOP');
    expect(catalogCalls[0].url.searchParams.get('database')).toBeNull();
  });

  it('keeps SQL Server single schema explicit: database → dbo → Tables (master)', async () => {
    render(<Explorer />);
    await expand('Prod SQL');
    await waitFor(() => expect(row('master')).toBeDefined());

    await expand('master');
    await waitFor(() => expect(row('dbo')).toBeDefined());
    expect(row('Tables')).toBeUndefined(); // objects load only when dbo expands
    expect(mock.hits('/catalog/schemas')).toHaveLength(1);
    expect(mock.hits('/catalog')).toHaveLength(0);

    await expand('dbo');
    await waitFor(() => expect(row('Tables')).toBeDefined());
    const catalogCalls = mock.hits('/catalog');
    expect(catalogCalls).toHaveLength(1);
    expect(catalogCalls[0].url.searchParams.get('schemas')).toBe('dbo');
    expect(catalogCalls[0].url.searchParams.get('database')).toBe('master');
  });

  it("Oracle's Tables folder lists every table of the expanded schema and none of another", async () => {
    render(<Explorer />);
    await expand('Oracle Shop');
    await waitFor(() => expect(row('SHOP')).toBeDefined());
    expect(row('HR')).toBeDefined();

    await expand('SHOP');
    await expand('Tables');
    const tables = mock.ctx.engine.catalog('c_ora', null, ['SHOP']).schemas[0].objects.filter((o) => o.t === 'table');
    expect(tables.length).toBeGreaterThan(1);
    for (const o of tables) await waitFor(() => expect(row(o.n)).toBeDefined());
    // HR owns a COUNTRIES table too: it stays out of SHOP's folder (the load asked for SHOP only)
    expect(screen.getAllByRole('treeitem').filter((el) => el.querySelector('.tree-label')?.textContent === 'COUNTRIES')).toHaveLength(1);
    const catalogCalls = mock.hits('/catalog');
    expect(catalogCalls).toHaveLength(1);
    expect(catalogCalls[0].url.searchParams.get('schemas')).toBe('SHOP');
  });

  it('skips the schema level when a database has a single schema (SQLite) and keeps connections independent', async () => {
    render(<Explorer />);
    await expand('Shop (SQLite)');
    // SQLite's single "main" database and single schema are both flattened.
    await waitFor(() => expect(row('Tables')).toBeDefined());
    expect(row('main')).toBeUndefined();
    expect(row('Triggers')).toBeDefined();
    // a second connection open at the same time
    await expand('Prod SQL');
    await waitFor(() => expect(row('Shop')).toBeDefined());
    expect(Object.keys(useCatalog.getState().conns).sort()).toEqual(['c_prod', 'c_shop']);
    expect(row('Tables')).toBeDefined(); // SQLite tree still expanded
  });

  it('fuzzy-filters loaded objects across connections', async () => {
    render(<Explorer />);
    await expand('Shop (SQLite)');
    // SQLite's single "main" database and single schema are both flattened.
    await waitFor(() => expect(row('Tables')).toBeDefined());
    expect(row('main')).toBeUndefined();
    act(() => useExplorer.getState().setFilter('ordln'));
    await waitFor(() => expect(row('order_lines')).toBeDefined());
    expect(row('customers')).toBeUndefined();
    expect(screen.getByRole('treeitem', { name: /order_lines/ }).querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  it('shows a load error under the connection and does not retry in a loop', async () => {
    mock.ctx.engine.connections.push({ ...mock.ctx.engine.connections[0], id: 'c_gone', name: 'Gone' });
    await useConnections.getState().load();
    mock.ctx.engine.connections = mock.ctx.engine.connections.filter((c) => c.id !== 'c_gone');
    render(<Explorer />);
    await expand('Gone');
    await waitFor(() => expect(screen.getByText('Connection not found')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.hits('/catalog/databases')).toHaveLength(1);
  });
});
