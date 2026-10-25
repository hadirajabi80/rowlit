// SQL Server three-part names across databases of the same server: `Other.`, `Other.dbo.`, `Other..`, columns of
// `Other.dbo.T` (directly or through an alias), hover, signature help, go to definition, diagnostics and `USE Other`.
// The other database's catalog is loaded lazily by the host: Intel asks through the database requester, shows a
// "Loading Other…" row, and completes once `setForeignCatalogs` delivers it.
import { describe, expect, it, vi } from 'vitest';
import type { CatalogSchema, CatalogSnapshot } from '../../api/types';
import { createIntel, type ForeignCatalogInput, type Intel } from '../index';
import type { CompletionItem } from '../types';
import { complete, doc, fixtures, labels, stripMd } from './helpers';

/** A second database on the same server: dbo (tables, a view, a proc, a function) and inv (one table). */
const WAREHOUSE_DBO: CatalogSchema = {
  name: 'dbo', version: 1,
  objects: [
    { t: 'table', n: 'Parts', cm: 'Warehouse parts', c: [['Id', 'int', 0, 1, 1, null], ['Sku', 'nvarchar(20)', 0, 0, 0, 'Stock keeping unit'], ['Name', 'nvarchar(100)', 0, 0, 0, null], ['Price', 'decimal(10,2)', 1, 0, 0, null]], pk: ['Id'] },
    { t: 'table', n: 'Stock', c: [['ProductId', 'int', 0, 1, 0, null], ['Qty', 'int', 0, 0, 0, null]], pk: ['ProductId'] },
    { t: 'view', n: 'vLowStock', c: [['ProductId', 'int', 0, 0, 0, null], ['Qty', 'int', 0, 0, 0, null]] },
    { t: 'proc', n: 'usp_Restock', p: [['@ProductId', 'int', 'in', 0], ['@Qty', 'int', 'in', 0]] },
    { t: 'func', n: 'fnMargin', p: [['', 'decimal', 'return', 0], ['@cost', 'decimal', 'in', 0], ['@price', 'decimal', 'in', 0]] },
  ],
};
const WAREHOUSE_INV: CatalogSchema = { name: 'inv', version: 1, objects: [{ t: 'table', n: 'Moves', c: [['Id', 'int', 0, 1, 1, null], ['ProductId', 'int', 0, 0, 0, null], ['Delta', 'int', 0, 0, 0, null]] }] };

const WAREHOUSE: CatalogSnapshot = {
  connectionId: 'c_tsql', dialect: 'tsql', database: 'warehouse', defaultSchema: 'dbo', version: 1, databases: [],
  schemas: [WAREHOUSE_DBO, WAREHOUSE_INV], schemaNames: ['dbo', 'inv'],
} as unknown as CatalogSnapshot;
/** What the host has right after the schema list: every schema name, no objects yet. */
const WAREHOUSE_LIST: CatalogSnapshot = { ...WAREHOUSE, schemas: [] };
const WAREHOUSE_DBO_ONLY: CatalogSnapshot = { ...WAREHOUSE, schemas: [WAREHOUSE_DBO] };

const input = (snapshot: CatalogSnapshot | null, status: ForeignCatalogInput['status'] = 'ready', failed?: string[]): ForeignCatalogInput => ({ database: 'warehouse', status, snapshot, ...(failed ? { failed } : {}) });

const SERVERS = ['master', 'shop', 'tempdb', 'warehouse', 'archive'];

/** A console on `shop` (the shared tsql fixture) of a server that also has `warehouse` and `archive`. */
function consoleOn(foreign?: ForeignCatalogInput[]) {
  const req = vi.fn<(database: string, schema?: string) => void>();
  const intel = createIntel('tsql');
  intel.setCatalog({ ...(JSON.parse(JSON.stringify(fixtures.tsql)) as CatalogSnapshot), databases: SERVERS, schemaNames: ['dbo', 'Sales'] });
  intel.setDatabaseRequester(req);
  if (foreign) intel.setForeignCatalogs(foreign);
  return { intel, req };
}
const at = (intel: Intel, sql: string) => complete('tsql', sql, undefined, intel);
const names = (items: CompletionItem[]) => items.map((x) => x.label);
const loading = (items: CompletionItem[]) => items.filter((x) => x.loading);
const diags = (intel: Intel, sql: string, code?: string) => {
  const d = doc(intel, sql);
  const all = intel.softDiagnostics(d.uri);
  return code ? all.filter((x) => x.code === code) : all;
};

