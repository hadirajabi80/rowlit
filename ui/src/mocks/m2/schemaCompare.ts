// Mock of the Schema compare endpoints (engine SchemaCompareModule; contracts in api/types.schemaCompare.ts) for
// `npm run dev:mock`: every relational connection is supported, a comparison reports progress over the FakeSocket and
// ends with a fixed set of differences; scripts and the apply work on that set.
import { http, HttpResponse, type RequestHandler } from 'msw';
import type {
  CompareApplyRequest, CompareItem, CompareItemDetail, CompareRequest, CompareResult, CompareScript, ScriptStatement,
} from '../../api/types.schemaCompare';
import { M2_PREFIX, type M2MockContext } from './index';

const ITEMS: (CompareItem & { src: string | null; tgt: string | null; sql: string[] })[] = [
  {
    id: 'table:Customers', kind: 'table', name: 'Customers', status: 'alter', changes: ['Column Email: type nvarchar(100) → nvarchar(200)', 'Column Phone added (nvarchar(30))'],
    warnings: [], src: 'CREATE TABLE [dbo].[Customers] (\n  [Id] int NOT NULL,\n  [Email] nvarchar(200) NULL,\n  [Phone] nvarchar(30) NULL\n);',
    tgt: 'CREATE TABLE [dbo].[Customers] (\n  [Id] int NOT NULL,\n  [Email] nvarchar(100) NULL\n);',
    sql: ['ALTER TABLE [dbo].[Customers] ALTER COLUMN [Email] nvarchar(200) NULL', 'ALTER TABLE [dbo].[Customers] ADD [Phone] nvarchar(30) NULL'],
  },
  {
    id: 'table:LegacyAudit', kind: 'table', name: 'LegacyAudit', status: 'drop', changes: ['Table only exists in the target'],
    warnings: [{ severity: 'dataLoss', message: 'Dropping table LegacyAudit deletes all of its rows.' }],
    src: null, tgt: 'CREATE TABLE [dbo].[LegacyAudit] ([Id] int NOT NULL);', sql: ['DROP TABLE [dbo].[LegacyAudit]'],
  },
  {
    id: 'table:Reviews', kind: 'table', name: 'Reviews', status: 'create', changes: ['New table with 3 columns'], warnings: [],
    src: 'CREATE TABLE [dbo].[Reviews] ([Id] int NOT NULL, [CustomerId] int NOT NULL, [Body] nvarchar(max) NULL);', tgt: null,
    sql: ['CREATE TABLE [dbo].[Reviews] ([Id] int NOT NULL, [CustomerId] int NOT NULL, [Body] nvarchar(max) NULL)'],
  },
  { id: 'table:Orders', kind: 'table', name: 'Orders', status: 'identical', changes: [], warnings: [], src: 'CREATE TABLE [dbo].[Orders] ([Id] int NOT NULL);', tgt: 'CREATE TABLE [dbo].[Orders] ([Id] int NOT NULL);', sql: [] },
  {
    id: 'view:CustomerOrders', kind: 'view', name: 'CustomerOrders', status: 'alter', changes: ['View query differs'], warnings: [],
    src: 'CREATE VIEW [dbo].[CustomerOrders] AS\nSELECT c.Id, COUNT(o.Id) AS Orders FROM dbo.Customers c LEFT JOIN dbo.Orders o ON o.CustomerId = c.Id GROUP BY c.Id;',
    tgt: 'CREATE VIEW [dbo].[CustomerOrders] AS\nSELECT c.Id FROM dbo.Customers c;',
    sql: ['CREATE OR ALTER VIEW [dbo].[CustomerOrders] AS\nSELECT c.Id, COUNT(o.Id) AS Orders FROM dbo.Customers c LEFT JOIN dbo.Orders o ON o.CustomerId = c.Id GROUP BY c.Id'],
  },
  {
    id: 'proc:usp_Touch', kind: 'proc', name: 'usp_Touch', status: 'alter', changes: ['Definition differs'], warnings: [],
    src: 'CREATE PROCEDURE dbo.usp_Touch @Id int AS UPDATE dbo.Orders SET Id = Id WHERE Id = @Id;', tgt: 'CREATE PROCEDURE dbo.usp_Touch @Id int AS SELECT 1;',
    sql: ['CREATE OR ALTER PROCEDURE dbo.usp_Touch @Id int AS UPDATE dbo.Orders SET Id = Id WHERE Id = @Id'],
  },
];

