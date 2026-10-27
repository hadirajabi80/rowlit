// Linked databases mock pack (plan-links WP-C): the 'linked' provider entry, a sample link over three mock connections,
// and everything `npm run dev:mock` / the component tests need to use it end to end:
//
// - Catalog: a link's schemas are its member aliases (plus the empty `views` schema whose "Queries" folder holds the
//   linked views); each mounted table is the member's own fixture table, with DuckDB column types (engine TypeMap).
//   Done by patching the MockEngine instance (`schemasFor`, `defaultSchema`, `databases`) when the handlers are built.
// - Execution: statements of a link session run on a small in-memory SQL evaluator (the "DuckDB" of the mock) over the
//   members' rows, which are read through the engine's own interpreter on the member connection (so a link shows the
//   same rows as the member's console). `$name` binds are inlined first. Enough SQL for everything the builder
//   compiles (components/Links/builder/compile.ts) and typical hand-written queries: joins (hash joins on
//   equalities), WHERE, GROUP BY / HAVING with count / sum / avg / min / max, ORDER BY (alias, ordinal, expression),
//   DISTINCT, LIMIT / OFFSET, scalar functions, CASE, CAST.
// - REST: the /links routes of engine/src/DbStudio.Federation/Contracts/LinkApi.cs (client: api/links.ts): engine,
//   validate, catalog, compile (the UI compiler), parse (canonical builder SQL → BuilderModel), plan (a believable
//   push-down plan), linked views (mirrored into the saved queries of the link, schema `views`), refresh-sources.
//   Materialize and native scripts answer 501 (WP-D's).
import { http, HttpResponse, type RequestHandler } from 'msw';
import {
  isValidAlias, isValidTableName, isWideScope, linkDefinitionOf, linkTableName, LINK_SCOPES, memberScopeOf, RESERVED_ALIASES, LINK_VIEWS_SCHEMA,
  type LinkBrowseRequest, type LinkBrowseResult, type LinkLevel, type LinkResolveRequest, type LinkResolveResult, type LinkScope, type LinkTableRef,
  type BuilderAggregate, type BuilderColumn, type BuilderJoin, type BuilderJoinCondition, type BuilderJoinType, type BuilderModel, type BuilderRef,
  type BuilderSort, type BuilderTable, type CompileRequest, type CompileResult, type LinkCatalog, type LinkCatalogSchema, type LinkDefinition,
  type LinkedView, type LinkedViewInput, type LinkMember, type LinkMemberStatus, type LinkProblem, type LinkValidateRequest, type ParseResult,
  type PlanRequest, type PlanWarning, type PushdownOp, type PushdownPlan, type PushdownPredicate, type SourceFetchPlan, type SourceTable,
  type VirtualRelation,
} from '../../api/links';
import type { CatalogObject, CellValue, ColumnInfo, ColumnKind, ConnectionProfile, Dialect, ProviderInfo, QueryParam } from '../../api/types';
import { compileBuilder, type BuilderCatalog, type BuilderPaths } from '../../components/Links/builder/compile';
import type { FilterCondition, FilterGroup, FilterNode, FilterOp, FilterValue } from '../../filter/model';
import { inlineParams } from '../../filter/sql';
import { quoteIdent } from '../../lib/sql';
import type { MockEngine } from '../engine';
import type { FixtureTable } from '../fixtures';
import { M2_PREFIX, type M2MockContext } from '../m2';
import { savedQueryStore } from '../savedQueries';
import { PACK_NOW, type MockProviderPack } from './types';

// ---------------------------------------------------------------- provider + sample link

export const LINKED_PROVIDER: ProviderInfo = { id: 'linked', displayName: 'Linked database', dialect: 'duckdb', kind: 'relational', formSpec: { fields: [] } };

const SAMPLE_RELATIONS: VirtualRelation[] = [
  { id: 'r1', name: 'Orders → CRM customers', from: { alias: 'shop', table: 'orders' }, fromColumns: ['customer_id'], to: { alias: 'crm', table: 'customers' }, toColumns: ['id'] },
  { id: 'r2', name: 'Order lines → ERP products', from: { alias: 'shop', table: 'order_lines' }, fromColumns: ['product_id'], to: { alias: 'erp', table: 'products' }, toColumns: ['id'] },
];

/** Sample link (folder "Linked databases") over the mock PostgreSQL CRM, the SQLite shop and the SQL Server ERP. */
export const linkedConnections: ConnectionProfile[] = [
  { id: 'c_link', name: 'Sales (linked)', providerId: 'linked', color: '#7c3aed', folder: 'Linked databases', readOnly: true,
    props: {
      linkVersion: 1,
      members: [
        { alias: 'crm', kind: 'connection', connectionId: 'c_pg', database: 'shop', schema: 'public', allTables: false,
          tables: [{ name: 'customers', type: 'table' }, { name: 'countries', type: 'table' }], label: 'CRM (PostgreSQL)' },
        { alias: 'shop', kind: 'connection', connectionId: 'c_shop', database: null, schema: 'main', allTables: false,
          tables: [{ name: 'orders', type: 'table' }, { name: 'order_lines', type: 'table' }], label: 'Web shop (SQLite)' },
        { alias: 'erp', kind: 'connection', connectionId: 'c_prod', database: 'Shop', schema: 'dbo', allTables: false,
          tables: [{ name: 'products', type: 'table' }], label: 'ERP (SQL Server)' },
      ],
      relations: SAMPLE_RELATIONS,
      options: {},
    },
    hasPassword: false, savePassword: false, createdAt: PACK_NOW, lastUsedAt: null },
];

// ---------------------------------------------------------------- engine internals (TS-private, reached by casting)

interface SchemaStateLike {
  name: string;
  version: number;
  objects: CatalogObject[];
  tables: Map<string, FixtureTable>;
}
interface EngineInternals {
  schemasFor(cid: string): Map<string, SchemaStateLike>;
  catalogs: Map<string, Map<string, SchemaStateLike>>;
}
type Session = Parameters<MockEngine['interpret']>[0];
type Interpreted = ReturnType<MockEngine['interpret']>;

const isLinkConn = (c: ConnectionProfile | null | undefined): boolean => c?.providerId === 'linked';
const lc = (s: string) => s.toLowerCase();

/** DuckDB type of a source column (engine Pushdown/TypeMap.cs, coarse). */
export function duckType(kind: ColumnKind, native: string): string {
  switch (kind) {
    case 'int': return 'BIGINT';
    case 'float': return 'DOUBLE';
    case 'decimal': {
      const m = /\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(native);
      return `DECIMAL(38,${m ? m[1] : '2'})`;
    }
    case 'bool': return 'BOOLEAN';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    case 'datetime': return 'TIMESTAMP';
    case 'datetimeoffset': return 'TIMESTAMPTZ';
    case 'guid': return 'UUID';
    case 'binary': return 'BLOB';
    case 'json': return 'JSON';
    default: return 'VARCHAR';
  }
}

/** A table mounted in a link: where it comes from and what it looks like. */
export interface Mounted {
  alias: string;
  member: LinkMember;
  memberIndex: number;
  connectionId: string;
  providerId: string;
  dialect: Dialect;
  /** Database the table is read from (the member's; a wide member's container database). */
  database: string | null;
  schema: string;
  /** Source table name (catalog spelling). */
  source: string;
  /** Engine name (wide members' nested tables: "sales.orders"). */
  linkName: string;
  /** Wide members' nested tables: the name parts queries write below the alias; null otherwise. */
  path: string[] | null;
  fixture: FixtureTable;
  object: CatalogObject;
  columns: { name: string; nativeType: string; kind: ColumnKind; type: string; nullable: boolean; pk: boolean }[];
}

interface CacheEntry { rows: CellValue[][]; fetchedAt: string; ms: number }

interface PackState {
  engine: MockEngine;
  base: MockEngine['interpret'];
  /** Per link: fetched sources ("alias.table" → rows), dropped by /refresh-sources. */
  cache: Map<string, Map<string, CacheEntry>>;
  views: Map<string, LinkedView[]>;
}

const STATES = new WeakMap<MockEngine, PackState>();

function dialectOfProvider(engine: MockEngine, providerId: string): Dialect {
  const p = engine.providers().find((x) => x.id === providerId);
  return (p?.dialect ?? 'sqlite') as Dialect;
}

// ---------------------------------------------------------------- wide members (scopes database / connection)

/** Name levels a wide member spans (Runtime/MemberScopes.cs twin); null for tables / schema members. */
export function levelsOf(providerId: string | null | undefined, scope: LinkScope): LinkLevel[] | null {
  if (!isWideScope(scope)) return null;
  switch (providerId) {
    case 'sqlserver': case 'postgresql': case 'snowflake': return scope === 'database' ? ['schema'] : ['database', 'schema'];
    case 'mysql': case 'mariadb': case 'clickhouse': case 'cassandra': case 'mongodb': return scope === 'database' ? [] : ['schema'];
    case 'elasticsearch': return [];
    default: return ['schema']; // oracle, sqlite (main + attached files), unknown
  }
}

/** A wide member's shape: its levels and default container (database / schema). */
interface WideInfo {
  member: LinkMember;
  memberIndex: number;
  conn: ConnectionProfile;
  levels: LinkLevel[];
  /** One name per level. */
  defaultPath: string[];
  defaultDatabase: string | null;
  defaultSchema: string;
}

function wideInfo(engine: MockEngine, m: LinkMember, memberIndex: number): WideInfo | null {
  if (m.kind === 'files' || !m.connectionId) return null;
  const scope = memberScopeOf(m);
  if (!isWideScope(scope)) return null;
  const conn = engine.conn(m.connectionId);
  if (!conn || isLinkConn(conn)) return null;
  const levels = levelsOf(conn.providerId, scope) ?? [];
  const current = engine.databases(conn.id).current ?? null;
  const defaultDatabase = levels[0] === 'database' || scope === 'connection' ? current : m.database ?? current;
  // "whole database" of a provider without levels (MySQL…) is the member's schema
  const defaultSchema = !levels.length ? m.schema ?? m.database ?? engine.defaultSchema(conn.id) : engine.defaultSchema(conn.id);
  const defaultPath = levels.map((l) => (l === 'database' ? defaultDatabase ?? '' : defaultSchema));
  return { member: m, memberIndex, conn, levels, defaultPath, defaultDatabase, defaultSchema };
}

const SYSTEM_DATABASES = new Set(['master', 'model', 'msdb', 'tempdb']);

/** The children of a level: databases, or the schemas of `database`. */
function containersOf(engine: MockEngine, w: WideInfo, level: LinkLevel, database: string | null): string[] {
  if (level === 'database') return engine.databases(w.conn.id).databases.filter((d) => !SYSTEM_DATABASES.has(lc(d)));
  return engine.schemas(w.conn.id, database ?? w.defaultDatabase).schemas.map((s) => s.name);
}

