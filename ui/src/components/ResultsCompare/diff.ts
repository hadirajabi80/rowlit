// Row diff of two result sets (pure, no DOM, runs in diff.worker.ts for big sets). Columns are matched by name
// (case-insensitive); rows by the chosen key columns, or, without keys, by the whole row (a multiset difference:
// no "changed" rows then, only added / removed). Rows with the same key occurring several times pair up in order.
import type { CellValue, ColumnInfo, ColumnKind } from '../../api/types';

export interface RowSource {
  readonly length: number;
  get(i: number): CellValue[] | undefined;
}

export interface DiffSide {
  columns: readonly Pick<ColumnInfo, 'name' | 'kind' | 'isKey'>[];
  rows: RowSource;
}

export interface DiffOptions {
  /** Key column names (matched case-insensitively). Empty: compare whole rows. */
  keys: readonly string[];
  /** Text compares case-insensitively. */
  ignoreCase?: boolean;
  /** Text compares after trimming. */
  trimText?: boolean;
}

export type RowStatus = 'same' | 'added' | 'removed' | 'changed';

/** One column of the merged result: where it lives on each side (null: the side lacks it). */
export interface MergedColumn {
  name: string;
  left: number | null;
  right: number | null;
  kind: ColumnKind;
  /** Part of the matching key. */
  key: boolean;
}

export interface DiffRow {
  status: RowStatus;
  /** Row index in the left / right set (null: the row exists on the other side only). */
  left: number | null;
  right: number | null;
  /** Merged-column indexes whose values differ (status "changed" only). */
  changed: number[];
}

export interface DiffCounts {
  same: number;
  added: number;
  removed: number;
  changed: number;
}

export interface DiffResult {
  columns: MergedColumn[];
  rows: DiffRow[];
  counts: DiffCounts;
  /** Names of the key columns actually used (after dropping the ones a side lacks). */
  keyColumns: string[];
  /** Key columns asked for that one of the sets does not have. */
  droppedKeys: string[];
  /** Rows beyond the first for a key that occurs several times (they pair up in order; the match may be wrong). */
  duplicateKeys: number;
  /** Columns present on both sides whose kinds differ (compared as text). */
  kindMismatches: string[];
}

const NUMERIC = new Set<ColumnKind>(['int', 'float', 'decimal']);
export const isNumericKind = (k: ColumnKind): boolean => NUMERIC.has(k);

const NULL_KEY = '\u0000';
const SEP = '\u001f';

