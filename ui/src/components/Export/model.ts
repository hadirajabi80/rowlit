// Pure parts of the export dialog: default settings, the engine options of a format, scope helpers, file names and
// the remembered preferences. No React, no engine calls (tested in __tests__/exportModel.test.ts).
import type { ExportFormat, ExportOptions } from '../../api/types';
import { EXPORT_EXT } from '../../lib/exportFormats';
import { SERVER_SCOPES, type ExportScopeId, type ExportSettings, type ScopeOption } from './types';

export const DEFAULT_SETTINGS: ExportSettings = {
  format: 'csv', header: true, delimiter: ',', bom: false, nullText: null, dateFormat: '', tableName: '', sqlDialect: null, sheetName: '', openAfter: false,
};

/** Formats made of text: a byte order mark and the date pattern apply to them (the Excel workbook has typed cells). */
export const isBinaryFormat = (f: ExportFormat): boolean => f === 'xlsx';
export const isTextFormat = (f: ExportFormat): boolean => !isBinaryFormat(f);

/** Dropdown label of a format. */
export const EXPORT_LABEL: Record<ExportFormat, string> = {
  csv: 'CSV (comma-separated)', tsv: 'TSV (tab-separated)', json: 'JSON', 'sql-insert': 'SQL INSERT statements', markdown: 'Markdown table', xlsx: 'Excel workbook (.xlsx)',
};
/** Date / time cells are re-written with the pattern in these formats (SQL INSERT keeps the ISO literals). */
export const supportsDateFormat = (f: ExportFormat): boolean => f === 'csv' || f === 'tsv' || f === 'json' || f === 'markdown';
export const supportsHeader = (f: ExportFormat): boolean => f === 'csv' || f === 'tsv';
export const supportsNullText = (f: ExportFormat): boolean => f === 'csv' || f === 'tsv' || f === 'markdown';

/** NULL text a format uses when the user did not choose one. */
export const defaultNullText = (f: ExportFormat): string => (f === 'markdown' ? 'NULL' : '');

export const nullTextOf = (s: ExportSettings): string => s.nullText ?? defaultNullText(s.format);

/** The options the engine writes the file with (also what the client-side writers follow). */
export function exportOptions(s: ExportSettings, defaults: { sheetName?: string | null } = {}): ExportOptions {
  const o: ExportOptions = {};
  if (supportsHeader(s.format)) o.header = s.header;
  if (s.format === 'csv') o.delimiter = s.delimiter === '\t' ? '\\t' : s.delimiter || ',';
  if (supportsNullText(s.format)) o.nullAs = nullTextOf(s);
  if (isTextFormat(s.format) && s.bom) o.bom = true;
  if (supportsDateFormat(s.format) && s.dateFormat) o.dateFormat = s.dateFormat;
  if (s.format === 'sql-insert') {
    if (s.tableName.trim()) o.tableName = s.tableName.trim();
    if (s.sqlDialect) o.targetDialect = s.sqlDialect;
  }
  if (s.format === 'xlsx') {
    const sheet = s.sheetName.trim() || defaults.sheetName?.trim();
    if (sheet) o.sheetName = sheet;
  }
  return o;
}

export const isServerScope = (id: ExportScopeId): boolean => SERVER_SCOPES.includes(id);

/** "1,000 rows", "~1,234,567 rows (estimate)", "" while unknown. */
export function scopeCountText(o: Pick<ScopeOption, 'count' | 'countKind'>, fmt: (n: number) => string = (n) => n.toLocaleString('en-US')): string {
  if (o.count === null) return '';
  const n = fmt(o.count);
  return o.countKind === 'estimate' ? `~${n} rows` : `${n} row${o.count === 1 ? '' : 's'}`;
}

/** File name of an export: letters of any script stay (a Persian table name gives a Persian file name). */
export function exportFileName(baseName: string, format: ExportFormat): string {
  const base = baseName.replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^_+|_+$/g, '') || 'export';
  return `${base}.${EXPORT_EXT[format]}`;
}

const SEP = /[\\/]/;

/** Folder of a path (empty when it has none). */
export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i < 0 ? '' : path.slice(0, i);
}

/** `dir` + `name`, with the separator the folder already uses. */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : dir.includes('/') && !dir.includes('\\') ? '/' : dir.match(SEP)?.[0] ?? '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** The path with its extension swapped for the format's (only the extension of a known export format is replaced). */
export function withFormatExtension(path: string, format: ExportFormat): string {
  const exts = new Set(Object.values(EXPORT_EXT));
  const m = /^(.*)\.([A-Za-z0-9]+)$/.exec(path);
  if (!m) return path;
  return exts.has(m[2].toLowerCase()) ? `${m[1]}.${EXPORT_EXT[format]}` : path;
}

// ---------------------------------------------------------------- remembered preferences

const PREFS_KEY = 'rowlit.export.v1';

type Prefs = Partial<Pick<ExportSettings, 'format' | 'header' | 'delimiter' | 'bom' | 'nullText' | 'dateFormat' | 'openAfter'>> & { dir?: string };

const PREF_FORMATS = new Set<string>(Object.keys(EXPORT_EXT));

export function loadPrefs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Prefs {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: Prefs = {};
    if (typeof p.format === 'string' && PREF_FORMATS.has(p.format)) out.format = p.format as ExportFormat;
    if (typeof p.header === 'boolean') out.header = p.header;
    if (typeof p.delimiter === 'string' && p.delimiter.length >= 1 && p.delimiter.length <= 2) out.delimiter = p.delimiter;
    if (typeof p.bom === 'boolean') out.bom = p.bom;
    if (typeof p.nullText === 'string' || p.nullText === null) out.nullText = p.nullText;
    if (typeof p.dateFormat === 'string' && p.dateFormat.length <= 40) out.dateFormat = p.dateFormat;
    if (typeof p.openAfter === 'boolean') out.openAfter = p.openAfter;
    if (typeof p.dir === 'string') out.dir = p.dir;
    return out;
  } catch {
    return {};
  }
}

export function savePrefs(s: ExportSettings, dir: string | undefined, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    const p: Prefs = { format: s.format, header: s.header, delimiter: s.delimiter, bom: s.bom, nullText: s.nullText, dateFormat: s.dateFormat, openAfter: s.openAfter, dir };
    storage?.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota: the dialog starts from its defaults next time */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
