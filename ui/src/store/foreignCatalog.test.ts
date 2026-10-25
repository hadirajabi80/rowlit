// Other databases of a SQL Server connection for IntelliSense (`Staging.dbo.Orders` from a console on Shop): the store
// loads them on demand next to the console's own database, never switching it, and hands Intel what it has so far.
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { preloadCatalog } from '../app/actions';
import { createIntel } from '../intel';
import { installMockEngine } from '../test/mockServer';
import { dbKey, foreignCatalogInput, foreignCatalogInputs, requestForeignCatalog, useCatalog } from './catalog';
import { useConnections } from './connections';

const mock = installMockEngine({ frameDelay: 0 });
const CID = 'c_prod'; // SQL Server: Shop (current), master, Staging
const STAGING = dbKey(CID, 'Staging');

async function until(pred: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const inputs = () => foreignCatalogInputs(useCatalog.getState().dbs, CID, 'Shop', 'tsql');

describe('foreign catalogs: the store side of Other.dbo.T', () => {
  beforeEach(async () => {
    useCatalog.setState({ conns: {}, dbs: {} });
    await useConnections.getState().load();
    mock.ctx.requests.length = 0;
  });

  it('loads the schema list of another database, then one of its schemas, leaving the console\'s database alone', async () => {
    await preloadCatalog(CID, null);
    await until(() => !!useCatalog.getState().dbs[dbKey(CID, 'Shop')]?.snapshot?.schemaNames?.length);
    expect(inputs()).toEqual([]);

    requestForeignCatalog(CID, 'Staging', undefined, 0);
    await until(() => useCatalog.getState().dbs[STAGING]?.schemasStatus === 'ready');
    let list = inputs();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ database: 'Staging', status: 'ready' });
    expect(list[0].snapshot?.schemaNames).toEqual(['dbo']);
    expect(list[0].snapshot?.schemas).toEqual([]);
    expect(list[0].snapshot?.database).toBe('Staging');

    requestForeignCatalog(CID, 'Staging', 'DBO', 0); // any spelling
    await until(() => !!useCatalog.getState().dbs[STAGING]?.loaded.dbo);
    list = inputs();
    expect(list[0].snapshot?.schemas.map((s) => s.name)).toEqual(['dbo']);
    expect(list[0].failed).toBeUndefined();
    // the console's own database was never touched, and nothing else was loaded
    expect(Object.keys(useCatalog.getState().dbs).sort()).toEqual([dbKey(CID, 'Shop'), STAGING].sort());
  });

  it('coalesces repeated requests into one round trip, and skips what is loaded', async () => {
    requestForeignCatalog(CID, 'Staging', undefined, 20);
    requestForeignCatalog(CID, 'Staging', undefined, 20);
    requestForeignCatalog(CID, 'staging', undefined, 20);
    await until(() => useCatalog.getState().dbs[STAGING]?.schemasStatus === 'ready');
    expect(mock.hits('/catalog/schemas')).toHaveLength(1);
    requestForeignCatalog(CID, 'Staging', undefined, 0);
    await new Promise((r) => setTimeout(r, 30));
    expect(mock.hits('/catalog/schemas')).toHaveLength(1);
  });

  it('keeps the same input object while that database does not change (no re-render churn)', async () => {
    requestForeignCatalog(CID, 'Staging', undefined, 0);
    await until(() => useCatalog.getState().dbs[STAGING]?.schemasStatus === 'ready');
    const a = inputs()[0];
    await useCatalog.getState().loadSchemas(CID, 'master'); // an unrelated database changes the store
    expect(inputs().find((i) => i.database === 'Staging')).toBe(a);
    expect(foreignCatalogInput(useCatalog.getState().dbs[STAGING], 'tsql')).toBe(a);
  });

  it('a failing load is reported as an error, not as "loading" forever', async () => {
    mock.server.use(http.get('*/api/v1/connections/:id/catalog/schemas', () => HttpResponse.json({ error: { code: 'PROVIDER_ERROR', message: 'boom' } }, { status: 500 })));
    try {
      requestForeignCatalog(CID, 'Staging', undefined, 0);
      await until(() => useCatalog.getState().dbs[STAGING]?.schemasStatus === 'error');
    } finally {
      mock.server.resetHandlers();
    }
    expect(inputs()[0]).toMatchObject({ database: 'Staging', status: 'error', snapshot: null });
  });

  it('end to end: a console on Shop completes Staging.dbo. while the store loads it in the background', async () => {
    await preloadCatalog(CID, null);
    await until(() => !!useCatalog.getState().dbs[dbKey(CID, 'Shop')]?.snapshot?.schemaNames?.length);
    const intel = createIntel('tsql');
    intel.setCatalog(useCatalog.getState().dbs[dbKey(CID, 'Shop')].snapshot);
    const requested: string[] = [];
    intel.setDatabaseRequester((db, schema) => { requested.push(schema ? `${db}.${schema}` : db); requestForeignCatalog(CID, db, schema, 0); });
    const unsub = useCatalog.subscribe((s) => intel.setForeignCatalogs(foreignCatalogInputs(s.dbs, CID, 'Shop', 'tsql')));
    try {
      const sql = 'SELECT * FROM Staging.dbo.';
      intel.setDocument('u', sql);
      expect(intel.complete('u', sql.length).items.map((x) => x.label)).toEqual(['Loading Staging…']);
      await until(() => intel.complete('u', sql.length).items.some((x) => x.label === 'Loading Staging.dbo…'));
      await until(() => intel.complete('u', sql.length).items.some((x) => x.kind === 'table'));
      const labels = intel.complete('u', sql.length).items.map((x) => x.label);
      expect(labels).toContain('customers');
      expect(requested).toEqual(['Staging', 'Staging.dbo']);
      // columns of an alias of the other database's table, and its definition opens in that database
      const q = 'SELECT c.  FROM Staging.dbo.customers c';
      intel.setDocument('v', q);
      expect(intel.complete('v', q.indexOf('c.') + 2).items.map((x) => x.label)).toContain('name');
      expect(intel.definition('v', q.indexOf('customers') + 1)).toMatchObject({ kind: 'object', ref: { database: 'Staging', schema: 'dbo', name: 'customers' } });
    } finally {
      unsub();
    }
  });
});
