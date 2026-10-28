// Pinned results in the results pane: the pin button of a result tab, the pinned tab surviving the next run, unpinning,
// and "Compare with…" opening a comparison tab.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellValue, ColumnInfo, ColumnKind } from '../../../api/types';
import { getCommand } from '../../../commands/registry';
import { ChunkedList } from '../../../lib/chunked';
import { installGridMockEngine } from '../../../mocks/m15/testServer';
import { useConnections } from '../../../store/connections';
import { useResults } from '../../../store/results';
import { createExecution, type ExecutionState } from '../../../store/resultsReducer';
import { useTabs } from '../../../store/tabs';
import { MenuHost } from '../../common/Menu';
import { registerGridCommands } from '../../DataTab/commands';
import type { DataGridProps } from '../../Grid/DataGrid';
import { ResultsPane } from '../../ResultsPane/ResultsPane';
import { registerResultsCompareCommands } from '../commands';
import { COMPARE_VIEW } from '../open';
import { clearComparisons, getComparison } from '../sources';

vi.mock('../../Grid/DataGrid', () => ({
  DataGrid: (p: DataGridProps) => <div data-testid="grid" data-rows={p.rows.length} data-editable={p.editability?.editable ? 'yes' : 'no'} />,
  rowValue: () => null,
}));

installGridMockEngine();

const col = (name: string, kind: ColumnKind, ordinal: number): ColumnInfo => ({
  name, ordinal, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'customers', schema: 'main', isKey: ordinal === 0,
});
const COLUMNS = [col('id', 'int', 0), col('name', 'string', 1)];

let tabId = '';
let runNo = 0;
function run(rows: CellValue[][], opts: { sql?: string; sets?: number } = {}): ExecutionState {
  const localId = `L${++runNo}`;
  const sets = opts.sets ?? 1;
  const exec: ExecutionState = {
    ...createExecution({ localId, tabId, connectionId: 'c_shop', sessionId: null, label: 'statement', batches: [{ sql: opts.sql ?? 'SELECT * FROM customers', line: 1, col: 1 }], maxRows: 1000 }),
    executionId: `x${runNo}`, status: 'ok', endedAt: Date.now(), elapsedMs: 3,
    resultSets: Array.from({ length: sets }, (_, id) => ({
      id, batchIndex: 0, columns: COLUMNS, rows: ChunkedList.from(rows), rowCount: rows.length, truncated: false, elapsedMs: 3, done: true, rev: 1,
    })),
  };
  act(() => useResults.getState().begin(exec));
  act(() => useResults.getState().setActiveView(tabId, 0));
  return exec;
}

const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\s+/g, ' ').trim());

beforeAll(async () => {
  registerGridCommands();
  registerResultsCompareCommands();
  await useConnections.getState().load();
});
beforeEach(() => {
  clearComparisons();
  runNo = 0;
  act(() => {
    useTabs.setState({ tabs: [], activeId: null });
    useResults.setState({ executions: {}, byTab: {}, activeView: {}, views: {}, pinned: {} });
  });
  tabId = useTabs.getState().newConsole({ connectionId: 'c_shop' });
});

function show() {
  return render(<><ResultsPane tabId={tabId} dialect="sqlite" theme="light" /><MenuHost /></>);
}

