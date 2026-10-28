import { describe, expect, it } from 'vitest';
import type { GenerateColumn, GenerateSummary, GeneratorInfo } from '../../../api/types.generate';
import {
  buildRequest, columnIssues, defaultOptions, generatorsFor, groupGenerators, hasIssues, initialSettings, parseRows, pickerSpecials, previewKey, progressPercent,
  roleBadges, runIssues, summaryLine, withGenerator, withNullPercent, withOption,
} from '../model';

const opt = (key: string, label: string, type: GeneratorInfo['options'][number]['type'], def: string | null = null) => ({ key, label, type, default: def, help: null });

const INFOS: GeneratorInfo[] = [
  { id: 'sequence', label: 'Sequence', group: 'Numbers', kinds: ['int', 'bigint', 'text'], options: [opt('start', 'Start at', 'number', 'auto'), opt('step', 'Step', 'number', '1')] },
  { id: 'int', label: 'Whole number', group: 'Numbers', kinds: ['int', 'bigint', 'decimal', 'text'], options: [opt('min', 'Minimum', 'number', '1'), opt('max', 'Maximum', 'number', '100000')] },
  { id: 'bool', label: 'Boolean', group: 'Numbers', kinds: ['bool', 'int'], options: [opt('trueP', 'Chance of true (%)', 'number', '50')] },
  { id: 'date', label: 'Date', group: 'Dates', kinds: ['date', 'datetime', 'text'], options: [opt('from', 'From', 'date', '2020-01-01'), opt('to', 'To', 'date', 'today')] },
  { id: 'time', label: 'Time of day', group: 'Dates', kinds: ['time'], options: [opt('from', 'From', 'time', '00:00:00'), opt('to', 'To', 'time', '23:59:59')] },
  { id: 'email', label: 'Email address', group: 'People', kinds: ['text', 'other'], options: [] },
  { id: 'full_name', label: 'Full name', group: 'People', kinds: ['text', 'other'], options: [] },
  { id: 'list', label: 'Pick from a list', group: 'Text', kinds: ['int', 'text'], options: [opt('values', 'Values (one per line)', 'multiline', 'one\ntwo\nthree')] },
  { id: 'pattern', label: 'Pattern', group: 'Text', kinds: ['text'], options: [opt('pattern', 'Pattern', 'text', '[A-Z]{3}-\\d{4}')] },
  { id: 'skip', label: 'Skip', group: 'Special', kinds: ['int', 'text'], options: [] },
  { id: 'foreignKey', label: 'Parent table value', group: 'Special', kinds: ['int', 'text'], options: [] },
];

const col = (over: Partial<GenerateColumn> = {}): GenerateColumn => ({
  name: 'c', type: 'varchar(50)', kind: 'text', nullable: true, isPk: false, isIdentity: false, isComputed: false, hasDefault: false,
  generator: 'email', options: {}, nullPercent: 5, unique: false, foreignKey: null, note: null, ...over,
});

describe('parseRows', () => {
  it('accepts whole numbers with separators inside the limit', () => {
    expect(parseRows('1000', 1_000_000)).toBe(1000);
    expect(parseRows('1,000', 1_000_000)).toBe(1000);
    expect(parseRows(' 25 000 ', 1_000_000)).toBe(25000);
    expect(parseRows('1', 5)).toBe(1);
  });

  it('rejects everything else', () => {
    for (const bad of ['', '0', '-3', '1.5', 'abc', '1e3', '1000001']) expect(parseRows(bad, 1_000_000)).toBeNull();
  });
});

