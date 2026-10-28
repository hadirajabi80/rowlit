// Pure helpers of the Data compare tab.
import { beforeEach, describe, expect, it } from 'vitest';
import type { DataCompareResult, DataDiffRow } from '../../../api/types.dataCompare';
import { dbKey, useCatalog } from '../../../store/catalog';
import { useConnections } from '../../../store/connections';
import {
  availableRows, changedOptionCount, changedOptions, DEFAULT_OPTIONS, initialRows, sideEndpoint, syncActions, validateSides, withDefaults,
} from '../model';
import { side } from '../open';

const conn = (id: string, providerId: string) => ({
  id, name: id, providerId, color: null, folder: null, readOnly: false, props: {}, hasPassword: false, savePassword: false, createdAt: '', lastUsedAt: null,
}) as never;

beforeEach(() => {
  useConnections.setState({ loaded: true, providers: [], connections: [conn('pg', 'postgresql'), conn('lite', 'sqlite')] });
  useCatalog.setState({
    conns: { pg: { databases: { databases: ['shop'], current: 'shop' }, status: 'ready', error: null } },
    dbs: { [dbKey('pg', 'shop')]: { schemasResp: { database: 'shop', defaultSchema: 'public', schemas: [] }, defaultSchema: 'public', loaded: {} } as never },
  } as never);
});

describe('options', () => {
  it('reads persisted options defensively and only carries the changed ones', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_OPTIONS);
    const o = withDefaults({ trimText: true, numericTolerance: -1, maxDifferences: 10_000_000, keyColumns: ['id', 3], ordering: 'bogus', ignoreColumns: ['note'] });
    expect(o.trimText).toBe(true);
    expect(o.numericTolerance).toBe(0);
    expect(o.maxDifferences).toBe(200_000);
    expect(o.keyColumns).toBeNull();
    expect(o.ordering).toBeNull();
    expect(changedOptions(o)).toEqual({ trimText: true, maxDifferences: 200_000, ignoreColumns: ['note'] });
    expect(changedOptionCount(o)).toBe(2);
  });
});

describe('sides', () => {
  it('needs a connection and a table (or a query) on both sides', () => {
    expect(validateSides(side(null), side(null))).toBe('Choose the source connection.');
    expect(validateSides(side({ connectionId: 'pg' }), side(null))).toBe('Choose the source table.');
    expect(validateSides(side({ connectionId: 'pg', table: 'a' }), side({ connectionId: 'lite', mode: 'query' }))).toBe('Write the target query.');
    expect(validateSides(side({ connectionId: 'pg', table: 'a' }), side({ connectionId: 'pg', table: 'A', schema: 'public' }))).toBe('Source and target are the same table.');
    expect(validateSides(side({ connectionId: 'pg', table: 'a' }), side({ connectionId: 'pg', table: 'a', where: 'id > 5' }))).toBeNull();
  });

  it('resolves the default database and schema and carries the filter or the query', () => {
    expect(sideEndpoint(side({ connectionId: 'pg', table: 'orders', where: ' id < 10 ' })))
      .toEqual({ connectionId: 'pg', database: 'shop', schema: 'public', table: 'orders', where: 'id < 10' });
    expect(sideEndpoint(side({ connectionId: 'lite', mode: 'query', query: ' select 1 ', where: 'ignored' })))
      .toEqual({ connectionId: 'lite', database: null, schema: null, query: 'select 1' });
    expect(sideEndpoint(side({ connectionId: 'pg' }))).toBeNull();
  });
});

describe('sync actions and grid pages', () => {
  const counts = { equal: 10, changed: 2, onlyInSource: 3, onlyInTarget: 1, duplicate: 0 };

  it('labels what a sync does in each direction', () => {
    expect(syncActions('toTarget', counts).map((a) => [a.cls, a.verb, a.label])).toEqual([
      ['onlyInSource', 'insert', 'Insert 3 rows missing from the target'],
      ['changed', 'update', 'Update 2 rows that differ in the target'],
      ['onlyInTarget', 'delete', 'Delete 1 row only in the target'],
    ]);
    expect(syncActions('toSource', counts).map((a) => [a.cls, a.verb])).toEqual([['onlyInTarget', 'insert'], ['changed', 'update'], ['onlyInSource', 'delete']]);
  });

  it('pages on from the sample when it is the start of the filter', () => {
    const row = (cls: DataDiffRow['class']): DataDiffRow => ({ class: cls, source: [1], target: null, changed: null });
    const r = { counts: { ...counts, changed: 150 }, keptDifferences: 154, sample: [...Array(100).fill(row('changed')), row('onlyInSource')] } as unknown as DataCompareResult;
    expect(initialRows(r, 'changed')).toEqual({ rows: Array(100).fill(row('changed')), prefix: true });
    expect(initialRows(r, 'all').prefix).toBe(false);
    expect(availableRows(r, 'changed')).toBe(150);
    expect(availableRows({ ...r, keptDifferences: 20 }, 'all')).toBe(20);
  });
});
