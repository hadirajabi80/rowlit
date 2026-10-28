// Data Transfer wizard against a mocked engine API: step gating, the plan request carrying the mapping overrides, the
// SQL file target, the run with progress events and the result.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransferPlan, TransferResult, TransferSpec, TransferSupport } from '../../../api/types.transfer';
import { setPlatform } from '../../../platform';
import { createBrowserPlatform } from '../../../platform/browser';
import { dbKey, useCatalog } from '../../../store/catalog';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { useUi } from '../../../store/ui';
import type { TransferJobEnd } from '../jobs';
import { openTransfer } from '../open';
import { TransferView } from '../TransferView';

const h = vi.hoisted(() => ({
  api: { plan: vi.fn(), run: vi.fn(), types: vi.fn(), support: vi.fn(), dumpDialects: vi.fn(), cancel: vi.fn() },
  wait: vi.fn(),
}));
vi.mock('../api', () => ({ transferApi: h.api }));
vi.mock('../jobs', () => ({ listenForJobs: vi.fn(), waitForTransferJob: h.wait }));

const conn = (id: string, name: string, providerId: string) =>
  ({ id, name, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null }) as never;

const support = (id: string, providerId: string, asTarget = true, reason: string | null = null): TransferSupport =>
  ({ connectionId: id, providerId, dialect: null, asSource: true, asTarget, reason });

function planOf(spec: TransferSpec): TransferPlan {
  return {
    sourceProvider: 'postgresql', targetProvider: 'sqlserver', targetDialect: 'tsql', warnings: [], schemaStatements: [],
    tables: spec.tables.map((t) => ({
      sourceSchema: 'public', sourceName: t.name, sourceType: 'table', targetSchema: 'dbo', targetName: t.targetName ?? t.name, existsInTarget: false,
      rowEstimate: null, where: t.where ?? null, error: null, warnings: t.name === 'orders' ? ['Column total: precision reduced.'] : [],
      createStatements: [`CREATE TABLE [dbo].[${t.targetName ?? t.name}] ([id] int)`], postStatements: [],
      columns: [
        { name: 'id', targetName: 'id', sourceType: 'integer', targetType: 'int', defaultTargetType: 'int', nullable: false, isPrimaryKey: true, isIdentity: true, isComputed: false, overridden: false, excluded: false, note: null },
        {
          name: 'note', targetName: 'note', sourceType: 'text', targetType: t.columnTypes?.note ?? 'nvarchar(max)', defaultTargetType: 'nvarchar(max)', nullable: true,
          isPrimaryKey: false, isIdentity: false, isComputed: false, overridden: !!t.columnTypes?.note, excluded: !!t.excludedColumns?.includes('note'), note: null,
        },
      ],
    })),
  };
}

const result: TransferResult = {
  status: 'ok', totalRows: 12, elapsedMs: 1500, errors: [], filePath: null, fileBytes: null,
  tables: [{ name: 'orders', targetName: 'orders', status: 'ok', rows: 12, errorRows: 0, elapsedMs: 900, error: null, created: true }],
};

