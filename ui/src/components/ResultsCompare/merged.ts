// The diff as one grid: a Status column, then the merged columns. A changed row becomes two lines, "Changed (before)"
// with the left values and "Changed (after)" with the right ones, the differing cells tinted on both.
import type { CellValue, ColumnInfo } from '../../api/types';
import { serializeRows } from '../../lib/serialize';
import type { DiffResult, RowSource, RowStatus } from './diff';

/** A result set as the merge reads it. */
export interface SetLike {
  columns: readonly ColumnInfo[];
  rows: RowSource;
}

export type LineKind = 'same' | 'added' | 'removed' | 'before' | 'after';

/** Cell tint of the grid: `added` (green), `removed` (red), `changed` (amber: the Status cell of a changed pair). */
export type CellTint = 'added' | 'removed' | 'changed';

export interface LineMeta {
  kind: LineKind;
  /** Grid columns (1-based: the Status column is 0) whose value differs; only on before / after lines. */
  changed: ReadonlySet<number> | null;
  /** The diff row this line belongs to. */
  diffRow: number;
}

export interface MergedGrid {
  columns: ColumnInfo[];
  rows: CellValue[][];
  meta: LineMeta[];
}

export const STATUS_LABEL: Record<LineKind, string> = {
  same: 'Same', added: 'Added', removed: 'Removed', before: 'Changed (before)', after: 'Changed (after)',
};

const statusColumn: ColumnInfo = {
  name: 'Status', ordinal: 0, dbType: 'diff', kind: 'string', nullable: false, size: null, precision: null, scale: null,
  table: null, schema: null, isKey: false,
};

export interface MergeOptions {
  /** Leave out the rows that are the same on both sides. */
  differencesOnly: boolean;
  /** Only these statuses (undefined: all). */
  statuses?: ReadonlySet<RowStatus>;
}

export function buildMerged(diff: DiffResult, left: SetLike, right: SetLike, opts: MergeOptions): MergedGrid {
  const columns: ColumnInfo[] = [statusColumn];
  diff.columns.forEach((m, i) => {
    const src = m.left !== null ? left.columns[m.left] : right.columns[m.right!];
    columns.push({ ...src, ordinal: i + 1, table: null, schema: null, isKey: m.key });
  });
  const rows: CellValue[][] = [];
  const meta: LineMeta[] = [];
  const line = (kind: LineKind, side: 'left' | 'right', idx: number, diffRow: number, changed: ReadonlySet<number> | null) => {
    const src = (side === 'left' ? left : right).rows.get(idx) ?? [];
    const out: CellValue[] = [STATUS_LABEL[kind]];
    for (const m of diff.columns) {
      const at = side === 'left' ? m.left : m.right;
      out.push(at === null ? null : (src[at] ?? null));
    }
    rows.push(out);
    meta.push({ kind, changed, diffRow });
  };
  diff.rows.forEach((r, n) => {
    if (opts.differencesOnly && r.status === 'same') return;
    if (opts.statuses && !opts.statuses.has(r.status)) return;
    switch (r.status) {
      case 'same': line('same', 'left', r.left!, n, null); break;
      case 'added': line('added', 'right', r.right!, n, null); break;
      case 'removed': line('removed', 'left', r.left!, n, null); break;
      case 'changed': {
        const cols = new Set<number>(r.changed.map((i) => i + 1));
        line('before', 'left', r.left!, n, cols);
        line('after', 'right', r.right!, n, cols);
        break;
      }
    }
  });
  return { columns, rows, meta };
}

/** Tint of one grid cell. */
export function tintOf(m: LineMeta | undefined, col: number): CellTint | null {
  if (!m) return null;
  switch (m.kind) {
    case 'added': return 'added';
    case 'removed': return 'removed';
    // the pair of lines of a changed row: amber Status, red old / green new values
    case 'before': return col === 0 ? 'changed' : m.changed?.has(col) ? 'removed' : null;
    case 'after': return col === 0 ? 'changed' : m.changed?.has(col) ? 'added' : null;
    default: return null;
  }
}

export type DiffExportFormat = 'csv' | 'markdown';

/** The diff as CSV / Markdown: the lines of the shown grid, Status first. */
export function exportDiff(grid: MergedGrid, format: DiffExportFormat): string {
  return serializeRows(format === 'csv' ? 'csv' : 'markdown', grid.columns, grid.rows, { header: true });
}

/** One-line summary: "3 added, 1 removed, 2 changed, 40 same". */
export function summaryText(c: DiffResult['counts']): string {
  const parts: string[] = [];
  if (c.added) parts.push(`${c.added} added`);
  if (c.removed) parts.push(`${c.removed} removed`);
  if (c.changed) parts.push(`${c.changed} changed`);
  parts.push(`${c.same} same`);
  return parts.join(', ');
}