describe('pinning a result', () => {
  it('every finished result tab has a pin button; pinning turns the tab into a pinned one', () => {
    run([[1, 'Ada'], [2, 'Grace']]);
    show();
    expect(tabs()).toEqual(['Result 12', 'Messages']);
    fireEvent.click(screen.getByRole('button', { name: 'Pin Result 1' }));
    // the pinned copy stands in for the result it came from, named after its table
    expect(tabs()).toEqual(['customers2', 'Messages']);
    expect(screen.getByRole('tab', { name: /customers/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Unpin customers' })).toBeInTheDocument();
    expect(screen.getByText('Pinned', { selector: '.rs-badge' })).toBeInTheDocument();
    expect(screen.getByTestId('grid')).toHaveAttribute('data-rows', '2');
  });

  it('a pinned result is read-only and has no server filter', () => {
    run([[1, 'Ada']]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Pin Result 1' }));
    expect(screen.getByTestId('grid')).toHaveAttribute('data-editable', 'no');
    expect(screen.queryByText('Editable')).toBeNull();
  });

  it('the next run lands next to the pinned result instead of replacing it', () => {
    run([[1, 'Ada'], [2, 'Grace']]);
    const { rerender } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Pin Result 1' }));
    run([[7, 'Linus']]);
    rerender(<><ResultsPane tabId={tabId} dialect="sqlite" theme="light" /><MenuHost /></>);
    expect(tabs()).toEqual(['customers2', 'Result 11', 'Messages']);
    // Result 1 of the new run is shown normally; the pinned one still has its 2 rows
    fireEvent.click(screen.getByRole('tab', { name: /^Result 1/ }));
    expect(screen.getByTestId('grid')).toHaveAttribute('data-rows', '1');
    fireEvent.click(screen.getByRole('tab', { name: /customers/ }));
    expect(screen.getByTestId('grid')).toHaveAttribute('data-rows', '2');
  });

  it('unpinning gives the result tab back while its run is shown, and drops the copy once the run is gone', () => {
    run([[1, 'Ada']]);
    const { rerender } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Pin Result 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unpin customers' }));
    expect(tabs()).toEqual(['Result 11', 'Messages']);
    expect(useResults.getState().pinned[tabId]).toBeUndefined();
    // pin again, run again, unpin: the pinned copy simply goes away
    fireEvent.click(screen.getByRole('button', { name: 'Pin Result 1' }));
    run([[2, 'Grace']]);
    rerender(<><ResultsPane tabId={tabId} dialect="sqlite" theme="light" /><MenuHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Unpin customers' }));
    expect(tabs()).toEqual(['Result 11', 'Messages']);
  });

  it('a result that is still loading cannot be pinned', () => {
    const e = run([[1, 'Ada']]);
    act(() => useResults.setState({ executions: { [e.localId]: { ...e, resultSets: [{ ...e.resultSets[0], done: false }] } } }));
    show();
    expect(screen.getByRole('button', { name: 'Pin Result 1' })).toBeDisabled();
  });

  it('the results.pin command pins what the pane shows and unpins it again', () => {
    run([[1, 'Ada']]);
    show();
    const cmd = getCommand('results.pin')!;
    expect(cmd.shortcut).toBe('Mod+Alt+K');
    expect(cmd.when?.({ tabId } as never)).toBe(true);
    act(() => void cmd.run({ tabId } as never));
    expect(useResults.getState().pinned[tabId]).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Unpin customers' })).toBeInTheDocument();
    act(() => void cmd.run({ tabId } as never));
    expect(useResults.getState().pinned[tabId]).toBeUndefined();
  });

  it('pinned results of a console that closes go with it', () => {
    run([[1, 'Ada']]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Pin Result 1' }));
    act(() => useTabs.getState().close(tabId));
    expect(useResults.getState().pinned[tabId]).toBeUndefined();
  });
});

describe('Compare with…', () => {
  it('lists the other result sets of the run and the pinned results, and opens a comparison tab', async () => {
    run([[1, 'Ada'], [2, 'Grace']]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Pin Result 1' }));
    run([[1, 'Ada'], [2, 'Grayce']], { sets: 2 });
    act(() => useResults.getState().setActiveView(tabId, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Compare with…' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Result sets of this run')).toBeInTheDocument();
    expect(within(menu).getByText(/^Result 2/)).toBeInTheDocument();
    expect(within(menu).getByText('Pinned results')).toBeInTheDocument();
    fireEvent.click(within(menu).getByText(/^customers\s+·/));
    const tab = useTabs.getState().tabs.find((t) => t.kind === 'view' && t.view === COMPARE_VIEW);
    expect(tab).toBeDefined();
    const id = (tab as { state: { compareId: string } }).state.compareId;
    const cmp = getComparison(id)!;
    // the chosen result is the baseline (A), the shown one is B
    expect(cmp.left.title).toBe('customers');
    expect(cmp.left.rows.length).toBe(2);
    expect(cmp.right.title).toBe('Result 1');
  });

  it('with nothing to compare it says how to get something', async () => {
    run([[1, 'Ada']]);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Compare with…' }));
    expect(within(await screen.findByRole('menu')).getByText(/Nothing to compare with yet/)).toBeInTheDocument();
  });
});
