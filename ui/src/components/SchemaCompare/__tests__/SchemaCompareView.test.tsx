// Schema compare tab against a mocked engine: pickers and validation, the compare job with progress, the grouped list
// with filters and selection, the detail tabs, script generation with warnings, and the apply dialog's data-loss gate.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompareResult, CompareScript, CompareSupport } from '../../../api/types.schemaCompare';
import { dbKey, useCatalog } from '../../../store/catalog';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import type { CompareProgress } from '../jobs';
import { openSchemaCompare } from '../open';
import { SchemaCompareView } from '../SchemaCompareView';

const h = vi.hoisted(() => ({
  api: { start: vi.fn(), support: vi.fn(), item: vi.fn(), script: vi.fn(), apply: vi.fn(), discard: vi.fn(), cancel: vi.fn() },
  wait: vi.fn(),
  newConsole: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock('../api', () => ({ schemaCompareApi: h.api }));
vi.mock('../jobs', () => ({ listenForJobs: vi.fn(), waitForCompareJob: h.wait }));
vi.mock('../ItemDiff', () => ({
  ItemDiff: (p: { targetDdl: string | null; sourceDdl: string | null }) => (
    <div data-testid="item-diff">{`${p.targetDdl ?? '(none)'} => ${p.sourceDdl ?? '(none)'}`}</div>
  ),
}));
vi.mock('../../../app/actions', () => ({ newConsole: h.newConsole, copyText: h.copyText }));

const conn = (id: string, name: string, providerId: string, readOnly = false) =>
  ({ id, name, providerId, color: null, folder: null, readOnly, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null }) as never;

const support = (providerId: string, extra: Partial<CompareSupport> = {}): CompareSupport =>
  ({ supported: true, providerId, dialect: 'pgsql', schemaIsDatabase: false, readOnly: false, reason: null, ...extra });

const RESULT: CompareResult = {
  compareId: 'cmp_1', providerId: 'postgresql', dialect: 'pgsql', sourceLabel: 'Shop › shop › public', targetLabel: 'Staging › shop › public',
  sourceSchema: 'public', targetSchema: 'public', transactionalDdl: true, elapsedMs: 42, notes: ['Not compared in public: materialized views.'],
  counts: { create: 1, drop: 1, alter: 1, identical: 1 },
  items: [
    { id: 'table:orders', kind: 'table', name: 'orders', status: 'alter', changes: ['Column total: type numeric(10,2) → numeric(12,2)'], warnings: [] },
    { id: 'table:audit', kind: 'table', name: 'audit', status: 'drop', changes: ['Table only exists in the target'], warnings: [{ severity: 'dataLoss', message: 'Dropping table audit deletes all of its rows.' }] },
    { id: 'table:customers', kind: 'table', name: 'customers', status: 'identical', changes: [], warnings: [] },
    { id: 'view:v_new', kind: 'view', name: 'v_new', status: 'create', changes: ['View only exists in the source'], warnings: [] },
  ],
};

const SCRIPT: CompareScript = {
  itemCount: 3, transactionalDdl: true,
  statements: [
    { sql: 'ALTER TABLE "public"."orders" ALTER COLUMN "total" TYPE numeric(12,2)', kind: 'alter', itemId: 'table:orders', warning: null },
    { sql: 'DROP TABLE "public"."audit"', kind: 'drop', itemId: 'table:audit', warning: 'Dropping table audit deletes all of its rows.' },
    { sql: 'CREATE VIEW "public"."v_new" AS SELECT 1', kind: 'create', itemId: 'view:v_new', warning: null },
  ],
  text: '-- Rowlit schema synchronization\nALTER TABLE "public"."orders" ALTER COLUMN "total" TYPE numeric(12,2);\n',
  warnings: [
    { itemId: 'table:audit', severity: 'dataLoss', message: 'Dropping table audit deletes all of its rows.' },
    { itemId: 'table:orders', severity: 'info', message: 'Foreign key fk_x is dropped and created again.' },
  ],
};

function Host({ id }: { id: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <SchemaCompareView tab={tab} theme="light" visible /> : null;
}

function setup(opts: { readOnlyTarget?: boolean } = {}) {
  useConnections.setState({
    loaded: true, providers: [],
    connections: [conn('pg1', 'Shop', 'postgresql'), conn('pg2', 'Staging', 'postgresql', !!opts.readOnlyTarget), conn('my1', 'Legacy', 'mysql')],
  });
  const schemasResp = { database: 'shop', defaultSchema: 'public', schemas: [{ name: 'public', loaded: true }, { name: 'sales', loaded: true }] };
  useCatalog.setState({
    conns: {
      pg1: { databases: { databases: ['shop'], current: 'shop' }, status: 'ready', error: null },
      pg2: { databases: { databases: ['shop'], current: 'shop' }, status: 'ready', error: null },
    },
    dbs: {
      [dbKey('pg1', 'shop')]: { schemasResp, defaultSchema: 'public', loaded: {} } as never,
      [dbKey('pg2', 'shop')]: { schemasResp, defaultSchema: 'public', loaded: {} } as never,
    },
    loadDatabases: vi.fn(async () => null),
    loadSchemas: vi.fn(async () => null),
  } as never);
  h.api.support.mockImplementation(async (id: string) =>
    id === 'my1' ? support('mysql', { schemaIsDatabase: true }) : support('postgresql', { readOnly: id === 'pg2' && !!opts.readOnlyTarget }));
  const id = openSchemaCompare({ connectionId: 'pg1', database: 'shop', schema: 'public' });
  return render(<Host id={id} />);
}

const pickTarget = () => fireEvent.change(screen.getByLabelText('Target connection'), { target: { value: 'pg2' } });

async function runCompare() {
  let progress: ((p: CompareProgress) => void) | null = null;
  let finish: ((v: unknown) => void) | null = null;
  h.api.start.mockResolvedValue({ jobId: 'j1' });
  h.wait.mockImplementation((_id: string, onProgress: (p: CompareProgress) => void) => {
    progress = onProgress;
    return new Promise((r) => { finish = r; });
  });
  fireEvent.click(screen.getByRole('button', { name: /^Compare$/ }));
  await waitFor(() => expect(h.wait).toHaveBeenCalled());
  act(() => progress!({ done: 3, total: 10, message: 'orders' }));
  expect(screen.getByRole('status')).toHaveTextContent('orders (3 of 10)');
  await act(async () => finish!({ status: 'ok', error: null, result: RESULT }));
  await screen.findByRole('list', { name: 'Compared objects' });
}

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockReset());
  h.wait.mockReset();
  h.newConsole.mockReset();
  h.copyText.mockReset();
  h.api.discard.mockResolvedValue(undefined);
  h.api.item.mockImplementation(async (_c: string, itemId: string) => ({
    item: RESULT.items.find((i) => i.id === itemId), sourceDdl: `CREATE src ${itemId}`, targetDdl: itemId === 'view:v_new' ? null : `CREATE tgt ${itemId}`,
    statements: SCRIPT.statements.filter((s) => s.itemId === itemId),
  }));
  useTabs.setState({ tabs: [], activeId: null } as never);
});
afterEach(() => vi.clearAllMocks());

describe('SchemaCompareView', () => {
  it('pre-fills the source, requires a target of the same kind and greys out other kinds', async () => {
    setup();
    expect(screen.getByLabelText('Source connection')).toHaveValue('pg1');
    expect(screen.getByLabelText('Source schema')).toHaveValue('public');
    const compare = screen.getByRole('button', { name: /^Compare$/ });
    expect(compare).toBeDisabled();
    expect(screen.getByText('Choose the target connection.')).toBeInTheDocument();
    await waitFor(() => expect(h.api.support).toHaveBeenCalledWith('my1'));
    await waitFor(() => expect(within(screen.getByLabelText('Target connection')).getByRole('option', { name: 'Legacy' })).toBeDisabled());
    pickTarget();
    expect(compare).toBeEnabled();
    // same connection and schema on both sides is refused
    fireEvent.change(screen.getByLabelText('Target connection'), { target: { value: 'pg1' } });
    fireEvent.change(screen.getByLabelText('Target schema'), { target: { value: 'public' } });
    expect(screen.getByRole('button', { name: /^Compare$/ })).toBeDisabled();
    expect(screen.getByText(/same schema/)).toBeInTheDocument();
  });

  it('runs the compare job and lists the differences grouped by kind', async () => {
    setup();
    pickTarget();
    await runCompare();
    expect(h.api.start).toHaveBeenCalledWith({
      source: { connectionId: 'pg1', database: 'shop', schema: 'public' },
      target: { connectionId: 'pg2', database: 'shop', schema: 'public' },
    });
    const list = screen.getByRole('list', { name: 'Compared objects' });
    expect(within(list).getByRole('region', { name: 'Tables' })).toBeInTheDocument();
    expect(within(list).getByRole('region', { name: 'Views' })).toBeInTheDocument();
    // identical items are hidden until their chip is on
    expect(within(list).queryByText('customers')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Identical/ }));
    expect(within(list).getByText('customers')).toBeInTheDocument();
    expect(screen.getByLabelText('Include customers')).toBeDisabled();
    // the first differing item is shown in the diff
    expect(await screen.findByTestId('item-diff')).toHaveTextContent('CREATE tgt table:orders => CREATE src table:orders');
    expect(screen.getByRole('button', { name: /Generate script \(3 selected\)/ })).toBeEnabled();
    expect(useTabs.getState().tabs[0].title).toBe('Compare: public → public');
  });

  it('shows the changes and the statements of the focused object', async () => {
    setup();
    pickTarget();
    await runCompare();
    fireEvent.click(screen.getByRole('button', { name: /^audit/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(await screen.findByText('Table only exists in the target')).toBeInTheDocument();
    expect(screen.getByText('Data loss')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Script' }));
    expect(screen.getByText('DROP TABLE "public"."audit"')).toBeInTheDocument();
  });

  it('generates the script of the selected items with its warnings, and Open in console / Copy use its text', async () => {
    setup();
    pickTarget();
    await runCompare();
    fireEvent.click(screen.getByLabelText('Include v_new'));
    h.api.script.mockResolvedValue(SCRIPT);
    fireEvent.click(screen.getByRole('button', { name: /Generate script \(2 selected\)/ }));
    await screen.findByLabelText('Migration script');
    expect(h.api.script).toHaveBeenCalledWith('cmp_1', ['table:orders', 'table:audit']);
    const warnings = screen.getByRole('list', { name: 'Warnings' });
    const first = within(warnings).getAllByRole('listitem')[0];
    expect(first).toHaveClass('sc-sev-dataLoss');
    expect(first).toHaveTextContent('Dropping table audit deletes all of its rows.');
    fireEvent.click(screen.getByRole('button', { name: /Open in console/ }));
    expect(h.newConsole).toHaveBeenCalledWith('pg2', 'shop', SCRIPT.text);
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(h.copyText).toHaveBeenCalledWith(SCRIPT.text, 'Script copied');
  });

  it('apply: data loss must be acknowledged, then the generated items are applied', async () => {
    setup();
    pickTarget();
    await runCompare();
    h.api.script.mockResolvedValue(SCRIPT);
    fireEvent.click(screen.getByRole('button', { name: /Generate script/ }));
    await screen.findByLabelText('Migration script');
    fireEvent.click(screen.getByRole('button', { name: /Apply to target/ }));
    const dialog = screen.getByRole('dialog', { name: 'Apply the script to the target' });
    const apply = within(dialog).getByRole('button', { name: 'Apply 3 statements' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Dropping table audit deletes all of its rows.');
    expect(apply).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('I understand that this data is lost'));
    expect(apply).toBeEnabled();
    h.api.apply.mockResolvedValue({ ok: false, executed: 1, total: 3, rolledBack: true, transactionalDdl: true, elapsedMs: 5,
      failures: [{ index: 1, sql: 'DROP TABLE "public"."audit"', message: 'permission denied', code: '42501', itemId: 'table:audit' }] });
    fireEvent.click(apply);
    expect(await within(dialog).findByText(/the transaction was rolled back/)).toBeInTheDocument();
    expect(h.api.apply).toHaveBeenCalledWith('cmp_1', { itemIds: ['table:orders', 'table:audit', 'view:v_new'], stopOnError: true });
    expect(within(dialog).getByText(/Statement 2 \(audit\): permission denied \[42501\]/)).toBeInTheDocument();
  });

  it('a changed selection or a read-only target blocks Apply', async () => {
    setup({ readOnlyTarget: true });
    await waitFor(() => expect(h.api.support).toHaveBeenCalledWith('pg2'));
    pickTarget();
    await runCompare();
    h.api.script.mockResolvedValue(SCRIPT);
    fireEvent.click(screen.getByRole('button', { name: /Generate script/ }));
    await screen.findByLabelText('Migration script');
    expect(screen.getByRole('button', { name: /Apply to target/ })).toBeDisabled();
    expect(screen.getByText(/target connection is read-only/)).toBeInTheDocument();
  });

  it('a stale script cannot be applied', async () => {
    setup();
    pickTarget();
    await runCompare();
    h.api.script.mockResolvedValue(SCRIPT);
    fireEvent.click(screen.getByRole('button', { name: /Generate script/ }));
    await screen.findByLabelText('Migration script');
    expect(screen.getByRole('button', { name: /Apply to target/ })).toBeEnabled();
    fireEvent.click(screen.getByLabelText('Include orders'));
    fireEvent.click(screen.getByRole('tab', { name: 'Migration script' }));
    expect(screen.getByRole('button', { name: /Apply to target/ })).toBeDisabled();
    expect(screen.getByText(/selection changed/)).toBeInTheDocument();
  });

  it('Mod+Enter compares; a failed job shows its error; options are persisted in the tab', async () => {
    const view = setup();
    pickTarget();
    h.api.start.mockResolvedValue({ jobId: 'j2' });
    h.wait.mockResolvedValue({ status: 'error', error: "Schema 'public' was not found.", result: null });
    fireEvent.keyDown(view.container.querySelector('.sc')!, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent("Schema 'public' was not found.");
    fireEvent.click(screen.getByRole('button', { name: /Options/ }));
    fireEvent.click(screen.getByLabelText('Views'));
    await waitFor(() => expect((useTabs.getState().tabs[0] as ViewTab).state).toMatchObject({ options: { views: false }, target: { connectionId: 'pg2' } }));
    expect(screen.getByRole('button', { name: /Options \(1\)/ })).toBeInTheDocument();
  });
});
