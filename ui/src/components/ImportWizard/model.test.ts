import { describe, expect, it } from 'vitest';
import {
  autoMatch, buildImportRequest, defaultNewColumns, expressionCompat, formatDuration, formatOfPath, isImportable, isUniqueKey, kindCompat,
  lastNamePart, mappingIssues, newTableIssues, normName, parseProgress, pickDefaultKey, progressPercent, sanitizeIdentifier, SKIP,
  tableNameFromFile, type MapChoice,
} from './model';
import type { InferredType, PreviewColumn, TargetColumn, TargetTableInfo } from './types';

const inf = (kind: InferredType['kind'], extra: Partial<InferredType> = {}): InferredType => ({ kind, nullable: false, ...extra });
const src = (name: string, index: number, kind: InferredType['kind'] = 'text'): PreviewColumn => ({ index, name, inferred: inf(kind) });
const tgt = (name: string, kind: TargetColumn['kind'], extra: Partial<TargetColumn> = {}): TargetColumn => ({
  name, type: kind, kind, nullable: true, isPk: false, isIdentity: false, isComputed: false, hasDefault: false, ordinal: 0, ...extra,
});

describe('file formats', () => {
  it('detects the format by extension', () => {
    expect(formatOfPath('C:\\data\\Sales 2024.CSV')).toBe('csv');
    expect(formatOfPath('/tmp/a.txt')).toBe('csv');
    expect(formatOfPath('/tmp/a.tsv')).toBe('tsv');
    expect(formatOfPath('/tmp/a.xlsx')).toBe('xlsx');
    expect(formatOfPath('/tmp/a.json')).toBe('json');
    expect(formatOfPath('/tmp/a.jsonl')).toBe('ndjson');
    expect(formatOfPath('/tmp/a.ndjson')).toBe('ndjson');
    expect(formatOfPath('/tmp/a.xls')).toBeNull();
    expect(formatOfPath('/tmp/noext')).toBeNull();
    expect(isImportable('x.xlsx')).toBe(true);
    expect(isImportable('x.png')).toBe(false);
  });
});

describe('names', () => {
  it('sanitises identifiers and keeps Persian letters', () => {
    expect(sanitizeIdentifier('Order Date (UTC)', 'c')).toBe('Order_Date_UTC');
    expect(sanitizeIdentifier('  ', 'c1')).toBe('c1');
    expect(sanitizeIdentifier('2024 sales', 'c')).toBe('_2024_sales');
    expect(sanitizeIdentifier('نام مشتری', 'c')).toBe('نام_مشتری');
  });
  it('proposes a table name from the file', () => {
    expect(tableNameFromFile('C:\\x\\Sales 2024.csv')).toBe('Sales_2024');
    expect(tableNameFromFile('/a/b/.csv')).toBe('csv');
    expect(tableNameFromFile('/a/b/***.csv')).toBe('imported_data');
  });
  it('compares column names loosely', () => {
    expect(normName('Customer_ID')).toBe(normName('customer id'));
    expect(normName('customer-id')).toBe('customerid');
  });
  it('takes the last part of a qualified name', () => {
    expect(lastNamePart('[dbo].[My Table]')).toBe('My Table');
    expect(lastNamePart('"public"."orders"')).toBe('orders');
    expect(lastNamePart('`shop`.`t`')).toBe('t');
    expect(lastNamePart('main.items')).toBe('items');
    expect(lastNamePart('plain')).toBe('plain');
  });
  it('makes unique column names for a new table', () => {
    const rows = defaultNewColumns([src('Name', 0), src('name', 1), src('', 2), src('a b', 3)]);
    expect(rows.map((r) => r.name)).toEqual(['Name', 'name_2', 'column_3', 'a_b']);
    expect(rows.every((r) => r.include && r.sqlType === null && r.nullable)).toBe(true);
  });
});