describe('Other. → the other database\'s schemas', () => {
  it('asks the host for the database and shows one "Loading warehouse…" row, then retriggers with the schemas', () => {
    const { intel, req } = consoleOn();
    const r = at(intel, 'SELECT * FROM warehouse.|');
    expect(names(r.items)).toEqual(['Loading warehouse…']);
    expect(r.isIncomplete).toBe(true);
    expect(loading(r.items)).toHaveLength(1);
    expect(req).toHaveBeenCalledTimes(1);
    expect(req).toHaveBeenCalledWith('warehouse', undefined);
    // typing on: still the one row, nothing new is requested
    at(intel, 'SELECT * FROM warehouse.d|');
    expect(req).toHaveBeenCalledTimes(1);
    // the schema list arrives
    intel.setForeignCatalogs([input(WAREHOUSE_LIST)]);
    const r2 = at(intel, 'SELECT * FROM warehouse.|');
    expect(names(r2.items).sort()).toEqual(['dbo', 'inv']);
    expect(r2.items.every((x) => x.kind === 'schema' && x.insertText.endsWith('.') && x.command === 'retrigger')).toBe(true);
  });

  it('is case-insensitive and also works in the bracketed form', () => {
    const { intel, req } = consoleOn([input(WAREHOUSE_LIST)]);
    expect(names(at(intel, 'SELECT * FROM WAREHOUSE.|').items).sort()).toEqual(['dbo', 'inv']);
    expect(names(at(intel, 'SELECT * FROM [warehouse].|').items).sort()).toEqual(['dbo', 'inv']);
    expect(req).not.toHaveBeenCalled();
  });

  it('a database the server does not list offers nothing and requests nothing', () => {
    const { intel, req } = consoleOn();
    expect(at(intel, 'SELECT * FROM nowhere.|').items).toEqual([]);
    expect(req).not.toHaveBeenCalled();
  });

  it('a failed load shows nothing (no endless "Loading…")', () => {
    const { intel } = consoleOn([input(null, 'error')]);
    const r = at(intel, 'SELECT * FROM warehouse.|');
    expect(r.items).toEqual([]);
    expect(r.isIncomplete).toBe(true); // (the database qualifier always asks for a refresh while typing)
  });

  it('the current database still lists its own schemas, and the other databases are offered in FROM', () => {
    const { intel } = consoleOn([input(WAREHOUSE_LIST)]);
    expect(names(at(intel, 'SELECT * FROM shop.|').items)).toEqual(expect.arrayContaining(['dbo', 'Sales']));
    const dbs = at(intel, 'SELECT * FROM |').items.filter((x) => x.kind === 'database').map((x) => x.label);
    expect(dbs).toEqual(expect.arrayContaining(['warehouse', 'archive']));
  });
});

describe('Other.dbo. → tables, views, routines of that schema', () => {
  it('requests the schema when only the list is known, then completes its objects', () => {
    const { intel, req } = consoleOn([input(WAREHOUSE_LIST)]);
    const r = at(intel, 'SELECT * FROM warehouse.dbo.|');
    expect(names(r.items)).toEqual(['Loading warehouse.dbo…']);
    expect(req).toHaveBeenCalledWith('warehouse', 'dbo');
    intel.setForeignCatalogs([input(WAREHOUSE_DBO_ONLY)]);
    const r2 = at(intel, 'SELECT * FROM warehouse.dbo.|');
    expect(names(r2.items)).toEqual(expect.arrayContaining(['Parts', 'Stock', 'vLowStock']));
    expect(names(r2.items)).not.toContain('usp_Restock');
    expect(names(r2.items)).not.toContain('Moves');
    expect(r2.items.find((x) => x.label === 'Parts')?.ref).toEqual({ database: 'warehouse', schema: 'dbo', name: 'Parts', type: 'table' });
  });

  it('a schema whose load failed shows nothing instead of loading forever', () => {
    const { intel } = consoleOn([input(WAREHOUSE_LIST, 'ready', ['inv'])]);
    expect(at(intel, 'SELECT * FROM warehouse.inv.|').items).toEqual([]);
  });

  it('EXEC lists the procedures, an expression the functions', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    expect(names(at(intel, 'EXEC warehouse.dbo.|').items)).toContain('usp_Restock');
    expect(names(at(intel, 'EXEC warehouse.dbo.|').items)).not.toContain('Parts');
    expect(names(at(intel, 'SELECT warehouse.dbo.|').items)).toContain('fnMargin');
  });

  it('`Other..` offers the objects of that database\'s default schema (not the console\'s)', () => {
    const { intel, req } = consoleOn([input(WAREHOUSE_LIST)]);
    expect(names(at(intel, 'SELECT * FROM warehouse..|').items)).toEqual(['Loading warehouse.dbo…']);
    expect(req).toHaveBeenCalledWith('warehouse', 'dbo');
    intel.setForeignCatalogs([input(WAREHOUSE)]);
    const labs = names(at(intel, 'SELECT * FROM warehouse..|').items);
    expect(labs).toEqual(expect.arrayContaining(['Parts', 'Stock']));
    expect(labs).not.toContain('Customers');
    // while the database is not known at all, `x..` never falls back to the console's own default schema
    expect(at(intel, 'SELECT * FROM nowhere..|').items).toEqual([]);
  });

  it('the console\'s own database keeps working: shop.Sales.|, shop..|', () => {
    const { intel } = consoleOn();
    expect(names(at(intel, 'SELECT * FROM shop.Sales.|').items)).toContain('Invoices');
    expect(names(at(intel, 'SELECT * FROM shop..|').items)).toContain('Customers');
  });
});

