// Import Wizard wire contract (engine: engine/src/DbStudio.Import). camelCase JSON, enums as camelCase strings.
//
// Endpoints (all under /api/v1, same auth as the rest of the engine API):
//   POST   /import/preview                          body PreviewRequest            -> PreviewResult
//   GET    /connections/{cid}/import/capabilities   ?database=                     -> ImportCapabilities
//   POST   /connections/{cid}/import/table-info     body TableRef                  -> TargetTableInfo
//   POST   /connections/{cid}/import/ddl            body DdlRequest                -> DdlPreview
//   POST   /connections/{cid}/import/start          body ImportRequest             -> 202 { jobId }
//   GET    /import/errors/{jobId}                   -> text/csv (UTF-8 with BOM, attachment) error report of a finished job
//   DELETE /jobs/{jobId}                            cancels (existing endpoint)
// Progress: WebSocket `job.progress` (kind "import.run"): done = rows read, total = null, message = JSON of ImportProgress.
// Completion: `job.done` { status: 'ok' | 'error' | 'cancelled', error, result: ImportSummary }. The engine reports normal
// outcomes (including "cancelled" and "failed after N rows") through `result.outcome` with job status 'ok'; job status
// 'error' only for infrastructure failures (connection refused ...) and then `error` carries the message.

export type SourceFormat = 'csv' | 'tsv' | 'xlsx' | 'json' | 'ndjson';

export interface SourceOptions {
  format: SourceFormat;
  /** 'auto' (default): BOM, then valid UTF-8, else Windows-1252. Others: 'utf-8' | 'utf-16' | 'utf-16be' | 'windows-1256' | 'windows-1252' | 'iso-8859-1' | 'iso-8859-6' | any .NET encoding name. */
  encoding?: string;
  /** csv: one character ("," ";" "\t" "|"); omitted/'auto' = detect. */
  delimiter?: string;
  /** csv quote character, default '"'; '' = fields are never quoted. */
  quote?: string;
  /** csv escape character; default = the quote character (doubled quote). Usually '\\' as the alternative. */
  escape?: string;
  /** First row holds the column names (default true). Without a header the columns are named Column1, Column2 ... */
  hasHeader?: boolean;
  /** Lines/rows to skip at the start of the file BEFORE the header row (default 0). */
  skipRows?: number;
  /** xlsx: sheet name (default: the first sheet). */
  sheet?: string;
  /** json: path of the array to import ("data.items" or "$.data.items"); omitted = top-level array, or the only array property. */
  jsonPath?: string;
  /** Trim leading/trailing whitespace of text cells (default false). */
  trim?: boolean;
  /** Text values read as NULL (default ["", "NULL", "null"]). */
  nullTokens?: string[];
  /** .NET custom date/time formats tried first, e.g. "dd/MM/yyyy", "MM/dd/yyyy HH:mm". Empty: ISO 8601 and invariant parsing. */
  dateFormats?: string[];
  /** Decimal separator of numbers in text cells: '.' (default) or ','. */
  decimalSeparator?: string;
  /** Thousands separator: '' (default), ',', '.', ' '. */
  thousandsSeparator?: string;
  /** Read Persian / Arabic-Indic digits and separators as ASCII in numbers and dates (default true). */
  normalizeDigits?: boolean;
}

export interface PreviewRequest {
  path: string;
  /** Options to apply; anything omitted is auto-detected and echoed back in PreviewResult.options. */
  options?: Partial<SourceOptions>;
  /** Rows returned (default 100, max 1000). Column types are inferred from up to 2000 rows regardless. */
  maxRows?: number;
  /** Data rows to skip before the returned page (pagination). */
  offset?: number;
}

export type InferredKind = 'empty' | 'bool' | 'int' | 'bigint' | 'decimal' | 'float' | 'date' | 'datetime' | 'time' | 'guid' | 'text';

export interface InferredType {
  kind: InferredKind;
  /** text: longest value seen (characters). */
  length?: number;
  /** decimal: digits in total / after the point. */
  precision?: number;
  scale?: number;
  /** A null/empty value was seen. */
  nullable: boolean;
}

export interface PreviewColumn {
  /** 0-based position in the file. */
  index: number;
  name: string;
  inferred: InferredType;
}

export interface PreviewResult {
  path: string;
  fileName: string;
  fileSize: number;
  /** Effective options (auto-detected encoding, delimiter, sheet, header ...). */
  options: SourceOptions;
  /** xlsx: sheet names in workbook order. */
  sheets?: string[];
  /** json: array property paths found (candidates for jsonPath). */
  jsonPaths?: string[];
  columns: PreviewColumn[];
  /** Display strings (null = NULL), at most maxRows rows. */
  rows: (string | null)[][];
  /** Rows examined for type inference. */
  sampledRows: number;
  /** The file has more rows than were sampled. */
  moreRows: boolean;
  /** First data row of this page (0-based). */
  offset?: number;
  /** There are rows after this page. */
  hasNextPage?: boolean;
  warnings: string[];
}

export interface TableRef {
  database?: string | null;
  schema?: string | null;
  table: string;
}