describe('kindCompat', () => {
  it('accepts empty columns and text targets', () => {
    expect(kindCompat('empty', 'int')).toBe('ok');
    expect(kindCompat('int', 'text')).toBe('ok');
    expect(kindCompat('date', 'text')).toBe('ok');
    expect(kindCompat('guid', 'text')).toBe('ok');
  });
  it('rates numbers', () => {
    expect(kindCompat('int', 'int')).toBe('ok');
    expect(kindCompat('int', 'bigint')).toBe('ok');
    expect(kindCompat('int', 'decimal')).toBe('ok');
    expect(kindCompat('bigint', 'int')).toBe('warn');
    expect(kindCompat('decimal', 'int')).toBe('warn');
    expect(kindCompat('decimal', 'float')).toBe('convert');
    expect(kindCompat('int', 'bool')).toBe('convert');
    expect(kindCompat('bool', 'int')).toBe('convert');
  });
  it('rates text, dates and mismatches', () => {
    expect(kindCompat('text', 'int')).toBe('warn');
    expect(kindCompat('text', 'date')).toBe('convert');
    expect(kindCompat('text', 'guid')).toBe('convert');
    expect(kindCompat('text', 'binary')).toBe('warn');
    expect(kindCompat('date', 'int')).toBe('warn');
    expect(kindCompat('date', 'datetime')).toBe('ok');
    expect(kindCompat('datetime', 'date')).toBe('warn');
    expect(kindCompat('int', 'date')).toBe('warn');
    expect(kindCompat('text', 'json')).toBe('convert');
    expect(kindCompat('int', 'other')).toBe('convert');
  });
  it('rates expressions', () => {
    expect(expressionCompat('now', 'datetime')).toBe('ok');
    expect(expressionCompat('now', 'date')).toBe('convert');
    expect(expressionCompat('now', 'int')).toBe('warn');
    expect(expressionCompat('uuid', 'guid')).toBe('ok');
    expect(expressionCompat('uuid', 'text')).toBe('ok');
    expect(expressionCompat('rowNumber', 'int')).toBe('ok');
    expect(expressionCompat('fileName', 'int')).toBe('warn');
  });
});

describe('autoMatch', () => {
  const sources = [src('Customer ID', 0, 'int'), src('first_name', 1), src('Email', 2), src('extra', 3)];

  it('matches by name ignoring case, spaces and underscores, each file column once', () => {
    const m = autoMatch([tgt('customer_id', 'int'), tgt('FirstName', 'text'), tgt('email', 'text'), tgt('notes', 'text')], sources);
    expect(m.customer_id).toEqual({ kind: 'source', index: 0 });
    expect(m.FirstName).toEqual({ kind: 'source', index: 1 });
    expect(m.email).toEqual({ kind: 'source', index: 2 });
    expect(m.notes).toEqual(SKIP);
  });

  it('uses each file column only once', () => {
    const m = autoMatch([tgt('email', 'text'), tgt('E_mail', 'text')], [src('Email', 0)]);
    expect(m.email).toEqual({ kind: 'source', index: 0 });
    expect(m.E_mail).toEqual(SKIP);
  });

  it('skips identity and computed columns even when the name matches', () => {
    const m = autoMatch([tgt('Customer ID', 'int', { isIdentity: true }), tgt('email', 'text'), tgt('total', 'int', { isComputed: true })], [src('customer id', 0), src('email', 1), src('total', 2)]);
    expect(m['Customer ID']).toEqual(SKIP);
    expect(m.total).toEqual(SKIP);
    expect(m.email).toEqual({ kind: 'source', index: 1 });
  });

  it('falls back to positions only when nothing matched and the counts are equal', () => {
    const byPos = autoMatch([tgt('a', 'int'), tgt('b', 'text')], [src('x', 0), src('y', 1)]);
    expect(byPos.a).toEqual({ kind: 'source', index: 0 });
    expect(byPos.b).toEqual({ kind: 'source', index: 1 });
    // an identity column is not counted
    const withIdentity = autoMatch([tgt('id', 'int', { isIdentity: true }), tgt('a', 'int'), tgt('b', 'text')], [src('x', 0), src('y', 1)]);
    expect(withIdentity.id).toEqual(SKIP);
    expect(withIdentity.a).toEqual({ kind: 'source', index: 0 });
    // different counts: no positional guess
    const unequal = autoMatch([tgt('a', 'int'), tgt('b', 'text'), tgt('c', 'text')], [src('x', 0), src('y', 1)]);
    expect(Object.values(unequal).every((c) => c.kind === 'skip')).toBe(true);
    // one name matched: no positional guess for the rest
    const partial = autoMatch([tgt('a', 'int'), tgt('b', 'text')], [src('a', 0), src('zzz', 1)]);
    expect(partial.b).toEqual(SKIP);
  });
});

