// Wire contracts of the mock data generator (engine/src/DbStudio.Import/Generate/GenerateModels.cs), camelCase.
//   GET  /generate/generators                                           -> GeneratorInfo[]
//   GET  /generate/plan?connectionId=&database=&schema=&table=          -> GeneratePlan
//   POST /generate/preview       GenerateRequest                        -> GeneratePreview
//   POST /generate/run           GenerateRequest                        -> 202 { jobId }; job.progress message = JSON GenerateProgress; job.done result = GenerateSummary
//   GET  /generate/errors/{jobId}                                       -> text/csv

/** Column kinds (Kinds.* of the engine): the generators list the kinds they can fill. */
export type ColumnKind = 'int' | 'bigint' | 'decimal' | 'float' | 'bool' | 'date' | 'datetime' | 'time' | 'guid' | 'binary' | 'json' | 'text' | 'other';

/** `number | text | multiline | date | datetime | time | bool` */
export type OptionType = 'number' | 'text' | 'multiline' | 'date' | 'datetime' | 'time' | 'bool';

export interface GeneratorOption {
  key: string;
  label: string;
  type: OptionType;
  default: string | null;
  help: string | null;
}

export interface GeneratorInfo {
  id: string;
  label: string;
  group: string;
  kinds: ColumnKind[];
  options: GeneratorOption[];
}

export interface GenerateColumn {
  name: string;
  type: string;
  kind: ColumnKind;
  nullable: boolean;
  isPk: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  hasDefault: boolean;
  /** A generator id, `foreignKey` (values of the parent table) or `skip` (left out of the INSERT). */
  generator: string;
  options: Record<string, string | null>;
  /** 0-100 */
  nullPercent: number;
  unique: boolean;
  foreignKey: string | null;
  note: string | null;
}

export interface GenerateForeignKey {
  name: string;
  columns: string[];
  refSchema: string | null;
  refTable: string;
  refColumns: string[];
  parentHasRows: boolean;
}

export interface GeneratePlan {
  providerId: string;
  dialect: string;
  canGenerate: boolean;
  reason: string | null;
  readOnly: boolean;
  table: string;
  defaultRows: number;
  maxRows: number;
  seed: number;
  batchSize: number;
  transactional: boolean;
  columns: GenerateColumn[];
  foreignKeys: GenerateForeignKey[];
  uniqueKeys: string[][];
  warnings: string[];
}

export interface GenerateRequest {
  connectionId: string;
  database?: string | null;
  schema?: string | null;
  table: string;
  rows: number;
  seed?: number | null;
  columns: GenerateColumn[];
  truncateFirst?: boolean;
  batchSize?: number | null;
  transaction?: boolean;
  /** `stop` (default) or `skip` the rows the server rejects. */
  onError?: 'stop' | 'skip';
  maxErrors?: number | null;
  previewRows?: number | null;
}

export interface GeneratePreviewColumn {
  name: string;
  type: string;
  kind: ColumnKind;
}

export interface GeneratePreview {
  columns: GeneratePreviewColumn[];
  rows: (string | null)[][];
  warnings: string[];
  seed: number;
}

export interface GenerateProgress {
  phase: 'preparing' | 'truncating' | 'generating' | 'committing' | 'done';
  rows: number;
  total: number;
  written: number;
  skipped: number;
  errors: number;
  rate: number;
}

export interface GenerateRowError {
  row: number;
  column: string | null;
  message: string;
  values: (string | null)[] | null;
}

export type GenerateOutcome = 'completed' | 'completedWithErrors' | 'failed' | 'cancelled';

export interface GenerateSummary {
  outcome: GenerateOutcome;
  error: string | null;
  rowsRequested: number;
  rowsGenerated: number;
  rowsWritten: number;
  rowsSkipped: number;
  errorCount: number;
  elapsedMs: number;
  rowsPerSecond: number;
  committed: boolean;
  rolledBack: boolean;
  truncated: boolean;
  errorsSample: GenerateRowError[];
  hasErrorReport: boolean;
  loadMethod: string;
  seed: number;
  warnings: string[];
}