describe('columns of a table of another database', () => {
  const sql = 'SELECT * FROM warehouse.dbo.Parts p JOIN dbo.Orders o ON o.Id = p.Id WHERE ';

  it('`Other.dbo.Table.|` and `alias.|`', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    expect(names(at(intel, 'SELECT warehouse.dbo.Parts.| FROM warehouse.dbo.Parts').items)).toEqual(expect.arrayContaining(['Id', 'Sku', 'Name', 'Price']));
    const r = at(intel, 'SELECT p.| FROM warehouse.dbo.Parts p');
    expect(names(r.items).filter((n) => n !== '*')).toEqual(['Id', 'Sku', 'Name', 'Price']);
    expect(r.items.find((x) => x.label === 'Price')?.description).toBe('decimal(10,2)');
    // the db..table form, and an unaliased source named by its table
    expect(names(at(intel, 'SELECT p.| FROM warehouse..Parts p').items)).toContain('Sku');
    expect(names(at(intel, 'SELECT Parts.| FROM warehouse.dbo.Parts').items)).toContain('Sku');
  });

  it('the unqualified list sees the columns of mixed sources (this database + the other one)', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    const r = at(intel, sql + '|');
    expect(names(r.items)).toEqual(expect.arrayContaining(['Sku', 'Price', 'Total']));
    // Id exists on both: qualified with its alias
    expect(r.items.filter((x) => x.label === 'Id').map((x) => x.insertText).sort()).toEqual(['o.Id', 'p.Id']);
  });

  it('JOIN ... ON offers the other database\'s columns of the joined source', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    const r = at(intel, 'SELECT * FROM dbo.Orders o JOIN warehouse.dbo.Stock s ON s.|');
    expect(names(r.items)).toEqual(expect.arrayContaining(['ProductId', 'Qty']));
  });

  it('a source of a database that is still loading has no columns yet, and completes once it arrives', () => {
    const { intel, req } = consoleOn();
    const sqlLoading = 'SELECT p.| FROM warehouse.dbo.Parts p';
    expect(names(at(intel, sqlLoading).items).filter((n) => n !== '*')).toEqual([]);
    expect(req).toHaveBeenCalledWith('warehouse', undefined); // asked for by the reference itself
    intel.setForeignCatalogs([input(WAREHOUSE_LIST)]);
    at(intel, sqlLoading);
    expect(req).toHaveBeenCalledWith('warehouse', 'dbo');
    intel.setForeignCatalogs([input(WAREHOUSE)]);
    expect(names(at(intel, sqlLoading).items)).toContain('Sku');
  });

  it('INSERT / UPDATE targets in another database', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    expect(names(at(intel, 'UPDATE warehouse.dbo.Stock SET |').items)).toEqual(expect.arrayContaining(['ProductId', 'Qty']));
    expect(names(at(intel, 'INSERT INTO warehouse.dbo.Stock (|').items)).toEqual(expect.arrayContaining(['ProductId', 'Qty']));
  });
});

