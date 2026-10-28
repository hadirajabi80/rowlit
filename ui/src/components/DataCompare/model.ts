// Pure helpers of the Data compare tab: options with defaults, side validation and endpoints, labels of the classes and
// of the sync actions per direction, and cell text of the differences grid.
import type { CellValue } from '../../api/types';
import type {
  DataCompareCounts, DataCompareOptions, DataComparePreview, DataCompareResult, DataCompareSide, DataDiffRow, DiffClass, SyncClass, SyncDirection,
} from '../../api/types.dataCompare';
import { formatCell } from '../../lib/format';
import { scopeEndpoint } from '../common/connectionScope';
import type { DataSideState } from './open';

export const DEFAULT_OPTIONS: DataCompareOptions = {
  keyColumns: null, columns: null, ignoreColumns: null, trimText: false, ignoreCase: false, emptyAsNull: false,
  numericTolerance: 0, timeToleranceMs: 0, maxDifferences: 10_000, ordering: null,
};

export const MAX_DIFFERENCES = 200_000;

/** Options from a persisted tab state (unknown keys and wrong types fall back to the defaults). */
export function withDefaults(p?: Record<string, unknown> | null): DataCompareOptions {
  const o = { ...DEFAULT_OPTIONS };
  if (!p) return o;
  const list = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  o.keyColumns = list(p.keyColumns);
  o.columns = list(p.columns);
  o.ignoreColumns = list(p.ignoreColumns);
  o.trimText = p.trimText === true;
  o.ignoreCase = p.ignoreCase === true;
  o.emptyAsNull = p.emptyAsNull === true;
  o.numericTolerance = num(p.numericTolerance, 0);
  o.timeToleranceMs = num(p.timeToleranceMs, 0);
  o.maxDifferences = Math.min(MAX_DIFFERENCES, Math.max(1, Math.round(num(p.maxDifferences, DEFAULT_OPTIONS.maxDifferences)))) || DEFAULT_OPTIONS.maxDifferences;
  o.ordering = p.ordering === 'server' || p.ordering === 'engine' || p.ordering === 'auto' ? p.ordering : null;
  return o;
}

/** The options that differ from the defaults (what the request and the tab state carry). */
export function changedOptions(o: DataCompareOptions): Partial<DataCompareOptions> {
  const out: Partial<DataCompareOptions> = {};
  for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof DataCompareOptions)[]) {
    const v = o[k];
    const d = DEFAULT_OPTIONS[k];
    if (Array.isArray(v) ? v.length > 0 : v !== d) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** The number of options the Options popover changes (its button badge). */
export function changedOptionCount(o: DataCompareOptions): number {
  const c = changedOptions(o);
  delete c.keyColumns;
  delete c.columns;
  delete c.ignoreColumns;
  return Object.keys(c).length;
}

/** What is missing on a side before it can be compared, or null. */
export function sideIssue(s: DataSideState, role: 'source' | 'target'): string | null {
  if (!s.connectionId) return `Choose the ${role} connection.`;
  if (s.mode === 'query') return s.query.trim() ? null : `Write the ${role} query.`;
  return s.table ? null : `Choose the ${role} table.`;
}

/** The engine side of a picker state (database / schema resolved like the pickers show them), or null when incomplete. */
export function sideEndpoint(s: DataSideState): DataCompareSide | null {
  if (sideIssue(s, 'source')) return null;
  const ep = scopeEndpoint(s);
  if (!ep) return null;
  const out: DataCompareSide = { connectionId: ep.connectionId, database: ep.database, schema: ep.schema };
  if (s.mode === 'query') out.query = s.query.trim();
  else {
    out.table = s.table;
    if (s.where.trim()) out.where = s.where.trim();
  }
  return out;
}

/** Why Compare is disabled, or null. */
export function validateSides(src: DataSideState, tgt: DataSideState): string | null {
  const issue = sideIssue(src, 'source') ?? sideIssue(tgt, 'target');
  if (issue) return issue;
  const a = sideEndpoint(src);
  const b = sideEndpoint(tgt);
  if (a && b && !a.query && !b.query && a.connectionId === b.connectionId && (a.database ?? '') === (b.database ?? '')
    && (a.schema ?? '').toLowerCase() === (b.schema ?? '').toLowerCase() && (a.table ?? '').toLowerCase() === (b.table ?? '').toLowerCase()
    && (a.where ?? '') === (b.where ?? '')) {
    return 'Source and target are the same table.';
  }
  return null;
}

export type GridFilter = DiffClass | 'all';

export const CLASS_LABEL: Record<DiffClass, string> = {
  changed: 'Changed', onlyInSource: 'Only in source', onlyInTarget: 'Only in target', duplicate: 'Duplicate key',
};

export function countOf(counts: DataCompareCounts, f: GridFilter): number {
  return f === 'all' ? counts.changed + counts.onlyInSource + counts.onlyInTarget + counts.duplicate : counts[f];
}

export interface SyncAction {
  cls: SyncClass;
  /** "Insert 3 rows missing from the target". */
  label: string;
  verb: 'insert' | 'update' | 'delete';
  count: number;
}

/** The three things a sync can do in a direction, with the rows each touches. */
export function syncActions(direction: SyncDirection, counts: DataCompareCounts): SyncAction[] {
  const side = direction === 'toTarget' ? 'target' : 'source';
  const rows = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'row' : 'rows'}`;
  const insertCls: SyncClass = direction === 'toTarget' ? 'onlyInSource' : 'onlyInTarget';
  const deleteCls: SyncClass = direction === 'toTarget' ? 'onlyInTarget' : 'onlyInSource';
  return [
    { cls: insertCls, verb: 'insert', count: counts[insertCls], label: `Insert ${rows(counts[insertCls])} missing from the ${side}` },
    { cls: 'changed', verb: 'update', count: counts.changed, label: `Update ${rows(counts.changed)} that differ in the ${side}` },
    { cls: deleteCls, verb: 'delete', count: counts[deleteCls], label: `Delete ${rows(counts[deleteCls])} only in the ${side}` },
  ];
}

const FORMAT = { nullText: 'NULL', dateFormat: 'iso' as const };

/** Single-line text of a cell of the differences grid. */
export function cellText(v: CellValue | undefined): string {
  return formatCell(v ?? null, undefined, FORMAT);
}

/**
 * The first rows of a grid filter from the result's sample, and whether they are the start of that filter's kept rows
 * (then "Load more" pages on from their count). The sample holds the first rows of each class, so a class filter always
 * is; "all" only when the sample holds every kept difference.
 */
export function initialRows(result: DataCompareResult, f: GridFilter): { rows: DataDiffRow[]; prefix: boolean } {
  if (f === 'all') return { rows: result.sample, prefix: result.sample.length >= result.keptDifferences };
  return { rows: result.sample.filter((r) => r.class === f), prefix: true };
}

/** Rows of a filter the engine still has (kept differences are capped). */
export function availableRows(result: DataCompareResult, f: GridFilter): number {
  return Math.min(countOf(result.counts, f), result.keptDifferences);
}

/** The values a diff row shows: the source row, else the target row. */
export function shownRow(source: CellValue[] | null, target: CellValue[] | null): CellValue[] {
  return source ?? target ?? [];
}

/** The key the comparison uses: the chosen columns, else the preview's default (primary key). */
export function effectiveKey(options: DataCompareOptions, preview: DataComparePreview | null): string[] {
  return options.keyColumns?.length ? options.keyColumns : preview?.keyColumns ?? [];
}
