// SQLite data editing of a table without a primary key (an imported CSV, a scratch table): every page also reads the
// rowid pseudo-column (hidden last column), which is the row identity of UPDATE / DELETE / refetch and is returned by
// INSERT … RETURNING. Same idea as the Oracle ROWID (sqlgen.plsql.test.ts); the statements were run against SQLite.
import { describe, expect, it } from 'vitest';
import type { CatalogSnapshot, ColumnInfo, ColumnKind } from '../api/types';
import { resultEditability, tableEditability } from '../components/Grid/editability';
import { generateChange, isRowidColumn, previewScript, refetchSql, rowidColumnFor, selectPageSql, type RowChange, type TableTarget } from './sqlgen';

const col = (name: string, kind: ColumnKind, dbType = kind.toUpperCase(), table = 'people'): ColumnInfo => ({
  name, ordinal: 0, dbType, kind, nullable: true, size: null, precision: null, scale: null, table, schema: 'main', isKey: false,
});
const Id = col('id', 'int');
const Name = col('name', 'string', 'TEXT');
const ROWID = col('rowid', 'int', 'INTEGER');
const KEYLESS: TableTarget = { schema: 'main', name: 'people', keyColumns: ['rowid'], rowid: true, identityColumns: [], defaultSchema: 'main' };

describe('SQLite rowid row identity (table without a primary key)', () => {
  it('pages read rowid as the last column; the ORDER BY fallback is the pseudo-column', () => {
    const page = selectPageSql({ ...KEYLESS, keyColumns: [], orderFallback: ['rowid'] }, 'sqlite', { offset: 0, limit: 100, where: 'name = @fp1' });
    expect(page.sql).toBe('SELECT *, rowid\nFROM people\nWHERE name = @fp1\nORDER BY rowid\nLIMIT 100 OFFSET 0');
    // Without the flag the read is the plain SELECT *.
    expect(selectPageSql({ ...KEYLESS, rowid: false, keyColumns: [], orderFallback: ['rowid'] }, 'sqlite', { offset: 0, limit: 5 }).sql).toBe('SELECT *\nFROM people\nORDER BY rowid\nLIMIT 5 OFFSET 0');
  });

  it('UPDATE / DELETE identify the row by rowid; rowid is never verified as a data column', () => {
    const upd: RowChange = { kind: 'update', ref: '1', key: [{ column: ROWID, value: 2 }], set: [{ column: Name, value: 'y', old: 'x' }] };
    const u = generateChange(upd, KEYLESS, 'sqlite', { verifyUnchanged: true });
    expect(u.sql).toBe('UPDATE people SET name = @p1 WHERE rowid = @p2 AND name = @p3');
    expect(u.params[1]).toEqual({ name: 'p2', kind: 'int', value: 2 });
    const del: RowChange = {
      kind: 'delete', ref: '1', key: [{ column: ROWID, value: 2 }],
      original: [{ column: Id, value: 1 }, { column: Name, value: null }, { column: ROWID, value: 2 }],
    };
    expect(generateChange(del, KEYLESS, 'sqlite', { verifyUnchanged: true }).sql).toBe('DELETE FROM people WHERE rowid = @p1 AND id = @p2 AND name IS NULL');
  });

  it('INSERT returns the new rowid (RETURNING from 3.35, last_insert_rowid() before)', () => {
    const ins: RowChange = { kind: 'insert', ref: '1', values: [{ column: Name, value: 'z' }] };
    const s = generateChange(ins, KEYLESS, 'sqlite', { sqliteVersion: '3.46.1' });
    expect(s.sql).toBe('INSERT INTO people (name) VALUES (@p1) RETURNING rowid');
    expect(s.returning).toEqual(['rowid']);
    const old = generateChange(ins, KEYLESS, 'sqlite', { sqliteVersion: '3.34.0' });
    expect(old.sql).toBe('INSERT INTO people (name) VALUES (@p1)');
    expect(old.followUp).toBe('SELECT last_insert_rowid() AS rowid');
    expect(previewScript([u(2)], 'sqlite')).toBe("UPDATE people SET name = 'q' WHERE rowid = 2;");
  });

  it('the refetch after a save reads rowid too, so the saved rows keep their identity', () => {
    const q = refetchSql(KEYLESS, 'sqlite', [[{ column: ROWID, value: 1 }], [{ column: ROWID, value: 2 }]]);
    expect(q.sql).toBe('SELECT *, rowid\nFROM people\nWHERE rowid = @k1 OR rowid = @k2');
  });

  it('isRowidColumn covers Oracle and SQLite only', () => {
    expect(isRowidColumn(ROWID, 'sqlite')).toBe(true);
    expect(isRowidColumn({ name: 'ROWID' }, 'plsql')).toBe(true);
    expect(isRowidColumn(ROWID, 'tsql')).toBe(false);
    expect(isRowidColumn(Name, 'sqlite')).toBe(false);
    expect(rowidColumnFor('sqlite')).toBe('rowid');
    expect(rowidColumnFor('plsql')).toBe('ROWID');
  });
});

function u(rowid: number): ReturnType<typeof generateChange> {
  return generateChange({ kind: 'update', ref: '1', key: [{ column: ROWID, value: rowid }], set: [{ column: Name, value: 'q', old: 'p' }] }, KEYLESS, 'sqlite');
}

describe('SQLite editability', () => {
  const snap = {
    connectionId: 'c', dialect: 'sqlite', defaultSchema: 'main', databases: [],
    schemas: [{
      name: 'main',
      objects: [
        { t: 'table', n: 'people', c: [['id', 'INTEGER', 1, 0, 0, null], ['name', 'TEXT', 1, 0, 0, null]] },
        { t: 'view', n: 'v_people' },
      ],
    }],
  } as unknown as CatalogSnapshot;

  it('a keyless table read with rowid is editable by rowid; rowid itself is not editable', () => {
    const e = tableEditability([Id, Name, ROWID], 'main', 'people', snap, undefined, false, 'sqlite');
    expect(e.editable).toBe(true);
    expect(e.target).toMatchObject({ schema: 'main', name: 'people', keyColumns: ['rowid'], rowid: true });
    expect([...e.editableColumns]).toEqual([0, 1]);
    // Without the rowid column and on views it stays read-only.
    expect(tableEditability([Id, Name], 'main', 'people', snap, undefined, false, 'sqlite').reason).toBe('No primary key: read-only');
    expect(tableEditability([Id, Name, ROWID], 'main', 'v_people', snap, undefined, true, 'sqlite').reason).toBe('View without a key: read-only');
  });

  it('console results: SELECT t.*, rowid edits a keyless table; SELECT * says how', () => {
    const ok = resultEditability([Id, Name, ROWID], { singleSelect: true, snapshot: snap, conn: undefined, dialect: 'sqlite' });
    expect(ok.target).toMatchObject({ keyColumns: ['rowid'], rowid: true });
    const no = resultEditability([Id, Name], { singleSelect: true, snapshot: snap, conn: undefined, dialect: 'sqlite' });
    expect(no.reason).toBe('people has no primary key: select rowid too (SELECT t.*, rowid FROM …) to edit');
  });
});
