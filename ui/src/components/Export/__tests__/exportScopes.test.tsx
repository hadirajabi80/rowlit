// The export dialog end to end without an engine: scope options and counts of the Data tab and of a console result,
// the engine job (events racing the response, cancel), client-side rendering and the dialog's behaviour.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api/client';
import type { ColumnInfo, ColumnKind, WsEvent } from '../../../api/types';
import { engineSocket } from '../../../api/ws';
import { setPlatform, type Platform } from '../../../platform';
import { useUi } from '../../../store/ui';
import { registerGridController, type GridController } from '../../Grid/controller';
import { ExportDialog } from '../ExportDialog';
import { renderClientFile } from '../clientRender';
import { DEFAULT_SETTINGS } from '../model';
import { announceOutcome, runExport } from '../run';
import { runServerExport } from '../serverExport';
import { buildQuerySource, buildTableSource, stripTrailingSemicolon } from '../sources';
import type { ExportSource, QueryExportContext, TableExportContext } from '../types';

const col = (name: string, kind: ColumnKind, ordinal = 0): ColumnInfo => ({
  name, ordinal, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'orders', schema: null, isKey: false,
});
const COLS = [col('id', 'int'), col('name', 'string', 1), col('at', 'datetime', 2)];

const table = (p: Partial<TableExportContext> = {}): TableExportContext => ({
  kind: 'table', connectionId: 'c1', dialect: 'pgsql', gridKey: 'g1', title: 'orders', columns: COLS,
  target: { schema: null, name: 'orders', keyColumns: ['id'] }, where: null, params: [], clientOnlyFilter: false, sort: [],
  filteredCount: 5000, loaded: 1000, hasMore: true, withSession: async (run) => run('s1'), estimateRows: async () => 4800, ...p,
});
const query = (p: Partial<QueryExportContext> = {}): QueryExportContext => ({
  kind: 'query', connectionId: 'c1', dialect: 'pgsql', gridKey: 'g1', baseName: 'orders', columns: COLS, sql: 'SELECT * FROM orders;', params: [],
  rerunDisabled: null, rowCount: 10000, truncated: true, gridFiltered: false, stored: null, withSession: async (run) => run('s1'), ...p,
});

let offGrid: (() => void) | null = null;
function grid(info: ReturnType<NonNullable<GridController['exportInfo']>>, block?: ReturnType<NonNullable<GridController['exportBlock']>>) {
  offGrid = registerGridController({
    key: 'g1', editable: false, exportInfo: () => info,
    exportBlock: () => block ?? { columns: COLS, rows: [[1, 'a', '2026-03-09T14:05:06']], locate: null, fetch: null },
  } as unknown as GridController);
}

const ids = (s: ExportSource) => s.scopes.map((x) => x.id);
const scope = (s: ExportSource, id: string) => s.scopes.find((x) => x.id === id)!;

afterEach(() => {
  cleanup();
  offGrid?.();
  offGrid = null;
  setPlatform(null);
  vi.restoreAllMocks();
});

