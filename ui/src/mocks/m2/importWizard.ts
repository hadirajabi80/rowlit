// Mock of the Import Wizard engine endpoints (docs: ui/src/components/ImportWizard/types.ts) for `npm run dev:mock`:
// a synthetic 240-row file for any path, a small table catalog, DDL, and a job that reports progress over the FakeSocket.
import { http, HttpResponse, type RequestHandler } from 'msw';
import type {
  DdlRequest, ImportCapabilities, ImportRequest, ImportSummary, PreviewRequest, PreviewResult, TargetTableInfo,
} from '../../components/ImportWizard/types';
import { M2_PREFIX, type M2MockContext } from './index';

const FIRST = ['Ann', 'Bob', 'Carla', 'Dara', 'علی', 'Mina', 'Omid', 'Sara'];
const ROWS = 240;

function fileRows(): (string | null)[][] {
  return Array.from({ length: ROWS }, (_, i) => [
    String(i + 1), FIRST[i % FIRST.length], `${FIRST[i % FIRST.length].toLowerCase()}${i}@example.com`, String(20 + (i % 40)),
    i % 7 === 0 ? null : (1000 + i * 3.25).toFixed(2), `2024-0${1 + (i % 9)}-${10 + (i % 18)}`,
  ]);
}

const COLUMNS: PreviewResult['columns'] = [
  { index: 0, name: 'id', inferred: { kind: 'int', nullable: false } },
  { index: 1, name: 'Name', inferred: { kind: 'text', length: 12, nullable: false } },
  { index: 2, name: 'email', inferred: { kind: 'text', length: 28, nullable: false } },
  { index: 3, name: 'age', inferred: { kind: 'int', nullable: false } },
  { index: 4, name: 'balance', inferred: { kind: 'decimal', precision: 8, scale: 2, nullable: true } },
  { index: 5, name: 'joined', inferred: { kind: 'date', nullable: false } },
];

function preview(req: PreviewRequest): PreviewResult {
  const all = fileRows();
  const offset = req.offset ?? 0;
  const max = req.maxRows ?? 100;
  const ext = /\.([a-z0-9]+)$/i.exec(req.path)?.[1]?.toLowerCase();
  const format = req.options?.format ?? (ext === 'xlsx' ? 'xlsx' : ext === 'tsv' ? 'tsv' : ext === 'json' ? 'json' : ext === 'ndjson' ? 'ndjson' : 'csv');
  return {
    path: req.path, fileName: req.path.split(/[\\/]/).pop() ?? req.path, fileSize: 18_400,
    options: { format, encoding: 'utf-8', delimiter: ',', quote: '"', hasHeader: true, ...req.options } as PreviewResult['options'],
    ...(format === 'xlsx' ? { sheets: ['Customers', 'Archive'] } : {}),
    columns: COLUMNS, rows: all.slice(offset, offset + max), sampledRows: ROWS, moreRows: false, offset, hasNextPage: offset + max < ROWS, warnings: [],
  };
}

const col = (name: string, type: string, kind: TargetTableInfo['columns'][number]['kind'], extra: Partial<TargetTableInfo['columns'][number]> = {}, ordinal = 1) =>
  ({ name, type, kind, nullable: true, isPk: false, isIdentity: false, isComputed: false, hasDefault: false, ordinal, ...extra });

function tableInfo(table: string): TargetTableInfo {
  if (!table) return { exists: false, columns: [], primaryKey: [], uniqueKeys: [] };
  return {
    exists: true,
    columns: [
      col('id', 'int', 'int', { nullable: false, isPk: true }, 1),
      col('name', 'nvarchar(50)', 'text', { nullable: false }, 2),
      col('email', 'nvarchar(100)', 'text', {}, 3),
      col('age', 'int', 'int', {}, 4),
      col('balance', 'decimal(10,2)', 'decimal', {}, 5),
      col('created_at', 'datetime2', 'datetime', { nullable: false, hasDefault: true }, 6),
    ],
    primaryKey: ['id'], uniqueKeys: [['id'], ['email']],
  };
}

const CAPS: ImportCapabilities = {
  providerId: 'sqlserver', dialect: 'tsql', canImport: true, readOnly: false, modes: ['append', 'truncateInsert', 'upsert', 'updateOnly'],
  canCreateTable: true, transactional: true, bulkMethod: 'SqlBulkCopy', defaultBatchSize: 1000, maxIdentifierLength: 128,
  sqlTypes: ['int', 'bigint', 'decimal(10,2)', 'nvarchar(50)', 'nvarchar(100)', 'nvarchar(max)', 'date', 'datetime2', 'bit', 'uniqueidentifier'],
};

