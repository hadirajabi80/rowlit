// The Generate data tab against a mocked engine API: the inferred plan, editing a generator, validation, the debounced preview,
// the run with progress and result, the delete-first confirmation, cancel and the error report.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import type { GenerateColumn, GeneratePlan, GeneratePreview, GenerateRequest, GenerateSummary, GeneratorInfo } from '../../../api/types.generate';
import { registerCommand } from '../../../commands/registry';
import { setPlatform } from '../../../platform';
import { createBrowserPlatform } from '../../../platform/browser';
import { useConnections } from '../../../store/connections';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { useUi } from '../../../store/ui';
import type { GenerateJobEnd } from '../jobs';
import { openGenerateData } from '../open';
import { GenerateDataView } from '../GenerateDataView';

const h = vi.hoisted(() => ({
  api: { generators: vi.fn(), plan: vi.fn(), preview: vi.fn(), run: vi.fn(), cancel: vi.fn(), errorReport: vi.fn() },
  wait: vi.fn(),
}));
vi.mock('../api', () => ({ generateApi: h.api }));
vi.mock('../jobs', () => ({ listenForJobs: vi.fn(), waitForGenerateJob: h.wait }));

const opt = (key: string, label: string, type: 'number' | 'text' | 'multiline' | 'date', def: string | null = null) => ({ key, label, type, default: def, help: null });
const INFOS: GeneratorInfo[] = [
  { id: 'sequence', label: 'Sequence', group: 'Numbers', kinds: ['int', 'bigint', 'text'], options: [opt('start', 'Start at', 'number', 'auto'), opt('step', 'Step', 'number', '1')] },
  { id: 'int', label: 'Whole number', group: 'Numbers', kinds: ['int', 'bigint', 'text'], options: [opt('min', 'Minimum', 'number', '1'), opt('max', 'Maximum', 'number', '100000')] },
  { id: 'bool', label: 'Boolean', group: 'Numbers', kinds: ['bool', 'int'], options: [opt('trueP', 'Chance of true (%)', 'number', '50')] },
  { id: 'email', label: 'Email address', group: 'People', kinds: ['text'], options: [] },
  { id: 'list', label: 'Pick from a list', group: 'Text', kinds: ['int', 'text'], options: [opt('values', 'Values (one per line)', 'multiline', 'one\ntwo\nthree')] },
];

const column = (over: Partial<GenerateColumn>): GenerateColumn => ({
  name: 'c', type: 'integer', kind: 'int', nullable: false, isPk: false, isIdentity: false, isComputed: false, hasDefault: false,
  generator: 'int', options: {}, nullPercent: 0, unique: false, foreignKey: null, note: null, ...over,
});

const plan = (over: Partial<GeneratePlan> = {}): GeneratePlan => ({
  providerId: 'postgresql', dialect: 'pgsql', canGenerate: true, reason: null, readOnly: false, table: 'orders', defaultRows: 1000, maxRows: 100000, seed: 77,
  batchSize: 5000, transactional: true,
  columns: [
    column({ name: 'id', isPk: true, isIdentity: true, generator: 'skip', note: 'Identity column: the database numbers the rows.' }),
    column({ name: 'email', type: 'text', kind: 'text', generator: 'email', unique: true, nullable: true, nullPercent: 5 }),
    column({ name: 'age', generator: 'int', options: { min: '18', max: '80' } }),
    column({ name: 'customer_id', generator: 'foreignKey', foreignKey: 'fk_cust' }),
  ],
  foreignKeys: [{ name: 'fk_cust', columns: ['customer_id'], refSchema: 'public', refTable: 'customers', refColumns: ['id'], parentHasRows: true }],
  uniqueKeys: [], warnings: ['The table has 1 trigger(s); they fire for every generated row.'], ...over,
});

const previewOf = (over: Partial<GeneratePreview> = {}): GeneratePreview => ({
  columns: [{ name: 'email', type: 'text', kind: 'text' }, { name: 'age', type: 'integer', kind: 'int' }, { name: 'customer_id', type: 'integer', kind: 'int' }],
  rows: [['ann.lee@example.com', '34', '3'], [null, '51', '9']], warnings: [], seed: 77, ...over,
});