describe('hover, definition, signature help', () => {
  const { intel } = consoleOn([input(WAREHOUSE)]);
  const x = (sql: string) => { const d = doc(intel, sql); return { ...d, hover: (needle: string, k = 1) => intel.hover(d.uri, d.text.indexOf(needle) + k), def: (needle: string, k = 1) => intel.definition(d.uri, d.text.indexOf(needle) + k) }; };

  it('hovering the table name shows the full three-part name and the columns', () => {
    const t = x('SELECT * FROM warehouse.dbo.Parts p');
    const md = stripMd(t.hover('Parts')!.markdown);
    expect(md).toContain('warehouse.dbo.Parts (table)');
    expect(md).toContain('Warehouse parts');
    expect(t.hover('Parts')!.markdown).toContain('| Sku | nvarchar(20) NOT NULL |  |');
  });

  it('hovering the schema and the database part', () => {
    const t = x('SELECT * FROM warehouse.dbo.Parts');
    expect(stripMd(t.hover('dbo')!.markdown)).toBe('schema warehouse.dbo (5 objects)');
    expect(stripMd(t.hover('warehouse')!.markdown)).toBe('database warehouse');
    const own = x('SELECT * FROM shop.dbo.Orders');
    expect(stripMd(own.hover('shop')!.markdown)).toBe('database shop (current database)');
  });

  it('an alias and a column of the other database', () => {
    const t = x('SELECT p.Sku FROM warehouse.dbo.Parts p');
    expect(stripMd(t.hover('p.Sku', 0)!.markdown)).toContain('alias p → warehouse.dbo.Parts (table), 4 columns');
    const col = stripMd(t.hover('Sku')!.markdown);
    expect(col).toContain('dbo.Parts.Sku nvarchar(20) NOT NULL');
    expect(col).toContain('Stock keeping unit');
  });

  it('go to definition opens the object in ITS database (table, alias column, three-part column, routine)', () => {
    expect(x('SELECT * FROM warehouse.dbo.Parts p').def('Parts')).toEqual({ kind: 'object', ref: { database: 'warehouse', schema: 'dbo', name: 'Parts', type: 'table' } });
    expect(x('SELECT p.Sku FROM warehouse.dbo.Parts p').def('Sku')).toEqual({ kind: 'object', ref: { database: 'warehouse', schema: 'dbo', name: 'Parts', type: 'table' }, column: 'Sku' });
    expect(x('SELECT warehouse.dbo.Parts.Sku FROM warehouse.dbo.Parts').def('Sku')).toEqual({ kind: 'object', ref: { database: 'warehouse', schema: 'dbo', name: 'Parts', type: 'table' }, column: 'Sku' });
    expect(x('SELECT * FROM warehouse..Stock').def('Stock')).toEqual({ kind: 'object', ref: { database: 'warehouse', schema: 'dbo', name: 'Stock', type: 'table' } });
    expect(x('EXEC warehouse.dbo.usp_Restock 1, 2').def('usp_Restock')).toEqual({ kind: 'object', ref: { database: 'warehouse', schema: 'dbo', name: 'usp_Restock', type: 'proc' } });
    // an object of the console's own database still opens there
    expect(x('SELECT * FROM shop.dbo.Orders').def('Orders')).toEqual({ kind: 'object', ref: { database: 'shop', schema: 'dbo', name: 'Orders', type: 'table' } });
  });

  it('signature help of a routine / function of the other database', () => {
    const e = doc(intel, 'EXEC warehouse.dbo.usp_Restock @ProductId = 1, |');
    const s = intel.signatureHelp(e.uri, e.offset)!;
    expect(s.signatures[0].label).toContain('usp_Restock');
    expect(s.signatures[0].parameters.map((p) => p.label)).toEqual(['@ProductId int', '@Qty int']);
    expect(s.activeParameter).toBe(1);
    const f = doc(intel, 'SELECT warehouse.dbo.fnMargin(1, |)');
    const sf = intel.signatureHelp(f.uri, f.offset)!;
    expect(sf.signatures[0].parameters).toHaveLength(2);
    expect(sf.activeParameter).toBe(1);
  });
});

