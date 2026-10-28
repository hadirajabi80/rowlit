import { describe, expect, it } from 'vitest';
import { clientColumnStats } from './ColumnStatsPopover';
import type { ColumnInfo } from '../../api/types';

const column = { name: 'amount', dbType: 'decimal', kind: 'decimal', nullable: true } as ColumnInfo;

describe('client column statistics', () => {
  it('counts nulls and distinct values and computes numeric aggregates', () => {
    const s = clientColumnStats(column, [1, 2, 2, null, 5]);
    expect(s).toMatchObject({ rows: 5, nulls: 1, distinct: 3, min: '1', max: '5', avg: 2.5, sum: '10' });
    expect(s.top[0]).toEqual({ value: '2', count: 2 });
  });
});
