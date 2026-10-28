import { describe, expect, it } from 'vitest';
import { buildChartData } from './aggregate';
import { buildScene, SPARSE_MARKS, timeTicks } from './scene';
import type { Shape } from './sceneTypes';
import { cols, rowsOf, SALES_COLUMNS, SALES_ROWS, spec } from './testKit';
import type { CellValue } from '../../api/types';

const make = (patch: Parameters<typeof spec>[0], w = 640, h = 360, rows: CellValue[][] = SALES_ROWS, columns = SALES_COLUMNS) =>
  buildScene(buildChartData(columns, rowsOf(rows), spec(patch)), spec(patch), w, h);
const of = <K extends Shape['k']>(sc: { shapes: Shape[] }, k: K) => sc.shapes.filter((s): s is Extract<Shape, { k: K }> => s.k === k);
const texts = (sc: { shapes: Shape[] }, cls: string) => of(sc, 'text').filter((t) => t.cls === cls).map((t) => t.text);

describe('cartesian scenes', () => {
  const y = [{ column: 'amount', agg: 'sum' as const }];

  it('bar: one rect per category with heights proportional to the value', () => {
    const sc = make({ type: 'bar', x: 'region', y });
    const bars = of(sc, 'rect').filter((r) => r.mark !== undefined);
    expect(bars).toHaveLength(3);
    expect(bars[0].h / bars[2].h).toBeCloseTo(35 / 5, 1);
    expect(sc.marks.map((m) => m.title)).toEqual(['north', 'south', 'east']);
    expect(texts(sc, 'tick')).toEqual(expect.arrayContaining(['north', 'south', 'east', '0', '40']));
    expect(sc.title).toBe('Bar chart of sum(amount) by region');
  });

  it('horizontal bar: categories on the left, bars grow to the right', () => {
    const sc = make({ type: 'hbar', x: 'region', y });
    const bars = of(sc, 'rect').filter((r) => r.mark !== undefined);
    expect(sc.horizontal).toBe(true);
    expect(bars[0].w / bars[2].w).toBeCloseTo(7, 0);
    expect(bars[0].y).toBeLessThan(bars[1].y);
  });

  it('stacked bar: the stack of a category is as tall as the sum of its series', () => {
    const sc = make({ type: 'stacked', x: 'day', bucket: 'month', group: 'region', y: [{ column: 'qty', agg: 'sum' }] });
    const jan = of(sc, 'rect').filter((r) => r.mark !== undefined && sc.marks[r.mark].cat === 0);
    const total = jan.reduce((s, r) => s + r.h, 0);
    const feb = of(sc, 'rect').filter((r) => r.mark !== undefined && sc.marks[r.mark].cat === 1);
    expect(total / feb.reduce((s, r) => s + r.h, 0)).toBeCloseTo(6 / 9, 1);
    expect(sc.marks.length).toBe(5);
    expect(texts(sc, 'legend').sort()).toEqual(['east', 'north', 'south']);
  });

  it('log scale: ticks are powers of ten and equal ratios are equally tall', () => {
    const rows: CellValue[][] = [['a', 1], ['b', 10], ['c', 100], ['d', 1000]];
    const c = cols(['k', 'string'], ['v', 'int']);
    const sc = make({ type: 'bar', x: 'k', y: [{ column: 'v', agg: 'sum' }], log: true }, 640, 360, rows, c);
    expect(texts(sc, 'tick')).toEqual(expect.arrayContaining(['1', '10', '100', '1K']));
    const h = of(sc, 'rect').filter((r) => r.mark !== undefined).map((r) => r.h);
    expect(h[2] - h[1]).toBeCloseTo(h[3] - h[2], 0);
  });

  it('line with a time X is continuous: marks are ordered left to right with a date axis', () => {
    const sc = make({ type: 'line', x: 'day', bucket: 'month', y });
    expect(sc.marks.map((m) => m.title)).toEqual(['2024-01', '2024-02', '2024-03']);
    expect(sc.marks[0].x).toBeLessThan(sc.marks[1].x);
    expect(of(sc, 'path').some((p) => p.stroke.startsWith('var(--chart-'))).toBe(true);
    expect(texts(sc, 'tick').some((t) => /^2024-0\d/.test(t))).toBe(true);
  });

  it('area adds a filled path under the line', () => {
    const paths = of(make({ type: 'area', x: 'day', bucket: 'month', y }), 'path');
    expect(paths.some((p) => p.fo && p.d.endsWith('Z'))).toBe(true);
  });

  it('a null value breaks the line instead of drawing through it', () => {
    const rows: CellValue[][] = [[1, 1], [2, null], [3, 3]];
    const sc = make({ type: 'line', x: 'x', y: [{ column: 'y', agg: 'none' }] }, 640, 360, rows, cols(['x', 'int'], ['y', 'int']));
    const line = of(sc, 'path').find((p) => p.fill === 'none')!;
    expect(line.d.match(/M/g)).toHaveLength(2);
  });

  it('downsamples a 50k point line with LTTB and keeps the marks bounded', () => {
    const rows: CellValue[][] = Array.from({ length: 50_000 }, (_, i) => [i, Math.sin(i / 400) * 100]);
    const t0 = performance.now();
    const sc = make({ type: 'line', x: 'x', y: [{ column: 'y', agg: 'none' }] }, 800, 400, rows, cols(['x', 'int'], ['y', 'float']));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(sc.thinned).toBeGreaterThan(48_000);
    expect(sc.marks.length).toBeLessThanOrEqual(1200);
    expect(sc.marks.length).toBeGreaterThan(SPARSE_MARKS); // dense: the chart is a single focus stop
  });

  it('draws a dense scatter as one path of dots', () => {
    const rows: CellValue[][] = Array.from({ length: 20_000 }, (_, i) => [i % 997, (i * 31) % 389]);
    const sc = make({ type: 'scatter', x: 'x', y: [{ column: 'y', agg: 'none' }] }, 640, 360, rows, cols(['x', 'int'], ['y', 'int']));
    expect(of(sc, 'dots')).toHaveLength(1);
    expect(of(sc, 'dot')).toHaveLength(0);
    expect(sc.marks.length).toBeLessThanOrEqual(2000);
  });

  it('shows value labels on bars when asked', () => {
    expect(texts(make({ type: 'bar', x: 'region', y, labels: true }), 'label')).toEqual(['35', '19', '5']);
    expect(texts(make({ type: 'bar', x: 'region', y, labels: false }), 'label')).toEqual([]);
  });

  it('puts a legend only when there are several series and it is switched on', () => {
    const two = [{ column: 'amount', agg: 'sum' as const }, { column: 'qty', agg: 'sum' as const }];
    expect(texts(make({ type: 'bar', x: 'region', y: two }), 'legend')).toEqual(['sum(amount)', 'sum(qty)']);
    expect(texts(make({ type: 'bar', x: 'region', y: two, legend: false }), 'legend')).toEqual([]);
    expect(texts(make({ type: 'bar', x: 'region', y }), 'legend')).toEqual([]);
  });

  it('rotates long category labels instead of overlapping them', () => {
    const rows: CellValue[][] = Array.from({ length: 12 }, (_, i) => [`a long category name ${i}`, i + 1]);
    const sc = make({ type: 'bar', x: 'k', y: [{ column: 'v', agg: 'sum' }] }, 480, 300, rows, cols(['k', 'string'], ['v', 'int']));
    expect(of(sc, 'text').some((t) => t.rotate === -40)).toBe(true);
  });

  it('reports empty states', () => {
    expect(make({ type: 'bar', x: 'region', y: [] }).message).toMatch(/Choose a Y column/);
    expect(make({ type: 'bar', x: 'region', y }, 640, 360, []).message).toMatch(/No rows/);
    expect(make({ type: 'bar', x: 'region', y: [{ column: 'amount', agg: 'sum' }], log: true }, 640, 360, [['a', '2024-01-01', '-3', 1]]).message).toMatch(/log scale/);
  });

  it('never goes below a minimum size', () => {
    const sc = make({ type: 'bar', x: 'region', y }, 10, 10);
    expect(sc.w).toBeGreaterThanOrEqual(160);
    expect(sc.h).toBeGreaterThanOrEqual(120);
  });
});

