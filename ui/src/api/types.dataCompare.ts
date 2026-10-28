// Wire contracts of Data compare & sync (mirror of engine/src/DbStudio.Core/DataCompare/DataCompareModels.cs).
// Rows of two tables (or queries) are matched on key columns; the sync script makes the target like the source (or the
// source like the target): onlyInSource → INSERT, changed → UPDATE, onlyInTarget → DELETE.
import type { CellValue } from './types';

/** One side: a table (or a query, compared but never written), optionally filtered by `where` (SQL of that side). */
export interface DataCompareSide {
  connectionId: string;
  database?: string | null;
  schema?: string | null;
  table?: string | null;
  query?: string | null;
  where?: string | null;
}

export type DataOrdering = 'auto' | 'server' | 'engine';

export interface DataCompareOptions {
  /** Null: the primary key (source first, else target). */
  keyColumns: string[] | null;
  /** Null: every column both sides have (computed / rowversion excluded). */
  columns: string[] | null;
  ignoreColumns: string[] | null;
  trimText: boolean;
  ignoreCase: boolean;
  emptyAsNull: boolean;
  numericTolerance: number;
  timeToleranceMs: number;
  maxDifferences: number;
  ordering: DataOrdering | null;
}

export interface DataCompareRequest {
  source: DataCompareSide;
  target: DataCompareSide;
  options?: Partial<DataCompareOptions>;
}

export type DiffClass = 'changed' | 'onlyInSource' | 'onlyInTarget' | 'duplicate';
export type SyncClass = Exclude<DiffClass, 'duplicate'>;
export type SyncDirection = 'toTarget' | 'toSource';

export type ValueFamily = 'numeric' | 'float' | 'bool' | 'temporal' | 'text' | 'guid' | 'binary' | 'json';

export interface DataCompareColumnInfo {
  name: string;
  sourceName: string | null;
  targetName: string | null;
  sourceType: string | null;
  targetType: string | null;
  sourceKey: boolean;
  targetKey: boolean;
  kind: ValueFamily;
  /** Both sides have it and it is compared by default. */
  comparable: boolean;
  note: string | null;
}

export interface DataSyncSupport {
  toTarget: boolean;
  toSource: boolean;
  toTargetReason: string | null;
  toSourceReason: string | null;
  applyToTarget: boolean;
  applyToSource: boolean;
}

export interface DataComparePreview {
  columns: DataCompareColumnInfo[];
  /** Default key (empty: neither side has a primary key). */
  keyColumns: string[];
  sourceDialect: string;
  targetDialect: string;
  sourceLabel: string;
  targetLabel: string;
  sync: DataSyncSupport;
  notes: string[];
}

export interface DataCompareCounts {
  equal: number;
  changed: number;
  onlyInSource: number;
  onlyInTarget: number;
  duplicate: number;
}

export interface DataCompareColumn {
  name: string;
  sourceType: string | null;
  targetType: string | null;
  isKey: boolean;
  compared: boolean;
  kind: ValueFamily;
}

/** One difference; `source` / `target` follow `columns`, null on the side without the row. */
export interface DataDiffRow {
  class: DiffClass;
  source: CellValue[] | null;
  target: CellValue[] | null;
  /** Column indexes whose values differ (changed rows). */
  changed: number[] | null;
}

export interface DataCompareResult {
  compareId: string;
  counts: DataCompareCounts;
  columns: DataCompareColumn[];
  keyColumns: string[];
  sample: DataDiffRow[];
  keptDifferences: number;
  truncatedDiffs: boolean;
  ordering: 'server' | 'engine';
  sourceRows: number;
  targetRows: number;
  sourceLabel: string;
  targetLabel: string;
  sourceDialect: string;
  targetDialect: string;
  sync: DataSyncSupport;
  notes: string[];
  elapsedMs: number;
}

export interface DataDiffPage {
  class: DiffClass | null;
  offset: number;
  total: number;
  rows: DataDiffRow[];
}

/** JSON in the `message` of `data.compare` job.progress events. */
export interface DataCompareProgress {
  phase: 'preparing' | 'reading' | 'sorting' | 'comparing' | 'done';
  sourceRows: number;
  targetRows: number;
  differences: number;
  message: string | null;
}

export interface DataSyncRequest {
  classes?: SyncClass[];
  direction?: SyncDirection;
}

export interface DataApplyRequest extends DataSyncRequest {
  transactional?: boolean;
}

export interface DataSyncScript {
  text: string;
  statements: number;
  inserts: number;
  updates: number;
  deletes: number;
  warnings: string[];
  direction: SyncDirection;
  /** The connection the script changes. */
  connectionId: string;
  database: string | null;
  dialect: string;
  truncated: boolean;
}

export interface DataApplyFailure {
  index: number;
  sql: string;
  message: string;
}

export interface DataApplyResult {
  status: 'ok' | 'error' | 'partial';
  executed: number;
  total: number;
  inserted: number;
  updated: number;
  deleted: number;
  rolledBack: boolean;
  failures: DataApplyFailure[];
  elapsedMs: number;
}
