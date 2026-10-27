// The query builder over wide members (whole database / whole connection) against the MSW mock engine: the default
// schema's tables first, the other schemas / databases loaded on expand (POST /links/{cid}/browse), search with
// "Search in alias…", adding a nested table (natural name in the SQL), a saved model resolved by engine name, and the
// compiler's natural form.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { linkProps, linksApi, type BuilderModel, type LinkMember } from '../../../api/links';
import { initCommands } from '../../../commands';
import { useCatalog } from '../../../store/catalog';
import { useConnections } from '../../../store/connections';
import { useLinks } from '../../../store/links';
import { useSessions } from '../../../store/sessions';
import { useSettings } from '../../../store/settings';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { useUi } from '../../../store/ui';
import { installMockEngine } from '../../../test/mockServer';
import { BuilderView } from '../builder/BuilderView';
import { compileBuilder } from '../builder/compile';
import { LINK_BUILDER_VIEW, openBuilder } from '../open';

vi.mock('../../../editor/SqlEditor', () => ({
  SqlEditor: (p: { value: string; readOnly?: boolean; onChange(v: string): void }) => (
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
  useLinks.setState({ catalogs: {}, views: {}, history: {}, browse: {}, extra: {}, resolved: {} });
  useCatalog.setState({ conns: {}, dbs: {} });
  await useSettings.getState().load();
  await useConnections.getState().load();
});
afterEach(() => vi.restoreAllMocks());

/** PostgreSQL shop as a whole database (default schema public, plus sales) and SQL Server as a whole connection. */
const PG: LinkMember = { alias: 'pg', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: null, scope: 'database', allTables: true, tables: [] };
const MS: LinkMember = { alias: 'ms', kind: 'connection', connectionId: 'c_prod', database: null, schema: null, scope: 'connection', allTables: true, tables: [] };

async function wideLink(members: LinkMember[] = [PG]): Promise<string> {
  const saved = await useConnections.getState().save({
    name: 'Wide', providerId: 'linked', color: null, folder: null, readOnly: true, savePassword: false, password: null,
    props: linkProps({ version: 2, relations: [], options: {}, members }),
  });
  return saved.id;
}

function Host() {
  const tab = useTabs((s) => s.tabs.find((t): t is ViewTab => t.kind === 'view' && t.view === LINK_BUILDER_VIEW));
  return tab ? <BuilderView tab={tab} theme="light" visible /> : null;
}

const tabOf = () => useTabs.getState().tabs.find((t): t is ViewTab => t.kind === 'view' && t.view === LINK_BUILDER_VIEW)!;
const model = () => (tabOf().state as { model: BuilderModel }).model;
const preview = () => (screen.getByTestId('sql-preview') as HTMLTextAreaElement).value;
const flatItem = (name: string) => screen.getAllByRole('treeitem').find((e) => e.querySelector('.lkb-list-name')?.textContent === name && !e.classList.contains('nested'));

describe('builder table list: wide members', () => {
  it('lists the default schema first, loads another schema on expand and adds its table in natural form', async () => {
    const id = await wideLink();
    const browse = vi.spyOn(linksApi, 'browse');
    openBuilder(id);
    render(<Host />);
    await waitFor(() => expect(flatItem('customers')).toBeDefined());
    // the first level (schemas of shop) is listed without their tables
    const sales = await screen.findByRole('treeitem', { name: 'schema sales' });
    expect(screen.getByRole('treeitem', { name: 'schema public' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'pg.sales.orders' })).not.toBeInTheDocument();
    expect(browse).toHaveBeenCalledWith(id, { alias: 'pg', path: [] });
    fireEvent.click(sales);
    expect(sales).toHaveAttribute('aria-expanded', 'true');
    const orders = await screen.findByRole('treeitem', { name: 'pg.sales.orders' });
    expect(browse).toHaveBeenCalledWith(id, { alias: 'pg', path: ['sales'] });
    fireEvent.click(orders);
    await screen.findByRole('group', { name: 'Table pg.sales.orders' });
    expect(model().tables[0]).toMatchObject({ alias: 'pg', table: 'sales.orders', as: 'orders' });
    await waitFor(() => expect(preview()).toBe('SELECT *\nFROM pg.sales.orders AS orders'));
    // its columns are known (browse results join the catalog)
    expect(within(screen.getByRole('group', { name: 'Table pg.sales.orders' })).getByText('total')).toBeInTheDocument();
  });

  it('searches loaded names and reads matching containers with “Search in alias…”', async () => {
    const id = await wideLink([MS]);
    openBuilder(id);
    render(<Host />);
    // whole connection: databases first
    const staging = await screen.findByRole('treeitem', { name: 'database Staging' });
    expect(screen.getByRole('treeitem', { name: 'database Shop' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'database master' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a table' }), { target: { value: 'stag' } });
    expect(staging).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'database Shop' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Search in ms/ }));
    // Staging is opened and read: its schema dbo appears
    await screen.findByRole('treeitem', { name: 'schema dbo' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a table' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('treeitem', { name: 'schema dbo' }));
    const t = await screen.findByRole('treeitem', { name: 'ms.Staging.dbo.orders' });
    fireEvent.click(t);
    await waitFor(() => expect(preview()).toBe('SELECT *\nFROM ms.Staging.dbo.orders AS orders'));
    expect(model().tables[0].table).toBe('Staging.dbo.orders');
  });

  it('resolves the nested tables of a saved model that the catalog does not have yet', async () => {
    const id = await wideLink();
    const resolve = vi.spyOn(linksApi, 'resolve');
    const saved: BuilderModel = {
      version: 1, tables: [{ id: 't1', alias: 'pg', table: 'sales.orders', as: 'o', x: 40, y: 40 }], joins: [], columns: [], groupBy: [], sort: [],
    };
    openBuilder(id, { view: { id: 'v1', name: 'Nested', sql: 'SELECT * FROM pg.sales.orders AS o', builder: saved } });
    render(<Host />);
    await screen.findByRole('group', { name: /Table pg\.sales\.orders/ });
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(id, { tables: [{ alias: 'pg', table: 'sales.orders' }] }));
    await waitFor(() => expect(within(screen.getByRole('group', { name: /Table pg\.sales\.orders/ })).getByText('total')).toBeInTheDocument());
    expect(document.querySelector('.lkb-card.missing')).toBeNull();
    expect(preview()).toBe('SELECT *\nFROM pg.sales.orders AS o');
  });
});

describe('compileBuilder natural form', () => {
  it('writes a table with a path as alias.part.part (quoted when needed), others as alias.table', () => {
    const m: BuilderModel = {
      version: 1, joins: [], columns: [], groupBy: [], sort: [],
      tables: [
        { id: 't1', alias: 'crm', table: 'sales.orders', as: 'orders', x: 0, y: 0 },
        { id: 't2', alias: 'crm', table: 'customers', as: 'customers', x: 0, y: 0 },
        { id: 't3', alias: 'ms', table: 'Staging.dbo.Order Lines', as: 'lines', x: 0, y: 0 },
      ],
    };
    const paths = { 'crm.sales.orders': ['sales', 'orders'], 'ms.Staging.dbo.Order Lines': ['Staging', 'dbo', 'Order Lines'] };
    expect(compileBuilder(m, {}, paths).sql).toBe(
      'SELECT *\nFROM crm.sales.orders AS orders\nCROSS JOIN crm.customers AS customers\nCROSS JOIN ms.Staging.dbo."Order Lines" AS lines',
    );
    // without paths (older catalogs): the engine name, quoted as one identifier
    expect(compileBuilder(m, {}).sql).toContain('FROM crm."sales.orders" AS orders');
  });
});
