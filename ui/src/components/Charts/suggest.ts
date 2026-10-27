// Picks a sensible first chart for a result set from its column types (the same idea as DataGrip's chart view):
// date + number -> line, category + number -> bar, number + number -> scatter, a single row -> KPI numbers.
import type { ColumnInfo } from '../../api/types';
import type { ChartSpec, ColumnClass, RowSource } from './types';
import { categoryText, classifyColumn, toTime } from './values';

export function defaultSpec(): ChartSpec {
  return { type: 'bar', x: null, y: [], group: null, bucket: 'auto', sort: 'none', topN: 0, labels: false, legend: true, log: false };
}

const SAMPLE = 2000;
const RAW_POINTS = 300;
/** A numeric column that identifies rows rather than measuring something (id, customer_id, OrderId). */
export function looksLikeId(c: ColumnInfo): boolean {
  return c.isKey || /(^|[_\s.])id$/i.test(c.name) || /[a-z]Id$/.test(c.name);
}

interface Info { name: string; cls: ColumnClass; col: ColumnInfo; distinct: number }

export function suggestSpec(columns: readonly ColumnInfo[], rows: RowSource): ChartSpec | null {
  const n = Math.min(rows.length, SAMPLE);
  if (!columns.length || !n) return null;
  const infos: Info[] = columns.map((c) => ({ name: c.name, cls: classifyColumn(c), col: c, distinct: 0 }));
  for (const info of infos) {
    if (info.cls !== 'category' && info.cls !== 'time') continue;
    const idx = columns.indexOf(info.col);
    const seen = new Set<string>();
    for (let r = 0; r < n; r++) {
      const v = rows.get(r)?.[idx];
      seen.add(info.cls === 'time' ? String(toTime(v)) : categoryText(v));
    }
    info.distinct = seen.size;
  }
  const times = infos.filter((i) => i.cls === 'time');
  const cats = infos.filter((i) => i.cls === 'category');
  const nums = infos.filter((i) => i.cls === 'number');
  const measures = nums.filter((i) => !looksLikeId(i.col));
  const ys = (measures.length ? measures : nums).slice(0, 3);
  const base = defaultSpec();

  if (n === 1 && ys.length) return { ...base, type: 'kpi', y: ys.slice(0, 4).map((i) => ({ column: i.name, agg: 'none' })) };

  if (times.length && ys.length) {
    const t = times[0];
    // few rows that are each their own instant: plot them as they are; many rows are summed per bucket
    const unique = t.distinct >= n && n <= RAW_POINTS;
    return { ...base, type: 'line', x: t.name, y: ys.map((i) => ({ column: i.name, agg: unique ? 'none' : 'sum' })), bucket: unique ? 'none' : 'auto' };
  }
  if (cats.length && ys.length) {
    // The first column that groups rows (a column unique per row is a label, so any category is still fine for it).
    const c = cats.find((i) => i.distinct < n || n <= 50) ?? cats[0];
    const many = c.distinct > 25;
    return { ...base, type: 'bar', x: c.name, y: [{ column: ys[0].name, agg: 'sum' }], sort: many ? 'y-desc' : 'none', topN: many ? 20 : 0 };
  }
  if (nums.length >= 2) {
    const [a, b] = measures.length >= 2 ? measures : nums;
    return { ...base, type: 'scatter', x: a.name, y: [{ column: b.name, agg: 'none' }], legend: false };
  }
  if (cats.length) {
    const c = cats[0];
    const many = c.distinct > 25;
    return { ...base, type: 'bar', x: c.name, y: [{ column: c.name, agg: 'count' }], sort: 'y-desc', topN: many ? 20 : 0 };
  }
  if (ys.length) return { ...base, type: 'kpi', y: [{ column: ys[0].name, agg: 'sum' }] };
  if (times.length) return { ...base, type: 'line', x: times[0].name, y: [{ column: times[0].name, agg: 'count' }], bucket: 'auto' };
  return null;
}
