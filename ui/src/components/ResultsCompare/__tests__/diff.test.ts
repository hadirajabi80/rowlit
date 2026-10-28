import { describe, expect, it } from 'vitest';
import type { CellValue, ColumnKind } from '../../../api/types';
import { canonNumber, defaultKeys, diffResults, mergeColumns, noSharedColumns, type DiffSide } from '../diff';

const side = (cols: [string, ColumnKind?, boolean?][], rows: CellValue[][]): DiffSide => ({
  columns: cols.map(([name, kind = 'string', isKey = false]) => ({ name, kind, isKey })),
  rows: { length: rows.length, get: (i) => rows[i] },
});

const L = side([['id', 'int', true], ['name'], ['qty', 'int']], [[1, 'ada', 5], [2, 'bob', 7], [3, 'cy', 9]]);

describe('canonNumber', () => {
  it('spells equal numbers alike', () => {
    expect(canonNumber('1.50')).toBe('1.5');
    expect(canonNumber(1.5)).toBe('1.5');
    expect(canonNumber('+1.5')).toBe('1.5');
    expect(canonNumber('001')).toBe('1');
    expect(canonNumber('1.5e0')).toBe('1.5');
    expect(canonNumber('1.5e3')).toBe('1500');
    expect(canonNumber('15e-4')).toBe('0.0015');
    expect(canonNumber('-0')).toBe('0');
    expect(canonNumber('-0.0')).toBe('0');
    expect(canonNumber('12345678901234567890.10')).toBe('12345678901234567890.1');
  });
  it('leaves text alone', () => {
    expect(canonNumber('abc')).toBe('abc');
    expect(canonNumber('')).toBe('');
  });
});

describe('diffResults by key', () => {
  it('finds added, removed and changed rows with the changed columns', () => {
    const R = side([['id', 'int', true], ['name'], ['qty', 'int']], [[1, 'ada', 5], [2, 'bobby', 7], [4, 'dee', 1]]);
    const d = diffResults(L, R, { keys: ['id'] });
    expect(d.counts).toEqual({ same: 1, added: 1, removed: 1, changed: 1 });
    expect(d.keyColumns).toEqual(['id']);
    const changed = d.rows.find((r) => r.status === 'changed')!;
    expect(changed).toMatchObject({ left: 1, right: 1 });
    expect(changed.changed.map((i) => d.columns[i].name)).toEqual(['name']);
    expect(d.rows.find((r) => r.status === 'removed')).toMatchObject({ left: 2, right: null });
    expect(d.rows.find((r) => r.status === 'added')).toMatchObject({ left: null, right: 2 });
  });

  it('matches rows regardless of their order', () => {
    const R = side([['id', 'int', true], ['name'], ['qty', 'int']], [[3, 'cy', 9], [1, 'ada', 5], [2, 'bob', 7]]);
    expect(diffResults(L, R, { keys: ['id'] }).counts).toEqual({ same: 3, added: 0, removed: 0, changed: 0 });
  });

  it('treats numbers, decimal text and different numeric kinds as equal', () => {
    const A = side([['id', 'int'], ['price', 'decimal']], [[1, '10.50'], [2, 3]]);
    const B = side([['id', 'decimal'], ['price', 'float']], [['1.0', 10.5], [2, '3.00']]);
    expect(diffResults(A, B, { keys: ['id'] }).counts).toEqual({ same: 2, added: 0, removed: 0, changed: 0 });
  });

  it('NULL equals NULL and differs from empty text and zero', () => {
    const A = side([['id', 'int'], ['v']], [[1, null], [2, null], [3, null]]);
    const B = side([['id', 'int'], ['v']], [[1, null], [2, ''], [3, '0']]);
    const d = diffResults(A, B, { keys: ['id'] });
    expect(d.counts).toEqual({ same: 1, added: 0, removed: 0, changed: 2 });
  });

  it('pairs duplicate keys in order and reports them', () => {
    const A = side([['k', 'int'], ['v']], [[1, 'a'], [1, 'b'], [2, 'c']]);
    const B = side([['k', 'int'], ['v']], [[1, 'a'], [1, 'x'], [1, 'y'], [2, 'c']]);
    const d = diffResults(A, B, { keys: ['k'] });
    expect(d.duplicateKeys).toBe(3);
    expect(d.counts).toEqual({ same: 2, added: 1, removed: 0, changed: 1 });
  });

  it('supports a composite key', () => {
    const A = side([['a', 'int'], ['b', 'int'], ['v']], [[1, 1, 'x'], [1, 2, 'y']]);
    const B = side([['a', 'int'], ['b', 'int'], ['v']], [[1, 2, 'y'], [1, 1, 'z']]);
    const d = diffResults(A, B, { keys: ['a', 'b'] });
    expect(d.counts).toEqual({ same: 1, added: 0, removed: 0, changed: 1 });
  });

  it('ignores key columns that one result lacks', () => {
    const B = side([['id', 'int'], ['name']], [[1, 'ada']]);
    const d = diffResults(L, B, { keys: ['id', 'qty'] });
    expect(d.keyColumns).toEqual(['id']);
    expect(d.droppedKeys).toEqual(['qty']);
  });

  it('honours ignoreCase and trimText', () => {
    const A = side([['id', 'int'], ['v']], [[1, 'Ada'], [2, ' bob']]);
    const B = side([['id', 'int'], ['v']], [[1, 'ada'], [2, 'bob']]);
    expect(diffResults(A, B, { keys: ['id'] }).counts.changed).toBe(2);
    expect(diffResults(A, B, { keys: ['id'], ignoreCase: true }).counts.changed).toBe(1);
    expect(diffResults(A, B, { keys: ['id'], ignoreCase: true, trimText: true }).counts.changed).toBe(0);
  });

  it('compares only the columns both results have, and lists the others', () => {
    const A = side([['id', 'int'], ['a']], [[1, 'x']]);
    const B = side([['ID', 'int'], ['b']], [[1, 'y']]);
    const d = diffResults(A, B, { keys: ['id'] });
    expect(d.counts).toEqual({ same: 1, added: 0, removed: 0, changed: 0 });
    expect(d.columns.map((c) => [c.name, c.left, c.right])).toEqual([['id', 0, 0], ['a', 1, null], ['b', null, 1]]);
  });

  it('flags columns whose kinds differ', () => {
    const A = side([['id', 'int'], ['v', 'int']], [[1, 5]]);
    const B = side([['id', 'int'], ['v', 'string']], [[1, '5']]);
    const d = diffResults(A, B, { keys: ['id'] });
    expect(d.kindMismatches).toEqual(['v']);
    expect(d.counts.same).toBe(1);
  });

  it('truncated values match when the lengths agree and the previews overlap', () => {
    const A = side([['id', 'int'], ['t']], [[1, { $trunc: 'abc', len: 100000 }], [2, { $trunc: 'abc', len: 100000 }]]);
    const B = side([['id', 'int'], ['t']], [[1, { $trunc: 'abc', len: 100000 }], [2, { $trunc: 'abc', len: 99999 }]]);
    const d = diffResults(A, B, { keys: ['id'] });
    expect(d.counts).toEqual({ same: 1, added: 0, removed: 0, changed: 1 });
  });

  it('booleans equal 0 and 1', () => {
    const A = side([['id', 'int'], ['f', 'bool']], [[1, true], [2, false]]);
    const B = side([['id', 'int'], ['f', 'int']], [[1, 1], [2, 1]]);
    expect(diffResults(A, B, { keys: ['id'] }).counts).toEqual({ same: 1, added: 0, removed: 0, changed: 1 });
  });
});

