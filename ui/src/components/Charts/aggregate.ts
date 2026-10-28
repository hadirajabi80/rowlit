// Result rows -> chart data: time bucketing, grouping, aggregation, sorting and Top-N. One pass over the rows
// (linear in rows x series), so 100k-row results chart without a visible pause.
import type { ColumnInfo } from '../../api/types';
import type { Agg, Bucket, Category, ChartData, ChartSpec, DataSeries, RowSource, XKind } from './types';
import { categoryText, classifyColumn, formatTime, toNumber, toTime, type TimeUnit } from './values';

export const MAX_SERIES = 12;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Start of the bucket of `unit` containing `ms` (weeks start on Monday). */
export function bucketStart(ms: number, unit: TimeUnit): number {
  switch (unit) {
    case 'hour': return Math.floor(ms / HOUR) * HOUR;
    case 'day': return Math.floor(ms / DAY) * DAY;
    case 'week': {
      const day = Math.floor(ms / DAY); // 1970-01-01 was a Thursday: (day + 3) % 7 is 0 on Mondays
      return (day - (((day + 3) % 7) + 7) % 7) * DAY;
    }
    case 'month': {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    }
    case 'year': return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1);
    default: return ms;
  }
}

/** The unit that gives a readable number of points for a time span. */
export function autoBucket(spanMs: number): Exclude<Bucket, 'auto' | 'none'> {
  if (spanMs <= 2 * DAY) return 'hour';
  if (spanMs <= 92 * DAY) return 'day';
  if (spanMs <= 200 * DAY) return 'week';
  if (spanMs <= 3650 * DAY) return 'month';
  return 'year';
}

interface Acc { sum: number; n: number; nn: number; min: number; max: number; last: number | null }
const newAcc = (): Acc => ({ sum: 0, n: 0, nn: 0, min: Infinity, max: -Infinity, last: null });

function accValue(a: Acc, agg: Agg): number | null {
  switch (agg) {
    case 'sum': return a.n ? a.sum : null;
    case 'avg': return a.n ? a.sum / a.n : null;
    case 'count': return a.nn;
    case 'min': return a.n ? a.min : null;
    case 'max': return a.n ? a.max : null;
    default: return a.last;
  }
}

interface CatAcc { cat: Category; cells: Map<string, Acc[]> }

export function emptyData(spec: ChartSpec): ChartData {
  return { xKind: 'category', xName: spec.x, categories: [], series: [], usedRows: 0, skippedRows: 0, droppedCategories: 0, droppedSeries: 0, bucket: 'none' };
}

const BAND_TYPES = new Set(['bar', 'hbar', 'stacked', 'pie', 'donut']);

