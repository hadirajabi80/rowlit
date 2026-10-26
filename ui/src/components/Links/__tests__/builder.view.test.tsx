// The query builder tab against the MSW mock engine (linked mock pack: c_link = crm × shop × erp): adding tables from
// the list (auto join over the link's relation), column checkboxes, undo / redo, a column → column drag that opens the
// join editor, join type changes, filters through the FilterBar, Run in the tab's own session, Save as linked view,
// Advanced mode and back (parse), explorer drops, and the explorer / builder menus.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { linksApi } from '../../../api/links';
import type { ExecuteRequest } from '../../../api/types';
import { initCommands } from '../../../commands';
import { contextMenuEntries, hasContextMenu } from '../../../commands/menuModel';
import { getCommand, runCommand } from '../../../commands/registry';
import { ROWLIT_OBJECT_MIME } from '../../../lib/dragObject';
import { useCatalog } from '../../../store/catalog';
import { useConnections } from '../../../store/connections';
import { useLinks } from '../../../store/links';
import { useResults } from '../../../store/results';
import { useSessions } from '../../../store/sessions';
import { useSettings } from '../../../store/settings';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { useUi } from '../../../store/ui';
import { installMockEngine } from '../../../test/mockServer';
import { chooseOption } from '../../../test/select';
import { BuilderView } from '../builder/BuilderView';
import { LINK_BUILDER_VIEW, openBuilder } from '../open';

// Monaco is not part of the jsdom suite: the SQL panel's editor is a textarea here
vi.mock('../../../editor/SqlEditor', () => ({
  SqlEditor: (p: { value: string; readOnly?: boolean; onChange(v: string): void; tabId: string }) => (
    <textarea data-testid={p.readOnly ? 'sql-preview' : 'sql-editor'} aria-label={p.readOnly ? 'SQL preview' : 'SQL editor'} value={p.value} readOnly={p.readOnly} onChange={(e) => p.onChange(e.target.value)} />
  ),
}));

const mock = installMockEngine({ frameDelay: 0 });

beforeAll(async () => {
  await initCommands();
}, 60_000);

beforeEach(async () => {
  mock.reset({ frameDelay: 0 });
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useSessions.setState({ sessions: {}, byTab: {} });
  useUi.setState({ confirm: null, toasts: [] });
  useLinks.setState({ catalogs: {}, views: {}, history: {} });
  useCatalog.setState({ conns: {}, dbs: {} });
  await useSettings.getState().load();
  await useConnections.getState().load();
});
afterEach(() => vi.restoreAllMocks());

const tabOf = () => useTabs.getState().tabs.find((t): t is ViewTab => t.kind === 'view' && t.view === LINK_BUILDER_VIEW)!;

function Host() {
  const tab = useTabs((s) => s.tabs.find((t): t is ViewTab => t.kind === 'view' && t.view === LINK_BUILDER_VIEW));
  return tab ? <BuilderView tab={tab} theme="light" visible /> : null;
}

async function openAndRender(opts: Parameters<typeof openBuilder>[1] = {}) {
  openBuilder('c_link', opts);
  render(<Host />);
  await screen.findByRole('treeitem', { name: /customers/ });
}

const listItem = (name: string) => screen.getAllByRole('treeitem').find((e) => e.querySelector('.lkb-list-name')?.textContent === name)!;
const preview = () => (screen.getByTestId('sql-preview') as HTMLTextAreaElement).value;
const model = () => (tabOf().state as { model: import('../../../api/links').BuilderModel }).model;

