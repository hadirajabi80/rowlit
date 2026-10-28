// Pure model of the Data Transfer wizard: state, the request it builds, step validation and progress bookkeeping.
import type { JobProgressEvent } from '../../api/types';
import type {
  PlannedTable, TransferOptions, TransferPlan, TransferProgress, TransferResult, TransferSpec, TransferTableSpec,
} from '../../api/types.transfer';
import { cleanPastedPath } from '../ImportWizard/files';
import type { TransferTabState } from './open';

export const STEP_SOURCE = 0;
export const STEP_TARGET = 1;
export const STEP_MAPPING = 2;
export const STEP_OPTIONS = 3;
export const STEP_RUN = 4;
export const STEPS = ['Source', 'Target', 'Mapping', 'Options', 'Run'] as const;
export const STEP_SUMMARY = [
  'Tables to copy', 'Connection or SQL file', 'Names and column types', 'Structure and data', 'Review, run, results',
] as const;

export const DEFAULT_OPTIONS: TransferOptions = {
  createMode: 'failIfExists', dataMode: 'append', indexes: true, primaryKeys: true, foreignKeys: true, uniques: true, defaults: true,
  comments: true, identity: true, createSchema: true, batchSize: 500, continueOnError: false, nameCase: 'auto',
};

/** One ticked table / view and the user's changes to its mapping. */
export interface TableChoice {
  name: string;
  type: 'table' | 'view';
  /** '' = the planner's name. */
  targetName: string;
  where: string;
  /** Target type overrides by source column name. */
  columnTypes: Record<string, string>;
  excluded: string[];
}

export interface TableRun {
  status: 'waiting' | 'running' | 'done';
  rows: number;
  total: number | null;
}

export interface RunState {
  status: 'idle' | 'starting' | 'running' | 'done' | 'failed';
  jobId: string | null;
  startedAt: number | null;
  progress: TransferProgress | null;
  done: number;
  total: number | null;
  tables: Record<string, TableRun>;
  result: TransferResult | null;
  error: string | null;
  cancelling: boolean;
}

export const IDLE_RUN: RunState = {
  status: 'idle', jobId: null, startedAt: null, progress: null, done: 0, total: null, tables: {}, result: null, error: null, cancelling: false,
};

export interface TransferState {
  step: number;
  sourceSchema: string | null;
  includeViews: boolean;
  search: string;
  selected: TableChoice[];
  targetKind: 'connection' | 'file';
  targetCid: string;
  /** Catalog database key of the target (null: the connection's default / no database level). */
  targetDb: string | null;
  /** '' = the target's default schema. Free text: a schema that does not exist is created (option createSchema). */
  targetSchema: string;
  dumpProvider: string;
  filePath: string;
  options: TransferOptions;
  plan: TransferPlan | null;
  planKey: string | null;
  planError: string | null;
  planLoading: boolean;
  /** Source table whose mapping card is open. */
  expanded: string | null;
  run: RunState;
}

export function newChoice(name: string, type: 'table' | 'view' = 'table'): TableChoice {
  return { name, type, targetName: '', where: '', columnTypes: {}, excluded: [] };
}

export function initialState(p: Partial<TransferTabState>): TransferState {
  const tables = (p.tables ?? []).map((t) => newChoice(t.name, t.type));
  return {
    step: STEP_SOURCE, sourceSchema: p.schema ?? null, includeViews: tables.some((t) => t.type === 'view'), search: '', selected: tables,
    targetKind: p.targetKind ?? 'connection', targetCid: '', targetDb: null, targetSchema: '', dumpProvider: '', filePath: '',
    options: DEFAULT_OPTIONS, plan: null, planKey: null, planError: null, planLoading: false, expanded: null, run: IDLE_RUN,
  };
}

// ------------------------------------------------------------------ selection

export function isSelected(s: TransferState, name: string): boolean {
  return s.selected.some((t) => t.name === name);
}

