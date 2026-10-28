import { beforeEach, describe, expect, it } from 'vitest';
import type { CellValue, ColumnInfo } from '../api/types';
import { ChunkedList } from '../lib/chunked';
import { useResults } from './results';
import { createExecution, isPinnedExec, pinBlocker, pinResultSet, type ExecutionState, type ResultSetState } from './resultsReducer';

const col = (name: string, table: string | null = 'orders'): ColumnInfo => ({
  name, ordinal: 0, dbType: 'int', kind: 'int', nullable: true, size: null, precision: null, scale: null, table, schema: 'main', isKey: false,
});
const rs = (id: number, rows: CellValue[][], extra: Partial<ResultSetState> = {}, table: string | null = 'orders'): ResultSetState => ({
  id, batchIndex: 0, columns: [col('id', table)], rows: ChunkedList.from(rows), rowCount: rows.length, truncated: false, elapsedMs: 1, done: true, rev: 1, ...extra,
});
function exec(localId: string, sets: ResultSetState[]): ExecutionState {
  return {
    ...createExecution({ localId, tabId: 'tab1', connectionId: 'c1', sessionId: null, label: 'statement', batches: [{ sql: 'SELECT id FROM orders', line: 1, col: 1 }], maxRows: 100 }),
    executionId: `x-${localId}`, status: 'ok', resultSets: sets,
  };
}

beforeEach(() => useResults.setState({ executions: {}, byTab: {}, activeView: {}, views: {}, pinned: {} }));

describe('pinResultSet', () => {
  it('copies a finished result set into an execution of its own', () => {
    const e = exec('L1', [rs(0, [[1], [2]])]);
    const p = pinResultSet(e, 0, '7', []);
    expect(p.title).toBe('orders');
    expect(p.origin).toEqual({ localId: 'L1', rsId: 0 });
    expect(isPinnedExec(p.exec)).toBe(true);
    expect(isPinnedExec(e)).toBe(false);
    expect(p.exec.executionId).toBeNull();
    expect(p.exec.resultSets).toHaveLength(1);
    expect(p.exec.resultSets[0].rows.length).toBe(2);
  });

  it('titles a result without a source table "Result n" and keeps titles unique', () => {
    const e = exec('L1', [rs(0, [[1]], {}, null), rs(1, [[2]], {}, null)]);
    expect(pinResultSet(e, 1, '1', []).title).toBe('Result 2');
    expect(pinResultSet(e, 1, '2', ['Result 2']).title).toBe('Result 2 (2)');
    expect(pinResultSet(e, 1, '3', ['Result 2', 'Result 2 (2)']).title).toBe('Result 2 (3)');
  });

  it('refuses unfinished, released and column-less results', () => {
    const e = exec('L1', [rs(0, [[1]], { done: false }), rs(1, [[1]], { released: { kept: 1, total: 9, at: 0, reason: 'idle' } }), rs(2, [], { columns: [] })]);
    expect(pinBlocker(e, 0)).toMatch(/finish/);
    expect(pinBlocker(e, 1)).toMatch(/Reload/);
    expect(pinBlocker(e, 2)).toMatch(/no columns/);
    expect(pinBlocker(e, 9)).toMatch(/no result/);
    expect(pinBlocker(undefined, 0)).toMatch(/no result/);
  });
});

describe('pinned results in the store', () => {
  const run = (localId: string, rows: CellValue[][]) => {
    useResults.getState().begin(exec(localId, [rs(0, rows)]));
  };

  it('a pinned result stays when the console runs again, the new run lands next to it', () => {
    run('L1', [[1], [2]]);
    const out = useResults.getState().pin('tab1', 0);
    expect('pin' in out).toBe(true);
    run('L2', [[3]]);
    const s = useResults.getState();
    expect(s.executions['L1']).toBeUndefined();
    expect(s.pinned['tab1']).toHaveLength(1);
    expect(s.pinned['tab1'][0].exec.resultSets[0].rows.get(1)).toEqual([2]);
    expect(s.executions['L2'].resultSets[0].rows.get(0)).toEqual([3]);
    // the run starts on Messages; the pin is still there
    expect(s.activeView['tab1']).toBe('messages');
  });

  it('pinning selects the pinned tab and pinning twice returns the same pin', () => {
    run('L1', [[1]]);
    const a = useResults.getState().pin('tab1', 0);
    const b = useResults.getState().pin('tab1', 0);
    if (!('pin' in a) || !('pin' in b)) throw new Error('not pinned');
    expect(b.pin.id).toBe(a.pin.id);
    expect(useResults.getState().pinned['tab1']).toHaveLength(1);
    expect(useResults.getState().activeView['tab1']).toBe(`pin:${a.pin.id}`);
  });

  it('several pins of one console get distinct titles', () => {
    run('L1', [[1]]);
    useResults.getState().pin('tab1', 0);
    run('L2', [[1], [2]]);
    useResults.getState().pin('tab1', 0);
    expect(useResults.getState().pinned['tab1'].map((p) => p.title)).toEqual(['orders', 'orders (2)']);
  });

  it('reports why a result cannot be pinned', () => {
    useResults.getState().begin(exec('L1', [rs(0, [[1]], { done: false })]));
    const out = useResults.getState().pin('tab1', 0);
    expect('error' in out && out.error).toMatch(/finish/);
    expect(useResults.getState().pinned['tab1']).toBeUndefined();
  });

  it('unpin removes the pin, its grid view, and falls back to Messages', () => {
    run('L1', [[1]]);
    const out = useResults.getState().pin('tab1', 0);
    if (!('pin' in out)) throw new Error('not pinned');
    useResults.getState().setGridView(`pin-${out.pin.id}:0`, { quickFilter: 'x' });
    useResults.getState().unpin('tab1', out.pin.id);
    const s = useResults.getState();
    expect(s.pinned['tab1']).toBeUndefined();
    expect(Object.keys(s.views).some((k) => k.startsWith('pin-'))).toBe(false);
    expect(s.activeView['tab1']).toBe('messages');
  });

  it('clearTab keeps pins (data, not a session); dropPins removes them', () => {
    run('L1', [[1]]);
    useResults.getState().pin('tab1', 0);
    useResults.getState().clearTab('tab1');
    expect(useResults.getState().pinned['tab1']).toHaveLength(1);
    useResults.getState().dropPins('tab1');
    expect(useResults.getState().pinned['tab1']).toBeUndefined();
  });
});
