// Reading cell values for charts: numbers, instants and category labels. Wire values are loose (decimals and big
// integers arrive as strings, dates as ISO text, truncated/binary cells as objects), so every reader is total.
import type { CellValue, ColumnInfo } from '../../api/types';
import type { ColumnClass } from './types';

export function classifyColumn(c: ColumnInfo): ColumnClass {
  switch (c.kind) {
    case 'int': case 'float': case 'decimal':
      return 'number';
    case 'date': case 'datetime': case 'datetimeoffset':
      return 'time';
    case 'string': case 'bool': case 'guid': case 'time':
      return 'category';
    default:
      return 'other';
  }
}

/** A finite number, or null (null cells, non-numeric text, truncated/binary objects). */
export function toNumber(v: CellValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  return null;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/;

/**
 * An instant in ms. Date/time text is read as wall-clock time (any zone suffix is ignored) and placed on the UTC
 * axis, so buckets and labels never shift with the machine's time zone.
 */
export function toTime(v: CellValue | undefined): number | null {
  if (typeof v !== 'string') return null;
  const m = ISO.exec(v.trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  return Number.isFinite(t) ? t : null;
}

/** Text of a category cell. */
export function categoryText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '(null)';
  if (typeof v === 'string') return v === '' ? '(empty)' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if ('$trunc' in v) return v.$trunc;
  if ('$bin' in v) return `(binary ${v.len} B)`;
  return '(cursor)';
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export type TimeUnit = 'hour' | 'day' | 'week' | 'month' | 'year' | 'none';

/** Label of an instant at the precision of its bucket unit. */
export function formatTime(ms: number, unit: TimeUnit): string {
  const d = new Date(ms);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  switch (unit) {
    case 'year': return pad(d.getUTCFullYear(), 4);
    case 'month': return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}`;
    case 'hour': return `${date} ${pad(d.getUTCHours())}:00`;
    case 'none':
      return d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds() ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
    default: return date;
  }
}
