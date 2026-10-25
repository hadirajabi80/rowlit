// Import Wizard steps against a mocked engine API: gating, preview requests, mapping, new-table DDL, modes, run + summary.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommand } from '../../commands/registry';
import { createBrowserPlatform } from '../../platform/browser';
import { setPlatform } from '../../platform';
import { useCatalog, dbKey } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { useTabs, type ViewTab } from '../../store/tabs';
import { ImportWizardView } from './ImportWizardView';
import { openImportWizard } from './open';
import type {
  DdlPreview, ImportCapabilities, ImportProgress, ImportSummary, PreviewResult, TargetTableInfo,
} from './types';
import type { JobEnd } from './jobs';

const h = vi.hoisted(() => ({
  api: {
    preview: vi.fn(), capabilities: vi.fn(), tableInfo: vi.fn(), ddl: vi.fn(), start: vi.fn(), errorReport: vi.fn(), cancel: vi.fn(),
  },
  wait: vi.fn(),
}));
vi.mock('./api', () => ({ importApi: h.api }));
vi.mock('./jobs', () => ({ listenForJobs: vi.fn(), waitForImportJob: h.wait }));

const CSV = 'C:\\data\\people.csv';

const preview: PreviewResult = {
  path: CSV, fileName: 'people.csv', fileSize: 2048,
  options: { format: 'csv', encoding: 'utf-8', delimiter: ',', quote: '"', hasHeader: true },
  columns: [
    { index: 0, name: 'id', inferred: { kind: 'int', nullable: false } },
    { index: 1, name: 'Name', inferred: { kind: 'text', length: 20, nullable: false } },
    { index: 2, name: 'age', inferred: { kind: 'int', nullable: true } },
  ],
  rows: [['1', 'Ann', '30'], ['2', 'علی', null]],
  sampledRows: 2, moreRows: false, warnings: [],
};

const caps: ImportCapabilities = {
  providerId: 'sqlserver', dialect: 'tsql', canImport: true, readOnly: false, modes: ['append', 'truncateInsert', 'upsert', 'updateOnly'],
  canCreateTable: true, transactional: true, bulkMethod: 'SqlBulkCopy', defaultBatchSize: 1000, maxIdentifierLength: 128, sqlTypes: ['int', 'nvarchar(50)'],
};

const tableInfo: TargetTableInfo = {
  exists: true,
  columns: [
    { name: 'id', type: 'int', kind: 'int', nullable: false, isPk: true, isIdentity: false, isComputed: false, hasDefault: false, ordinal: 1 },
    { name: 'name', type: 'nvarchar(50)', kind: 'text', nullable: false, isPk: false, isIdentity: false, isComputed: false, hasDefault: false, ordinal: 2 },
    { name: 'age', type: 'int', kind: 'int', nullable: true, isPk: false, isIdentity: false, isComputed: false, hasDefault: false, ordinal: 3 },
    { name: 'note', type: 'nvarchar(max)', kind: 'text', nullable: false, isPk: false, isIdentity: false, isComputed: false, hasDefault: false, ordinal: 4 },
  ],
  primaryKey: ['id'], uniqueKeys: [['id']],
};

const ddl: DdlPreview = { ddl: 'CREATE TABLE [dbo].[people] ([id] int NOT NULL)', columns: [{ name: 'id', sqlType: 'int' }, { name: 'Name', sqlType: 'nvarchar(32)' }, { name: 'age', sqlType: 'int' }], warnings: [] };

const summary: ImportSummary = {
  outcome: 'completedWithErrors', rowsRead: 100, rowsWritten: 97, rowsSkipped: 3, errorCount: 3, elapsedMs: 2500, rowsPerSecond: 40, committed: true, rolledBack: false,
  createdTable: '[dbo].[people]', ddl: 'CREATE TABLE [dbo].[people] ([id] int)', loadMethod: 'SqlBulkCopy', hasErrorReport: true,
  errorsSample: [{ row: 7, column: 'age', message: 'not a number', values: ['7', 'x', 'abc'] }],
};

