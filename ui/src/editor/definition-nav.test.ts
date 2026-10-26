// resolveDefinition: go-to-definition that waits for a lazily loaded schema ("Loading Sales…"), then finishes the
// navigation; a name that is not there afterwards, or a load that never arrives, ends with a "not found".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '../api/types';
import { createIntel } from '../intel';
import { fixtures } from '../intel/__tests__/helpers';
const fixture = fixtures.tsql;
import { DEFINITION_WAIT_MS, notifyCatalogChanged, resolveDefinition, type DefinitionHost } from './definition-nav';
import { opensData, objectSummary } from './object-uri';

function host(sales: boolean) {
  const full = JSON.parse(JSON.stringify(fixture)) as CatalogSnapshot;
  full.schemas.find((s) => s.name === 'Sales')!.objects.push({ t: 'table', n: 'Customers', c: [['Id', 'int', 0, 1, 1, null]], pk: ['Id'] } as never);
  full.schemaNames = ['dbo', 'Sales'];
  const intel = createIntel('tsql');
  const requested: string[] = [];
  intel.setSchemaRequester((s) => requested.push(s));
  intel.setCatalog({ ...full, schemas: full.schemas.filter((s) => s.name !== 'Sales') });
  const text = 'SELECT * FROM Sales.Customers';
  intel.setDocument('doc://1', text);
  const b: DefinitionHost = { uri: 'doc://1', intel, catalogWaiters: new Set() };
  /** The editor hands the intel the loaded schema and wakes the waiters (SqlEditor's catalog effect). */
  const arrive = (withSales = sales) => {
    intel.setCatalog(withSales ? full : { ...full, schemas: full.schemas.filter((s) => s.name !== 'Sales') });
    notifyCatalogChanged(b);
  };
  return { b, requested, arrive, offset: text.indexOf('Customers') + 2 };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('resolveDefinition', () => {
  it('already loaded: resolves at once, without waiting', async () => {
    const h = host(true);
    h.arrive();
    const onPending = vi.fn();
    const out = await resolveDefinition(h.b, h.offset, { onPending });
    expect(out).toMatchObject({ kind: 'found', def: { kind: 'object', ref: { schema: 'Sales', name: 'Customers', type: 'table' } } });
    expect(onPending).not.toHaveBeenCalled();
  });

  it('unloaded schema: requests it, reports "loading", and completes when it arrives', async () => {
    const h = host(true);
    const onPending = vi.fn();
    const p = resolveDefinition(h.b, h.offset, { onPending });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.requested).toContain('Sales');
    expect(onPending).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenCalledWith({ loading: 'Sales', target: 'Sales.Customers' });
    h.arrive();
    expect(await p).toMatchObject({ kind: 'found', def: { kind: 'object', ref: { schema: 'Sales', name: 'Customers' } } });
  });

  it('the schema loads but has no such object: none, after waiting', async () => {
    const h = host(false);
    const p = resolveDefinition(h.b, h.offset);
    await vi.advanceTimersByTimeAsync(100);
    h.arrive(false); // an unrelated catalog change: still pending, keeps waiting
    await vi.advanceTimersByTimeAsync(100);
    const full = JSON.parse(JSON.stringify(fixture)) as CatalogSnapshot; // Sales arrives without Customers
    full.schemaNames = ['dbo', 'Sales'];
    h.b.intel.setCatalog(full);
    notifyCatalogChanged(h.b);
    const out = await p;
    expect(out).toMatchObject({ kind: 'none', timedOut: false, waited: { target: 'Sales.Customers' } });
  });

  it('a schema that never loads: gives up after the wait', async () => {
    const h = host(true);
    const p = resolveDefinition(h.b, h.offset, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(await p).toMatchObject({ kind: 'none', timedOut: true, waited: { loading: 'Sales' } });
    expect(DEFINITION_WAIT_MS).toBeGreaterThan(2000);
  });

  it('an unknown schema is not waited for', async () => {
    const h = host(true);
    h.b.intel.setDocument('doc://2', 'SELECT * FROM Nope.Customers');
    const out = await resolveDefinition({ ...h.b, uri: 'doc://2' }, 'SELECT * FROM Nope.Customers'.indexOf('Customers') + 2);
    expect(out).toEqual({ kind: 'none', waited: null, timedOut: false });
  });

  it('cancelled while waiting', async () => {
    const h = host(true);
    let cancelled = false;
    const p = resolveDefinition(h.b, h.offset, { isCancelled: () => cancelled });
    await vi.advanceTimersByTimeAsync(100);
    cancelled = true;
    h.arrive();
    expect(await p).toEqual({ kind: 'cancelled' });
  });
});

describe('data first, DDL on request', () => {
  it('tables, views, materialized views and synonyms open data; routines, packages, triggers and types do not', () => {
    for (const t of ['table', 'view', 'mview', 'synonym'] as const) expect(opensData(t)).toBe(true);
    for (const t of ['proc', 'func', 'tablefunc', 'package', 'trigger', 'type', 'sequence'] as const) expect(opensData(t)).toBe(false);
    expect(opensData('type', 'clickhouse')).toBe(true); // a ClickHouse dictionary
  });

  it('the hover/preview text says what F12 opens and names the DDL shortcut', () => {
    const table = objectSummary({ database: 'shop', schema: 'Sales', name: 'Customers', type: 'table' });
    expect(table).toContain('opens the data');
    expect(table).toContain('Alt+F12');
    expect(table).toContain('opens the DDL');
    const proc = objectSummary({ database: 'shop', schema: 'Sales', name: 'CloseInvoice', type: 'proc' });
    expect(proc).toContain('opens the definition');
    expect(proc).not.toContain('opens the data');
  });
});
