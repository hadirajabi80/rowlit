import { describe, expect, it } from 'vitest';
import { formatTick, linearScale, linearTicks, logDomain, logScale, logTicks, niceDomain } from './scale';

describe('scales', () => {
  it('rounds the domain to nice ticks', () => {
    const d = niceDomain(0, 97, 5);
    expect(d).toMatchObject({ min: 0, max: 100, step: 20 });
    expect(linearTicks(d.min, d.max, d.step)).toEqual([0, 20, 40, 60, 80, 100]);
    const f = niceDomain(0.1, 0.9, 5);
    expect(linearTicks(f.min, f.max, f.step)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('widens a flat domain', () => {
    const d = niceDomain(5, 5);
    expect(d.min).toBeLessThan(5);
    expect(d.max).toBeGreaterThan(5);
    expect(niceDomain(0, 0)).toMatchObject({ min: 0, max: 1 });
  });

  it('maps values to 0..1 linearly and logarithmically', () => {
    expect(linearScale(0, 200).unit(50)).toBe(0.25);
    const l = logScale(1, 1000);
    expect(l.unit(1)).toBeCloseTo(0);
    expect(l.unit(10)).toBeCloseTo(1 / 3);
    expect(l.unit(1000)).toBeCloseTo(1);
  });

  it('log domains are whole decades with power-of-ten ticks', () => {
    expect(logDomain(3, 4200)).toEqual({ min: 1, max: 10000 });
    expect(logTicks(1, 10000)).toEqual([1, 10, 100, 1000, 10000]);
    expect(logTicks(1, 100)).toEqual([1, 2, 5, 10, 20, 50, 100]);
    expect(logDomain(-1, 5)).toEqual({ min: 1, max: 10 });
  });

  it('formats ticks compactly', () => {
    expect(formatTick(0)).toBe('0');
    expect(formatTick(1200)).toBe('1.2K');
    expect(formatTick(25_000_000)).toBe('25M');
    expect(formatTick(-3500)).toBe('-3.5K');
    expect(formatTick(0.25)).toBe('0.25');
    expect(formatTick(42)).toBe('42');
    expect(formatTick(0.00004)).toBe('4e-5');
  });
});
