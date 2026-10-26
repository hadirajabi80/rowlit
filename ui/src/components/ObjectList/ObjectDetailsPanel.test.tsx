// Details side panel of the Objects tab (dependencies of the selected object) against the mock engine: selection →
// dependencies, debounce and cache, close / re-open persisted with the tab, click-through, empty / error states.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DependencyGraph } from '../../api/types.objects';
import { initCommands } from '../../commands';
import { runCommand } from '../../commands/registry';
import { useConnections } from '../../store/connections';
import { useSettings } from '../../store/settings';
import { useTabs, type ViewTab } from '../../store/tabs';
import { installMockEngine } from '../../test/mockServer';
import { clampDetailsWidth, DEFAULT_DETAILS, DETAILS_MAX_W, DETAILS_MIN_W, detailsOf, forgetDetails } from './detailsModel';
import { homeStateOf } from './home';
import { OBJECTS_VIEW } from './model';
import { ObjectListView } from './ObjectListView';
import { openObjects, type ObjectsState } from './open';

const mock = installMockEngine({ frameDelay: 0 });
const SLOW = { timeout: 8000 };

beforeAll(async () => {
  await initCommands();
});

beforeEach(async () => {
  forgetDetails();
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  await useSettings.getState().load();
  await useConnections.getState().load();
});

afterEach(() => {
  mock.server.resetHandlers();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 0 });
});