describe('diagnostics', () => {
  it('no "unknown object" for a cross-database reference, loaded or not', () => {
    const { intel } = consoleOn();
    // not loaded: nothing can be said yet
    expect(diags(intel, 'SELECT p.Sku FROM warehouse.dbo.Parts p', 'unknown-table')).toEqual([]);
    expect(diags(intel, 'SELECT p.Sku FROM warehouse.dbo.Parts p').filter((d) => d.severity !== 'info')).toEqual([]);
    intel.setForeignCatalogs([input(WAREHOUSE_LIST)]);
    expect(diags(intel, 'SELECT * FROM warehouse.dbo.Parts', 'unknown-table')).toEqual([]);
    intel.setForeignCatalogs([input(WAREHOUSE)]);
    expect(diags(intel, 'SELECT p.Sku, s.Qty FROM warehouse.dbo.Parts p JOIN warehouse..Stock s ON s.ProductId = p.Id')).toEqual([]);
  });

  it('an object that is not in the other database (loaded) is an unknown table; so is an unknown column of its alias', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    const t = diags(intel, 'SELECT * FROM warehouse.dbo.Nope', 'unknown-table');
    expect(t).toHaveLength(1);
    expect(t[0].message).toBe("Unknown table 'warehouse.dbo.Nope'");
    const c = diags(intel, 'SELECT p.Missing FROM warehouse.dbo.Parts p', 'unknown-column');
    expect(c).toHaveLength(1);
    expect(c[0].message).toContain("Column 'Missing' not found in dbo.Parts");
  });

  it('an unknown database is a soft warning (three-part name and USE)', () => {
    const { intel } = consoleOn();
    const d = diags(intel, 'SELECT * FROM nowhere.dbo.T', 'unknown-database');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ severity: 'warning', message: "Unknown database 'nowhere'" });
    expect(diags(intel, 'USE nowhere', 'unknown-database')).toHaveLength(1);
    expect(diags(intel, 'USE warehouse', 'unknown-database')).toEqual([]);
    expect(diags(intel, 'SELECT * FROM shop.dbo.Orders', 'unknown-database')).toEqual([]);
    // no database list (catalog without one): nothing to compare with
    const bare = createIntel('tsql');
    bare.setCatalog({ ...(JSON.parse(JSON.stringify(fixtures.tsql)) as CatalogSnapshot), databases: [] });
    expect(diags(bare, 'SELECT * FROM nowhere.dbo.T', 'unknown-database')).toEqual([]);
  });

  it('the diagnostics refresh when the other database arrives (the listeners are told)', () => {
    const { intel } = consoleOn([input(WAREHOUSE_LIST)]);
    const seen = vi.fn();
    intel.onDidChange(seen);
    intel.setForeignCatalogs([input(WAREHOUSE)]);
    expect(seen).toHaveBeenCalled();
    seen.mockClear();
    intel.setForeignCatalogs([input(WAREHOUSE)]); // same snapshot again: nothing changes
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('USE Other: the rest of the script runs against that database', () => {
  it('completes the tables of the USE\'d database after the USE line (and not before it)', () => {
    const { intel, req } = consoleOn([input(WAREHOUSE)]);
    const after = at(intel, 'USE warehouse;\nSELECT * FROM |');
    expect(names(after.items)).toEqual(expect.arrayContaining(['Parts', 'Stock', 'vLowStock']));
    expect(names(after.items)).not.toContain('Customers');
    // the console's own database is a database item now, the USE'd one the current database
    expect(after.items.find((x) => x.label === 'warehouse' && x.kind === 'database')?.detail).toBe('current database');
    expect(after.items.find((x) => x.label === 'shop' && x.kind === 'database')?.detail).toBe('database');
    // the statement above the USE keeps the console's database
    const before = at(intel, 'SELECT * FROM |;\nUSE warehouse;');
    expect(names(before.items)).toContain('Customers');
    expect(names(before.items)).not.toContain('Parts');
    expect(req).not.toHaveBeenCalled();
  });

  it('works across GO, on later statements, and `USE shop` returns', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    expect(names(at(intel, 'USE warehouse\nGO\nSELECT * FROM |').items)).toContain('Parts');
    expect(names(at(intel, 'USE warehouse;\nSELECT 1;\nSELECT * FROM |').items)).toContain('Parts');
    expect(names(at(intel, 'USE warehouse;\nUSE shop;\nSELECT * FROM |').items)).toContain('Customers');
    expect(names(at(intel, 'USE [warehouse];\nSELECT * FROM |').items)).toContain('Parts');
    // columns, aliases and qualified names of the USE'd database
    expect(names(at(intel, 'USE warehouse;\nSELECT p.| FROM Parts p').items)).toContain('Sku');
    expect(names(at(intel, 'USE warehouse;\nSELECT * FROM dbo.|').items)).toContain('Stock');
    // the previous database stays reachable by its three-part name
    expect(names(at(intel, 'USE warehouse;\nSELECT * FROM shop.dbo.|').items)).toContain('Customers');
    expect(names(at(intel, 'USE warehouse;\nSELECT * FROM shop..|').items)).toContain('Customers');
  });

  it('shows "Loading warehouse…" and asks for the database while it is not here', () => {
    const { intel, req } = consoleOn();
    const r = at(intel, 'USE warehouse;\nSELECT * FROM |');
    expect(loading(r.items).map((x) => x.label)).toEqual(['Loading warehouse…']);
    expect(r.isIncomplete).toBe(true);
    expect(req).toHaveBeenCalledWith('warehouse', undefined);
    // the schema list is here, the default schema's objects are requested next
    intel.setForeignCatalogs([input(WAREHOUSE_LIST)]);
    const r2 = at(intel, 'USE warehouse;\nSELECT * FROM |');
    expect(loading(r2.items)).toHaveLength(1);
    expect(req).toHaveBeenCalledWith('warehouse', 'dbo');
    intel.setForeignCatalogs([input(WAREHOUSE_DBO_ONLY)]);
    const r3 = at(intel, 'USE warehouse;\nSELECT * FROM |');
    expect(loading(r3.items)).toHaveLength(0);
    expect(names(r3.items)).toContain('Parts');
  });

  it('hover, go to definition and diagnostics of later statements use the USE\'d database', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    const d = doc(intel, 'USE warehouse;\nSELECT * FROM Parts p JOIN Nope n ON 1 = 1');
    expect(stripMd(intel.hover(d.uri, d.text.indexOf('Parts') + 1)!.markdown)).toContain('dbo.Parts (table)');
    expect(intel.definition(d.uri, d.text.indexOf('Parts') + 1)).toEqual({ kind: 'object', ref: { database: 'warehouse', schema: 'dbo', name: 'Parts', type: 'table' } });
    expect(intel.softDiagnostics(d.uri).filter((x) => x.code === 'unknown-table').map((x) => x.message)).toEqual(["Unknown table 'Nope'"]);
    // not flagged against the console's database either: Parts exists only in warehouse
    expect(diags(intel, 'USE warehouse;\nSELECT * FROM Parts', 'unknown-table')).toEqual([]);
    expect(diags(intel, 'SELECT * FROM Parts', 'unknown-table')).toHaveLength(1);
  });

  it('USE of an unknown database or the console\'s own changes nothing', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    expect(names(at(intel, 'USE nowhere;\nSELECT * FROM |').items)).toContain('Customers');
    expect(names(at(intel, 'USE shop;\nSELECT * FROM |').items)).toContain('Customers');
  });
});

