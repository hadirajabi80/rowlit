// Small formatting helpers of the Elasticsearch views (plan-batch3 WP-ES). Pure; no React.

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 10_000) return n.toLocaleString('en-US');
  const abs = Math.abs(n);
  // round first, then pick the unit: 999,950 is 1.0M (not "1000k") and 99,950 is 100k (not "100.0k")
  if (abs < 99_950) return `${(n / 1000).toFixed(1)}k`;
  if (abs < 999_500) return `${Math.round(n / 1000)}k`;
  if (abs < 999_950_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_950) {
    const s = ms / 1000;
    return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  }
  // whole seconds first: 119.6 s reads "2 min 0 s", never "1 min 60 s"
  const whole = Math.round(ms / 1000);
  const m = Math.floor(whole / 60);
  if (m < 60) return `${m} min ${whole % 60} s`;
  const mins = Math.floor((whole + 30) / 60);
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** Percent 0..100 of used/total, null when unknown. */
export function percent(used: number | null | undefined, total: number | null | undefined): number | null {
  if (used == null || total == null || total <= 0) return null;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

/** Index names (Elasticsearch rules: lowercase, no `\ / * ? " < > | , #` or spaces, not starting with `-_+`, ≤ 255 bytes). */
export function indexNameError(name: string): string | null {
  if (!name) return 'An index name is required.';
  if (name !== name.toLowerCase()) return 'Index names must be lowercase.';
  if (/[\\/*?"<>|,# ]/.test(name)) return 'Index names cannot contain spaces or \\ / * ? " < > | , #.';
  if (/^[-_+]/.test(name)) return 'Index names cannot start with -, _ or +.';
  if (name === '.' || name === '..') return 'Index names cannot be . or ..';
  if (new TextEncoder().encode(name).length > 255) return 'Index names are at most 255 bytes.';
  return null;
}
