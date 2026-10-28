// Chart settings remembered per query text: a hash of the (whitespace-normalised) SQL keys a small localStorage
// record. localStorage can be missing or throw (private windows, blocked storage), so every access is guarded and the
// chart works without it.
import type { ColumnInfo } from '../../api/types';
import { defaultSpec } from './suggest';
import { AGGS, BUCKETS, CHART_TYPES, SORTS, type ChartSpec } from './types';

const PREFIX = 'rowlit.chart.v1.';
const INDEX = `${PREFIX}index`;
const MAX_ENTRIES = 200;

/** FNV-1a (32 bit) of the SQL with runs of whitespace collapsed, as 8 hex digits. */
export function hashQuery(sql: string): string {
  const s = sql.trim().replace(/\s+/g, ' ');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const has = <T extends { id: string }>(list: readonly T[], v: unknown): v is T['id'] => typeof v === 'string' && list.some((x) => x.id === v);

/**
 * A stored or foreign object -> a valid spec for these columns (unknown columns dropped, bad enums reset to the
 * defaults). Returns null when nothing usable is left (no Y column), so the caller can fall back to a suggestion.
 */
export function sanitizeSpec(raw: unknown, columns: readonly ColumnInfo[]): ChartSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const names = new Set(columns.map((c) => c.name));
  const d = defaultSpec();
  const col = (v: unknown): string | null => (typeof v === 'string' && names.has(v) ? v : null);
  const y = Array.isArray(o.y)
    ? o.y.flatMap((s): ChartSpec['y'] => {
      const e = s as { column?: unknown; agg?: unknown } | null;
      const c = col(e?.column);
      return c ? [{ column: c, agg: has(AGGS, e?.agg) ? e.agg : 'sum' }] : [];
    }).slice(0, 8)
    : [];
  if (!y.length) return null;
  return {
    type: has(CHART_TYPES, o.type) ? o.type : d.type,
    x: col(o.x),
    y,
    group: col(o.group),
    bucket: has(BUCKETS, o.bucket) ? o.bucket : d.bucket,
    sort: has(SORTS, o.sort) ? o.sort : d.sort,
    topN: typeof o.topN === 'number' && o.topN >= 0 && o.topN <= 1000 ? Math.floor(o.topN) : 0,
    labels: o.labels === true,
    legend: o.legend !== false,
    log: o.log === true,
  };
}

export function loadSpec(sql: string, columns: readonly ColumnInfo[]): ChartSpec | null {
  const ls = store();
  if (!ls) return null;
  try {
    const text = ls.getItem(PREFIX + hashQuery(sql));
    return text ? sanitizeSpec(JSON.parse(text), columns) : null;
  } catch {
    return null;
  }
}

export function saveSpec(sql: string, spec: ChartSpec): void {
  const ls = store();
  if (!ls) return;
  try {
    const key = hashQuery(sql);
    ls.setItem(PREFIX + key, JSON.stringify(spec));
    // oldest entries go first so the store cannot grow without bound
    const index: string[] = (JSON.parse(ls.getItem(INDEX) ?? '[]') as string[]).filter((k) => k !== key);
    index.push(key);
    while (index.length > MAX_ENTRIES) ls.removeItem(PREFIX + (index.shift() as string));
    ls.setItem(INDEX, JSON.stringify(index));
  } catch {
    // storage full or blocked: the chart simply is not remembered
  }
}
