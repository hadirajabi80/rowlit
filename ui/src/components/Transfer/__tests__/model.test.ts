import { describe, expect, it } from 'vitest';
import type { TransferPlan } from '../../../api/types.transfer';
import {
  applyProgress, buildSpec, DEFAULT_OPTIONS, dumpPathIssue, IDLE_RUN, initialState, mappingIssues, newChoice, normalizeDumpPath, optionIssues,
  planErrors, progressPercent, setAll, setColumnType, specKey, suggestedDumpName, toggleExcluded, toggleTable, whereIssue, type RunState, type TransferState,
} from '../model';

const ctx = { sourceCid: 'src', sourceDb: 'shop', targetDb: null };

function state(p: Partial<TransferState> = {}): TransferState {
  return { ...initialState({ schema: 'dbo', tables: [{ name: 'Orders', type: 'table' }], targetKind: 'connection' }), targetCid: 'dst', ...p };
}

describe('buildSpec', () => {
  it('needs a source, a table and a target', () => {
    expect(buildSpec(state({ selected: [] }), ctx)).toBeNull();
    expect(buildSpec(state({ targetCid: '' }), ctx)).toBeNull();
    expect(buildSpec(state(), { ...ctx, sourceCid: '' })).toBeNull();
    expect(buildSpec(state({ targetKind: 'file', dumpProvider: 'postgresql', filePath: '' }), ctx)).toBeNull();
    expect(buildSpec(state({ options: { ...DEFAULT_OPTIONS, batchSize: 0 } }), ctx)).toBeNull();
  });

  it('carries the per-table choices and the options', () => {
    const orders = { ...newChoice('Orders'), targetName: ' orders_copy ', where: " status = 'open' ", columnTypes: { Note: 'text' }, excluded: ['Secret'] };
    const spec = buildSpec(state({ selected: [orders, newChoice('v_sales', 'view')], targetSchema: ' stage ', options: { ...DEFAULT_OPTIONS, dataMode: 'upsert' } }), ctx)!;
    expect(spec.source).toEqual({ connectionId: 'src', database: 'shop', schema: 'dbo' });
    expect(spec.target).toEqual({ connectionId: 'dst', database: null, schema: 'stage' });
    expect(spec.tables).toEqual([
      { name: 'Orders', schema: 'dbo', targetName: 'orders_copy', where: "status = 'open'", columnTypes: { Note: 'text' }, excludedColumns: ['Secret'] },
      { name: 'v_sales', schema: 'dbo', type: 'view' },
    ]);
    expect(spec.options?.dataMode).toBe('upsert');
    expect(specKey(spec)).toBe(JSON.stringify(spec));
  });

  it('writes a file target with the quotes of "Copy as path" removed', () => {
    const spec = buildSpec(state({ targetKind: 'file', dumpProvider: 'mysql', filePath: ' "C:\\backups\\shop dump.sql" ' }), ctx)!;
    expect(spec.target).toEqual({ filePath: 'C:\\backups\\shop dump.sql', dumpProvider: 'mysql' });
  });
});

describe('file paths', () => {
  it('normalizes and validates', () => {
    expect(normalizeDumpPath('"D:\\x.sql"')).toBe('D:\\x.sql');
    expect(dumpPathIssue('')).toMatch(/Choose/);
    expect(dumpPathIssue('C:\\backups\\')).toMatch(/folder/);
    expect(dumpPathIssue('/tmp/x.sql')).toBeNull();
    expect(suggestedDumpName('dbo', 'PostgreSQL')).toMatch(/^dbo-postgresql-\d{4}-\d\d-\d\d\.sql$/);
    expect(suggestedDumpName(null, 'SQL Server')).toMatch(/^dump-sqlserver-/);
  });
});

describe('selection and overrides', () => {
  it('ticks, unticks and ticks all without losing choices', () => {
    const a = { ...newChoice('a'), where: 'x = 1' };
    let sel = toggleTable([a], 'b', 'view');
    expect(sel.map((t) => t.name)).toEqual(['a', 'b']);
    sel = toggleTable(sel, 'a', 'table');
    expect(sel.map((t) => t.name)).toEqual(['b']);
    sel = setAll([a], [{ name: 'a', type: 'table' }, { name: 'c', type: 'table' }], true);
    expect(sel).toHaveLength(2);
    expect(sel[0].where).toBe('x = 1');
    expect(setAll(sel, [{ name: 'a', type: 'table' }], false).map((t) => t.name)).toEqual(['c']);
  });

  it('a type equal to the proposal removes the override', () => {
    let c = setColumnType(newChoice('t'), 'price', 'decimal(18,4)', 'decimal(12,2)');
    expect(c.columnTypes).toEqual({ price: 'decimal(18,4)' });
    c = setColumnType(c, 'price', 'DECIMAL(12,2)', 'decimal(12,2)');
    expect(c.columnTypes).toEqual({});
    expect(toggleExcluded(toggleExcluded(c, 'x'), 'x').excluded).toEqual([]);
  });
});

describe('validation', () => {
  it('filters are one condition', () => {
    expect(whereIssue("name = 'a;b' and x > 1")).toBeNull();
    expect(whereIssue('1=1; drop table t')).toMatch(/single condition/);
    expect(whereIssue('x = 1 -- c')).not.toBeNull();
    expect(whereIssue('x = 1 /* c */')).not.toBeNull();
  });

  it('options and duplicate target names', () => {
    expect(optionIssues(DEFAULT_OPTIONS)).toEqual([]);
    expect(optionIssues({ ...DEFAULT_OPTIONS, createMode: 'none', dataMode: 'none' })[0]).toMatch(/Nothing to do/);
    const plan = {
      tables: [
        { sourceName: 'A', targetName: 'x', targetSchema: 's', error: null },
        { sourceName: 'B', targetName: 'X', targetSchema: 's', error: 'exists' },
      ],
    } as unknown as TransferPlan;
    expect(mappingIssues(state({ plan }))[0]).toMatch(/A and B would both be written to X/);
    expect(mappingIssues(state({ selected: [{ ...newChoice('Orders'), where: 'a;b' }] }))[0]).toMatch(/^Orders:/);
    expect(planErrors(plan).map((t) => t.sourceName)).toEqual(['B']);
  });
});

describe('progress', () => {
  it('tracks the current table and the overall rows', () => {
    let run: RunState = { ...IDLE_RUN, tables: { a: { status: 'waiting' as const, rows: 0, total: null }, b: { status: 'waiting' as const, rows: 0, total: null } } };
    run = applyProgress(run, { phase: 'counting', table: null, tableIndex: 0, tableCount: 2, tableDone: 0, tableTotal: null, rowsPerSecond: 0, message: null }, { done: 0, total: null });
    run = applyProgress(run, { phase: 'data', table: 'a', tableIndex: 1, tableCount: 2, tableDone: 40, tableTotal: 50, rowsPerSecond: 400, message: null }, { done: 40, total: 150 });
    expect(run.tables.a).toEqual({ status: 'running', rows: 40, total: 50 });
    expect(run.total).toBe(150);
    run = applyProgress(run, { phase: 'structure', table: 'b', tableIndex: 2, tableCount: 2, tableDone: 0, tableTotal: 100, rowsPerSecond: 0, message: null }, { done: 50, total: null });
    expect(run.tables.a.status).toBe('done');
    expect(run.tables.b).toEqual({ status: 'running', rows: 0, total: 100 });
    expect(run.total).toBe(150);
    expect(run.done).toBe(50);
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(5, null)).toBeNull();
  });
});