export function buildChartData(columns: readonly ColumnInfo[], rows: RowSource, spec: ChartSpec): ChartData {
  const isKpi = spec.type === 'kpi';
  const xi = isKpi || !spec.x ? -1 : columns.findIndex((c) => c.name === spec.x);
  const gi = isKpi || spec.type === 'pie' || spec.type === 'donut' || !spec.group ? -1 : columns.findIndex((c) => c.name === spec.group);
  const ys = spec.y.map((s) => ({ ci: columns.findIndex((c) => c.name === s.column), ...s })).filter((s) => s.ci >= 0);
  const out = emptyData(spec);
  if (!ys.length) return out;
  const allNone = ys.every((s) => s.agg === 'none');
  const xClass = xi >= 0 ? classifyColumn(columns[xi]) : 'other';
  const xKind: XKind = xi < 0 ? 'category' : xClass === 'time' ? 'time' : xClass === 'number' && !BAND_TYPES.has(spec.type) ? 'number' : 'category';
  const numericX = xClass === 'number';
  /** The X values have a natural order (instants, numbers); categories keep the result order. */
  const continuous = xClass === 'time' || numericX;
  out.xKind = xKind;
  out.xName = xi >= 0 ? columns[xi].name : null;

  // Time: the bucket unit (auto needs the span first).
  let unit: TimeUnit = 'none';
  if (xClass === 'time') {
    if (spec.bucket === 'auto') {
      if (allNone) unit = 'none';
      else {
        let lo = Infinity, hi = -Infinity;
        for (let r = 0; r < rows.length; r++) {
          const t = toTime(rows.get(r)?.[xi]);
          if (t !== null) { if (t < lo) lo = t; if (t > hi) hi = t; }
        }
        unit = hi >= lo ? autoBucket(hi - lo) : 'day';
      }
    } else unit = spec.bucket;
  }
  out.bucket = unit;

  const raw = gi < 0 && allNone; // every row is a point of its own (scatter, raw line)
  const cats = new Map<string, CatAcc>();
  const groupTotals = new Map<string, number>();
  for (let r = 0; r < rows.length; r++) {
    const row = rows.get(r);
    if (!row) continue;
    let key: string, label: string, pos: number;
    if (xi < 0) { key = label = 'All'; pos = 0; }
    else if (xClass === 'time') {
      const t = toTime(row[xi]);
      if (t === null) { out.skippedRows++; continue; }
      pos = bucketStart(t, unit);
      key = String(pos);
      label = formatTime(pos, unit);
    } else if (numericX) {
      const n = toNumber(row[xi]);
      if (n === null) { out.skippedRows++; continue; }
      pos = n; key = String(n); label = String(n);
    } else { label = categoryText(row[xi]); key = label; pos = cats.size; }
    if (raw) key += `\u0000${r}`;
    let ca = cats.get(key);
    if (!ca) {
      ca = { cat: { key, label, pos: xi >= 0 && !continuous ? cats.size : pos }, cells: new Map() };
      cats.set(key, ca);
    }
    const g = gi >= 0 ? categoryText(row[gi]) : '';
    let cell = ca.cells.get(g);
    if (!cell) { cell = ys.map(newAcc); ca.cells.set(g, cell); }
    let rowTotal = 0;
    for (let j = 0; j < ys.length; j++) {
      const v = row[ys[j].ci];
      if (v === null || v === undefined) continue;
      const a = cell[j];
      a.nn++;
      const n = toNumber(v);
      if (n === null) continue;
      a.n++; a.sum += n; a.last = n;
      if (n < a.min) a.min = n;
      if (n > a.max) a.max = n;
      rowTotal += Math.abs(n);
    }
    if (gi >= 0) groupTotals.set(g, (groupTotals.get(g) ?? 0) + rowTotal);
    out.usedRows++;
  }

  // Series: one per Y, or one per (group x Y). Too many groups: keep the biggest.
  let groups = gi >= 0 ? [...groupTotals.keys()] : [''];
  if (gi >= 0 && groups.length > MAX_SERIES) {
    groups = groups.sort((a, b) => (groupTotals.get(b) ?? 0) - (groupTotals.get(a) ?? 0)).slice(0, MAX_SERIES);
    out.droppedSeries = groupTotals.size - MAX_SERIES;
  } else if (gi >= 0) groups.sort((a, b) => (groupTotals.get(b) ?? 0) - (groupTotals.get(a) ?? 0));
  const list = [...cats.values()];
  const series: DataSeries[] = [];
  for (const g of groups) {
    for (let j = 0; j < ys.length; j++) {
      const y = ys[j];
      series.push({
        name: gi >= 0 ? (ys.length > 1 ? `${g} · ${y.column}` : g) : seriesName(y.column, y.agg),
        column: y.column,
        agg: y.agg,
        values: list.map((ca) => { const c = ca.cells.get(g); return c ? accValue(c[j], y.agg) : null; }),
      });
    }
  }

  // Order and Top-N.
  const total = (i: number) => series.reduce((s, d) => s + Math.abs(d.values[i] ?? 0), 0);
  const totals = list.map((_, i) => total(i));
  let order = list.map((_, i) => i);
  const byPos = (a: number, b: number) => list[a].cat.pos - list[b].cat.pos;
  const byLabel = (a: number, b: number) => list[a].cat.label.localeCompare(list[b].cat.label, undefined, { numeric: true });
  const byX = continuous ? byPos : byLabel;
  const sorter = (mode: ChartSpec['sort']): ((a: number, b: number) => number) | null => {
    switch (mode) {
      case 'x-asc': return byX;
      case 'x-desc': return (a, b) => byX(b, a);
      case 'y-desc': return (a, b) => totals[b] - totals[a];
      case 'y-asc': return (a, b) => totals[a] - totals[b];
      default: return continuous ? byPos : null;
    }
  };
  let folded: (number | null)[][] | null = null;
  if (spec.topN > 0 && order.length > spec.topN) {
    const keep = [...order].sort((a, b) => totals[b] - totals[a]).slice(0, spec.topN);
    const keepSet = new Set(keep);
    out.droppedCategories = order.length - keep.length;
    if (spec.type === 'pie' || spec.type === 'donut') {
      folded = series.map((d) => {
        let sum = 0, any = false;
        d.values.forEach((v, i) => { if (!keepSet.has(i) && v !== null) { sum += v; any = true; } });
        return [any ? sum : null];
      });
    }
    // Top-N without an explicit order lists the biggest first (a continuous X stays in order).
    const s = sorter(spec.sort);
    order = s ? keep.sort(s) : keep;
  } else {
    const s = sorter(spec.sort);
    if (s) order = order.sort(s);
  }
  out.categories = order.map((i) => list[i].cat);
  out.series = series.map((d) => ({ ...d, values: order.map((i) => d.values[i]) }));
  if (folded) {
    const rest = folded;
    out.categories.push({ key: '\u0000other', label: 'Other', pos: out.categories.length });
    out.series.forEach((d, k) => d.values.push(rest[k][0]));
  }
  return out;
}

export function seriesName(column: string, agg: Agg): string {
  return agg === 'none' ? column : `${agg}(${column})`;
}
