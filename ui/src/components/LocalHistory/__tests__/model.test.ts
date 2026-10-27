import { describe, expect, it } from 'vitest';
import { historyKeys, primaryKey } from '../keys';
import { formatDelta, formatSize, groupByDay, snapshotName, withDeltas } from '../model';
import { localHistoryEnabled, retentionDays } from '../settings';
import type { SnapshotInfo } from '../api';
import type { ConsoleTab } from '../../../store/tabs';

const snap = (id: number, at: string, size: number, extra: Partial<SnapshotInfo> = {}): SnapshotInfo => ({
  id, key: 'k', at, reason: 'run', label: null, size, title: null, ...extra,
});

const consoleTab = (extra: Partial<ConsoleTab> = {}): ConsoleTab => ({
  kind: 'console', id: 't_1', title: 'Console 1', connectionId: 'c1', database: null, text: '', savedText: '', filePath: null, txMode: 'auto', maxRows: null, ...extra,
});

describe('history keys', () => {
  it('a plain console is keyed by its tab id', () => {
    expect(primaryKey(consoleTab())).toBe('t:t_1');
    expect(historyKeys(consoleTab())).toEqual(['t:t_1']);
  });

  it('a file console is keyed by the file, with the tab id as an alias for what came before', () => {
    const t = consoleTab({ filePath: 'C:\\sql\\a b.sql' });
    expect(primaryKey(t)).toBe('f:C:\\sql\\a b.sql');
    expect(historyKeys(t)).toEqual(['f:C:\\sql\\a b.sql', 't:t_1']);
  });

  it('a saved query wins over the file, an "Edit:" console is keyed by its object', () => {
    expect(primaryKey(consoleTab({ filePath: 'x.sql', savedQuery: { id: 'q_1', connectionId: 'c1', database: null, schema: null, name: 'n' } }))).toBe('q:q_1');
    const edit = consoleTab({ edit: { connectionId: 'c1', database: 'Shop', ref: { database: 'Shop', schema: 'dbo', name: 'vOrders', type: 'view' }, dialect: 'sqlserver' } });
    expect(primaryKey(edit)).toBe('o:c1|Shop|dbo|view|vOrders');
    expect(historyKeys(edit)).toEqual(['o:c1|Shop|dbo|view|vOrders', 't:t_1']);
  });
});

describe('list model', () => {
  it('computes the size change against the next older snapshot', () => {
    const rows = withDeltas([snap(3, '2026-10-27T10:03:00Z', 120), snap(2, '2026-10-27T10:02:00Z', 100), snap(1, '2026-10-27T10:01:00Z', 100)]);
    expect(rows.map((r) => r.delta)).toEqual([20, 0, null]);
    expect(formatDelta(20)).toBe('+20');
    expect(formatDelta(-1500)).toBe('−1,500');
    expect(formatDelta(0)).toBe('±0');
    expect(formatDelta(null)).toBe('');
  });

  it('groups consecutive snapshots of a day under Today / Yesterday', () => {
    const now = new Date(2026, 9, 27, 15, 0, 0);
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0, 0).toISOString();
    const rows = withDeltas([snap(4, at(27, 14), 1), snap(3, at(27, 9), 1), snap(2, at(26, 20), 1), snap(1, at(20, 8), 1)]);
    const groups = groupByDay(rows, now);
    expect(groups.map((g) => [g.day === 'Today' || g.day === 'Yesterday' ? g.day : 'older', g.rows.length])).toEqual([['Today', 2], ['Yesterday', 1], ['older', 1]]);
  });

  it('names a snapshot by its label, else by what triggered it', () => {
    expect(snapshotName(snap(1, '2026-10-27T10:00:00Z', 1, { label: 'before refactor' }))).toBe('before refactor');
    expect(snapshotName(snap(1, '2026-10-27T10:00:00Z', 1, { reason: 'save' }))).toMatch(/^Save at /);
    expect(formatSize(12)).toBe('12 chars');
    expect(formatSize(2500)).toBe('2.5k chars');
    expect(formatSize(25_000)).toBe('25k chars');
  });
});

describe('settings', () => {
  it('is on by default and clamps the retention to 1..365 days (30 by default)', () => {
    expect(localHistoryEnabled({ ui: {} })).toBe(true);
    expect(localHistoryEnabled({ ui: { localHistory: false } })).toBe(false);
    expect(retentionDays({ ui: {} })).toBe(30);
    expect(retentionDays({ ui: { localHistoryDays: 0 } })).toBe(1);
    expect(retentionDays({ ui: { localHistoryDays: 9999 } })).toBe(365);
    expect(retentionDays({ ui: { localHistoryDays: 'x' } })).toBe(30);
    expect(retentionDays({ ui: { localHistoryDays: 7.4 } })).toBe(7);
  });
});
