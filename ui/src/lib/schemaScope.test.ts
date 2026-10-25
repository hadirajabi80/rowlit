import { describe, expect, it } from 'vitest';
import type { CatalogSnapshot } from '../api/types';
import { createIntel } from '../intel';
import { fixtures } from '../intel/__tests__/helpers';
import { activeSchema, hasSchemaSwitcher, isEditorOverride, schemaModeOf, snapshotWithSchema } from './schemaScope';

const clone = (d: 'pgsql' | 'tsql') => JSON.parse(JSON.stringify(fixtures[d])) as CatalogSnapshot;

describe('which providers get a schema control', () => {
  it('SQL Server, PostgreSQL and Snowflake do; single-level providers (database = schema) do not', () => {
    for (const p of ['sqlserver', 'postgresql', 'snowflake']) expect(hasSchemaSwitcher(p)).toBe(true);
    for (const p of ['oracle', 'mysql', 'mariadb', 'clickhouse', 'cassandra', 'sqlite', 'redis', null, undefined]) expect(hasSchemaSwitcher(p)).toBe(false);
  });

  it('modes: SQL Server read-only, PostgreSQL / Snowflake settable, the engine\'s word wins', () => {
    expect(schemaModeOf('sqlserver')).toBe('readOnly');
    expect(schemaModeOf('postgresql')).toBe('session');
    expect(schemaModeOf('snowflake')).toBe('session');
    expect(schemaModeOf('mysql')).toBe('none');
    expect(schemaModeOf('postgresql', { schemaMode: 'readOnly' })).toBe('readOnly');
    expect(schemaModeOf('sqlserver', { schemaMode: 'none' })).toBe('readOnly');
  });
});

describe('the active schema', () => {
  it('session-level: the session wins once known (it follows SET search_path), the tab stands in before the first run', () => {
    expect(activeSchema('session', { schema: 'sales' }, 'public')).toBe('sales');
    expect(activeSchema('session', undefined, 'sales')).toBe('sales');
    expect(activeSchema('session', { schema: null }, null)).toBeNull();
  });

  it('SQL Server: the editor schema of the tab wins over the login default, which is only a fallback', () => {
    expect(activeSchema('readOnly', { schema: 'dbo' }, 'Sales')).toBe('Sales');
    expect(activeSchema('readOnly', { schema: 'dbo' }, null)).toBe('dbo');
    expect(isEditorOverride('readOnly', { schema: 'dbo' }, 'Sales')).toBe(true);
    expect(isEditorOverride('readOnly', { schema: 'dbo' }, 'dbo')).toBe(false);
    expect(isEditorOverride('session', { schema: 'dbo' }, 'Sales')).toBe(false);
  });
});

describe('snapshotWithSchema', () => {
  it('returns the same object when there is nothing to change', () => {
    const snap = clone('pgsql');
    expect(snapshotWithSchema(snap, null)).toBe(snap);
    expect(snapshotWithSchema(snap, 'public', ['public'])).toBe(snap);
    expect(snapshotWithSchema(null, 'sales')).toBeNull();
  });

  it('a schema the database does not have keeps the catalog default (stale choice)', () => {
    const snap = clone('pgsql');
    expect(snapshotWithSchema(snap, 'gone')).toBe(snap);
  });

  it('PostgreSQL: the schema becomes the default and heads the search_path', () => {
    const snap = clone('pgsql');
    const out = snapshotWithSchema(snap, 'sales', ['sales', 'public'])!;
    expect(out).not.toBe(snap);
    expect(out.defaultSchema).toBe('sales');
    expect(out.searchPath).toEqual(['sales', 'public']);
    // without a session path the catalog's own path follows
    expect(snapshotWithSchema(snap, 'sales')!.searchPath).toEqual(['sales', 'public']);
  });

  it('SQL Server: only the default schema changes (no search_path)', () => {
    const out = snapshotWithSchema(clone('tsql'), 'sales')!;
    expect(out.defaultSchema).toBe('Sales'); // matched case-insensitively against the database's schemas
    expect(out.searchPath).toBeUndefined();
  });
});

describe('IntelliSense uses the active schema as its default schema', () => {
  it('PostgreSQL: SELECT * FROM | offers the new default schema unqualified, and bare names resolve there', () => {
    const intel = createIntel('pgsql');
    intel.setCatalog(snapshotWithSchema(clone('pgsql'), 'sales', ['sales', 'public']));
    const text = 'SELECT * FROM ';
    intel.setDocument('test://pg-sales', text);
    const items = intel.complete('test://pg-sales', text.length).items;
    expect(items.find((x) => x.label === 'sales' && x.kind === 'schema')?.detail).toBe('default schema');
    expect(items.some((x) => x.label === 'invoices')).toBe(true); // sales.invoices, no qualification needed
    // a bare name of the default schema is known: no "unknown object" soft diagnostic
    intel.setDocument('test://pg-bare', 'SELECT * FROM invoices');
    expect(intel.softDiagnostics('test://pg-bare').filter((d) => /invoices/i.test(d.message))).toEqual([]);
  });

  it('PostgreSQL: with public (the catalog default) the same bare name is not offered unqualified', () => {
    const intel = createIntel('pgsql');
    intel.setCatalog(clone('pgsql'));
    const text = 'SELECT * FROM ';
    intel.setDocument('test://pg-public', text);
    const items = intel.complete('test://pg-public', text.length).items;
    expect(items.find((x) => x.label === 'public' && x.kind === 'schema')?.detail).toBe('default schema');
    expect(items.some((x) => x.label === 'invoices')).toBe(false);
  });

  it('SQL Server: the editor schema makes its tables the unqualified ones', () => {
    const intel = createIntel('tsql');
    intel.setCatalog(snapshotWithSchema(clone('tsql'), 'Sales'));
    const text = 'SELECT * FROM ';
    intel.setDocument('test://ms-sales', text);
    const items = intel.complete('test://ms-sales', text.length).items;
    expect(items.some((x) => x.label === 'Invoices')).toBe(true);
  });
});