describe('scopes of the Data tab', () => {
  it('no filter: loaded rows, then everything with the grid\'s exact count; filter & sort is offered disabled', () => {
    grid({ visibleRows: 1000, selection: null });
    const s = buildTableSource(table());
    expect(ids(s)).toEqual(['loaded', 'filtered', 'all']);
    expect(scope(s, 'loaded')).toMatchObject({ count: 1000, countKind: 'exact', disabled: null });
    expect(scope(s, 'filtered').disabled).toMatch(/No filter or sort/);
    expect(scope(s, 'all')).toMatchObject({ count: 5000, countKind: 'exact' });
    expect(s.initialScope).toBe('loaded');
  });

  it('with a filter: the filtered count is the grid\'s, "all" shows an estimate and counts exactly on request', () => {
    grid({ visibleRows: 1000, selection: null });
    const s = buildTableSource(table({ where: 'name LIKE $1', params: [{ name: '1', kind: 'string', value: 'a%' }], filteredCount: 321 }));
    expect(scope(s, 'filtered')).toMatchObject({ count: 321, disabled: null, label: 'Current filter & sort: all matching rows' });
    expect(scope(s, 'all')).toMatchObject({ count: null, countOnRequest: true });
    expect(scope(s, 'all').estimate).toBeTypeOf('function');
    expect(scope(s, 'all').countNow).toBeTypeOf('function');
  });

  it('a regular expression only works on loaded rows: the server scope is refused with the reason', () => {
    grid({ visibleRows: 10, selection: null });
    const s = buildTableSource(table({ where: null, clientOnlyFilter: true }));
    expect(scope(s, 'filtered').disabled).toMatch(/regular expression/);
  });

  it('a selection adds its own scope and becomes the default', () => {
    grid({ visibleRows: 1000, selection: { rows: 3, cols: 3, kind: 'rows' } });
    const s = buildTableSource(table());
    expect(ids(s)).toEqual(['loaded', 'selection', 'filtered', 'all']);
    expect(scope(s, 'selection')).toMatchObject({ label: 'Selected rows', count: 3 });
    expect(s.initialScope).toBe('selection');
    grid({ visibleRows: 1000, selection: { rows: 4, cols: 2, kind: 'cells' } });
    expect(scope(buildTableSource(table()), 'selection')).toMatchObject({ label: 'Selected cells', count: 4 });
  });

  it('server queries are the grid\'s WHERE / ORDER BY without the page, with the bind values', () => {
    grid({ visibleRows: 1000, selection: null });
    const params = [{ name: '1', kind: 'string' as const, value: 'a%' }];
    const s = buildTableSource(table({ where: 'name LIKE $1', params, sort: [{ column: 'at', dir: 'desc' }] }));
    expect(s.serverQuery('filtered')).toEqual({ sql: 'SELECT *\nFROM orders\nWHERE name LIKE $1\nORDER BY at DESC, id', params });
    expect(s.serverQuery('all')).toEqual({ sql: 'SELECT *\nFROM orders', params: [] });
    expect(s.serverQuery('rerun')).toBeNull();
  });
});

describe('scopes of a console result', () => {
  it('loaded rows, a re-run for every row, and the cap noted', () => {
    grid({ visibleRows: 10000, selection: null });
    const s = buildQuerySource(query());
    expect(ids(s)).toEqual(['loaded', 'rerun']);
    expect(scope(s, 'loaded').hint).toMatch(/cut at the row limit/);
    expect(scope(s, 'rerun')).toMatchObject({ count: null, disabled: null });
    expect(s.serverQuery('rerun')).toEqual({ sql: 'SELECT * FROM orders', params: [] });
  });

  it('a result that is not a single SELECT cannot be re-run; a complete result knows its count', () => {
    grid({ visibleRows: 7, selection: null });
    const s = buildQuerySource(query({ sql: null, rerunDisabled: 'Only a single SELECT statement can be run again', truncated: false, rowCount: 7 }));
    expect(scope(s, 'rerun').disabled).toMatch(/single SELECT/);
    expect(scope(s, 'rerun').count).toBe(7);
    expect(s.serverQuery('rerun')).toBeNull();
  });

  it('strips the trailing semicolon', () => {
    expect(stripTrailingSemicolon('SELECT 1 ;\n')).toBe('SELECT 1');
  });
});

