// The Materialize dialog against the MSW mock engine: target pickers, name validation, DDL preview request shape, the
// job (progress, done, failed, cancelled) and "Open table"; plus the self-mounting host and the command's argument rules.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engineSocket } from '../../../api/ws';
import { isEnabled } from '../../../commands/registry';
import type { ObjectTarget } from '../../../commands/types';
import { linkedConnections } from '../../../mocks/packs/linked';
import { useConnections } from '../../../store/connections';
import { useTabs } from '../../../store/tabs';
import { installMockEngine, TEST_ENGINE_URL } from '../../../test/mockServer';
import { MaterializeDialog, PREVIEW_DEBOUNCE_MS } from './MaterializeDialog';
import { materializeSourceOf, tableSourceOf } from './args';
import { registerMaterializeCommands } from './commands';
import { mountDialog } from './mount';
import type { MaterializePreview } from '../../../api/links';

const mock = installMockEngine();
const LINK = 'c_link';
const P = `${TEST_ENGINE_URL}/api/v1/links/${LINK}`;

let previews: Record<string, unknown>[] = [];
let starts: Record<string, unknown>[] = [];
let cancelled: string[] = [];
let jobSeq = 0;
let jobId = 'job-0';
let preview: MaterializePreview = {
  dialect: 'pgsql', ddl: 'CREATE TABLE public.orders_materialized (\n  id bigint,\n  total numeric(12,2)\n)', warnings: [],
  tableExists: false, columns: [{ name: 'id', ordinal: 0, dbType: 'bigint', kind: 'int', nullable: false } as never, { name: 'total', ordinal: 1, dbType: 'numeric', kind: 'decimal', nullable: true } as never],
};

