import type { MonitorMetric, MonitorSnapshot } from '../../api/types.monitor';

export interface DisplayMetric extends MonitorMetric { displayValue: number | null; rate: boolean }

export function metricRates(previous: MonitorSnapshot | null, current: MonitorSnapshot): DisplayMetric[] {
  const seconds = previous ? (Date.parse(current.at) - Date.parse(previous.at)) / 1000 : 0;
  const old = new Map(previous?.metrics.map((m) => [m.id, m]) ?? []);
  return current.metrics.map((m) => {
    if (m.kind !== 'counter' || m.value == null || seconds <= 0) return { ...m, displayValue: m.kind === 'counter' ? null : m.value, rate: m.kind === 'counter' };
    const before = old.get(m.id)?.value;
    return { ...m, displayValue: before == null || m.value < before ? null : (m.value - before) / seconds, rate: true };
  });
}

export const shouldPoll = (visible: boolean, paused: boolean) => visible && !paused;

export function formatMetric(value: number | null, unit: MonitorMetric['unit'], rate = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  let result: string;
  if (unit === 'bytes') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let n = value; let i = 0;
    while (Math.abs(n) >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    result = `${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 1 : 0 })} ${units[i]}`;
  } else if (unit === 'percent') result = `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  else if (unit === 'seconds') result = value >= 3600 ? `${(value / 3600).toLocaleString(undefined, { maximumFractionDigits: 1 })} h` : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
  else if (unit === 'ms') result = `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ms`;
  else result = value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 2 : 0 });
  return rate ? `${result}/s` : result;
}
