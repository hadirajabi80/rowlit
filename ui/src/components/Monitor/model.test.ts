import { describe, expect, it } from 'vitest';
import type { MonitorSnapshot } from '../../api/types.monitor';
import { metricRates, shouldPoll } from './model';

const snap = (at: string, value: number): MonitorSnapshot => ({ at, providerId: 'postgresql', metrics: [{ id: 'q', label: 'Queries', value, unit: 'count', kind: 'counter', group: 'throughput' }], databases: [], topQueries: [], notes: [] });
describe('monitor rates and polling', () => {
  it('turns cumulative counters into per-second rates and rejects reset deltas', () => {
    expect(metricRates(snap('2026-01-01T00:00:00Z', 100), snap('2026-01-01T00:00:05Z', 125))[0].displayValue).toBe(5);
    expect(metricRates(snap('2026-01-01T00:00:00Z', 100), snap('2026-01-01T00:00:05Z', 2))[0].displayValue).toBeNull();
  });
  it('stops polling while paused or hidden', () => {
    expect(shouldPoll(true, false)).toBe(true); expect(shouldPoll(false, false)).toBe(false); expect(shouldPoll(true, true)).toBe(false);
  });
});
