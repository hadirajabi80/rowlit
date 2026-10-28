// Data compare tab against a mocked engine: pickers (source pre-filled, target table suggested), the column preview and
// key choice, the compare job with progress, summary cards and the classified grid, paging, and the sync dialog
// (direction, classes, script, apply with confirmation).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataComparePreview, DataCompareResult, DataSyncScript } from '../../../api/types.dataCompare';
import { dbKey, useCatalog } from '../../../store/catalog';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { DataCompareView } from '../DataCompareView';
import { openDataCompare, side } from '../open';

const h = vi.hoisted(() => ({
  api: { preview: vi.fn(), start: vi.fn(), rows: vi.fn(), script: vi.fn(), apply: vi.fn(), discard: vi.fn(), cancel: vi.fn() },
  wait: vi.fn(),
  newConsole: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock('../api', () => ({ dataCompareApi: h.api }));
vi.mock('../jobs', async (orig) => ({ ...(await orig<typeof import('../jobs')>()), listenForJobs: vi.fn(), waitForJob: h.wait }));
vi.mock('../../../app/actions', () => ({ newConsole: h.newConsole, copyText: h.copyText }));

const conn = (id: string, name: string, providerId: string, readOnly = false) =>
  ({ id, name, providerId, color: null, folder: null, readOnly, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null }) as never;

const sync = { toTarget: true, toSource: true, toTargetReason: null, toSourceReason: null, applyToTarget: true, applyToSource: true };

const PREVIEW: DataComparePreview = {
  columns: [
    { name: 'id', sourceName: 'id', targetName: 'id', sourceType: 'integer', targetType: 'integer', sourceKey: true, targetKey: true, kind: 'numeric', comparable: true, note: null },
    { name: 'name', sourceName: 'name', targetName: 'name', sourceType: 'text', targetType: 'text', sourceKey: false, targetKey: false, kind: 'text', comparable: true, note: null },
    { name: 'total', sourceName: 'total', targetName: 'total', sourceType: 'numeric(10,2)', targetType: 'numeric(10,2)', sourceKey: false, targetKey: false, kind: 'numeric', comparable: true, note: null },
  ],
  keyColumns: ['id'], sourceDialect: 'pgsql', targetDialect: 'pgsql', sourceLabel: 'Shop › shop › public › orders', targetLabel: 'Staging › shop › public › orders',
  sync, notes: [],
};

const RESULT: DataCompareResult = {
  compareId: 'dcmp_1', counts: { equal: 90, changed: 2, onlyInSource: 1, onlyInTarget: 1, duplicate: 0 },
  columns: [
    { name: 'id', sourceType: 'integer', targetType: 'integer', isKey: true, compared: false, kind: 'numeric' },
    { name: 'name', sourceType: 'text', targetType: 'text', isKey: false, compared: true, kind: 'text' },
    { name: 'total', sourceType: 'numeric(10,2)', targetType: 'numeric(10,2)', isKey: false, compared: true, kind: 'numeric' },
  ],
  keyColumns: ['id'],
  sample: [
    { class: 'changed', source: [1, 'Ann', '10.00'], target: [1, 'Anne', '10.00'], changed: [1] },
    { class: 'onlyInSource', source: [2, 'Bob', '5.50'], target: null, changed: null },
    { class: 'changed', source: [3, 'Cy', '1.00'], target: [3, 'Cy', '2.00'], changed: [2] },
    { class: 'onlyInTarget', source: null, target: [4, 'Dee', null], changed: null },
  ],
  keptDifferences: 4, truncatedDiffs: false, ordering: 'server', sourceRows: 93, targetRows: 93,
  sourceLabel: 'Shop › shop › public › orders', targetLabel: 'Staging › shop › public › orders', sourceDialect: 'pgsql', targetDialect: 'pgsql',
  sync, notes: [], elapsedMs: 12,
};

const SCRIPT: DataSyncScript = {
  text: '-- Rowlit data synchronization\nDELETE FROM "public"."orders" WHERE "id" IN (4);\n', statements: 4, inserts: 1, updates: 2, deletes: 1,
  warnings: [], direction: 'toTarget', connectionId: 'pg2', database: 'shop', dialect: 'pgsql', truncated: false,
};

function Host({ id }: { id: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <DataCompareView tab={tab} theme="light" visible /> : null;
}

function setup(opts: { readOnlyTarget?: boolean; preview?: DataComparePreview } = {}) {
  useConnections.setState({
    loaded: true, providers: [],
    connections: [conn('pg1', 'Shop', 'postgresql'), conn('pg2', 'Staging', 'postgresql', !!opts.readOnlyTarget)],
  });
  const schemasResp = { database: 'shop', defaultSchema: 'public', schemas: [{ name: 'public', loaded: true }] };
  const loaded = { public: { name: 'public', version: 1, objects: [{ t: 'table', n: 'orders' }, { t: 'table', n: 'customers' }, { t: 'view', n: 'v_open' }] } };
  useCatalog.setState({
    conns: {
      pg1: { databases: { databases: ['shop'], current: 'shop' }, status: 'ready', error: null },
      pg2: { databases: { databases: ['shop'], current: 'shop' }, status: 'ready', error: null },
    },
    dbs: {
      [dbKey('pg1', 'shop')]: { schemasResp, defaultSchema: 'public', loaded } as never,
      [dbKey('pg2', 'shop')]: { schemasResp, defaultSchema: 'public', loaded } as never,
    },
    loadDatabases: vi.fn(async () => null),
    loadSchemas: vi.fn(async () => null),
    loadSchema: vi.fn(async () => {}),
  } as never);
  h.api.preview.mockResolvedValue(opts.preview ?? PREVIEW);
  const id = openDataCompare(side({ connectionId: 'pg1', database: 'shop', schema: 'public', table: 'orders' }));
  return render(<Host id={id} />);
}

const pickTarget = () => fireEvent.change(screen.getByLabelText('Target connection'), { target: { value: 'pg2' } });

async function runCompare() {
  let progress: ((ev: { message: string | null }) => void) | null = null;
  let finish: ((v: unknown) => void) | null = null;
  h.api.start.mockResolvedValue({ jobId: 'j1' });
  h.wait.mockImplementationOnce((_id: string, onProgress: (ev: { message: string | null }) => void) => {
    progress = onProgress;
    return new Promise((r) => { finish = r; });
  });
  const button = await screen.findByRole('button', { name: /^Compare$/ });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(h.wait).toHaveBeenCalled());
  act(() => progress!({ message: JSON.stringify({ phase: 'comparing', sourceRows: 1200, targetRows: 1100, differences: 3, message: null }) }));
  expect(screen.getByRole('status')).toHaveTextContent('source 1,200 rows · target 1,100 rows · 3 differences');
  await act(async () => finish!({ status: 'ok', error: null, result: RESULT }));
  await screen.findByRole('table', { name: 'Differences' });
}

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockReset());
  h.wait.mockReset();
  h.newConsole.mockReset();
  h.copyText.mockReset();
  h.api.discard.mockResolvedValue(undefined);
  useTabs.setState({ tabs: [], activeId: null } as never);
});
afterEach(() => vi.clearAllMocks());