const wire = ({ src: _s, tgt: _t, sql: _q, ...item }: (typeof ITEMS)[number]): CompareItem => item;

function statements(ids: string[] | null): ScriptStatement[] {
  return ITEMS.filter((i) => i.status !== 'identical' && (!ids || ids.includes(i.id)))
    .flatMap((i) => i.sql.map((sql) => ({ sql, kind: i.status, itemId: i.id, warning: i.status === 'drop' ? i.warnings[0]?.message ?? null : null })));
}

function script(ids: string[] | null): CompareScript {
  const st = statements(ids);
  const items = ITEMS.filter((i) => i.status !== 'identical' && (!ids || ids.includes(i.id)));
  const text = `-- Rowlit schema synchronization (mock)\n\n${st.map((s) => `${s.warning ? `-- WARNING: ${s.warning}\n` : ''}${s.sql}\nGO`).join('\n\n')}\n`;
  return {
    statements: st, text, transactionalDdl: true, itemCount: items.length,
    warnings: items.flatMap((i) => i.warnings.map((w) => ({ itemId: i.id, ...w }))),
  };
}

export function createSchemaCompareHandlers(ctx: M2MockContext): RequestHandler[] {
  const P = `${M2_PREFIX}/schema-compare`;
  return [
    http.get(`${P}/support`, ({ request }) => {
      const cid = new URL(request.url).searchParams.get('connectionId') ?? '';
      return ctx.ok({ supported: true, providerId: cid, dialect: 'tsql', schemaIsDatabase: false, readOnly: false, reason: null } as never);
    }),
    http.post(P, async ({ request }) => {
      const req = (await request.json()) as CompareRequest;
      const jobId = ctx.jobs.start('schema.compare', async (report, signal) => {
        const names = ITEMS.map((i) => i.name);
        for (let k = 0; k < names.length * 2; k++) {
          await new Promise((r) => setTimeout(r, 150));
          if (signal.aborted) return null;
          report(k + 1, names.length * 2, names[k % names.length]);
        }
        const items = ITEMS.map(wire);
        const result: CompareResult = {
          compareId: `cmp_${Date.now().toString(36)}`, providerId: 'sqlserver', dialect: 'tsql',
          sourceLabel: `${req.source.connectionId} › ${req.source.schema ?? 'dbo'}`, targetLabel: `${req.target.connectionId} › ${req.target.schema ?? 'dbo'}`,
          sourceSchema: req.source.schema ?? 'dbo', targetSchema: req.target.schema ?? 'dbo', items,
          counts: {
            create: items.filter((i) => i.status === 'create').length, drop: items.filter((i) => i.status === 'drop').length,
            alter: items.filter((i) => i.status === 'alter').length, identical: items.filter((i) => i.status === 'identical').length,
          },
          notes: ['Not compared in dbo: synonyms.'], transactionalDdl: true, elapsedMs: 1800,
        };
        return result;
      });
      return ctx.ok({ jobId } as never, { status: 202 });
    }),
    http.get(`${P}/:id/item`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('item');
      const it = ITEMS.find((i) => i.id === id) ?? ITEMS[0];
      const detail: CompareItemDetail = { item: wire(it), sourceDdl: it.src, targetDdl: it.tgt, statements: statements([it.id]) };
      return ctx.ok(detail as never);
    }),
    http.post(`${P}/:id/script`, async ({ request }) => {
      const body = (await request.json()) as { itemIds?: string[] | null };
      return ctx.ok(script(body.itemIds ?? null) as never);
    }),
    http.post(`${P}/:id/apply`, async ({ request }) => {
      const body = (await request.json()) as CompareApplyRequest;
      const n = statements(body.itemIds).length;
      return ctx.ok({ ok: true, executed: n, total: n, rolledBack: false, transactionalDdl: true, elapsedMs: 120, failures: [] } as never);
    }),
    http.delete(`${P}/:id`, () => new HttpResponse(null, { status: 204 })),
  ];
}