export type ImportMode = 'append' | 'truncateInsert' | 'upsert' | 'updateOnly';

export interface ImportCapabilities {
  providerId: string;
  dialect: string;
  /** False for read-only connections and engines without relational import (reason says why). */
  canImport: boolean;
  reason?: string;
  readOnly: boolean;
  modes: ImportMode[];
  canCreateTable: boolean;
  /** One transaction around the whole import is possible (not ClickHouse). */
  transactional: boolean;
  /** Human text of the load path: "SqlBulkCopy", "COPY (text)", "Batched multi-row INSERT", "Array binding" ... */
  bulkMethod: string;
  defaultBatchSize: number;
  maxIdentifierLength: number;
  /** Type names offered in the create-table column type dropdown. */
  sqlTypes: string[];
}

export type TargetKind = 'bool' | 'int' | 'bigint' | 'decimal' | 'float' | 'date' | 'datetime' | 'time' | 'guid' | 'text' | 'binary' | 'json' | 'other';

export interface TargetColumn {
  name: string;
  /** Declared type text, e.g. "nvarchar(50)". */
  type: string;
  kind: TargetKind;
  nullable: boolean;
  isPk: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  hasDefault: boolean;
  ordinal: number;
}

export interface TargetTableInfo {
  exists: boolean;
  columns: TargetColumn[];
  primaryKey: string[];
  /** Column sets of unique indexes (PK included), candidates for upsert / update keys. */
  uniqueKeys: string[][];
}

/** One target column of a new table. */
export interface NewColumn {
  name: string;
  /** Explicit SQL type; omitted = the engine's default for `inferred`. */
  sqlType?: string;
  nullable?: boolean;
  inferred: InferredType;
}

export interface DdlRequest extends TableRef {
  columns: NewColumn[];
  primaryKey?: string[];
}

export interface DdlPreview {
  ddl: string;
  /** Effective SQL type of every column (default applied), in request order. */
  columns: { name: string; sqlType: string }[];
  warnings: string[];
}

export type ValueSource =
  | { kind: 'source'; index: number }
  | { kind: 'constant'; value: string | null }
  /** now | utcNow | uuid | rowNumber (1-based data row) | fileName */
  | { kind: 'expression'; name: 'now' | 'utcNow' | 'uuid' | 'rowNumber' | 'fileName' };

export interface ColumnMapping {
  /** Target column name. Source columns left out of the mapping are skipped. */
  target: string;
  from: ValueSource;
  /** Create mode: SQL type and nullability of the new column (omitted = default for the inferred type). */
  sqlType?: string;
  nullable?: boolean;
  /** Create mode: inferred type of the source column (drives the default sqlType). */
  inferred?: InferredType;
}

export interface ImportRequest {
  path: string;
  source: SourceOptions;
  target: TableRef & { create: boolean };
  columns: ColumnMapping[];
  /** Create mode: primary key (target column names). */
  primaryKey?: string[];
  mode: ImportMode;
  /** upsert / updateOnly: target column names that identify a row. */
  keyColumns?: string[];
  /** stop: the first bad row ends the import; skip: bad rows are logged and skipped. */
  onError: 'stop' | 'skip';
  /** skip: give up after this many bad rows (default 1000, 0 = no limit). */
  maxErrors?: number;
  /** Rows per batch (default ImportCapabilities.defaultBatchSize). */
  batchSize?: number;
  /** All-or-nothing: one transaction for the whole import; off: every batch commits on its own. */
  transaction: boolean;
  /** Use the provider's bulk path when possible (default true). */
  useBulk?: boolean;
  /** Maximum rows to import (0 / omitted = all) - for test runs. */
  limit?: number;
}

export type ImportPhase = 'preparing' | 'truncating' | 'importing' | 'committing' | 'done';

/** JSON in `job.progress.message`. */
export interface ImportProgress {
  phase: ImportPhase;
  rows: number;
  written: number;
  skipped: number;
  errors: number;
  /** Rows per second over the last seconds. */
  rate: number;
  bytes: number;
  totalBytes: number;
}

export interface ImportRowError {
  /** 1-based data row number in the file (after the header). */
  row: number;
  column?: string;
  message: string;
  /** The raw source values of the row (display strings), when kept. */
  values?: (string | null)[];
}

export type ImportOutcome = 'completed' | 'completedWithErrors' | 'failed' | 'cancelled';

export interface ImportSummary {
  outcome: ImportOutcome;
  /** Failure message for outcome 'failed'. */
  error?: string;
  rowsRead: number;
  /** Rows inserted / upserted / updated in the database. */
  rowsWritten: number;
  rowsSkipped: number;
  errorCount: number;
  elapsedMs: number;
  rowsPerSecond: number;
  /** The writes are committed (false after a rollback or when nothing was written). */
  committed: boolean;
  rolledBack: boolean;
  /** Fully qualified name of the table created by this import. */
  createdTable?: string;
  ddl?: string;
  /** First errors (the full list is in the report). */
  errorsSample: ImportRowError[];
  /** GET /import/errors/{jobId} returns the report. */
  hasErrorReport: boolean;
  loadMethod: string;
}