/** The container of a full path: database (null when the provider has no database level) + schema. */
function containerOf(w: WideInfo, path: readonly string[]): { database: string | null; schema: string } {
  const db = w.levels[0] === 'database' ? path[0] : w.defaultDatabase;
  const schema = w.levels.length ? path[w.levels.length - 1] : w.defaultSchema;
  return { database: db ?? null, schema };
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => lc(a ?? '') === lc(b ?? '');

/**
 * Engine name + query path of a table in container `path` (one name per level): the default database / schema prefix is
 * left out, so the default container's tables keep plain names (path null).
 */
function nestedName(w: WideInfo, path: readonly string[], table: string): { linkName: string; path: string[] | null } {
  let start = 0;
  while (start < w.levels.length && sameName(path[start], w.defaultPath[start])) start++;
  // a prefix is left out only from the top: `shop.sales.orders` → `sales.orders`; a non-default database keeps its schema
  if (start < w.levels.length) {
    const parts = [...path.slice(start), table];
    return { linkName: parts.join('.'), path: parts };
  }
  return { linkName: table, path: null };
}

/** The container + table an engine (or natural) name below the alias stands for, or null. */
function splitNested(w: WideInfo, parts: readonly string[]): { path: string[]; table: string } | null {
  const n = w.levels.length;
  if (!parts.length || parts.length > n + 1) return null;
  const full = [...w.defaultPath.slice(0, n + 1 - parts.length), ...parts];
  return { path: full.slice(0, n), table: full[n] };
}

function schemaState(engine: MockEngine, connId: string, schema: string): SchemaStateLike | undefined {
  const states = (engine as unknown as EngineInternals).schemasFor(connId);
  return states.get(schema) ?? [...states.values()].find((s) => lc(s.name) === lc(schema));
}

/** One mounted table (null when the source has no such table). */
function mountOne(engine: MockEngine, m: LinkMember, memberIndex: number, conn: ConnectionProfile, st: SchemaStateLike, name: string,
  linkName: string | null, database: string | null, path: string[] | null): Mounted | null {
  const fixture = st.tables.get(lc(name));
  const object = st.objects.find((o) => lc(o.n) === lc(name) && (o.t === 'table' || o.t === 'view'));
  if (!fixture || !object) return null;
  const columns = fixture.columns.map((c, i) => {
    const tuple = object.c?.[i];
    const nativeType = tuple?.[1] ?? c.type;
    return { name: tuple?.[0] ?? c.name, nativeType, kind: c.kind, type: duckType(c.kind, nativeType), nullable: c.nullable, pk: !!c.pk };
  });
  return {
    alias: m.alias, member: m, memberIndex, connectionId: conn.id, providerId: conn.providerId, dialect: dialectOfProvider(engine, conn.providerId),
    database, schema: st.name, source: object.n, linkName: linkName ?? object.n, path, fixture, object, columns,
  };
}

/** Tables of one container of a wide member (default container: plain names, renames applied). */
function containerTables(engine: MockEngine, w: WideInfo, path: readonly string[]): Mounted[] | null {
  const { database, schema } = containerOf(w, path);
  const st = schemaState(engine, w.conn.id, schema);
  if (!st) return null;
  const renames = new Map(w.member.tables.map((t) => [lc(t.name), t]));
  const out: Mounted[] = [];
  for (const t of st.tables.values()) {
    const n = nestedName(w, path, t.name);
    const mt = n.path ? undefined : renames.get(lc(t.name));
    const one = mountOne(engine, w.member, w.memberIndex, w.conn, st, t.name, mt ? linkTableName(mt) : n.path ? n.linkName : null, database, n.path);
    if (one) out.push(one);
  }
  return out;
}

/** A nested table of a wide member by engine name ("sales.orders") or natural parts, or null. */
function nestedTable(engine: MockEngine, link: ConnectionProfile, alias: string, name: string): Mounted | null {
  const def = linkDefinitionOf(link);
  const i = def.members.findIndex((m) => lc(m.alias) === lc(alias));
  const w = i >= 0 ? wideInfo(engine, def.members[i], i) : null;
  if (!w) return null;
  const split = splitNested(w, name.split('.'));
  if (!split) return null;
  return containerTables(engine, w, split.path)?.find((t) => lc(t.source) === lc(split.table) || (!t.path && lc(t.linkName) === lc(split.table))) ?? null;
}

/** Every table a link mounts (unknown members / tables are skipped; validate reports them). Wide members: the default container. */
export function mountedTables(engine: MockEngine, link: ConnectionProfile): Mounted[] {
  const def = linkDefinitionOf(link);
  const out: Mounted[] = [];
  def.members.forEach((m, memberIndex) => {
    if (!m.connectionId) return;
    const conn = engine.conn(m.connectionId);
    if (!conn || isLinkConn(conn)) return;
    const scope = memberScopeOf(m);
    const w = wideInfo(engine, m, memberIndex);
    if (w) {
      out.push(...(containerTables(engine, w, w.defaultPath) ?? []));
      return;
    }
    const st = schemaState(engine, conn.id, m.schema ?? engine.defaultSchema(conn.id));
    if (!st) return;
    const renames = new Map(m.tables.map((t) => [lc(t.name), t]));
    const wanted = scope !== 'tables' ? [...st.tables.values()].map((t) => t.name) : m.tables.map((t) => t.name);
    for (const name of wanted) {
      const mt = renames.get(lc(name));
      const one = mountOne(engine, m, memberIndex, conn, st, name, mt ? linkTableName(mt) : null, m.database ?? null, null);
      if (one) out.push(one);
    }
  });
  return out;
}

/** A mounted table as the link catalog / browse / resolve answer it. */
function sourceTableOf(t: Mounted): SourceTable {
  return {
    name: t.source, linkName: t.linkName, database: t.database, schema: t.schema, type: t.fixture.kind,
    columns: t.columns.map((c) => ({ name: c.name, sourceType: c.nativeType, kind: c.kind, nullable: c.nullable, isPk: c.pk })),
    primaryKey: t.columns.filter((c) => c.pk).map((c) => c.name),
    foreignKeys: (t.object.fk ?? []).map((fk) => ({ name: fk.n, columns: fk.cols, refSchema: fk.rs, refTable: fk.rt, refColumns: fk.rcols })),
    rowEstimate: t.fixture.rowCount, comment: t.object.cm ?? null,
    ...(t.path ? { path: t.path } : {}),
  };
}

/** POST /links/{cid}/browse (throws a {status, code, message} for the handler). */
export function browseLink(engine: MockEngine, link: ConnectionProfile, req: LinkBrowseRequest): LinkBrowseResult {
  const def = linkDefinitionOf(link);
  const i = def.members.findIndex((m) => lc(m.alias) === lc(req.alias ?? ''));
  if (i < 0) throw { status: 404, code: 'NOT_FOUND', message: `The link has no source '${req.alias}'.` };
  const path = req.path ?? [];
  const m = def.members[i];
  const w = wideInfo(engine, m, i);
  const alias = m.alias;
  if (!w || !w.levels.length) {
    if (path.length) throw { status: 400, code: 'VALIDATION', message: `${alias} has no levels to browse.` };
    return { alias, path: [], level: null, children: [], tables: mountedTables(engine, link).filter((t) => t.alias === alias).map(sourceTableOf), warnings: [] };
  }
  if (path.length > w.levels.length) throw { status: 400, code: 'VALIDATION', message: `${alias} has ${w.levels.length} level(s) below the alias.` };
  // every name of the path must exist
  for (let k = 0; k < path.length; k++) {
    const names = containersOf(engine, w, w.levels[k], w.levels[0] === 'database' && k > 0 ? path[0] : null);
    if (!names.some((n) => sameName(n, path[k]))) throw { status: 404, code: 'NOT_FOUND', message: `${w.levels[k] === 'database' ? 'Database' : 'Schema'} '${path[k]}' was not found in ${w.conn.name}.` };
  }
  if (path.length < w.levels.length) {
    const level = w.levels[path.length];
    const names = containersOf(engine, w, level, w.levels[0] === 'database' && path.length > 0 ? path[0] : null);
    const onDefault = path.every((p, k) => sameName(p, w.defaultPath[k]));
    return {
      alias, path: [...path], level,
      children: names.map((name) => ({ name, isDefault: onDefault && sameName(name, w.defaultPath[path.length]) })),
      tables: [], warnings: [],
    };
  }
  return { alias, path: [...path], level: null, children: [], tables: (containerTables(engine, w, path) ?? []).map(sourceTableOf), warnings: [] };
}

/** POST /links/{cid}/resolve. */
export function resolveLinkTables(engine: MockEngine, link: ConnectionProfile, req: LinkResolveRequest): LinkResolveResult {
  const mounted = mountedTables(engine, link);
  const tables: LinkResolveResult['tables'] = [];
  const missing: LinkTableRef[] = [];
  for (const ref of req.tables ?? []) {
    const t = mounted.find((x) => lc(x.alias) === lc(ref.alias) && lc(x.linkName) === lc(ref.table)) ?? nestedTable(engine, link, ref.alias, ref.table);
    if (t) tables.push({ alias: t.alias, table: sourceTableOf(t) });
    else missing.push(ref);
  }
  return { tables, missing };
}

/** The catalog + natural-name paths the compiler needs for a model (the nested tables it names included). */
export function compileCatalogFor(engine: MockEngine, link: ConnectionProfile, model: BuilderModel | null | undefined): { catalog: BuilderCatalog; paths: BuilderPaths } {
  const catalog = builderCatalogOf(linkCatalog(engine, link));
  const paths: BuilderPaths = {};
  for (const t of model?.tables ?? []) {
    const key = `${t.alias}.${t.table}`;
    if (catalog[key]) continue;
    const n = nestedTable(engine, link, t.alias, t.table);
    if (!n) continue;
    catalog[key] = n.columns.map((c) => ({ name: c.name, kind: c.kind, dbType: c.type }));
    if (n.path) paths[key] = n.path;
  }
  return { catalog, paths };
}

/** The link's explorer catalog: one schema per alias (+ `views`). */
function linkSchemas(engine: MockEngine, link: ConnectionProfile): Map<string, SchemaStateLike> {
  const mounted = mountedTables(engine, link);
  const def = linkDefinitionOf(link);
  const m = new Map<string, SchemaStateLike>();
  for (const mem of def.members) {
    const own = mounted.filter((t) => t.alias === mem.alias);
    const objects: CatalogObject[] = own.map((t) => {
      const fks = (t.object.fk ?? []).map((fk) => {
        const ref = own.find((o) => lc(o.source) === lc(fk.rt));
        return ref ? { n: fk.n, cols: fk.cols, rs: mem.alias, rt: ref.linkName, rcols: fk.rcols } : null;
      }).filter((x): x is NonNullable<typeof x> => !!x);
      return {
        t: t.fixture.kind, n: t.linkName, cm: t.object.cm ?? null,
        c: t.columns.map((c) => [c.name, c.type, c.nullable ? 1 : 0, c.pk ? 1 : 0, 0, null]),
        pk: t.columns.filter((c) => c.pk).map((c) => c.name), fk: fks.length ? fks : undefined,
      };
    });
    m.set(mem.alias, { name: mem.alias, version: 1, objects, tables: new Map(own.map((t) => [lc(t.linkName), t.fixture])) });
  }
  m.set(LINK_VIEWS_SCHEMA, { name: LINK_VIEWS_SCHEMA, version: 1, objects: [], tables: new Map() });
  return m;
}

/** GET /links/{cid}/catalog. */
export function linkCatalog(engine: MockEngine, link: ConnectionProfile): LinkCatalog {
  const def = linkDefinitionOf(link);
  const mounted = mountedTables(engine, link);
  const schemas: LinkCatalogSchema[] = def.members.map((mem, i) => {
    const conn = mem.connectionId ? engine.conn(mem.connectionId) : undefined;
    const own = mounted.filter((t) => t.alias === mem.alias);
    const scope = memberScopeOf(mem);
    const warnings = scope !== 'tables' ? [] : mem.tables.filter((t) => !own.some((o) => lc(o.source) === lc(t.name))).map((t) => `${t.name} was not found in ${conn?.name ?? 'the source'}.`);
    const w = wideInfo(engine, mem, i);
    return {
      alias: mem.alias, kind: mem.kind ?? 'connection', connectionId: mem.connectionId ?? null, providerId: conn?.providerId ?? null,
      tables: own.map(sourceTableOf), warnings,
      error: !conn ? 'The connection of this source no longer exists.' : null,
      ...(isWideScope(scope) && mem.kind !== 'files' ? { scope, levels: w?.levels ?? [], defaultPath: w?.defaultPath ?? [] } : {}),
    };
  });
  return { schemas, relations: def.relations };
}

export function builderCatalogOf(cat: LinkCatalog): BuilderCatalog {
  const out: BuilderCatalog = {};
  for (const s of cat.schemas) {
    for (const t of s.tables) out[`${s.alias}.${t.linkName}`] = t.columns.map((c) => ({ name: c.name, kind: c.kind as ColumnKind, dbType: duckType(c.kind as ColumnKind, c.sourceType) }));
  }
  return out;
}

// ---------------------------------------------------------------- source rows

function fakeSession(engine: MockEngine, t: Mounted): Session {
  const conn = engine.conn(t.connectionId)!;
  return {
    sessionId: `link_fetch_${t.connectionId}`, connectionId: t.connectionId, serverInfo: engine.serverInfo(conn.providerId, conn.props),
    database: t.database, txMode: 'auto', txOpen: false, state: 'idle', dialect: t.dialect, cancel: false, lastResults: null,
  } as unknown as Session;
}

const NUMERIC = new Set<ColumnKind>(['int', 'float', 'decimal']);

/** The member's rows of a mounted table, read through the engine's interpreter on the member connection. */
function readSource(state: PackState, t: Mounted): CellValue[][] {
  const sql = `SELECT * FROM ${quoteIdent(t.schema, t.dialect)}.${quoteIdent(t.source, t.dialect)}`;
  const r = state.base(fakeSession(state.engine, t), sql);
  if (r.error || !r.sets[0]) throw new SqlError(`IO Error: could not read ${t.alias}.${t.linkName} from ${state.engine.conn(t.connectionId)?.name ?? 'its source'}: ${r.error ?? 'no rows'}`);
  const numeric = t.columns.map((c) => NUMERIC.has(c.kind));
  return r.sets[0].rows.map((row) => row.map((v, i) => (numeric[i] && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v)));
}

function cacheOf(state: PackState, linkId: string): Map<string, CacheEntry> {
  let c = state.cache.get(linkId);
  if (!c) state.cache.set(linkId, (c = new Map()));
  return c;
}

/** Rows of a mounted table from the link's source cache, fetched on first use (`fetched` reports a new fetch). */
function sourceRows(state: PackState, linkId: string, t: Mounted, fetched?: (t: Mounted, rows: number, ms: number) => void): CellValue[][] {
  const cache = cacheOf(state, linkId);
  const key = `${t.alias}.${t.linkName}`;
  const hit = cache.get(key);
  if (hit) return hit.rows;
  const t0 = performance.now();
  const rows = readSource(state, t);
  const ms = Math.round(performance.now() - t0);
  cache.set(key, { rows, fetchedAt: new Date().toISOString(), ms });
  fetched?.(t, rows.length, ms);
  return rows;
}

// ---------------------------------------------------------------- SQL: lexer + parser

class SqlError extends Error {}
const parserError = (m: string) => new SqlError(`Parser Error: ${m}`);
const binderError = (m: string) => new SqlError(`Binder Error: ${m}`);
/** SQL the mock evaluator does not implement (the real engine would run it). */
const unsupported = (what: string) => new SqlError(`Not implemented Error: ${what} is not supported by the mock engine (the real DuckDB runs it).`);

interface Tok { t: 'id' | 'qid' | 'str' | 'num' | 'param' | 'op' | 'eof'; v: string; s: number; e: number }

function lex(sql: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (ch === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? sql.length : j + 2; continue; }
    const s = i;
    if (ch === "'" || ch === '"') {
      let v = '';
      i++;
      for (;;) {
        if (i >= sql.length) throw parserError(ch === "'" ? 'unterminated quoted string' : 'unterminated quoted identifier');
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) { v += ch; i += 2; continue; }
          i++;
          break;
        }
        v += sql[i++];
      }
      out.push({ t: ch === "'" ? 'str' : 'qid', v, s, e: i });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(sql.slice(i))!;
      i += m[0].length;
      out.push({ t: 'num', v: m[0], s, e: i });
      continue;
    }
    if (/[A-Za-z_À-￿]/.test(ch)) {
      const m = /^[A-Za-z_À-￿][\w$À-￿]*/.exec(sql.slice(i))!;
      i += m[0].length;
      out.push({ t: 'id', v: m[0], s, e: i });
      continue;
    }
    if (ch === '$' && /[A-Za-z_0-9]/.test(sql[i + 1] ?? '')) {
      const m = /^\$\w+/.exec(sql.slice(i))!;
      i += m[0].length;
      out.push({ t: 'param', v: m[0].slice(1), s, e: i });
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '||', '::', '=='].includes(two)) { out.push({ t: 'op', v: two === '==' ? '=' : two, s, e: i + 2 }); i += 2; continue; }
    if ('=<>+-*/%(),.;'.includes(ch)) { out.push({ t: 'op', v: ch, s, e: i + 1 }); i++; continue; }
    throw parserError(`syntax error at or near "${ch}"`);
  }
  out.push({ t: 'eof', v: '', s: sql.length, e: sql.length });
  return out;
}

type Expr = { s: number; e: number } & (
  | { k: 'lit'; v: CellValue; kind: ColumnKind }
  | { k: 'param'; name: string }
  | { k: 'col'; parts: string[] }
  | { k: 'fn'; name: string; args: Expr[]; distinct: boolean; star: boolean }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'not'; x: Expr }
  | { k: 'neg'; x: Expr }
  | { k: 'isnull'; x: Expr; not: boolean }
  | { k: 'between'; x: Expr; lo: Expr; hi: Expr; not: boolean }
  | { k: 'in'; x: Expr; list: Expr[]; not: boolean }
  | { k: 'like'; x: Expr; pat: Expr; esc: Expr | null; ci: boolean; not: boolean }
  | { k: 'case'; operand: Expr | null; whens: [Expr, Expr][]; els: Expr | null }
  | { k: 'cast'; x: Expr; type: string }
);

type Body<T> = T extends unknown ? Omit<T, 's' | 'e'> : never;
type ExprBody = Body<Expr>;

type SelectItem = { s: number; e: number } & ({ star: true; table: string | null } | { star: false; expr: Expr; alias: string | null });
/**
 * A FROM / JOIN table: `schema.table`, where a wide member's 3- / 4-part name (`crm.sales.orders`) keeps the alias as
 * schema and the rest as table ("sales.orders"); `label` names the source when it has no alias (its last name part).
 */
interface Src { schema: string | null; table: string; alias: string | null; label: string; s: number; e: number }
interface JoinAst { type: BuilderJoinType; src: Src; on: Expr | null; comma: boolean }
interface OrderAst { expr: Expr; dir: 'asc' | 'desc'; nulls: 'first' | 'last' | null }
export interface SelectAst {
  distinct: boolean;
  items: SelectItem[];
  from: Src | null;
  joins: JoinAst[];
  where: Expr | null;
  groupBy: Expr[];
  having: Expr | null;
  orderBy: OrderAst[];
  limit: number | null;
  offset: number | null;
}

const STOP = new Set([
  'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'ON', 'AND', 'OR', 'NOT',
  'AS', 'ASC', 'DESC', 'NULLS', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'QUALIFY', 'USING', 'NATURAL', 'SELECT', 'BY', 'IS', 'IN', 'BETWEEN', 'LIKE',
  'ILIKE', 'ESCAPE', 'THEN', 'WHEN', 'ELSE', 'END', 'FETCH', 'POSITIONAL', 'ASOF', 'ANTI', 'SEMI',
]);

