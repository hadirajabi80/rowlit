import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureClient } from '../../../api/client';
import { schemaCompareApi } from '../api';

const fetchMock = vi.fn();

beforeEach(() => {
  configureClient({ baseUrl: 'http://engine/', token: 'tok' });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
};

describe('schema compare REST wrappers', () => {
  it('builds the routes and bodies', async () => {
    await schemaCompareApi.start({ source: { connectionId: 'a', schema: 's' }, target: { connectionId: 'b', schema: 't' } });
    await schemaCompareApi.support('c 1');
    await schemaCompareApi.item('cmp_1', 'func:fn(a numeric)');
    await schemaCompareApi.script('cmp_1', ['table:x']);
    await schemaCompareApi.apply('cmp_1', { itemIds: ['table:x'], stopOnError: false });
    await schemaCompareApi.discard('cmp_1');
    expect(call(0)).toMatchObject({ url: 'http://engine/api/v1/schema-compare', method: 'POST', body: { source: { connectionId: 'a', schema: 's' } } });
    expect(call(1)).toMatchObject({ url: 'http://engine/api/v1/schema-compare/support?connectionId=c+1', method: 'GET' });
    expect(call(2).url).toBe('http://engine/api/v1/schema-compare/cmp_1/item?item=func%3Afn%28a+numeric%29');
    expect(call(3)).toMatchObject({ url: 'http://engine/api/v1/schema-compare/cmp_1/script', method: 'POST', body: { itemIds: ['table:x'] } });
    expect(call(4)).toMatchObject({ url: 'http://engine/api/v1/schema-compare/cmp_1/apply', body: { itemIds: ['table:x'], stopOnError: false } });
    expect(call(5)).toMatchObject({ url: 'http://engine/api/v1/schema-compare/cmp_1', method: 'DELETE' });
  });
});
