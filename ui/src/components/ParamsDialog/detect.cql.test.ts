// CQL bind detection (docs/qa/round-cassandra.md E): a map / UDT literal written without a space after the colon
// (`{'k':true}`) is a key-value pair, not the bind marker `:true`.
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureDialect } from '../../intel/dialect/registry';
import { detectParams } from './detect';

beforeAll(async () => {
  await ensureDialect('cql');
});

const names = (sql: string) => detectParams([{ sql, line: 1, col: 1 }], 'cql').map((p) => p.display);

describe('detectParams (cql)', () => {
  it('map and UDT entries are not binds', () => {
    expect(names("UPDATE t SET m = m + {'k':true, 1:false}, u = {name:x} WHERE id = :id")).toEqual([':id']);
  });

  it('markers inside literals still are', () => {
    expect(names("UPDATE t SET m = {'j': :v, :key: :val}, l = [:a], tu = (:b, ?) WHERE id = :id LIMIT :n"))
      .toEqual([':v', ':key', ':val', ':a', ':b', '?', ':id', ':n']);
  });
});