describe('generator pickers', () => {
  it('lists the generators for a kind, grouped, without the special entries', () => {
    const list = generatorsFor('text', INFOS);
    expect(list.map((g) => g.id)).toEqual(['sequence', 'int', 'date', 'email', 'full_name', 'list', 'pattern']);
    expect(groupGenerators(list).map((g) => [g.group, g.items.length])).toEqual([['Numbers', 2], ['Dates', 1], ['People', 2], ['Text', 2]]);
    expect(generatorsFor('time', INFOS).map((g) => g.id)).toEqual(['time']);
  });

  it('offers skip always and the parent value only for foreign key columns', () => {
    expect(pickerSpecials(col()).map((s) => s.id)).toEqual(['skip']);
    expect(pickerSpecials(col({ foreignKey: 'fk1' })).map((s) => s.id)).toEqual(['skip', 'foreignKey']);
    expect(pickerSpecials(col({ isComputed: true }))[0].label).toContain('computed');
  });

  it('switching generator takes its default options and keeps the null share and unique flag', () => {
    const c = col({ generator: 'email', options: {}, nullPercent: 20, unique: true, note: 'by name' });
    const next = withGenerator(c, 'int', INFOS);
    expect(next).toMatchObject({ generator: 'int', options: { min: '1', max: '100000' }, nullPercent: 20, unique: true, note: null });
    expect(defaultOptions(undefined)).toEqual({});
    expect(withOption(next, 'max', '50').options).toEqual({ min: '1', max: '50' });
  });

  it('clamps the null percent', () => {
    expect(withNullPercent(col(), '250').nullPercent).toBe(100);
    expect(withNullPercent(col(), '-4').nullPercent).toBe(0);
    expect(withNullPercent(col(), '12,5').nullPercent).toBe(12.5);
    expect(withNullPercent(col(), 'x').nullPercent).toBe(0);
  });
});

describe('columnIssues', () => {
  const int = (options: Record<string, string>) => col({ kind: 'int', generator: 'int', options });

  it('is quiet for skipped columns, parent values and valid options', () => {
    expect(columnIssues(col({ generator: 'skip' }), INFOS)).toEqual([]);
    expect(columnIssues(col({ generator: 'foreignKey', foreignKey: 'f' }), INFOS)).toEqual([]);
    expect(columnIssues(int({ min: '1', max: '10' }), INFOS)).toEqual([]);
    expect(columnIssues(col({ generator: 'sequence', options: { start: 'auto', step: '2' } }), INFOS)).toEqual([]);
    expect(columnIssues(col({ generator: 'date', options: { from: '2024-01-01', to: 'today' } }), INFOS)).toEqual([]);
    expect(columnIssues(col({ generator: 'time', kind: 'time', options: { from: '09:00', to: '17:30:00' } }), INFOS)).toEqual([]);
  });

  it('names what is wrong with numbers, dates, times and ranges', () => {
    expect(columnIssues(int({ min: 'abc', max: '10' }), INFOS)).toEqual(['Minimum must be a number.']);
    expect(columnIssues(int({ min: '20', max: '10' }), INFOS)).toEqual(['Minimum is above the maximum.']);
    expect(columnIssues(col({ generator: 'date', options: { from: '15/03/2024', to: 'today' } }), INFOS)).toEqual(['From must be a date such as 2024-03-15.']);
    expect(columnIssues(col({ generator: 'date', options: { from: '2024-05-01', to: '2024-01-01' } }), INFOS)).toEqual(['"From" is after "To".']);
    expect(columnIssues(col({ generator: 'time', kind: 'time', options: { from: '9am', to: '17:00' } }), INFOS)).toEqual(['From must be a time such as 09:30:00.']);
    expect(columnIssues(col({ generator: 'bool', kind: 'bool', options: { trueP: '150' } }), INFOS)).toEqual(['Chance of true must be between 0 and 100.']);
    expect(columnIssues(col({ generator: 'sequence', options: { start: 'x' } }), INFOS)).toEqual(['Start at must be a number.']);
  });

  it('wants values for a list and a pattern, and knows unknown generators', () => {
    expect(columnIssues(col({ generator: 'list', options: { values: '  ' } }), INFOS)).toEqual(['Enter at least one value.']);
    expect(columnIssues(col({ generator: 'list', options: { values: ' , \n ,' } }), INFOS)).toEqual(['Enter at least one value.']);
    expect(columnIssues(col({ generator: 'list', options: { values: 'a\nb' } }), INFOS)).toEqual([]);
    expect(columnIssues(col({ generator: 'pattern', options: { pattern: '' } }), INFOS)).toEqual(['Enter a pattern.']);
    expect(columnIssues(col({ generator: 'nope' }), INFOS)).toEqual(["Unknown generator 'nope'."]);
  });
});

