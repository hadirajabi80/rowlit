// Recent transfers (localStorage; a convenience only: every access is guarded, the wizard works without it). One entry
// remembers where from and where to, the tables and the options, so a repeated copy is two clicks.
import type { TransferOptions } from '../../api/types.transfer';
import { DEFAULT_OPTIONS } from './model';

const KEY = 'rowlit.transfer.recent';
export const MAX_RECENT = 8;

export interface RecentTransfer {
  sourceCid: string;
  sourceDb: string | null;
  sourceSchema: string | null;
  tables: { name: string; type: 'table' | 'view' }[];
  targetKind: 'connection' | 'file';
  targetCid: string;
  targetDb: string | null;
  targetSchema: string;
  dumpProvider: string;
  filePath: string;
  options: TransferOptions;
  /** Epoch milliseconds of the last run. */
  at: number;
}

function valid(x: unknown): x is RecentTransfer {
  if (!x || typeof x !== 'object') return false;
  const r = x as RecentTransfer;
  return typeof r.sourceCid === 'string' && Array.isArray(r.tables) && (r.targetKind === 'connection' || r.targetKind === 'file') && typeof r.at === 'number';
}

export function readRecent(): RecentTransfer[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(v)) return [];
    return v.filter(valid).slice(0, MAX_RECENT).map((r) => ({ ...r, options: { ...DEFAULT_OPTIONS, ...(r.options ?? {}) } }));
  } catch {
    return [];
  }
}

/** Identity of an entry: same source, tables and target replace the older one. */
function sameRoute(a: RecentTransfer, b: RecentTransfer): boolean {
  const names = (r: RecentTransfer) => r.tables.map((t) => t.name).sort().join('\u0001');
  return a.sourceCid === b.sourceCid && a.sourceDb === b.sourceDb && a.sourceSchema === b.sourceSchema && names(a) === names(b)
    && a.targetKind === b.targetKind
    && (a.targetKind === 'file'
      ? a.filePath.toLowerCase() === b.filePath.toLowerCase() && a.dumpProvider === b.dumpProvider
      : a.targetCid === b.targetCid && a.targetDb === b.targetDb && a.targetSchema === b.targetSchema);
}

export function rememberRecent(entry: Omit<RecentTransfer, 'at'>, now = Date.now()): void {
  try {
    const e: RecentTransfer = { ...entry, at: now };
    const rest = readRecent().filter((r) => !sameRoute(r, e));
    window.localStorage.setItem(KEY, JSON.stringify([e, ...rest].slice(0, MAX_RECENT)));
  } catch {
    /* private mode / blocked storage */
  }
}

export function forgetRecent(at: number): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(readRecent().filter((r) => r.at !== at)));
  } catch {
    /* ignore */
  }
}
