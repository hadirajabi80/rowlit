import { describe, expect, it } from 'vitest';
import { col, cols, rowsOf, SALES_COLUMNS, SALES_ROWS } from './testKit';
import { looksLikeId, suggestSpec } from './suggest';

describe('suggestSpec', () => {
  it('date + number -> line, summed per auto bucket', () => {
    const s = suggestSpec(SALES_COLUMNS, rowsOf([...SALES_ROWS, ['north', '2024-01-05', '1', 1]]))!; // a repeated date: needs grouping
    expect(s.type).toBe('line');
    expect(s.x).toBe('day');
    expect(s.y.map((y) => y.column)).toEqual(['amount', 'qty']);
    expect(s.y[0].agg).toBe('sum');
    expect(s.bucket).toBe('auto');
  });

  it('plots unique timestamps raw', () => {
    const s = suggestSpec(cols(['t', 'datetime'], ['v', 'float']), rowsOf([['2024-01-01 10:00', 1], ['2024-01-01 11:00', 2], ['2024-01-01 12:00', 3]]))!;
    expect(s.type).toBe('line');
    expect(s.bucket).toBe('none');
    expect(s.y[0].agg).toBe('none');
  });

  it('category + number -> bar', () => {
    const s = suggestSpec(cols(['city', 'string'], ['pop', 'int']), rowsOf([['a', 1], ['b', 2], ['a', 3]]))!;
    expect(s).toMatchObject({ type: 'bar', x: 'city', sort: 'none', topN: 0 });
    expect(s.y).toEqual([{ column: 'pop', agg: 'sum' }]);
  });

  it('keeps the 20 biggest of many categories', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [`c${i}`, i]);
    const s = suggestSpec(cols(['c', 'string'], ['v', 'int']), rowsOf(rows))!;
    expect(s).toMatchObject({ type: 'bar', sort: 'y-desc', topN: 20 });
  });

  it('prefers measures over id columns', () => {
    const s = suggestSpec([col('order_id', 'int'), col('status', 'string'), col('total', 'decimal')], rowsOf([[1, 'a', '3'], [2, 'b', '4'], [3, 'a', '5']]))!;
    expect(s.y.map((y) => y.column)).toEqual(['total']);
    expect(looksLikeId(col('CustomerId', 'int'))).toBe(true);
    expect(looksLikeId(col('valid', 'int'))).toBe(false);
    expect(looksLikeId(col('x', 'int', { isKey: true }))).toBe(true);
  });

  it('number + number -> scatter', () => {
    const s = suggestSpec(cols(['h', 'float'], ['w', 'float']), rowsOf([[1.5, 50], [1.6, 55], [1.7, 61]]))!;
    expect(s).toMatchObject({ type: 'scatter', x: 'h' });
    expect(s.y).toEqual([{ column: 'w', agg: 'none' }]);
  });

  it('a single row -> KPI numbers', () => {
    const s = suggestSpec(cols(['users', 'int'], ['orders', 'int'], ['label', 'string']), rowsOf([[10, 20, 'x']]))!;
    expect(s.type).toBe('kpi');
    expect(s.y.map((y) => y.column)).toEqual(['users', 'orders']);
  });

  it('only a category -> count per value', () => {
    const s = suggestSpec(cols(['status', 'string']), rowsOf([['a'], ['b'], ['a']]))!;
    expect(s).toMatchObject({ type: 'bar', x: 'status' });
    expect(s.y).toEqual([{ column: 'status', agg: 'count' }]);
  });

  it('suggests nothing for unplottable results', () => {
    expect(suggestSpec(cols(['blob', 'binary']), rowsOf([[null], [null]]))).toBeNull();
    expect(suggestSpec(SALES_COLUMNS, rowsOf([]))).toBeNull();
  });
});