function Host({ id }: { id: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <ImportWizardView tab={tab} theme="light" visible /> : null;
}

function open(opts: { table?: string | null; path?: string | null; readOnly?: boolean } = {}) {
  useConnections.setState({
    loaded: true, providers: [],
    connections: [{ id: 'c1', name: 'Shop', providerId: 'sqlserver', color: null, folder: null, readOnly: !!opts.readOnly, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null }],
  });
  const id = openImportWizard({ connectionId: 'c1', database: 'shop', schema: 'dbo', table: opts.table ?? null }, opts.path ?? null);
  return render(<Host id={id} />);
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /^Next/ }));
const nextBtn = () => screen.getByRole('button', { name: /^Next/ });

async function toFormat() {
  fireEvent.change(await screen.findByLabelText('File path'), { target: { value: CSV } });
  await waitFor(() => expect(h.api.preview).toHaveBeenCalled());
  await waitFor(() => expect(nextBtn()).toBeEnabled());
  next();
  await screen.findByRole('heading', { name: /Format options/ });
  await screen.findByRole('table', { name: 'Preview of the file' });
}

async function toTarget() {
  await toFormat();
  await waitFor(() => expect(nextBtn()).toBeEnabled());
  next();
  await screen.findByRole('heading', { name: 'Target table' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  h.api.preview.mockResolvedValue(preview);
  h.api.capabilities.mockResolvedValue(caps);
  h.api.tableInfo.mockResolvedValue(tableInfo);
  h.api.ddl.mockResolvedValue(ddl);
  h.api.cancel.mockResolvedValue(undefined);
  useCatalog.setState({
    loadSchemas: vi.fn(async () => null), loadSchema: vi.fn(async () => {}), revalidate: vi.fn(async () => {}),
    dbs: {
      [dbKey('c1', 'shop')]: {
        connectionId: 'c1', database: 'shop', schemasStatus: 'ready', schemasError: null, schemaStatus: {}, schemaError: {}, etags: {}, dialect: 'tsql',
        defaultSchema: 'dbo', databasesList: ['shop'], snapshot: null,
        schemasResp: { database: 'shop', defaultSchema: 'dbo', schemas: [{ name: 'dbo', loaded: true }, { name: 'sales', loaded: true }] },
        loaded: {
          dbo: { name: 'dbo', version: 1, objects: [{ t: 'table', n: 'people' }, { t: 'table', n: 'orders' }, { t: 'view', n: 'v_people' }] },
          sales: { name: 'sales', version: 1, objects: [{ t: 'table', n: 'leads' }] },
        },
      },
    },
  });
});

afterEach(() => setPlatform(null));

describe('step 1 and 2: source and format', () => {
  it('gates Next on a file, previews it after a debounce and shows inferred types', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Choose the file to import' })).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
    expect(screen.getByRole('button', { name: /Back/ })).toBeDisabled();
    expect(h.api.preview).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('File path'), { target: { value: CSV } });
    expect(nextBtn()).toBeEnabled();
    expect(h.api.preview).not.toHaveBeenCalled(); // debounced
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(1));
    expect(h.api.preview).toHaveBeenCalledWith({ path: CSV, options: { format: 'csv' }, maxRows: 100 });
    await screen.findByText('people.csv');

    next();
    const grid = await screen.findByRole('table', { name: 'Preview of the file' });
    expect(within(grid).getByText('علی')).toBeInTheDocument();
    expect(within(grid).getByText('NULL')).toBeInTheDocument();
    expect(within(grid).getAllByText('int').length).toBeGreaterThan(0);
    expect(within(grid).getByText('text(20)')).toBeInTheDocument();
  });

  it('sends changed options to the engine and ignores untouched ones', async () => {
    open({ path: CSV });
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: /Format options/ });

    fireEvent.change(screen.getByLabelText('Encoding'), { target: { value: 'windows-1256' } });
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(2));
    expect(h.api.preview).toHaveBeenLastCalledWith({ path: CSV, options: { format: 'csv', encoding: 'windows-1256' }, maxRows: 100 });

    fireEvent.change(screen.getByLabelText('Delimiter'), { target: { value: ';' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /First row contains/ }));
    fireEvent.change(screen.getByLabelText('Skip rows'), { target: { value: '2' } });
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(3));
    expect(h.api.preview).toHaveBeenLastCalledWith({
      path: CSV, options: { format: 'csv', encoding: 'windows-1256', delimiter: ';', hasHeader: false, skipRows: 2 }, maxRows: 100,
    });

    // back to auto-detect removes the key again
    fireEvent.change(screen.getByLabelText('Encoding'), { target: { value: 'auto' } });
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(4));
    expect(h.api.preview.mock.calls[3][0].options.encoding).toBeUndefined();
  });

  it('offers sheets for xlsx and a JSON path for json', async () => {
    h.api.preview.mockResolvedValue({ ...preview, path: 'C:\\b.xlsx', options: { format: 'xlsx', hasHeader: true }, sheets: ['Jan', 'Feb'] });
    open({ path: 'C:\\b.xlsx' });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    const sheet = await screen.findByLabelText('Sheet');
    expect(within(sheet).getAllByRole('option').map((o) => o.textContent)).toEqual(['Jan', 'Feb']);
    expect(screen.queryByLabelText('Delimiter')).toBeNull();
    fireEvent.change(sheet, { target: { value: 'Feb' } });
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(2));
    expect(h.api.preview.mock.calls[1][0].options).toEqual({ format: 'xlsx', sheet: 'Feb' });
  });

  it('blocks Next on a preview error and shows it', async () => {
    h.api.preview.mockRejectedValue(new Error('The file is locked'));
    open({ path: CSV });
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is locked');
    expect(nextBtn()).toBeEnabled(); // step 1 only needs a path; the error shows there
    next();
    expect(await screen.findByRole('heading', { name: /Format options/ })).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
  });

  it('steps back through the stepper', async () => {
    open({ path: CSV });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: /Format options/ });
    fireEvent.click(screen.getByRole('button', { name: 'Step 1: Source' }));
    expect(await screen.findByRole('heading', { name: 'Choose the file to import' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 3: Target' })).toBeDisabled();
  });
});