describe('pie and KPI scenes', () => {
  const y = [{ column: 'amount', agg: 'sum' as const }];

  it('pie: one slice per positive category with percentages in the tooltip', () => {
    const sc = make({ type: 'pie', x: 'region', y, labels: true });
    expect(sc.kind).toBe('pie');
    expect(of(sc, 'arc')).toHaveLength(3);
    expect(sc.marks[0].rows[0].value).toMatch(/\(59%\)/);
    expect(texts(sc, 'label')).toEqual(['59%', '32%', '8.5%']);
    expect(texts(sc, 'legend')).toEqual(['north', 'south', 'east']);
  });

  it('donut shows the total in the middle', () => {
    const sc = make({ type: 'donut', x: 'region', y });
    expect(texts(sc, 'center')).toEqual(['59']);
  });

  it('a pie of one slice is a full ring, not a degenerate arc', () => {
    const sc = make({ type: 'pie', x: 'region', y }, 640, 360, [['a', '2024-01-01', '5', 1]]);
    expect(of(sc, 'arc')).toHaveLength(1);
    expect(of(sc, 'arc')[0].d).toContain('A');
  });

  it('pie without positive values is empty', () => {
    expect(make({ type: 'pie', x: 'region', y }, 640, 360, [['a', '2024-01-01', '-5', 1]]).message).toMatch(/positive/);
  });

  it('KPI: a big number and a label per series', () => {
    const sc = make({ type: 'kpi', y: [{ column: 'amount', agg: 'sum' }, { column: 'qty', agg: 'max' }] });
    expect(sc.kind).toBe('kpi');
    expect(texts(sc, 'kpi-value')).toEqual(['59', '5']);
    expect(texts(sc, 'kpi-label')).toEqual(['sum(amount)', 'max(qty)']);
    expect(sc.desc).toContain('sum(amount): 59');
  });
});

describe('timeTicks', () => {
  it('uses month starts for a multi-month span and thins them to the requested count', () => {
    const { ticks, unit } = timeTicks(Date.UTC(2023, 0, 10), Date.UTC(2024, 11, 20), 'month', 6);
    expect(unit).toBe('month');
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.every((t) => new Date(t).getUTCDate() === 1)).toBe(true);
  });

  it('falls back to a unit chosen from the span when there is no bucket', () => {
    expect(timeTicks(Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 20), 'none', 8).unit).toBe('day');
  });
});
