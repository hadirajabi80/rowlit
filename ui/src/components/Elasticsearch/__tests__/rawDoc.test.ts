// Lossless document text (integers past 2^53) through the console endpoint.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api/client';
import type { EsConsoleResponse } from '../../../api/types.es';
import { hasUnsafeIntegerLiteral, hasUnsafeNumber } from '../../../es/json';
import { readRawSource, writeRaw } from '../rawDoc';

const reply = (status: number, body: string, statusText = ''): EsConsoleResponse => ({ status, statusText, elapsedMs: 1, contentType: 'application/json', body, truncated: false });

afterEach(() => vi.restoreAllMocks());

describe('unsafe numbers', () => {
  it('detects values that JSON.parse already rounded', () => {
    expect(hasUnsafeNumber(JSON.parse('{"a":{"id":1793050634678000000}}'))).toBe(true);
    expect(hasUnsafeNumber(JSON.parse('{"a":[1,2,{"b":9007199254740991}]}'))).toBe(false);
    expect(hasUnsafeNumber({ s: '12345678901234567890', n: null })).toBe(false);
  });

  it('detects integer literals past 2^53 in editor text, not in strings, decimals or exponents', () => {
    expect(hasUnsafeIntegerLiteral('{ "id": 1793050634678000000 }')).toBe(true);
    expect(hasUnsafeIntegerLiteral('{ "a": [ -9007199254740993, 1 ] }')).toBe(true);
    expect(hasUnsafeIntegerLiteral('{ "id": 9007199254740991 }')).toBe(false);
    expect(hasUnsafeIntegerLiteral('{ "s": "12345678901234567890" }')).toBe(false);
    expect(hasUnsafeIntegerLiteral('{ "f": 0.12345678901234567, "e": 1e20 }')).toBe(false);
    expect(hasUnsafeIntegerLiteral('{ "a": 1 } // 12345678901234567890')).toBe(false);
  });
});

describe('raw document access', () => {
  it('reads the exact _source text, with routing and an encoded id', async () => {
    const spy = vi.spyOn(api.es, 'console').mockResolvedValue(reply(200, '{\n  "id": 1793050634678000001\n}'));
    expect(await readRawSource('c', 'idx', 'a/b?c', 'r 1')).toContain('1793050634678000001');
    expect(spy).toHaveBeenCalledWith('c', { method: 'GET', path: '/idx/_source/a%2Fb%3Fc?routing=r%201', body: null });
    spy.mockResolvedValue(reply(404, '{"error":{"type":"resource_not_found_exception","reason":"gone"}}', 'Not Found'));
    await expect(readRawSource('c', 'idx', 'x')).rejects.toMatchObject({ status: 404, message: 'resource_not_found_exception: gone' });
  });

  it('writes the text itself with the optimistic-concurrency guard and without it', async () => {
    const spy = vi.spyOn(api.es, 'console').mockResolvedValue(reply(200, '{"_id":"d1","result":"updated","_version":3,"_seq_no":9}'));
    const text = '{ "id": 1793050634678000001, // nanos\n "n": [1,], }';
    const r = await writeRaw('c', { index: 'idx', id: 'd1', text, ifSeqNo: 8, ifPrimaryTerm: 1, routing: 'r' });
    expect(r).toEqual({ id: 'd1', result: 'updated', version: 3, seqNo: 9 });
    const [, call] = spy.mock.calls[0];
    expect(call.method).toBe('PUT');
    expect(call.path).toBe('/idx/_doc/d1?refresh=wait_for&if_seq_no=8&if_primary_term=1&routing=r');
    expect(call.body).toContain('1793050634678000001');
    expect(call.body).not.toContain('//');

    await writeRaw('c', { index: 'idx', id: 'd2', text: '{}', create: true });
    expect(spy.mock.calls[1][1].path).toBe('/idx/_doc/d2?refresh=wait_for&op_type=create');
    await writeRaw('c', { index: 'idx', id: null, text: '{}' });
    expect(spy.mock.calls[2][1]).toMatchObject({ method: 'POST', path: '/idx/_doc?refresh=wait_for' });
  });

  it('reports a version conflict as a 409 error the editor recognises', async () => {
    vi.spyOn(api.es, 'console').mockResolvedValue(reply(409, '{"error":{"type":"version_conflict_engine_exception","reason":"seq_no moved"}}', 'Conflict'));
    await expect(writeRaw('c', { index: 'idx', id: 'd1', text: '{}', ifSeqNo: 1, ifPrimaryTerm: 1 }))
      .rejects.toMatchObject({ status: 409, detail: { esType: 'version_conflict_engine_exception' } });
  });
});