function Host({ id }: { id: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <TransferView tab={tab} theme="light" visible /> : null;
}

function open(opts: { dump?: boolean; tables?: string[] } = {}) {
  const id = openTransfer({
    connectionId: 'pg', database: 'shop', schema: 'public', tables: (opts.tables ?? []).map((name) => ({ name, type: 'table' as const })), dump: opts.dump,
  });
  return render(<Host id={id} />);
}

const nextBtn = () => screen.getByRole('button', { name: /^Next/ });
const next = () => fireEvent.click(nextBtn());

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useUi.setState({ toasts: [], confirm: null });
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useConnections.setState({ loaded: true, providers: [], connections: [conn('pg', 'Shop PG', 'postgresql'), conn('ms', 'Warehouse', 'sqlserver'), conn('sf', 'Lake', 'snowflake')] });
  h.api.support.mockImplementation(async (id: string) =>
    id === 'sf' ? support('sf', 'snowflake', false, 'Snowflake can be a source only: rows cannot be written into it.') : support(id, id === 'pg' ? 'postgresql' : 'sqlserver'));
  h.api.plan.mockImplementation(async (spec: TransferSpec) => planOf(spec));
  h.api.types.mockResolvedValue({ provider: 'sqlserver', dialect: 'tsql', types: [{ name: 'nvarchar', params: 'length', default: 'nvarchar(100)', category: 'string' }] });
  h.api.dumpDialects.mockResolvedValue([{ provider: 'postgresql', name: 'PostgreSQL', dialect: 'pgsql' }, { provider: 'mysql', name: 'MySQL', dialect: 'mysql' }]);
  h.api.run.mockResolvedValue({ jobId: 'job-1' });
  const db = (cid: string, database: string, schema: string, objects: { t: string; n: string }[]) => ({
    connectionId: cid, database, schemasStatus: 'ready', schemasError: null, schemaStatus: {}, schemaError: {}, etags: {}, dialect: 'pgsql',
    defaultSchema: schema, databasesList: [database], snapshot: null,
    schemasResp: { database, defaultSchema: schema, schemas: [{ name: schema, loaded: true }] },
    loaded: { [schema]: { name: schema, version: 1, objects } },
  });
  useCatalog.setState({
    loadSchemas: vi.fn(async () => null), loadSchema: vi.fn(async () => {}), revalidate: vi.fn(async () => {}), loadDatabases: vi.fn(async () => null),
    conns: {
      pg: { databases: { databases: ['shop'], current: 'shop' }, status: 'ready', error: null },
      ms: { databases: { databases: ['dw'], current: 'dw' }, status: 'ready', error: null },
    },
    dbs: {
      [dbKey('pg', 'shop')]: db('pg', 'shop', 'public', [{ t: 'table', n: 'orders' }, { t: 'table', n: 'customers' }, { t: 'view', n: 'v_open' }]),
      [dbKey('ms', 'dw')]: db('ms', 'dw', 'dbo', [{ t: 'table', n: 'facts' }]),
    },
  } as never);
});

afterEach(() => setPlatform(null));

async function toTarget(tables = ['orders']) {
  open({ tables });
  await screen.findByRole('heading', { name: 'Choose what to copy' });
  await waitFor(() => expect(nextBtn()).toBeEnabled());
  next();
  await screen.findByRole('heading', { name: 'Choose where to copy' });
}

async function toMapping() {
  await toTarget();
  fireEvent.change(screen.getByLabelText('Target connection'), { target: { value: 'ms' } });
  await waitFor(() => expect(nextBtn()).toBeEnabled());
  next();
  await screen.findByRole('heading', { name: 'Check the mapping' });
  await waitFor(() => expect(h.api.plan).toHaveBeenCalled());
}

