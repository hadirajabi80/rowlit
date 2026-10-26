// Link editor dialog and the "Add to linked database" chooser against the MSW mock engine: a new link from connection
// → database → schema → searched tables, alias validation, edits that keep the rest of the profile, explorer tables
// added on open, mount-all, renames, the discard guard and the chooser's answers.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { linkProps, linksApi, type LinkDefinition } from '../../../api/links';
import type { ConnectionInput } from '../../../api/types';
import { useCatalog } from '../../../store/catalog';
import { useConnections } from '../../../store/connections';
import { useTabs } from '../../../store/tabs';
import { chooseOption, selectValue } from '../../../test/select';
import { installMockEngine } from '../../../test/mockServer';
import { LinkEditorDialog } from '../editor/LinkEditorDialog';
import type { LinkEditorRequest } from '../editor/open';
import { unmountTable } from '../editor/save';

const mock = installMockEngine();

const notReady = () => new ApiError('HTTP', 'The link runtime is not available yet', 501);

beforeEach(async () => {
  mock.reset();
  useTabs.setState({ tabs: [], activeId: null, seq: 0 });
  useCatalog.setState({ conns: {}, dbs: {} });
  useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
  await useConnections.getState().load();
  vi.spyOn(linksApi, 'validate').mockRejectedValue(notReady());
});
afterEach(() => vi.restoreAllMocks());

function open(req: LinkEditorRequest) {
  const onClose = vi.fn();
  render(<LinkEditorDialog req={req} onClose={onClose} />);
  return { onClose };
}

const combo = (name: RegExp | string) => screen.getByRole('combobox', { name });
const posted = () => mock.hits('/connections', 'POST');

/** Body of the last POST /connections (the mock engine keeps the created profile). */
const createdProfile = () => mock.ctx.engine.connections[mock.ctx.engine.connections.length - 1];

async function pickPgShopPublic() {
  chooseOption(combo('Connection'), 'Postgres Shop');
  await waitFor(() => expect(selectValue(combo('Database'))).toBe('shop'));
  await waitFor(() => expect(selectValue(combo('Schema'))).toBe('public'));
  await screen.findByRole('checkbox', { name: 'Mount customers' });
}

