import { describe, expect, it } from 'vitest';
import { lttb } from './lttb';

describe('lttb', () => {
  const line = (n: number) => ({ xs: Array.from({ length: n }, (_, i) => i), ys: Array.from({ length: n }, (_, i) => Math.sin(i / 50)) });

  it('returns every index when the data is small enough', () => {
    const { xs, ys } = line(10);
    expect(lttb(xs, ys, 10)).toEqual([...xs]);
    expect(lttb(xs, ys, 100)).toEqual([...xs]);
  });

  it('keeps exactly `threshold` points, ascending, first and last included', () => {
    const { xs, ys } = line(5000);
    const idx = lttb(xs, ys, 200);
    expect(idx).toHaveLength(200);
    expect(idx[0]).toBe(0);
    expect(idx[199]).toBe(4999);
    expect(idx.every((v, i) => i === 0 || v > idx[i - 1])).toBe(true);
  });

  it('keeps a lone spike that averaging would flatten', () => {
    const { xs, ys } = line(3000);
    ys[1234] = 50;
    expect(lttb(xs, ys, 100)).toContain(1234);
  });

  it('degrades to the end points for tiny thresholds', () => {
    const { xs, ys } = line(100);
    expect(lttb(xs, ys, 2)).toEqual([0, 99]);
  });

  it('downsamples 50k points fast', () => {
    const { xs, ys } = line(50_000);
    const t0 = performance.now();
    expect(lttb(xs, ys, 800)).toHaveLength(800);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
