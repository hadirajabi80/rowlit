// Wire contracts of Data Transfer (engine/src/DbStudio.Core/Transfer/TransferModels.cs), camelCase.
//   POST /transfer/plan          TransferSpec -> TransferPlan
//   POST /transfer/run           TransferSpec -> 202 { jobId }; job.progress message = JSON TransferProgress; job.done result = TransferResult
//   GET  /transfer/types         ?provider=&connectionId= -> TransferTypesInfo
//   GET  /transfer/support       ?connectionId= -> TransferSupport
//   GET  /transfer/dump-dialects -> DumpDialect[]

export interface TransferSource {
  connectionId: string;
  database?: string | null;
  schema?: string | null;
}

/** A connection (connectionId, database, schema) or a SQL file (filePath + dumpProvider: the dialect of the script). */
export interface TransferTarget {
  connectionId?: string | null;
  database?: string | null;
  schema?: string | null;
  filePath?: string | null;
  dumpProvider?: string | null;
}

export interface TransferTableSpec {
  name: string;
  schema?: string | null;
  /** 'table' (default) | 'view' (a view copied as a table). */
  type?: 'table' | 'view' | null;
  targetName?: string | null;
  /** Filter in the source dialect, without WHERE. */
  where?: string | null;
  /** Target type overrides by source column name. */
  columnTypes?: Record<string, string> | null;
  excludedColumns?: string[] | null;
}

export type CreateMode = 'none' | 'dropExisting' | 'skipExisting' | 'failIfExists';
export type DataMode = 'none' | 'append' | 'truncate' | 'upsert';
export type NameCase = 'auto' | 'keep' | 'lower' | 'upper';

export interface TransferOptions {
  createMode: CreateMode;
  dataMode: DataMode;
  indexes: boolean;
  primaryKeys: boolean;
  foreignKeys: boolean;
  uniques: boolean;
  defaults: boolean;
  comments: boolean;
  identity: boolean;
  createSchema: boolean;
  batchSize: number;
  continueOnError: boolean;
  nameCase: NameCase;
}

export interface TransferSpec {
  source: TransferSource;
  target: TransferTarget;
  tables: TransferTableSpec[];
  options?: Partial<TransferOptions> | null;
}

export interface PlannedColumn {
  name: string;
  targetName: string;
  sourceType: string;
  targetType: string;
  defaultTargetType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  isComputed: boolean;
  overridden: boolean;
  excluded: boolean;
  note: string | null;
}

export interface PlannedTable {
  sourceSchema: string;
  sourceName: string;
  sourceType: 'table' | 'view';
  targetSchema: string;
  targetName: string;
  columns: PlannedColumn[];
  createStatements: string[];
  postStatements: string[];
  warnings: string[];
  existsInTarget: boolean;
  rowEstimate: number | null;
  where: string | null;
  error: string | null;
}

export interface TransferPlan {
  sourceProvider: string;
  targetProvider: string;
  targetDialect: string;
  /** In run order (referenced tables first). */
  tables: PlannedTable[];
  warnings: string[];
  schemaStatements: string[];
}

export type TransferStatus = 'ok' | 'error' | 'cancelled' | 'skipped' | 'partial';

export interface TransferTableResult {
  name: string;
  targetName: string;
  status: TransferStatus;
  rows: number;
  errorRows: number;
  elapsedMs: number;
  error: string | null;
  created: boolean;
}

export interface TransferError {
  table: string;
  phase: string;
  message: string;
  sql?: string | null;
}

export interface TransferResult {
  status: TransferStatus;
  totalRows: number;
  elapsedMs: number;
  tables: TransferTableResult[];
  errors: TransferError[];
  filePath: string | null;
  fileBytes: number | null;
}

export type TransferPhase = 'counting' | 'schema' | 'structure' | 'data' | 'keys';

export interface TransferProgress {
  phase: TransferPhase;
  table: string | null;
  tableIndex: number;
  tableCount: number;
  tableDone: number;
  tableTotal: number | null;
  rowsPerSecond: number;
  message: string | null;
}

/** A type of the target's designer type list (DesignerType). */
export interface TransferTypeInfo {
  name: string;
  /** Parameter kind ("length", "precision", "" ...). */
  params: string;
  /** Full default type text ("varchar(100)"). */
  default: string;
  category: string;
}

export interface TransferTypesInfo {
  provider: string;
  dialect: string;
  types: TransferTypeInfo[];
}

export interface TransferSupport {
  connectionId: string;
  providerId: string;
  dialect: string | null;
  asSource: boolean;
  asTarget: boolean;
  reason: string | null;
}

export interface DumpDialect {
  provider: string;
  name: string;
  dialect: string;
}
