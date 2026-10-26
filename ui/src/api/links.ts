// Linked databases (plan-links): wire mirror of engine/src/DbStudio.Federation/Contracts/*.cs (FROZEN by WP0: change
// them together, through an R3 request, docs/wp-notes/links/wp0.md) plus the naming rules every package shares and the
// /links REST client. NOT part of the initial bundle: import it only from lazy code (components/Links/**, the links
// commands chunk); the shell reaches links through runCommand('links.*') and the provider id 'linked'.
import { http } from './client';
import type { CatalogObjectType, ColumnInfo, ConnectionProfile, Dialect, JobStarted, QueryParam } from './types';
import type { FilterGroup } from '../filter/model';
import type { M2Http } from './client';

// ---------------------------------------------------------------- ids

/** ConnectionProfile.providerId of a link (dialect 'duckdb'). */
export const LINK_PROVIDER_ID = 'linked' as const;
/** Explorer folder new links go to. */
export const LINK_DEFAULT_FOLDER = 'Linked databases';
/** Schema under which linked views are saved (saved queries of the link). Never a member alias. */
export const LINK_VIEWS_SCHEMA = 'views';
/** Keys of a link profile's props. */
export const LINK_PROPS = { members: 'members', relations: 'relations', options: 'options', version: 'linkVersion' } as const;
export const LINK_VERSION = 1;

/**
 * Context menu ids of the query builder tab (registered by WP-C with registerContextMenu). The explorer ones
 * (explorer.link, explorer.linkTable) are commands/menuModel.ts LINK_MENU_IDS.
 */
export const BUILDER_MENU_IDS = {
  /** Canvas background: Add table…, Auto layout, Fit view. */
  canvas: 'builder.canvas',
  /** A table card: Select all columns, Remove, Collapse. */
  table: 'builder.table',
  /** A column row of a card: Add to output, Filter on…, Sort by. */
  column: 'builder.column',
  /** A join edge: INNER / LEFT / RIGHT / FULL / CROSS, Edit conditions…, Remove. */
  join: 'builder.join',
} as const;

// ---------------------------------------------------------------- definition (Contracts/LinkModels.cs)

export type LinkMemberKind = 'connection' | 'files';

/** A mounted table: source `name`, shown in the link as `as ?? name`. */
export interface MountedTable {
  name: string;
  as?: string | null;
  /** ObjectType token, or 'collection' | 'index' | 'file'. */
  type?: string | null;
  /** Fetcher options (files: format csv | tsv | json | ndjson | xlsx | parquet, sheet, delimiter, header, encoding). */
  options?: Record<string, unknown> | null;
}

export interface LinkMember {
  /** Schema name inside the link: see isValidAlias. */
  alias: string;
  kind?: LinkMemberKind;
  connectionId?: string | null;
  database?: string | null;
  schema?: string | null;
  /** Mount every table and view of the schema; `tables` then only carries renames. */
  allTables?: boolean;
  tables: MountedTable[];
  label?: string | null;
}

export interface LinkTableRef {
  alias: string;
  table: string;
}

/** A user-declared relation (like a foreign key: `from` = many side, `to` = one side). */
export interface VirtualRelation {
  id: string;
  name?: string | null;
  from: LinkTableRef;
  fromColumns: string[];
  to: LinkTableRef;
  toColumns: string[];
}

export interface LinkOptions {
  maxRowsPerSource?: number | null;
  fetchTimeoutSeconds?: number | null;
  cacheSources?: boolean | null;
  engine?: 'duckdb' | 'sqlite' | null;
}

export interface LinkDefinition {
  version: number;
  members: LinkMember[];
  relations: VirtualRelation[];
  options: LinkOptions;
}

/** The name SQL uses for a mounted table. */
export function linkTableName(t: MountedTable): string {
  return t.as ? t.as : t.name;
}