describe('link editor', () => {
  it('creates a link: connection → database → schema → searched tables, alias from the connection name', async () => {
    const { onClose } = open({ mode: 'new', connectAfter: false });
    expect(screen.getByRole('dialog', { name: 'New linked database' })).toBeInTheDocument();
    await pickPgShopPublic();
    expect(screen.getByLabelText('Alias')).toHaveValue('postgres_shop');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tables' }), { target: { value: 'cust' } });
    expect(screen.queryByRole('checkbox', { name: 'Mount orders' })).not.toBeInTheDocument();
    const matching = document.querySelectorAll('.lke-table input[type=checkbox]').length;
    fireEvent.click(screen.getByRole('button', { name: 'Select matching' }));
    expect(document.querySelector('.lke-count')?.textContent).toMatch(new RegExp(`^${matching} of [0-9]+ selected$`));
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount customers' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tables' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount orders' }));
    expect(document.querySelector('.lke-count')?.textContent).toMatch(/^2 of [0-9]+ selected$/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create linked database' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posted()).toHaveLength(1);
    const p = createdProfile();
    expect(p).toMatchObject({ name: 'Sales', providerId: 'linked', readOnly: true, folder: 'Linked databases' });
    expect(p.props.members).toEqual([{
      alias: 'postgres_shop', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false,
      tables: [{ name: 'customers', type: 'table' }, { name: 'orders', type: 'table' }],
    }]);
    expect(linksApi.validate).toHaveBeenCalledTimes(1);
  });

  it('opens the query builder after creating a link (connectAfter)', async () => {
    open({ mode: 'new', addTables: [{ connectionId: 'c_shop', database: null, schema: 'main', name: 'orders', type: 'table' }] });
    await screen.findByRole('checkbox', { name: 'Mount orders' });
    fireEvent.click(screen.getByRole('button', { name: 'Create linked database' }));
    await waitFor(() => expect(useTabs.getState().tabs.some((t) => t.kind === 'view' && t.view === 'links.builder')).toBe(true));
  });

  it('validates the alias live and blocks saving', async () => {
    const { onClose } = open({ mode: 'new', connectAfter: false });
    await pickPgShopPublic();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount customers' }));
    const alias = screen.getByLabelText('Alias');
    fireEvent.change(alias, { target: { value: 'order' } });
    expect(await screen.findByText(/“order” is reserved/)).toBeInTheDocument();
    expect(alias).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Create linked database' }));
    expect(await screen.findByText(/1 problem to fix/)).toBeInTheDocument();
    expect(posted()).toHaveLength(0);
    // a second source on the same alias
    fireEvent.change(alias, { target: { value: 'crm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));
    chooseOption(combo('Connection'), 'Shop (SQLite)');
    await screen.findByRole('checkbox', { name: 'Mount orders' });
    fireEvent.change(screen.getByLabelText('Alias'), { target: { value: 'crm' } });
    expect(await screen.findByText('Another source already uses this alias.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount orders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create linked database' }));
    await waitFor(() => expect(screen.getByText(/problems? to fix/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(posted()).toHaveLength(0);
  });

  it('shows the engine’s problems and keeps the dialog open', async () => {
    vi.mocked(linksApi.validate).mockResolvedValue({
      ok: false, members: [], problems: [{ severity: 'error', code: 'memberUnreachable', message: 'Postgres Shop does not answer.', member: 0 }],
    });
    const { onClose } = open({ mode: 'new', connectAfter: false });
    await pickPgShopPublic();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount customers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create linked database' }));
    expect(await screen.findByText('Postgres Shop does not answer.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(posted()).toHaveLength(0);
  });

  it('edits a link and keeps its relations, options and other props', async () => {
    const def: LinkDefinition = {
      version: 1,
      members: [{ alias: 'crm', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false, tables: [{ name: 'customers', type: 'table' }] }],
      relations: [{ id: 'r1', from: { alias: 'crm', table: 'customers' }, fromColumns: ['country_id'], to: { alias: 'crm', table: 'countries' }, toColumns: ['id'] }],
      options: { maxRowsPerSource: 5000 },
    };
    const saved = await useConnections.getState().save({
      name: 'CRM link', providerId: 'linked', color: null, folder: 'Linked databases', readOnly: true, props: { ...linkProps(def), extra: 42 },
      savePassword: false, password: null,
    } as ConnectionInput);
    const { onClose } = open({ mode: 'edit', connectionId: saved.id });
    expect(screen.getByRole('dialog', { name: /Edit linked database — CRM link/ })).toBeInTheDocument();
    expect(await screen.findByRole('checkbox', { name: 'Mount customers' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount countries' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of countries in the link' }), { target: { value: 'nations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const p = mock.ctx.engine.conn(saved.id)!;
    expect(p.props.extra).toBe(42);
    expect(p.props.relations).toEqual(def.relations);
    expect(p.props.options).toEqual(def.options);
    expect((p.props.members as LinkDefinition['members'])[0].tables).toEqual([{ name: 'customers', type: 'table' }, { name: 'countries', as: 'nations', type: 'table' }]);
  });

  it('adds explorer tables on open: to the member on the same place, else a new member', async () => {
    const def: LinkDefinition = {
      version: 1, relations: [], options: {},
      members: [{ alias: 'crm', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false, tables: [{ name: 'customers', type: 'table' }] }],
    };
    const saved = await useConnections.getState().save({ name: 'L', providerId: 'linked', color: null, folder: null, readOnly: true, props: linkProps(def), savePassword: false, password: null });
    open({
      mode: 'edit', connectionId: saved.id,
      addTables: [
        { connectionId: 'c_pg', database: 'shop', schema: 'public', name: 'orders', type: 'table' },
        { connectionId: 'c_shop', database: null, schema: 'main', name: 'products', type: 'table' },
      ],
    });
    const sources = screen.getByRole('listbox', { name: 'Sources of the link' });
    expect(within(sources).getAllByRole('option')).toHaveLength(2);
    // the new member is selected
    expect(within(sources).getByRole('option', { name: /shop_sqlite/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('checkbox', { name: 'Mount products' })).toBeChecked();
    fireEvent.click(within(sources).getByRole('option', { name: /crm/ }));
    expect(await screen.findByRole('checkbox', { name: 'Mount orders' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mount customers' })).toBeChecked();
  });

  it('mounts all tables (only renames are listed) and validates renames', async () => {
    const { onClose } = open({ mode: 'new', connectAfter: false });
    chooseOption(combo('Connection'), 'Shop (SQLite)');
    await screen.findByRole('checkbox', { name: 'Mount orders' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount orders' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mount customers' }));
    const rename = screen.getByRole('textbox', { name: 'Name of orders in the link' });
    fireEvent.change(rename, { target: { value: 'customers' } });
    expect(await screen.findByText(/would be called “customers”/)).toBeInTheDocument();
    fireEvent.change(rename, { target: { value: 'sales' } });
    await waitFor(() => expect(screen.queryByText(/would be called/)).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /Mount all tables/ }));
    expect(screen.getByRole('checkbox', { name: 'Mount products' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mount products' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create linked database' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(createdProfile().props.members).toEqual([expect.objectContaining({
      alias: 'shop_sqlite', connectionId: 'c_shop', schema: 'main', allTables: true, tables: [{ name: 'orders', as: 'sales', type: 'table' }],
    })]);
  });

  it('asks before discarding changes', async () => {
    const { onClose } = open({ mode: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    const bar = screen.getByRole('alertdialog', { name: 'Discard changes' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes an unchanged edit without asking', async () => {
    const saved = await useConnections.getState().save({
      name: 'L', providerId: 'linked', color: null, folder: null, readOnly: true, savePassword: false, password: null,
      props: linkProps({ version: 1, relations: [], options: {}, members: [{ alias: 'shop', connectionId: 'c_shop', schema: 'main', allTables: true, tables: [] }] }),
    });
    const { onClose } = open({ mode: 'edit', connectionId: saved.id });
    await screen.findByRole('checkbox', { name: 'Mount orders' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts tables dropped from the explorer', async () => {
    open({ mode: 'new', connectAfter: false });
    const body = document.querySelector('.lke-body')!;
    const data: Record<string, string> = {
      'application/x-rowlit-object': JSON.stringify({ connectionId: 'c_shop', providerId: 'sqlite', database: null, schema: 'main', name: 'countries', type: 'table' }),
    };
    const dataTransfer = { types: Object.keys(data), getData: (t: string) => data[t] ?? '', dropEffect: 'none' };
    act(() => {
      fireEvent.dragOver(body, { dataTransfer });
      fireEvent.drop(body, { dataTransfer });
    });
    expect(await screen.findByRole('checkbox', { name: 'Mount countries' })).toBeChecked();
  });
});

describe('unmountTable', () => {
  it('removes a table, turning "all tables" into the explicit rest', async () => {
    const saved = await useConnections.getState().save({
      name: 'L', providerId: 'linked', color: null, folder: null, readOnly: true, savePassword: false, password: null,
      props: linkProps({
        version: 1, relations: [], options: {},
        members: [
          { alias: 'crm', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false, tables: [{ name: 'customers' }, { name: 'orders', as: 'sales' }] },
          { alias: 'shop', connectionId: 'c_shop', schema: 'main', allTables: true, tables: [{ name: 'products', as: 'items' }] },
        ],
      }),
    });
    await unmountTable(saved.id, 'crm', 'sales');
    await unmountTable(saved.id, 'shop', 'orders');
    const members = mock.ctx.engine.conn(saved.id)!.props.members as LinkDefinition['members'];
    expect(members[0].tables).toEqual([{ name: 'customers' }]);
    expect(members[1].allTables).toBe(false);
    const names = members[1].tables.map((t) => t.as ?? t.name);
    expect(names).toContain('items');
    expect(names).toContain('customers');
    expect(names).not.toContain('orders');
  });
});