const sqlTypeOf = (k: string, len?: number) =>
  k === 'int' ? 'int' : k === 'decimal' ? 'decimal(10,2)' : k === 'date' ? 'date' : k === 'text' ? `nvarchar(${Math.max(16, (len ?? 0) * 2)})` : 'nvarchar(max)';

export function createImportHandlers(ctx: M2MockContext): RequestHandler[] {
  const P = M2_PREFIX;
  return [
    http.post(`${P}/import/preview`, async ({ request }) => ctx.ok(preview((await request.json()) as PreviewRequest) as never)),
    http.get(`${P}/connections/:cid/import/capabilities`, () => ctx.ok(CAPS as never)),
    http.post(`${P}/connections/:cid/import/table-info`, async ({ request }) => {
      const t = (await request.json()) as { table: string };
      return ctx.ok(tableInfo(t.table) as never); // any named table exists in the mock
    }),
    http.post(`${P}/connections/:cid/import/ddl`, async ({ request }) => {
      const r = (await request.json()) as DdlRequest;
      const cols = r.columns.map((c) => ({ name: c.name, sqlType: c.sqlType ?? sqlTypeOf(c.inferred?.kind ?? 'text', c.inferred?.length) }));
      const lines = cols.map((c) => `  [${c.name}] ${c.sqlType}${r.primaryKey?.includes(c.name) ? ' NOT NULL' : ' NULL'}`);
      if (r.primaryKey?.length) lines.push(`  CONSTRAINT [PK_${r.table}] PRIMARY KEY (${r.primaryKey.map((k) => `[${k}]`).join(', ')})`);
      return ctx.ok({ ddl: `CREATE TABLE [${r.schema ?? 'dbo'}].[${r.table}] (\n${lines.join(',\n')}\n);`, columns: cols, warnings: [] } as never);
    }),
    http.post(`${P}/connections/:cid/import/start`, async ({ request }) => {
      const req = (await request.json()) as ImportRequest;
      const jobId = ctx.jobs.start('import.run', async (report, signal) => {
        const total = 18_400;
        const message = (phase: string, step: number) => {
          const rows = Math.round((ROWS * step) / 10);
          return JSON.stringify({
            phase, rows, written: Math.max(0, rows - 3), skipped: step > 5 ? 3 : 0, errors: step > 5 ? 3 : 0, rate: 1800 + step * 40,
            bytes: Math.round((total * step) / 10), totalBytes: total,
          });
        };
        report(0, null, message('preparing', 0));
        for (let step = 1; step <= 10; step++) {
          await new Promise((r) => setTimeout(r, 700));
          if (signal.aborted) return null;
          report(Math.round((ROWS * step) / 10), null, message(step === 10 ? 'committing' : 'importing', step));
        }
        const summary: ImportSummary = {
          outcome: 'completedWithErrors', rowsRead: ROWS, rowsWritten: ROWS - 3, rowsSkipped: 3, errorCount: 3, elapsedMs: 7300, rowsPerSecond: 1800,
          committed: true, rolledBack: false,
          ...(req.target.create ? { createdTable: `[${req.target.schema ?? 'dbo'}].[${req.target.table}]`, ddl: `CREATE TABLE [${req.target.schema ?? 'dbo'}].[${req.target.table}] ([id] int NOT NULL);` } : {}),
          loadMethod: 'SqlBulkCopy', hasErrorReport: true,
          errorsSample: [
            { row: 17, column: 'age', message: 'Cannot convert "n/a" to int.', values: ['17', 'Mina', 'mina16@example.com', 'n/a'] },
            { row: 88, column: 'email', message: 'Duplicate key value violates unique index.', values: ['88', 'Ann', 'ann87@example.com', '27'] },
            { row: 131, column: 'balance', message: 'Value out of range for decimal(8,2).', values: ['131', 'Omid', 'omid130@example.com', '31', '99999999.99'] },
          ],
        };
        return summary;
      });
      return ctx.ok({ jobId } as never, { status: 202 });
    }),
    http.get(`${P}/import/errors/:jobId`, () =>
      new HttpResponse('﻿row,column,error\n17,age,"Cannot convert ""n/a"" to int."\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })),
  ];
}
