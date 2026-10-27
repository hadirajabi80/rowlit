// A catalog load that gets no answer: after SLOW_LOAD_MS the entry is flagged `slow` ("Still connecting…" + Cancel in the
// explorer), Cancel aborts the request (the entry turns into an error "Cancelled." that Retry loads again), a failure
// reports the engine's "Server not reachable: …" message.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import type { CatalogSnapshot, ConnectionProfile, DatabasesResponse, SchemasResponse } from '../api/types';
import { buildTree } from '../components/Explorer/tree';
import { dbKey, SLOW_LOAD_MS, useCatalog } from './catalog';

const KEY = dbKey('c1', 'Shop');

/** A request that never answers; it rejects with ABORTED when its signal fires, like the real client. */
function hang<T>(signal?: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new ApiError('ABORTED', 'Request aborted', 0)));
  });
}

const dbs: DatabasesResponse = { databases: ['Shop'], current: 'Shop' };
const schemas: SchemasResponse = { database: 'Shop', defaultSchema: 'dbo', schemas: [{ name: 'dbo', loaded: false }] };
const snapshot = (): CatalogSnapshot => ({
  connectionId: 'c1', dialect: 'tsql', database: 'Shop', defaultSchema: 'dbo', version: 1, databases: ['Shop'],
  schemas: [{ name: 'dbo', version: 1, objects: [] }],
});

