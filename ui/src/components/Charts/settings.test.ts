import { beforeEach, describe, expect, it } from 'vitest';
import { hashQuery, loadSpec, sanitizeSpec, saveSpec } from './settings';
import { SALES_COLUMNS, spec } from './testKit';

beforeEach(() => localStorage.clear());

describe('chart settings per query', () => {
  const s = spec({ type: 'area', x: 'day', y: [{ column: 'amount', agg: 'avg' }], topN: 5, log: true });

  it('hashes the query text, ignoring whitespace differences', () => {
    expect(hashQuery('SELECT  *\n FROM t')).toBe(hashQuery(' SELECT * FROM t '));
    expect(hashQuery('SELECT * FROM t')).not.toBe(hashQuery('SELECT * FROM u'));
    expect(hashQuery('x')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('remembers the spec per query text', () => {
    saveSpec('SELECT 1', s);
    expect(loadSpec('select 1'.toUpperCase(), SALES_COLUMNS)).toEqual(s);
    expect(loadSpec('SELECT 2', SALES_COLUMNS)).toBeNull();
  });

  it('drops columns the result no longer has, and resets bad enums', () => {
    const out = sanitizeSpec({ ...s, x: 'gone', group: 'region', type: 'radar', sort: 7, y: [{ column: 'amount', agg: 'weird' }, { column: 'gone', agg: 'sum' }] }, SALES_COLUMNS)!;
    expect(out.x).toBeNull();
    expect(out.group).toBe('region');
    expect(out.type).toBe('bar');
    expect(out.sort).toBe('none');
    expect(out.y).toEqual([{ column: 'amount', agg: 'sum' }]);
  });

  it('rejects settings with no usable Y column', () => {
    expect(sanitizeSpec({ ...s, y: [{ column: 'gone', agg: 'sum' }] }, SALES_COLUMNS)).toBeNull();
    expect(sanitizeSpec(null, SALES_COLUMNS)).toBeNull();
    expect(sanitizeSpec('x', SALES_COLUMNS)).toBeNull();
  });

  it('ignores corrupt storage and survives a missing or throwing localStorage', () => {
    localStorage.setItem(`rowlit.chart.v1.${hashQuery('q')}`, '{not json');
    expect(loadSpec('q', SALES_COLUMNS)).toBeNull();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try {
      expect(() => saveSpec('q', s)).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('keeps at most 200 remembered queries', () => {
    for (let i = 0; i < 205; i++) saveSpec(`SELECT ${i}`, s);
    expect(loadSpec('SELECT 0', SALES_COLUMNS)).toBeNull();
    expect(loadSpec('SELECT 204', SALES_COLUMNS)).toEqual(s);
  });
});