/** Reads a link profile's definition (tolerant, like LinkDefinition.FromProfile). */
export function linkDefinitionOf(profile: Pick<ConnectionProfile, 'props'>): LinkDefinition {
  const p = profile.props ?? {};
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    version: typeof p[LINK_PROPS.version] === 'number' ? (p[LINK_PROPS.version] as number) : LINK_VERSION,
    members: arr<LinkMember>(p[LINK_PROPS.members]).map((m) => ({ ...m, tables: arr<MountedTable>(m.tables) })),
    relations: arr<VirtualRelation>(p[LINK_PROPS.relations]),
    options: (p[LINK_PROPS.options] && typeof p[LINK_PROPS.options] === 'object' ? p[LINK_PROPS.options] : {}) as LinkOptions,
  };
}

/** The props a link profile is saved with (merge into ConnectionInput.props; other keys are kept by the caller). */
export function linkProps(def: LinkDefinition): Record<string, unknown> {
  return {
    [LINK_PROPS.version]: def.version,
    [LINK_PROPS.members]: def.members,
    [LINK_PROPS.relations]: def.relations,
    [LINK_PROPS.options]: def.options,
  };
}

// ---------------------------------------------------------------- naming rules (Contracts/LinkSql.cs LinkRules)

export const LINK_MAX_NAME_LENGTH = 63;
/** Aliases a member cannot take (case-insensitive). */
export const RESERVED_ALIASES: ReadonlySet<string> = new Set(['main', 'temp', 'system', 'memory', 'information_schema', 'pg_catalog', LINK_VIEWS_SCHEMA]);
/** PostgreSQL reserved words (same list as lib/sql.ts PG_RESERVED and LinkSql.Reserved): no alias may be one. */
const RESERVED_WORDS = new Set(
  ('ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC AUTHORIZATION BINARY BOTH CASE CAST CHECK COLLATE COLLATION COLUMN '
    + 'CONCURRENTLY CONSTRAINT CREATE CROSS CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE CURRENT_SCHEMA CURRENT_TIME CURRENT_TIMESTAMP '
    + 'CURRENT_USER DEFAULT DEFERRABLE DESC DISTINCT DO ELSE END EXCEPT FALSE FETCH FOR FOREIGN FREEZE FROM FULL GRANT GROUP HAVING '
    + 'ILIKE IN INITIALLY INNER INTERSECT INTO IS ISNULL JOIN LATERAL LEADING LEFT LIKE LIMIT LOCALTIME LOCALTIMESTAMP NATURAL NOT '
    + 'NOTNULL NULL OFFSET ON ONLY OR ORDER OUTER OVERLAPS PLACING PRIMARY REFERENCES RETURNING RIGHT SELECT SESSION_USER SIMILAR '
    + 'SOME SYMMETRIC SYSTEM_USER TABLE TABLESAMPLE THEN TO TRAILING TRUE UNION UNIQUE USER USING VARIADIC VERBOSE WHEN WHERE '
    + 'WINDOW WITH').split(' '),
);

/** Lower-case identifier ≤ 63 chars, not a reserved word or alias. */
export function isValidAlias(alias: string): boolean {
  return alias.length > 0 && alias.length <= LINK_MAX_NAME_LENGTH && /^[a-z_][a-z0-9_]*$/.test(alias)
    && !RESERVED_WORDS.has(alias.toUpperCase()) && !RESERVED_ALIASES.has(alias.toLowerCase());
}

/** A mounted table name: non-empty, ≤ 63 chars, no control characters, no surrounding spaces (any case). */
export function isValidTableName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.length > 0 && name.length <= LINK_MAX_NAME_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/.test(name) && name.trim() === name;
}

/** Alias proposal (LinkRules.Slugify): a-z/0-9 kept, other runs → "_", trimmed, leading digit → "_", cut to 63; "" → "db". */
export function slugifyAlias(name: string): string {
  let out = '';
  let pending = false;
  for (const raw of name) {
    const c = raw >= 'A' && raw <= 'Z' ? raw.toLowerCase() : raw;
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
      if (pending && out.length > 0) out += '_';
      pending = false;
      out += c;
    } else pending = true;
  }
  if (!out) return 'db';
  if (out[0] >= '0' && out[0] <= '9') out = `_${out}`;
  return out.length > LINK_MAX_NAME_LENGTH ? out.slice(0, LINK_MAX_NAME_LENGTH).replace(/_+$/, '') : out;
}