describe('diffResults without a key', () => {
  it('compares whole rows as a multiset', () => {
    const A = side([['a', 'int'], ['b']], [[1, 'x'], [2, 'y'], [2, 'y'], [3, 'z']]);
    const B = side([['a', 'int'], ['b']], [[2, 'y'], [3, 'zz'], [1, 'x']]);
    const d = diffResults(A, B, { keys: [] });
    expect(d.keyColumns).toEqual([]);
    expect(d.counts).toEqual({ same: 2, added: 1, removed: 2, changed: 0 });
    expect(d.duplicateKeys).toBe(0);
  });

  it('two empty results are identical, an empty one against a full one is all added', () => {
    const E = side([['a', 'int']], []);
    expect(diffResults(E, E, { keys: [] }).counts).toEqual({ same: 0, added: 0, removed: 0, changed: 0 });
    const F = side([['a', 'int']], [[1], [2]]);
    expect(diffResults(E, F, { keys: [] }).counts.added).toBe(2);
    expect(diffResults(F, E, { keys: [] }).counts.removed).toBe(2);
  });
});

describe('keys and columns', () => {
  it('defaultKeys: the primary-key columns both results report', () => {
    expect(defaultKeys(L, side([['ID', 'int', true], ['name']], []))).toEqual(['id']);
    expect(defaultKeys(L, side([['id', 'int'], ['name']], []))).toEqual([]);
  });
  it('mergeColumns: left order, then the right-only columns', () => {
    const m = mergeColumns(side([['a'], ['b']], []), side([['B'], ['c'], ['a']], []), ['a']);
    expect(m.map((c) => [c.name, c.left, c.right, c.key])).toEqual([['a', 0, 2, true], ['b', 1, 0, false], ['c', null, 1, false]]);
  });
  it('noSharedColumns', () => {
    expect(noSharedColumns(diffResults(side([['a']], []), side([['b']], []), { keys: [] }))).toBe(true);
    expect(noSharedColumns(diffResults(L, L, { keys: [] }))).toBe(false);
  });
});
