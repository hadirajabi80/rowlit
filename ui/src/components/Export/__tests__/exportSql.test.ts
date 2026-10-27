// The SQL of "current filter & sort" / "all records" exports: the grid's own WHERE and ORDER BY (data/sqlgen), per
// dialect, for a filter built the way the Data tab builds it, without the page.
import { describe, expect, it } from 'vitest';
import type { ColumnInfo, ColumnKind, Dialect } from '../../../api/types';
import { exportSelectSql, selectPageSql, type TableTarget } from '../../../data/sqlgen';
import { newCondition, newGroup } from '../../../filter/model';
import { buildPredicate } from '../../../filter/sql';

const col = (name: string, kind: ColumnKind): ColumnInfo => ({
  name, ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'orders', schema: null, isKey: false,
});
const COLS = [col('id', 'int'), col('name', 'string'), col('total', 'decimal')];
const T: TableTarget = { schema: null, name: 'orders', keyColumns: ['id'] };
const DIALECTS: Dialect[] = ['tsql', 'plsql', 'sqlite', 'pgsql', 'mysql', 'clickhouse', 'snowflake'];

const filter = newGroup('and', [newCondition('name', 'contains', ['Ada']), newCondition('total', 'gt', ['10'])]);

describe('exportSelectSql', () => {
  it.each(DIALECTS)('%s: the page statement without the page, same WHERE and ORDER BY text', (d) => {
    const pred = buildPredicate(filter, COLS, d, { alias: null });
    expect(pred.where).toBeTruthy();
    const sort = [{ column: 'total', dir: 'desc' as const }];
    const page = selectPageSql(T, d, { where: pred.where, sort, offset: 0, limit: 1000 }).sql;
    const exp = exportSelectSql(T, d, { where: pred.where, sort });
    // everything the page reads with, minus LIMIT / OFFSET / FETCH
    const pageHead = page.split('\n').filter((l) => !/^(LIMIT|OFFSET)\b/.test(l)).join('\n');
    expect(exp).toBe(pageHead);
    expect(exp).toContain(`WHERE ${pred.where}`);
    expect(exp).toMatch(/ORDER BY .*total.* DESC/);
    expect(exp).not.toMatch(/LIMIT|OFFSET|FETCH|TOP \d/);
  });

  it('cql: no ORDER BY (a plain statement cannot sort across partitions), ALLOW FILTERING after a WHERE', () => {
    const pred = buildPredicate(filter, COLS, 'cql', { alias: null });
    expect(pred.where).toBe('total > @fp1'); // the text search stays in the grid
    const sort = [{ column: 'total', dir: 'desc' as const }];
    expect(exportSelectSql(T, 'cql', { where: pred.where, sort })).toBe('SELECT *\nFROM orders\nWHERE total > @fp1\nALLOW FILTERING');
    expect(exportSelectSql(T, 'cql', { ordered: false })).toBe('SELECT *\nFROM orders');
    expect(exportSelectSql(T, 'cql', { sort })).toBe('SELECT *\nFROM orders');
  });

  it('keeps the key as the tie-breaker the grid appends, and the keyless fallback order', () => {
    expect(exportSelectSql(T, 'pgsql', { sort: [{ column: 'name', dir: 'asc' }] })).toBe('SELECT *\nFROM orders\nORDER BY name, id');
    const keyless: TableTarget = { schema: null, name: 'log', keyColumns: [], orderFallback: ['rowid'] };
    expect(exportSelectSql(keyless, 'sqlite', {})).toBe('SELECT *\nFROM log\nORDER BY rowid');
    expect(exportSelectSql({ ...keyless, orderFallback: undefined }, 'sqlite', {})).toBe('SELECT *\nFROM log');
  });

  it('all records: natural order, no filter', () => {
    expect(exportSelectSql(T, 'mysql', { ordered: false })).toBe('SELECT *\nFROM orders');
    expect(exportSelectSql({ schema: 'dbo', name: 'orders', keyColumns: ['id'] }, 'tsql', { ordered: false })).toBe('SELECT *\nFROM dbo.orders');
  });

  it('quotes per dialect and never reads the Oracle ROWID column', () => {
    expect(exportSelectSql({ schema: 'shop', name: 'Orders', keyColumns: ['Id'], rowid: true }, 'plsql', {})).toBe('SELECT *\nFROM "shop"."Orders"\nORDER BY "Id"');
    expect(exportSelectSql({ schema: 'shop', name: 'orders', keyColumns: ['id'] }, 'mysql', {})).toBe('SELECT *\nFROM shop.orders\nORDER BY id');
    expect(exportSelectSql({ schema: 'shop', name: 'orders', keyColumns: ['id'] }, 'clickhouse', { ordered: false })).toContain('FROM');
  });

  it('bind values stay out of the text: the predicate keeps placeholders (the params travel with the request)', () => {
    const pred = buildPredicate(filter, COLS, 'tsql', { alias: null });
    const sql = exportSelectSql(T, 'tsql', { where: pred.where });
    expect(sql).not.toContain('Ada');
    expect(pred.params.length).toBeGreaterThan(0);
    for (const p of pred.params) expect(sql).toContain(`@${p.name}`);
  });
});