const summary = (over: Partial<GenerateSummary> = {}): GenerateSummary => ({
  outcome: 'completed', error: null, rowsRequested: 1000, rowsGenerated: 1000, rowsWritten: 1000, rowsSkipped: 0, errorCount: 0, elapsedMs: 800, rowsPerSecond: 1250,
  committed: true, rolledBack: false, truncated: false, errorsSample: [], hasErrorReport: false, loadMethod: 'COPY', seed: 77, warnings: [], ...over,
});

const conn = (id: string, name: string, providerId: string) =>
  ({ id, name, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null }) as never;

function Host({ id }: { id: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id)) as ViewTab | undefined;
  return tab ? <GenerateDataView tab={tab} theme="light" visible /> : null;
}

async function open(p: GeneratePlan = plan()) {
  h.api.plan.mockResolvedValue(p);
  const id = openGenerateData({ connectionId: 'pg', database: 'shop', schema: 'public', table: 'orders' });
  render(<Host id={id} />);
  await screen.findByRole('table', { name: 'Columns' });
}

const lastPreview = (): GenerateRequest => h.api.preview.mock.calls.at(-1)![0] as GenerateRequest;
const generateBtn = () => screen.getByRole('button', { name: /^Generate [\d,]+ rows?$|^Generate rows$/ });
const dataOpen = vi.fn();
const confirm = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useUi.setState({ toasts: [], confirm: null, askConfirm: confirm } as never);
  confirm.mockResolvedValue(true);
  useTabs.setState({ tabs: [], activeId: null, seq: 0, mru: [], closed: [] });
  useConnections.setState({ loaded: true, providers: [], connections: [conn('pg', 'Shop PG', 'postgresql')] });
  registerCommand({ id: 'data.open', title: 'Open table data', category: 'Database', run: dataOpen });
  h.api.generators.mockResolvedValue(INFOS);
  h.api.preview.mockResolvedValue(previewOf());
  h.api.run.mockResolvedValue({ jobId: 'job-1' });
  h.api.cancel.mockResolvedValue(undefined);
  h.wait.mockResolvedValue({ status: 'ok', error: null, summary: summary() } satisfies GenerateJobEnd);
});

afterEach(() => setPlatform(null));