beforeEach(() => {
  vi.useFakeTimers();
  useCatalog.setState({ conns: {}, dbs: {}, closed: {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('slow connection (database list)', () => {
  it('is flagged slow only after SLOW_LOAD_MS, and Cancel aborts the request', async () => {
    const spy = vi.spyOn(api, 'databases').mockImplementation((_cid, signal) => hang(signal));
    const load = useCatalog.getState().loadDatabases('c1');
    expect(useCatalog.getState().conns.c1.status).toBe('loading');

    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS - 1);
    expect(useCatalog.getState().conns.c1.slow).toBeFalsy();
    await vi.advanceTimersByTimeAsync(1);
    expect(useCatalog.getState().conns.c1.slow).toBe(true);

    const signal = spy.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    useCatalog.getState().cancelLoad({ level: 'conn', connectionId: 'c1', database: null });
    expect(signal.aborted).toBe(true);
    await load;
    const c = useCatalog.getState().conns.c1;
    expect(c).toMatchObject({ status: 'error', error: 'Cancelled.', slow: false });
  });

  it('Retry loads again and ends in ready', async () => {
    vi.spyOn(api, 'databases').mockImplementationOnce((_cid, signal) => hang(signal));
    const first = useCatalog.getState().loadDatabases('c1');
    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS);
    useCatalog.getState().cancelLoad({ level: 'conn', connectionId: 'c1', database: null });
    await first;

    vi.spyOn(api, 'databases').mockResolvedValue(dbs);
    await useCatalog.getState().retryLoad({ level: 'conn', connectionId: 'c1', database: null });
    expect(useCatalog.getState().conns.c1).toMatchObject({ status: 'ready', databases: dbs, slow: false });
  });

  it('a quick answer never flags slow, and shows no stray timer', async () => {
    vi.spyOn(api, 'databases').mockResolvedValue(dbs);
    await useCatalog.getState().loadDatabases('c1');
    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS * 2);
    expect(useCatalog.getState().conns.c1.slow).toBeFalsy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an engine failure keeps its message ("Server not reachable: …")', async () => {
    vi.spyOn(api, 'databases').mockRejectedValue(new ApiError('SERVER_UNREACHABLE', 'Server not reachable: connection refused', 503));
    await useCatalog.getState().loadDatabases('c1');
    expect(useCatalog.getState().conns.c1).toMatchObject({ status: 'error', error: 'Server not reachable: connection refused' });
  });

  it('a list that is already shown is not flagged slow while it reloads', async () => {
    vi.spyOn(api, 'databases').mockResolvedValueOnce(dbs);
    await useCatalog.getState().loadDatabases('c1');
    vi.spyOn(api, 'databases').mockImplementation((_cid, signal) => hang(signal));
    void useCatalog.getState().loadDatabases('c1', true);
    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS + 1);
    expect(useCatalog.getState().conns.c1.slow).toBeFalsy();
    useCatalog.getState().cancelLoad({ level: 'conn', connectionId: 'c1', database: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(useCatalog.getState().conns.c1).toMatchObject({ status: 'ready', revalidating: false });
  });
});

describe('slow schema list and schema load', () => {
  it('schemas: slow, Cancel, then Retry', async () => {
    vi.spyOn(api, 'schemas').mockImplementationOnce((_cid, _db, signal) => hang(signal));
    const load = useCatalog.getState().loadSchemas('c1', 'Shop');
    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS);
    expect(useCatalog.getState().dbs[KEY].schemasSlow).toBe(true);
    useCatalog.getState().cancelLoad({ level: 'schemas', connectionId: 'c1', database: 'Shop' });
    await load;
    expect(useCatalog.getState().dbs[KEY]).toMatchObject({ schemasStatus: 'error', schemasError: 'Cancelled.', schemasSlow: false });

    vi.spyOn(api, 'schemas').mockResolvedValue(schemas);
    await useCatalog.getState().retryLoad({ level: 'schemas', connectionId: 'c1', database: 'Shop' });
    expect(useCatalog.getState().dbs[KEY]).toMatchObject({ schemasStatus: 'ready', schemasSlow: false });
  });

  it('schema: slow, Cancel, then Retry', async () => {
    vi.spyOn(api, 'catalog').mockImplementationOnce((_c, _d, _s, _e, signal) => hang(signal));
    const load = useCatalog.getState().loadSchema('c1', 'Shop', 'dbo');
    await vi.advanceTimersByTimeAsync(SLOW_LOAD_MS);
    expect(useCatalog.getState().dbs[KEY].schemaSlow?.dbo).toBe(true);
    useCatalog.getState().cancelLoad({ level: 'schema', connectionId: 'c1', database: 'Shop', schema: 'dbo' });
    await load;
    expect(useCatalog.getState().dbs[KEY]).toMatchObject({ schemaStatus: { dbo: 'error' }, schemaError: { dbo: 'Cancelled.' }, schemaSlow: { dbo: false } });

    vi.spyOn(api, 'catalog').mockResolvedValue({ notModified: false, etag: '"e"', snapshot: snapshot() });
    await useCatalog.getState().retryLoad({ level: 'schema', connectionId: 'c1', database: 'Shop', schema: 'dbo' });
    expect(useCatalog.getState().dbs[KEY].schemaStatus.dbo).toBe('ready');
  });
});

describe('explorer rows of a slow / failed load', () => {
  const profile: ConnectionProfile = {
    id: 'c1', name: 'Prod', providerId: 'postgresql', color: null, folder: null, readOnly: false, props: {}, hasPassword: false,
    savePassword: false, createdAt: '', lastUsedAt: null,
  };
  const input = (conn: Partial<ReturnType<typeof useCatalog.getState>['conns'][string]>) => ({
    connections: [profile], conns: { c1: { databases: null, status: 'loading' as const, error: null, ...conn } }, dbs: {},
    expanded: new Set(['c:c1']), collapsedFolders: new Set<string>(), filter: '',
  });

  it('"Connecting…" until slow, then "Still connecting…" with a cancel target', () => {
    const fresh = buildTree(input({})).find((r) => r.kind === 'status')!;
    expect(fresh).toMatchObject({ label: 'Connecting…', status: 'loading', slow: false });
    const slow = buildTree(input({ slow: true })).find((r) => r.kind === 'status')!;
    expect(slow).toMatchObject({ label: 'Still connecting…', status: 'loading', slow: true, loadTarget: { level: 'conn', connectionId: 'c1' } });
  });

  it('an error row carries the retry target and the engine message', () => {
    const row = buildTree(input({ status: 'error', error: 'Server not reachable: timeout' })).find((r) => r.kind === 'status')!;
    expect(row).toMatchObject({ status: 'error', label: 'Server not reachable: timeout', loadTarget: { level: 'conn', connectionId: 'c1' } });
  });
});