class Parser {
  private p = 0;
  private readonly toks: Tok[];
  constructor(sql: string) {
    this.toks = lex(sql);
  }
  private peek(o = 0): Tok { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }
  private next(): Tok { return this.toks[this.p++] ?? this.toks[this.toks.length - 1]; }
  private isKw(w: string, o = 0): boolean { const t = this.peek(o); return t.t === 'id' && t.v.toUpperCase() === w; }
  private acceptKw(w: string): boolean { if (this.isKw(w)) { this.p++; return true; } return false; }
  private expectKw(w: string): void { if (!this.acceptKw(w)) throw this.syntax(); }
  private isOp(v: string, o = 0): boolean { const t = this.peek(o); return t.t === 'op' && t.v === v; }
  private acceptOp(v: string): boolean { if (this.isOp(v)) { this.p++; return true; } return false; }
  private expectOp(v: string): void { if (!this.acceptOp(v)) throw this.syntax(); }
  private syntax(): SqlError {
    const t = this.peek();
    return parserError(t.t === 'eof' ? 'syntax error at end of input' : `syntax error at or near "${t.t === 'str' ? `'${t.v}'` : t.v}"`);
  }
  private ident(): string {
    const t = this.peek();
    if (t.t === 'qid' || t.t === 'id') { this.p++; return t.v; }
    throw this.syntax();
  }
  private aliasCandidate(): boolean {
    const t = this.peek();
    return t.t === 'qid' || (t.t === 'id' && !STOP.has(t.v.toUpperCase()));
  }

  parse(): SelectAst {
    if (this.isKw('WITH')) throw unsupported('WITH (common table expressions)');
    this.expectKw('SELECT');
    const distinct = this.acceptKw('DISTINCT');
    if (!distinct) this.acceptKw('ALL');
    const items: SelectItem[] = [];
    do items.push(this.item()); while (this.acceptOp(','));
    let from: Src | null = null;
    const joins: JoinAst[] = [];
    if (this.acceptKw('FROM')) {
      from = this.src();
      for (;;) {
        if (this.acceptOp(',')) { joins.push({ type: 'cross', src: this.src(), on: null, comma: true }); continue; }
        const type = this.joinType();
        if (!type) break;
        const src = this.src();
        let on: Expr | null = null;
        if (type !== 'cross') {
          if (this.isKw('USING')) throw unsupported('JOIN … USING');
          this.expectKw('ON');
          on = this.expr();
        }
        joins.push({ type, src, on, comma: false });
      }
    }
    const where = this.acceptKw('WHERE') ? this.expr() : null;
    const groupBy: Expr[] = [];
    if (this.acceptKw('GROUP')) {
      this.expectKw('BY');
      if (this.isKw('ALL')) throw unsupported('GROUP BY ALL');
      do groupBy.push(this.expr()); while (this.acceptOp(','));
    }
    const having = this.acceptKw('HAVING') ? this.expr() : null;
    const orderBy: OrderAst[] = [];
    if (this.acceptKw('ORDER')) {
      this.expectKw('BY');
      do {
        const expr = this.expr();
        const dir = this.acceptKw('DESC') ? 'desc' : (this.acceptKw('ASC'), 'asc');
        let nulls: 'first' | 'last' | null = null;
        if (this.acceptKw('NULLS')) nulls = this.acceptKw('FIRST') ? 'first' : (this.expectKw('LAST'), 'last');
        orderBy.push({ expr, dir, nulls });
      } while (this.acceptOp(','));
    }
    let limit: number | null = null;
    let offset: number | null = null;
    for (let k = 0; k < 2; k++) {
      if (this.acceptKw('LIMIT')) limit = this.count();
      else if (this.acceptKw('OFFSET')) offset = this.count();
    }
    this.acceptOp(';');
    if (this.peek().t !== 'eof') {
      if (this.isKw('UNION') || this.isKw('EXCEPT') || this.isKw('INTERSECT')) throw unsupported(this.peek().v.toUpperCase());
      throw this.syntax();
    }
    return { distinct, items, from, joins, where, groupBy, having, orderBy, limit, offset };
  }

  private count(): number {
    const t = this.next();
    if (t.t !== 'num' || !/^\d+$/.test(t.v)) throw parserError('LIMIT / OFFSET need a whole number');
    return Number(t.v);
  }

  private joinType(): BuilderJoinType | null {
    if (this.isKw('NATURAL') || this.isKw('ASOF') || this.isKw('POSITIONAL') || this.isKw('ANTI') || this.isKw('SEMI')) throw unsupported(`${this.peek().v.toUpperCase()} JOIN`);
    if (this.acceptKw('JOIN')) return 'inner';
    if (this.acceptKw('INNER')) { this.expectKw('JOIN'); return 'inner'; }
    for (const [kw, type] of [['LEFT', 'left'], ['RIGHT', 'right'], ['FULL', 'full']] as const) {
      if (this.acceptKw(kw)) { this.acceptKw('OUTER'); this.expectKw('JOIN'); return type; }
    }
    if (this.acceptKw('CROSS')) { this.expectKw('JOIN'); return 'cross'; }
    return null;
  }

  private src(): Src {
    const s = this.peek().s;
    if (this.isOp('(')) throw unsupported('A subquery in FROM');
    const parts = [this.ident()];
    while (this.acceptOp('.')) parts.push(this.ident());
    if (this.isOp('(')) throw unsupported('Table functions');
    const table = parts.length > 2 ? parts.slice(1).join('.') : parts[parts.length - 1];
    const schema = parts.length > 1 ? parts[0] : null;
    let alias: string | null = null;
    if (this.acceptKw('AS')) alias = this.ident();
    else if (this.aliasCandidate()) alias = this.ident();
    return { schema, table, alias, label: parts[parts.length - 1], s, e: this.toks[this.p - 1].e };
  }

  private item(): SelectItem {
    const s = this.peek().s;
    if (this.acceptOp('*')) return { star: true, table: null, s, e: this.toks[this.p - 1].e };
    const t = this.peek();
    if ((t.t === 'id' || t.t === 'qid') && this.isOp('.', 1) && this.peek(2).t === 'op' && this.peek(2).v === '*') {
      this.p += 3;
      return { star: true, table: t.v, s, e: this.toks[this.p - 1].e };
    }
    const expr = this.expr();
    const e = expr.e;
    let alias: string | null = null;
    if (this.acceptKw('AS')) alias = this.ident();
    else if (this.aliasCandidate()) alias = this.ident();
    return { star: false, expr, alias, s, e };
  }

  expr(): Expr { return this.or(); }

  private mk(x: ExprBody, s: number): Expr {
    return { ...x, s, e: this.toks[this.p - 1].e } as Expr;
  }

  private or(): Expr {
    let l = this.and();
    while (this.acceptKw('OR')) { const r = this.and(); l = { k: 'bin', op: 'OR', l, r, s: l.s, e: r.e }; }
    return l;
  }
  private and(): Expr {
    let l = this.not();
    while (this.acceptKw('AND')) { const r = this.not(); l = { k: 'bin', op: 'AND', l, r, s: l.s, e: r.e }; }
    return l;
  }
  private not(): Expr {
    const s = this.peek().s;
    if (this.acceptKw('NOT')) { const x = this.not(); return { k: 'not', x, s, e: x.e }; }
    return this.cmp();
  }
  private cmp(): Expr {
    const l = this.add();
    for (;;) {
      if (this.acceptKw('IS')) {
        const not = this.acceptKw('NOT');
        if (this.acceptKw('NULL')) return this.mk({ k: 'isnull', x: l, not }, l.s);
        if (this.isKw('TRUE') || this.isKw('FALSE')) {
          const v = this.next().v.toUpperCase() === 'TRUE';
          const lit: Expr = { k: 'lit', v, kind: 'bool', s: this.toks[this.p - 1].s, e: this.toks[this.p - 1].e };
          const eq: Expr = { k: 'bin', op: '=', l, r: lit, s: l.s, e: lit.e };
          return not ? { k: 'not', x: eq, s: l.s, e: lit.e } : eq;
        }
        if (this.acceptKw('DISTINCT')) throw unsupported('IS [NOT] DISTINCT FROM');
        throw this.syntax();
      }
      const not = this.isKw('NOT') && (this.isKw('BETWEEN', 1) || this.isKw('IN', 1) || this.isKw('LIKE', 1) || this.isKw('ILIKE', 1));
      if (not) this.p++;
      if (this.acceptKw('BETWEEN')) {
        const lo = this.add();
        this.expectKw('AND');
        const hi = this.add();
        return { k: 'between', x: l, lo, hi, not, s: l.s, e: hi.e };
      }
      if (this.acceptKw('IN')) {
        this.expectOp('(');
        if (this.isKw('SELECT')) throw unsupported('A subquery in IN (…)');
        const list: Expr[] = [];
        do list.push(this.expr()); while (this.acceptOp(','));
        this.expectOp(')');
        return this.mk({ k: 'in', x: l, list, not }, l.s);
      }
      if (this.isKw('LIKE') || this.isKw('ILIKE')) {
        const ci = this.next().v.toUpperCase() === 'ILIKE';
        const pat = this.add();
        const esc = this.acceptKw('ESCAPE') ? this.add() : null;
        return this.mk({ k: 'like', x: l, pat, esc, ci, not }, l.s);
      }
      const t = this.peek();
      if (t.t === 'op' && ['=', '<>', '!=', '<', '>', '<=', '>='].includes(t.v)) {
        this.p++;
        const r = this.add();
        return { k: 'bin', op: t.v === '!=' ? '<>' : t.v, l, r, s: l.s, e: r.e };
      }
      return l;
    }
  }
  private add(): Expr {
    let l = this.mul();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && (t.v === '+' || t.v === '-' || t.v === '||')) {
        this.p++;
        const r = this.mul();
        l = { k: 'bin', op: t.v, l, r, s: l.s, e: r.e };
      } else return l;
    }
  }
  private mul(): Expr {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && (t.v === '*' || t.v === '/' || t.v === '%')) {
        this.p++;
        const r = this.unary();
        l = { k: 'bin', op: t.v, l, r, s: l.s, e: r.e };
      } else return l;
    }
  }
  private unary(): Expr {
    const s = this.peek().s;
    if (this.acceptOp('-')) { const x = this.unary(); return { k: 'neg', x, s, e: x.e }; }
    if (this.acceptOp('+')) return this.unary();
    let x = this.primary();
    while (this.acceptOp('::')) {
      const type = this.typeName();
      x = { k: 'cast', x, type, s: x.s, e: this.toks[this.p - 1].e };
    }
    return x;
  }
  private typeName(): string {
    let t = this.ident().toUpperCase();
    if (this.acceptOp('(')) {
      const args: string[] = [];
      do args.push(this.next().v); while (this.acceptOp(','));
      this.expectOp(')');
      t += `(${args.join(',')})`;
    }
    return t;
  }
  private primary(): Expr {
    const t = this.peek();
    const s = t.s;
    if (t.t === 'num') { this.p++; const v = Number(t.v); return { k: 'lit', v, kind: /[.eE]/.test(t.v) ? 'decimal' : 'int', s, e: t.e }; }
    if (t.t === 'str') { this.p++; return { k: 'lit', v: t.v, kind: 'string', s, e: t.e }; }
    if (t.t === 'param') { this.p++; return { k: 'param', name: t.v, s, e: t.e }; }
    if (this.acceptOp('(')) {
      if (this.isKw('SELECT')) throw unsupported('Subqueries');
      const x = this.expr();
      this.expectOp(')');
      return { ...x, s, e: this.toks[this.p - 1].e };
    }
    if (t.t === 'qid') return this.ref();
    if (t.t !== 'id') throw this.syntax();
    const w = t.v.toUpperCase();
    if (w === 'NULL') { this.p++; return { k: 'lit', v: null, kind: 'other', s, e: t.e }; }
    if (w === 'TRUE' || w === 'FALSE') { this.p++; return { k: 'lit', v: w === 'TRUE', kind: 'bool', s, e: t.e }; }
    if ((w === 'DATE' || w === 'TIMESTAMP' || w === 'TIME') && this.peek(1).t === 'str') {
      this.p += 2;
      return { k: 'lit', v: this.toks[this.p - 1].v, kind: w === 'DATE' ? 'date' : w === 'TIME' ? 'time' : 'datetime', s, e: this.toks[this.p - 1].e };
    }
    if (w === 'INTERVAL') throw unsupported('INTERVAL');
    if (w === 'EXISTS') throw unsupported('EXISTS');
    if (w === 'CASE') {
      this.p++;
      const operand = this.isKw('WHEN') ? null : this.expr();
      const whens: [Expr, Expr][] = [];
      while (this.acceptKw('WHEN')) {
        const c = this.expr();
        this.expectKw('THEN');
        whens.push([c, this.expr()]);
      }
      const els = this.acceptKw('ELSE') ? this.expr() : null;
      this.expectKw('END');
      if (!whens.length) throw this.syntax();
      return this.mk({ k: 'case', operand, whens, els }, s);
    }
    if ((w === 'CAST' || w === 'TRY_CAST') && this.isOp('(', 1)) {
      this.p += 2;
      const x = this.expr();
      this.expectKw('AS');
      const type = this.typeName();
      this.expectOp(')');
      return this.mk({ k: 'cast', x, type }, s);
    }
    if (STOP.has(w)) throw this.syntax();
    if (this.isOp('(', 1)) {
      this.p += 2;
      const name = lc(t.v);
      if (this.acceptOp(')')) return this.mk({ k: 'fn', name, args: [], distinct: false, star: false }, s);
      if (this.acceptOp('*')) {
        this.expectOp(')');
        return this.mk({ k: 'fn', name, args: [], distinct: false, star: true }, s);
      }
      const distinct = this.acceptKw('DISTINCT');
      const args: Expr[] = [];
      do args.push(this.expr()); while (this.acceptOp(','));
      if (this.isKw('ORDER')) throw unsupported('ORDER BY inside an aggregate');
      this.expectOp(')');
      if (this.isKw('OVER')) throw unsupported('Window functions');
      if (this.isKw('FILTER')) throw unsupported('FILTER (WHERE …)');
      return this.mk({ k: 'fn', name, args, distinct, star: false }, s);
    }
    return this.ref();
  }
  private ref(): Expr {
    const s = this.peek().s;
    const parts = [this.ident()];
    while (this.isOp('.') && (this.peek(1).t === 'id' || this.peek(1).t === 'qid')) { this.p++; parts.push(this.ident()); }
    return this.mk({ k: 'col', parts }, s);
  }
}

export function parseSql(sql: string): SelectAst {
  return new Parser(sql).parse();
}

// ---------------------------------------------------------------- evaluator

type Row = (CellValue[] | null)[];
interface Binding { name: string; t: Mounted; cols: string[]; rows: CellValue[][] }
type Fn = (row: Row, grp: Row[] | null) => CellValue;
interface Compiled { fn: Fn; kind: ColumnKind; type: string; agg: boolean }

const AGGS = new Set(['count', 'sum', 'avg', 'min', 'max', 'count_star', 'any_value', 'first']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function toNum(v: CellValue): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function normDate(s: string): string {
  const x = s.replace('T', ' ').slice(0, 19);
  return x.length === 10 ? `${x} 00:00:00` : x;
}

/** Ordering of two non-null values (numbers numerically, dates by their normalised text, else text). */
function cmp(a: CellValue, b: CellValue): number {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  const na = typeof a === 'number' ? a : null;
  const nb = typeof b === 'number' ? b : null;
  if (na !== null || nb !== null) {
    const x = na ?? toNum(a);
    const y = nb ?? toNum(b);
    if (x !== null && y !== null) return x - y;
  }
  let sa = typeof a === 'object' ? JSON.stringify(a) : String(a);
  let sb = typeof b === 'object' ? JSON.stringify(b) : String(b);
  if (DATE_RE.test(sa) && DATE_RE.test(sb)) { sa = normDate(sa); sb = normDate(sb); }
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function keyOf(v: CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return `n${v}`;
  if (typeof v === 'boolean') return `b${v ? 1 : 0}`;
  if (typeof v === 'string') {
    const n = toNum(v);
    if (n !== null) return `n${n}`;
    return DATE_RE.test(v) ? `s${normDate(v)}` : `s${v}`;
  }
  return `o${JSON.stringify(v)}`;
}

function likeRegex(pattern: string, esc: string | null, ci: boolean): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (esc && c === esc && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '%') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, ci ? 'is' : 's');
}

