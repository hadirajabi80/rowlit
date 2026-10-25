// Recently imported files (localStorage; a convenience only: every access is guarded, the wizard works without it).
const KEY = 'rowlit.import.recentFiles';
export const MAX_RECENT = 6;

export interface RecentFile {
  path: string;
  /** Epoch milliseconds of the last use. */
  at: number;
}

export function readRecent(): RecentFile[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is RecentFile => !!x && typeof x === 'object' && typeof (x as RecentFile).path === 'string' && typeof (x as RecentFile).at === 'number')
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Puts a path first (case-insensitive: Windows paths) and keeps the newest MAX_RECENT. */
export function rememberRecent(path: string): void {
  const p = path.trim();
  if (!p) return;
  try {
    const rest = readRecent().filter((r) => r.path.toLowerCase() !== p.toLowerCase());
    window.localStorage.setItem(KEY, JSON.stringify([{ path: p, at: Date.now() }, ...rest].slice(0, MAX_RECENT)));
  } catch {
    /* private mode / blocked storage */
  }
}

export function forgetRecent(path: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(readRecent().filter((r) => r.path.toLowerCase() !== path.toLowerCase())));
  } catch {
    /* ignore */
  }
}
