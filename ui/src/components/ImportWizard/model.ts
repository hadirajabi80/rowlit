// Pure logic of the Import Wizard: file formats, column auto-matching, type compatibility, validation and the
// request builder. No React, no stores: everything here is unit-tested in model.test.ts.
import type {
  ColumnMapping, ImportMode, ImportProgress, ImportRequest, InferredKind, InferredType, PreviewColumn, PreviewResult, SourceOptions,
  TargetColumn, TargetKind, TargetTableInfo, ValueSource,
} from './types';
import { fileNameOf } from './files';

export { fileNameOf, formatOfPath, IMPORT_EXTENSIONS, IMPORT_FILE_FILTERS, isImportable } from './files';

// ---------------------------------------------------------------- names

/** Name of a new table/column from free text: no whitespace or punctuation runs, never empty. */
export function sanitizeIdentifier(raw: string, fallback: string): string {
  const s = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) return fallback;
  return /^\p{N}/u.test(s) ? `_${s}` : s;
}

/** Table name proposed for a file: "Sales 2024.csv" -> "Sales_2024". */
export function tableNameFromFile(path: string): string {
  const name = fileNameOf(path);
  const dot = name.lastIndexOf('.');
  return sanitizeIdentifier(dot > 0 ? name.slice(0, dot) : name, 'imported_data');
}

/** Name used to compare a file column with a table column: case, "_", "-", spaces and dots do not matter. */
export function normName(s: string): string {
  return s.toLowerCase().replace(/[\s_\-.]+/g, '');
}

