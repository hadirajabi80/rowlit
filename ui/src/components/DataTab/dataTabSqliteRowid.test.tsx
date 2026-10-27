// SQLite table without a primary key (an imported CSV) in a Data tab: every page also reads rowid (hidden last column),
// the grid is editable with rowid as the row identity, and a save updates exactly that row. The canvas grid is replaced
// by a probe; the SQL runner plays the SQLite engine.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { CellValue, ColumnInfo, ColumnKind } from '../../api/types';
import { installGridMockEngine, until } from '../../mocks/m15/testServer';
import { useCatalog } from '../../store/catalog';
import { useConnections } from '../../store/connections';
import { useEdits } from '../../store/edits';
import { useSessions } from '../../store/sessions';
import type { ViewTab } from '../../store/tabs';
import type { DataGridProps } from '../Grid/DataGrid';
import { DataTabView } from './DataTabView';
import { dataGridKey } from './open';
import { setSqlRunner, type QueryOutcome } from './runner';

let gridProps: DataGridProps | null = null;
vi.mock('../Grid/DataGrid', () => ({
  DataGrid: (p: DataGridProps) => {
    gridProps = p;
    return <div data-testid="grid" data-rows={p.rows.length} />;
  },
  rowValue: () => null,
}));

installGridMockEngine();

const col = (name: string, kind: ColumnKind, ordinal: number, dbType = kind.toUpperCase()): ColumnInfo => ({
  name, ordinal, dbType, kind, nullable: true, size: null, precision: null, scale: null, table: 'people', schema: 'main', isKey: false,
});
const OWN = [col('id', 'int', 0, 'INTEGER'), col('name', 'string', 1, 'TEXT')];
const WITH_ROWID = [...OWN, col('rowid', 'int', 2, 'INTEGER')];
// Two identical rows: only rowid tells them apart.
const ROWS: CellValue[][] = [[1, 'x', 1], [1, 'x', 2]];

const calls: { sql: string; params: unknown[] }[] = [];
let refuseRowid = false;
/** The table has a column of its own named rowid (it shadows the pseudo-column). */
let ownRowidColumn = false;

function outcome(cols: ColumnInfo[], rows: CellValue[][], extra: Partial<QueryOutcome> = {}): QueryOutcome {
  return { executionId: 'x', status: 'ok', resultSets: cols.length ? [{ columns: cols, rows, truncated: false }] : [], affected: 0, affectedReported: false, error: null, messages: [], outParams: [], elapsedMs: 1, txOpen: false, ...extra };
}

beforeAll(async () => {
  await useConnections.getState().load();
  setSqlRunner(async (_sid, sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('WHERE 1 = 0')) return outcome(ownRowidColumn ? [col('rowid', 'int', 0), OWN[1]] : OWN, []);
    if (sql.startsWith('SELECT COUNT(*)')) return outcome([col('row_count', 'int', 0)], [[2]]);
    if (sql.startsWith('UPDATE')) return outcome([], [], { affected: 1, affectedReported: true, txOpen: false });
    if (sql.startsWith('SELECT *, rowid') && sql.includes('WHERE rowid')) return outcome(WITH_ROWID, [[1, 'y', 2]]);
    if (sql.startsWith('SELECT *, rowid')) {
      if (refuseRowid) return outcome([], [], { status: 'error', error: { message: 'no such column: rowid', code: 'SQLITE_ERROR', line: 1 } });
      return outcome(WITH_ROWID, ROWS);
    }
    if (sql.startsWith('SELECT *')) return outcome(ownRowidColumn ? [col('rowid', 'int', 0), OWN[1]] : OWN, ROWS.map((r) => r.slice(0, 2)));
    return outcome([], []);
  });
});
afterAll(() => setSqlRunner(null));
beforeEach(() => {
  cleanup();
  calls.length = 0;
  gridProps = null;
  refuseRowid = false;
  ownRowidColumn = false;
  useSessions.setState({ sessions: {}, byTab: {} });
  // people is not in the mock catalog: no primary key is known.
  useCatalog.setState({ dbs: {} });
  vi.spyOn(api, 'catalog').mockRejectedValue(new Error('catalog unavailable'));
  vi.spyOn(api, 'objectDetails').mockResolvedValue({ indexes: [] } as never);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const tab = (id: string): ViewTab => ({
  kind: 'view', id, title: 'people', view: 'data', connectionId: 'c_shop', database: null, state: { schema: 'main', name: 'people', type: 'table' },
});
const pages = () => calls.map((c) => c.sql).filter((s) => s.includes('LIMIT'));

describe('SQLite keyless table: rowid row identity', () => {
  it('reads rowid as a hidden column, is editable, and saves one of two identical rows by its rowid', async () => {
    render(<DataTabView tab={tab('lite-rowid')} theme="light" visible />);
    await until(() => gridProps?.rows.length === 2);
    expect(pages()[0]).toBe('SELECT *, rowid\nFROM people\nORDER BY rowid\nLIMIT 1000 OFFSET 0');
    // The grid shows the table's own columns only; the rows still carry the rowid for the edit statements.
    expect(gridProps!.columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(gridProps!.editability?.editable).toBe(true);
    expect(gridProps!.editability?.target?.keyColumns).toEqual(['rowid']);
    expect([...gridProps!.editability!.editableColumns]).toEqual([0, 1]);
    expect(screen.getByText('Editable')).toBeInTheDocument();

    const key = dataGridKey('lite-rowid');
    act(() => useEdits.getState().setCell(key, 1, 1, 'y', 'x'));
    await act(async () => {
      gridProps!.onSubmit!();
    });
    await until(() => calls.some((c) => c.sql.startsWith('UPDATE')));
    const upd = calls.find((c) => c.sql.startsWith('UPDATE'))!;
    expect(upd.sql).toContain('SET name = ');
    expect(upd.sql).toContain('WHERE rowid = ');
    expect(upd.params).toContainEqual(expect.objectContaining({ kind: 'int', value: 2 }));
    // The saved row is read back by rowid too.
    await until(() => calls.some((c) => c.sql.startsWith('SELECT *, rowid') && c.sql.includes('WHERE rowid')));
  });

  it('an object that cannot give a rowid (WITHOUT ROWID) is read without it, read-only', async () => {
    refuseRowid = true;
    render(<DataTabView tab={tab('lite-norowid')} theme="light" visible />);
    await until(() => gridProps?.rows.length === 2);
    expect(pages()).toEqual([
      'SELECT *, rowid\nFROM people\nORDER BY rowid\nLIMIT 1000 OFFSET 0',
      'SELECT *\nFROM people\nORDER BY rowid\nLIMIT 1000 OFFSET 0',
    ]);
    expect(gridProps!.editability?.editable).toBe(false);
    expect(screen.getByText('No primary key: read-only')).toBeInTheDocument();
  });

  it('a column of the table named rowid shadows the pseudo-column: no hidden read, read-only', async () => {
    ownRowidColumn = true;
    render(<DataTabView tab={tab('lite-ownrowid')} theme="light" visible />);
    await until(() => gridProps?.rows.length === 2);
    expect(pages().every((s) => s.startsWith('SELECT *\n'))).toBe(true);
    expect(gridProps!.editability?.editable).toBe(false);
  });
});