function Host({ id }: { id: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <ObjectListView tab={tab} theme="light" visible /> : null;
}

const stateOf = (id: string) => (useTabs.getState().tabs.find((t) => t.id === id) as ViewTab).state as ObjectsState;
const row = (name: string) => screen.getAllByRole('option').find((o) => o.querySelector('.ol-name-text')?.textContent === name)!;
const select = (name: string) => fireEvent.mouseDown(row(name));
const hits = () => mock.hits('/catalog/dependencies');
const dep = (kind: DependencyGraph['uses'][number]['kind'], schema: string, name: string, type: DependencyGraph['root']['type'], detail: string | null = null): DependencyGraph['uses'][number] => ({
  kind, object: { database: null, schema, name, type }, detail, isSchemaBound: null,
});

function openList(group: ObjectsState['group'], extra: Partial<ObjectsState> = {}) {
  const id = openObjects({ connectionId: 'c_prod', database: null, schema: 'dbo', group });
  if (Object.keys(extra).length) act(() => useTabs.getState().updateView(id, { state: { ...stateOf(id), ...extra } }));
  return id;
}

describe('details model', () => {
  it('repairs the persisted state and clamps the width', () => {
    expect(detailsOf(undefined)).toEqual(DEFAULT_DETAILS);
    expect(detailsOf({ open: false, width: 99999 })).toEqual({ open: false, width: DETAILS_MAX_W });
    expect(detailsOf({ open: 'yes', width: 'wide' })).toEqual(DEFAULT_DETAILS);
    expect(clampDetailsWidth(10)).toBe(DETAILS_MIN_W);
    // the list keeps its room: a 700px tab leaves at most 340px to the panel
    expect(clampDetailsWidth(600, 700)).toBe(340);
  });

  it('the pinned Objects tab keeps it in its workspace state', () => {
    expect(homeStateOf({ state: { layout: 'list' } } as ViewTab).details).toBeUndefined();
    expect(homeStateOf({ state: { details: { open: false, width: 10 } } } as ViewTab).details).toEqual({ open: false, width: DETAILS_MIN_W });
  });
});

describe('Objects tab details panel', () => {
  it('shows the dependencies of the selected procedure with a header and quick actions', async () => {
    const id = openList('proc');
    render(<Host id={id} />);
    // GetCustomer, GetActiveSessionByUniqueId (Execute routine fixture), MonthlyReport
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3), SLOW);
    select('MonthlyReport');
    const panel = await screen.findByRole('complementary', { name: 'Details of dbo.MonthlyReport' }, SLOW);
    expect(within(panel).getByText('Procedure')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Open/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Execute/ })).toBeInTheDocument();
    // loading skeleton first, then the grouped columns
    const uses = await within(panel).findByRole('region', { name: 'Uses' }, SLOW);
    expect(uses.textContent).toMatch(/Tables/);
    expect(within(panel).getByRole('region', { name: 'Used by' })).toBeInTheDocument();
    expect(hits()).toHaveLength(1);
  });

  it('debounces the selection and caches per object', async () => {
    const id = openList('table');
    render(<Host id={id} />);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(6), SLOW);
    // arrowing through three rows within the debounce window asks once, for the last row
    select('countries');
    select('events');
    select('orders');
    await screen.findByRole('region', { name: 'Uses' }, SLOW);
    expect(hits()).toHaveLength(1);
    expect(hits()[0].url.searchParams.get('name')).toBe('orders');
    // another object: one more request; coming back to a seen one is answered from the cache
    select('customers');
    await waitFor(() => expect(hits()).toHaveLength(2), SLOW);
    await screen.findByRole('complementary', { name: 'Details of dbo.customers' });
    await screen.findByRole('region', { name: 'Uses' }, SLOW);
    select('orders');
    expect(screen.getByRole('region', { name: 'Uses' })).toBeInTheDocument(); // no skeleton, no wait
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(hits()).toHaveLength(2);
  });

  it('closes with the button and with Esc, re-opens with the toolbar toggle; open / closed and width persist in the tab', async () => {
    const id = openList('table');
    render(<Host id={id} />);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(6), SLOW);
    select('orders');
    await screen.findByRole('complementary', { name: /Details of/ }, SLOW);

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(stateOf(id).details).toMatchObject({ open: false });
    const toggle = screen.getByRole('button', { name: 'Details' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    const panel = await screen.findByRole('complementary', { name: 'Details of dbo.orders' }, SLOW);
    expect(stateOf(id).details).toMatchObject({ open: true });
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-pressed', 'true');

    // Esc inside the panel closes it
    fireEvent.keyDown(within(panel).getByRole('button', { name: /Open/ }), { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();

    // the palette command toggles it too
    act(() => useTabs.getState().activate(id));
    act(() => { runCommand('objects.toggleDetails'); });
    await screen.findByRole('complementary', { name: /Details of/ }, SLOW);

    // width: the separator resizes with the keyboard, persisted and clamped
    const sep = screen.getByRole('separator', { name: 'Resize details panel' });
    expect(sep).toHaveAttribute('aria-valuenow', '340');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(stateOf(id).details).toMatchObject({ width: 356 });
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(stateOf(id).details).toMatchObject({ width: DETAILS_MIN_W });
    expect(screen.getByRole('separator', { name: 'Resize details panel' })).toHaveAttribute('aria-valuenow', String(DETAILS_MIN_W));
  });

  it('starts closed when the tab says so, and a narrow tab hides the panel but the toggle floats it over the list', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
    const id = openList('table', { details: { open: true, width: 340 } });
    render(<Host id={id} />);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(6), SLOW);
    select('orders');
    expect(screen.queryByRole('complementary')).toBeNull(); // persisted open, but the tab is narrow
    expect(screen.queryByRole('separator', { name: 'Resize details panel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    await screen.findByRole('complementary', { name: 'Details of dbo.orders' }, SLOW);
    expect(document.querySelector('.ol-details-slot.floating')).not.toBeNull();
    expect(stateOf(id).details).toEqual({ open: true, width: 340 }); // the choice is untouched
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(stateOf(id).details).toEqual({ open: true, width: 340 });
  });

  it('works in the cards and small-icons layouts', async () => {
    for (const layout of ['grid', 'compact'] as const) {
      const id = openList('table', { layout });
      const view = render(<Host id={id} />);
      await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(5), SLOW);
      fireEvent.mouseDown(screen.getAllByRole('option').find((o) => o.textContent?.includes('customers'))!);
      await screen.findByRole('complementary', { name: 'Details of dbo.customers' }, SLOW);
      view.unmount();
      useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
    }
  });

  it('a dependency in the scope is selected in the list (type group and filter adjusted); one outside the scope is opened', async () => {
    mock.server.use(http.get('*/api/v1/connections/:id/catalog/dependencies', () => HttpResponse.json({
      root: { database: null, schema: 'dbo', name: 'MonthlyReport', type: 'proc' },
      uses: [dep('uses', 'dbo', 'orders', 'table'), dep('uses', 'archive', 'old_orders', 'table')],
      usedBy: [],
    } satisfies DependencyGraph)));
    const id = openList('proc');
    render(<Host id={id} />);
    // GetCustomer, GetActiveSessionByUniqueId (Execute routine fixture), MonthlyReport
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3), SLOW);
    select('MonthlyReport');
    const uses = await screen.findByRole('region', { name: 'Uses' }, SLOW);

    fireEvent.click(within(uses).getByText('orders').closest('button')!);
    await waitFor(() => expect(stateOf(id).group).toBe('table'), SLOW);
    await waitFor(() => expect(screen.getByRole('option', { selected: true }).querySelector('.ol-name-text')?.textContent).toBe('orders'), SLOW);
    expect(await screen.findByRole('complementary', { name: 'Details of dbo.orders' }, SLOW)).toBeInTheDocument();
    expect(useTabs.getState().tabs.some((t) => t.kind === 'view' && t.view === 'data')).toBe(false); // selected, not opened

    // another schema: not in this list, so it opens like the explorer does (a table opens its data)
    select('orders');
    mock.server.use(http.get('*/api/v1/connections/:id/catalog/dependencies', () => HttpResponse.json({
      root: { database: null, schema: 'dbo', name: 'orders', type: 'table' },
      uses: [dep('uses', 'archive', 'old_orders', 'table')], usedBy: [],
    } satisfies DependencyGraph)));
    forgetDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Reload dependencies' }, SLOW));
    const again = await screen.findByRole('region', { name: 'Uses' }, SLOW);
    await within(again).findByText('old_orders', {}, SLOW);
    fireEvent.click(within(again).getByText('old_orders').closest('button')!);
    const data = useTabs.getState().tabs.find((t) => t.kind === 'view' && t.view === 'data');
    expect(data && data.kind === 'view' && data.state).toMatchObject({ schema: 'archive', name: 'old_orders' });
    expect(useTabs.getState().tabs.some((t) => t.kind === 'view' && t.view === OBJECTS_VIEW)).toBe(true);
  });

  it('empty and error states (with Try again)', async () => {
    mock.server.use(http.get('*/api/v1/connections/:id/catalog/dependencies', () => HttpResponse.json({
      root: { database: null, schema: 'dbo', name: 'MonthlyReport', type: 'proc' }, uses: [], usedBy: [],
    } satisfies DependencyGraph)));
    const id = openList('proc');
    render(<Host id={id} />);
    // GetCustomer, GetActiveSessionByUniqueId (Execute routine fixture), MonthlyReport
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3), SLOW);
    select('MonthlyReport');
    expect(await screen.findByText('No dependencies found', {}, SLOW)).toBeInTheDocument();

    let fail = true;
    mock.server.use(http.get('*/api/v1/connections/:id/catalog/dependencies', () => (fail
      ? HttpResponse.json({ error: { code: 'INTERNAL', message: 'catalog is busy' } }, { status: 500 })
      : HttpResponse.json({ root: { database: null, schema: 'dbo', name: 'GetCustomer', type: 'proc' }, uses: [dep('uses', 'dbo', 'customers', 'table')], usedBy: [] } satisfies DependencyGraph))));
    select('GetCustomer');
    expect(await screen.findByText('Could not read the dependencies', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('catalog is busy')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Uses' }, SLOW)).toBeInTheDocument();
  });
});