describe('step 3: existing table', () => {
  it('auto-matches columns, flags a required column without a source and unblocks once it has one', async () => {
    open({ table: 'people', path: CSV });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: /Format options/ });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('table', { name: 'Column mapping' });
    expect(h.api.tableInfo).toHaveBeenCalledWith('c1', { database: 'shop', schema: 'dbo', table: 'people' });

    const src = (n: string) => screen.getByLabelText(`Source for ${n}`) as HTMLSelectElement;
    await waitFor(() => expect(src('name').value).toBe('src:1')); // Name -> name by case-insensitive match
    expect(src('id').value).toBe('src:0');
    expect(src('age').value).toBe('src:2');
    expect(src('note').value).toBe('skip');
    expect(screen.getByText(/"note" is required/)).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
    // text -> int is a risky pairing only for the mismatched kinds; int -> int is fine
    expect(screen.queryByRole('img', { name: /age: The values may not fit/ })).toBeNull();

    fireEvent.change(src('note'), { target: { value: 'const' } });
    fireEvent.change(screen.getByLabelText('Constant for note'), { target: { value: 'imported' } });
    await waitFor(() => expect(nextBtn()).toBeEnabled());

    // mapping a text column to an int column warns
    fireEvent.change(src('age'), { target: { value: 'src:1' } });
    expect(await screen.findByRole('img', { name: /age: The values may not fit/ })).toBeInTheDocument();
    // skipping an optional column is allowed
    fireEvent.change(src('age'), { target: { value: 'skip' } });
    expect(nextBtn()).toBeEnabled();
  });

  it('lists the tables of the chosen schema and reloads the table info', async () => {
    open({ table: null, path: CSV });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: /Format options/ });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: 'Target table' });
    fireEvent.click(screen.getByRole('radio', { name: 'Existing table' }));
    const table = screen.getByRole('combobox', { name: 'Target table' });
    expect(within(table).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a table…', 'orders', 'people']);
    expect(nextBtn()).toBeDisabled();
    fireEvent.change(table, { target: { value: 'orders' } });
    await waitFor(() => expect(h.api.tableInfo).toHaveBeenCalledWith('c1', { database: 'shop', schema: 'dbo', table: 'orders' }));
    fireEvent.change(screen.getByLabelText('Schema'), { target: { value: 'sales' } });
    expect(within(screen.getByRole('combobox', { name: 'Target table' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a table…', 'leads']);
  });
});

describe('step 3: new table', () => {
  it('previews the CREATE TABLE statement and sends edited names, types and the key', async () => {
    open({ path: CSV });
    await toTarget();
    expect(screen.getByLabelText('New table name')).toHaveValue('people');
    const code = await screen.findByLabelText('CREATE TABLE preview');
    await waitFor(() => expect(code).toHaveTextContent('CREATE TABLE [dbo].[people]'));
    expect(h.api.ddl).toHaveBeenCalled();
    const first = h.api.ddl.mock.calls[0];
    expect(first[0]).toBe('c1');
    expect(first[1]).toMatchObject({ database: 'shop', schema: 'dbo', table: 'people', primaryKey: [] });
    expect(first[1].columns.map((c: { name: string }) => c.name)).toEqual(['id', 'Name', 'age']);
    expect(first[1].columns[0].sqlType).toBeUndefined(); // default type: the engine decides

    // effective type is shown, editing makes it explicit
    expect(screen.getByLabelText('Type of Name')).toHaveValue('nvarchar(32)');
    fireEvent.change(screen.getByLabelText('Type of Name'), { target: { value: 'nvarchar(100)' } });
    fireEvent.change(screen.getByLabelText('Name of age'), { target: { value: 'age_years' } });
    fireEvent.click(screen.getByLabelText('id is part of the primary key'));
    fireEvent.click(screen.getByLabelText('Include Name'));
    await waitFor(() => {
      const last = h.api.ddl.mock.calls.at(-1)![1];
      expect(last.columns.map((c: { name: string }) => c.name)).toEqual(['id', 'age_years']);
      expect(last.primaryKey).toEqual(['id']);
      expect(last.columns[0].nullable).toBe(false);
    });
    expect(screen.getByLabelText('id can be NULL')).toBeDisabled();
  });

  it('blocks Next for duplicate column names', async () => {
    open({ path: CSV });
    await toTarget();
    fireEvent.change(screen.getByLabelText('Name of age'), { target: { value: 'id' } });
    expect(await screen.findByText(/used twice/)).toBeInTheDocument();
    expect(nextBtn()).toBeDisabled();
  });
});

async function toMode(table: string | null = null) {
  if (table) {
    open({ table, path: CSV });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: /Format options/ });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('table', { name: 'Column mapping' });
    fireEvent.change(await screen.findByLabelText('Source for note'), { target: { value: 'const' } });
    await waitFor(() => expect(nextBtn()).toBeEnabled());
  } else {
    open({ path: CSV });
    await toTarget();
    await waitFor(() => expect(nextBtn()).toBeEnabled());
  }
  next();
  await screen.findByRole('heading', { name: 'Import mode and options' });
}

