import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureClient, isApiError } from '../../api/client';
import { importApi } from './api';

const fetchMock = vi.fn();

beforeEach(() => {
  configureClient({ baseUrl: 'http://engine/', token: 'tok' });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status });
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined, headers: init.headers as Record<string, string> };
};

describe('import REST wrappers', () => {
  it('posts the preview request with the bearer token', async () => {
    fetchMock.mockResolvedValue(reply({ columns: [] }));
    await importApi.preview({ path: 'C:\\a.csv', options: { format: 'csv' }, maxRows: 50 });
    const c = call();
    expect(c.url).toBe('http://engine/api/v1/import/preview');
    expect(c.method).toBe('POST');
    expect(c.body).toEqual({ path: 'C:\\a.csv', options: { format: 'csv' }, maxRows: 50 });
    expect(c.headers.Authorization).toBe('Bearer tok');
    expect(c.headers['Content-Type']).toBe('application/json');
  });

  it('builds the connection routes', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(reply({})));
    await importApi.capabilities('c 1', 'my db');
    await importApi.capabilities('c1');
    await importApi.tableInfo('c1', { schema: 'dbo', table: 't' });
    await importApi.ddl('c1', { table: 't', columns: [] });
    await importApi.start('c1', { path: 'p' } as never);
    expect(call(0).url).toBe('http://engine/api/v1/connections/c%201/import/capabilities?database=my%20db');
    expect(call(0).method).toBe('GET');
    expect(call(1).url).toBe('http://engine/api/v1/connections/c1/import/capabilities');
    expect(call(2).url).toBe('http://engine/api/v1/connections/c1/import/table-info');
    expect(call(3).url).toBe('http://engine/api/v1/connections/c1/import/ddl');
    expect(call(4).url).toBe('http://engine/api/v1/connections/c1/import/start');
  });

  it('downloads the error report as bytes and cancels through DELETE /jobs', async () => {
    fetchMock.mockResolvedValueOnce(new Response('\uFEFFrow,error', { status: 200 }));
    const blob = await importApi.errorReport('j/1');
    expect(call(0).url).toBe('http://engine/api/v1/import/errors/j%2F1');
    expect(blob).toBeInstanceOf(Blob);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await importApi.cancel('j1');
    expect(call(1)).toMatchObject({ url: 'http://engine/api/v1/jobs/j1', method: 'DELETE' });
  });

  it('maps engine errors to ApiError', async () => {
    fetchMock.mockResolvedValue(reply({ error: { code: 'READ_ONLY', message: 'The connection is read-only' } }, 403));
    const err = await importApi.start('c1', {} as never).catch((e: unknown) => e);
    expect(isApiError(err, 'READ_ONLY')).toBe(true);
    expect((err as Error).message).toBe('The connection is read-only');
    fetchMock.mockResolvedValue(new Response('nope', { status: 500, statusText: 'Boom' }));
    const http = await importApi.preview({ path: 'x' }).catch((e: unknown) => e);
    expect(isApiError(http, 'HTTP')).toBe(true);
    fetchMock.mockRejectedValue(new TypeError('failed'));
    expect(isApiError(await importApi.preview({ path: 'x' }).catch((e: unknown) => e), 'NETWORK')).toBe(true);
  });
});