/** Ticks / unticks a table, keeping the choices of the others (and the order they were ticked in). */
export function toggleTable(selected: TableChoice[], name: string, type: 'table' | 'view'): TableChoice[] {
  return selected.some((t) => t.name === name) ? selected.filter((t) => t.name !== name) : [...selected, newChoice(name, type)];
}

/** Every listed object ticked (keeps existing choices) or none of them. */
export function setAll(selected: TableChoice[], listed: { name: string; type: 'table' | 'view' }[], on: boolean): TableChoice[] {
  const names = new Set(listed.map((o) => o.name));
  if (!on) return selected.filter((t) => !names.has(t.name));
  const have = new Set(selected.map((t) => t.name));
  return [...selected, ...listed.filter((o) => !have.has(o.name)).map((o) => newChoice(o.name, o.type))];
}

export function filterObjects<T extends { name: string }>(objects: T[], search: string): T[] {
  const q = search.trim().toLowerCase();
  return q ? objects.filter((o) => o.name.toLowerCase().includes(q)) : objects;
}

export function updateChoice(selected: TableChoice[], name: string, change: Partial<TableChoice>): TableChoice[] {
  return selected.map((t) => (t.name === name ? { ...t, ...change } : t));
}

/** A type picked for a column: equal to the planner's proposal (or empty) removes the override. */
export function setColumnType(choice: TableChoice, column: string, type: string, proposed: string): TableChoice {
  const columnTypes = { ...choice.columnTypes };
  const v = type.trim();
  if (!v || v.toLowerCase() === proposed.trim().toLowerCase()) delete columnTypes[column];
  else columnTypes[column] = v;
  return { ...choice, columnTypes };
}

export function toggleExcluded(choice: TableChoice, column: string): TableChoice {
  return { ...choice, excluded: choice.excluded.includes(column) ? choice.excluded.filter((c) => c !== column) : [...choice.excluded, column] };
}

// ------------------------------------------------------------------ request

export interface SpecContext {
  sourceCid: string;
  /** `database` of engine requests (only providers with a database level take one). */
  sourceDb: string | null;
  targetDb: string | null;
}

/** "Copy as path" quotes removed; '' when nothing usable is left. */
export function normalizeDumpPath(raw: string): string {
  return cleanPastedPath(raw.trim()).trim();
}

/** Why a dump path cannot be used (null when it can). */
export function dumpPathIssue(raw: string): string | null {
  const p = normalizeDumpPath(raw);
  if (!p) return 'Choose the file to write.';
  if (/[\\/]$/.test(p)) return 'The path is a folder: add a file name.';
  return null;
}

/** Mirrors the engine's check: a filter is one condition, no statement separators or comments outside quotes. */
export function whereIssue(where: string): string | null {
  let inQuote = false;
  for (let i = 0; i < where.length; i++) {
    const c = where[i];
    if (c === "'") inQuote = !inQuote;
    else if (!inQuote && (c === ';' || (c === '-' && where[i + 1] === '-') || (c === '/' && where[i + 1] === '*'))) {
      return 'A filter is a single condition: no ";" or comments.';
    }
  }
  return null;
}

function tableSpec(t: TableChoice, schema: string | null): TransferTableSpec {
  const spec: TransferTableSpec = { name: t.name };
  if (schema) spec.schema = schema;
  if (t.type === 'view') spec.type = 'view';
  if (t.targetName.trim()) spec.targetName = t.targetName.trim();
  if (t.where.trim()) spec.where = t.where.trim();
  if (Object.keys(t.columnTypes).length > 0) spec.columnTypes = { ...t.columnTypes };
  if (t.excluded.length > 0) spec.excludedColumns = [...t.excluded];
  return spec;
}

/** The request of the plan and the run, or null while the wizard lacks something (no source, no tables, no target). */
export function buildSpec(s: TransferState, ctx: SpecContext): TransferSpec | null {
  if (!ctx.sourceCid || s.selected.length === 0 || optionIssues(s.options).length > 0) return null;
  const source = { connectionId: ctx.sourceCid, database: ctx.sourceDb, schema: s.sourceSchema };
  let target: TransferSpec['target'];
  if (s.targetKind === 'file') {
    if (!s.dumpProvider || dumpPathIssue(s.filePath)) return null;
    target = { filePath: normalizeDumpPath(s.filePath), dumpProvider: s.dumpProvider };
  } else {
    if (!s.targetCid) return null;
    target = { connectionId: s.targetCid, database: ctx.targetDb, schema: s.targetSchema.trim() || null };
  }
  return { source, target, tables: s.selected.map((t) => tableSpec(t, s.sourceSchema)), options: { ...s.options } };
}

