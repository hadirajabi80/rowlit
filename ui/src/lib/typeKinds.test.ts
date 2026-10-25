// User-defined type kinds (SSMS Programmability › Types): labels, sub-folder order, CREATE templates, DROP statements.
import { describe, expect, it } from 'vitest';
import {
  compareSystemCategories, compareTypeKinds, creatableKinds, defaultTypeKind, dropKeywordOfType, dropTypeSql, newTypeTemplate, supportsTypes,
  systemTypeDetail, typeKindInfo, typeKindOf, typeKindSingular,
} from './typeKinds';

describe('type kinds', () => {
  it('knows the kinds of every provider and ignores unknown ones', () => {
    expect(typeKindOf({ k: 'table' })).toBe('table');
    expect(typeKindOf({ k: 'bogus' })).toBeNull();
    expect(typeKindOf({})).toBeNull();
    expect(typeKindInfo('xmlschema')?.plural).toBe('XML Schema Collections');
    expect(typeKindSingular('alias')).toBe('user-defined data type');
    expect(typeKindSingular(null)).toBe('type');
  });

  it('orders SQL Server sub-folders like SSMS and sorts unknown kinds last', () => {
    expect(['xmlschema', 'clr', 'table', 'alias'].sort(compareTypeKinds)).toEqual(['alias', 'table', 'clr', 'xmlschema']);
    expect(['range', 'composite', 'domain', 'enum', 'zzz'].sort(compareTypeKinds)).toEqual(['enum', 'domain', 'composite', 'range', 'zzz']);
    expect(['nested', 'varray', 'object'].sort(compareTypeKinds)).toEqual(['object', 'varray', 'nested']);
  });

  it('orders the system data type groups', () => {
    expect(['Other data types', 'Date and time', 'Exact numerics', 'Zzz'].sort(compareSystemCategories))
      .toEqual(['Exact numerics', 'Date and time', 'Other data types', 'Zzz']);
  });

  it('describes the size of a built-in type', () => {
    const t = (name: string, maxLength: number | null, precision: number | null = null) => ({ name, maxLength, precision, scale: null });
    expect(systemTypeDetail(t('nvarchar', 8000))).toBe('up to 4000 chars');
    expect(systemTypeDetail(t('varchar', 8000))).toBe('up to 8000 bytes');
    expect(systemTypeDetail(t('varchar', -1))).toBe('max');
    expect(systemTypeDetail(t('decimal', 17, 38))).toBe('precision up to 38');
    expect(systemTypeDetail(t('int', 4))).toBe('4 bytes');
    expect(systemTypeDetail(t('tinyint', 1))).toBe('1 byte');
    expect(systemTypeDetail(t('sysname', 256))).toBe('nvarchar(128)');
  });
});

describe('New type… templates', () => {
  it('picks a default kind per dialect and none for dialects without user-defined types', () => {
    expect(defaultTypeKind('tsql')).toBe('alias');
    expect(defaultTypeKind('pgsql')).toBe('enum');
    expect(defaultTypeKind('plsql')).toBe('object');
    expect(defaultTypeKind('sqlite')).toBeNull();
    expect(supportsTypes('mysql')).toBe(false);
    expect(creatableKinds('tsql')).toEqual(['alias', 'table', 'clr', 'xmlschema']);
    expect(newTypeTemplate('sqlite', 'main', null)).toBe('');
  });

  it('SQL Server: alias and table types', () => {
    expect(newTypeTemplate('tsql', 'dbo', null)).toBe('CREATE TYPE dbo.NewType FROM nvarchar(50) NOT NULL;\n');
    const table = newTypeTemplate('tsql', 'Sales', 'table');
    expect(table).toContain('CREATE TYPE Sales.NewTableType AS TABLE (');
    expect(table).toContain('PRIMARY KEY CLUSTERED ([Id])');
    expect(newTypeTemplate('tsql', 'dbo', 'clr')).toContain('EXTERNAL NAME');
    expect(newTypeTemplate('tsql', 'dbo', 'xmlschema')).toContain('CREATE XML SCHEMA COLLECTION dbo.NewSchemaCollection AS N');
  });

  it('PostgreSQL: enum, domain, composite and range types', () => {
    expect(newTypeTemplate('pgsql', 'public', null)).toBe("CREATE TYPE public.new_enum AS ENUM ('first', 'second');\n");
    expect(newTypeTemplate('pgsql', 'app', 'domain')).toContain('CREATE DOMAIN app.new_domain AS text');
    expect(newTypeTemplate('pgsql', 'public', 'composite')).toContain('CREATE TYPE public.new_composite AS (');
    expect(newTypeTemplate('pgsql', 'public', 'range')).toContain('AS RANGE (SUBTYPE = integer)');
  });

  it('Oracle: object, VARRAY and nested table types end with the SQL*Plus slash', () => {
    expect(newTypeTemplate('plsql', 'SHOP', null)).toMatch(/^CREATE OR REPLACE TYPE SHOP\.NEW_OBJECT_T AS OBJECT \(/);
    expect(newTypeTemplate('plsql', 'SHOP', 'varray')).toBe('CREATE OR REPLACE TYPE SHOP.NEW_VARRAY_T AS VARRAY(10) OF VARCHAR2(100);\n/\n');
    expect(newTypeTemplate('plsql', 'SHOP', 'nested')).toContain('AS TABLE OF VARCHAR2(100)');
  });

  it('a kind the dialect cannot create falls back to its default', () => {
    expect(newTypeTemplate('tsql', 'dbo', 'enum')).toBe(newTypeTemplate('tsql', 'dbo', null));
  });
});

describe('DROP statements for types', () => {
  it('uses the keyword of the kind', () => {
    expect(dropKeywordOfType('xmlschema', 'tsql')).toBe('XML SCHEMA COLLECTION');
    expect(dropKeywordOfType('domain', 'pgsql')).toBe('DOMAIN');
    expect(dropKeywordOfType('table', 'tsql')).toBe('TYPE');
    expect(dropKeywordOfType('enum', 'pgsql')).toBe('TYPE');
    expect(dropTypeSql({ schema: 'dbo', name: 'Phone' }, 'alias', 'tsql')).toBe('DROP TYPE dbo.Phone');
    expect(dropTypeSql({ schema: 'dbo', name: 'NoteSchema' }, 'xmlschema', 'tsql')).toBe('DROP XML SCHEMA COLLECTION dbo.NoteSchema');
    expect(dropTypeSql({ schema: 'public', name: 'positive_int' }, 'domain', 'pgsql')).toBe('DROP DOMAIN public.positive_int');
    expect(dropTypeSql({ schema: 'SHOP', name: 'ADDRESS_T' }, 'object', 'plsql')).toBe('DROP TYPE SHOP.ADDRESS_T');
    expect(dropTypeSql({ schema: 'dbo', name: 'my type' }, 'alias', 'tsql')).toBe('DROP TYPE dbo.[my type]');
  });
});
