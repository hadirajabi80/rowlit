// ClickHouse grid editing SQL: no UPDATE statement (a mutation that waits for itself), lightweight DELETE, INSERT without
// RETURNING / DEFAULT VALUES, and JSON-text cells parsed into Array / Map / Tuple columns.
import { describe, expect, it } from 'vitest';
import type { ColumnInfo, ColumnKind } from '../api/types';
import { generateChange, generateChanges, type TableTarget } from './sqlgen';
import { editableColumnsFor, tableEditability } from '../components/Grid/editability';

const col = (name: string, kind: ColumnKind, dbType: string = kind, ordinal = 0): ColumnInfo => ({
  name, ordinal, dbType, kind, nullable: true, size: null, precision: null, scale: null, table: 'events', schema: 'shop', isKey: name === 'id',
});
const id = col('id', 'int', 'UInt64');
const name = col('name', 'string', 'String');
const tags = col('tags', 'json', 'Array(String)');
const attrs = col('attrs', 'json', 'Map(String, String)');
const point = col('p', 'json', 'Tuple(UInt8,String)');
const doc = col('doc', 'json', 'JSON');
const T: TableTarget = { schema: 'shop', name: 'events', keyColumns: ['id'], identityColumns: [], defaultSchema: 'default' };

describe('clickhouse updates', () => {
  it('is an ALTER TABLE … UPDATE mutation that waits for itself (the refetch must see the new value)', () => {
    const s = generateChange({ kind: 'update', ref: '1', key: [{ column: id, value: 7 }], set: [{ column: name, value: 'x', old: 'y' }] }, T, 'clickhouse');
    expect(s.sql).toBe('ALTER TABLE shop.events UPDATE name = @p1 WHERE id = @p2 SETTINGS mutations_sync = 1');
    expect(s.params.map((p) => p.name)).toEqual(['p1', 'p2']);
    // a mutation reports no row count: a conflict check on "0 rows affected" would never fire
    expect(s.expectOne).toBe(false);
  });

  it('keeps the optimistic checks and puts SETTINGS after the whole WHERE', () => {
    const s = generateChange({ kind: 'update', ref: '1', key: [{ column: id, value: 7 }], set: [{ column: name, value: 'x', old: 'y' }] }, T, 'clickhouse', { verifyUnchanged: true });
    expect(s.sql).toBe('ALTER TABLE shop.events UPDATE name = @p1 WHERE id = @p2 AND name = @p3 SETTINGS mutations_sync = 1');
  });

  it('parses JSON text into the column type (a String cannot be assigned to an Array / Map / Tuple)', () => {
    const s = generateChange({
      kind: 'update', ref: '1', key: [{ column: id, value: 7 }],
      set: [{ column: tags, value: '["a","b"]', old: '[]' }, { column: attrs, value: '{"k":"v"}', old: '{}' }, { column: point, value: '[1,"x"]', old: null }, { column: doc, value: '{"a":1}', old: null }],
    }, T, 'clickhouse');
    expect(s.sql).toBe(
      "ALTER TABLE shop.events UPDATE tags = JSONExtract(@p1, 'Array(String)'), attrs = JSONExtract(@p2, 'Map(String, String)'), "
      + "p = JSONExtract(@p3, 'Tuple(UInt8,String)'), doc = @p4 WHERE id = @p5 SETTINGS mutations_sync = 1",
    );
  });

  it('other dialects are unchanged', () => {
    const s = generateChange({ kind: 'update', ref: '1', key: [{ column: id, value: 7 }], set: [{ column: tags, value: '[]', old: '[]' }] }, T, 'mysql');
    expect(s.sql).toBe('UPDATE shop.events SET tags = @p1 WHERE id = @p2');
  });
});

describe('clickhouse deletes and inserts', () => {
  it('DELETE FROM is the lightweight delete', () => {
    const s = generateChange({ kind: 'delete', ref: '1', key: [{ column: id, value: 7 }] }, T, 'clickhouse');
    expect(s.sql).toBe('DELETE FROM shop.events WHERE id = @p1');
    expect(s.expectOne).toBe(false);
  });

  it('INSERT has no RETURNING (even with a key left empty) and parses JSON cells', () => {
    const s = generateChange({ kind: 'insert', ref: 'n1', values: [{ column: name, value: 'x' }, { column: tags, value: '["a"]' }] }, T, 'clickhouse');
    expect(s.sql).toBe("INSERT INTO shop.events (name, tags) VALUES (@p1, JSONExtract(@p2, 'Array(String)'))");
    expect(s.returning).toEqual([]);
    expect(s.followUp).toBeUndefined();
  });

  it('an all-default row is INSERT (col) VALUES (DEFAULT): there is no DEFAULT VALUES', () => {
    const s = generateChange({ kind: 'insert', ref: 'n1', values: [] }, T, 'clickhouse', { columns: [id, name] });
    expect(s.sql).toBe('INSERT INTO shop.events (id) VALUES (DEFAULT)');
  });

  it('orders deletes, updates, inserts as before', () => {
    const out = generateChanges([
      { kind: 'insert', ref: 'n', values: [{ column: name, value: 'a' }] },
      { kind: 'update', ref: '1', key: [{ column: id, value: 1 }], set: [{ column: name, value: 'b', old: 'c' }] },
      { kind: 'delete', ref: '2', key: [{ column: id, value: 2 }] },
    ], T, 'clickhouse');
    expect(out.map((s) => s.kind)).toEqual(['delete', 'update', 'insert']);
  });
});

describe('clickhouse editability', () => {
  const conn = { id: 'c', name: 'ch', providerId: 'clickhouse', readOnly: false } as never;
  const snapshot = {
    defaultSchema: 'shop', schemas: [{ name: 'shop', objects: [{ t: 'table', n: 'events', pk: ['id'], c: [['id', 'UInt64', 0, 0, 0], ['name', 'String', 1, 0, 0]] }] }],
  } as never;
  const columns = [id, { ...name, ordinal: 1 }];

  it('a column of the sorting key cannot be changed on an existing row (Cannot UPDATE key column) but can be typed into a new one', () => {
    const e = tableEditability(columns, 'shop', 'events', snapshot, conn, false, 'clickhouse');
    expect(e.editable).toBe(true);
    expect([...(e.updateLocked ?? [])]).toEqual([0]);
    expect(editableColumnsFor(e, false).has(0)).toBe(false);
    expect(editableColumnsFor(e, false).has(1)).toBe(true);
    expect(editableColumnsFor(e, true).has(0)).toBe(true);
  });

  it('other dialects lock nothing', () => {
    const e = tableEditability(columns, 'shop', 'events', snapshot, conn, false, 'pgsql');
    expect(e.updateLocked).toBeUndefined();
    expect(editableColumnsFor(e, false).has(0)).toBe(true);
  });
});