/** A stable key of a request (the plan is refreshed when it changes). */
export function specKey(spec: TransferSpec | null): string | null {
  return spec ? JSON.stringify(spec) : null;
}

// ------------------------------------------------------------------ validation

export function optionIssues(o: TransferOptions): string[] {
  const issues: string[] = [];
  if (o.createMode === 'none' && o.dataMode === 'none') issues.push('Nothing to do: create the tables, copy the data, or both.');
  if (!Number.isInteger(o.batchSize) || o.batchSize < 1 || o.batchSize > 100_000) issues.push('The batch size is a number from 1 to 100,000.');
  return issues;
}

export function mappingIssues(s: TransferState): string[] {
  const issues: string[] = [];
  for (const t of s.selected) {
    const w = t.where.trim() ? whereIssue(t.where) : null;
    if (w) issues.push(`${t.name}: ${w}`);
  }
  const names = new Map<string, string>();
  for (const t of s.plan?.tables ?? []) {
    const key = `${t.targetSchema}\u0001${t.targetName}`.toLowerCase();
    const other = names.get(key);
    if (other) issues.push(`${other} and ${t.sourceName} would both be written to ${t.targetName}.`);
    else names.set(key, t.sourceName);
  }
  return issues;
}

/** Tables the plan refuses (the run fails on the first one unless "continue on error" is on). */
export function planErrors(plan: TransferPlan | null): PlannedTable[] {
  return (plan?.tables ?? []).filter((t) => !!t.error);
}

// ------------------------------------------------------------------ progress

/** Bookkeeping of one job.progress event: overall counts, the table being copied and the tables before it. */
export function applyProgress(run: RunState, p: TransferProgress | null, ev: Pick<JobProgressEvent, 'done' | 'total'>): RunState {
  const next: RunState = { ...run, progress: p ?? run.progress, done: ev.done, total: ev.total ?? run.total };
  if (!p?.table) return next;
  const tables = { ...run.tables };
  if (p.phase === 'structure' || p.phase === 'data') {
    for (const [name, t] of Object.entries(tables)) if (name !== p.table && t.status === 'running') tables[name] = { ...t, status: 'done' };
    const cur = tables[p.table] ?? { status: 'waiting', rows: 0, total: null };
    tables[p.table] = { status: 'running', rows: p.phase === 'data' ? p.tableDone : cur.rows, total: p.tableTotal ?? cur.total };
  }
  next.tables = tables;
  return next;
}

export function progressPercent(done: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.max(0, Math.min(100, (done / total) * 100));
}

export const PHASE_TEXT: Record<string, string> = {
  counting: 'Counting rows…', schema: 'Creating the schema…', structure: 'Creating tables…', data: 'Copying rows…', keys: 'Creating indexes and foreign keys…',
};

/** Words for a finished transfer. */
export const OUTCOME: Record<string, { title: string; tone: 'ok' | 'warn' | 'error' }> = {
  ok: { title: 'Transfer complete', tone: 'ok' },
  partial: { title: 'Transfer finished with problems', tone: 'warn' },
  error: { title: 'Transfer failed', tone: 'error' },
  cancelled: { title: 'Transfer cancelled', tone: 'warn' },
  skipped: { title: 'Nothing was transferred', tone: 'warn' },
};

/** File name suggested by the Browse… button. */
export function suggestedDumpName(schemaOrDb: string | null, dialectName: string): string {
  const base = (schemaOrDb || 'dump').replace(/[^\p{L}\p{N}_.-]+/gu, '_');
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}-${dialectName.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${stamp}.sql`;
}
