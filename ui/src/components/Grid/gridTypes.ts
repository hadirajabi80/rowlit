// Row references and the selection shape of the data grid, kept apart from DataGrid.tsx so that the result views can
// use them without pulling the grid (and the glide-data-grid library, about 100 KB gzipped) into the initial load.
import type { CellValue } from '../../api/types';
import type { PendingInsert } from '../../store/edits';

/** A row of the grid: a source row (base or appended) or a pending insert. */
export type RowRef = { src: number; ins?: undefined } | { ins: PendingInsert; src?: undefined };

export interface GridSelectionInfo {
  /** Source row (null for a pending insert). */
  sourceRow: number | null;
  insertId: string | null;
  col: number;
  /** Visible row index. */
  row: number;
}

/** Value of a row ref for consumers outside the grid (record view, viewer). */
export function rowValue(overlay: { get(i: number): readonly CellValue[] | undefined }, pendingUpdates: Record<number, Record<number, CellValue>>, r: RowRef, col: number): CellValue {
  if (r.ins) return r.ins.values[col] ?? null;
  const e = pendingUpdates[r.src];
  if (e && col in e) return e[col];
  return overlay.get(r.src)?.[col] ?? null;
}
