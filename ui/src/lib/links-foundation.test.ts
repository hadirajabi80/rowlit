// plan-links WP0: the shell pieces of linked databases (dialect duckdb, provider linked) and the shared naming rules,
// mirrored by engine/tests/DbStudio.Federation.Tests/WpZero/ContractTests.cs (same cases).
import { describe, expect, it } from 'vitest';
import { isValidAlias, linkDefinitionOf, linkProps, slugifyAlias, uniqueAlias, type LinkDefinition } from '../api/links';
import type { ColumnInfo } from '../api/types';
import { buildPredicate, inlineParams, placeholder } from '../filter/sql';
import { newCondition, newGroup } from '../filter/model';
import { readObjectDrag, ROWLIT_OBJECT_MIME } from './dragObject';
import { hasExplain, hasTransactions, schemaIsDatabase } from './providerLevels';
import { quoteIdent } from './sql';

describe('naming rules (twins of LinkRules / LinkSql)', () => {
  it.each([
    ['Sales DB (prod)', 'sales_db_prod'],
    ['  CRM ', 'crm'],
    ['2024 archive', '_2024_archive'],
    ['پایگاه', 'db'],
    ['a--b__c', 'a_b_c'],
  ])('slugify %s', (name, expected) => expect(slugifyAlias(name)).toBe(expected));

  it('aliases', () => {
    expect(isValidAlias('crm')).toBe(true);
    expect(isValidAlias('_2024')).toBe(true);
    expect(isValidAlias('Crm')).toBe(false);
    expect(isValidAlias('main')).toBe(false);
    expect(isValidAlias('views')).toBe(false);
    expect(isValidAlias('order')).toBe(false);
    expect(isValidAlias('a'.repeat(64))).toBe(false);
    expect(uniqueAlias('crm', ['CRM'])).toBe('crm_2');
    expect(uniqueAlias('crm', ['crm', 'crm_2'])).toBe('crm_3');
    expect(uniqueAlias('main', [])).toBe('main_2');
  });

  it.each([
    ['customers', 'customers'],
    ['Customers', 'Customers'],
    ['order', '"order"'],
    ['first name', '"first name"'],
    ['a"b', '"a""b"'],
    ['1st', '"1st"'],
  ])('quotes %s for duckdb', (name, expected) => expect(quoteIdent(name, 'duckdb')).toBe(expected));
});

describe('link definition props', () => {
  it('round-trips and tolerates missing keys', () => {
    const def: LinkDefinition = {
      version: 1,
      members: [{ alias: 'crm', connectionId: 'c_1', schema: 'dbo', tables: [{ name: 'Customers', as: 'customers' }] }],
      relations: [],
      options: { maxRowsPerSource: 10 },
    };
    // Saved as version 2: every member carries its scope (and allTables for older builds).
    expect(linkDefinitionOf({ props: linkProps(def) })).toEqual({
      ...def,
      version: 2,
      members: [{ ...def.members[0], scope: 'tables', allTables: false }],
    });
    expect(linkDefinitionOf({ props: {} })).toMatchObject({ members: [], relations: [], options: {} });
  });
});

describe('filter SQL for duckdb', () => {
  const cols: ColumnInfo[] = [
    { name: 'name', ordinal: 0, dbType: 'VARCHAR', kind: 'string', nullable: true },
    { name: 'active', ordinal: 1, dbType: 'BOOLEAN', kind: 'bool', nullable: true },
  ] as ColumnInfo[];

  it('binds $name, uses ILIKE and boolean literals', () => {
    expect(placeholder('fp1', 'duckdb')).toBe('$fp1');
    const g = newGroup('and', [newCondition('name', 'contains', ['a%b']), newCondition('active', 'isTrue')]);
    const r = buildPredicate(g, cols, 'duckdb');
    expect(r.where).toBe("name ILIKE '%' || $fp1 || '%' ESCAPE '\\' AND active = TRUE");
    expect(r.params).toEqual([{ name: 'fp1', kind: 'string', value: 'a\\%b' }]);
    expect(inlineParams(r.where!, r.params, 'duckdb')).toBe("name ILIKE '%' || 'a\\%b' || '%' ESCAPE '\\' AND active = TRUE");
  });

  it('lets the builder render qualified column references', () => {
    const r = buildPredicate(newGroup('and', [newCondition('t2.status', 'eq', ['paid'])]),
      [{ name: 't2.status', ordinal: 0, dbType: 'VARCHAR', kind: 'string', nullable: true } as ColumnInfo], 'duckdb',
      { columnRef: () => 'orders.status' });
    expect(r.where).toBe('lower(orders.status) = lower($fp1)');
  });
});

describe('provider levels of a link', () => {
  it('has no transactions, no EXPLAIN and schemas (aliases) of its own', () => {
    expect(hasTransactions('linked')).toBe(false);
    expect(hasExplain('linked')).toBe(false);
    expect(schemaIsDatabase('linked')).toBe(false);
    expect(hasTransactions('postgresql')).toBe(true);
    expect(hasExplain('postgresql')).toBe(true);
  });
});

describe('explorer object drag payload', () => {
  const dt = (data: Record<string, string>) => ({ types: Object.keys(data), getData: (k: string) => data[k] ?? '' });

  it('reads a dragged object and ignores anything else', () => {
    const drag = { connectionId: 'c_1', providerId: 'sqlite', database: null, schema: 'main', name: 'customers', type: 'table', column: null };
    expect(readObjectDrag(dt({ [ROWLIT_OBJECT_MIME]: JSON.stringify(drag) }))).toEqual(drag);
    expect(readObjectDrag(dt({ 'text/plain': 'customers' }))).toBeNull();
    expect(readObjectDrag(dt({ [ROWLIT_OBJECT_MIME]: '{oops' }))).toBeNull();
    expect(readObjectDrag(null)).toBeNull();
  });
});
