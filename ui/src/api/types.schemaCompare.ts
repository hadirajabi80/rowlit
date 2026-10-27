// Wire contracts of Schema compare / structure synchronization (mirror of engine/src/DbStudio.Core/SchemaCompare/CompareContracts.cs).
// Source is the truth, the target is changed: "create" = only in the source, "drop" = only in the target, "alter" = different.

/** One side of a comparison: connection › database › schema. MySQL/MariaDB/Oracle have no database level (schema only). */
export interface CompareEndpoint {
  connectionId: string;
  database?: string | null;
  schema?: string | null;
}

/** What is compared and how bodies are compared. Everything defaults to on except `ignoreConstraintNames`. */
export interface CompareOptions {
  tables: boolean;
  columns: boolean;
  primaryKeys: boolean;
  foreignKeys: boolean;
  uniques: boolean;
  checks: boolean;
  indexes: boolean;
  defaults: boolean;
  comments: boolean;
  views: boolean;
  procedures: boolean;
  functions: boolean;
  triggers: boolean;
  sequences: boolean;
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  ignoreComments: boolean;
  ignoreCollation: boolean;
  ignoreConstraintNames: boolean;
}

export interface CompareRequest {
  source: CompareEndpoint;
  target: CompareEndpoint;
  options?: Partial<CompareOptions>;
}

export type CompareStatus = 'create' | 'drop' | 'alter' | 'identical';

export type CompareKind = 'table' | 'view' | 'proc' | 'func' | 'trigger' | 'sequence' | 'type' | 'package';

export type CompareSeverity = 'dataLoss' | 'warning' | 'info';

export interface CompareWarning {
  severity: CompareSeverity;
  message: string;
}

export interface CompareItem {
  /** Stable within one comparison: "table:Orders", "func:fn_tax(amount numeric)". */
  id: string;
  kind: CompareKind;
  name: string;
  status: CompareStatus;
  changes: string[];
  warnings: CompareWarning[];
  /** Trigger: the table it fires on. */
  detail?: string | null;
}

export interface CompareCounts {
  create: number;
  drop: number;
  alter: number;
  identical: number;
}

export interface CompareResult {
  compareId: string;
  providerId: string;
  dialect: string;
  sourceLabel: string;
  targetLabel: string;
  sourceSchema: string;
  targetSchema: string;
  items: CompareItem[];
  counts: CompareCounts;
  notes: string[];
  transactionalDdl: boolean;
  elapsedMs: number;
}

export interface ScriptStatement {
  sql: string;
  kind: string;
  itemId: string | null;
  warning: string | null;
}

export interface ItemWarning {
  itemId: string;
  severity: CompareSeverity;
  message: string;
}

export interface CompareScript {
  statements: ScriptStatement[];
  text: string;
  warnings: ItemWarning[];
  transactionalDdl: boolean;
  itemCount: number;
}

export interface CompareItemDetail {
  item: CompareItem;
  sourceDdl: string | null;
  targetDdl: string | null;
  statements: ScriptStatement[];
}

export interface CompareApplyRequest {
  /** null = every item that differs. */
  itemIds: string[] | null;
  /** true: one run, rolled back on the first error where DDL is transactional; false: statement by statement, failures collected. */
  stopOnError: boolean;
}

export interface CompareApplyFailure {
  index: number;
  sql: string;
  message: string;
  code: string | null;
  itemId: string | null;
}

export interface CompareApplyResult {
  ok: boolean;
  executed: number;
  total: number;
  rolledBack: boolean;
  transactionalDdl: boolean;
  elapsedMs: number;
  failures: CompareApplyFailure[];
}

/** `GET /schema-compare/support?connectionId=`. */
export interface CompareSupport {
  supported: boolean;
  providerId: string;
  dialect: string | null;
  /** MySQL / MariaDB / Oracle: one level (the schema is the database). */
  schemaIsDatabase: boolean;
  /** The script cannot be applied to a read-only connection (it can still be the target of a comparison). */
  readOnly: boolean;
  reason: string | null;
}