describe('runIssues and the request', () => {
  const columns = [col({ name: 'id', generator: 'skip', kind: 'int' }), col({ name: 'email' })];

  it('collects the problems of rows, columns and an all-skipped table', () => {
    expect(hasIssues(runIssues(initialSettings(1), columns, INFOS, 1_000_000))).toBe(false);
    const bad = runIssues({ ...initialSettings(1), rows: '0' }, [col({ name: 'a', generator: 'list', options: { values: '' } })], INFOS, 1_000_000);
    expect(bad.rows).toContain('1,000,000');
    expect(bad.columns).toEqual({ a: ['Enter at least one value.'] });
    expect(hasIssues(bad)).toBe(true);
    const none = runIssues(initialSettings(1), [col({ generator: 'skip' })], INFOS, 10);
    expect(none.general).toContain('nothing to generate');
    expect(hasIssues(none)).toBe(true);
    // a computed column is not generated even when its generator was not changed to skip
    expect(runIssues(initialSettings(1), [col({ isComputed: true })], INFOS, 10).general).not.toBeNull();
  });

  it('builds the request from the settings', () => {
    const settings = { ...initialSettings(42, 2500), truncateFirst: true, onError: 'skip' as const, transaction: false };
    const req = buildRequest({ connectionId: 'c1', database: 'shop', schema: 'public', table: 'orders' }, settings, columns, 1_000_000, { previewRows: 20 });
    expect(req).toMatchObject({
      connectionId: 'c1', database: 'shop', schema: 'public', table: 'orders', rows: 2500, seed: 42, truncateFirst: true, transaction: false, onError: 'skip', previewRows: 20,
    });
    expect(req.columns).toBe(columns);
    expect(buildRequest({ connectionId: 'c1', database: null, schema: null, table: 't' }, initialSettings(1), columns, 10).previewRows).toBeUndefined();
  });

  it('changes the preview key when anything the preview depends on changes', () => {
    const s = initialSettings(1);
    const k = previewKey(s, columns);
    expect(previewKey({ ...s }, [...columns])).toBe(k);
    expect(previewKey({ ...s, seed: 2 }, columns)).not.toBe(k);
    expect(previewKey({ ...s, rows: '10' }, columns)).not.toBe(k);
    expect(previewKey(s, [columns[0], withOption(columns[1], 'x', '1')])).not.toBe(k);
    expect(previewKey({ ...s, onError: 'skip' }, columns)).toBe(k); // not part of what is generated
  });
});

describe('progress and summary text', () => {
  it('computes the percent', () => {
    expect(progressPercent(null)).toBeNull();
    expect(progressPercent({ phase: 'generating', rows: 250, total: 1000, written: 250, skipped: 0, errors: 0, rate: 1 })).toBe(25);
    expect(progressPercent({ phase: 'preparing', rows: 0, total: 0, written: 0, skipped: 0, errors: 0, rate: 0 })).toBeNull();
  });

  it('summarises the result', () => {
    const base: GenerateSummary = {
      outcome: 'completed', error: null, rowsRequested: 1000, rowsGenerated: 1000, rowsWritten: 1000, rowsSkipped: 0, errorCount: 0, elapsedMs: 10, rowsPerSecond: 100,
      committed: true, rolledBack: false, truncated: false, errorsSample: [], hasErrorReport: false, loadMethod: 'COPY', seed: 1, warnings: [],
    };
    expect(summaryLine(base)).toBe('1,000 of 1,000 rows written');
    expect(summaryLine({ ...base, rowsWritten: 990, errorCount: 10, truncated: true })).toBe('990 of 1,000 rows written · 10 rejected · existing rows deleted first');
    expect(summaryLine({ ...base, rowsWritten: 0, rolledBack: true })).toBe('0 of 1,000 rows written · everything rolled back');
  });

  it('badges the roles of a column', () => {
    expect(roleBadges(col({ isPk: true, foreignKey: 'f', isIdentity: true }))).toEqual(['PK', 'FK', 'identity']);
    expect(roleBadges(col())).toEqual([]);
  });
});
