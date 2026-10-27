// QA round (Cassandra): CQL folds unquoted identifiers to lower case and rejects reserved words, so the grid and the
// generators must quote "UserId" / "token" / "use" (the engine's CqlText.Quote does the same).
import { describe, expect, it } from 'vitest';
import type { ColumnInfo } from '../api/types';
import { generateChange, refetchSql, selectPageSql } from '../data/sqlgen';
import { needsQuoting, quoteIdent } from './sql';

const col = (name: string, kind: ColumnInfo['kind'] = 'string'): ColumnInfo => ({ name, ordinal: 0, dbType: 'text', kind, nullable: true } as ColumnInfo);

describe('CQL identifier quoting', () => {
  it('keeps plain lower-case names bare', () => {
    for (const n of ['id', 'customer_id', 'order_date', 'key', 'value', 'type', 'name', 'a1']) expect(needsQuoting(n, 'cql'), n).toBe(false);
  });

  it('quotes names with upper-case letters (they fold to lower case unquoted)', () => {
    expect(needsQuoting('UserId', 'cql')).toBe(true);
    expect(quoteIdent('UserId', 'cql')).toBe('"UserId"');
  });

  it('quotes reserved words, leading underscores / digits and odd characters', () => {
    for (const n of ['use', 'token', 'schema', 'replace', 'batch', 'begin', 'truncate', 'keyspace', 'select', '_x', '1a', 'a b', 'a$b']) expect(needsQuoting(n, 'cql'), n).toBe(true);
    expect(quoteIdent('say "hi"', 'cql')).toBe('"say ""hi"""');
  });

  it('generated grid statements quote what CQL would fold or reject', () => {
    const target = { schema: null, name: 'qa_case', keyColumns: ['UserId'] };
    const key = [{ column: col('UserId', 'int'), value: 1 }];
    const update = generateChange({ kind: 'update', ref: 'r1', key, set: [{ column: col('token'), value: 'zz', old: 'a' }] }, target, 'cql', { verifyUnchanged: true });
    expect(update.sql).toMatch(/^UPDATE qa_case SET "token" = \S+ WHERE "UserId" = \S+ AND "token" = \S+$/);
    const del = generateChange({ kind: 'delete', ref: 'r2', key }, target, 'cql');
    expect(del.sql).toContain('WHERE "UserId" = ');
    const page = selectPageSql(target, 'cql', { limit: 100, offset: 0 });
    expect(page.sql).toContain('ORDER BY "UserId"');
    expect(refetchSql(target, 'cql', [key]).sql).toContain('"UserId" = ');
  });
});
