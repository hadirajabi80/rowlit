// T-SQL completion positions that used to fall through to "what follows an operand": the select list after TOP n,
// the type of CAST/TRY_CAST/CONVERT, and a table's WITH (…) hint list.
import { describe, expect, it } from 'vitest';
import { complete, labels } from './helpers';

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
