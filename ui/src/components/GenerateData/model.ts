// Pure model of the Generate data tab: option editing, the request, validation of what the user typed and progress text.
import type {
  ColumnKind, GenerateColumn, GenerateOutcome, GenerateProgress, GenerateRequest, GenerateSummary, GeneratorInfo,
} from '../../api/types.generate';

export const GEN_SKIP = 'skip';
export const GEN_FOREIGN_KEY = 'foreignKey';

export const OUTCOME: Record<GenerateOutcome, { title: string; tone: 'ok' | 'warn' | 'error' }> = {
  completed: { title: 'Data generated', tone: 'ok' },
  completedWithErrors: { title: 'Data generated, some rows were rejected', tone: 'warn' },
  failed: { title: 'Generating data failed', tone: 'error' },
  cancelled: { title: 'Cancelled', tone: 'warn' },
};

export const PHASE_TEXT: Record<GenerateProgress['phase'], string> = {
  preparing: 'Preparing…',
  truncating: 'Deleting the existing rows…',
  generating: 'Generating and inserting rows…',
  committing: 'Committing…',
  done: 'Finishing…',
};

export interface GenerateSettings {
  /** The text of the rows field (parsed with parseRows). */
  rows: string;
  seed: number;
  truncateFirst: boolean;
  onError: 'stop' | 'skip';
  transaction: boolean;
}

export const DEFAULT_ROWS = 1000;

export function initialSettings(seed: number, rows: number = DEFAULT_ROWS): GenerateSettings {
  return { rows: String(rows), seed, truncateFirst: false, onError: 'stop', transaction: true };
}

/** 1,000 / 1 000 / 1000 -> 1000; null when it is not a whole number of at least 1 (or above max). */
export function parseRows(text: string, max: number): number | null {
  const t = text.replace(/[,\s_]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
}

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999_998);
}

/** Generators that can fill a column of the kind (the special skip / foreignKey entries are added by the row itself). */
export function generatorsFor(kind: ColumnKind, infos: GeneratorInfo[]): GeneratorInfo[] {
  return infos.filter((g) => g.id !== GEN_SKIP && g.id !== GEN_FOREIGN_KEY && g.kinds.includes(kind));
}

/** The picker's groups in the catalog's order. */
export function groupGenerators(list: GeneratorInfo[]): { group: string; items: GeneratorInfo[] }[] {
  const groups: { group: string; items: GeneratorInfo[] }[] = [];
  for (const g of list) {
    const found = groups.find((x) => x.group === g.group);
    if (found) found.items.push(g);
    else groups.push({ group: g.group, items: [g] });
  }
  return groups;
}

export function defaultOptions(info: GeneratorInfo | undefined): Record<string, string | null> {
  return Object.fromEntries((info?.options ?? []).map((o) => [o.key, o.default]));
}

/** The column with another generator: that generator's default options, the null share and unique flag stay. */
export function withGenerator(col: GenerateColumn, id: string, infos: GeneratorInfo[]): GenerateColumn {
  const info = infos.find((g) => g.id === id);
  return { ...col, generator: id, options: defaultOptions(info), note: null };
}

export function withOption(col: GenerateColumn, key: string, value: string): GenerateColumn {
  return { ...col, options: { ...col.options, [key]: value } };
}