describe('mappingIssues', () => {
  const info: TargetTableInfo = {
    exists: true,
    columns: [
      tgt('id', 'int', { isPk: true, isIdentity: true, nullable: false }),
      tgt('name', 'text', { nullable: false }),
      tgt('age', 'int'),
      tgt('created', 'datetime', { nullable: false, hasDefault: true }),
    ],
    primaryKey: ['id'],
    uniqueKeys: [['id'], ['name']],
  };
  const cols = [src('name', 0, 'text'), src('age', 1, 'text')];

  it('flags required columns without a source and counts type warnings', () => {
    const none = mappingIssues(info, { id: SKIP, name: SKIP, age: SKIP, created: SKIP }, cols);
    expect(none.errors).toContain('Map at least one column.');
    expect(none.errors.some((e) => e.includes('"name" is required'))).toBe(true);
    // identity and defaulted columns are never required
    expect(none.errors.some((e) => e.includes('"id"') || e.includes('"created"'))).toBe(false);

    const m: Record<string, MapChoice> = { name: { kind: 'source', index: 0 }, age: { kind: 'source', index: 1 } };
    const ok = mappingIssues(info, m, cols);
    expect(ok.errors).toEqual([]);
    expect(ok.compat.name).toBe('ok');
    expect(ok.compat.age).toBe('warn'); // text -> int
    expect(ok.warnings).toHaveLength(1);
  });

  it('rejects mapping a computed column and a missing file column', () => {
    const withComputed: TargetTableInfo = { ...info, columns: [...info.columns, tgt('calc', 'int', { isComputed: true })] };
    const r = mappingIssues(withComputed, { name: { kind: 'source', index: 9 }, calc: { kind: 'constant', value: '1' } }, cols);
    expect(r.errors.some((e) => e.includes('computed'))).toBe(true);
    expect(r.errors.some((e) => e.includes('does not exist'))).toBe(true);
  });

  it('picks the default key and checks unique keys', () => {
    const m: Record<string, MapChoice> = { name: { kind: 'source', index: 0 } };
    expect(pickDefaultKey(info, m)).toEqual(['name']); // the PK id is not loaded, the unique key name is
    expect(pickDefaultKey(info, { ...m, id: { kind: 'source', index: 1 } })).toEqual(['id']);
    expect(pickDefaultKey(null, m)).toEqual([]);
    expect(isUniqueKey(info, ['name'])).toBe(true);
    expect(isUniqueKey(info, ['NAME', 'age'])).toBe(true); // contains a whole unique key
    expect(isUniqueKey(info, ['age'])).toBe(false);
    expect(isUniqueKey(info, [])).toBe(false);
  });
});

describe('newTableIssues', () => {
  it('validates the name, columns and key', () => {
    const rows = defaultNewColumns([src('a', 0), src('b', 1)]);
    expect(newTableIssues('t', rows, [])).toEqual([]);
    expect(newTableIssues(' ', rows, [])).toEqual(['Enter a name for the new table.']);
    expect(newTableIssues('t', rows.map((r) => ({ ...r, include: false })), [])).toEqual(['Include at least one column.']);
    expect(newTableIssues('t', [rows[0], { ...rows[1], name: 'A' }], [])[0]).toContain('used twice');
    expect(newTableIssues('t', rows, ['zzz'])[0]).toContain('primary key');
    expect(newTableIssues('t', [rows[0], { ...rows[1], name: '' }], [])[0]).toContain('has no name');
  });
});

