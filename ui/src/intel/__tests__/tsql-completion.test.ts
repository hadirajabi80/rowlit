// T-SQL completion positions that used to fall through to "what follows an operand": the select list after TOP n,
// the type of CAST/TRY_CAST/CONVERT, and a table's WITH (…) hint list.
import { describe, expect, it } from 'vitest';
import { complete, fixtures, labels } from './helpers';
import { createIntel } from '../index';
import type { CatalogSnapshot } from '../../api/types';

const at = (sql: string) => complete('tsql', sql).items;
const names = (sql: string) => labels(at(sql));

describe('SELECT TOP n |', () => {
  it.each([
    'SELECT TOP 10 | FROM dbo.Customers',
    'SELECT TOP (10) | FROM dbo.Customers',
    'SELECT TOP 10 PERCENT | FROM dbo.Customers',
    'SELECT TOP 10 WITH TIES | FROM dbo.Customers',
  ])('offers the columns, not operators: %s', (sql) => {
    const l = names(sql);
    expect(l).toEqual(expect.arrayContaining(['Id', 'Name', 'Email']));
    expect(l).not.toContain('AND');
    expect(l).not.toContain('LIKE');
  });

  it('still offers the operators after a column that follows TOP', () => {
    const l = names('SELECT TOP 10 Id | FROM dbo.Customers');
    expect(l).toEqual(expect.arrayContaining(['AS']));
  });
});

describe('type positions', () => {
  it.each([
    'SELECT CAST(Id AS |) FROM dbo.Customers',
    'SELECT TRY_CAST(Id AS |) FROM dbo.Customers',
    'SELECT CONVERT(|, Id) FROM dbo.Customers',
    'SELECT TRY_CONVERT(|, Id) FROM dbo.Customers',
  ])('offers data types: %s', (sql) => {
    const items = at(sql);
    expect(labels(items)).toEqual(expect.arrayContaining(['INT', 'VARCHAR', 'NVARCHAR']));
    expect(items.some((i) => i.kind === 'column')).toBe(false);
  });

  it('filters the types by what is typed', () => {
    expect(names('SELECT CAST(Id AS va|) FROM dbo.Customers').sort()).toEqual(['NVARCHAR', 'SQL_VARIANT', 'VARBINARY', 'VARCHAR']);
  });

  it('the value argument of CONVERT is an expression again', () => {
    const items = at('SELECT CONVERT(varchar(10), |) FROM dbo.Customers');
    expect(labels(items)).toContain('Name');
  });
});

describe('table hints', () => {
  it.each([
    'SELECT * FROM dbo.Customers WITH (|',
    'SELECT * FROM dbo.Customers c WITH (NOLOCK, |',
    'SELECT * FROM dbo.Customers c JOIN dbo.Orders o WITH (|',
    'UPDATE dbo.Customers WITH (|',
  ])('offers the hints: %s', (sql) => {
    const l = names(sql);
    expect(l.slice(0, 3)).toEqual(['NOLOCK', 'READUNCOMMITTED', 'READCOMMITTED']);
    expect(l).toContain('UPDLOCK');
    expect(l).not.toContain('WHERE');
  });

  it('a table hint is not offered where WITH starts a CTE or after a plain table', () => {
    expect(names('WITH |')).not.toContain('NOLOCK');
    expect(names('SELECT * FROM dbo.Customers |')).not.toContain('NOLOCK');
  });
});

describe('OUTPUT inserted. / deleted.', () => {
  it.each([
    "INSERT INTO dbo.Customers (Name) OUTPUT inserted.| VALUES ('x')",
    'INSERT INTO dbo.Customers (Name) OUTPUT inserted.|',
    "UPDATE dbo.Customers SET Name = 'x' OUTPUT inserted.| WHERE Id = 1",
    "UPDATE dbo.Customers SET Name = 'x' OUTPUT deleted.|",
    'DELETE FROM dbo.Customers OUTPUT deleted.| WHERE Id = 1',
    'DELETE c OUTPUT deleted.| FROM dbo.Customers c WHERE c.Id = 1',
    'MERGE dbo.Customers AS t USING dbo.Orders AS s ON t.Id = s.CustomerId WHEN MATCHED THEN DELETE OUTPUT deleted.|',
  ])('offers the columns of the target: %s', (sql) => {
    expect(names(sql)).toEqual(expect.arrayContaining(['Id', 'Name', 'Email']));
  });

  it('filters by the typed prefix after a comma', () => {
    expect(names('DELETE FROM dbo.Customers OUTPUT deleted.Id, deleted.Na|')).toEqual(['Name']);
  });
});

describe('CROSS APPLY table-valued functions', () => {
  const snap = JSON.parse(JSON.stringify(fixtures.tsql)) as CatalogSnapshot;
  snap.schemas.find((s) => s.name === 'dbo')!.objects.push({
    t: 'tablefunc', n: 'fnOrdersOf',
    c: [['OrderId', 'int', 0, 0, 0, null], ['Placed', 'datetime2', 1, 0, 0, null]],
    p: [['@customerId', 'int', 'in', 0]],
  } as never);
  const intel = createIntel('tsql');
  intel.setCatalog(snap);
  const ofs = (sql: string) => labels(complete('tsql', sql, undefined, intel).items).filter((l) => l !== '*');

  it.each([
    'SELECT o.| FROM dbo.Customers c CROSS APPLY dbo.fnOrdersOf(c.Id) o',
    'SELECT * FROM dbo.Customers c OUTER APPLY dbo.fnOrdersOf(c.Id) AS o WHERE o.|',
    'SELECT * FROM dbo.fnOrdersOf(1) o WHERE o.|',
    'SELECT o.| FROM dbo.Customers c CROSS APPLY dbo.fnOrdersOf(c.Id) o ORDER BY o.OrderId',
  ])('completes the columns of the function: %s', (sql) => {
    expect(ofs(sql)).toEqual(expect.arrayContaining(['OrderId', 'Placed']));
  });

  it.each([
    'SELECT o.| FROM dbo.Customers c CROSS APPLY fnOrdersOf(c.Id) AS o',
    'SELECT o.| FROM dbo.Customers c CROSS APPLY [dbo].[fnOrdersOf](c.Id) o',
    'SELECT o.| FROM dbo.Customers c CROSS APPLY dbo.fnOrdersOf(c.Id) o JOIN dbo.Orders x ON x.Id = o.OrderId',
  ])('variants: %s', (sql) => {
    expect(ofs(sql)).toEqual(expect.arrayContaining(['OrderId', 'Placed']));
  });

  it('built-in table functions: STRING_SPLIT, OPENJSON, GENERATE_SERIES', () => {
    expect(ofs("SELECT s.| FROM dbo.Customers c CROSS APPLY STRING_SPLIT(c.Name, ' ') s")).toEqual(['value', 'ordinal']);
    expect(ofs('SELECT j.| FROM dbo.Customers c CROSS APPLY OPENJSON(c.Email) AS j')).toEqual(['key', 'value', 'type']);
    expect(ofs('SELECT g.| FROM GENERATE_SERIES(1, 10) g')).toEqual(['value']);
    expect(ofs("SELECT t.| FROM STRING_SPLIT('a,b', ',') AS t(piece)")).toEqual(['piece']);
  });

  it('offers them unqualified too', () => {
    expect(ofs('SELECT | FROM dbo.Customers c CROSS APPLY dbo.fnOrdersOf(c.Id) o')).toEqual(expect.arrayContaining(['OrderId', 'Name']));
  });
});