describe('step 4: mode', () => {
  it('offers only the modes the engine supports', async () => {
    h.api.capabilities.mockResolvedValue({ ...caps, modes: ['append', 'truncateInsert'], transactional: false, bulkMethod: 'Batched INSERT' });
    await toMode('people');
    const modes = within(screen.getByRole('radiogroup', { name: 'Import mode' })).getAllByRole('radio');
    expect(modes).toHaveLength(2);
    expect(screen.getByText('Append')).toBeInTheDocument();
    expect(screen.queryByText('Insert or update by key')).toBeNull();
    expect(screen.getByLabelText('All or nothing')).toBeDisabled();
    expect(screen.getByText(/Batched INSERT/)).toBeInTheDocument();
  });

  it('only appends into a new table', async () => {
    await toMode();
    expect(within(screen.getByRole('radiogroup', { name: 'Import mode' })).getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText(/starts empty/)).toBeInTheDocument();
  });

  it('asks for confirmation before replacing all rows', async () => {
    await toMode('people');
    fireEvent.click(screen.getByRole('radio', { name: /Replace all rows/ }));
    const start = screen.getByRole('button', { name: /Start import/ });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /all existing rows of people will be deleted/ }));
    expect(start).toBeEnabled();
  });

  it('preselects the primary key for upsert, warns about a non-unique key and requires one', async () => {
    await toMode('people');
    fireEvent.click(screen.getByRole('radio', { name: /Insert or update by key/ }));
    const keys = screen.getByRole('group', { name: 'Key columns' });
    expect(within(keys).getByRole('checkbox', { name: /id/ })).toBeChecked();
    expect(screen.getByRole('button', { name: /Start import/ })).toBeEnabled();

    fireEvent.click(within(keys).getByRole('checkbox', { name: /id/ }));
    expect(screen.getByRole('button', { name: /Start import/ })).toBeDisabled();
    expect(screen.getByText(/Choose the key column/)).toBeInTheDocument();
    fireEvent.click(within(keys).getByRole('checkbox', { name: /^age/ }));
    expect(await screen.findByText(/not a primary or unique key/)).toBeInTheDocument();
  });

  it('blocks the import with the engine reason (read-only / unsupported)', async () => {
    h.api.capabilities.mockResolvedValue({ ...caps, canImport: false, reason: 'This provider cannot import.' });
    open({ path: CSV });
    await waitFor(() => expect(h.api.capabilities).toHaveBeenCalled());
    await toFormat();
    await waitFor(() => expect(nextBtn()).toBeEnabled());
    next();
    await screen.findByRole('heading', { name: 'Target table' });
    await waitFor(() => expect(nextBtn()).toBeDisabled());
  });
});