describe('engine job', () => {
  const done = (exportId: string, p: Partial<Extract<WsEvent, { type: 'export.done' }>> = {}): WsEvent =>
    ({ type: 'export.done', ts: '', exportId, path: 'C:\\out\\a.csv', rows: 42, status: 'ok', error: null, ...p });

  it('sends the SELECT with its bind values and returns the engine\'s count', async () => {
    const spy = vi.spyOn(api, 'exportQuery').mockResolvedValue({ exportId: 'e1' });
    const progress = vi.fn();
    const p = runServerExport({
      sessionId: 's1', sql: 'SELECT * FROM t WHERE a = @p', params: [{ name: 'p', kind: 'int', value: 1 }], format: 'csv', path: 'C:\\out\\a.csv', options: { header: true }, onProgress: progress,
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    engineSocket.dispatch({ type: 'export.progress', ts: '', exportId: 'e1', rows: 20 });
    engineSocket.dispatch({ type: 'export.progress', ts: '', exportId: 'other', rows: 99 });
    engineSocket.dispatch(done('e1'));
    expect(await p).toMatchObject({ status: 'ok', rows: 42, error: null });
    expect(spy.mock.calls[0][0]).toMatchObject({ sessionId: 's1', params: [{ name: 'p', kind: 'int', value: 1 }], options: { header: true } });
    expect(progress).toHaveBeenCalledWith(20);
    expect(progress).not.toHaveBeenCalledWith(99);
  });

  it('a small export that ends before the response arrives is not missed', async () => {
    vi.spyOn(api, 'exportQuery').mockImplementation(async () => {
      engineSocket.dispatch({ type: 'export.progress', ts: '', exportId: 'e2', rows: 5 });
      engineSocket.dispatch(done('e2', { rows: 5 }));
      return { exportId: 'e2' };
    });
    const progress = vi.fn();
    const out = await runServerExport({ sessionId: 's1', sql: 'SELECT 1', params: [], format: 'json', path: 'C:\\o.json', options: {}, onProgress: progress });
    expect(out).toMatchObject({ status: 'ok', rows: 5 });
    expect(progress).toHaveBeenCalledWith(5);
  });

  it('cancel cancels the session\'s statement and reports the engine\'s "cancelled"', async () => {
    vi.spyOn(api, 'exportQuery').mockResolvedValue({ exportId: 'e3' });
    const cancel = vi.spyOn(api, 'cancel').mockResolvedValue({ cancelled: true });
    let stop: () => void = () => undefined;
    const p = runServerExport({ sessionId: 's9', sql: 'SELECT 1', params: [], format: 'csv', path: 'C:\\o.csv', options: {}, onStarted: (c) => { stop = c; } });
    await waitFor(() => expect(stop).not.toBe(undefined));
    await act(async () => { await Promise.resolve(); });
    stop();
    expect(cancel).toHaveBeenCalledWith('s9');
    engineSocket.dispatch(done('e3', { status: 'cancelled', rows: 7 }));
    expect(await p).toMatchObject({ status: 'cancelled', rows: 7 });
  });

  it('an engine failure comes back as an error', async () => {
    vi.spyOn(api, 'exportQuery').mockResolvedValue({ exportId: 'e4' });
    const p = runServerExport({ sessionId: 's1', sql: 'SELECT 1', params: [], format: 'csv', path: 'C:\\o.csv', options: {} });
    await waitFor(() => expect(api.exportQuery).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    engineSocket.dispatch(done('e4', { status: 'error', error: 'permission denied' }));
    expect(await p).toMatchObject({ status: 'error', error: 'permission denied' });
  });
});

describe('client-side rendering', () => {
  const rows = [[1, 'a|b', '2026-03-09T14:05:06'], [2, null, null]] as never;
  const base = { columns: COLS, rows, dialect: 'pgsql' as const, defaultTable: 'orders' };
  const text = async (format: Parameters<typeof renderClientFile>[0]['format'], s: Partial<typeof DEFAULT_SETTINGS>) => {
    const r = await renderClientFile({ ...base, format, settings: { ...DEFAULT_SETTINGS, format, ...s } });
    if (!r.ok || typeof r.content !== 'string') throw new Error('not text');
    return r.content;
  };

  it('csv: delimiter, header, NULL text, date pattern and a BOM for Excel', async () => {
    expect(await text('csv', { delimiter: ';', nullText: '-', dateFormat: 'dd/MM/yyyy HH:mm', bom: true }))
      .toBe('\uFEFFid;name;at\r\n1;a|b;09/03/2026 14:05\r\n2;-;-\r\n');
    expect(await text('csv', { header: false })).toBe('1,a|b,2026-03-09T14:05:06\r\n2,,\r\n');
  });

  it('tsv, markdown, json and sql insert follow the same options', async () => {
    expect(await text('tsv', {})).toBe('id\tname\tat\r\n1\ta|b\t2026-03-09T14:05:06\r\n2\t\t\r\n');
    expect(await text('markdown', {})).toBe('| id | name | at |\n| ---: | --- | --- |\n| 1 | a\\|b | 2026-03-09T14:05:06 |\n| 2 | NULL | NULL |\n');
    expect(JSON.parse(await text('json', { dateFormat: 'yyyy/MM/dd' }))[0].at).toBe('2026/03/09');
    const sql = await text('sql-insert', { tableName: 'dst', sqlDialect: 'mysql', dateFormat: 'dd/MM/yyyy' });
    expect(sql).toContain('INSERT INTO dst (id, name, at) VALUES (1, \'a|b\', \'2026-03-09T14:05:06\');');
  });

  it('sql insert is refused while a value is still truncated; the other formats warn', async () => {
    const trunc = [[1, { $trunc: 'abc', len: 99 }, null]] as never;
    const r = await renderClientFile({ ...base, rows: trunc, format: 'sql-insert', settings: { ...DEFAULT_SETTINGS, format: 'sql-insert' } });
    expect(r.ok).toBe(false);
    const c = await renderClientFile({ ...base, rows: trunc, format: 'csv', settings: DEFAULT_SETTINGS });
    expect(c).toMatchObject({ ok: true, warning: expect.stringMatching(/truncated/) });
  });

  it('xlsx is a workbook blob', async () => {
    const r = await renderClientFile({ ...base, format: 'xlsx', settings: { ...DEFAULT_SETTINGS, format: 'xlsx', sheetName: 'Orders' } });
    expect(r.ok && r.content instanceof Blob && r.content.size > 100).toBe(true);
  });
});

const fakePlatform = (p: Partial<Platform> = {}): Platform => ({
  kind: 'electron', appVersion: 't', hasFileSystem: true, getEngineInfo: vi.fn(), showSaveDialog: vi.fn(async () => 'C:\\out\\orders.csv'), showOpenDialog: vi.fn(),
  saveFile: vi.fn(async () => 'orders.csv'), openTextFile: vi.fn(), writeTextFile: vi.fn(async () => undefined), openExternal: vi.fn(),
  onMenuCommand: () => () => undefined, onEngineRestarted: () => () => undefined, loadWorkspace: vi.fn(), saveWorkspace: vi.fn(), setTitle: vi.fn(),
  ...p,
}) as Platform;

describe('running an export', () => {
  beforeEach(() => useUi.setState({ toasts: [] }));

  it('selection → written client-side to the chosen path', async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    grid({ visibleRows: 2, selection: { rows: 1, cols: 3, kind: 'rows' } });
    const out = await runExport({ source: buildTableSource(table()), scope: 'selection', settings: DEFAULT_SETTINGS, path: 'C:\\out\\orders' });
    expect(out).toMatchObject({ status: 'ok', rows: 1, path: 'C:\\out\\orders.csv' });
    expect(platform.writeTextFile).toHaveBeenCalledWith('C:\\out\\orders.csv', expect.stringContaining('id,name,at'));
  });

  it('browser build: the client-side scopes download the file', async () => {
    const platform = fakePlatform({ kind: 'browser', hasFileSystem: false });
    setPlatform(platform);
    grid({ visibleRows: 2, selection: null });
    const out = await runExport({ source: buildTableSource(table()), scope: 'loaded', settings: { ...DEFAULT_SETTINGS, format: 'tsv' }, path: null });
    expect(out.status).toBe('ok');
    expect(platform.saveFile).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'orders.tsv', mime: 'text/tab-separated-values' }));
  });

  it('an unchanged console result is written by the engine from its store', async () => {
    setPlatform(fakePlatform());
    grid({ visibleRows: 10, selection: null });
    const spy = vi.spyOn(api, 'exportResultSet').mockResolvedValue({ path: 'C:\\out\\r.csv', rows: 10 });
    const out = await runExport({
      source: buildQuerySource(query({ stored: { executionId: 'x1', resultSetId: 0 }, truncated: false })), scope: 'loaded',
      settings: { ...DEFAULT_SETTINGS, bom: true }, path: 'C:\\out\\r.csv',
    });
    expect(out).toMatchObject({ status: 'ok', rows: 10 });
    expect(spy).toHaveBeenCalledWith('x1', 0, { format: 'csv', path: 'C:\\out\\r.csv', options: { header: true, delimiter: ',', nullAs: '', bom: true } });
  });

  it('a server scope streams the generated SELECT on the source\'s session', async () => {
    setPlatform(fakePlatform());
    grid({ visibleRows: 10, selection: null });
    const spy = vi.spyOn(api, 'exportQuery').mockResolvedValue({ exportId: 'e9' });
    const withSession = vi.fn(async (run: (sid: string) => Promise<unknown>) => run('s7')) as unknown as TableExportContext['withSession'] & ReturnType<typeof vi.fn>;
    const p = runExport({
      source: buildTableSource(table({ where: 'id > @fp1', params: [{ name: 'fp1', kind: 'int', value: 5 }], withSession })), scope: 'filtered',
      settings: { ...DEFAULT_SETTINGS, format: 'markdown' }, path: 'C:\\out\\f.md',
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    engineSocket.dispatch({ type: 'export.done', ts: '', exportId: 'e9', path: 'C:\\out\\f.md', rows: 17, status: 'ok', error: null });
    expect(await p).toMatchObject({ status: 'ok', rows: 17 });
    expect(spy.mock.calls[0][0]).toMatchObject({
      sessionId: 's7', sql: 'SELECT *\nFROM orders\nWHERE id > @fp1\nORDER BY id', format: 'markdown', path: 'C:\\out\\f.md',
      params: [{ name: 'fp1', kind: 'int', value: 5 }], options: { nullAs: 'NULL' },
    });
    expect(withSession).toHaveBeenCalledOnce();
  });

  it('announces the end with "Open folder" and opens the file when asked', async () => {
    const revealInFolder = vi.fn(async () => undefined);
    const openPath = vi.fn(async () => undefined);
    setPlatform(fakePlatform({ revealInFolder, openPath }));
    announceOutcome({ status: 'ok', rows: 1234, path: 'C:\\out\\a.csv', warning: null, error: null }, { openAfter: true });
    const t = useUi.getState().toasts.at(-1)!;
    expect(t).toMatchObject({ kind: 'success', text: 'Exported 1,234 rows', detail: 'C:\\out\\a.csv' });
    expect(t.action?.label).toBe('Open folder');
    t.action!.run();
    expect(revealInFolder).toHaveBeenCalledWith('C:\\out\\a.csv');
    expect(openPath).toHaveBeenCalledWith('C:\\out\\a.csv');
    announceOutcome({ status: 'cancelled', rows: 0, path: null, warning: null, error: null }, { openAfter: false });
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'info', text: 'Export cancelled' });
    announceOutcome({ status: 'error', rows: 0, path: null, warning: null, error: 'boom' }, { openAfter: false });
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'error', detail: 'boom' });
  });
});