describe('GenerateDataView', () => {
  it('reads the plan and shows an inferred generator for every column', async () => {
    await open();
    expect(h.api.plan).toHaveBeenCalledWith({ connectionId: 'pg', database: 'shop', schema: 'public', table: 'orders' }, expect.anything());
    expect(screen.getByRole('heading', { name: /Generate data/ })).toBeInTheDocument();
    expect(screen.getByText('The table has 1 trigger(s); they fire for every generated row.')).toBeInTheDocument();
    expect(screen.getByLabelText('Number of rows')).toHaveValue('1000');
    expect(screen.getByLabelText('Seed')).toHaveValue('77');
    expect(screen.getByLabelText('id generator')).toHaveValue('skip');
    expect(screen.getByLabelText('email generator')).toHaveValue('email');
    expect(screen.getByLabelText('age generator')).toHaveValue('int');
    expect(screen.getByLabelText('age Minimum')).toHaveValue('18');
    expect(screen.getByLabelText('age Maximum')).toHaveValue('80');
    expect(screen.getByLabelText('customer_id generator')).toHaveValue('foreignKey');
    expect(screen.getByText('values of the parent table')).toBeInTheDocument();
    expect(screen.getByLabelText('email unique')).toBeChecked();
    expect(screen.getByLabelText('id null percent')).toBeDisabled(); // skipped
    expect(screen.getByLabelText('age null percent')).toBeDisabled(); // not null
    expect(screen.getByLabelText('email null percent')).toHaveValue('5');
    expect(generateBtn()).toHaveTextContent('Generate 1,000 rows');
    expect(generateBtn()).toBeEnabled();
  });

  it('previews 20 rows with the plan seed after a short pause', async () => {
    await open();
    await waitFor(() => expect(h.api.preview).toHaveBeenCalled(), { timeout: 3000 });
    const req = lastPreview();
    expect(req).toMatchObject({ connectionId: 'pg', database: 'shop', schema: 'public', table: 'orders', rows: 1000, seed: 77, previewRows: 20, truncateFirst: false });
    expect(req.columns.map((c) => c.generator)).toEqual(['skip', 'email', 'int', 'foreignKey']);
    const grid = await screen.findByRole('table', { name: 'Preview rows' });
    expect(within(grid).getByText('ann.lee@example.com')).toBeInTheDocument();
    expect(within(grid).getByText('NULL')).toBeInTheDocument();
  });

  it('changing a generator takes its default options into the next preview', async () => {
    await open();
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText('age generator'), { target: { value: 'bool' } });
    expect(screen.getByLabelText('age Chance of true (%)')).toHaveValue('50');
    expect(screen.queryByLabelText('age Minimum')).toBeNull();
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const age = lastPreview().columns.find((c) => c.name === 'age')!;
    expect(age).toMatchObject({ generator: 'bool', options: { trueP: '50' } });
  });

  it('shows a column problem next to it and blocks the run until it is fixed', async () => {
    await open();
    await waitFor(() => expect(h.api.preview).toHaveBeenCalledTimes(1), { timeout: 3000 });
    fireEvent.change(screen.getByLabelText('age Minimum'), { target: { value: 'abc' } });
    expect(screen.getByText('Minimum must be a number.')).toBeInTheDocument();
    expect(generateBtn()).toBeDisabled();
    expect(screen.getByText('1 thing needs attention.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('age Minimum'), { target: { value: '30' } });
    expect(screen.queryByText('Minimum must be a number.')).toBeNull();
    expect(generateBtn()).toBeEnabled();
  });

  it('validates the number of rows against the engine limit', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Number of rows'), { target: { value: '100001' } });
    expect(screen.getByText('Enter a whole number from 1 to 100,000.')).toBeInTheDocument();
    expect(generateBtn()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Number of rows'), { target: { value: '25,000' } });
    expect(generateBtn()).toHaveTextContent('Generate 25,000 rows');
    fireEvent.change(screen.getByLabelText('Number of rows'), { target: { value: '1' } });
    expect(generateBtn()).toHaveTextContent('Generate 1 row');
  });

  it('shows the preview error of the engine (for example an empty parent table)', async () => {
    h.api.preview.mockRejectedValue(new ApiError('VALIDATION', 'The parent table customers has no rows to reference from customer_id.', 400));
    await open();
    expect(await screen.findByText(/has no rows to reference/, undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('refuses a table the connection cannot write to', async () => {
    await open(plan({ canGenerate: false, readOnly: true, reason: "The connection 'Shop PG' is read-only: generating data is not allowed." }));
    expect(screen.getByText(/is read-only/)).toBeInTheDocument();
    expect(generateBtn()).toBeDisabled();
    await new Promise((r) => setTimeout(r, 600));
    expect(h.api.preview).not.toHaveBeenCalled();
  });

  it('generates: sends the request, shows progress, then the result with Open data', async () => {
    let finish!: (e: GenerateJobEnd) => void;
    h.wait.mockImplementation((_id: string, onProgress: (p: unknown) => void) => {
      onProgress({ phase: 'generating', rows: 250, total: 1000, written: 250, skipped: 0, errors: 0, rate: 5000 });
      return new Promise<GenerateJobEnd>((r) => { finish = r; });
    });
    await open();
    fireEvent.change(screen.getByLabelText('When the server rejects a row'), { target: { value: 'skip' } });
    fireEvent.click(generateBtn());
    await waitFor(() => expect(h.api.run).toHaveBeenCalled());
    expect(h.api.run.mock.calls[0][0]).toMatchObject({
      connectionId: 'pg', table: 'orders', rows: 1000, seed: 77, truncateFirst: false, transaction: true, onError: 'skip',
    });
    expect(confirm).not.toHaveBeenCalled();
    const bar = await screen.findByRole('progressbar', { name: 'Generating progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByLabelText('Number of rows').closest('fieldset')).toBeDisabled();
    expect(useTabs.getState().tabs.find((t) => t.kind === 'view')).toMatchObject({ dirty: true });

    await act(async () => finish({ status: 'ok', error: null, summary: summary() }));
    expect(await screen.findByText('Data generated')).toBeInTheDocument();
    expect(screen.getByText(/1,000 of 1,000 rows written/)).toBeInTheDocument();
    expect(useTabs.getState().tabs.find((t) => t.kind === 'view')).toMatchObject({ dirty: false });
    fireEvent.click(screen.getByRole('button', { name: /Open data/ }));
    expect(dataOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: 'object', connectionId: 'pg', ref: expect.objectContaining({ name: 'orders', schema: 'public' }) }));
    // "Generate more" goes back to the settings with a new seed
    fireEvent.click(screen.getByRole('button', { name: 'Generate more' }));
    expect(screen.queryByText('Data generated')).toBeNull();
    expect(screen.getByLabelText('Seed')).not.toHaveValue('77');
  });

  it('asks before deleting the existing rows and does nothing when declined', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Delete the existing rows first'));
    confirm.mockResolvedValueOnce(false);
    fireEvent.click(generateBtn());
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toMatchObject({ danger: true, confirmLabel: 'Delete and generate' });
    expect(h.api.run).not.toHaveBeenCalled();

    fireEvent.click(generateBtn());
    await waitFor(() => expect(h.api.run).toHaveBeenCalled());
    expect(h.api.run.mock.calls[0][0]).toMatchObject({ truncateFirst: true });
  });

  it('cancels a running job after confirmation', async () => {
    h.wait.mockImplementation(() => new Promise(() => undefined));
    await open();
    fireEvent.click(generateBtn());
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toBeEnabled());
    fireEvent.click(cancel);
    await waitFor(() => expect(h.api.cancel).toHaveBeenCalledWith('job-1'));
    expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Cancel generating data?' });
    expect(await screen.findByRole('button', { name: 'Cancelling…' })).toBeDisabled();
  });

  it('reports rejected rows and downloads the error report', async () => {
    const saveFile = vi.fn().mockResolvedValue('C:\\tmp\\generate-errors.csv');
    setPlatform({ ...createBrowserPlatform(), saveFile } as never);
    const blob = new Blob(['row,column,error\n']);
    h.api.errorReport.mockResolvedValue(blob);
    h.wait.mockResolvedValue({
      status: 'ok', error: null,
      summary: summary({
        outcome: 'completedWithErrors', rowsWritten: 998, rowsSkipped: 2, errorCount: 2, hasErrorReport: true,
        errorsSample: [{ row: 12, column: null, message: 'duplicate key value violates unique constraint', values: null }, { row: 40, column: null, message: 'x too big', values: null }],
      }),
    } satisfies GenerateJobEnd);
    await open();
    fireEvent.click(generateBtn());
    expect(await screen.findByText('Data generated, some rows were rejected')).toBeInTheDocument();
    const errors = screen.getByRole('table', { name: 'Rejected rows' });
    expect(within(errors).getByText('duplicate key value violates unique constraint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download error report' }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(h.api.errorReport).toHaveBeenCalledWith('job-1');
    expect(saveFile.mock.calls[0][0]).toMatchObject({ suggestedName: 'generate-errors.csv', content: blob });
  });

  it('shows why a run failed and goes back to the settings', async () => {
    h.wait.mockResolvedValue({ status: 'error', error: 'connection lost', summary: null } satisfies GenerateJobEnd);
    await open();
    fireEvent.click(generateBtn());
    expect(await screen.findByText('connection lost')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the settings' }));
    expect(screen.queryByText('connection lost')).toBeNull();
    expect(generateBtn()).toBeEnabled();
  });

  it('shows the cancelled summary the engine returns', async () => {
    h.wait.mockResolvedValue({ status: 'ok', error: null, summary: summary({ outcome: 'cancelled', rowsWritten: 0, committed: false, rolledBack: true }) } satisfies GenerateJobEnd);
    await open();
    fireEvent.click(generateBtn());
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/everything rolled back/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open data/ })).toBeNull();
  });

  it('resets the columns to the suggestions', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('age generator'), { target: { value: 'list' } });
    expect(screen.getByLabelText('age generator')).toHaveValue('list');
    fireEvent.click(screen.getByRole('button', { name: /Reset to suggestions/ }));
    expect(screen.getByLabelText('age generator')).toHaveValue('int');
  });

  it('runs with Ctrl+Enter', async () => {
    await open();
    fireEvent.keyDown(screen.getByTestId('generate-data'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(h.api.run).toHaveBeenCalled());
  });
});
