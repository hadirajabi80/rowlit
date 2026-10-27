import { describe, expect, it } from 'vitest';
import { autoBucket, bucketStart, buildChartData, MAX_SERIES } from './aggregate';
import { cols, rowsOf, SALES_COLUMNS, SALES_ROWS, spec } from './testKit';
import { toNumber, toTime } from './values';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sales = (patch: Parameters<typeof spec>[0]) => buildChartData(SALES_COLUMNS, rowsOf(SALES_ROWS), spec(patch));

describe('cell readers', () => {
  it('reads numbers from numbers, decimal strings and booleans, and nothing else', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('12.50')).toBe(12.5);
    expect(toNumber(' 7 ')).toBe(7);
    expect(toNumber(true)).toBe(1);
    expect(toNumber('abc')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(NaN)).toBeNull();
    expect(toNumber({ $trunc: '1', len: 9 })).toBeNull();
  });

  it('reads date and datetime text as wall-clock UTC instants, whatever the zone suffix', () => {
    expect(iso(toTime('2024-03-05')!)).toBe('2024-03-05');
    expect(toTime('2024-03-05T10:30:00')).toBe(Date.UTC(2024, 2, 5, 10, 30));
    expect(toTime('2024-03-05 10:30:00.123+02:00')).toBe(Date.UTC(2024, 2, 5, 10, 30));
    expect(toTime('not a date')).toBeNull();
    expect(toTime(5)).toBeNull();
  });
});

describe('time bucketing', () => {
  const t = Date.UTC(2024, 2, 7, 15, 45); // Thursday 2024-03-07
  it('floors to hour, day, month and year', () => {
    expect(bucketStart(t, 'hour')).toBe(Date.UTC(2024, 2, 7, 15));
    expect(bucketStart(t, 'day')).toBe(Date.UTC(2024, 2, 7));
    expect(bucketStart(t, 'month')).toBe(Date.UTC(2024, 2, 1));
    expect(bucketStart(t, 'year')).toBe(Date.UTC(2024, 0, 1));
  });

  it('starts weeks on Monday', () => {
    expect(iso(bucketStart(t, 'week'))).toBe('2024-03-04');
    expect(iso(bucketStart(Date.UTC(2024, 2, 4), 'week'))).toBe('2024-03-04'); // a Monday maps to itself
    expect(iso(bucketStart(Date.UTC(2024, 2, 10), 'week'))).toBe('2024-03-04'); // Sunday belongs to the week before
    expect(iso(bucketStart(Date.UTC(1969, 11, 31), 'week'))).toBe('1969-12-29'); // before the epoch
  });

  it('picks a unit from the span', () => {
    expect(autoBucket(DAY)).toBe('hour');
    expect(autoBucket(30 * DAY)).toBe('day');
    expect(autoBucket(150 * DAY)).toBe('week');
    expect(autoBucket(2 * 365 * DAY)).toBe('month');
    expect(autoBucket(30 * 365 * DAY)).toBe('year');
  });
});