/** "1.50" / "+1.5" / 1.5 / "1.5e0" all spell 1.5. Non-numeric text comes back unchanged. */
export function canonNumber(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? canonNumber(String(v)) : String(v);
  const t = v.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return t;
  let int = m[2].replace(/^0+(?=\d)/, '');
  let frac = (m[3] ?? '').replace(/0+$/, '');
  const exp = m[4] ? parseInt(m[4], 10) : 0;
  if (exp) {
    // shift the decimal point textually so that very long decimals stay exact
    const digits = int + frac;
    const point = int.length + exp;
    if (point <= 0) {
      int = '0';
      frac = '0'.repeat(-point) + digits;
    } else if (point >= digits.length) {
      int = digits + '0'.repeat(point - digits.length);
      frac = '';
    } else {
      int = digits.slice(0, point);
      frac = digits.slice(point);
    }
    int = int.replace(/^0+(?=\d)/, '') || '0';
    frac = frac.replace(/0+$/, '');
  }
  if (int === '') int = '0';
  const neg = m[1] === '-' && (int !== '0' || frac !== '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** How the two sides of a column compare: numerically (numbers, decimals sent as text and booleans spell the same value) or as text. */
type Prepared = { numeric: boolean };

/** Canonical text of a cell for equality and for key building. */
function canon(v: CellValue | undefined, p: Prepared, o: DiffOptions): string {
  if (v === null || v === undefined) return NULL_KEY;
  if (typeof v === 'boolean') return p.numeric ? (v ? '1' : '0') : v ? 'true' : 'false';
  if (typeof v === 'number') return canonNumber(v);
  if (typeof v === 'string') {
    if (p.numeric) return canonNumber(v);
    let t = v;
    if (o.trimText) t = t.trim();
    if (o.ignoreCase) t = t.toLowerCase();
    return t;
  }
  if ('$bin' in v) return `\u0001bin:${v.len}:${v.$bin}`;
  if ('$trunc' in v) return `\u0001trunc:${v.len}:${v.$trunc}`;
  return '\u0001cursor';
}

const isTrunc = (s: string) => s.startsWith('\u0001trunc:');

/** Truncated values (`$trunc`) are equal when the lengths agree and one preview is a prefix of the other. */
function sameCanon(a: string, b: string): boolean {
  if (a === b) return true;
  if (isTrunc(a) || isTrunc(b)) {
    const sa = splitTrunc(a);
    const sb = splitTrunc(b);
    return sa.len === sb.len && (sa.text.startsWith(sb.text) || sb.text.startsWith(sa.text));
  }
  return false;
}
function splitTrunc(s: string): { len: number; text: string } {
  if (!isTrunc(s)) return { len: s.length, text: s };
  const rest = s.slice('\u0001trunc:'.length);
  const i = rest.indexOf(':');
  return { len: Number(rest.slice(0, i)), text: rest.slice(i + 1) };
}

/** Column names the two sets share by default as the key: the primary-key columns both report, else none. */
export function defaultKeys(left: DiffSide, right: DiffSide): string[] {
  const r = new Set(right.columns.filter((c) => c.isKey).map((c) => c.name.toLowerCase()));
  return left.columns.filter((c) => c.isKey && r.has(c.name.toLowerCase())).map((c) => c.name);
}

/** Merged column list: the left columns in order, then the ones only the right set has. */
export function mergeColumns(left: DiffSide, right: DiffSide, keys: readonly string[] = []): MergedColumn[] {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  const byName = new Map<string, number>();
  right.columns.forEach((c, i) => {
    const k = c.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, i);
  });
  const used = new Set<number>();
  const out: MergedColumn[] = left.columns.map((c, i) => {
    const j = byName.get(c.name.toLowerCase());
    let r: number | null = null;
    if (j !== undefined && !used.has(j)) {
      used.add(j);
      r = j;
    }
    return { name: c.name, left: i, right: r, kind: c.kind, key: keySet.has(c.name.toLowerCase()) && r !== null };
  });
  right.columns.forEach((c, j) => {
    if (!used.has(j)) out.push({ name: c.name, left: null, right: j, kind: c.kind, key: false });
  });
  return out;
}

export function diffResults(left: DiffSide, right: DiffSide, options: DiffOptions): DiffResult {
  const columns = mergeColumns(left, right, options.keys);
  const common = columns.map((c, i) => ({ c, i })).filter((x) => x.c.left !== null && x.c.right !== null);
  const droppedKeys = options.keys.filter((k) => !common.some((x) => x.c.key && x.c.name.toLowerCase() === k.toLowerCase()));
  const keyCols = common.filter((x) => x.c.key);
  const compareCols = common.filter((x) => !x.c.key);
  const kindMismatches = common
    .filter((x) => left.columns[x.c.left!].kind !== right.columns[x.c.right!].kind)
    .map((x) => x.c.name);
  const prep = new Map<number, Prepared>();
  for (const x of common) {
    const lk = left.columns[x.c.left!].kind;
    const rk = right.columns[x.c.right!].kind;
    const numLike = (k: ColumnKind) => isNumericKind(k) || k === 'bool';
    prep.set(x.i, { numeric: numLike(lk) && numLike(rk) });
  }

  const useKeys = keyCols.length > 0;
  // without a key the whole row (every common column) is the identity
  const idCols = useKeys ? keyCols : common;
  const cellOf = (side: 'left' | 'right', row: CellValue[] | undefined, x: { c: MergedColumn; i: number }) =>
    row?.[(side === 'left' ? x.c.left : x.c.right)!];
  const identity = (side: 'left' | 'right', row: CellValue[] | undefined): string => {
    let k = '';
    for (const x of idCols) k += canon(cellOf(side, row, x), prep.get(x.i)!, options) + SEP;
    return k;
  };

  const counts: DiffCounts = { same: 0, added: 0, removed: 0, changed: 0 };
  const rows: DiffRow[] = [];
  let duplicateKeys = 0;

  const buckets = new Map<string, { idx: number[]; next: number }>();
  for (let j = 0; j < right.rows.length; j++) {
    const k = identity('right', right.rows.get(j));
    const b = buckets.get(k);
    if (b) {
      b.idx.push(j);
      if (useKeys) duplicateKeys++;
    } else buckets.set(k, { idx: [j], next: 0 });
  }
  const seenLeft = new Set<string>();
  for (let i = 0; i < left.rows.length; i++) {
    const lrow = left.rows.get(i);
    const k = identity('left', lrow);
    if (useKeys) {
      if (seenLeft.has(k)) duplicateKeys++;
      else seenLeft.add(k);
    }
    const b = buckets.get(k);
    if (!b || b.next >= b.idx.length) {
      rows.push({ status: 'removed', left: i, right: null, changed: [] });
      counts.removed++;
      continue;
    }
    const j = b.idx[b.next++];
    const changed: number[] = [];
    if (useKeys) {
      const rrow = right.rows.get(j);
      for (const x of compareCols) {
        const p = prep.get(x.i)!;
        if (!sameCanon(canon(cellOf('left', lrow, x), p, options), canon(cellOf('right', rrow, x), p, options))) changed.push(x.i);
      }
    }
    if (changed.length) {
      rows.push({ status: 'changed', left: i, right: j, changed });
      counts.changed++;
    } else {
      rows.push({ status: 'same', left: i, right: j, changed });
      counts.same++;
    }
  }
  // right rows nobody claimed, in the right set's order
  const leftover: number[] = [];
  for (const b of buckets.values()) for (let n = b.next; n < b.idx.length; n++) leftover.push(b.idx[n]);
  leftover.sort((a, b) => a - b);
  for (const j of leftover) {
    rows.push({ status: 'added', left: null, right: j, changed: [] });
    counts.added++;
  }
  return {
    columns, rows, counts, keyColumns: keyCols.map((x) => x.c.name), droppedKeys,
    duplicateKeys: useKeys ? duplicateKeys : 0, kindMismatches,
  };
}

/** True when two sets have nothing in common to compare (no shared column). */
export function noSharedColumns(r: DiffResult): boolean {
  return !r.columns.some((c) => c.left !== null && c.right !== null);
}
