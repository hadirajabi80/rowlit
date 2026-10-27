// Pure helpers of the local history view (formatting, grouping, size deltas).
import type { SnapshotInfo, SnapshotReason } from './api';

export const REASON_LABEL: Record<SnapshotReason, string> = {
  run: 'Run',
  save: 'Save',
  close: 'Closed',
  auto: 'Autosave',
  restore: 'Before restore',
  manual: 'Manual',
};

/** State of a local-history tab: which editor it shows (kept in the workspace, so it survives a restart). */
export interface LocalHistoryTabState {
  tabId: string;
  /** Every key the editor's snapshots may be stored under (primary first), see ./keys.ts. */
  keys: string[];
  title: string;
}

export interface SnapshotRow {
  info: SnapshotInfo;
  /** Size change against the next older snapshot of the list (null for the oldest one). */
  delta: number | null;
}

/** Newest-first list with the size change of each snapshot against the one before it in time. */
export function withDeltas(list: readonly SnapshotInfo[]): SnapshotRow[] {
  return list.map((info, i) => ({ info, delta: i + 1 < list.length ? info.size - list[i + 1].size : null }));
}

export function formatDelta(delta: number | null): string {
  if (delta === null) return '';
  if (delta === 0) return '±0';
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()}`;
}

export function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} chars`;
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)}k chars`;
  return `${(chars / 1_000_000).toFixed(1)}M chars`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today", "Yesterday" or a short date, for the day headers of the list. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fullTimeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export interface DayGroup {
  day: string;
  rows: SnapshotRow[];
}

/** Consecutive rows of the same calendar day under one header. */
export function groupByDay(rows: readonly SnapshotRow[], now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const day = dayLabel(row.info.at, now);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else groups.push({ day, rows: [row] });
  }
  return groups;
}

/** Name for the snapshot in a toast / header: its label, else "Run at 14:03". */
export function snapshotName(s: Pick<SnapshotInfo, 'label' | 'reason' | 'at'>): string {
  return s.label ?? `${REASON_LABEL[s.reason]} at ${timeLabel(s.at)}`;
}
