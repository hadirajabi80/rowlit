import { describe, expect, it } from 'vitest';
import type { CellValue, ColumnInfo } from '../../../api/types';
import { applyDatePattern, formatDatePattern } from '../dateFormat';
import {
  DEFAULT_SETTINGS, dirOf, exportFileName, exportOptions, isServerScope, joinPath, loadPrefs, nullTextOf, savePrefs, scopeCountText,
  withFormatExtension,
} from '../model';
import { pathWithExtension } from '../run';

describe('date pattern (same vectors as the engine\'s ExportDateFormat tests)', () => {
  it.each([
    ['2026-03-09', 'dd/MM/yyyy', '09/03/2026'],
    ['2026-03-09T14:05:06', 'yyyy-MM-dd HH:mm:ss', '2026-03-09 14:05:06'],
    ['2026-03-09T14:05:06.1234567', 'HH:mm:ss.fff', '14:05:06.123'],
    ['2026-03-09T14:05:06.5', 'ss.ffff', '06.5000'],
    ['2026-03-09T14:05:06Z', 'yyyy-MM-dd HH:mm zzz', '2026-03-09 14:05 +00:00'],
    ['2026-03-09T14:05:06+03:30', "yy/M/d 'at' HH", '26/M/d at 14'],
    ['14:05:06', 'HH.mm', '14.05'],
    ['not a date', 'dd/MM/yyyy', 'not a date'],
    ['2026-03-09', '', '2026-03-09'],
  ])('%s with %s', (text, pattern, expected) => expect(formatDatePattern(text, pattern)).toBe(expected));

  it('applies to date / time columns only and leaves other rows untouched', () => {
    const c = (name: string, kind: ColumnInfo['kind']): ColumnInfo => ({ name, ordinal: 0, dbType: kind, kind, nullable: true, size: null, precision: null, scale: null, table: null, schema: null, isKey: false });
    const cols = [c('id', 'int'), c('born', 'date'), c('note', 'string')];
    const rows: CellValue[][] = [[1, '2026-03-09', '2026-03-09'], [2, null, 'x']];
    const out = applyDatePattern(cols, rows, 'dd/MM/yyyy');
    expect(out[0]).toEqual([1, '09/03/2026', '2026-03-09']);
    expect(out[1]).toBe(rows[1]);
    expect(applyDatePattern(cols, rows, '')).toBe(rows);
  });
});

describe('engine options of the settings', () => {
  const s = (p: Partial<typeof DEFAULT_SETTINGS>) => ({ ...DEFAULT_SETTINGS, ...p });

  it('csv: header, delimiter (tab as \\t), NULL text, BOM and date pattern', () => {
    expect(exportOptions(s({ format: 'csv' }))).toEqual({ header: true, delimiter: ',', nullAs: '' });
    expect(exportOptions(s({ format: 'csv', delimiter: '\t', header: false, bom: true, nullText: 'NULL', dateFormat: 'dd/MM/yyyy' })))
      .toEqual({ header: false, delimiter: '\\t', nullAs: 'NULL', bom: true, dateFormat: 'dd/MM/yyyy' });
  });

  it('each format only gets the options it understands', () => {
    expect(exportOptions(s({ format: 'tsv', delimiter: ';' }))).toEqual({ header: true, nullAs: '' });
    expect(exportOptions(s({ format: 'json', bom: true, dateFormat: 'yyyy' }))).toEqual({ bom: true, dateFormat: 'yyyy' });
    expect(exportOptions(s({ format: 'markdown' }))).toEqual({ nullAs: 'NULL' });
    expect(exportOptions(s({ format: 'xlsx', bom: true, dateFormat: 'yyyy', header: false }), { sheetName: 'Orders' })).toEqual({ sheetName: 'Orders' });
    expect(exportOptions(s({ format: 'xlsx', sheetName: ' Mine ' }), { sheetName: 'Orders' })).toEqual({ sheetName: 'Mine' });
    expect(exportOptions(s({ format: 'sql-insert', tableName: ' dbo.t ', sqlDialect: 'mysql', bom: true, dateFormat: 'yyyy' })))
      .toEqual({ bom: true, tableName: 'dbo.t', targetDialect: 'mysql' });
  });

  it('NULL text defaults per format and follows an explicit choice', () => {
    expect(nullTextOf(s({ format: 'markdown' }))).toBe('NULL');
    expect(nullTextOf(s({ format: 'csv' }))).toBe('');
    expect(nullTextOf(s({ format: 'csv', nullText: '\\N' }))).toBe('\\N');
  });
});

describe('scopes, names and paths', () => {
  it('counts', () => {
    expect(scopeCountText({ count: 1000, countKind: 'exact' })).toBe('1,000 rows');
    expect(scopeCountText({ count: 1, countKind: 'exact' })).toBe('1 row');
    expect(scopeCountText({ count: 1234567, countKind: 'estimate' })).toBe('~1,234,567 rows');
    expect(scopeCountText({ count: null, countKind: 'exact' })).toBe('');
  });

  it('server scopes are the ones the engine streams', () => {
    expect(['loaded', 'selection'].some((x) => isServerScope(x as 'loaded'))).toBe(false);
    expect(['filtered', 'all', 'rerun'].every((x) => isServerScope(x as 'all'))).toBe(true);
  });

  it('file names keep letters of any script', () => {
    expect(exportFileName('Customers', 'csv')).toBe('Customers.csv');
    expect(exportFileName('مشتریان 2026', 'xlsx')).toBe('مشتریان_2026.xlsx');
    expect(exportFileName('', 'markdown')).toBe('export.md');
    expect(exportFileName('a/b:c', 'sql-insert')).toBe('a_b_c.sql');
  });

  it('paths', () => {
    expect(dirOf('C:\\out\\a.csv')).toBe('C:\\out');
    expect(joinPath('C:\\out', 'a.csv')).toBe('C:\\out\\a.csv');
    expect(joinPath('/home/u/', 'a.csv')).toBe('/home/u/a.csv');
    expect(withFormatExtension('C:\\out\\a.csv', 'xlsx')).toBe('C:\\out\\a.xlsx');
    expect(withFormatExtension('C:\\out\\my.data', 'xlsx')).toBe('C:\\out\\my.data');
    expect(pathWithExtension('C:\\out\\a', 'json')).toBe('C:\\out\\a.json');
    expect(pathWithExtension('C:\\out\\a.txt', 'json')).toBe('C:\\out\\a.txt');
  });
});

describe('remembered preferences', () => {
  it('round-trips the choices and ignores junk', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    savePrefs({ ...DEFAULT_SETTINGS, format: 'xlsx', bom: true, dateFormat: 'yyyy-MM-dd' }, 'C:\\out', store);
    expect(loadPrefs(store)).toMatchObject({ format: 'xlsx', bom: true, dateFormat: 'yyyy-MM-dd', dir: 'C:\\out' });
    mem.set('rowlit.export.v1', JSON.stringify({ format: 'exe', bom: 'yes', delimiter: 'abc' }));
    expect(loadPrefs(store)).toEqual({});
    mem.set('rowlit.export.v1', '{not json');
    expect(loadPrefs(store)).toEqual({});
    expect(loadPrefs(null)).toEqual({});
  });
});