describe('buildImportRequest', () => {
  const info: TargetTableInfo = { exists: true, columns: [tgt('id', 'int', { isIdentity: true }), tgt('name', 'text'), tgt('age', 'int')], primaryKey: ['id'], uniqueKeys: [['id']] };
  const base = {
    path: 'C:\\f.csv',
    source: { format: 'csv' as const, encoding: 'utf-8' },
    target: { database: null, schema: 'dbo', table: ' people ', create: false },
    tableInfo: info,
    mapping: { name: { kind: 'source', index: 0 }, age: { kind: 'expression', name: 'rowNumber' } } as Record<string, MapChoice>,
    newColumns: [],
    primaryKey: [] as string[],
    mode: 'upsert' as const,
    keyColumns: ['name'],
    onError: 'skip' as const,
    maxErrors: 50,
    batchSize: 500,
    transaction: true,
    useBulk: true,
    limit: 0,
  };

  it('maps an existing table, keeping only loaded columns', () => {
    const r = buildImportRequest(base);
    expect(r.target).toEqual({ database: null, schema: 'dbo', table: 'people', create: false });
    expect(r.columns).toEqual([
      { target: 'name', from: { kind: 'source', index: 0 } },
      { target: 'age', from: { kind: 'expression', name: 'rowNumber' } },
    ]);
    expect(r.mode).toBe('upsert');
    expect(r.keyColumns).toEqual(['name']);
    expect(r.maxErrors).toBe(50);
    expect(r.limit).toBeUndefined();
    expect(r.primaryKey).toBeUndefined();
  });

  it('omits keys and error limits that do not apply', () => {
    const r = buildImportRequest({ ...base, mode: 'append', onError: 'stop', limit: 20 });
    expect(r.keyColumns).toBeUndefined();
    expect(r.maxErrors).toBeUndefined();
    expect(r.limit).toBe(20);
  });

  it('builds a create request: append only, explicit types, PK not nullable', () => {
    const rows = defaultNewColumns([src('Id', 0, 'int'), src('Name', 1, 'text'), src('Skip me', 2)]);
    rows[1].sqlType = 'nvarchar(40)';
    rows[1].nullable = false;
    rows[2].include = false;
    const r = buildImportRequest({ ...base, target: { ...base.target, create: true }, newColumns: rows, primaryKey: ['Id'], mode: 'upsert', keyColumns: ['x'] });
    expect(r.mode).toBe('append');
    expect(r.keyColumns).toBeUndefined();
    expect(r.primaryKey).toEqual(['Id']);
    expect(r.columns).toEqual([
      { target: 'Id', from: { kind: 'source', index: 0 }, nullable: false, inferred: inf('int') },
      { target: 'Name', from: { kind: 'source', index: 1 }, sqlType: 'nvarchar(40)', nullable: false, inferred: inf('text') },
    ]);
  });
});

describe('progress and formatting', () => {
  it('parses the JSON progress message', () => {
    const p = parseProgress(JSON.stringify({ phase: 'importing', rows: 10, written: 8, skipped: 2, errors: 2, rate: 99.5, bytes: 50, totalBytes: 200 }));
    expect(p).toMatchObject({ phase: 'importing', rows: 10, written: 8, skipped: 2, rate: 99.5 });
    expect(progressPercent(p)).toBe(25);
    expect(parseProgress('not json')).toBeNull();
    expect(parseProgress(null)).toBeNull();
    expect(parseProgress('{"x":1}')).toBeNull();
    expect(progressPercent({ phase: 'preparing', rows: 0, written: 0, skipped: 0, errors: 0, rate: 0, bytes: 5, totalBytes: 0 })).toBeNull();
  });
  it('formats durations', () => {
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(12_000)).toBe('12 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
  });
});
