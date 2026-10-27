// Test helpers: columns and row sources for chart tests.
import type { CellValue, ColumnInfo, ColumnKind } from '../../api/types';
import { ChunkedList } from '../../lib/chunked';
import { defaultSpec } from './suggest';
import type { ChartSpec, RowSource } from './types';

export function col(name: string, kind: ColumnKind, extra: Partial<ColumnInfo> = {}): ColumnInfo {
  return { name, ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: null, schema: null, isKey: false, ...extra };
}

export function cols(...defs: [string, ColumnKind][]): ColumnInfo[] {
  return defs.map(([n, k], i) => col(n, k, { ordinal: i }));
}

export const rowsOf = (rows: CellValue[][]): RowSource => ChunkedList.from(rows);

export const spec = (patch: Partial<ChartSpec>): ChartSpec => ({ ...defaultSpec(), ...patch });

/** Sales by region and month: the usual "category + date + number" shape. */
export const SALES_COLUMNS = cols(['region', 'string'], ['day', 'date'], ['amount', 'decimal'], ['qty', 'int']);
export const SALES_ROWS: CellValue[][] = [
  ['north', '2024-01-05', '10.50', 2],
  ['north', '2024-01-20', '4.50', 1],
  ['south', '2024-01-06', '7', 3],
  ['south', '2024-02-02', '12', 4],
  ['north', '2024-02-10', '20', 5],
  ['east', '2024-03-01', null, 1],
  ['east', '2024-03-15', '5', 2],
];
