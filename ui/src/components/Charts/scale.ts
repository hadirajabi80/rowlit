// Axis scales: linear and log domains, "nice" tick values and compact number text.

export function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/** A rounded [min, max] containing the data and the tick step inside it (about `count` ticks). */
export function niceDomain(min: number, max: number, count = 5): { min: number; max: number; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 0.2 };
  if (min === max) {
    if (min === 0) return { min: 0, max: 1, step: 0.2 };
    const pad = Math.abs(min) * 0.1;
    min -= pad; max += pad;
  }
  const step = niceNum(niceNum(max - min, false) / Math.max(1, count - 1), true);
  return { min: Math.floor(min / step + 1e-9) * step, max: Math.ceil(max / step - 1e-9) * step, step };
}

export function linearTicks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const dec = Math.min(12, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  for (let i = 0; i < 200; i++) {
    const v = min + i * step;
    if (v > max + step * 1e-9) break;
    out.push(Number(v.toFixed(dec)));
  }
  return out;
}

/** Powers of ten (plus 2 and 5 times them when the range spans fewer than three decades) inside [min, max]. */
export function logTicks(min: number, max: number): number[] {
  const lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
  const mult = hi - lo < 3 ? [1, 2, 5] : [1];
  const out: number[] = [];
  for (let e = lo; e <= hi; e++) {
    for (const m of mult) {
      const v = m * 10 ** e;
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) out.push(v);
    }
  }
  return out;
}

/** Domain of a log axis: whole decades around the positive data. */
export function logDomain(min: number, max: number): { min: number; max: number } {
  if (!(min > 0) || !Number.isFinite(max)) return { min: 1, max: 10 };
  const lo = 10 ** Math.floor(Math.log10(min));
  let hi = 10 ** Math.ceil(Math.log10(max));
  if (hi <= lo) hi = lo * 10;
  return { min: lo, max: hi };
}

export interface Scale {
  /** Maps a data value to 0..1 (not clamped). */
  unit(v: number): number;
  log: boolean;
  min: number;
  max: number;
}

export function linearScale(min: number, max: number): Scale {
  const span = max - min || 1;
  return { unit: (v) => (v - min) / span, log: false, min, max };
}

export function logScale(min: number, max: number): Scale {
  const a = Math.log10(min);
  const span = Math.log10(max) - a || 1;
  return { unit: (v) => (Math.log10(Math.max(v, min * 1e-6)) - a) / span, log: true, min, max };
}

const SUFFIX = ['', 'K', 'M', 'B', 'T'];

/** Compact axis text: 1200 -> "1.2K", 0.0004 -> "0.0004", 25000000 -> "25M". */
export function formatTick(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1000) {
    const i = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(a) / 3));
    const s = v / 1000 ** i;
    return `${Number(s.toFixed(Math.abs(s) < 10 ? 2 : Math.abs(s) < 100 ? 1 : 0))}${SUFFIX[i]}`;
  }
  if (a >= 1) return String(Number(v.toFixed(2)));
  if (a >= 0.001) return String(Number(v.toPrecision(2)));
  return v.toExponential(0);
}

/** Full-precision text for tooltips and labels. */
export function formatValue(v: number | null): string {
  if (v === null) return '—';
  return Math.abs(v) >= 1e15 ? v.toExponential(3) : v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
