// design-08 / design-p4: statements behind Drop…, Truncate… and Generate SQL ▸.
import { describe, expect, it } from 'vitest';
import { canDrop, dropSql, sqlTemplate, truncateSql } from './objectActions';

const ref = { database: null, schema: 'dbo', name: 'Customers', type: 'table' as const };
const cols = [
  { name: 'Id', pk: true, generated: true },
  { name: 'Name', pk: false, generated: false },
  { name: 'City', pk: false, generated: false },
];

describe('explorer object actions', () => {
  it('drop / truncate statements per dialect', () => {
    expect(dropSql(ref, 'tsql')).toBe('DROP TABLE dbo.Customers');
    expect(dropSql({ ...ref, schema: 'main' }, 'sqlite')).toBe('DROP TABLE Customers');
    expect(dropSql({ ...ref, schema: 'SHOP', name: 'CUSTOMERS' }, 'plsql')).toMatch(/^DROP TABLE .*CUSTOMERS PURGE$/);
    expect(dropSql({ ...ref, type: 'view', name: 'V' }, 'tsql')).toBe('DROP VIEW dbo.V');
    expect(truncateSql({ schema: 'main', name: 'Orders' }, 'sqlite')).toBe('DELETE FROM Orders');
    expect(truncateSql(ref, 'tsql')).toBe('TRUNCATE TABLE dbo.Customers');
  });

  it('ClickHouse: dictionaries, materialized views and SQL functions drop with the statements its parser has', () => {
    const base = { database: null, schema: 'shop', name: 'product_dict', type: 'type' as const };
    expect(dropSql(base, 'clickhouse')).toBe('DROP DICTIONARY shop.product_dict');
    expect(dropSql({ ...base, type: 'mview', name: 'daily_sales' }, 'clickhouse')).toBe('DROP VIEW shop.daily_sales');
    expect(dropSql({ ...base, type: 'func', name: 'tax' }, 'clickhouse')).toBe('DROP FUNCTION tax'); // global: no database prefix
    expect(dropSql({ ...base, type: 'table', name: 'orders' }, 'clickhouse')).toBe('DROP TABLE shop.orders');
    expect(dropSql({ ...base, type: 'view', name: 'v' }, 'clickhouse')).toBe('DROP VIEW shop.v');
    expect(dropSql({ ...base, name: 'positive_int' }, 'pgsql', 'domain')).toBe('DROP DOMAIN shop.positive_int'); // others unchanged
  });

  it('ClickHouse: the UPDATE template is a mutation without the key columns in SET', () => {
    const t = { database: null, schema: 'shop', name: 'events', type: 'table' as const };
    expect(sqlTemplate('update', t, cols, 'clickhouse', 'shop')).toBe('ALTER TABLE events\nUPDATE Name = :Name,\n       City = :City\nWHERE Id = :Id;');
    expect(sqlTemplate('delete', t, cols, 'clickhouse', 'shop')).toBe('DELETE FROM events\nWHERE Id = :Id;');
  });

  it('Drop is offered only for droppable types of the dialect', () => {
    expect(canDrop('trigger', 'sqlite')).toBe(true);
    expect(canDrop('proc', 'sqlite')).toBe(false);
    expect(canDrop('package', 'plsql')).toBe(true);
    expect(canDrop('package', 'tsql')).toBe(false);
  });

  it('SELECT / INSERT / UPDATE / DELETE templates use the key and bind placeholders', () => {
    expect(sqlTemplate('select', ref, cols, 'tsql', 'dbo')).toBe('SELECT Id,\n       Name,\n       City\nFROM dbo.Customers;');
    expect(sqlTemplate('insert', ref, cols, 'tsql', 'dbo')).toBe('INSERT INTO dbo.Customers (Name, City)\nVALUES (@Name, @City);');
    expect(sqlTemplate('update', ref, cols, 'tsql', 'dbo')).toBe('UPDATE dbo.Customers\nSET Name = @Name,\n    City = @City\nWHERE Id = @Id;');
    expect(sqlTemplate('delete', { ...ref, schema: 'main' }, cols, 'sqlite', 'main')).toBe('DELETE FROM Customers\nWHERE Id = :Id;');
  });
});