describe('ExportDialog', () => {
  beforeEach(() => {
    useUi.setState({ toasts: [] });
    try { localStorage.clear(); } catch { /* none */ }
  });

  it('lists the scopes with their counts, selects the first usable one and fills the unknown counts', async () => {
    setPlatform(fakePlatform());
    grid({ visibleRows: 1000, selection: null });
    const source = buildTableSource(table({ where: 'id > 1', filteredCount: 321 }));
    render(<ExportDialog source={source} onClose={() => undefined} />);
    expect(screen.getByTestId('ex-count-loaded').textContent).toBe('1,000 rows');
    expect(screen.getByTestId('ex-count-filtered').textContent).toBe('321 rows');
    await waitFor(() => expect(screen.getByTestId('ex-count-all').textContent).toContain('~4,800 rows'));
    expect((screen.getByRole('radio', { name: /Loaded rows/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('a disabled scope shows why and cannot be chosen', () => {
    setPlatform(fakePlatform());
    grid({ visibleRows: 1000, selection: null });
    render(<ExportDialog source={buildTableSource(table())} onClose={() => undefined} />);
    const r = screen.getByRole('radio', { name: /Current sort/ }) as HTMLInputElement;
    expect(r.disabled).toBe(true);
    expect(screen.getByTestId('ex-scope-filtered').textContent).toMatch(/No filter or sort is applied/);
  });

  it('exports the chosen scope, closes and reports', async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    grid({ visibleRows: 1, selection: null });
    const onClose = vi.fn();
    render(<ExportDialog source={buildTableSource(table())} onClose={onClose} />);
    fireEvent.change(document.getElementById('ex-path')!, { target: { value: 'C:\\out\\orders.csv' } });
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(platform.writeTextFile).toHaveBeenCalledWith('C:\\out\\orders.csv', expect.stringContaining('id,name,at'));
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: 'success', text: 'Exported 1 row' });
    expect(JSON.parse(localStorage.getItem('rowlit.export.v1')!)).toMatchObject({ format: 'csv', dir: 'C:\\out' });
  });

  it('a server scope asks for the file, shows progress, and Cancel stops the job', async () => {
    const platform = fakePlatform();
    setPlatform(platform);
    grid({ visibleRows: 1, selection: null });
    vi.spyOn(api, 'exportQuery').mockResolvedValue({ exportId: 'eD' });
    const cancel = vi.spyOn(api, 'cancel').mockResolvedValue({ cancelled: true });
    render(<ExportDialog source={buildTableSource(table())} onClose={() => undefined} />);
    fireEvent.click(screen.getByTestId('ex-scope-all').querySelector('input')!);
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    await waitFor(() => expect(platform.showSaveDialog).toHaveBeenCalled());
    const bar = await screen.findByRole('progressbar');
    await waitFor(() => expect(api.exportQuery).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    act(() => engineSocket.dispatch({ type: 'export.progress', ts: '', exportId: 'eD', rows: 2500 }));
    await waitFor(() => expect(bar.getAttribute('aria-valuetext')).toBe('2,500 rows written'));
    fireEvent.click(screen.getByRole('button', { name: /Cancel export/ }));
    expect(cancel).toHaveBeenCalledWith('s1');
    act(() => engineSocket.dispatch({ type: 'export.done', ts: '', exportId: 'eD', path: 'C:\\out\\orders.csv', rows: 2500, status: 'cancelled', error: null }));
    await waitFor(() => expect(useUi.getState().toasts.at(-1)).toMatchObject({ text: 'Export cancelled' }));
  });

  it('format options follow the format', () => {
    setPlatform(fakePlatform());
    grid({ visibleRows: 1, selection: null });
    render(<ExportDialog source={buildTableSource(table())} onClose={() => undefined} />);
    expect(screen.getByText('Delimiter')).toBeTruthy();
    expect(screen.getByText('Encoding')).toBeTruthy();
    expect(screen.queryByText('Sheet name')).toBeNull();
  });
});