describe('DataCompareView', () => {
  it('pre-fills the source, suggests the same table on the target and previews the columns', async () => {
    setup();
    expect(screen.getByLabelText('Source connection')).toHaveValue('pg1');
    expect(screen.getByLabelText('Source table')).toHaveValue('orders');
    expect(screen.getByText('Choose the target connection.')).toBeInTheDocument();
    pickTarget();
    await waitFor(() => expect(screen.getByLabelText('Target table')).toHaveValue('orders'));
    await waitFor(() => expect(h.api.preview).toHaveBeenCalled());
    expect(h.api.preview.mock.calls[0][0]).toEqual({
      source: { connectionId: 'pg1', database: 'shop', schema: 'public', table: 'orders' },
      target: { connectionId: 'pg2', database: 'shop', schema: 'public', table: 'orders' },
    });
    expect(await screen.findByRole('button', { name: /Columns \(key: id\)/ })).toBeEnabled();
  });

  it('asks for a key when neither table has a primary key, and sends the chosen one', async () => {
    setup({ preview: { ...PREVIEW, keyColumns: [] } });
    pickTarget();
    await screen.findByText(/choose the key columns/);
    expect(screen.getByRole('button', { name: /^Compare$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Columns/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Key and compared columns' })).getByLabelText('Key name'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Key and compared columns' })).getByLabelText('Compare total'));
    await runCompare();
    expect(h.api.start.mock.calls[0][0].options).toEqual({ keyColumns: ['name'], ignoreColumns: ['total'] });
  });

  it('runs the compare job and shows the summary and the classified differences', async () => {
    setup();
    pickTarget();
    await runCompare();
    const cards = screen.getByRole('group', { name: 'Summary' });
    expect(cards).toHaveTextContent('90Equal');
    expect(within(cards).getByRole('button', { name: /2\s*Changed/ })).toBeInTheDocument();
    const grid = screen.getByRole('table', { name: 'Differences' });
    const rows = within(grid).getAllByRole('row');
    expect(rows).toHaveLength(5);
    // changed cell: target value struck, source value below
    expect(within(rows[1]).getByLabelText('target Anne')).toHaveClass('dc-old');
    expect(within(rows[1]).getByLabelText('source Ann')).toHaveClass('dc-new');
    expect(rows[2]).toHaveClass('dc-row-onlyInSource');
    expect(rows[4]).toHaveTextContent('NULL');
    expect(useTabs.getState().tabs[0].title).toBe('Compare data: orders → orders');

    // a card filters the grid
    fireEvent.click(within(cards).getByRole('button', { name: /Only in target/ }));
    expect(within(screen.getByRole('table', { name: 'Differences' })).getAllByRole('row')).toHaveLength(2);
    expect(h.api.rows).not.toHaveBeenCalled();
  });

  it('loads more rows of a class from the engine', async () => {
    setup();
    pickTarget();
    const big: DataCompareResult = { ...RESULT, counts: { ...RESULT.counts, changed: 3 }, keptDifferences: 5 };
    h.api.start.mockResolvedValue({ jobId: 'j1' });
    h.wait.mockResolvedValueOnce({ status: 'ok', error: null, result: big });
    const button = await screen.findByRole('button', { name: /^Compare$/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByRole('table', { name: 'Differences' });
    fireEvent.click(screen.getByRole('button', { name: /3\s*Changed/ }));
    expect(screen.getByText('2 of 3 shown (changed)')).toBeInTheDocument();
    h.api.rows.mockResolvedValue({ class: 'changed', offset: 2, total: 3, rows: [{ class: 'changed', source: [9, 'Zed', '1'], target: [9, 'Zee', '1'], changed: [1] }] });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('3 of 3 shown (changed)');
    expect(h.api.rows).toHaveBeenCalledWith('dcmp_1', 'changed', 2, 200);
  });

  it('scripts the sync, opens it in a console and applies it after confirmation', async () => {
    setup();
    pickTarget();
    await runCompare();
    fireEvent.click(screen.getByRole('button', { name: 'Synchronize…' }));
    const dialog = screen.getByRole('dialog', { name: 'Synchronize data' });
    expect(within(dialog).getByLabelText(/Insert 1 row missing from the target/)).toBeChecked();
    fireEvent.click(within(dialog).getByLabelText(/Delete 1 row only in the target/));
    h.api.script.mockResolvedValue({ ...SCRIPT, deletes: 0 });
    fireEvent.click(within(dialog).getByRole('button', { name: /Generate script/ }));
    await within(dialog).findByLabelText('Sync script');
    expect(h.api.script).toHaveBeenCalledWith('dcmp_1', { direction: 'toTarget', classes: ['onlyInSource', 'changed'] });

    fireEvent.click(within(dialog).getByRole('button', { name: /Open in console/ }));
    expect(h.newConsole).toHaveBeenCalledWith('pg2', 'shop', SCRIPT.text);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply…' }));
    expect(within(dialog).getByText(/This changes/)).toHaveTextContent('Staging › shop › public › orders');
    h.api.apply.mockResolvedValue({ jobId: 'j2' });
    h.wait.mockResolvedValueOnce({
      status: 'ok', error: null,
      result: { status: 'ok', executed: 3, total: 3, inserted: 1, updated: 2, deleted: 0, rolledBack: false, failures: [], elapsedMs: 5 },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply to the target' }));
    await within(dialog).findByText(/Synchronized: 1 inserted, 2 updated, 0 deleted/);
    expect(h.api.apply).toHaveBeenCalledWith('dcmp_1', { direction: 'toTarget', classes: ['onlyInSource', 'changed'], transactional: true });
    expect(within(dialog).getByRole('button', { name: 'Compare again' })).toBeInTheDocument();
  });

  it('keeps a read-only side scriptable but not applicable', async () => {
    setup();
    pickTarget();
    const ro: DataCompareResult = { ...RESULT, sync: { ...sync, applyToTarget: false, toSource: false, toSourceReason: 'The source is a query: only tables can be synchronized.' } };
    h.api.start.mockResolvedValue({ jobId: 'j1' });
    h.wait.mockResolvedValueOnce({ status: 'ok', error: null, result: ro });
    const button = await screen.findByRole('button', { name: /^Compare$/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByRole('table', { name: 'Differences' });
    fireEvent.click(screen.getByRole('button', { name: 'Synchronize…' }));
    const dialog = screen.getByRole('dialog', { name: 'Synchronize data' });
    expect(within(dialog).getByLabelText(/Make the source like the target/)).toBeDisabled();
    h.api.script.mockResolvedValue(SCRIPT);
    fireEvent.click(within(dialog).getByRole('button', { name: /Generate script/ }));
    await within(dialog).findByLabelText('Sync script');
    expect(within(dialog).getByRole('button', { name: 'Apply…' })).toBeDisabled();
  });

  it('reports a failed comparison', async () => {
    setup();
    pickTarget();
    h.api.start.mockResolvedValue({ jobId: 'j1' });
    h.wait.mockResolvedValueOnce({ status: 'error', error: 'Reading the target failed: permission denied', result: null });
    const button = await screen.findByRole('button', { name: /^Compare$/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
  });
});