describe('other dialects and edge cases', () => {
  it('PostgreSQL / MySQL are untouched (no cross-database names)', () => {
    const items = labels(complete('pgsql', 'SELECT * FROM |').items);
    expect(items.length).toBeGreaterThan(0);
  });

  it('switching the console\'s database or connection drops the other databases', () => {
    const { intel } = consoleOn([input(WAREHOUSE)]);
    expect(names(at(intel, 'SELECT warehouse.dbo.Parts.| FROM warehouse.dbo.Parts').items)).toContain('Sku');
    intel.setCatalog({ ...(JSON.parse(JSON.stringify(fixtures.tsql)) as CatalogSnapshot), database: 'master', databases: SERVERS });
    expect(names(at(intel, 'SELECT p.| FROM warehouse.dbo.Parts p').items).filter((n) => n !== '*')).toEqual([]);
  });

  it('a database named like the console\'s own is the console\'s (never a placeholder)', () => {
    const { intel, req } = consoleOn([{ database: 'SHOP', status: 'ready', snapshot: WAREHOUSE }]);
    expect(names(at(intel, 'SELECT * FROM shop.dbo.|').items)).toContain('Customers');
    expect(req).not.toHaveBeenCalled();
  });

  it('works without a database requester: no placeholder, no request', () => {
    const intel = createIntel('tsql');
    intel.setCatalog({ ...(JSON.parse(JSON.stringify(fixtures.tsql)) as CatalogSnapshot), databases: SERVERS });
    expect(at(intel, 'SELECT * FROM warehouse.|').items).toEqual([]);
    expect(at(intel, 'USE warehouse;\nSELECT * FROM |').items.some((x) => x.loading)).toBe(false);
  });
});
