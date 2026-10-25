// IntelliSense for user-defined types: names in type positions (DECLARE, CREATE TABLE / PROC parameters, CAST), details by kind,
// and READONLY after a table-type parameter.
import { describe, expect, it } from 'vitest';
import type { CatalogObject, CatalogSnapshot } from '../../api/types';
import { createIntel } from '../index';
import { typeDetail } from '../complete/completer';
import { doc, find, labels } from './helpers';

function snapshot(dialect: 'tsql' | 'plsql', schema: string, objects: CatalogObject[]): CatalogSnapshot {
  return { connectionId: 'c', dialect, database: dialect === 'tsql' ? 'Shop' : null, defaultSchema: schema, version: 1, databases: [], schemas: [{ name: schema, version: 1, objects }] };
}

const TSQL: CatalogObject[] = [
  { t: 'table', n: 'Customers', c: [['Id', 'int', 0, 1, 1, null]] },
  { t: 'type', n: 'Phone', k: 'alias', bt: 'nvarchar(20) not null' },
  { t: 'type', n: 'PhoneList', k: 'table', bt: 'table (2 columns)', c: [['Ordinal', 'int', 0, 0, 0, null], ['Number', 'dbo.Phone', 1, 0, 0, null]] },
  { t: 'type', n: 'NoteSchema', k: 'xmlschema', bt: 'xml schema collection' },
];

const tsql = createIntel('tsql');
tsql.setCatalog(snapshot('tsql', 'dbo', TSQL));
const plsql = createIntel('plsql');
plsql.setCatalog(snapshot('plsql', 'SHOP', [
  { t: 'type', n: 'ADDRESS_T', k: 'object', bt: '3 attributes, 1 method', c: [['STREET', 'VARCHAR2(100)', 1, 0, 0, null]] },
  { t: 'type', n: 'PHONE_LIST', k: 'varray', bt: 'VARRAY(5) OF VARCHAR2(30)' },
]));

function at(intel: ReturnType<typeof createIntel>, input: string) {
  const d = doc(intel, input);
  return intel.complete(d.uri, d.offset);
}

describe('user-defined types in type positions', () => {
  it('T-SQL: DECLARE @x offers alias and table types next to the built-in types, not XML schema collections', () => {
    const r = at(tsql, 'DECLARE @p |');
    expect(labels(r.items)).toEqual(expect.arrayContaining(['INT', 'Phone', 'PhoneList']));
    expect(labels(r.items)).not.toContain('NoteSchema');
    expect(find(r.items, 'Phone')?.kind).toBe('type');
    expect(find(r.items, 'Phone')?.detail).toBe('user-defined data type: nvarchar(20) not null');
    expect(find(r.items, 'PhoneList')?.detail).toBe('user-defined table type: table (2 columns)');
  });

  it('T-SQL: column types of CREATE TABLE and procedure parameters', () => {
    expect(labels(at(tsql, 'CREATE TABLE dbo.t (id int, phone |').items)).toEqual(expect.arrayContaining(['Phone', 'PhoneList']));
    expect(labels(at(tsql, 'CREATE PROCEDURE dbo.P @rows |').items)).toEqual(expect.arrayContaining(['PhoneList', 'Phone']));
    expect(labels(at(tsql, 'CREATE PROCEDURE dbo.P (@id int, @p |').items)).toContain('Phone');
    expect(labels(at(tsql, 'CREATE FUNCTION dbo.F (@a |').items)).toContain('Phone');
  });

  it('PL/SQL: object and collection types in a declaration', () => {
    const r = at(plsql, 'DECLARE\n  v |');
    expect(labels(r.items)).toEqual(expect.arrayContaining(['ADDRESS_T', 'PHONE_LIST']));
    expect(find(r.items, 'PHONE_LIST')?.detail).toBe('VARRAY collection type: VARRAY(5) OF VARCHAR2(30)');
  });
});

describe('READONLY after a table-type parameter', () => {
  it('is offered after a table type and OUTPUT after any other type', () => {
    const table = at(tsql, 'CREATE PROCEDURE dbo.P @rows dbo.PhoneList |');
    expect(labels(table.items)).toContain('READONLY');
    expect(labels(table.items)).not.toContain('OUTPUT');
    const bare = at(tsql, 'CREATE PROCEDURE dbo.P @rows PhoneList |');
    expect(labels(bare.items)).toContain('READONLY');
    const plain = at(tsql, 'CREATE PROCEDURE dbo.P @id int |');
    expect(labels(plain.items)).toContain('OUTPUT');
    expect(labels(plain.items)).not.toContain('READONLY');
  });

  it('does not interfere while the type name is being typed', () => {
    const typing = at(tsql, 'CREATE PROCEDURE dbo.P @rows dbo.Pho|');
    expect(labels(typing.items)).toContain('PhoneList');
    expect(labels(typing.items)).not.toContain('READONLY');
  });
});

describe('typeDetail', () => {
  const entry = (obj: CatalogObject) => ({ obj }) as unknown as Parameters<typeof typeDetail>[0];
  it('keeps the PostgreSQL wording and describes the kinds of the other providers', () => {
    expect(typeDetail(entry({ t: 'type', n: 'a', c: [['x', 'enum label', 0, 0, 0, null], ['y', 'enum label', 0, 0, 0, null]] }))).toBe('enum: x, y');
    expect(typeDetail(entry({ t: 'type', n: 'a', cm: 'domain over text' }))).toBe('domain over text');
    expect(typeDetail(entry({ t: 'type', n: 'a', k: 'clr', bt: 'Geo.Point' }))).toBe('CLR type: Geo.Point');
    expect(typeDetail(entry({ t: 'type', n: 'a', k: 'nested' }))).toBe('nested table collection type');
    expect(typeDetail(entry({ t: 'type', n: 'a' }))).toBe('type');
  });
});