describe('step 5: run', () => {
  let finish: (end: JobEnd) => void;
  let progress: (p: ImportProgress | null, ev: { done: number }) => void;

  beforeEach(() => {
    h.api.start.mockResolvedValue({ jobId: 'j1' });
    h.wait.mockImplementation((_id: string, onProgress: typeof progress) => {
      progress = onProgress;
      return new Promise<JobEnd>((res) => {
        finish = res;
      });
    });
  });

  it('starts the job with the built request, shows progress, cancel and the summary', async () => {
    await toMode();
    fireEvent.click(screen.getByRole('radio', { name: /Skip bad rows/ }));
    fireEvent.change(screen.getByLabelText('Maximum errors'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Batch size'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /Start import/ }));

    await waitFor(() => expect(h.api.start).toHaveBeenCalledTimes(1));
    const [cid, req] = h.api.start.mock.calls[0];
    expect(cid).toBe('c1');
    expect(req).toMatchObject({
      path: CSV, mode: 'append', onError: 'skip', maxErrors: 25, batchSize: 250, transaction: true, useBulk: true,
      target: { database: 'shop', schema: 'dbo', table: 'people', create: true },
      source: { format: 'csv', encoding: 'utf-8', delimiter: ',' },
    });
    expect(req.columns).toHaveLength(3);
    expect(req.columns[1]).toMatchObject({ target: 'Name', from: { kind: 'source', index: 1 } });
    expect(useTabs.getState().tabs[0]).toMatchObject({ dirty: true }); // closing asks first

    await screen.findByRole('progressbar', { name: 'Import progress' });
    await waitFor(() => expect(h.wait).toHaveBeenCalled());
    act(() => progress({ phase: 'importing', rows: 1500, written: 1490, skipped: 10, errors: 10, rate: 5000, bytes: 512, totalBytes: 1024 }, { done: 1500 }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    const stats = screen.getByLabelText('Progress');
    expect(within(stats).getByText('1,500')).toBeInTheDocument();
    expect(within(stats).getByText('5,000')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull(); // no navigation while it runs

    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await waitFor(() => expect(h.api.cancel).toHaveBeenCalledWith('j1'));

    act(() => finish({ status: 'ok', error: null, summary }));
    expect(await screen.findByText('Import complete, some rows were skipped', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/The changes are committed/)).toBeInTheDocument();
    const sum = screen.getByLabelText('Summary');
    expect(within(sum).getByText('97')).toBeInTheDocument();
    const errors = screen.getByRole('table', { name: 'Errors' });
    expect(within(errors).getByText('not a number')).toBeInTheDocument();
    expect(within(errors).getByText('7 | x | abc')).toBeInTheDocument();
    expect(useTabs.getState().tabs[0]).toMatchObject({ dirty: false });
    expect(useCatalog.getState().revalidate).toHaveBeenCalledWith('c1', 'shop', ['dbo']);
  });

  it('downloads the error report and opens the table data', async () => {
    const saveFile = vi.fn(async (_o: unknown) => 'D:\\import-errors.csv');
    setPlatform({ ...createBrowserPlatform(), saveFile });
    const dataOpen = vi.fn();
    registerCommand({ id: 'data.open', title: 'Open table data', category: 'Database', run: dataOpen });
    const blob = new Blob(['\uFEFFrow,error\n7,bad'], { type: 'text/csv' });
    h.api.errorReport.mockResolvedValue(blob);

    await toMode();
    fireEvent.click(screen.getByRole('button', { name: /Start import/ }));
    await waitFor(() => expect(h.wait).toHaveBeenCalled());
    act(() => finish({ status: 'ok', error: null, summary }));
    fireEvent.click(await screen.findByRole('button', { name: /Download error report/ }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(h.api.errorReport).toHaveBeenCalledWith('j1');
    expect(saveFile.mock.calls[0][0]).toMatchObject({ suggestedName: 'import-errors.csv', content: blob });

    fireEvent.click(screen.getByRole('button', { name: /Open table data/ }));
    expect(dataOpen).toHaveBeenCalledWith({
      kind: 'object', connectionId: 'c1', database: 'shop', ref: { database: 'shop', schema: 'dbo', name: 'people', type: 'table' },
    });
  });

  it('shows a failed job and lets the user go back', async () => {
    await toMode();
    fireEvent.click(screen.getByRole('button', { name: /Start import/ }));
    await waitFor(() => expect(h.wait).toHaveBeenCalled());
    act(() => finish({ status: 'error', error: 'Login failed for user', summary: null }));
    expect(await screen.findByText('Login failed for user')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to options' }));
    expect(await screen.findByRole('heading', { name: 'Import mode and options' })).toBeInTheDocument();
  });

  it('shows a start error (e.g. read-only connection refused by the engine)', async () => {
    h.api.start.mockRejectedValue(new Error('The connection is read-only'));
    await toMode();
    fireEvent.click(screen.getByRole('button', { name: /Start import/ }));
    expect(await screen.findByText('The connection is read-only')).toBeInTheDocument();
  });

  it('can import another file', async () => {
    await toMode();
    fireEvent.click(screen.getByRole('button', { name: /Start import/ }));
    await waitFor(() => expect(h.wait).toHaveBeenCalled());
    act(() => finish({ status: 'ok', error: null, summary: { ...summary, outcome: 'completed', errorCount: 0, errorsSample: [], hasErrorReport: false } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Import another file' }));
    expect(await screen.findByRole('heading', { name: 'Choose the file to import' })).toBeInTheDocument();
    expect(screen.getByLabelText('File path')).toHaveValue('');
  });
});
