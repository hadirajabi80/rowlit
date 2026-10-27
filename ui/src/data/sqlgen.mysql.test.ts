// MySQL / MariaDB grid editing SQL: backtick identifiers, INSERT () VALUES (), LAST_INSERT_ID() read-back, RELEASE SAVEPOINT.
import { describe, expect, it } from 'vitest';
import type { ColumnInfo, ColumnKind } from '../api/types';
import { generateChange, releaseSavepointSql, rollbackToSavepointSql, savepointSql, type TableTarget } from './sqlgen';

const col = (name: string, kind: ColumnKind, dbType: string = kind): ColumnInfo => ({
  name, ordinal: 0, dbType, kind, nullable: true, size: null, precision: null, scale: null, table: 'orders', schema: 'shop', isKey: name === 'id',
});
const id = col('id', 'int', 'int');
const name = col('name', 'string', 'varchar(255)');
const order = col('order', 'string', 'varchar(20)');
const T: TableTarget = { schema: 'shop', name: 'orders', keyColumns: ['id'], identityColumns: ['id'], defaultSchema: 'shop' };

describe('mysql inserts', () => {
  it('reads the generated key back with LAST_INSERT_ID()', () => {
    const s = generateChange({ kind: 'insert', ref: '1', values: [{ column: name, value: 'Ada' }, { column: id, value: null }] }, T, 'mysql');
    expect(s.sql).toBe('INSERT INTO orders (name) VALUES (@p1)');
    expect(s.followUp).toBe('SELECT LAST_INSERT_ID() AS id');
    expect(s.returning).toEqual(['id']);
  });

  it('an all-default row is INSERT … () VALUES ()', () => {
    const s = generateChange({ kind: 'insert', ref: '1', values: [] }, T, 'mysql');
    expect(s.sql).toBe('INSERT INTO orders () VALUES ()');
    expect(s.followUp).toBe('SELECT LAST_INSERT_ID() AS id');
  });

  it('a typed key needs no read-back; a non-identity key has none', () => {
    const typed = generateChange({ kind: 'insert', ref: '1', values: [{ column: id, value: 7 }] }, T, 'mysql');
    expect(typed.followUp).toBeUndefined();
    const guid = generateChange({ kind: 'insert', ref: '1', values: [{ column: name, value: 'x' }] }, { ...T, identityColumns: [] }, 'mysql');
    expect(guid.followUp).toBeUndefined();
  });

  it('quotes reserved column names with backticks', () => {
    const s = generateChange({ kind: 'update', ref: '1', key: [{ column: id, value: 1 }], set: [{ column: order, value: 'x', old: 'y' }] }, { ...T, name: 'group' }, 'mysql');
    expect(s.sql).toBe('UPDATE `group` SET `order` = @p1 WHERE id = @p2');
  });
});

describe('mysql BIT and TIME columns', () => {
  const bits = col('flags', 'string', 'BIT');
  const tm = col('tm', 'time', 'TIME');

  it('writes and compares BIT(n) through CONV, not as a byte string', () => {
    const s = generateChange(
      { kind: 'update', ref: '1', key: [{ column: id, value: 1 }], set: [{ column: bits, value: '1010', old: '0001' }] },
      T, 'mysql', { verifyUnchanged: true },
    );
    expect(s.sql).toBe('UPDATE orders SET flags = CAST(CONV(@p1, 2, 10) AS UNSIGNED) WHERE id = @p2 AND flags = CAST(CONV(@p3, 2, 10) AS UNSIGNED)');
    expect(s.params.map((p) => [p.kind, p.value])).toEqual([['string', '1010'], ['int', 1], ['string', '0001']]);
  });

  it('a NULL BIT value stays a plain NULL bind', () => {
    const s = generateChange({ kind: 'insert', ref: '1', values: [{ column: bits, value: null }, { column: name, value: 'x' }] }, T, 'mysql');
    expect(s.sql).toBe('INSERT INTO orders (flags, name) VALUES (@p1, @p2)');
  });

  it('only MySQL BIT columns are converted', () => {
    const s = generateChange({ kind: 'update', ref: '1', key: [{ column: id, value: 1 }], set: [{ column: col('b', 'string', 'bit'), value: '1', old: '0' }] }, T, 'sqlite');
    expect(s.sql).not.toContain('CONV');
  });

  it('binds TIME as text: a duration can exceed 24 hours', () => {
    const s = generateChange({ kind: 'update', ref: '1', key: [{ column: id, value: 1 }], set: [{ column: tm, value: '838:59:59', old: '-12:00:00' }] }, T, 'mysql');
    expect(s.params.map((p) => [p.kind, p.value])).toEqual([['string', '838:59:59'], ['int', 1]]);
  });
});

describe('mysql savepoints', () => {
  it('has SAVEPOINT / ROLLBACK TO / RELEASE', () => {
    expect(savepointSql('mysql')).toBe('SAVEPOINT dbs_edit');
    expect(rollbackToSavepointSql('mysql')).toBe('ROLLBACK TO SAVEPOINT dbs_edit');
    expect(releaseSavepointSql('mysql')).toBe('RELEASE SAVEPOINT dbs_edit');
    expect(releaseSavepointSql('plsql')).toBeNull();
  });
});