/** `proposal` when valid and free (case-insensitive), else proposal_2, proposal_3… (LinkRules.UniqueAlias). */
export function uniqueAlias(proposal: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (isValidAlias(proposal) && !used.has(proposal.toLowerCase())) return proposal;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const stem = proposal.length + suffix.length > LINK_MAX_NAME_LENGTH ? proposal.slice(0, LINK_MAX_NAME_LENGTH - suffix.length) : proposal;
    const candidate = stem + suffix;
    if (isValidAlias(candidate) && !used.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------- builder model (Contracts/BuilderModel.cs)

export type BuilderJoinType = 'inner' | 'left' | 'right' | 'full' | 'cross';
export type BuilderAggregate = 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';

export interface BuilderTable {
  id: string;
  alias: string;
  table: string;
  /** SQL table alias, unique in the model. */
  as: string;
  x: number;
  y: number;
  collapsed?: boolean;
}

export interface BuilderJoinCondition {
  leftColumn: string;
  rightColumn: string;
  op?: '=' | '<>' | '<' | '>' | '<=' | '>=';
  ignoreCase?: boolean;
  trim?: boolean;
}

export interface BuilderJoin {
  id: string;
  type: BuilderJoinType;
  /** Table id already in FROM. */
  left: string;
  /** Table id this join attaches. */
  right: string;
  on: BuilderJoinCondition[];
}

export interface BuilderColumn {
  id: string;
  tableId?: string | null;
  column?: string | null;
  /** Calculated column: DuckDB SQL emitted verbatim. */
  expr?: string | null;
  alias?: string | null;
  agg?: BuilderAggregate | null;
  /** Default true. */
  output?: boolean;
}

export interface BuilderRef {
  columnId?: string | null;
  tableId?: string | null;
  column?: string | null;
  expr?: string | null;
}

export interface BuilderSort {
  ref: BuilderRef;
  dir: 'asc' | 'desc';
  nulls?: 'first' | 'last' | null;
}

/**
 * The filter tree of ui/src/filter/model.ts (FilterGroup) as stored in the model. WHERE conditions name columns with
 * builderColumnKey (tableId.column), HAVING conditions with output column ids.
 */
export type BuilderFilter = FilterGroup;

export interface BuilderModel {
  version: number;
  tables: BuilderTable[];
  joins: BuilderJoin[];
  columns: BuilderColumn[];
  filter?: BuilderFilter | null;
  groupBy: BuilderRef[];
  /** Default true: GROUP BY every non-aggregated output column when any column aggregates. */
  autoGroup?: boolean;
  having?: BuilderFilter | null;
  sort: BuilderSort[];
  limit?: number | null;
  offset?: number | null;
  distinct?: boolean;
}

/** Key of a table column in WHERE conditions. */
export const builderColumnKey = (tableId: string, column: string) => `${tableId}.${column}`;

/** Splits a builderColumnKey (null without a dot). */
export function parseBuilderColumnKey(key: string): { tableId: string; column: string } | null {
  const dot = key.indexOf('.');
  return dot <= 0 ? null : { tableId: key.slice(0, dot), column: key.slice(dot + 1) };
}

// ---------------------------------------------------------------- push-down plan (Contracts/ISourceFetcher.cs, LinkApi.cs)

export type PushdownOp = '=' | '<>' | '<' | '>' | '<=' | '>=' | 'in' | 'between' | 'like' | 'isNotNull';
/** A typed literal: kind is a ColumnKind token, value its invariant text. */
export interface PushdownLiteral { kind: string; value: string }
export interface PushdownPredicate { column: string; op: PushdownOp; values: PushdownLiteral[] }

export type PlanWarningCode =
  | 'rowCap' | 'fallback' | 'joinKinds' | 'joinCollation' | 'limitWithoutOrder' | 'cartesian' | 'decimalWidened' | 'conversion'
  | 'fullScan' | 'cached' | 'fallbackEngine';
export interface PlanWarning { code: PlanWarningCode | string; message: string; table?: LinkTableRef | null }

export interface SourceFetchPlan {
  table: LinkTableRef;
  connectionId: string | null;
  providerId: string;
  sourceQuery: string;
  columns: string[];
  predicates: PushdownPredicate[];
  limit: number | null;
  maxRows: number;
  rows?: number | null;
  truncated?: boolean | null;
  cached: boolean;
  fetchedAt?: string | null;
  elapsedMs?: number | null;
}

export interface PushdownPlan {
  engine: 'duckdb' | 'sqlite' | string;
  parsed: boolean;
  sources: SourceFetchPlan[];
  warnings: PlanWarning[];
}

// ---------------------------------------------------------------- catalog (ILinkRuntime.CatalogAsync)

export interface SourceColumn {
  name: string;
  sourceType: string;
  kind: string;
  nullable: boolean;
  isPk: boolean;
  size?: number | null;
  precision?: number | null;
  scale?: number | null;
  collation?: string | null;
}

export interface SourceForeignKey {
  name: string;
  columns: string[];
  refSchema: string | null;
  refTable: string;
  refColumns: string[];
  isDisabled?: boolean;
  isNotTrusted?: boolean;
}

export interface SourceTable {
  name: string;
  linkName: string;
  database: string | null;
  schema: string | null;
  type: CatalogObjectType | 'collection' | 'index' | 'file' | string;
  columns: SourceColumn[];
  primaryKey: string[];
  foreignKeys: SourceForeignKey[];
  rowEstimate?: number | null;
  options?: Record<string, unknown> | null;
  comment?: string | null;
}

export interface LinkCatalogSchema {
  alias: string;
  kind: LinkMemberKind;
  connectionId: string | null;
  providerId: string | null;
  tables: SourceTable[];
  warnings: string[];
  error?: string | null;
}

export interface LinkCatalog {
  schemas: LinkCatalogSchema[];
  relations: VirtualRelation[];
}

// ---------------------------------------------------------------- REST shapes (Contracts/LinkApi.cs)

export interface FederationEngineInfo { engine: 'duckdb' | 'sqlite'; version: string; serializeSql: boolean; error?: string | null }

export interface LinkValidateRequest { definition: LinkDefinition; id?: string | null; probe?: boolean }
export type LinkProblemCode =
  | 'empty' | 'aliasInvalid' | 'aliasDuplicate' | 'aliasReserved' | 'memberMissing' | 'memberUnsupported' | 'memberLinked'
  | 'memberUnreachable' | 'tableInvalid' | 'tableDuplicate' | 'tableMissing' | 'noTables' | 'relationInvalid';
export interface LinkProblem {
  severity: 'error' | 'warning';
  code: LinkProblemCode | string;
  message: string;
  member?: number | null;
  table?: string | null;
  relation?: number | null;
}
export interface LinkMemberStatus { index: number; alias: string; providerId: string | null; reachable: boolean | null; tables: number | null; error?: string | null }
export interface LinkValidationResult { ok: boolean; problems: LinkProblem[]; members: LinkMemberStatus[] }

export interface CompileRequest { model: BuilderModel; plan?: boolean }
export interface CompileResult { sql: string; params: QueryParam[]; warnings: PlanWarning[]; plan?: PushdownPlan | null }
export interface ParseRequest { sql: string }
export interface ParseResult { model: BuilderModel | null; reason?: string | null }
export interface PlanRequest { sql: string; params?: QueryParam[] | null }

export interface LinkedView {
  id: string;
  connectionId: string;
  name: string;
  description: string | null;
  sql: string;
  builder: BuilderModel | null;
  createdAt: string;
  updatedAt: string;
}
export interface LinkedViewInput { name: string; description?: string | null; sql: string; builder?: BuilderModel | null }

export type MaterializeMode = 'create' | 'replace' | 'append';
export interface MaterializeRequest {
  sql?: string | null;
  viewId?: string | null;
  params?: QueryParam[] | null;
  targetConnectionId: string;
  database?: string | null;
  schema?: string | null;
  table: string;
  mode: MaterializeMode;
  batchSize?: number | null;
  sessionId?: string | null;
}
export interface MaterializePreview { dialect: Dialect; ddl: string | null; columns: ColumnInfo[]; warnings: string[]; tableExists: boolean }
/** job.done result of a materialize job. */
export interface MaterializeResult {
  targetConnectionId: string;
  database: string | null;
  schema: string | null;
  table: string;
  rows: number;
  elapsedMs: number;
  warnings: PlanWarning[];
}

export type NativeLinkKind = 'linkedServer' | 'fdw' | 'dbLink' | 'federated' | 'clickhouseEngine';
export interface NativeScriptRequest { targetConnectionId: string; memberAlias: string; kind?: NativeLinkKind | null; name?: string | null }
export interface NativeScriptResult {
  dialect: Dialect;
  kind: NativeLinkKind;
  script: string;
  placeholders: string[];
  notes: string[];
  availableKinds: NativeLinkKind[];
}

export interface RefreshSourcesRequest { sessionId?: string | null; tables?: LinkTableRef[] | null }
export interface RefreshSourcesResult { invalidated: number }

// ---------------------------------------------------------------- client

/** `/links/*` endpoints (route table: Contracts/LinkApi.cs). */
export function createLinksApi(h: M2Http) {
  const { json, enc } = h;
  const p = (cid: string, rest: string) => `/links/${enc(cid)}${rest}`;
  return {
    engine: () => json<FederationEngineInfo>('GET', '/links/engine'),
    validate: (body: LinkValidateRequest, signal?: AbortSignal) => json<LinkValidationResult>('POST', '/links/validate', { body, signal }),
    catalog: (cid: string, refresh = false, signal?: AbortSignal) => json<LinkCatalog>('GET', p(cid, '/catalog'), { query: { refresh }, signal }),
    compile: (cid: string, body: CompileRequest, signal?: AbortSignal) => json<CompileResult>('POST', p(cid, '/compile'), { body, signal }),
    parse: (cid: string, body: ParseRequest, signal?: AbortSignal) => json<ParseResult>('POST', p(cid, '/parse'), { body, signal }),
    plan: (cid: string, body: PlanRequest, signal?: AbortSignal) => json<PushdownPlan>('POST', p(cid, '/plan'), { body, signal }),
    views: (cid: string) => json<LinkedView[]>('GET', p(cid, '/views')),
    /** id 'new' creates. */
    putView: (cid: string, id: string, body: LinkedViewInput) => json<LinkedView>('PUT', p(cid, `/views/${enc(id)}`), { body }),
    deleteView: (cid: string, id: string) => json<void>('DELETE', p(cid, `/views/${enc(id)}`)),
    materializePreview: (cid: string, body: MaterializeRequest) => json<MaterializePreview>('POST', p(cid, '/materialize/preview'), { body }),
    materialize: (cid: string, body: MaterializeRequest) => json<JobStarted>('POST', p(cid, '/materialize'), { body }),
    nativeScript: (cid: string, body: NativeScriptRequest) => json<NativeScriptResult>('POST', p(cid, '/native-script'), { body }),
    refreshSources: (cid: string, body: RefreshSourcesRequest = {}) => json<RefreshSourcesResult>('POST', p(cid, '/refresh-sources'), { body }),
  };
}

export type LinksApi = ReturnType<typeof createLinksApi>;

/** The links client (lazy code only). */
export const linksApi: LinksApi = createLinksApi(http);