describe('TransferView', () => {
  it('needs a ticked table, lists views on request and filters', async () => {
    open();
    await screen.findByRole('heading', { name: 'Choose what to copy' });
    const list = screen.getByRole('list', { name: 'Source tables' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(2);
    expect(nextBtn()).toBeDisabled();
    expect(screen.getByText('Tick at least one table.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Include views'));
    expect(within(list).getAllByRole('checkbox')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Filter tables'), { target: { value: 'cust' } });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('checkbox'));
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('refuses a source-only target with the engine reason', async () => {
    await toTarget();
    fireEvent.change(screen.getByLabelText('Target connection'), { target: { value: 'sf' } });
    expect(await screen.findAllByText(/Snowflake can be a source only/)).not.toHaveLength(0);
    expect(nextBtn()).toBeDisabled();
  });

  it('sends the mapping overrides with the plan and shows the notes', async () => {
    await toMapping();
    expect(h.api.plan.mock.calls[0][0]).toMatchObject({
      source: { connectionId: 'pg', database: 'shop', schema: 'public' }, target: { connectionId: 'ms', schema: null }, tables: [{ name: 'orders', schema: 'public' }],
    });
    fireEvent.click(await screen.findByRole('button', { name: /orders/ }));
    expect(screen.getByText('Column total: precision reduced.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Target type of note'), { target: { value: 'nvarchar(400)' } });
    fireEvent.click(screen.getByLabelText('Copy note'));
    fireEvent.change(screen.getByLabelText('Target name of orders'), { target: { value: 'orders_2026' } });
    await waitFor(() => {
      const last = h.api.plan.mock.calls.at(-1)![0] as TransferSpec;
      expect(last.tables[0]).toEqual({ name: 'orders', schema: 'public', targetName: 'orders_2026', columnTypes: { note: 'nvarchar(400)' }, excludedColumns: ['note'] });
    });
    // a filter with a statement separator blocks Next
    fireEvent.change(screen.getByLabelText('Filter of orders'), { target: { value: '1=1; drop table x' } });
    await waitFor(() => expect(nextBtn()).toBeDisabled());
    fireEvent.change(screen.getByLabelText('Filter of orders'), { target: { value: "status = 'open'" } });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
  });

  it('runs, shows per-table progress and the result', async () => {
    let report: ((p: unknown, ev: { done: number; total: number | null }) => void) | null = null;
    let finish: ((end: TransferJobEnd) => void) | null = null;
    h.wait.mockImplementation((_id: string, onProgress: typeof report) => {
      report = onProgress;
      return new Promise<TransferJobEnd>((r) => {
        finish = r;
      });
    });
    await toMapping();
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: 'Transfer options' });
    fireEvent.click(screen.getByLabelText(/Insert or update/));
    next();
    await screen.findByRole('heading', { name: 'Review and transfer' });
    const start = screen.getByRole('button', { name: /Start transfer/ });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(h.api.run).toHaveBeenCalled());
    expect((h.api.run.mock.calls[0][0] as TransferSpec).options?.dataMode).toBe('upsert');
    await waitFor(() => expect(report).not.toBeNull());
    act(() => report!({ phase: 'data', table: 'orders', tableIndex: 1, tableCount: 1, tableDone: 6, tableTotal: 12, rowsPerSecond: 60, message: null }, { done: 6, total: 12 }));
    expect(screen.getByRole('progressbar', { name: 'Transfer progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(screen.getByRole('list', { name: 'Tables' })).getByText('6 of 12 rows')).toBeInTheDocument();
    await act(async () => finish!({ status: 'ok', error: null, result }));
    expect(await screen.findByRole('heading', { name: 'Transfer complete' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Tables transferred' })).toHaveTextContent('orders (created)');
    expect(useCatalog.getState().revalidate).toHaveBeenCalledWith('ms', 'dw', ['dbo']);
    // remembered as a recent transfer
    expect(JSON.parse(window.localStorage.getItem('rowlit.transfer.recent') ?? '[]')).toHaveLength(1);
  });

  it('writes a SQL file: dialect list, Browse… and the quoted path', async () => {
    const platform = { ...createBrowserPlatform(), hasFileSystem: true, showSaveDialog: vi.fn(async (_o: { filters?: unknown }) => 'D:\\backups\\shop.sql') };
    setPlatform(platform);
    open({ dump: true, tables: ['orders'] });
    await screen.findByRole('heading', { name: 'Choose what to copy' });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: 'Choose where to copy' });
    // the source's own dialect is preselected
    await waitFor(() => expect(screen.getByLabelText('Script dialect')).toHaveValue('postgresql'));
    expect(nextBtn()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
    await waitFor(() => expect(screen.getByLabelText('Script file path')).toHaveValue('D:\\backups\\shop.sql'));
    expect(platform.showSaveDialog.mock.calls[0][0]).toMatchObject({ filters: [{ name: 'SQL script', extensions: ['sql'] }] });
    fireEvent.change(screen.getByLabelText('Script file path'), { target: { value: '"C:\\dumps\\a b.sql"' } });
    fireEvent.change(screen.getByLabelText('Script dialect'), { target: { value: 'mysql' } });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await waitFor(() => expect(h.api.plan).toHaveBeenCalled());
    expect((h.api.plan.mock.calls.at(-1)![0] as TransferSpec).target).toEqual({ filePath: 'C:\\dumps\\a b.sql', dumpProvider: 'mysql' });
  });
});