beforeEach(async () => {
  mock.reset();
  previews = [];
  starts = [];
  cancelled = [];
  preview = { ...preview, tableExists: false, warnings: [] };
  useTabs.setState({ tabs: [], activeId: null, seq: 0 });
  useConnections.setState({ providers: [], connections: [], loaded: false, error: null });
  await useConnections.getState().load();
  useConnections.setState({ connections: [...useConnections.getState().connections, ...linkedConnections] });
  try {
    localStorage.clear();
  } catch {
    // no storage in this environment
  }
  mock.server.use(
    http.post(`${P}/materialize/preview`, async ({ request }) => {
      previews.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(preview);
    }),
    http.post(`${P}/materialize`, async ({ request }) => {
      starts.push((await request.json()) as Record<string, unknown>);
      jobId = 'job-' + ++jobSeq;
      return HttpResponse.json({ jobId }, { status: 202 });
    }),
    http.delete(`${TEST_ENGINE_URL}/api/v1/jobs/:id`, ({ params }) => {
      cancelled.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

const SOURCE = { connectionId: LINK, sql: 'SELECT o.id, o.total FROM shop.orders o;\n', sessionId: 's1' };

async function openDialog(source = SOURCE) {
  const onClose = vi.fn();
  render(<MaterializeDialog source={source} onClose={onClose} />);
  const select = (await screen.findByLabelText('Target connection')) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'c_pg' } });
  await screen.findByRole('combobox', { name: 'Target schema' }).catch(() => undefined);
  return { onClose };
}

const startButton = () => screen.getByRole('button', { name: /^(Materialize|Try again)$/ });
const job = (e: object) => act(() => engineSocket.dispatch({ ts: new Date().toISOString(), jobId, kind: 'materialize', ...e } as never));

async function readyToStart() {
  const dialog = await openDialog();
  await screen.findByLabelText('DDL');
  await waitFor(() => expect(startButton()).toBeEnabled());
  return dialog;
}

describe('MaterializeDialog', () => {
  it('lists writable non-link connections and proposes a table name from the query', async () => {
    render(<MaterializeDialog source={SOURCE} onClose={() => {}} />);
    const select = (await screen.findByLabelText('Target connection')) as HTMLSelectElement;
    const names = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(names).toContain('Postgres Shop');
    expect(names).not.toContain('Sales (linked)');
    expect((screen.getByLabelText('Table name') as HTMLInputElement).value).toBe('orders_materialized');
    expect(screen.getByText('Query').nextSibling?.textContent).toContain('SELECT o.id, o.total FROM shop.orders o;');
  });

  it('previews the DDL with the request shape of POST /links/{cid}/materialize/preview', async () => {
    await openDialog();
    expect(await screen.findByLabelText('DDL')).toHaveTextContent('CREATE TABLE public.orders_materialized');
    await waitFor(() => expect(previews.length).toBeGreaterThan(0));
    expect(previews.at(-1)).toEqual({
      sql: 'SELECT o.id, o.total FROM shop.orders o', targetConnectionId: 'c_pg', database: expect.any(String), schema: expect.any(String),
      table: 'orders_materialized', mode: 'create', sessionId: 's1',
    });
  });

  it('refuses a name that exists in create mode, asks to confirm a replace and accepts append', async () => {
    preview = { ...preview, tableExists: true };
    await openDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(startButton()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Replace table' }));
    const confirm = await screen.findByRole('checkbox');
    expect(startButton()).toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(startButton()).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: 'Append rows' }));
    await waitFor(() => expect(startButton()).toBeEnabled());
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('validates the name as you type and sends nothing while it is invalid', async () => {
    await openDialog();
    await screen.findByLabelText('DDL');
    const n = previews.length;
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: '' } });
    expect(startButton()).toBeDisabled();
    await new Promise((r) => setTimeout(r, PREVIEW_DEBOUNCE_MS + 100));
    expect(previews.length).toBe(n);
    fireEvent.change(screen.getByLabelText('Table name'), { target: { value: 'order_totals' } });
    await waitFor(() => expect(previews.at(-1)?.table).toBe('order_totals'));
  });

  it('shows the preview error from the engine', async () => {
    mock.server.use(http.post(`${P}/materialize/preview`, () => HttpResponse.json({ error: { code: 'READ_ONLY', message: 'The target connection is read-only.' } }, { status: 403 })));
    await openDialog();
    expect(await screen.findByText('The target connection is read-only.')).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it('runs the job: starts it, shows progress, then the result with Open table', async () => {
    const { onClose } = await readyToStart();
    fireEvent.click(startButton());
    await waitFor(() => expect(starts).toHaveLength(1));
    expect(starts[0]).toMatchObject({ targetConnectionId: 'c_pg', table: 'orders_materialized', mode: 'create' });
    await screen.findByText(/Reading the member databases/);

    job({ type: 'job.progress', done: 500, total: 1000, message: 'Loading rows' });
    expect(await screen.findByText('500 rows written of 1,000')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Materialize progress' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Cancel job' })).toBeEnabled();

    job({
      type: 'job.done', status: 'ok', error: null,
      result: { targetConnectionId: 'c_pg', database: 'shop', schema: 'public', table: 'orders_materialized', rows: 1000, elapsedMs: 2400, warnings: [] },
    });
    const result = await screen.findByRole('status', { name: 'Result' });
    expect(result).toHaveTextContent('1,000 rows written to public.orders_materialized in 2.4 s');

    fireEvent.click(screen.getAllByRole('button', { name: 'Open table' }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
    const opened = useTabs.getState().tabs.find((t) => t.kind === 'object');
    expect(opened).toMatchObject({ connectionId: 'c_pg', ref: { name: 'orders_materialized', schema: 'public', type: 'table' } });
  });

  it('survives a job that finishes before the 202 arrives', async () => {
    mock.server.use(
      http.post(`${P}/materialize`, async () => {
        jobId = 'job-' + ++jobSeq;
        engineSocket.dispatch({
          type: 'job.done', ts: '', jobId, kind: 'materialize', status: 'ok', error: null,
          result: { targetConnectionId: 'c_pg', database: null, schema: 'public', table: 'orders_materialized', rows: 3, elapsedMs: 10, warnings: [] },
        } as never);
        return HttpResponse.json({ jobId }, { status: 202 });
      }),
    );
    await readyToStart();
    fireEvent.click(startButton());
    expect(await screen.findByRole('status', { name: 'Result' })).toHaveTextContent('3 rows written');
  });

  it('reports a failed job and lets you try again', async () => {
    await readyToStart();
    fireEvent.click(startButton());
    await screen.findByRole('button', { name: 'Cancel job' }).then(() => waitFor(() => expect(screen.getByRole('button', { name: 'Cancel job' })).toBeEnabled()));
    job({ type: 'job.done', status: 'error', error: 'SOURCE_UNAVAILABLE: shop is not reachable', result: null });
    expect(await screen.findByText('SOURCE_UNAVAILABLE: shop is not reachable')).toBeInTheDocument();
    expect(startButton()).toHaveTextContent('Try again');
    expect(startButton()).toBeEnabled();
  });

  it('cancels the job with DELETE /jobs/{id}', async () => {
    await readyToStart();
    fireEvent.click(startButton());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel job' })).toBeEnabled());
    job({ type: 'job.progress', done: 10, total: null, message: null });
    await screen.findByText('10 rows written');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel job' }));
    await waitFor(() => expect(cancelled).toEqual([jobId]));
    job({ type: 'job.done', status: 'cancelled', error: null, result: null });
    expect(await screen.findByText(/The job was cancelled/)).toBeInTheDocument();
  });

  it('says so when there is no writable connection or no query', async () => {
    useConnections.setState({ connections: linkedConnections });
    render(<MaterializeDialog source={{ connectionId: LINK, sql: ' ' }} onClose={() => {}} />);
    expect(await screen.findByText(/No writable connection/)).toBeInTheDocument();
    expect(screen.getByText(/There is no query to materialize/)).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });
});

describe('links.materialize command', () => {
  const object = (connectionId: string, schema: string | null, name: string, type = 'table'): ObjectTarget =>
    ({ kind: 'object', connectionId, database: null, ref: { database: null, schema, name, type } as never });

  beforeEach(() => registerMaterializeCommands());

  it('takes explicit SQL or a view id of a link', () => {
    expect(materializeSourceOf({ connectionId: LINK, sql: 'SELECT 1', params: [], sessionId: 's' })).toMatchObject({ connectionId: LINK, sql: 'SELECT 1', sessionId: 's' });
    expect(materializeSourceOf({ connectionId: LINK, viewId: 'v1', name: 'Top' })).toMatchObject({ viewId: 'v1', name: 'Top' });
    expect(materializeSourceOf({ connectionId: 'c_pg', sql: 'SELECT 1' })).toBeNull(); // not a link
  });

  it('reads a mounted table of a link as SELECT * FROM alias.table', () => {
    expect(materializeSourceOf(object(LINK, 'shop', 'orders'))?.sql).toBe('SELECT *\nFROM shop.orders');
    expect(materializeSourceOf(object(LINK, 'shop', 'Order Lines'))?.sql).toBe('SELECT *\nFROM shop."Order Lines"');
    expect(materializeSourceOf(object('c_pg', 'public', 'orders'))).toBeNull();
    expect(isEnabled('links.materialize', object(LINK, 'shop', 'orders'))).toBe(true);
    expect(isEnabled('links.materialize', object('c_pg', 'public', 'orders'))).toBe(false);
  });

  it('"Add to link…" applies to tables and views of connections that are not links', () => {
    expect(tableSourceOf(object('c_pg', 'public', 'orders'))).toEqual({ connectionId: 'c_pg', database: null, schema: 'public', name: 'orders', type: 'table' });
    expect(tableSourceOf({ connectionId: 'c_pg', database: 'shop', schema: 'public', name: 'orders', type: 'view' })?.type).toBe('view');
    expect(tableSourceOf(object('c_pg', 'public', 'orders_fn', 'proc'))).toBeNull();
    expect(tableSourceOf(object(LINK, 'shop', 'orders'))).toBeNull();
    expect(isEnabled('links.addTable', object('c_pg', 'public', 'orders'))).toBe(true);
    expect(isEnabled('links.addTable', object(LINK, 'shop', 'orders'))).toBe(false);
  });
});

describe('mountDialog', () => {
  it('mounts one dialog per key on <body> and removes it on close', async () => {
    const closeA = mountDialog('t.one', 'the test dialog', (close) => <button onClick={close}>first</button>);
    mountDialog('t.one', 'the test dialog', (close) => <button onClick={close}>second</button>);
    await screen.findByRole('button', { name: 'second' });
    expect(screen.queryByRole('button', { name: 'first' })).toBeNull();
    expect(document.querySelectorAll('[data-links-dialog="t.one"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(document.querySelector('[data-links-dialog="t.one"]')).toBeNull());
    closeA(); // closing twice is harmless
  });
});
