import { describe, expect, it } from 'vitest';
import type { CellValue, ColumnInfo, ColumnKind } from '../../../api/types';
import { diffResults } from '../diff';
import { buildMerged, exportDiff, summaryText, tintOf } from '../merged';

const col = (name: string, kind: ColumnKind = 'string', isKey = false): ColumnInfo => ({
  name, ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: 'people', schema: 'main', isKey,
});
const set = (columns: ColumnInfo[], rows: CellValue[][]) => ({ columns, rows: { length: rows.length, get: (i: number) => rows[i] } });

const A = set([col('id', 'int', true), col('name'), col('city')], [[1, 'ada', 'london'], [2, 'bob', 'paris'], [3, 'cy', 'rome']]);
const B = set([col('id', 'int', true), col('name'), col('city')], [[1, 'ada', 'london'], [2, 'bobby', 'paris'], [4, 'dee', 'oslo']]);
const diff = diffResults(A, B, { keys: ['id'] });

describe('buildMerged', () => {
  it('has a Status column first, then the merged columns (keys marked)', () => {
    const g = buildMerged(diff, A, B, { differencesOnly: false });
    expect(g.columns.map((c) => c.name)).toEqual(['Status', 'id', 'name', 'city']);
    expect(g.columns.map((c) => c.isKey)).toEqual([false, true, false, false]);
    expect(g.columns.every((c) => c.table === null)).toBe(true);
  });

  it('a changed row is a before / after pair; added and removed are single lines', () => {
    const g = buildMerged(diff, A, B, { differencesOnly: true });
    expect(g.rows.map((r) => r.slice(0, 3))).toEqual([
      ['Changed (before)', 2, 'bob'],
      ['Changed (after)', 2, 'bobby'],
      ['Removed', 3, 'cy'],
      ['Added', 4, 'dee'],
    ]);
    expect(g.meta.map((m) => m.kind)).toEqual(['before', 'after', 'removed', 'added']);
    expect(g.meta[0].diffRow).toBe(g.meta[1].diffRow);
  });

  it('keeps the identical rows unless asked for the differences only', () => {
    expect(buildMerged(diff, A, B, { differencesOnly: false }).rows).toHaveLength(5);
    expect(buildMerged(diff, A, B, { differencesOnly: true }).rows).toHaveLength(4);
  });

  it('can be limited to some statuses', () => {
    const g = buildMerged(diff, A, B, { differencesOnly: false, statuses: new Set(['added']) });
    expect(g.rows.map((r) => r[0])).toEqual(['Added']);
  });

  it('a column only one side has is NULL on the other side', () => {
    const L = set([col('id', 'int'), col('a')], [[1, 'x']]);
    const R = set([col('id', 'int'), col('b')], [[1, 'y']]);
    const d = diffResults(L, R, { keys: ['id'] });
    const g = buildMerged(d, L, R, { differencesOnly: false });
    expect(g.columns.map((c) => c.name)).toEqual(['Status', 'id', 'a', 'b']);
    expect(g.rows[0]).toEqual(['Same', 1, 'x', null]);
  });
});

describe('tintOf', () => {
  const g = buildMerged(diff, A, B, { differencesOnly: true });
  it('colours the differing cells of a pair red (before) and green (after), the Status cell amber', () => {
    // changed column: name = grid column 2
    expect([0, 1, 2, 3].map((c) => tintOf(g.meta[0], c))).toEqual(['changed', null, 'removed', null]);
    expect([0, 1, 2, 3].map((c) => tintOf(g.meta[1], c))).toEqual(['changed', null, 'added', null]);
  });
  it('colours whole added and removed lines', () => {
    expect([0, 1, 2, 3].map((c) => tintOf(g.meta[2], c))).toEqual(['removed', 'removed', 'removed', 'removed']);
    expect([0, 1, 2, 3].map((c) => tintOf(g.meta[3], c))).toEqual(['added', 'added', 'added', 'added']);
  });
  it('leaves identical lines alone', () => {
    const all = buildMerged(diff, A, B, { differencesOnly: false });
    expect(tintOf(all.meta[0], 2)).toBeNull();
    expect(tintOf(undefined, 0)).toBeNull();
  });
});

describe('exportDiff', () => {
  const g = buildMerged(diff, A, B, { differencesOnly: true });
  it('writes the shown lines as CSV with the Status column', () => {
    const lines = exportDiff(g, 'csv').split('\r\n');
    expect(lines[0]).toBe('Status,id,name,city');
    expect(lines).toContain('Changed (before),2,bob,paris');
    expect(lines).toContain('Changed (after),2,bobby,paris');
    expect(lines).toContain('Removed,3,cy,rome');
    expect(lines).toContain('Added,4,dee,oslo');
  });
  it('writes a Markdown table', () => {
    const md = exportDiff(g, 'markdown');
    expect(md.split('\n')[0]).toContain('Status');
    expect(md).toContain('bobby');
    expect(md).toContain('| --- ');
  });
});

describe('summaryText', () => {
  it('lists only the non-zero kinds, then the same rows', () => {
    expect(summaryText({ same: 40, added: 3, removed: 0, changed: 2 })).toBe('3 added, 2 changed, 40 same');
    expect(summaryText({ same: 0, added: 0, removed: 0, changed: 0 })).toBe('0 same');
  });
});
