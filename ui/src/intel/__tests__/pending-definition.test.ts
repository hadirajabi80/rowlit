// Go to definition on `Sales.Customers` while the Sales schema is not loaded yet: the schema is requested (hover,
// definition and the pending lookup all ask the host, once), `pendingDefinition` says what is on its way, and the same
// lookup succeeds when the catalog arrives. Names the server does not have are not pending.
import { describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '../../api/types';
import { createIntel, type ForeignCatalogInput, type Intel } from '../index';
import { doc, fixtures } from './helpers';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** shop on SQL Server with only dbo loaded; Sales and audit are listed but not loaded. */
function tsqlConsole(extra?: Partial<CatalogSnapshot>) {
  const full = clone(fixtures.tsql);
  const sales = full.schemas.find((s) => s.name === 'Sales')!;
  sales.objects.push({ t: 'table', n: 'Customers', c: [['Id', 'int', 0, 1, 1, null], ['Name', 'nvarchar(100)', 0, 0, 0, null]], pk: ['Id'] } as never);
  const listed: CatalogSnapshot = { ...full, schemas: full.schemas.filter((s) => s.name !== 'Sales'), schemaNames: ['dbo', 'Sales', 'audit'], databases: ['shop', 'warehouse'], ...extra };
  const complete: CatalogSnapshot = { ...full, schemas: full.schemas, schemaNames: ['dbo', 'Sales', 'audit'], databases: ['shop', 'warehouse'], ...extra };
  const requester = vi.fn<(schema: string) => void>();
  const intel = createIntel('tsql');
  intel.setCatalog(listed);
  intel.setSchemaRequester(requester);
  return { intel, requester, listed, complete };
}

const at = (intel: Intel, sql: string, needle: string, k = 1) => {
  const d = doc(intel, sql);
  return { def: () => intel.definition(d.uri, d.text.indexOf(needle) + k), pending: () => intel.pendingDefinition(d.uri, d.text.indexOf(needle) + k), hover: () => intel.hover(d.uri, d.text.indexOf(needle) + k) };
};

describe('a qualified name in a schema that is not loaded', () => {
  it('requests the schema, reports what is loading, and resolves once the schema arrives', () => {
    const { intel, requester, complete } = tsqlConsole();
    const x = at(intel, 'SELECT * FROM Sales.Customers', 'Customers');
    expect(x.def()).toBeNull();
    expect(requester).toHaveBeenCalledWith('Sales');
    expect(x.pending()).toEqual({ loading: 'Sales', target: 'Sales.Customers' });
    intel.setCatalog(complete);
    expect(x.pending()).toBeNull();
    expect(x.def()).toEqual({ kind: 'object', ref: { database: 'shop', schema: 'Sales', name: 'Customers', type: 'table' } });
  });

  it('asks the host once however many times it is looked up', () => {
    const { intel, requester } = tsqlConsole();
    const x = at(intel, 'SELECT * FROM Sales.Customers', 'Customers');
    for (let i = 0; i < 4; i++) { x.def(); x.pending(); x.hover(); }
    expect(requester.mock.calls.filter(([s]) => s === 'Sales')).toHaveLength(1);
  });

  it('hover on the name also loads the schema (no completion needed first)', () => {
    const { intel, requester } = tsqlConsole();
    at(intel, 'SELECT * FROM Sales.Customers', 'Customers').hover();
    expect(requester).toHaveBeenCalledWith('Sales');
  });

  it('a schema the server does not have is not pending: the name is simply unknown', () => {
    const { intel } = tsqlConsole();
    const x = at(intel, 'SELECT * FROM Nope.Customers', 'Customers');
    expect(x.def()).toBeNull();
    expect(x.pending()).toBeNull();
  });

  it('a loaded schema without the object is not pending', () => {
    const { intel, complete } = tsqlConsole();
    intel.setCatalog(complete);
    const x = at(intel, 'SELECT * FROM Sales.Missing', 'Missing');
    expect(x.def()).toBeNull();
    expect(x.pending()).toBeNull();
  });

  it('a column of such a table waits for the same schema', () => {
    const { intel, complete } = tsqlConsole();
    const x = at(intel, 'SELECT Sales.Customers.Name FROM Sales.Customers', 'Name');
    expect(x.pending()).toEqual({ loading: 'Sales', target: 'Sales.Customers.Name' });
    intel.setCatalog(complete);
    expect(x.def()).toMatchObject({ kind: 'object', column: 'Name', ref: { schema: 'Sales', name: 'Customers' } });
  });

  it('the schema list itself not here yet: pending while the host can load schemas', () => {
    const { intel, requester, complete } = tsqlConsole({ schemaNames: undefined });
    const x = at(intel, 'SELECT * FROM Sales.Customers', 'Customers');
    expect(x.pending()).toEqual({ loading: 'Sales', target: 'Sales.Customers' });
    expect(requester).toHaveBeenCalledWith('Sales');
    intel.setCatalog({ ...complete, schemas: [] });
    expect(x.pending()).toEqual({ loading: 'Sales', target: 'Sales.Customers' }); // listed now, objects on their way
    intel.setCatalog(complete);
    expect(x.pending()).toBeNull();
  });
});

describe('three-part names', () => {
  const WAREHOUSE = {
    connectionId: 'c_tsql', dialect: 'tsql', database: 'warehouse', defaultSchema: 'dbo', version: 1, databases: [], schemaNames: ['dbo'],
    schemas: [{ name: 'dbo', version: 1, objects: [{ t: 'table', n: 'Parts', c: [['Id', 'int', 0, 1, 1, null]], pk: ['Id'] }] }],
  } as unknown as CatalogSnapshot;
  const input = (snapshot: CatalogSnapshot | null, status: ForeignCatalogInput['status'] = 'ready'): ForeignCatalogInput => ({ database: 'warehouse', status, snapshot });

  it('another database is requested, reported while it loads, and resolved when it is here', () => {
    const { intel } = tsqlConsole();
    const req = vi.fn<(database: string, schema?: string) => void>();
    intel.setDatabaseRequester(req);
    const x = at(intel, 'SELECT * FROM warehouse.dbo.Parts', 'Parts');
    expect(x.def()).toBeNull();
    expect(req).toHaveBeenCalledWith('warehouse', undefined);
    expect(x.pending()).toEqual({ loading: 'warehouse', target: 'warehouse.dbo.Parts' });

    intel.setForeignCatalogs([input({ ...WAREHOUSE, schemas: [] })]); // schema list only
    expect(x.pending()).toEqual({ loading: 'warehouse.dbo', target: 'warehouse.dbo.Parts' });
    expect(req).toHaveBeenCalledWith('warehouse', 'dbo');

    intel.setForeignCatalogs([input(WAREHOUSE)]);
    expect(x.pending()).toBeNull();
    expect(x.def()).toEqual({ kind: 'object', ref: { database: 'warehouse', schema: 'dbo', name: 'Parts', type: 'table' } });
  });

  it('a database that failed to load is not pending', () => {
    const { intel } = tsqlConsole();
    intel.setDatabaseRequester(vi.fn());
    intel.setForeignCatalogs([input(null, 'error')]);
    expect(at(intel, 'SELECT * FROM warehouse.dbo.Parts', 'Parts').pending()).toBeNull();
  });
});

describe('unqualified names', () => {
  it('PostgreSQL: waits for the search_path schemas that are not loaded', () => {
    const full = clone(fixtures.pgsql);
    const listed: CatalogSnapshot = { ...full, schemas: [], schemaNames: full.schemas.map((s) => s.name), searchPath: ['public'] };
    const requester = vi.fn<(schema: string) => void>();
    const intel = createIntel('pgsql');
    intel.setCatalog(listed);
    intel.setSchemaRequester(requester);
    const x = at(intel, 'SELECT * FROM customers', 'customers');
    expect(x.def()).toBeNull();
    expect(x.pending()).toEqual({ loading: 'public', target: 'customers' });
    expect(requester).toHaveBeenCalledWith('public');
    intel.setCatalog({ ...full, searchPath: ['public'] });
    expect(x.pending()).toBeNull();
    expect(x.def()).toMatchObject({ kind: 'object', ref: { schema: 'public', name: 'customers' } });
  });

  it('SQL Server: the default schema that is not loaded yet is pending', () => {
    const { intel, requester, listed } = tsqlConsole();
    intel.setCatalog({ ...listed, schemas: [] });
    const x = at(intel, 'SELECT * FROM Orders', 'Orders');
    expect(x.pending()).toEqual({ loading: 'dbo', target: 'Orders' });
    expect(requester).toHaveBeenCalledWith('dbo');
  });
});