const and3 = (a: CellValue, b: CellValue): CellValue => (a === false || b === false ? false : a === null || b === null ? null : true);
const or3 = (a: CellValue, b: CellValue): CellValue => (a === true || b === true ? true : a === null || b === null ? null : false);
const numClass = (k: ColumnKind) => k === 'int' || k === 'float' || k === 'decimal';

function typeOfKind(k: ColumnKind): string {
  return k === 'int' ? 'BIGINT' : k === 'float' ? 'DOUBLE' : k === 'decimal' ? 'DECIMAL(38,2)' : k === 'bool' ? 'BOOLEAN' : k === 'date' ? 'DATE'
    : k === 'datetime' ? 'TIMESTAMP' : k === 'time' ? 'TIME' : k === 'guid' ? 'UUID' : k === 'json' ? 'JSON' : k === 'binary' ? 'BLOB' : 'VARCHAR';
}

function castTo(v: CellValue, type: string): CellValue {
  if (v === null) return null;
  const t = type.toUpperCase();
  if (/^(VARCHAR|TEXT|STRING|CHAR)/.test(t)) return typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^(BIGINT|INT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT)/.test(t)) { const n = toNum(v); if (n === null) throw new SqlError(`Conversion Error: Could not convert string '${String(v)}' to INT64`); return Math.trunc(n); }
  if (/^(DOUBLE|FLOAT|REAL|DECIMAL|NUMERIC)/.test(t)) { const n = toNum(v); if (n === null) throw new SqlError(`Conversion Error: Could not convert string '${String(v)}' to DOUBLE`); return n; }
  if (/^DATE/.test(t)) return String(v).slice(0, 10);
  if (/^TIMESTAMP/.test(t)) return normDate(String(v));
  if (/^BOOL/.test(t)) return typeof v === 'boolean' ? v : /^(true|t|1|yes)$/i.test(String(v));
  return v;
}

function kindOfType(type: string): ColumnKind {
  const t = type.toUpperCase();
  if (/^(BIGINT|INT|INTEGER|SMALLINT|TINYINT|HUGEINT)/.test(t)) return 'int';
  if (/^(DOUBLE|FLOAT|REAL)/.test(t)) return 'float';
  if (/^(DECIMAL|NUMERIC)/.test(t)) return 'decimal';
  if (/^DATE$/.test(t)) return 'date';
  if (/^TIMESTAMP/.test(t)) return 'datetime';
  if (/^BOOL/.test(t)) return 'bool';
  return 'string';
}

class Scope {
  readonly bindings: Binding[];
  readonly visible: number;
  constructor(bindings: Binding[], visible: number) {
    this.bindings = bindings;
    this.visible = visible;
  }
  /** binding index + column index of a column reference. */
  resolve(parts: string[]): [number, number] {
    const col = lc(parts[parts.length - 1]);
    const bs = this.bindings.slice(0, this.visible);
    let cands: number[];
    if (parts.length === 1) cands = bs.map((_, i) => i);
    else {
      const tbl = lc(parts[parts.length - 2]);
      const schema = parts.length > 2 ? lc(parts[parts.length - 3]) : null;
      cands = bs.map((b, i) => [b, i] as const).filter(([b]) => (lc(b.name) === tbl && (!schema || lc(b.t.alias) === schema)) || (schema !== null && lc(b.t.alias) === schema && lc(b.t.linkName) === tbl)).map(([, i]) => i);
      if (!cands.length) throw binderError(`Referenced table "${parts.slice(0, -1).join('.')}" not found!`);
    }
    const hits: [number, number][] = [];
    for (const i of cands) {
      const ci = this.bindings[i].cols.findIndex((c) => lc(c) === col);
      if (ci >= 0) hits.push([i, ci]);
    }
    if (!hits.length) throw binderError(`Referenced column "${parts[parts.length - 1]}" not found in FROM clause!`);
    if (hits.length > 1) throw binderError(`Ambiguous reference to column name "${parts[parts.length - 1]}" (use: "${this.bindings[hits[0][0]].name}.${parts[parts.length - 1]}" or "${this.bindings[hits[1][0]].name}.${parts[parts.length - 1]}")`);
    return hits[0];
  }
}

/** Binding indexes an expression refers to. */
function refsOf(e: Expr, scope: Scope, out = new Set<number>()): Set<number> {
  walk(e, (x) => {
    if (x.k === 'col') {
      try { out.add(scope.resolve(x.parts)[0]); } catch { out.add(-1); }
    }
  });
  return out;
}

function walk(e: Expr, fn: (e: Expr) => void): void {
  fn(e);
  switch (e.k) {
    case 'fn': e.args.forEach((a) => walk(a, fn)); break;
    case 'bin': walk(e.l, fn); walk(e.r, fn); break;
    case 'not': case 'neg': case 'isnull': case 'cast': walk(e.x, fn); break;
    case 'between': walk(e.x, fn); walk(e.lo, fn); walk(e.hi, fn); break;
    case 'in': walk(e.x, fn); e.list.forEach((a) => walk(a, fn)); break;
    case 'like': walk(e.x, fn); walk(e.pat, fn); if (e.esc) walk(e.esc, fn); break;
    case 'case': if (e.operand) walk(e.operand, fn); e.whens.forEach(([a, b]) => { walk(a, fn); walk(b, fn); }); if (e.els) walk(e.els, fn); break;
    default: break;
  }
}

const hasAgg = (e: Expr) => {
  let found = false;
  walk(e, (x) => { if (x.k === 'fn' && AGGS.has(x.name)) found = true; });
  return found;
};

function compile(e: Expr, scope: Scope): Compiled {
  switch (e.k) {
    case 'lit': { const v = e.v; return { fn: () => v, kind: e.kind, type: typeOfKind(e.kind), agg: false }; }
    case 'param': throw binderError(`Parameter $${e.name} has no value`);
    case 'col': {
      const [bi, ci] = scope.resolve(e.parts);
      const t = scope.bindings[bi].t.columns[ci];
      return { fn: (row) => row[bi]?.[ci] ?? null, kind: t.kind, type: t.type, agg: false };
    }
    case 'neg': {
      const x = compile(e.x, scope);
      return { fn: (r, g) => { const n = toNum(x.fn(r, g)); return n === null ? null : -n; }, kind: x.kind, type: x.type, agg: x.agg };
    }
    case 'not': {
      const x = compile(e.x, scope);
      return { fn: (r, g) => { const v = x.fn(r, g); return v === null ? null : !v; }, kind: 'bool', type: 'BOOLEAN', agg: x.agg };
    }
    case 'isnull': {
      const x = compile(e.x, scope);
      return { fn: (r, g) => (x.fn(r, g) === null) !== e.not, kind: 'bool', type: 'BOOLEAN', agg: x.agg };
    }
    case 'between': {
      const [x, lo, hi] = [compile(e.x, scope), compile(e.lo, scope), compile(e.hi, scope)];
      return {
        fn: (r, g) => {
          const v = x.fn(r, g); const a = lo.fn(r, g); const b = hi.fn(r, g);
          if (v === null || a === null || b === null) return null;
          const inside = cmp(v, a) >= 0 && cmp(v, b) <= 0;
          return inside !== e.not;
        },
        kind: 'bool', type: 'BOOLEAN', agg: x.agg || lo.agg || hi.agg,
      };
    }
    case 'in': {
      const x = compile(e.x, scope);
      const list = e.list.map((a) => compile(a, scope));
      return {
        fn: (r, g) => {
          const v = x.fn(r, g);
          if (v === null) return null;
          let sawNull = false;
          for (const a of list) {
            const w = a.fn(r, g);
            if (w === null) { sawNull = true; continue; }
            if (cmp(v, w) === 0) return !e.not;
          }
          return sawNull ? null : e.not;
        },
        kind: 'bool', type: 'BOOLEAN', agg: x.agg,
      };
    }
    case 'like': {
      const x = compile(e.x, scope);
      const pat = compile(e.pat, scope);
      const esc = e.esc ? compile(e.esc, scope) : null;
      const cache = new Map<string, RegExp>();
      return {
        fn: (r, g) => {
          const v = x.fn(r, g); const p = pat.fn(r, g);
          if (v === null || p === null) return null;
          const es = esc ? String(esc.fn(r, g) ?? '') : null;
          const k = `${es}\u0001${String(p)}`;
          let re = cache.get(k);
          if (!re) cache.set(k, (re = likeRegex(String(p), es || null, e.ci)));
          return re.test(typeof v === 'object' ? JSON.stringify(v) : String(v)) !== e.not;
        },
        kind: 'bool', type: 'BOOLEAN', agg: x.agg,
      };
    }
    case 'case': {
      const operand = e.operand ? compile(e.operand, scope) : null;
      const whens = e.whens.map(([c, v]) => [compile(c, scope), compile(v, scope)] as const);
      const els = e.els ? compile(e.els, scope) : null;
      const first = whens[0][1];
      return {
        fn: (r, g) => {
          const ov = operand ? operand.fn(r, g) : null;
          for (const [c, v] of whens) {
            const cv = c.fn(r, g);
            if (operand ? ov !== null && cv !== null && cmp(ov, cv) === 0 : cv === true) return v.fn(r, g);
          }
          return els ? els.fn(r, g) : null;
        },
        kind: first.kind, type: first.type, agg: whens.some(([c, v]) => c.agg || v.agg) || !!els?.agg || !!operand?.agg,
      };
    }
    case 'cast': {
      const x = compile(e.x, scope);
      return { fn: (r, g) => castTo(x.fn(r, g), e.type), kind: kindOfType(e.type), type: e.type, agg: x.agg };
    }
    case 'bin': return compileBin(e, scope);
    case 'fn': return compileFn(e, scope);
  }
}

function compileBin(e: Extract<Expr, { k: 'bin' }>, scope: Scope): Compiled {
  const l = compile(e.l, scope);
  const r = compile(e.r, scope);
  const agg = l.agg || r.agg;
  const bool = (fn: Fn): Compiled => ({ fn, kind: 'bool', type: 'BOOLEAN', agg });
  switch (e.op) {
    case 'AND': return bool((x, g) => and3(l.fn(x, g), r.fn(x, g)));
    case 'OR': return bool((x, g) => or3(l.fn(x, g), r.fn(x, g)));
    case '=': case '<>': case '<': case '>': case '<=': case '>=': {
      const op = e.op;
      return bool((x, g) => {
        const a = l.fn(x, g); const b = r.fn(x, g);
        if (a === null || b === null) return null;
        const c = cmp(a, b);
        return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
      });
    }
    case '||':
      return { fn: (x, g) => { const a = l.fn(x, g); const b = r.fn(x, g); return a === null || b === null ? null : `${String(a)}${String(b)}`; }, kind: 'string', type: 'VARCHAR', agg };
    default: {
      const op = e.op;
      const float = op === '/' || l.kind === 'float' || r.kind === 'float';
      const decimal = !float && (l.kind === 'decimal' || r.kind === 'decimal');
      const kind: ColumnKind = float ? 'float' : decimal ? 'decimal' : 'int';
      return {
        fn: (x, g) => {
          const a = toNum(l.fn(x, g)); const b = toNum(r.fn(x, g));
          if (a === null || b === null) return null;
          if ((op === '/' || op === '%') && b === 0) return null;
          const v = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b;
          return decimal ? Math.round(v * 1e6) / 1e6 : v;
        },
        kind, type: typeOfKind(kind), agg,
      };
    }
  }
}

function compileFn(e: Extract<Expr, { k: 'fn' }>, scope: Scope): Compiled {
  const name = e.name;
  if (AGGS.has(name)) {
    if (e.args.some(hasAgg)) throw binderError('aggregate function calls cannot be nested');
    const arg = e.star || !e.args.length ? null : compile(e.args[0], scope);
    const rowsOf = (row: Row, grp: Row[] | null) => grp ?? [row];
    if (name === 'count' || name === 'count_star') {
      return {
        fn: (row, grp) => {
          const rows = rowsOf(row, grp);
          if (!arg) return rows.length;
          if (e.distinct) {
            const seen = new Set<string>();
            for (const r of rows) { const k = keyOf(arg.fn(r, null)); if (k !== null) seen.add(k); }
            return seen.size;
          }
          let n = 0;
          for (const r of rows) if (arg.fn(r, null) !== null) n++;
          return n;
        },
        kind: 'int', type: 'BIGINT', agg: true,
      };
    }
    if (!arg) throw binderError(`${name}(*) is not a valid aggregate`);
    const values = (row: Row, grp: Row[] | null) => {
      const out: CellValue[] = [];
      const seen = e.distinct ? new Set<string>() : null;
      for (const r of rowsOf(row, grp)) {
        const v = arg.fn(r, null);
        if (v === null) continue;
        if (seen) { const k = keyOf(v)!; if (seen.has(k)) continue; seen.add(k); }
        out.push(v);
      }
      return out;
    };
    if (name === 'sum' || name === 'avg') {
      const kind: ColumnKind = name === 'avg' ? 'float' : arg.kind === 'int' ? 'int' : arg.kind === 'decimal' ? 'decimal' : 'float';
      return {
        fn: (row, grp) => {
          const vs = values(row, grp).map(toNum).filter((x): x is number => x !== null);
          if (!vs.length) return null;
          const s = vs.reduce((a, b) => a + b, 0);
          if (name === 'avg') return s / vs.length;
          return kind === 'decimal' ? Math.round(s * 100) / 100 : s;
        },
        kind, type: name === 'avg' ? 'DOUBLE' : kind === 'int' ? 'HUGEINT' : kind === 'decimal' ? 'DECIMAL(38,2)' : 'DOUBLE', agg: true,
      };
    }
    // min / max / any_value / first
    return {
      fn: (row, grp) => {
        const vs = values(row, grp);
        if (!vs.length) return null;
        if (name === 'any_value' || name === 'first') return vs[0];
        return vs.reduce((a, b) => (name === 'min' ? (cmp(b, a) < 0 ? b : a) : cmp(b, a) > 0 ? b : a));
      },
      kind: arg.kind, type: arg.type, agg: true,
    };
  }
  const args = e.args.map((a) => compile(a, scope));
  const agg = args.some((a) => a.agg);
  const a0 = args[0];
  const need = (n: number) => { if (args.length < n) throw binderError(`No function matches the given name and argument types '${name}()'`); };
  const str = (fn: (s: string, r: Row, g: Row[] | null) => CellValue): Compiled => {
    need(1);
    return { fn: (r, g) => { const v = a0.fn(r, g); return v === null ? null : fn(typeof v === 'object' ? JSON.stringify(v) : String(v), r, g); }, kind: 'string', type: 'VARCHAR', agg };
  };
  const intOf = (fn: (v: CellValue) => number | null): Compiled => {
    need(1);
    return { fn: (r, g) => { const v = a0.fn(r, g); return v === null ? null : fn(v); }, kind: 'int', type: 'BIGINT', agg };
  };
  const part = (from: number, to: number) => intOf((v) => { const s = String(v); return DATE_RE.test(s) ? Number(s.slice(from, to)) : null; });
  switch (name) {
    case 'lower': case 'lcase': return str((s) => s.toLowerCase());
    case 'upper': case 'ucase': return str((s) => s.toUpperCase());
    case 'trim': return str((s) => s.trim());
    case 'ltrim': return str((s) => s.replace(/^\s+/, ''));
    case 'rtrim': return str((s) => s.replace(/\s+$/, ''));
    case 'length': case 'len': case 'char_length': case 'strlen': return intOf((v) => [...String(v)].length);
    case 'year': return part(0, 4);
    case 'month': return part(5, 7);
    case 'day': case 'dayofmonth': return part(8, 10);
    case 'concat': return { fn: (r, g) => args.map((a) => a.fn(r, g)).filter((v) => v !== null).map(String).join(''), kind: 'string', type: 'VARCHAR', agg };
    case 'substr': case 'substring': {
      need(2);
      return str((s, r, g) => {
        const start = toNum(args[1].fn(r, g)) ?? 1;
        const len = args[2] ? toNum(args[2].fn(r, g)) : null;
        const chars = [...s];
        return chars.slice(Math.max(0, start - 1), len === null ? undefined : Math.max(0, start - 1) + len).join('');
      });
    }
    case 'replace': need(3); return str((s, r, g) => s.split(String(args[1].fn(r, g) ?? '')).join(String(args[2].fn(r, g) ?? '')));
    case 'left': need(2); return str((s, r, g) => [...s].slice(0, toNum(args[1].fn(r, g)) ?? 0).join(''));
    case 'right': need(2); return str((s, r, g) => { const n = toNum(args[1].fn(r, g)) ?? 0; return n ? [...s].slice(-n).join('') : ''; });
    case 'coalesce': case 'ifnull': need(1); return { fn: (r, g) => { for (const a of args) { const v = a.fn(r, g); if (v !== null) return v; } return null; }, kind: a0.kind, type: a0.type, agg };
    case 'nullif': need(2); return { fn: (r, g) => { const a = a0.fn(r, g); const b = args[1].fn(r, g); return a !== null && b !== null && cmp(a, b) === 0 ? null : a; }, kind: a0.kind, type: a0.type, agg };
    case 'abs': need(1); return { fn: (r, g) => { const n = toNum(a0.fn(r, g)); return n === null ? null : Math.abs(n); }, kind: numClass(a0.kind) ? a0.kind : 'float', type: a0.type, agg };
    case 'round': case 'floor': case 'ceil': case 'ceiling': {
      need(1);
      return {
        fn: (r, g) => {
          const n = toNum(a0.fn(r, g));
          if (n === null) return null;
          if (name === 'floor') return Math.floor(n);
          if (name !== 'round') return Math.ceil(n);
          const d = args[1] ? toNum(args[1].fn(r, g)) ?? 0 : 0;
          const f = 10 ** d;
          return Math.round(n * f) / f;
        },
        kind: a0.kind === 'int' || name !== 'round' ? (name === 'round' ? a0.kind : 'int') : a0.kind, type: name === 'round' ? a0.type : 'BIGINT', agg,
      };
    }
    case 'greatest': case 'least': need(1); return {
      fn: (r, g) => { const vs = args.map((a) => a.fn(r, g)).filter((v) => v !== null); return vs.length ? vs.reduce((a, b) => ((name === 'greatest' ? cmp(b, a) > 0 : cmp(b, a) < 0) ? b : a)) : null; },
      kind: a0.kind, type: a0.type, agg,
    };
    case 'date_trunc': {
      need(2);
      const unit = args[0];
      return {
        fn: (r, g) => {
          const u = String(unit.fn(r, g) ?? '').toLowerCase();
          const v = args[1].fn(r, g);
          if (v === null) return null;
          const s = normDate(String(v));
          return u === 'year' ? `${s.slice(0, 4)}-01-01 00:00:00` : u === 'month' ? `${s.slice(0, 7)}-01 00:00:00` : u === 'day' ? `${s.slice(0, 10)} 00:00:00` : s;
        },
        kind: 'datetime', type: 'TIMESTAMP', agg,
      };
    }
    case 'strftime': case 'current_date': case 'now': case 'current_timestamp':
      if (name === 'strftime') throw unsupported('strftime');
      return { fn: () => (name === 'current_date' ? new Date().toISOString().slice(0, 10) : normDate(new Date().toISOString())), kind: name === 'current_date' ? 'date' : 'datetime', type: name === 'current_date' ? 'DATE' : 'TIMESTAMP', agg: false };
    default:
      throw new SqlError(`Catalog Error: Scalar Function with name ${name} does not exist! (the mock engine implements the common ones)`);
  }
}

