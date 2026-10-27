// The Grid | Chart switch in the result set toolbar (also used by the routine run page through ResultSetView).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue, ColumnInfo, ColumnKind } from '../../api/types';
import { ChunkedList } from '../../lib/chunked';
import { installGridMockEngine } from '../../mocks/m15/testServer';
import { useConnections } from '../../store/connections';
import { useResults } from '../../store/results';
import { createExecution, type ExecutionState } from '../../store/resultsReducer';
import { registerGridCommands } from '../DataTab/commands';
import type { DataGridProps } from '../Grid/DataGrid';
import { MenuHost } from '../common/Menu';
import { ResultSetView, ResultsPane } from '../ResultsPane/ResultsPane';
import { useChartMode } from './chartMode';
import { hashQuery } from './settings';

vi.mock('../Grid/DataGrid', () => ({
  DataGrid: (p: DataGridProps) => <div data-testid="grid" data-rows={p.rows.length} />,
  rowValue: () => null,
}));

installGridMockEngine();

const col = (name: string, kind: ColumnKind, ordinal: number): ColumnInfo => ({
  name, ordinal, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'orders', schema: 'main', isKey: false,
});
const COLUMNS = [col('status', 'string', 0), col('total', 'decimal', 1)];
const ROWS: CellValue[][] = [['open', '10.5'], ['open', '4'], ['paid', '20'], ['void', '1']];
const SQL = 'SELECT status, total FROM orders';

function execOf(): ExecutionState {
  return {
    ...createExecution({ localId: 'L1', tabId: 'console-1', connectionId: 'c_shop', sessionId: null, label: 'statement', batches: [{ sql: SQL, line: 1, col: 1 }], maxRows: 1000 }),
    executionId: 'x1', status: 'ok', endedAt: Date.now(), elapsedMs: 3,
    resultSets: [{ id: 0, batchIndex: 0, columns: COLUMNS, rows: ChunkedList.from(ROWS), rowCount: 4, truncated: false, elapsedMs: 3, done: true, rev: 1 }],
  };
}

// the first chart of a run loads the lazy chunk (a cold transform on a busy machine can take a while)
const SLOW = { timeout: 25_000 };
const T = 40_000;

beforeAll(async () => {
  registerGridCommands();
  await useConnections.getState().load();
});
beforeEach(() => {
  localStorage.clear();
  act(() => useChartMode.setState({ on: {} }));
});

function show() {
  act(() => useResults.setState({ executions: { L1: execOf() }, byTab: { 'console-1': 'L1' }, activeView: { 'console-1': 0 }, views: {} }));
  return render(<><ResultsPane tabId="console-1" dialect="sqlite" theme="light" /><MenuHost /></>);
}

describe('Grid | Chart switch', () => {
  it('shows the grid by default and loads the chart on demand', async () => {
    const { container } = show();
    const toolbar = screen.getByRole('toolbar', { name: 'Result set toolbar' });
    const sw = within(toolbar).getByRole('group', { name: 'Result view' });
    expect(within(sw).getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('grid')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Chart settings' })).toBeNull();

    fireEvent.click(within(sw).getByRole('button', { name: /Chart/ }));
    expect(await screen.findByRole('group', { name: 'Chart settings' }, SLOW)).toBeInTheDocument();
    // category + number -> bar of the summed totals
    expect(await screen.findByRole('group', { name: /^Bar chart of sum\(total\) by status/ })).toBeInTheDocument();
    expect(container.querySelector('.resultset-body')).toHaveClass('chart-on');
    expect(within(sw).getByRole('button', { name: /Chart/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(sw).getByRole('button', { name: 'Grid' }));
    expect(container.querySelector('.resultset-body')).not.toHaveClass('chart-on');
    expect(screen.queryByRole('group', { name: 'Chart settings' })).toBeNull();
  }, T);

  it('remembers the chart settings of this query for next time', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /Chart/ }));
    await screen.findByRole('group', { name: 'Chart settings' }, SLOW);
    fireEvent.click(screen.getByRole('combobox', { name: 'Chart type' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Donut' }));
    await waitFor(() => expect(localStorage.getItem(`rowlit.chart.v1.${hashQuery(SQL)}`)).toContain('"donut"'));
  }, T);

  it('works in a result set shown outside the console (routine run page)', async () => {
    const exec = execOf();
    render(<ResultSetView exec={exec} rs={exec.resultSets[0]} dialect="sqlite" theme="dark" />);
    fireEvent.click(screen.getByRole('button', { name: /Chart/ }));
    expect(await screen.findByRole('group', { name: /^Bar chart/ }, SLOW)).toBeInTheDocument();
  }, T);
});