export function withNullPercent(col: GenerateColumn, text: string): GenerateColumn {
  const n = Number(text.replace(',', '.'));
  return { ...col, nullPercent: Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0 };
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const DATE = /^(today|now|\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?)$/i;
const TIME = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** What is wrong with the options the user typed for a column (empty: nothing). Mirrors the engine's checks so the button is not enabled in vain. */
export function columnIssues(col: GenerateColumn, infos: GeneratorInfo[]): string[] {
  if (col.generator === GEN_SKIP || col.generator === GEN_FOREIGN_KEY) return [];
  const info = infos.find((g) => g.id === col.generator);
  if (!info) return [`Unknown generator '${col.generator}'.`];
  const out: string[] = [];
  const v = (key: string) => (col.options[key] ?? '').trim();
  for (const o of info.options) {
    const text = v(o.key);
    if (!text) {
      if (info.id === 'list' && o.key === 'values') out.push('Enter at least one value.');
      if (info.id === 'pattern' && o.key === 'pattern') out.push('Enter a pattern.');
      continue;
    }
    if (o.type === 'number' && !(NUMERIC.test(text) || (o.key === 'start' && text.toLowerCase() === 'auto'))) out.push(`${o.label} must be a number.`);
    if ((o.type === 'date' || o.type === 'datetime') && !DATE.test(text)) out.push(`${o.label} must be a date such as 2024-03-15.`);
    if (o.type === 'time' && !TIME.test(text)) out.push(`${o.label} must be a time such as 09:30:00.`);
  }
  if (out.length > 0) return out;
  if (info.id === 'int' || info.id === 'decimal') {
    if (v('min') && v('max') && Number(v('min')) > Number(v('max'))) out.push('Minimum is above the maximum.');
  }
  if (info.id === 'bool' && v('trueP') && (Number(v('trueP')) < 0 || Number(v('trueP')) > 100)) out.push('Chance of true must be between 0 and 100.');
  if ((info.id === 'date' || info.id === 'datetime') && /^\d{4}/.test(v('from')) && /^\d{4}/.test(v('to')) && v('from') > v('to')) out.push('"From" is after "To".');
  if (info.id === 'list' && v('values') && v('values').split(/\r?\n|,/).every((s) => !s.trim())) out.push('Enter at least one value.');
  return out;
}

export interface RunIssues {
  rows: string | null;
  columns: Record<string, string[]>;
  general: string | null;
}

export function runIssues(settings: GenerateSettings, columns: GenerateColumn[], infos: GeneratorInfo[], maxRows: number): RunIssues {
  const cols: Record<string, string[]> = {};
  for (const c of columns) {
    const issues = columnIssues(c, infos);
    if (issues.length > 0) cols[c.name] = issues;
  }
  const active = columns.filter((c) => c.generator !== GEN_SKIP && !c.isComputed);
  return {
    rows: parseRows(settings.rows, maxRows) === null ? `Enter a whole number from 1 to ${maxRows.toLocaleString('en-US')}.` : null,
    columns: cols,
    general: active.length === 0 ? 'Every column is skipped: there is nothing to generate.' : null,
  };
}

export function hasIssues(i: RunIssues): boolean {
  return !!i.rows || !!i.general || Object.keys(i.columns).length > 0;
}

export interface Target {
  connectionId: string;
  database: string | null;
  schema: string | null;
  table: string;
}

export function buildRequest(target: Target, settings: GenerateSettings, columns: GenerateColumn[], maxRows: number, opts: { previewRows?: number } = {}): GenerateRequest {
  const rows = parseRows(settings.rows, maxRows) ?? 1;
  const req: GenerateRequest = {
    connectionId: target.connectionId, database: target.database, schema: target.schema, table: target.table,
    rows, seed: settings.seed, columns, truncateFirst: settings.truncateFirst, transaction: settings.transaction, onError: settings.onError,
  };
  if (opts.previewRows) req.previewRows = opts.previewRows;
  return req;
}

/** A signature of everything the preview depends on (the number of rows only matters through unique columns). */
export function previewKey(settings: GenerateSettings, columns: GenerateColumn[]): string {
  return JSON.stringify([settings.rows, settings.seed, settings.truncateFirst, columns]);
}

export function progressPercent(p: GenerateProgress | null): number | null {
  if (!p || !p.total) return null;
  return Math.max(0, Math.min(100, (p.rows / p.total) * 100));
}

export function summaryLine(s: GenerateSummary): string {
  const parts = [`${s.rowsWritten.toLocaleString('en-US')} of ${s.rowsRequested.toLocaleString('en-US')} rows written`];
  if (s.errorCount > 0) parts.push(`${s.errorCount.toLocaleString('en-US')} rejected`);
  if (s.truncated) parts.push('existing rows deleted first');
  if (s.rolledBack) parts.push('everything rolled back');
  return parts.join(' · ');
}

/** Badge text for the roles of a column in the table. */
export function roleBadges(c: GenerateColumn): string[] {
  const out: string[] = [];
  if (c.isPk) out.push('PK');
  if (c.foreignKey) out.push('FK');
  if (c.isIdentity) out.push('identity');
  if (c.isComputed) out.push('computed');
  return out;
}

/** The generator ids a column's picker offers, with the special entries first. */
export function pickerSpecials(c: GenerateColumn): { id: string; label: string }[] {
  const out = [{ id: GEN_SKIP, label: c.isComputed ? 'Skip (computed column)' : 'Skip (database default or identity)' }];
  if (c.foreignKey) out.push({ id: GEN_FOREIGN_KEY, label: 'Parent table value' });
  return out;
}