describe('query builder view', () => {
  it('adds tables (auto join over the relation), selects columns, undoes and redoes', async () => {
    await openAndRender();
    fireEvent.click(listItem('customers'));
    await screen.findByRole('group', { name: 'Table crm.customers' });
    fireEvent.click(listItem('orders'));
    await screen.findByRole('group', { name: 'Table shop.orders' });
    await waitFor(() => expect(preview()).toContain('INNER JOIN shop.orders AS orders ON customers.id = orders.customer_id'));
    expect(screen.getByRole('status')).toHaveTextContent(/Joined orders\.customer_id = customers\.id/);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show customers.name in the results' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show orders.total in the results' }));
    await waitFor(() => expect(preview().startsWith('SELECT customers.name, orders.total\nFROM crm.customers AS customers')).toBe(true));
    expect(screen.getByRole('tab', { name: /Columns/ })).toHaveTextContent('2');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(preview().startsWith('SELECT customers.name\n')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(preview()).toContain('orders.total'));

    // select all from the card header, then remove a table (its join and columns go too)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all columns of orders' }));
    await waitFor(() => expect(model().columns.filter((c) => c.tableId === 't2').length).toBeGreaterThan(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove orders from the query' }));
    await waitFor(() => expect(preview()).toBe('SELECT customers.name\nFROM crm.customers AS customers'));
  });

  it('joins by dragging a column onto a column, then edits the join in the popover', async () => {
    await openAndRender();
    fireEvent.click(listItem('customers'));
    fireEvent.click(listItem('products'));
    await screen.findByRole('group', { name: 'Table erp.products' });
    expect(model().joins).toEqual([]);
    const src = within(screen.getByRole('group', { name: 'Table crm.customers' })).getByText('name');
    const target = within(screen.getByRole('group', { name: 'Table erp.products' })).getByText('name').closest('[data-col-row]')!;
    const elementFromPoint = vi.fn(() => target);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });
    act(() => {
      fireEvent.pointerDown(src, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 40 }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, clientY: 40 }));
    });
    const pop = await screen.findByRole('dialog', { name: 'Join customers and products' });
    expect(model().joins[0]).toMatchObject({ type: 'inner', on: [{ leftColumn: 'name', rightColumn: 'name' }] });
    fireEvent.click(within(pop).getByRole('radio', { name: /Left/ }));
    fireEvent.click(within(pop).getByRole('checkbox', { name: /Ignore case/ }));
    await waitFor(() => expect(preview()).toContain('LEFT JOIN erp.products AS products ON lower(customers.name) = lower(products.name)'));
    fireEvent.click(within(pop).getByRole('button', { name: 'Remove join' }));
    await waitFor(() => expect(model().joins).toEqual([]));
    expect(preview()).toContain('CROSS JOIN erp.products AS products');
  });

  it('filters with the FilterBar (as.column names in the bar, tableId.column in the model) and limits', async () => {
    await openAndRender();
    fireEvent.click(listItem('orders'));
    await screen.findByRole('group', { name: 'Table shop.orders' });
    fireEvent.click(screen.getByRole('tab', { name: /Filters/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add condition/ }));
    const cond = await screen.findByRole('group', { name: /Condition on orders\./ });
    chooseOption(within(cond).getByRole('combobox', { name: 'Column' }), /^orders\.status/);
    chooseOption(within(screen.getByRole('group', { name: /Condition on orders\.status/ })).getByRole('combobox', { name: 'Operator' }), /equals/i);
    fireEvent.change(within(screen.getByRole('group', { name: /Condition on orders\.status/ })).getByRole('textbox'), { target: { value: 'paid' } });
    await waitFor(() => expect(model().filter?.items[0]).toMatchObject({ column: 't1.status', values: ['paid'] }));
    await waitFor(() => expect(preview()).toContain("WHERE lower(orders.status) = lower('paid')"));
    fireEvent.click(screen.getByRole('tab', { name: /Limit/ }));
    fireEvent.click(screen.getByRole('button', { name: '100' }));
    await waitFor(() => expect(preview()).toContain('LIMIT 100'));
  });

  it('runs in its own session on the link with the compiled SQL and bind parameters', async () => {
    const execute = vi.spyOn(mock.ctx.engine, 'execute');
    await openAndRender();
    fireEvent.click(listItem('orders'));
    await screen.findByRole('group', { name: 'Table shop.orders' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show orders.id in the results' }));
    act(() => {
      useTabs.getState().updateView(tabOf().id, {
        state: { ...(tabOf().state as object), model: { ...model(), filter: { kind: 'group', id: 'g', logic: 'and', items: [{ kind: 'condition', id: 'c', column: 't1.status', op: 'eq', values: ['paid'], enabled: true }] } } },
      });
    });
    fireEvent.keyDown(screen.getByRole('application'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(execute).toHaveBeenCalled());
    const req = execute.mock.calls[0][1] as ExecuteRequest;
    expect(req.batches[0].sql).toBe('SELECT orders.id\nFROM shop.orders AS orders\nWHERE lower(orders.status) = lower($fp1)');
    expect(req.params).toEqual([{ name: 'fp1', kind: 'string', value: 'paid' }]);
    expect(useSessions.getState().sessions[useSessions.getState().byTab[tabOf().id]]?.connectionId).toBe('c_link');
    expect(useResults.getState().byTab[tabOf().id]).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Results/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('saves as a linked view and reopens it from the explorer saved-query target', async () => {
    await openAndRender();
    fireEvent.click(listItem('customers'));
    await screen.findByRole('group', { name: 'Table crm.customers' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show customers.email in the results' }));
    fireEvent.click(screen.getByRole('button', { name: /Save as view/ }));
    const dlg = await screen.findByRole('dialog', { name: 'Save as linked view' });
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Name' }), { target: { value: 'Customer emails' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(tabOf().title).toBe('Customer emails (Sales (linked))'));
    const views = await linksApi.views('c_link');
    const v = views.find((x) => x.name === 'Customer emails')!;
    expect(v.sql).toBe('SELECT customers.email\nFROM crm.customers AS customers');
    expect(v.builder?.tables[0]).toMatchObject({ alias: 'crm', table: 'customers' });

    useTabs.setState({ tabs: [], activeId: null });
    await act(async () => {
      runCommand('links.openView', { kind: 'savedQuery', connectionId: 'c_link', database: null, schema: 'views', id: v.id, name: v.name });
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(tabOf()?.key).toBe(`c_link:${LINK_BUILDER_VIEW}:view:${v.id}`));
    expect((tabOf().state as { model: unknown }).model).toEqual(v.builder);
  });

  it('switches to Advanced SQL and back: unchanged SQL returns at once, edited SQL is parsed into the model', async () => {
    await openAndRender();
    fireEvent.click(listItem('customers'));
    await screen.findByRole('group', { name: 'Table crm.customers' });
    fireEvent.click(screen.getByRole('button', { name: /Edit SQL \(Advanced\)/ }));
    const ed = await screen.findByTestId('sql-editor');
    expect((ed as HTMLTextAreaElement).value).toBe('SELECT *\nFROM crm.customers AS customers');
    fireEvent.change(ed, { target: { value: 'SELECT customers.name AS who\nFROM crm.customers AS customers\nLIMIT 5' } });
    const parse = vi.spyOn(linksApi, 'parse');
    fireEvent.click(screen.getByRole('button', { name: /Back to builder/ }));
    await waitFor(() => expect(parse).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('sql-preview')).toBeInTheDocument());
    expect(model().columns[0]).toMatchObject({ column: 'name', alias: 'who' });
    expect(model().limit).toBe(5);
  });

  it('adds tables dropped from the explorer (the link itself or a member connection)', async () => {
    await openAndRender();
    const canvas = screen.getByRole('application');
    const drop = (payload: object) => {
      const data: Record<string, string> = { [ROWLIT_OBJECT_MIME]: JSON.stringify(payload) };
      const dataTransfer = { types: Object.keys(data), getData: (k: string) => data[k] ?? '', dropEffect: 'none' };
      fireEvent.dragOver(canvas, { dataTransfer });
      fireEvent.drop(canvas, { dataTransfer });
    };
    drop({ connectionId: 'c_link', providerId: 'linked', database: null, schema: 'shop', name: 'orders', type: 'table' });
    await screen.findByRole('group', { name: 'Table shop.orders' });
    drop({ connectionId: 'c_pg', providerId: 'postgresql', database: 'shop', schema: 'public', name: 'customers', type: 'table' });
    await screen.findByRole('group', { name: 'Table crm.customers' });
    drop({ connectionId: 'c_pg', providerId: 'postgresql', database: 'shop', schema: 'public', name: 'not_mounted', type: 'table' });
    await waitFor(() => expect(useUi.getState().toasts.some((t) => /not part of/.test(t.text))).toBe(true));
  });
});

describe('links commands and menus', () => {
  it('registers the explorer and builder menus and the reserved commands', () => {
    for (const id of ['explorer.link', 'explorer.linkTable', 'builder.canvas', 'builder.table', 'builder.column', 'builder.join']) expect(hasContextMenu(id), id).toBe(true);
    const ids = (id: string) => contextMenuEntries(id).flatMap((e) => (typeof e === 'object' && 'command' in e ? [e.command] : []));
    expect(ids('explorer.link')).toEqual(expect.arrayContaining(['links.builder', 'links.edit', 'links.refreshSources', 'connections.delete']));
    expect(ids('explorer.linkTable')).toEqual(expect.arrayContaining(['links.builderAddTable', 'links.removeTable']));
    for (const id of ['links.new', 'links.edit', 'links.duplicate', 'links.builder', 'links.refreshSources', 'links.openView', 'links.plan', 'links.run', 'links.undo']) {
      expect(getCommand(id), id).toBeTruthy();
    }
  });

  it('opens the builder from the explorer with the table on the canvas', async () => {
    runCommand('links.builderAddTable', { kind: 'object', connectionId: 'c_link', database: null, ref: { database: null, schema: 'crm', name: 'countries', type: 'table' } });
    expect((tabOf().state as { pendingAdd: unknown }).pendingAdd).toEqual([{ alias: 'crm', table: 'countries' }]);
    render(<Host />);
    await screen.findByRole('group', { name: 'Table crm.countries' });
    expect((tabOf().state as { pendingAdd: unknown[] }).pendingAdd).toEqual([]);
  });
});