/** Splits a predicate into its AND-ed parts. */
function conjuncts(e: Expr | null): Expr[] {
  if (!e) return [];
  if (e.k === 'bin' && e.op === 'AND') return [...conjuncts(e.l), ...conjuncts(e.r)];
  return [e];
}

export interface EvalResult {
  columns: ColumnInfo[];
  rows: CellValue[][];
  /** Sources read for this statement (not from the cache). */
  fetched: { table: string; rows: number; ms: number; connection: string }[];
}

const MAX_CROSS = 3_000_000;

/** Resolves the FROM / JOIN tables of a statement to mounted tables of the link. */
function bindSources(engine: MockEngine, link: ConnectionProfile, sel: SelectAst): { src: Src; t: Mounted }[] {
  const mounted = mountedTables(engine, link);
  const srcs = sel.from ? [sel.from, ...sel.joins.map((j) => j.src)] : [];
  return srcs.map((src) => {
    let cands = mounted.filter((t) => lc(t.linkName) === lc(src.table) && (!src.schema || lc(t.alias) === lc(src.schema)));
    // a wide member's other containers (crm.sales.orders, crm."sales.orders", crm.shop.dbo.orders) load on demand
    const nested = !cands.length && src.schema ? nestedTable(engine, link, src.schema, src.table) : null;
    if (nested) cands = [nested];
    if (!cands.length) {
      const name = src.schema ? `${src.schema}.${src.table}` : src.table;
      const known = mounted.map((t) => `${t.alias}.${t.linkName}`);
      const close = known.find((k) => lc(k.split('.')[1]) === lc(src.table));
      throw new SqlError(`Catalog Error: Table with name ${name} does not exist!${close ? `\nDid you mean "${close}"?` : ''}`);
    }
    if (cands.length > 1 && !src.schema) {
      throw binderError(`Table name "${src.table}" is ambiguous: ${cands.map((t) => `${t.alias}.${t.linkName}`).join(', ')}`);
    }
    cands = cands.slice(0, 1);
    return { src, t: cands[0] };
  });
}