/** Last identifier of a qualified name as the engine prints it: [dbo].[T], "s"."T", `d`.`t`, a.b. */
export function lastNamePart(qualified: string): string {
  const parts: string[] = [];
  let cur = '';
  let close: string | null = null;
  for (const ch of qualified) {
    if (close) {
      if (ch === close) close = null;
      else cur += ch;
    } else if (ch === '[') close = ']';
    else if (ch === '"') close = '"';
    else if (ch === '`') close = '`';
    else if (ch === '.') {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts[parts.length - 1] || qualified;
}

/** "int", "text(20)", "decimal(10,2)": the inferred type of a file column as shown in headers. */
export function typeLabel(t: InferredType): string {
  switch (t.kind) {
    case 'text': return t.length ? `text(${t.length})` : 'text';
    case 'decimal': return t.precision ? `decimal(${t.precision},${t.scale ?? 0})` : 'decimal';
    default: return t.kind;
  }
}

// ---------------------------------------------------------------- type compatibility

export type Compat = 'ok' | 'convert' | 'warn';

const NUMERIC = new Set<string>(['int', 'bigint', 'decimal', 'float']);

/**
 * How well a file column of an inferred kind fits a table column of a kind: `ok` (stored as is), `convert` (the engine
 * converts and usually succeeds), `warn` (values may be rejected or lose information).
 */
export function kindCompat(src: InferredKind, target: TargetKind): Compat {
  if (src === 'empty') return 'ok';
  if (target === 'text') return 'ok';
  if (target === 'other' || target === 'json') return 'convert';
  if (src === (target as string)) return 'ok';
  switch (src) {
    case 'int':
      return target === 'bigint' || target === 'decimal' || target === 'float' ? 'ok' : target === 'bool' ? 'convert' : 'warn';
    case 'bigint':
      return target === 'decimal' || target === 'float' ? 'ok' : target === 'bool' ? 'convert' : 'warn';
    case 'decimal':
      return target === 'float' ? 'convert' : 'warn';
    case 'float':
      return target === 'decimal' ? 'convert' : 'warn';
    case 'bool':
      return NUMERIC.has(target) ? 'convert' : 'warn';
    case 'date':
      return target === 'datetime' ? 'ok' : 'warn';
    case 'datetime':
    case 'time':
    case 'guid':
      return 'warn';
    case 'text':
      return target === 'date' || target === 'datetime' || target === 'time' || target === 'guid' || target === 'bool' ? 'convert' : 'warn';
    default:
      return 'warn';
  }
}

export type ExpressionName = Extract<ValueSource, { kind: 'expression' }>['name'];

export const EXPRESSIONS: readonly { name: ExpressionName; label: string }[] = [
  { name: 'now', label: 'Current local time' },
  { name: 'utcNow', label: 'Current UTC time' },
  { name: 'uuid', label: 'New UUID' },
  { name: 'rowNumber', label: 'Row number' },
  { name: 'fileName', label: 'File name' },
];

export function expressionCompat(name: ExpressionName, target: TargetKind): Compat {
  if (target === 'text' || target === 'other' || target === 'json') return 'ok';
  switch (name) {
    case 'now':
    case 'utcNow':
      return target === 'datetime' ? 'ok' : target === 'date' || target === 'time' ? 'convert' : 'warn';
    case 'uuid':
      return target === 'guid' ? 'ok' : 'warn';
    case 'rowNumber':
      return target === 'int' || target === 'bigint' || target === 'decimal' ? 'ok' : 'warn';
    default:
      return 'warn';
  }
}

// ---------------------------------------------------------------- mapping (existing table)

export type MapChoice = { kind: 'skip' } | ValueSource;

export const SKIP: MapChoice = { kind: 'skip' };

/** Identity and computed columns are never loaded unless the user maps them explicitly. */
const writable = (t: TargetColumn) => !t.isIdentity && !t.isComputed;

/**
 * Proposes a source for every table column: by name (case, "_", "-", spaces ignored; each file column once), and by
 * position only when no name matched at all and the file has exactly as many columns as the table has writable ones.
 * Identity and computed columns stay skipped.
 */
export function autoMatch(targets: readonly TargetColumn[], sources: readonly PreviewColumn[]): Record<string, MapChoice> {
  const result: Record<string, MapChoice> = {};
  const used = new Set<number>();
  let matched = 0;
  for (const t of targets) {
    result[t.name] = SKIP;
    if (!writable(t)) continue;
    const n = normName(t.name);
    const hit = sources.find((s) => !used.has(s.index) && normName(s.name) === n);
    if (hit) {
      used.add(hit.index);
      result[t.name] = { kind: 'source', index: hit.index };
      matched++;
    }
  }
  const free = targets.filter(writable);
  if (matched === 0 && free.length > 0 && free.length === sources.length) {
    free.forEach((t, i) => {
      result[t.name] = { kind: 'source', index: sources[i].index };
    });
  }
  return result;
}

export interface MappingIssues {
  errors: string[];
  warnings: string[];
  /** Target column -> compat for mapped columns (for the row icons). */
  compat: Record<string, Compat>;
}

export function mappingIssues(
  info: TargetTableInfo | null,
  mapping: Record<string, MapChoice>,
  sources: readonly PreviewColumn[],
): MappingIssues {
  const out: MappingIssues = { errors: [], warnings: [], compat: {} };
  if (!info) return out;
  let mapped = 0;
  for (const t of info.columns) {
    const m = mapping[t.name] ?? SKIP;
    if (m.kind === 'skip') {
      if (!t.nullable && !t.hasDefault && !t.isIdentity && !t.isComputed) {
        out.errors.push(`"${t.name}" is required (NOT NULL, no default) and has no source.`);
      }
      continue;
    }
    mapped++;
    if (t.isComputed) out.errors.push(`"${t.name}" is a computed column and cannot be loaded.`);
    let c: Compat = 'ok';
    if (m.kind === 'source') {
      const src = sources.find((s) => s.index === m.index);
      if (!src) out.errors.push(`"${t.name}" is mapped to a file column that does not exist.`);
      else c = kindCompat(src.inferred.kind, t.kind);
    } else if (m.kind === 'expression') c = expressionCompat(m.name, t.kind);
    out.compat[t.name] = c;
    if (c === 'warn') out.warnings.push(`"${t.name}" (${t.type}): the values may not fit.`);
  }
  if (mapped === 0) out.errors.unshift('Map at least one column.');
  return out;
}

/** Table columns that receive a value (not skipped). */
export function mappedTargets(info: TargetTableInfo | null, mapping: Record<string, MapChoice>): TargetColumn[] {
  return (info?.columns ?? []).filter((c) => (mapping[c.name] ?? SKIP).kind !== 'skip');
}

/** Default key of upsert / update-only: the primary key, else the first unique key, whose columns are all loaded. */
export function pickDefaultKey(info: TargetTableInfo | null, mapping: Record<string, MapChoice>): string[] {
  if (!info) return [];
  const mapped = new Set(mappedTargets(info, mapping).map((c) => c.name.toLowerCase()));
  const candidates = [info.primaryKey, ...info.uniqueKeys].filter((k) => k.length > 0);
  return candidates.find((k) => k.every((c) => mapped.has(c.toLowerCase()))) ?? [];
}

/** True when the chosen columns contain a whole unique key (so they identify at most one row). */
export function isUniqueKey(info: TargetTableInfo | null, keys: readonly string[]): boolean {
  if (!info || keys.length === 0) return false;
  const have = new Set(keys.map((k) => k.toLowerCase()));
  return [info.primaryKey, ...info.uniqueKeys].some((u) => u.length > 0 && u.every((c) => have.has(c.toLowerCase())));
}

// ---------------------------------------------------------------- new table

export interface NewColumnRow {
  /** Position of the file column. */
  index: number;
  sourceName: string;
  include: boolean;
  /** Name of the new column. */
  name: string;
  /** Explicit SQL type; null = the engine's default for `inferred`. */
  sqlType: string | null;
  nullable: boolean;
  inferred: InferredType;
}

export function defaultNewColumns(cols: readonly PreviewColumn[]): NewColumnRow[] {
  const taken = new Set<string>();
  return cols.map((c) => {
    const base = sanitizeIdentifier(c.name, `column_${c.index + 1}`);
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}_${i}`;
    taken.add(name.toLowerCase());
    return { index: c.index, sourceName: c.name, include: true, name, sqlType: null, nullable: true, inferred: c.inferred };
  });
}

export function newTableIssues(table: string, rows: readonly NewColumnRow[], primaryKey: readonly string[]): string[] {
  const errors: string[] = [];
  if (!table.trim()) errors.push('Enter a name for the new table.');
  const included = rows.filter((r) => r.include);
  if (included.length === 0) errors.push('Include at least one column.');
  const seen = new Set<string>();
  for (const r of included) {
    const n = r.name.trim();
    if (!n) errors.push(`Column ${r.index + 1} has no name.`);
    else if (seen.has(n.toLowerCase())) errors.push(`The column name "${n}" is used twice.`);
    seen.add(n.toLowerCase());
  }
  for (const k of primaryKey) {
    if (!included.some((r) => r.name === k)) errors.push(`The primary key column "${k}" is not part of the table.`);
  }
  return errors;
}

// ---------------------------------------------------------------- request

export interface WizardTarget {
  database: string | null;
  schema: string | null;
  table: string;
  create: boolean;
}

export interface RequestInputs {
  path: string;
  source: SourceOptions;
  target: WizardTarget;
  tableInfo: TargetTableInfo | null;
  mapping: Record<string, MapChoice>;
  newColumns: readonly NewColumnRow[];
  primaryKey: readonly string[];
  mode: ImportMode;
  keyColumns: readonly string[];
  onError: 'stop' | 'skip';
  maxErrors: number;
  batchSize: number;
  transaction: boolean;
  useBulk: boolean;
  limit: number;
}

export function buildImportRequest(i: RequestInputs): ImportRequest {
  const create = i.target.create;
  let columns: ColumnMapping[];
  if (create) {
    columns = i.newColumns
      .filter((r) => r.include)
      .map((r) => {
        const isPk = i.primaryKey.includes(r.name);
        return {
          target: r.name.trim(),
          from: { kind: 'source', index: r.index } as ValueSource,
          ...(r.sqlType ? { sqlType: r.sqlType } : {}),
          nullable: isPk ? false : r.nullable,
          inferred: r.inferred,
        };
      });
  } else {
    columns = [];
    for (const t of i.tableInfo?.columns ?? []) {
      const m = i.mapping[t.name] ?? SKIP;
      if (m.kind !== 'skip') columns.push({ target: t.name, from: m });
    }
  }
  const mode: ImportMode = create ? 'append' : i.mode;
  return {
    path: i.path,
    source: i.source,
    target: { database: i.target.database, schema: i.target.schema, table: i.target.table.trim(), create },
    columns,
    ...(create && i.primaryKey.length ? { primaryKey: [...i.primaryKey] } : {}),
    mode,
    ...(mode === 'upsert' || mode === 'updateOnly' ? { keyColumns: [...i.keyColumns] } : {}),
    onError: i.onError,
    ...(i.onError === 'skip' ? { maxErrors: i.maxErrors } : {}),
    batchSize: i.batchSize,
    transaction: i.transaction,
    useBulk: i.useBulk,
    ...(i.limit > 0 ? { limit: i.limit } : {}),
  };
}

// ---------------------------------------------------------------- progress and formatting

export function parseProgress(message: string | null | undefined): ImportProgress | null {
  if (!message) return null;
  try {
    const v = JSON.parse(message) as Partial<ImportProgress>;
    if (v && typeof v === 'object' && typeof v.phase === 'string') {
      return {
        phase: v.phase, rows: v.rows ?? 0, written: v.written ?? 0, skipped: v.skipped ?? 0, errors: v.errors ?? 0, rate: v.rate ?? 0,
        bytes: v.bytes ?? 0, totalBytes: v.totalBytes ?? 0,
      };
    }
  } catch {
    // not JSON: plain progress text
  }
  return null;
}

/** 0..100, or null when the size of the file is unknown. */
export function progressPercent(p: ImportProgress | null): number | null {
  if (!p || p.totalBytes <= 0) return null;
  return Math.max(0, Math.min(100, (p.bytes / p.totalBytes) * 100));
}

export function formatCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${(ms / 1000).toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ---------------------------------------------------------------- source option presets

export const ENCODINGS: readonly { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1256', label: 'Windows-1256 (Arabic / Persian)' },
  { value: 'windows-1252', label: 'Windows-1252 (Western)' },
  { value: 'iso-8859-1', label: 'ISO-8859-1' },
  { value: 'iso-8859-6', label: 'ISO-8859-6 (Arabic)' },
];

export const DELIMITERS: readonly { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: ',', label: 'Comma ( , )' },
  { value: ';', label: 'Semicolon ( ; )' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe ( | )' },
  { value: 'custom', label: 'Custom…' },
];

export const DATE_FORMAT_PRESETS: readonly string[] = [
  'yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy/MM/dd', 'yyyy-MM-dd HH:mm:ss', 'dd/MM/yyyy HH:mm', 'MM/dd/yyyy HH:mm',
];

// ---------------------------------------------------------------- names and file problems (step hints)

/** Words that are keywords in most SQL dialects: a table with such a name works (the engine quotes it) but is awkward to query. */
const RESERVED_WORDS = new Set([
  'add', 'all', 'alter', 'and', 'any', 'as', 'asc', 'between', 'by', 'case', 'check', 'column', 'constraint', 'create', 'cross', 'current',
  'database', 'default', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exists', 'false', 'for', 'foreign', 'from', 'full', 'grant',
  'group', 'having', 'in', 'index', 'inner', 'insert', 'into', 'is', 'join', 'key', 'left', 'like', 'limit', 'not', 'null', 'offset', 'on',
  'or', 'order', 'outer', 'primary', 'references', 'right', 'select', 'set', 'table', 'then', 'to', 'top', 'true', 'union', 'unique', 'update',
  'user', 'values', 'view', 'when', 'where', 'with',
]);

/**
 * Rows in the file: exact when the engine read the whole file for its sample, else an estimate from the average size of
 * the previewed rows (text formats only; a zipped workbook says nothing about its row count). Null when unknown.
 */
export function estimateRows(p: PreviewResult | null): { rows: number; exact: boolean } | null {
  if (!p) return null;
  if (!p.moreRows) return { rows: p.sampledRows, exact: true };
  const format = p.options?.format;
  if (format === 'xlsx' || p.rows.length === 0 || p.fileSize <= 0) return null;
  let bytes = 0;
  for (const row of p.rows) {
    bytes += row.length; // separators
    for (const cell of row) bytes += cell?.length ?? 0;
  }
  const avg = Math.max(1, bytes / p.rows.length);
  return { rows: Math.max(p.sampledRows, Math.round(p.fileSize / avg)), exact: false };
}

export function isReservedWord(name: string): boolean {
  return RESERVED_WORDS.has(name.trim().toLowerCase());
}

function asciiDigits(v: string): string {
  return v.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) >= 0x06f0 ? d.charCodeAt(0) - 0x06f0 : d.charCodeAt(0) - 0x0660));
}

/**
 * Columns of the previewed page that do not look like what the engine inferred, with a short reason: a number column with
 * a cell that is not a number (a later page can differ from the sample the types come from), or a column named in a
 * warning of the engine. Separators are ignored on purpose (the user may have set a decimal / thousands separator).
 */
export function columnProblems(preview: PreviewResult | null): Map<number, string> {
  const out = new Map<number, string>();
  if (!preview) return out;
  const numeric = new Set<string>(['int', 'bigint', 'decimal', 'float']);
  for (const c of preview.columns) {
    if (!numeric.has(c.inferred.kind)) continue;
    for (const row of preview.rows) {
      const v = row[c.index];
      if (v === null || v === undefined || v.trim() === '') continue;
      if (!/^[+-]?[\d.,\s'٫٬]+(?:e[+-]?\d+)?$/i.test(asciiDigits(v.trim()))) {
        out.set(c.index, `"${v.length > 24 ? `${v.slice(0, 24)}…` : v}" is not a number`);
        break;
      }
    }
  }
  for (const w of preview.warnings) {
    for (const c of preview.columns) {
      if (c.name && !out.has(c.index) && (w.includes(`"${c.name}"`) || w.includes(`'${c.name}'`))) out.set(c.index, w);
    }
  }
  return out;
}
