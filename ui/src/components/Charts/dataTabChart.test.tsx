// The Grid | Chart | Both switch on the Data tab toolbar and the two palette commands.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue, ColumnInfo, ColumnKind } from '../../api/types';
import { runCommand } from '../../commands/registry';
import { installGridMockEngine, until } from '../../mocks/m15/testServer';
import { useConnections } from '../../store/connections';
import { useSessions } from '../../store/sessions';
import type { ViewTab } from '../../store/tabs';
import { registerGridCommands } from '../DataTab/commands';
import { DataTabView } from '../DataTab/DataTabView';
import { dataGridKey } from '../DataTab/open';
import { setSqlRunner, type QueryOutcome } from '../DataTab/runner';
import type { DataGridProps } from '../Grid/DataGrid';
import { chartViewOf, registerChartExporter, useChartMode } from './chartMode';
import { registerChartCommands } from './commands';

vi.mock('../Grid/DataGrid', () => ({
  DataGrid: (p: DataGridProps) => <div data-testid="grid" data-rows={p.rows.length} />,
  rowValue: () => null,
}));

installGridMockEngine();

const col = (name: string, kind: ColumnKind, ordinal: number, isKey = false): ColumnInfo => ({
  name, ordinal, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'orders', schema: 'main', isKey,
});
const COLUMNS = [col('id', 'int', 0, true), col('status', 'string', 1), col('total', 'decimal', 2)];
const ROWS: CellValue[][] = [[1, 'open', '10.5'], [2, 'open', '4'], [3, 'paid', '20'], [4, 'void', '1']];
const outcome = (columns: ColumnInfo[], rows: CellValue[][]): QueryOutcome => ({
  executionId: 'x', status: 'ok', resultSets: [{ columns, rows, truncated: false }], affected: 0, affectedReported: false, error: null, messages: [], outParams: [], elapsedMs: 2, txOpen: false,
});
const TAB: ViewTab = { kind: 'view', id: 'dt-chart', title: 'orders', view: 'data', connectionId: 'c_shop', database: null, state: { schema: 'main', name: 'orders', type: 'table' } };
const SLOW = { timeout: 25_000 };
const T = 40_000;

beforeAll(async () => {
  registerGridCommands();
  registerChartCommands();
  await useConnections.getState().load();
  setSqlRunner(async (_sid, sql) => {
    if (sql.includes('WHERE 1 = 0')) return outcome(COLUMNS, []);
    if (sql.startsWith('SELECT COUNT(*)')) return outcome([col('row_count', 'int', 0)], [[ROWS.length]]);
    return outcome(COLUMNS, ROWS);
  });
});
afterAll(() => setSqlRunner(null));
beforeEach(() => {
  localStorage.clear();
  useSessions.setState({ sessions: {}, byTab: {} });
  act(() => useChartMode.setState({ view: {} }));
});

describe('Data tab charts', () => {
  it('charts the loaded rows, and shows grid and chart side by side on request', async () => {
    const { container } = render(<DataTabView tab={TAB} theme="light" visible />);
    await until(() => screen.queryByTestId('grid')?.getAttribute('data-rows') === '4');
    const sw = screen.getByRole('group', { name: 'Result view' });
    fireEvent.click(within(sw).getByRole('button', { name: /Chart/ }));
    expect(await screen.findByRole('group', { name: 'Chart settings' }, SLOW)).toBeInTheDocument();
    const body = container.querySelector('.resultset-body')!;
    expect(body).toHaveClass('chart-on');
    expect(body).not.toHaveClass('chart-both');

    fireEvent.click(within(sw).getByRole('button', { name: 'Grid and chart' }));
    expect(body).toHaveClass('chart-both');
    expect(screen.getByTestId('grid')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Chart settings' })).toBeInTheDocument();

    fireEvent.click(within(sw).getByRole('button', { name: 'Grid' }));
    expect(body).not.toHaveClass('chart-on');
    expect(screen.queryByRole('group', { name: 'Chart settings' })).toBeNull();
  }, T);
});

describe('chart commands', () => {
  it('results.toggleChart flips the named grid between grid and chart', async () => {
    const key = dataGridKey('dt-x');
    expect(chartViewOf(key)).toBe('grid');
    await runCommand('results.toggleChart', { gridKey: key });
    expect(chartViewOf(key)).toBe('chart');
    await runCommand('results.toggleChart', { gridKey: key });
    expect(chartViewOf(key)).toBe('grid');
  });

  it('results.exportChart is only offered while a chart is shown and calls the panel', async () => {
    const key = dataGridKey('dt-y');
    const save = vi.fn();
    const copy = vi.fn();
    const off = registerChartExporter(key, { save, copy });
    await runCommand('results.exportChart', { gridKey: key, format: 'svg' });
    expect(save).not.toHaveBeenCalled(); // grid view: the command is disabled
    act(() => useChartMode.getState().set(key, 'chart'));
    await runCommand('results.exportChart', { gridKey: key, format: 'svg' });
    expect(save).toHaveBeenCalledWith('svg');
    await runCommand('results.exportChart', { gridKey: key, format: 'copy' });
    expect(copy).toHaveBeenCalledTimes(1);
    off();
  });
});
