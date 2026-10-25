// Date / time pattern of the text exports (CSV, TSV, Markdown, JSON). Wire values are ISO 8601 text, so the pattern is
// applied to the text itself: no time zone conversion, nothing is shifted or lost. Tokens (as in .NET, and exactly as
// the engine's ExportDateFormat does for server-side exports): yyyy yy MM dd HH mm ss f..fffffff (fraction) zzz
// (offset; +00:00 for Z). Text in single quotes is literal; anything else is copied.
import type { CellValue, ColumnInfo } from '../../api/types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_TIME = /^(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?$/;

export const DATE_KINDS: readonly string[] = ['date', 'datetime', 'datetimeoffset', 'time'];

const normalizeOffset = (o: string) => (o === 'Z' ? '+00:00' : o.length === 5 ? `${o.slice(0, 3)}:${o.slice(3)}` : o);

interface Parts { y: string; mo: string; d: string; h: string; mi: string; s: string; off: string }
const TOKENS: Record<string, (p: Parts) => string> = {
  y4: (p) => p.y, y2: (p) => p.y.slice(2), M2: (p) => p.mo, d2: (p) => p.d, H2: (p) => p.h, m2: (p) => p.mi, s2: (p) => p.s, z3: (p) => p.off,
};

/** The ISO text formatted with `pattern`; the text unchanged when it is not an ISO date or time (or the pattern is empty). */
export function formatDatePattern(text: string, pattern: string): string {
  if (!pattern) return text;
  let y: string, mo: string, d: string, h = '00', mi = '00', s = '00', frac = '', off = '';
  const m = ISO_DATE.exec(text);
  if (m) {
    y = m[1]; mo = m[2]; d = m[3];
    if (m[4] !== undefined) { h = m[4]; mi = m[5]; s = m[6]; }
    frac = m[7] ?? '';
    if (m[8] !== undefined) off = normalizeOffset(m[8]);
  } else {
    const t = ISO_TIME.exec(text);
    if (!t) return text;
    y = '0001'; mo = '01'; d = '01';
    h = t[1]; mi = t[2]; s = t[3];
    frac = t[4] ?? '';
  }
  let out = '';
  for (let i = 0; i < pattern.length;) {
    const c = pattern[i];
    if (c === "'") {
      const end = pattern.indexOf("'", i + 1);
      if (end < 0) {
        out += pattern.slice(i + 1);
        break;
      }
      out += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    let run = 1;
    while (i + run < pattern.length && pattern[i + run] === c) run++;
    const token = c === 'f' && run <= 7 ? frac.padEnd(run, '0').slice(0, run) : TOKENS[`${c}${run}`]?.({ y, mo, d, h, mi, s, off });
    if (token === undefined) {
      // not a token (or an unsupported run length): copied as is, one character at a time
      out += c;
      i++;
    } else {
      out += token;
      i += run;
    }
  }
  return out;
}

/** The rows with the pattern applied to the date / time cells (other cells and columns are the same objects). */
export function applyDatePattern(columns: readonly ColumnInfo[], rows: CellValue[][], pattern: string): CellValue[][] {
  if (!pattern) return rows;
  const cols = columns.map((c, i) => (DATE_KINDS.includes(c.kind) ? i : -1)).filter((i) => i >= 0);
  if (!cols.length) return rows;
  return rows.map((r) => {
    let copy: CellValue[] | null = null;
    for (const i of cols) {
      const v = r[i];
      if (typeof v !== 'string') continue;
      const f = formatDatePattern(v, pattern);
      if (f === v) continue;
      copy ??= r.slice();
      copy[i] = f;
    }
    return copy ?? r;
  });
}

/** Choices of the dialog ('' = as stored, ISO 8601). */
export const DATE_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'As stored (ISO 8601)' },
  { value: 'yyyy-MM-dd HH:mm:ss', label: 'yyyy-MM-dd HH:mm:ss' },
  { value: 'yyyy/MM/dd HH:mm:ss', label: 'yyyy/MM/dd HH:mm:ss' },
  { value: 'dd/MM/yyyy HH:mm:ss', label: 'dd/MM/yyyy HH:mm:ss' },
  { value: 'MM/dd/yyyy HH:mm:ss', label: 'MM/dd/yyyy HH:mm:ss' },
  { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd (date only)' },
];
