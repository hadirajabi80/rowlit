// Helpers behind the wizard's hints: reserved words, row estimates, columns that do not fit their type, recent files, file kinds.
import { beforeEach, describe, expect, it } from 'vitest';
import { isLegacyExcel, isSqlFile } from './files';
import { columnProblems, estimateRows, isReservedWord } from './model';
import { forgetRecent, MAX_RECENT, readRecent, rememberRecent } from './recent';
import type { PreviewResult } from './types';

const preview = (over: Partial<PreviewResult> = {}): PreviewResult => ({
  path: 'a.csv', fileName: 'a.csv', fileSize: 10_000,
  options: { format: 'csv' },
  columns: [
    { index: 0, name: 'id', inferred: { kind: 'int', nullable: false } },
    { index: 1, name: 'price', inferred: { kind: 'decimal', precision: 8, scale: 2, nullable: false } },
    { index: 2, name: 'note', inferred: { kind: 'text', length: 10, nullable: true } },
  ],
  rows: [['1', '10.50', 'x'], ['2', '1,250.75', 'y']],
  sampledRows: 2, moreRows: false, warnings: [],
  ...over,
});

describe('reserved words', () => {
  it('knows common SQL keywords whatever their case', () => {
    expect(isReservedWord('order')).toBe(true);
    expect(isReservedWord(' Select ')).toBe(true);
    expect(isReservedWord('orders')).toBe(false);
    expect(isReservedWord('')).toBe(false);
  });
});

describe('estimateRows', () => {
  it('is exact when the engine read the whole file', () => {
    expect(estimateRows(preview())).toEqual({ rows: 2, exact: true });
    expect(estimateRows(null)).toBeNull();
  });
  it('estimates from the size of the previewed rows, never below what was sampled', () => {
    const p = preview({ moreRows: true, sampledRows: 2000, fileSize: 1_000_000, rows: [['1', '10.50', 'x'], ['2', '11.50', 'y']] });
    const e = estimateRows(p)!;
    expect(e.exact).toBe(false);
    expect(e.rows).toBeGreaterThan(2000);
  });
  it('says nothing about a zipped workbook', () => {
    expect(estimateRows(preview({ moreRows: true, options: { format: 'xlsx' } }))).toBeNull();
  });
});

describe('columnProblems', () => {
  it('accepts numbers with separators and Persian digits, flags text in a number column', () => {
    expect(columnProblems(preview()).size).toBe(0);
    expect(columnProblems(preview({ rows: [['۱۲', '1٬250', 'x']] })).size).toBe(0);
    const bad = columnProblems(preview({ rows: [['1', 'n/a', 'x'], ['two', '2.5', 'y']] }));
    expect([...bad.keys()].sort()).toEqual([0, 1]);
    expect(bad.get(1)).toContain('"n/a" is not a number');
  });
  it('flags a column named in an engine warning', () => {
    const p = preview({ warnings: ['Column "note" has mixed encodings.'] });
    expect(columnProblems(p).get(2)).toContain('mixed encodings');
  });
});

describe('recent files', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the newest first without duplicates (Windows paths ignore case) and caps the list', () => {
    rememberRecent('C:\\a.csv');
    rememberRecent('C:\\b.csv');
    rememberRecent('c:\\A.csv');
    expect(readRecent().map((r) => r.path)).toEqual(['c:\\A.csv', 'C:\\b.csv']);
    for (let i = 0; i < MAX_RECENT + 3; i++) rememberRecent(`C:\\f${i}.csv`);
    expect(readRecent()).toHaveLength(MAX_RECENT);
    forgetRecent(`C:\\f${MAX_RECENT + 2}.csv`);
    expect(readRecent()).toHaveLength(MAX_RECENT - 1);
  });
  it('survives broken or blocked storage', () => {
    window.localStorage.setItem('rowlit.import.recentFiles', '{not json');
    expect(readRecent()).toEqual([]);
    window.localStorage.setItem('rowlit.import.recentFiles', JSON.stringify([{ nope: 1 }, { path: 'x.csv', at: 1 }]));
    expect(readRecent().map((r) => r.path)).toEqual(['x.csv']);
    rememberRecent('   '); // ignored
    expect(readRecent()).toHaveLength(1);
  });
});

describe('file kinds', () => {
  it('tells SQL scripts and legacy workbooks apart', () => {
    expect(isSqlFile('C:\\x\\Report.SQL')).toBe(true);
    expect(isSqlFile('a.csv')).toBe(false);
    expect(isLegacyExcel('old.xls')).toBe(true);
    expect(isLegacyExcel('new.xlsx')).toBe(false);
  });
});
