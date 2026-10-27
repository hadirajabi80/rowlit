// QA round (Cassandra): the grid's server filter must only push what CQL can run (ALLOW FILTERING is added by the engine);
// everything else (lower(), <>, IS NULL, NOT IN, BETWEEN, LIKE ... ESCAPE) stays in the grid on the loaded rows.
import { describe, expect, it } from 'vitest';
import type { ColumnInfo, ColumnKind } from '../../api/types';
import { newCondition, newGroup, type FilterOp, type FilterValue } from '../model';
import { buildPredicate } from '../sql';

const col = (name: string, kind: ColumnKind): ColumnInfo => ({
  name, ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'orders', schema: 'shop', isKey: false,
});
const COLS = [col('id', 'int'), col('status', 'string'), col('total', 'decimal'), col('order_date', 'datetimeoffset'), col('paid', 'bool'), col('At', 'time')];

const run = (column: string, op: FilterOp, values: FilterValue[] = [], cs = false, quick = '') => {
  const c = { ...newCondition(column, op, values), ...(cs ? { caseSensitive: true } : {}) };
  return buildPredicate(newGroup('and', [c]), COLS, 'cql', { alias: null, quick });
};

describe('CQL server predicate', () => {
  it('pushes comparisons as plain bound predicates (text matched exactly, with a warning)', () => {
    expect(run('id', 'eq', [4]).where).toBe('id = @fp1');
    expect(run('total', 'gte', ['10.5']).where).toBe('total >= @fp1');
    const t = run('status', 'eq', ['paid']);
    expect(t.where).toBe('status = @fp1');
    expect(t.warnings.join(' ')).toMatch(/case-sensitively/);
    expect(run('status', 'eq', ['paid'], true).warnings).toEqual([]);
  });

  it('BETWEEN becomes two bounds (CQL has no BETWEEN); booleans use literals; empty text is = \'\'', () => {
    expect(run('total', 'between', ['10', '20']).where).toBe('total >= @fp1 AND total <= @fp2');
    expect(run('status', 'between', ['a', 'c']).where).toBe('status >= @fp1 AND status <= @fp2');
    expect(run('paid', 'isTrue').where).toBe('paid = TRUE');
    expect(run('paid', 'isFalse').where).toBe('paid = FALSE');
    expect(run('status', 'isEmpty').where).toBe("status = ''");
    expect(run('At', 'between', ['10:00', '11:00']).where).toBe('"At" >= @fp1 AND "At" <= @fp2');
  });

  it('date conditions are AND-ed ranges', () => {
    expect(run('order_date', 'onDate', ['2026-01-05']).where).toBe('order_date >= @fp1 AND order_date < @fp2');
    expect(run('order_date', 'between', ['2026-01-05 10:00', '2026-01-06 11:00']).where).toBe('order_date >= @fp1 AND order_date <= @fp2');
  });

  it('keeps what CQL cannot evaluate in the grid: <>, IN, NOT IN, IS NULL, LIKE family, regex', () => {
    const ops: [string, FilterOp, FilterValue[]][] = [
      ['status', 'neq', ['x']], ['status', 'in', ['a', 'b']], ['status', 'notIn', ['a']], ['status', 'isNull', []], ['status', 'isNotNull', []],
      ['status', 'contains', ['a']], ['status', 'notContains', ['a']], ['status', 'startsWith', ['a']], ['status', 'endsWith', ['a']], ['status', 'regex', ['^a']],
    ];
    for (const [column, op, values] of ops) {
      const r = run(column, op, values);
      expect(r.where, op).toBeNull();
      expect(r.clientOnly, op).not.toBeNull();
    }
  });

  it('an OR group with a grid-only condition stays entirely in the grid; AND pushes the rest', () => {
    const a = newCondition('id', 'eq', [1]);
    const b = newCondition('status', 'contains', ['x']);
    expect(buildPredicate(newGroup('or', [a, b]), COLS, 'cql', { alias: null }).where).toBeNull();
    const and = buildPredicate(newGroup('and', [a, b]), COLS, 'cql', { alias: null });
    expect(and.where).toBe('id = @fp1');
    expect(and.clientOnly).not.toBeNull();
  });

  it('the quick search is not pushed (LIKE needs an index) but says so', () => {
    const r = run('id', 'eq', [1], false, 'paid');
    expect(r.where).toBe('id = @fp1');
    expect(r.warnings.join(' ')).toMatch(/search is applied in the grid/);
    expect(buildPredicate(null, COLS, 'cql', { alias: null, quick: 'x' }).where).toBeNull();
  });
});