describe('buildChartData', () => {
  it('sums, averages, counts, mins and maxes per category', () => {
    const run = (agg: 'sum' | 'avg' | 'count' | 'min' | 'max') => sales({ type: 'bar', x: 'region', y: [{ column: 'amount', agg }] }).series[0].values;
    // categories in result order: north, south, east
    expect(sales({ type: 'bar', x: 'region', y: [{ column: 'amount', agg: 'sum' }] }).categories.map((c) => c.label)).toEqual(['north', 'south', 'east']);
    expect(run('sum')).toEqual([35, 19, 5]);
    expect(run('avg')).toEqual([35 / 3, 9.5, 5]);
    expect(run('count')).toEqual([3, 2, 1]); // COUNT(col) ignores the null amount
    expect(run('min')).toEqual([4.5, 7, 5]);
    expect(run('max')).toEqual([20, 12, 5]);
  });

  it('names series after the aggregation, or after the group value', () => {
    expect(sales({ type: 'bar', x: 'region', y: [{ column: 'amount', agg: 'sum' }, { column: 'qty', agg: 'none' }] }).series.map((s) => s.name)).toEqual(['sum(amount)', 'qty']);
    const g = sales({ type: 'bar', x: 'day', bucket: 'month', group: 'region', y: [{ column: 'amount', agg: 'sum' }] });
    expect(g.series.map((s) => s.name).sort()).toEqual(['east', 'north', 'south']);
  });

  it('buckets a date column by month and orders it chronologically', () => {
    const d = sales({ type: 'line', x: 'day', bucket: 'month', y: [{ column: 'amount', agg: 'sum' }] });
    expect(d.xKind).toBe('time');
    expect(d.categories.map((c) => c.label)).toEqual(['2024-01', '2024-02', '2024-03']);
    expect(d.series[0].values).toEqual([22, 32, 5]);
  });

  it('auto-buckets by the span of the data (3 months -> days) and keeps raw timestamps for agg none', () => {
    const auto = sales({ type: 'line', x: 'day', y: [{ column: 'amount', agg: 'sum' }] });
    expect(auto.bucket).toBe('day');
    expect(auto.categories).toHaveLength(7);
    const raw = sales({ type: 'scatter', x: 'day', y: [{ column: 'amount', agg: 'none' }] });
    expect(raw.bucket).toBe('none');
    expect(raw.categories).toHaveLength(7);
  });

  it('splits series by a group column and keeps them aligned to the categories', () => {
    const d = sales({ type: 'stacked', x: 'day', bucket: 'month', group: 'region', y: [{ column: 'qty', agg: 'sum' }] });
    const byName = Object.fromEntries(d.series.map((s) => [s.name, s.values]));
    expect(byName.north).toEqual([3, 5, null]);
    expect(byName.south).toEqual([3, 4, null]);
    expect(byName.east).toEqual([null, null, 3]);
  });

  it('keeps only the biggest groups when there are too many', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [`g${i}`, 'k', i + 1] as [string, string, number]);
    const d = buildChartData(cols(['g', 'string'], ['k', 'string'], ['v', 'int']), rowsOf(rows), spec({ type: 'bar', x: 'k', group: 'g', y: [{ column: 'v', agg: 'sum' }] }));
    expect(d.series).toHaveLength(MAX_SERIES);
    expect(d.droppedSeries).toBe(8);
    expect(d.series[0].name).toBe('g19');
  });

  it('sorts by value or by x, and keeps the Top N', () => {
    const y = [{ column: 'amount', agg: 'sum' as const }];
    expect(sales({ type: 'bar', x: 'region', y, sort: 'y-desc' }).categories.map((c) => c.label)).toEqual(['north', 'south', 'east']);
    expect(sales({ type: 'bar', x: 'region', y, sort: 'y-asc' }).categories.map((c) => c.label)).toEqual(['east', 'south', 'north']);
    expect(sales({ type: 'bar', x: 'region', y, sort: 'x-asc' }).categories.map((c) => c.label)).toEqual(['east', 'north', 'south']);
    expect(sales({ type: 'bar', x: 'region', y, sort: 'x-desc' }).categories.map((c) => c.label)).toEqual(['south', 'north', 'east']);
    const top = sales({ type: 'bar', x: 'region', y, topN: 2 });
    expect(top.categories.map((c) => c.label)).toEqual(['north', 'south']);
    expect(top.droppedCategories).toBe(1);
  });

  it('folds the categories beyond Top N into "Other" for pie charts', () => {
    const d = sales({ type: 'pie', x: 'region', y: [{ column: 'amount', agg: 'sum' }], topN: 1 });
    expect(d.categories.map((c) => c.label)).toEqual(['north', 'Other']);
    expect(d.series[0].values).toEqual([35, 24]);
  });

  it('reads decimal strings, skips rows without a readable X and tolerates nulls', () => {
    const d = buildChartData(cols(['d', 'date'], ['v', 'decimal']), rowsOf([['2024-01-01', '1.5'], [null, '9'], ['garbage', '9'], ['2024-01-01', null]]), spec({ type: 'line', x: 'd', bucket: 'day', y: [{ column: 'v', agg: 'sum' }] }));
    expect(d.series[0].values).toEqual([1.5]);
    expect(d.usedRows).toBe(2); // the row whose value is null still has a readable X
    expect(d.skippedRows).toBe(2);
  });

  it('numeric X on a line is continuous and ordered; on a bar it is a labelled category', () => {
    const c = cols(['x', 'int'], ['y', 'int']);
    const r = rowsOf([[3, 30], [1, 10], [2, 20]]);
    const line = buildChartData(c, r, spec({ type: 'line', x: 'x', y: [{ column: 'y', agg: 'none' }] }));
    expect(line.xKind).toBe('number');
    expect(line.categories.map((k) => k.pos)).toEqual([1, 2, 3]);
    const bar = buildChartData(c, r, spec({ type: 'bar', x: 'x', y: [{ column: 'y', agg: 'none' }] }));
    expect(bar.xKind).toBe('category');
    expect(bar.categories.map((k) => k.label)).toEqual(['1', '2', '3']); // numbers keep their natural order
  });

  it('KPI aggregates everything into one value per series', () => {
    const d = sales({ type: 'kpi', y: [{ column: 'amount', agg: 'sum' }, { column: 'qty', agg: 'max' }] });
    expect(d.series.map((s) => s.values)).toEqual([[59], [5]]);
  });

  it('is empty without a valid Y column', () => {
    expect(sales({ type: 'bar', x: 'region', y: [{ column: 'nope', agg: 'sum' }] }).series).toEqual([]);
  });

  it('handles 100k rows quickly', () => {
    const big = Array.from({ length: 100_000 }, (_, i) => [`k${i % 500}`, i] as [string, number]);
    const t0 = performance.now();
    const d = buildChartData(cols(['k', 'string'], ['v', 'int']), rowsOf(big), spec({ type: 'bar', x: 'k', y: [{ column: 'v', agg: 'sum' }] }));
    expect(d.categories).toHaveLength(500);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