/** Runs a SELECT of the link (rows from the link's source cache). */
export function evaluate(state: PackState, link: ConnectionProfile, sql: string): EvalResult {
  const sel = parseSql(sql);
  const fetched: EvalResult['fetched'] = [];
  const bound = bindSources(state.engine, link, sel);
  const bindings: Binding[] = bound.map(({ src, t }) => ({
    name: src.alias ?? src.label, t, cols: t.columns.map((c) => c.name),
    rows: sourceRows(state, link.id, t, (m, rows, ms) => fetched.push({ table: `${m.alias}.${m.linkName}`, rows, ms, connection: state.engine.conn(m.connectionId)?.name ?? m.connectionId })),
  }));
  const names = new Set<string>();
  for (const b of bindings) {
    if (names.has(lc(b.name))) throw binderError(`Duplicate alias "${b.name}" in query!`);
    names.add(lc(b.name));
  }
  const n = bindings.length;
  const full = new Scope(bindings, n);

  // FROM + joins
  let acc: Row[];
  if (!n) acc = [[]];
  else {
    acc = bindings[0].rows.map((r) => { const row: Row = new Array(n).fill(null); row[0] = r; return row; });
    sel.joins.forEach((j, ji) => {
      const bi = ji + 1;
      const right = bindings[bi].rows;
      const scope = new Scope(bindings, bi + 1);
      const conds = conjuncts(j.on);
      const keys: { l: Compiled; r: Compiled }[] = [];
      const residual: Expr[] = [];
      for (const c of conds) {
        if (c.k === 'lit' && c.v === true) continue;
        if (c.k === 'bin' && c.op === '=') {
          const lr = refsOf(c.l, scope);
          const rr = refsOf(c.r, scope);
          const leftOnly = (s: Set<number>) => s.size > 0 && [...s].every((x) => x >= 0 && x < bi);
          const rightOnly = (s: Set<number>) => s.size === 1 && s.has(bi);
          if (leftOnly(lr) && rightOnly(rr)) { keys.push({ l: compile(c.l, scope), r: compile(c.r, scope) }); continue; }
          if (leftOnly(rr) && rightOnly(lr)) { keys.push({ l: compile(c.r, scope), r: compile(c.l, scope) }); continue; }
        }
        residual.push(c);
      }
      const res = residual.map((c) => compile(c, scope));
      const ok = (row: Row) => res.every((c) => c.fn(row, null) === true);
      const joined = (l: Row | null, r: CellValue[] | null): Row => {
        const row: Row = l ? [...l] : new Array(n).fill(null);
        row[bi] = r;
        return row;
      };
      const out: Row[] = [];
      const rightMatched = new Uint8Array(right.length);
      if (keys.length) {
        const index = new Map<string, number[]>();
        right.forEach((rr, ri) => {
          const probe: Row = new Array(n).fill(null);
          probe[bi] = rr;
          const parts = keys.map((k) => keyOf(k.r.fn(probe, null)));
          if (parts.some((p) => p === null)) return;
          const key = parts.join('\u0001');
          const list = index.get(key);
          if (list) list.push(ri); else index.set(key, [ri]);
        });
        for (const l of acc) {
          const parts = keys.map((k) => keyOf(k.l.fn(l, null)));
          let hit = false;
          if (!parts.some((p) => p === null)) {
            for (const ri of index.get(parts.join('\u0001')) ?? []) {
              const row = joined(l, right[ri]);
              if (!ok(row)) continue;
              out.push(row);
              rightMatched[ri] = 1;
              hit = true;
            }
          }
          if (!hit && (j.type === 'left' || j.type === 'full')) out.push(joined(l, null));
        }
      } else {
        if (acc.length * right.length > MAX_CROSS) throw new SqlError(`Out of Memory Error: the mock engine stops at ${MAX_CROSS.toLocaleString('en-US')} combined rows (${acc.length} × ${right.length}); add a join condition.`);
        for (const l of acc) {
          let hit = false;
          right.forEach((rr, ri) => {
            const row = joined(l, rr);
            if (j.type !== 'cross' && !ok(row)) return;
            out.push(row);
            rightMatched[ri] = 1;
            hit = true;
          });
          if (!hit && (j.type === 'left' || j.type === 'full')) out.push(joined(l, null));
        }
      }
      if (j.type === 'right' || j.type === 'full') right.forEach((rr, ri) => { if (!rightMatched[ri]) out.push(joined(null, rr)); });
      acc = out;
    });
  }

  // WHERE
  if (sel.where) {
    if (hasAgg(sel.where)) throw binderError('WHERE clause cannot contain aggregates!');
    const w = compile(sel.where, full);
    acc = acc.filter((r) => w.fn(r, null) === true);
  }

  // items (stars expanded)
  interface OutCol { name: string; c: Compiled; alias: string | null; raw: string }
  const outs: OutCol[] = [];
  for (const it of sel.items) {
    if (it.star) {
      const which = it.table ? bindings.map((b, i) => [b, i] as const).filter(([b]) => lc(b.name) === lc(it.table!)) : bindings.map((b, i) => [b, i] as const);
      if (it.table && !which.length) throw binderError(`Referenced table "${it.table}" not found!`);
      if (!n) throw binderError('SELECT * expression without FROM clause!');
      for (const [b, bi] of which) {
        b.t.columns.forEach((c, ci) => outs.push({ name: c.name, alias: null, raw: c.name, c: { fn: (row) => row[bi]?.[ci] ?? null, kind: c.kind, type: c.type, agg: false } }));
      }
      continue;
    }
    const c = compile(it.expr, full);
    const raw = sql.slice(it.expr.s, it.expr.e).trim();
    const name = it.alias ?? (it.expr.k === 'col' ? bindings[full.resolve(it.expr.parts)[0]].t.columns[full.resolve(it.expr.parts)[1]].name
      : it.expr.k === 'fn' && it.expr.star && it.expr.name === 'count' ? 'count_star()' : raw);
    outs.push({ name, c, alias: it.alias, raw });
  }

  // ORDER BY terms: an output alias, an ordinal, else an expression
  const orderTerms = sel.orderBy.map((o) => {
    if (o.expr.k === 'lit' && typeof o.expr.v === 'number' && Number.isInteger(o.expr.v)) {
      const i = o.expr.v - 1;
      if (i < 0 || i >= outs.length) throw binderError(`ORDER term out of range - should be between 1 and ${outs.length}`);
      return { out: i, c: null as Compiled | null, o };
    }
    if (o.expr.k === 'col' && o.expr.parts.length === 1) {
      const i = outs.findIndex((x) => x.alias !== null && lc(x.alias) === lc((o.expr as Extract<Expr, { k: 'col' }>).parts[0]));
      if (i >= 0) return { out: i, c: null, o };
    }
    return { out: -1, c: compile(o.expr, full), o };
  });

  const grouped = sel.groupBy.length > 0 || outs.some((x) => x.c.agg) || (!!sel.having) || orderTerms.some((t) => t.c?.agg);
  let units: { row: Row; grp: Row[] | null }[];
  if (grouped) {
    const groupFns = sel.groupBy.map((g) => {
      if (g.k === 'lit' && typeof g.v === 'number' && Number.isInteger(g.v)) {
        const o = outs[g.v - 1];
        if (!o) throw binderError(`GROUP BY term out of range - should be between 1 and ${outs.length}`);
        return o.c;
      }
      if (g.k === 'col' && g.parts.length === 1) {
        const o = outs.find((x) => x.alias !== null && lc(x.alias) === lc((g as Extract<Expr, { k: 'col' }>).parts[0]));
        if (o) { try { return compile(g, full); } catch { return o.c; } }
      }
      return compile(g, full);
    });
    if (groupFns.some((g) => g.agg)) throw binderError('GROUP BY clause cannot contain aggregates!');
    const groups = new Map<string, Row[]>();
    for (const r of acc) {
      const k = groupFns.map((g) => keyOf(g.fn(r, null)) ?? '\u0000').join('\u0001');
      const list = groups.get(k);
      if (list) list.push(r); else groups.set(k, [r]);
    }
    if (!groupFns.length && !groups.size) groups.set('', []);
    const empty: Row = new Array(n).fill(null);
    units = [...groups.values()].map((g) => ({ row: g[0] ?? empty, grp: g }));
    if (sel.having) {
      const h = compile(sel.having, full);
      units = units.filter((u) => h.fn(u.row, u.grp) === true);
    }
  } else units = acc.map((row) => ({ row, grp: null }));

  let rows = units.map((u) => ({ values: outs.map((o) => o.c.fn(u.row, u.grp)), u }));
  if (orderTerms.length) {
    const keyed = rows.map((r) => ({ r, k: orderTerms.map((t) => (t.out >= 0 ? r.values[t.out] : t.c!.fn(r.u.row, r.u.grp))) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < orderTerms.length; i++) {
        const { o } = orderTerms[i];
        const x = a.k[i]; const y = b.k[i];
        const nullsFirst = o.nulls === 'first';
        if (x === null || y === null) {
          if (x === y) continue;
          return (x === null) === nullsFirst ? -1 : 1;
        }
        const c = cmp(x, y);
        if (c) return o.dir === 'desc' ? -c : c;
      }
      return 0;
    });
    rows = keyed.map((k) => k.r);
  }
  let values = rows.map((r) => r.values);
  if (sel.distinct) {
    const seen = new Set<string>();
    values = values.filter((v) => { const k = v.map((x) => keyOf(x) ?? '\u0000').join('\u0001'); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  if (sel.offset) values = values.slice(sel.offset);
  if (sel.limit !== null) values = values.slice(0, sel.limit);
  const columns: ColumnInfo[] = outs.map((o, i) => ({
    name: o.name, ordinal: i, dbType: o.c.type, kind: o.c.kind, nullable: true, size: null, precision: null, scale: null, table: null, schema: null, isKey: false,
  }));
  return { columns, rows: values, fetched };
}

const READ_ONLY = /^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|COPY|ATTACH|DETACH|INSTALL|LOAD|EXPORT|IMPORT|SET|PRAGMA|BEGIN|COMMIT|ROLLBACK|CALL|USE|VACUUM|CHECKPOINT)\b/i;

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
}

/** A statement on a link session (the patched interpreter). */
function interpretLinked(state: PackState, link: ConnectionProfile, sqlRaw: string): Interpreted {
  const out: Interpreted = { sets: [], messages: [], affected: null, kind: null, error: null };
  const sql = stripSqlComments(sqlRaw).trim().replace(/;\s*$/, '');
  if (!sql) return out;
  const fail = (message: string) => ({ ...out, error: message, errorCode: 'DUCKDB' });
  if (READ_ONLY.test(sql)) return fail(`Invalid Input Error: Linked databases are read-only: ${sql.split(/\s+/)[0].toUpperCase()} is not allowed. Materialize the query into a writable connection instead.`);
  try {
    if (/^SHOW\s+(ALL\s+)?TABLES$/i.test(sql)) {
      const ts = mountedTables(state.engine, link);
      const col = (name: string, i: number): ColumnInfo => ({ name, ordinal: i, dbType: 'VARCHAR', kind: 'string', nullable: false, size: null, precision: null, scale: null, table: null, schema: null, isKey: false });
      return { ...out, sets: [{ columns: [col('schema', 0), col('name', 1), col('source', 2)], rows: ts.map((t) => [t.alias, t.linkName, `${state.engine.conn(t.connectionId)?.name ?? t.connectionId}: ${t.schema}.${t.source}`]) }] };
    }
    const d = /^(?:DESCRIBE|DESC)\s+(.+)$/i.exec(sql);
    if (d && !/^SELECT\b/i.test(d[1])) {
      const parts = d[1].trim().split('.').map((p) => p.replace(/^"|"$/g, ''));
      const t = mountedTables(state.engine, link).find((m) => lc(m.linkName) === lc(parts[parts.length - 1]) && (parts.length < 2 || lc(m.alias) === lc(parts[0])));
      if (!t) return fail(`Catalog Error: Table with name ${d[1].trim()} does not exist!`);
      const col = (name: string, i: number): ColumnInfo => ({ name, ordinal: i, dbType: 'VARCHAR', kind: 'string', nullable: true, size: null, precision: null, scale: null, table: null, schema: null, isKey: false });
      return { ...out, sets: [{ columns: ['column_name', 'column_type', 'null', 'key'].map(col), rows: t.columns.map((c) => [c.name, c.type, c.nullable ? 'YES' : 'NO', c.pk ? 'PRI' : null]) }] };
    }
    if (!/^SELECT\b/i.test(sql)) {
      if (/^(WITH|FROM|PIVOT|UNPIVOT|SUMMARIZE|VALUES|TABLE)\b/i.test(sql)) throw unsupported(sql.split(/\s+/)[0].toUpperCase());
      throw parserError(`syntax error at or near "${sql.split(/\s+/)[0]}"`);
    }
    const r = evaluate(state, link, sql);
    for (const f of r.fetched) {
      out.messages.push({ severity: 'info', text: `Fetched ${f.table}: ${f.rows.toLocaleString('en-US')} rows from ${f.connection} in ${f.ms} ms`, source: 'engine' });
    }
    out.sets.push({ columns: r.columns, rows: r.rows });
    return out;
  } catch (e) {
    if (e instanceof SqlError) return fail(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- parse: canonical SQL → BuilderModel

class NotBuilder extends Error {}
const nb = (reason: string) => new NotBuilder(reason);
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

const CMP_OPS: Record<string, FilterOp> = { '=': 'eq', '<>': 'neq', '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' };

function litValue(e: Expr): FilterValue | undefined {
  if (e.k === 'lit') return typeof e.v === 'object' && e.v !== null ? undefined : (e.v as FilterValue);
  if (e.k === 'neg' && e.x.k === 'lit' && typeof e.x.v === 'number') return -e.x.v;
  if (e.k === 'cast') return litValue(e.x);
  return undefined;
}

/** `lower(x)` / `trim(x)` / `lower(trim(x))` around an inner expression. */
function unwrap(e: Expr): { inner: Expr; lower: boolean; trim: boolean } {
  let lower = false;
  let trim = false;
  let x = e;
  if (x.k === 'fn' && x.name === 'lower' && x.args.length === 1) { lower = true; x = x.args[0]; }
  if (x.k === 'fn' && x.name === 'trim' && x.args.length === 1) { trim = true; x = x.args[0]; }
  return { inner: x, lower, trim };
}

/** Parses canonical builder SQL into a model, or explains why it cannot. */
export function sqlToModel(engine: MockEngine, link: ConnectionProfile, sql: string): ParseResult {
  let sel: SelectAst;
  try {
    sel = parseSql(stripSqlComments(sql).trim().replace(/;\s*$/, ''));
  } catch (e) {
    return { model: null, reason: e instanceof Error ? e.message : String(e) };
  }
  try {
    return { model: toModel(engine, link, sel, sql) };
  } catch (e) {
    if (e instanceof NotBuilder) return { model: null, reason: e.message };
    if (e instanceof SqlError) return { model: null, reason: e.message };
    throw e;
  }
}

function toModel(engine: MockEngine, link: ConnectionProfile, sel: SelectAst, sql: string): BuilderModel {
  if (!sel.from) throw nb('The builder needs a table: the statement has no FROM clause.');
  const exprs: Expr[] = [];
  for (const it of sel.items) if (!it.star) exprs.push(it.expr);
  for (const j of sel.joins) if (j.on) exprs.push(j.on);
  if (sel.where) exprs.push(sel.where);
  exprs.push(...sel.groupBy, ...sel.orderBy.map((o) => o.expr));
  if (sel.having) exprs.push(sel.having);
  for (const e of exprs) walk(e, (x) => { if (x.k === 'param') throw nb(`The statement uses bind parameters ($${x.name}): put the values into the SQL before going back to the builder.`); });
  const raw = (e: Expr) => sql.slice(e.s, e.e).trim();

  const bound = bindSources(engine, link, sel);
  const tables: BuilderTable[] = bound.map(({ src, t }, i) => ({ id: `t${i + 1}`, alias: t.alias, table: t.linkName, as: src.alias ?? src.label, x: 40 + i * 320, y: 40, collapsed: false }));
  const asSeen = new Set<string>();
  for (const t of tables) {
    if (asSeen.has(lc(t.as))) throw nb(`The table alias "${t.as}" is used twice.`);
    asSeen.add(lc(t.as));
  }
  const bindings: Binding[] = bound.map(({ src, t }) => ({ name: src.alias ?? src.label, t, cols: t.columns.map((c) => c.name), rows: [] }));
  const scope = new Scope(bindings, bindings.length);
  const colOf = (e: Expr): { tableId: string; column: string } | null => {
    if (e.k !== 'col') return null;
    const [bi, ci] = scope.resolve(e.parts);
    return { tableId: tables[bi].id, column: bindings[bi].t.columns[ci].name };
  };
  const kindOf = (tableId: string, column: string): ColumnKind => {
    const i = tables.findIndex((t) => t.id === tableId);
    return bindings[i]?.t.columns.find((c) => c.name === column)?.kind ?? 'other';
  };

  // joins
  const joins: BuilderJoin[] = sel.joins.map((j, ji) => {
    const right = tables[ji + 1];
    const id = `j${ji + 1}`;
    if (j.type === 'cross') return { id, type: 'cross', left: tables[ji].id, right: right.id, on: [] };
    const conds = conjuncts(j.on);
    if (conds.length === 1 && conds[0].k === 'lit' && conds[0].v === true) return { id, type: j.type, left: tables[ji].id, right: right.id, on: [] };
    let left: string | null = null;
    const on: BuilderJoinCondition[] = conds.map((c) => {
      if (c.k !== 'bin' || !CMP_OPS[c.op]) throw nb(`The join of ${right.as} has a condition the builder cannot show: ${raw(c)}`);
      const a = unwrap(c.l);
      const b = unwrap(c.r);
      const ca = colOf(a.inner);
      const cb = colOf(b.inner);
      if (!ca || !cb || a.lower !== b.lower || a.trim !== b.trim) throw nb(`The join of ${right.as} has a condition the builder cannot show: ${raw(c)}`);
      let [l, r, op] = [ca, cb, c.op];
      if (ca.tableId === right.id) { [l, r] = [cb, ca]; op = op === '<' ? '>' : op === '>' ? '<' : op === '<=' ? '>=' : op === '>=' ? '<=' : op; }
      if (r.tableId !== right.id || l.tableId === right.id) throw nb(`Each condition of the join of ${right.as} must compare it with one earlier table.`);
      if (left && left !== l.tableId) throw nb(`The join of ${right.as} compares it with several tables; the builder joins two tables at a time.`);
      left = l.tableId;
      return { leftColumn: l.column, rightColumn: r.column, op: op as BuilderJoinCondition['op'], ignoreCase: a.lower, trim: a.trim };
    });
    return { id, type: j.type, left: left ?? tables[ji].id, right: right.id, on };
  });

  // columns
  const columns: BuilderColumn[] = [];
  const addColumn = (c: Omit<BuilderColumn, 'id'>): BuilderColumn => {
    const col: BuilderColumn = { id: `c${columns.length + 1}`, ...c };
    columns.push(col);
    return col;
  };
  const exprText = new Map<string, BuilderColumn>();
  const onlyStar = sel.items.length === 1 && sel.items[0].star && !sel.items[0].table;
  if (!onlyStar) {
    for (const it of sel.items) {
      if (it.star) {
        const idx = it.table ? bindings.findIndex((b) => lc(b.name) === lc(it.table!)) : -1;
        const which = it.table ? [idx] : bindings.map((_, i) => i);
        if (which.some((i) => i < 0)) throw nb(`Unknown table ${it.table}.*`);
        for (const i of which) for (const c of bindings[i].t.columns) addColumn({ tableId: tables[i].id, column: c.name, expr: null, alias: null, agg: null, output: true });
        continue;
      }
      const e = it.expr;
      let col: BuilderColumn;
      const plain = colOf(e);
      if (plain) col = addColumn({ ...plain, expr: null, alias: it.alias, agg: null, output: true });
      else if (e.k === 'fn' && AGGS.has(e.name) && ['count', 'sum', 'avg', 'min', 'max'].includes(e.name)) {
        if (e.distinct && e.name !== 'count') throw nb(`${e.name}(DISTINCT …) is not available in the builder.`);
        const agg: BuilderAggregate = e.name === 'count' && e.distinct ? 'countDistinct' : (e.name as BuilderAggregate);
        if (e.star || !e.args.length) col = addColumn({ tableId: null, column: null, expr: null, alias: it.alias, agg, output: true });
        else {
          if (e.args.length > 1 || hasAgg(e.args[0])) throw nb(`The builder cannot show ${raw(e)}.`);
          const inner = colOf(e.args[0]);
          col = addColumn(inner ? { ...inner, expr: null, alias: it.alias, agg, output: true } : { tableId: null, column: null, expr: raw(e.args[0]), alias: it.alias, agg, output: true });
        }
      } else {
        if (hasAgg(e)) throw nb(`The builder cannot show the expression ${raw(e)} (an aggregate inside an expression).`);
        compile(e, scope); // names must resolve
        col = addColumn({ tableId: null, column: null, expr: raw(e), alias: it.alias, agg: null, output: true });
      }
      exprText.set(norm(raw(e)), col);
    }
  }

  // WHERE
  let fseq = 0;
  const fid = (p: string) => `${p}${++fseq}`;
  const filterOf = (e: Expr, resolve: (side: Expr) => { column: string; kind: ColumnKind } | null): FilterNode => {
    if (e.k === 'bin' && (e.op === 'AND' || e.op === 'OR')) {
      const logic = e.op === 'AND' ? 'and' : 'or';
      const items: FilterNode[] = [];
      const flat = (x: Expr) => { if (x.k === 'bin' && x.op === e.op) { flat(x.l); flat(x.r); } else items.push(filterOf(x, resolve)); };
      flat(e);
      return { kind: 'group', id: fid('g'), logic, items };
    }
    const cond = (column: string, op: FilterOp, values: FilterValue[], caseSensitive?: boolean): FilterCondition => ({
      kind: 'condition', id: fid('f'), column, op, values, enabled: true, ...(caseSensitive !== undefined ? { caseSensitive } : {}),
    });
    const why = () => nb(`The builder cannot show the condition ${raw(e)}.`);
    const sideOf = (x: Expr) => {
      const u = unwrap(x);
      if (u.trim) return null;
      const r = resolve(u.inner);
      return r ? { ...r, lower: u.lower } : null;
    };
    const valOf = (x: Expr, lower: boolean): FilterValue => {
      const u = unwrap(x);
      if (u.lower !== lower || u.trim) throw why();
      const v = litValue(u.inner);
      if (v === undefined) throw why();
      return v;
    };
    const cs = (side: { kind: ColumnKind; lower: boolean }) => (side.kind === 'string' || side.kind === 'json' || side.kind === 'xml' || side.kind === 'guid' ? !side.lower : undefined);
    if (e.k === 'not') {
      if (e.x.k === 'like') {
        const c = filterOf(e.x, resolve);
        if (c.kind === 'condition' && c.op === 'contains') return { ...c, op: 'notContains' };
      }
      const inner = filterOf(e.x, resolve);
      return inner.kind === 'group' ? { ...inner, negate: !inner.negate } : { kind: 'group', id: fid('g'), logic: 'and', items: [inner], negate: true };
    }
    if (e.k === 'isnull') {
      const s = sideOf(e.x);
      if (!s || s.lower) throw why();
      return cond(s.column, e.not ? 'isNotNull' : 'isNull', []);
    }
    if (e.k === 'bin' && CMP_OPS[e.op]) {
      let l = e.l; let r = e.r; let op = e.op;
      if (!sideOf(l) && sideOf(r)) { [l, r] = [r, l]; op = op === '<' ? '>' : op === '>' ? '<' : op === '<=' ? '>=' : op === '>=' ? '<=' : op; }
      const s = sideOf(l);
      if (!s) throw why();
      if (r.k === 'lit' && typeof r.v === 'boolean' && op === '=') return cond(s.column, r.v ? 'isTrue' : 'isFalse', []);
      return cond(s.column, CMP_OPS[op], [valOf(r, s.lower)], cs(s));
    }
    if (e.k === 'between') {
      const s = sideOf(e.x);
      if (!s || e.not) throw why();
      return cond(s.column, 'between', [valOf(e.lo, s.lower), valOf(e.hi, s.lower)], cs(s));
    }
    if (e.k === 'in') {
      const s = sideOf(e.x);
      if (!s) throw why();
      return cond(s.column, e.not ? 'notIn' : 'in', e.list.map((x) => valOf(x, s.lower)), cs(s));
    }
    if (e.k === 'like') {
      const s = sideOf(e.x);
      if (!s || s.lower || e.not) throw why();
      const parts: Expr[] = [];
      const flat = (x: Expr) => { if (x.k === 'bin' && x.op === '||') { flat(x.l); flat(x.r); } else parts.push(x); };
      flat(e.pat);
      const strs = parts.map((p) => (p.k === 'lit' && typeof p.v === 'string' ? p.v : null));
      if (strs.some((x) => x === null)) throw why();
      let text = (strs as string[]).join('');
      const pre = text.startsWith('%');
      const post = text.endsWith('%') && !text.endsWith('\\%');
      text = text.slice(pre ? 1 : 0, post ? -1 : undefined);
      if (/(^|[^\\])[%_]/.test(text)) throw why();
      const value = text.replace(/\\([\\%_])/g, '$1');
      const op: FilterOp = pre && post ? 'contains' : post ? 'startsWith' : pre ? 'endsWith' : 'eq';
      return cond(s.column, op, [value], !e.ci);
    }
    throw why();
  };
  const whereResolve = (x: Expr) => {
    const c = colOf(x);
    return c ? { column: `${c.tableId}.${c.column}`, kind: kindOf(c.tableId, c.column) } : null;
  };
  const asGroup = (n: FilterNode): FilterGroup => (n.kind === 'group' ? n : { kind: 'group', id: fid('g'), logic: 'and', items: [n] });
  const filter = sel.where ? asGroup(filterOf(sel.where, whereResolve)) : null;

  // GROUP BY
  const outputs = columns.filter((c) => c.output !== false);
  const anyAgg = outputs.some((c) => !!c.agg);
  const nonAggTexts = sel.items.filter((it): it is Extract<SelectItem, { star: false }> => !it.star && !hasAgg(it.expr)).map((it) => norm(raw(it.expr)));
  const groupTexts = sel.groupBy.map((g) => norm(raw(g)));
  let autoGroup = true;
  let groupBy: BuilderRef[] = [];
  const autoMatches = anyAgg ? groupTexts.length === nonAggTexts.length && groupTexts.every((g, i) => g === nonAggTexts[i]) : groupTexts.length === 0;
  if (!autoMatches) {
    autoGroup = false;
    groupBy = sel.groupBy.map((g) => {
      const c = colOf(g);
      if (c) return { tableId: c.tableId, column: c.column };
      const m = exprText.get(norm(raw(g)));
      return m && !m.agg ? { columnId: m.id } : { expr: raw(g) };
    });
  }

  // HAVING: aggregates matched to output columns, else hidden helper columns
  const havingResolve = (x: Expr) => {
    if (x.k === 'col' && x.parts.length === 1) {
      const byAlias = columns.find((c) => c.alias && lc(c.alias) === lc(x.parts[0]));
      if (byAlias) return { column: byAlias.id, kind: byAlias.agg === 'count' || byAlias.agg === 'countDistinct' ? 'int' as ColumnKind : 'float' as ColumnKind };
    }
    if (x.k !== 'fn' || !AGGS.has(x.name)) return null;
    let col = exprText.get(norm(raw(x)));
    if (!col) {
      const agg: BuilderAggregate = x.name === 'count' && x.distinct ? 'countDistinct' : (x.name as BuilderAggregate);
      if (!['count', 'countDistinct', 'sum', 'avg', 'min', 'max'].includes(agg)) return null;
      const inner = x.star || !x.args.length ? null : colOf(x.args[0]);
      col = addColumn(inner ? { ...inner, expr: null, alias: null, agg, output: false }
        : { tableId: null, column: null, expr: x.star || !x.args.length ? null : raw(x.args[0]), alias: null, agg, output: false });
      exprText.set(norm(raw(x)), col);
    }
    const src = col.tableId && col.column ? kindOf(col.tableId, col.column) : 'other';
    const kind: ColumnKind = col.agg === 'count' || col.agg === 'countDistinct' ? 'int' : col.agg === 'avg' ? 'float' : col.expr || !col.column ? 'other' : src;
    return { column: col.id, kind };
  };
  const having = sel.having ? asGroup(filterOf(sel.having, havingResolve)) : null;

  // ORDER BY
  const sort: BuilderSort[] = sel.orderBy.map((o) => {
    let ref: BuilderRef;
    const e = o.expr;
    if (e.k === 'lit' && typeof e.v === 'number' && Number.isInteger(e.v)) {
      const c = outputs[e.v - 1];
      if (!c) throw nb(`ORDER BY ${e.v} is out of range.`);
      ref = { columnId: c.id };
    } else if (e.k === 'col' && e.parts.length === 1 && columns.some((c) => c.output !== false && c.alias && lc(c.alias) === lc(e.parts[0]))) {
      ref = { columnId: columns.find((c) => c.output !== false && c.alias && lc(c.alias) === lc(e.parts[0]))!.id };
    } else {
      const c = colOf(e);
      if (c) ref = { tableId: c.tableId, column: c.column };
      else {
        const m = exprText.get(norm(raw(e)));
        ref = m ? { columnId: m.id } : { expr: raw(e) };
      }
    }
    return { ref, dir: o.dir, nulls: o.nulls };
  });

  return {
    version: 1, tables, joins, columns, filter, groupBy, autoGroup, having, sort,
    limit: sel.limit, offset: sel.offset, distinct: sel.distinct,
  };
}

// ---------------------------------------------------------------- push-down plan

const PUSH_OPS: Record<string, PushdownOp> = { '=': '=', '<>': '<>', '<': '<', '>': '>', '<=': '<=', '>=': '>=' };

function literalSql(v: CellValue, dialect: Dialect): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return dialect === 'tsql' || dialect === 'plsql' || dialect === 'sqlite' ? (v ? '1' : '0') : v ? 'TRUE' : 'FALSE';
  const s = `'${String(v).replace(/'/g, "''")}'`;
  return dialect === 'tsql' ? `N${s}` : s;
}

function kindToken(v: CellValue): string {
  return typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'decimal') : typeof v === 'boolean' ? 'bool' : 'string';
}

/** The plan of `sql` on the link: what each source is asked for. */
export function planOf(state: PackState, link: ConnectionProfile, sql: string, params: QueryParam[]): PushdownPlan {
  const engine = state.engine;
  const text = params.length ? inlineParams(sql, params, 'duckdb') : sql;
  const warnings: PlanWarning[] = [];
  const cache = cacheOf(state, link.id);
  const mounted = mountedTables(engine, link);
  const fetchPlan = (t: Mounted, cols: string[], preds: { p: PushdownPredicate; sql: string; test: Compiled | null }[], limit: number | null, rowsCount: number | null): SourceFetchPlan => {
    const d = t.dialect;
    const qcols = (cols.length ? cols : [t.columns[0].name]).map((c) => quoteIdent(c, d)).join(', ');
    const from = `${quoteIdent(t.schema, d)}.${quoteIdent(t.source, d)}`;
    const where = preds.length ? ` WHERE ${preds.map((x) => x.sql).join(' AND ')}` : '';
    const sourceQuery = d === 'tsql'
      ? `SELECT ${limit !== null ? `TOP ${limit} ` : ''}${qcols} FROM ${from}${where}`
      : d === 'plsql' ? `SELECT ${qcols} FROM ${from}${where}${limit !== null ? ` FETCH FIRST ${limit} ROWS ONLY` : ''}`
        : `SELECT ${qcols} FROM ${from}${where}${limit !== null ? ` LIMIT ${limit}` : ''}`;
    const hit = cache.get(`${t.alias}.${t.linkName}`);
    return {
      table: { alias: t.alias, table: t.linkName }, connectionId: t.connectionId, providerId: t.providerId, sourceQuery,
      columns: cols, predicates: preds.map((x) => x.p), limit, maxRows: 2_000_000, rows: rowsCount, truncated: false,
      cached: !!hit, fetchedAt: hit?.fetchedAt ?? null, elapsedMs: hit?.ms ?? null,
    };
  };
  let sel: SelectAst;
  try {
    sel = parseSql(stripSqlComments(text).trim().replace(/;\s*$/, ''));
  } catch {
    // fallback analyzer: every alias.table named in the text, all columns, no predicates
    const sources = mounted.filter((t) => new RegExp(`\\b${t.alias}\\s*\\.\\s*"?${t.linkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?\\b`, 'i').test(text))
      .map((t) => fetchPlan(t, t.columns.map((c) => c.name), [], null, t.fixture.rowCount));
    return { engine: 'duckdb', parsed: false, sources, warnings: [{ code: 'fallback', message: 'The statement could not be analysed: every referenced table is read in full.' }] };
  }
  let bound: { src: Src; t: Mounted }[];
  try {
    bound = bindSources(engine, link, sel);
  } catch (e) {
    return { engine: 'duckdb', parsed: true, sources: [], warnings: [{ code: 'fallback', message: e instanceof Error ? e.message : String(e) }] };
  }
  const bindings: Binding[] = bound.map(({ src, t }) => ({ name: src.alias ?? src.label, t, cols: t.columns.map((c) => c.name), rows: [] }));
  const scope = new Scope(bindings, bindings.length);
  const used = bindings.map(() => new Set<string>());
  const all = bindings.map(() => false);
  for (const it of sel.items) {
    if (it.star) bindings.forEach((b, i) => { if (!it.table || lc(b.name) === lc(it.table)) all[i] = true; });
  }
  const exprs: Expr[] = [];
  for (const it of sel.items) if (!it.star) exprs.push(it.expr);
  for (const j of sel.joins) if (j.on) exprs.push(j.on);
  if (sel.where) exprs.push(sel.where);
  exprs.push(...sel.groupBy, ...sel.orderBy.map((o) => o.expr));
  if (sel.having) exprs.push(sel.having);
  for (const e of exprs) walk(e, (x) => {
    if (x.k !== 'col') return;
    try { const [bi, ci] = scope.resolve(x.parts); used[bi].add(bindings[bi].t.columns[ci].name); } catch { /* aliases of the select list */ }
  });
  // null-supplying sides of outer joins get no pushed predicates
  const nullable = bindings.map(() => false);
  sel.joins.forEach((j, ji) => {
    if (j.type === 'left' || j.type === 'full') nullable[ji + 1] = true;
    if (j.type === 'right' || j.type === 'full') for (let i = 0; i <= ji; i++) nullable[i] = true;
    if (j.type === 'cross' || (j.on && conjuncts(j.on).every((c) => c.k === 'lit' && c.v === true))) {
      warnings.push({ code: 'cartesian', message: `${bindings[ji + 1].name} is combined with every row of the tables before it (no join condition).`, table: { alias: bindings[ji + 1].t.alias, table: bindings[ji + 1].t.linkName } });
    }
    for (const c of conjuncts(j.on)) {
      if (c.k !== 'bin' || c.op !== '=' || c.l.k !== 'col' || c.r.k !== 'col') continue;
      try {
        const [lb, lci] = scope.resolve(c.l.parts);
        const [rb, rci] = scope.resolve(c.r.parts);
        const lk = bindings[lb].t.columns[lci].kind;
        const rk = bindings[rb].t.columns[rci].kind;
        const cls = (k: ColumnKind) => (numClass(k) ? 'n' : k === 'string' || k === 'guid' ? 's' : k);
        if (cls(lk) !== cls(rk)) warnings.push({ code: 'joinKinds', message: `${raw(c.l)} (${lk}) is compared with ${raw(c.r)} (${rk}): values are converted before they are compared.` });
      } catch { /* unresolved */ }
    }
  });
  function raw(e: Expr) { return text.slice(e.s, e.e).trim(); }
  const preds = bindings.map(() => [] as { p: PushdownPredicate; sql: string; test: Compiled | null }[]);
  let allPushed = true;
  for (const c of conjuncts(sel.where)) {
    const refs = refsOf(c, scope);
    const single = refs.size === 1 && !refs.has(-1) ? [...refs][0] : -1;
    let pushed: { p: PushdownPredicate; col: string; tail: string } | null = null;
    if (single >= 0 && !nullable[single]) {
      const colName = (x: Expr) => (x.k === 'col' ? bindings[single].t.columns[scope.resolve(x.parts)[1]].name : null);
      if (c.k === 'bin' && PUSH_OPS[c.op] && c.l.k === 'col' && litValue(c.r) !== undefined) {
        const v = litValue(c.r)!;
        pushed = { col: colName(c.l)!, p: { column: colName(c.l)!, op: PUSH_OPS[c.op], values: [{ kind: kindToken(v), value: String(v) }] }, tail: `${c.op} ${literalSql(v, bindings[single].t.dialect)}` };
      } else if (c.k === 'between' && !c.not && c.x.k === 'col' && litValue(c.lo) !== undefined && litValue(c.hi) !== undefined) {
        const a = litValue(c.lo)!; const b = litValue(c.hi)!; const d = bindings[single].t.dialect;
        pushed = { col: colName(c.x)!, p: { column: colName(c.x)!, op: 'between', values: [a, b].map((v) => ({ kind: kindToken(v), value: String(v) })) }, tail: `BETWEEN ${literalSql(a, d)} AND ${literalSql(b, d)}` };
      } else if (c.k === 'in' && !c.not && c.x.k === 'col' && c.list.every((x) => litValue(x) !== undefined)) {
        const vs = c.list.map((x) => litValue(x)!); const d = bindings[single].t.dialect;
        pushed = { col: colName(c.x)!, p: { column: colName(c.x)!, op: 'in', values: vs.map((v) => ({ kind: kindToken(v), value: String(v) })) }, tail: `IN (${vs.map((v) => literalSql(v, d)).join(', ')})` };
      } else if (c.k === 'like' && !c.ci && !c.not && c.x.k === 'col' && c.pat.k === 'lit' && typeof c.pat.v === 'string') {
        pushed = { col: colName(c.x)!, p: { column: colName(c.x)!, op: 'like', values: [{ kind: 'string', value: c.pat.v }] }, tail: `LIKE ${literalSql(c.pat.v, bindings[single].t.dialect)}` };
      } else if (c.k === 'isnull' && c.not && c.x.k === 'col') {
        pushed = { col: colName(c.x)!, p: { column: colName(c.x)!, op: 'isNotNull', values: [] }, tail: 'IS NOT NULL' };
      }
    }
    if (pushed) {
      let test: Compiled | null = null;
      try { test = compile(c, new Scope(bindings, bindings.length)); } catch { test = null; }
      preds[single].push({ p: pushed.p, sql: `${quoteIdent(pushed.col, bindings[single].t.dialect)} ${pushed.tail}`, test });
    } else allPushed = false;
  }
  const grouped = sel.groupBy.length > 0 || sel.items.some((it) => !it.star && hasAgg(it.expr));
  const singleLimit = bindings.length === 1 && !grouped && !sel.distinct && !sel.orderBy.length && allPushed && sel.limit !== null ? sel.limit + (sel.offset ?? 0) : null;
  const sources = bindings.map((b, i) => {
    const cols = all[i] ? b.t.columns.map((c) => c.name) : b.t.columns.map((c) => c.name).filter((c) => used[i].has(c));
    let rows: number | null = b.t.fixture.rowCount;
    if (preds[i].length) {
      try {
        const data = readSource(state, b.t);
        rows = data.filter((r) => {
          const row: Row = new Array(bindings.length).fill(null);
          row[i] = r;
          return preds[i].every((p) => !p.test || p.test.fn(row, null) === true);
        }).length;
      } catch { rows = null; }
    }
    if (singleLimit !== null && rows !== null) rows = Math.min(rows, singleLimit);
    return fetchPlan(b.t, cols, preds[i], singleLimit, rows);
  });
  if (sel.limit !== null && !sel.orderBy.length) warnings.push({ code: 'limitWithoutOrder', message: 'LIMIT without ORDER BY: which rows come back is arbitrary.' });
  for (const s of sources) {
    const t = bindings.find((b) => b.t.alias === s.table.alias && b.t.linkName === s.table.table)!.t;
    if (!s.predicates.length && s.limit === null && t.fixture.rowCount > 1000) {
      warnings.push({ code: 'fullScan', message: `${s.table.alias}.${s.table.table} is read in full (${t.fixture.rowCount.toLocaleString('en-US')} rows): a filter on it fetches less.`, table: s.table });
    }
  }
  const cachedCount = sources.filter((s) => s.cached).length;
  if (cachedCount) warnings.push({ code: 'cached', message: `${cachedCount} of ${sources.length} source${sources.length === 1 ? '' : 's'} come from the session cache (Refresh sources reads them again).` });
  return { engine: 'duckdb', parsed: true, sources, warnings };
}

// ---------------------------------------------------------------- validate

export function validateDefinition(engine: MockEngine, def: LinkDefinition, id: string | null): { ok: boolean; problems: LinkProblem[]; members: LinkMemberStatus[] } {
  const problems: LinkProblem[] = [];
  const members: LinkMemberStatus[] = [];
  if (!def.members.length) problems.push({ severity: 'error', code: 'empty', message: 'Add at least one source.' });
  const aliases = new Map<string, number>();
  def.members.forEach((m, i) => {
    const err = (code: string, message: string, table?: string) => problems.push({ severity: 'error', code, message, member: i, ...(table ? { table } : {}) });
    const warn = (code: string, message: string, table?: string) => problems.push({ severity: 'warning', code, message, member: i, ...(table ? { table } : {}) });
    if (RESERVED_ALIASES.has(lc(m.alias))) err('aliasReserved', `“${m.alias}” is reserved; choose another alias.`);
    else if (!isValidAlias(m.alias)) err('aliasInvalid', `“${m.alias}” is not a valid alias: lower-case letters, digits and _, starting with a letter or _, not an SQL key word.`);
    if (aliases.has(lc(m.alias))) err('aliasDuplicate', `The alias “${m.alias}” is used by source ${(aliases.get(lc(m.alias)) ?? 0) + 1} too.`);
    else aliases.set(lc(m.alias), i);
    const conn = m.connectionId ? engine.conn(m.connectionId) : undefined;
    let tables: number | null = null;
    const rawScope = typeof m.scope === 'string' && m.scope.trim() ? lc(m.scope.trim()) : null;
    const scope = memberScopeOf(m);
    if (rawScope && !LINK_SCOPES.includes(rawScope as LinkScope)) err('scopeInvalid', `“${m.scope}” is not a scope: tables, schema, database or connection.`);
    else if (m.kind === 'files' && rawScope && rawScope !== 'tables') err('scopeInvalid', 'A files source mounts its files one by one; it has no wider scope.');
    if (m.kind !== 'files') {
      if (!conn) err('memberMissing', 'The connection of this source does not exist (any more).');
      else if (conn.id === id || isLinkConn(conn)) err('memberLinked', 'A linked database cannot be a source of another one.');
      else if ((engine.providers().find((p) => p.id === conn.providerId)?.kind ?? 'relational') !== 'relational') err('memberUnsupported', `${conn.name} (${conn.providerId}) cannot be a source yet.`);
      else if (isWideScope(scope)) {
        const w = wideInfo(engine, m, i);
        tables = w ? containerTables(engine, w, w.defaultPath)?.length ?? 0 : 0;
        if (w && !w.levels.length) {
          warn('scopeNarrowed', `${conn.name} has nothing wider to span: ${m.alias} mounts the tables of ${w.defaultSchema}, like a whole schema.`);
        }
      } else {
        const st = schemaState(engine, conn.id, m.schema ?? engine.defaultSchema(conn.id));
        const available = st ? [...st.tables.values()].map((t) => t.name) : [];
        tables = scope !== 'tables' ? available.length : m.tables.length;
        if (scope === 'tables') {
          for (const t of m.tables) if (!available.some((a) => lc(a) === lc(t.name))) warn('tableMissing', `${t.name} was not found in ${conn.name}.`, t.name);
        }
      }
    }
    if (scope === 'tables' && !m.tables.length) err('noTables', 'Choose at least one table, or mount all tables.');
    const names = new Set<string>();
    for (const t of m.tables) {
      const n = linkTableName(t);
      if (!isValidTableName(n)) err('tableInvalid', `“${n}” is not a valid table name.`, t.name);
      if (names.has(lc(n))) err('tableDuplicate', `Two tables of ${m.alias} are called “${n}”.`, t.name);
      names.add(lc(n));
    }
    members.push({ index: i, alias: m.alias, providerId: conn?.providerId ?? null, reachable: conn ? true : null, tables, error: conn ? null : 'Connection not found' });
  });
  def.relations.forEach((r, i) => {
    const ok = (ref: { alias: string; table: string }) => def.members.some((m) => m.alias === ref.alias);
    if (!ok(r.from) || !ok(r.to) || r.fromColumns.length !== r.toColumns.length || !r.fromColumns.length) {
      problems.push({ severity: 'warning', code: 'relationInvalid', message: `The relation ${r.name ?? r.id} refers to a source or columns that are not there.`, relation: i });
    }
  });
  return { ok: !problems.some((p) => p.severity === 'error'), problems, members };
}

// ---------------------------------------------------------------- linked views

function viewsOf(state: PackState, linkId: string): LinkedView[] {
  let v = state.views.get(linkId);
  if (!v) state.views.set(linkId, (v = []));
  return v;
}

function seedViews(state: PackState): void {
  const model: BuilderModel = {
    version: 1,
    tables: [
      { id: 't1', alias: 'crm', table: 'customers', as: 'customers', x: 40, y: 60, collapsed: false },
      { id: 't2', alias: 'shop', table: 'orders', as: 'orders', x: 400, y: 60, collapsed: false },
      { id: 't3', alias: 'crm', table: 'countries', as: 'countries', x: 40, y: 360, collapsed: false },
    ],
    joins: [
      { id: 'j1', type: 'inner', left: 't1', right: 't2', on: [{ leftColumn: 'id', rightColumn: 'customer_id', op: '=', ignoreCase: false, trim: false }] },
      { id: 'j2', type: 'left', left: 't1', right: 't3', on: [{ leftColumn: 'country_id', rightColumn: 'id', op: '=', ignoreCase: false, trim: false }] },
    ],
    columns: [
      { id: 'c1', tableId: 't3', column: 'name', expr: null, alias: 'country', agg: null, output: true },
      { id: 'c2', tableId: null, column: null, expr: null, alias: 'orders', agg: 'count', output: true },
      { id: 'c3', tableId: 't2', column: 'total', expr: null, alias: 'revenue', agg: 'sum', output: true },
    ],
    filter: null, groupBy: [], autoGroup: true, having: null, sort: [{ ref: { columnId: 'c3' }, dir: 'desc', nulls: null }], limit: 20, offset: null, distinct: false,
  };
  const sql = compileBuilder(model, {}).sql;
  putView(state, 'c_link', 'lv_seed_1', { name: 'Revenue by country', description: 'CRM customers × shop orders, top 20 countries', sql, builder: model }, PACK_NOW);
}

function putView(state: PackState, linkId: string, id: string, input: LinkedViewInput, at = new Date().toISOString()): LinkedView {
  const list = viewsOf(state, linkId);
  const cur = list.find((v) => v.id === id);
  const view: LinkedView = {
    id, connectionId: linkId, name: input.name.trim(), description: input.description?.trim() || null, sql: input.sql, builder: input.builder ?? null,
    createdAt: cur?.createdAt ?? at, updatedAt: at,
  };
  if (cur) list[list.indexOf(cur)] = view; else list.push(view);
  // mirror into the link's saved queries (explorer: the "views" schema's Queries folder, Ctrl+P)
  const saved = savedQueryStore(state.engine);
  const i = saved.findIndex((q) => q.id === id);
  const q = { id, connectionId: linkId, database: null, schema: LINK_VIEWS_SCHEMA, name: view.name, sql: view.sql, description: view.description, createdAt: view.createdAt, updatedAt: view.updatedAt };
  if (i >= 0) saved[i] = q; else saved.push(q);
  return view;
}

// ---------------------------------------------------------------- handlers

function err(status: number, code: string, message: string, detail?: unknown) {
  return HttpResponse.json({ error: { code, message, detail } }, { status });
}

/** The pack's state of an engine (created by its handlers; tests reach the evaluator through it). */
export function linkedMockState(engine: MockEngine): PackState | undefined {
  return STATES.get(engine);
}

function install(engine: MockEngine): PackState {
  const existing = STATES.get(engine);
  if (existing) return existing;
  const eng = engine as unknown as EngineInternals;
  const base = engine.interpret.bind(engine);
  const state: PackState = { engine, base, cache: new Map(), views: new Map() };
  STATES.set(engine, state);

  const baseSchemas = eng.schemasFor.bind(engine);
  eng.schemasFor = (cid: string) => {
    const c = engine.conn(cid);
    if (!c || !isLinkConn(c)) return baseSchemas(cid);
    const hit = eng.catalogs.get(cid);
    if (hit) return hit;
    const m = linkSchemas(engine, c);
    eng.catalogs.set(cid, m);
    return m;
  };
  const baseDefault = engine.defaultSchema.bind(engine);
  engine.defaultSchema = (cid: string) => {
    const c = engine.conn(cid);
    return c && isLinkConn(c) ? linkDefinitionOf(c).members[0]?.alias ?? LINK_VIEWS_SCHEMA : baseDefault(cid);
  };
  const baseDatabases = engine.databases.bind(engine);
  engine.databases = (cid: string) => (isLinkConn(engine.conn(cid)) ? { databases: [], current: null } : baseDatabases(cid));
  // a changed definition: the link's cached catalog and source rows go
  const baseUpdate = engine.updateConnection.bind(engine);
  engine.updateConnection = (id, input) => {
    const r = baseUpdate(id, input);
    if (isLinkConn(r)) state.cache.delete(id);
    return r;
  };

  const baseExecute = engine.execute.bind(engine);
  engine.execute = (sid, req) => {
    const s = engine.sessions.get(sid);
    if (s && isLinkConn(engine.conn(s.connectionId)) && req.params?.length) {
      const params = req.params;
      return baseExecute(sid, { ...req, batches: req.batches.map((b) => ({ ...b, sql: inlineParams(b.sql, params, 'duckdb') })), params: null });
    }
    return baseExecute(sid, req);
  };
  engine.interpret = (s, sqlRaw) => {
    const c = engine.conn(s.connectionId);
    return c && isLinkConn(c) ? interpretLinked(state, c, sqlRaw) : base(s, sqlRaw);
  };
  seedViews(state);
  return state;
}

function createLinkedHandlers(ctx: M2MockContext): RequestHandler[] {
  const { engine, ok } = ctx;
  const state = install(engine);
  const P = `${M2_PREFIX}/links`;
  const link = (cid: string) => {
    const c = engine.conn(cid);
    return c && isLinkConn(c) ? c : null;
  };
  const notLink = (cid: string) => err(404, 'NOT_FOUND', `Connection '${cid}' is not a linked database.`);
  return [
    http.get(`${P}/engine`, () => ok({ engine: 'duckdb', version: 'v1.5.6 (mock)', serializeSql: true, error: null })),
    http.post(`${P}/validate`, async ({ request }) => {
      const b = (await request.json()) as LinkValidateRequest;
      const def: LinkDefinition = { version: b.definition?.version ?? 1, members: b.definition?.members ?? [], relations: b.definition?.relations ?? [], options: b.definition?.options ?? {} };
      return ok(validateDefinition(engine, { ...def, members: def.members.map((m) => ({ ...m, tables: m.tables ?? [] })) }, b.id ?? null) as never);
    }),
    http.get(`${P}/:cid/catalog`, ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      if (new URL(request.url).searchParams.get('refresh') === 'true') (engine as unknown as EngineInternals).catalogs.delete(c.id);
      return ok(linkCatalog(engine, c) as never);
    }),
    http.post(`${P}/:cid/compile`, async ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const b = (await request.json()) as CompileRequest;
      if (!b.model?.tables?.length) return err(400, 'VALIDATION', 'The query has no table.', { field: 'tables' });
      const cc = compileCatalogFor(engine, c, b.model);
      const r: CompileResult = compileBuilder(b.model, cc.catalog, cc.paths);
      if (b.plan) r.plan = planOf(state, c, r.sql, r.params);
      return ok(r as never);
    }),
    http.post(`${P}/:cid/parse`, async ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const b = (await request.json()) as { sql: string };
      return ok(sqlToModel(engine, c, b.sql ?? '') as never);
    }),
    http.post(`${P}/:cid/plan`, async ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const b = (await request.json()) as PlanRequest;
      return ok(planOf(state, c, b.sql ?? '', b.params ?? []) as never);
    }),
    http.get(`${P}/:cid/views`, ({ params }) => {
      const c = link(String(params.cid));
      return c ? ok(viewsOf(state, c.id) as never) : notLink(String(params.cid));
    }),
    http.put(`${P}/:cid/views/:id`, async ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const b = (await request.json()) as LinkedViewInput;
      const name = (b.name ?? '').trim();
      if (!name) return err(400, 'VALIDATION', 'name is required.', { field: 'name' });
      if (!(b.sql ?? '').trim()) return err(400, 'VALIDATION', 'sql is required.', { field: 'sql' });
      let id = String(params.id);
      const list = viewsOf(state, c.id);
      if (id !== 'new' && !list.some((v) => v.id === id)) return err(404, 'NOT_FOUND', `Linked view '${id}' was not found.`);
      const clash = list.find((v) => v.id !== id && lc(v.name) === lc(name));
      if (clash) return err(400, 'VALIDATION', `A linked view named '${clash.name}' already exists.`, { field: 'name', reason: 'duplicate', id: clash.id });
      if (id === 'new') id = `lv_mock_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
      return ok(putView(state, c.id, id, { ...b, name }) as never);
    }),
    http.delete(`${P}/:cid/views/:id`, ({ params }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const list = viewsOf(state, c.id);
      const i = list.findIndex((v) => v.id === String(params.id));
      if (i < 0) return err(404, 'NOT_FOUND', `Linked view '${String(params.id)}' was not found.`);
      list.splice(i, 1);
      const saved = savedQueryStore(engine);
      const k = saved.findIndex((q) => q.id === String(params.id));
      if (k >= 0) saved.splice(k, 1);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`${P}/:cid/refresh-sources`, async ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const b = (await request.json().catch(() => ({}))) as { tables?: { alias: string; table: string }[] | null };
      const cache = cacheOf(state, c.id);
      let invalidated = 0;
      if (b?.tables?.length) {
        for (const t of b.tables) if (cache.delete(`${t.alias}.${t.table}`)) invalidated++;
      } else {
        invalidated = cache.size;
        cache.clear();
      }
      return ok({ invalidated });
    }),
    http.post(`${P}/:cid/browse`, async ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const b = (await request.json().catch(() => ({}))) as LinkBrowseRequest;
      try {
        return ok(browseLink(engine, c, b) as never);
      } catch (e) {
        const x = e as { status?: number; code?: string; message?: string };
        if (typeof x.status === 'number') return err(x.status, x.code ?? 'VALIDATION', x.message ?? 'Cannot browse.');
        throw e;
      }
    }),
    http.post(`${P}/:cid/resolve`, async ({ params, request }) => {
      const c = link(String(params.cid));
      if (!c) return notLink(String(params.cid));
      const b = (await request.json().catch(() => ({}))) as LinkResolveRequest;
      return ok(resolveLinkTables(engine, c, b) as never);
    }),
    http.post(`${P}/:cid/materialize/preview`, () => err(501, 'NOT_SUPPORTED', 'Materialize is not available in the mock engine yet.')),
    http.post(`${P}/:cid/materialize`, () => err(501, 'NOT_SUPPORTED', 'Materialize is not available in the mock engine yet.')),
    http.post(`${P}/:cid/native-script`, () => err(501, 'NOT_SUPPORTED', 'Native link scripts are not available in the mock engine yet.')),
  ];
}

export const linkedPack: MockProviderPack = {
  providers: [LINKED_PROVIDER],
  connections: linkedConnections,
  extraObjects: {},
  handlers: createLinkedHandlers,
};
