// BuilderModel → canonical DuckDB SQL + bind params, byte-identical to the engine's
// DbStudio.Federation/Builder/BuilderCompiler.cs (WP-B). The canonical layout is the header of
// engine/src/DbStudio.Federation/Contracts/BuilderModel.cs; identifiers through quoteIdent(name, 'duckdb') (lib/sql.ts),
// filters through buildPredicate(…, 'duckdb', { paramPrefix: 'fp', columnRef }) (filter/sql.ts). Shared goldens:
// engine/tests/DbStudio.Federation.Tests/Goldens/Builder/*.json (see __tests__/goldens.test.ts).
//
// The rules the header leaves open (docs/wp-notes/links/WP-C.md "Compiler rules", goldens c-*; the same as WP-B's
// BuilderCompiler):
//   - SELECT item: expr (trimmed, wins) | <as>.<column>, wrapped by the aggregate: count(x) / count(DISTINCT x) /
//     sum(x)…; count with neither → count(*); ` AS <alias>` when an alias is set. Output = false columns are left
//     out; nothing left → `SELECT *` (`SELECT DISTINCT *`).
//   - Joins in model order, conditions joined with AND; ignoreCase/trim wrap both sides (lower(trim(x))). A join with
//     no condition (not cross) is `… JOIN … ON TRUE` (warning cartesian); an explicit CROSS JOIN has no ON and no
//     warning; tables no join attaches follow as CROSS JOIN lines in table order (warning cartesian each). A join
//     whose left table is not in FROM yet (a second group of joined tables) is preceded by `CROSS JOIN <left>`
//     (warning cartesian): WP-C.md request R-C1, the engine answers 400 there today.
//   - WHERE: model.filter; condition columns "tableId.column" = every catalog column of every model table.
//   - GROUP BY: autoGroup (default) and any output aggregate → every output column without an aggregate, in column
//     order, by its expression; autoGroup false → model.groupBy refs.
//   - HAVING: model.having; condition columns = column ids, rendered as the column's expression (with its aggregate);
//     kinds: count → int, avg → float, expressions → other, else the source column's kind. Binds continue the WHERE
//     numbering ($fp1… shared by both clauses).
//   - Refs (group / sort): a column id → (sort only: the alias of an output column that has one, else) its expression;
//     a table column → <as>.<column>; an expr verbatim (trimmed). ORDER BY always writes ASC / DESC, NULLS FIRST / LAST
//     when set.
//   - LIMIT n [OFFSET m] on one line; OFFSET m alone when there is no limit.
//   - Warnings (codes, in this order): joins (cartesian / joinKinds: join columns of different kind classes), tables
//     no join reaches (cartesian), limitWithoutOrder (a limit and no sort), filter (filter/sql.ts warnings).
// Lazy: imported by the builder tab chunk only (and the mock pack).
import { parseBuilderColumnKey } from '../../../api/links';
import type {
  BuilderAggregate, BuilderColumn, BuilderJoin, BuilderJoinCondition, BuilderModel, BuilderRef, BuilderTable, CompileResult, PlanWarning,
} from '../../../api/links';
import type { ColumnInfo, ColumnKind } from '../../../api/types';
import { kindClass, type FilterGroup, type FilterNode } from '../../../filter/model';
import { buildPredicate, ParamBuilder } from '../../../filter/sql';
import { quoteIdent } from '../../../lib/sql';

/** Columns of the mounted tables the model uses, keyed "alias.table" (kinds drive the filter SQL). */
export type BuilderCatalog = Record<string, readonly Pick<ColumnInfo, 'name' | 'kind' | 'dbType'>[]>;

/**
 * Tables of wide members (SourceTable.path), keyed like BuilderCatalog ("alias.table", table = the engine name
 * "sales.orders"): the name parts queries write below the alias. Such a table is emitted in its natural form
 * (`crm.sales.orders`); every other table stays `alias.table`. Goldens carry it as an optional "paths" object.
 */
export type BuilderPaths = Record<string, readonly string[]>;

const q = (name: string) => quoteIdent(name, 'duckdb');

/** `alias.table` key of a builder table in a BuilderCatalog. */
export const catalogKey = (t: Pick<BuilderTable, 'alias' | 'table'>) => `${t.alias}.${t.table}`;

/** The table's name in FROM / JOIN: `alias.part.part` for a table with a path, else `alias.table`. */
export function tableSql(t: Pick<BuilderTable, 'alias' | 'table'>, paths?: BuilderPaths | null): string {
  const path = paths?.[catalogKey(t)];
  return path?.length ? [t.alias, ...path].map(q).join('.') : `${q(t.alias)}.${q(t.table)}`;
}

/** `<as>.<column>` of a table column. */
export function columnSql(t: Pick<BuilderTable, 'as'>, column: string): string {
  return `${q(t.as)}.${q(column)}`;
}

const hasText = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0;

function aggSql(agg: BuilderAggregate | null | undefined, inner: string | null): string {
  const x = inner ?? '*';
  if (!agg) return x;
  if (agg === 'countDistinct') return `count(DISTINCT ${x})`;
  return `${agg}(${x})`;
}

/** The column's value without its aggregate (null when it has neither an expression nor a column: count(*)). */
export function baseExpr(c: BuilderColumn, tables: ReadonlyMap<string, BuilderTable>): string | null {
  if (hasText(c.expr)) return c.expr.trim();
  const t = c.tableId ? tables.get(c.tableId) : undefined;
  if (t && hasText(c.column)) return columnSql(t, c.column);
  return null;
}

/** The column as written in SELECT (with its aggregate, without AS). */
export function fullExpr(c: BuilderColumn, tables: ReadonlyMap<string, BuilderTable>): string {
  return aggSql(c.agg ?? null, baseExpr(c, tables));
}

const isOutput = (c: BuilderColumn) => c.output !== false;

function joinTypeSql(t: BuilderJoin['type'] | undefined): string {
  return t === 'left' ? 'LEFT' : t === 'right' ? 'RIGHT' : t === 'full' ? 'FULL' : t === 'cross' ? 'CROSS' : 'INNER';
}

function wrapSide(x: string, c: BuilderJoinCondition): string {
  const t = c.trim ? `trim(${x})` : x;
  return c.ignoreCase ? `lower(${t})` : t;
}

/** The kind HAVING compares an output column as (same rules as the engine). */
export function outputKind(c: BuilderColumn, sourceKind: ColumnKind | undefined): ColumnKind {
  if (c.agg === 'count' || c.agg === 'countDistinct') return 'int';
  if (c.agg === 'avg') return 'float';
  if (hasText(c.expr) || !hasText(c.column)) return 'other';
  return sourceKind ?? 'other';
}

function refSql(r: BuilderRef, model: BuilderModel, tables: ReadonlyMap<string, BuilderTable>, sort: boolean): string | null {
  if (r.columnId) {
    const c = model.columns.find((x) => x.id === r.columnId);
    if (!c) return null;
    if (sort && isOutput(c) && hasText(c.alias)) return q(c.alias);
    return fullExpr(c, tables);
  }
  if (r.tableId && hasText(r.column)) {
    const t = tables.get(r.tableId);
    return t ? columnSql(t, r.column) : null;
  }
  return hasText(r.expr) ? r.expr.trim() : null;
}

/** True when the tree has an enabled condition. */
function hasConditions(g: FilterNode | null | undefined): boolean {
  if (!g) return false;
  return g.kind === 'condition' ? g.enabled !== false : g.items.some(hasConditions);
}

const info = (name: string, ordinal: number, kind: ColumnKind, dbType: string): ColumnInfo => ({
  name, ordinal, dbType, kind, nullable: true, size: null, precision: null, scale: null, table: null, schema: null, isKey: false,
});

/** Every table column the WHERE filter can name, as ColumnInfo named by builderColumnKey (tableId.column). */
export function whereColumns(model: Pick<BuilderModel, 'tables'>, catalog: BuilderCatalog): ColumnInfo[] {
  const out: ColumnInfo[] = [];
  for (const t of model.tables) for (const c of catalog[catalogKey(t)] ?? []) out.push(info(`${t.id}.${c.name}`, out.length, c.kind, c.dbType));
  return out;
}

/** The model's columns HAVING can name, as ColumnInfo named by the column id. */
export function havingColumns(model: Pick<BuilderModel, 'tables' | 'columns'>, catalog: BuilderCatalog): ColumnInfo[] {
  const tables = new Map(model.tables.map((t) => [t.id, t]));
  return model.columns.map((c, i) => {
    const t = c.tableId ? tables.get(c.tableId) : undefined;
    const src = t && hasText(c.column) ? (catalog[catalogKey(t)] ?? []).find((x) => x.name === c.column) : undefined;
    return info(c.id, i, outputKind(c, src?.kind), src?.dbType ?? '');
  });
}

function kindOfColumn(t: BuilderTable, column: string, catalog: BuilderCatalog): ColumnKind | undefined {
  return (catalog[catalogKey(t)] ?? []).find((c) => c.name === column)?.kind;
}

/** Compiles the model (a model without tables gives sql ''). `paths`: the wide members' tables (natural names). */
export function compileBuilder(input: BuilderModel, catalog: BuilderCatalog, paths?: BuilderPaths | null): CompileResult {
  // the wire form may leave out empty lists (the engine's defaults)
  const model: BuilderModel = {
    ...input, tables: input.tables ?? [], joins: (input.joins ?? []).map((j) => ({ ...j, on: j.on ?? [] })), columns: input.columns ?? [],
    groupBy: input.groupBy ?? [], sort: input.sort ?? [],
  };
  const warnings: PlanWarning[] = [];
  const warn = (code: string, message: string) => warnings.push({ code, message });
  if (!model.tables.length) return { sql: '', params: [], warnings };
  const tables = new Map(model.tables.map((t) => [t.id, t]));
  const lines: string[] = [];

  // SELECT
  const output = model.columns.filter(isOutput);
  const items = output.map((c) => {
    const e = fullExpr(c, tables);
    return hasText(c.alias) ? `${e} AS ${q(c.alias)}` : e;
  });
  lines.push(`SELECT ${model.distinct ? 'DISTINCT ' : ''}${items.length ? items.join(', ') : '*'}`);

  // FROM + joins
  const from = model.tables[0];
  const ref = (t: BuilderTable) => `${tableSql(t, paths)} AS ${q(t.as)}`;
  lines.push(`FROM ${ref(from)}`);
  const attached = new Set<string>([from.id]);
  for (const j of model.joins) {
    const right = tables.get(j.right);
    const left = tables.get(j.left);
    if (!right || !left || attached.has(right.id)) continue;
    if (!attached.has(left.id)) {
      // a second group of joined tables (the UI keeps half-built queries runnable): its first table is cross joined
      attached.add(left.id);
      lines.push(`CROSS JOIN ${ref(left)}`);
      warn('cartesian', `No join reaches ${left.as}: every row pairs with every row.`);
    }
    attached.add(right.id);
    const head = `${joinTypeSql(j.type)} JOIN ${ref(right)}`;
    if (j.type === 'cross') {
      lines.push(head);
      continue;
    }
    if (!j.on.length) {
      lines.push(`${head} ON TRUE`);
      warn('cartesian', `The join of ${right.as} has no condition: every row pairs with every row.`);
      continue;
    }
    const on = j.on.map((c) => {
      const lk = kindOfColumn(left, c.leftColumn, catalog);
      const rk = kindOfColumn(right, c.rightColumn, catalog);
      if (lk && rk && kindClass(lk) !== kindClass(rk)) warn('joinKinds', `${left.as}.${c.leftColumn} (${lk}) is compared with ${right.as}.${c.rightColumn} (${rk}).`);
      return `${wrapSide(columnSql(left, c.leftColumn), c)} ${c.op || '='} ${wrapSide(columnSql(right, c.rightColumn), c)}`;
    });
    lines.push(`${head} ON ${on.join(' AND ')}`);
  }
  for (const t of model.tables) {
    if (attached.has(t.id)) continue;
    attached.add(t.id);
    lines.push(`CROSS JOIN ${ref(t)}`);
    warn('cartesian', `No join reaches ${t.as}: every row pairs with every row.`);
  }

  // WHERE / HAVING share one bind sequence; their warnings come last
  const pb = new ParamBuilder('duckdb', 'fp');
  const filterWarnings: string[] = [];
  if (hasConditions(model.filter)) {
    const r = buildPredicate(model.filter as FilterGroup, whereColumns(model, catalog), 'duckdb', {
      builder: pb,
      columnRef: (c) => {
        const k = parseBuilderColumnKey(c.name);
        const t = k ? tables.get(k.tableId) : undefined;
        return t && k ? columnSql(t, k.column) : q(c.name);
      },
    });
    filterWarnings.push(...r.warnings);
    if (r.where) lines.push(`WHERE ${r.where}`);
  }

  // GROUP BY
  let group: string[];
  if (model.autoGroup !== false) group = output.some((c) => !!c.agg) ? output.filter((c) => !c.agg).map((c) => fullExpr(c, tables)) : [];
  else group = model.groupBy.map((r) => refSql(r, model, tables, false)).filter((x): x is string => !!x);
  if (group.length) lines.push(`GROUP BY ${group.join(', ')}`);

  if (hasConditions(model.having)) {
    const byId = new Map(model.columns.map((c) => [c.id, c]));
    const r = buildPredicate(model.having as FilterGroup, havingColumns(model, catalog), 'duckdb', {
      builder: pb,
      columnRef: (c) => {
        const bc = byId.get(c.name);
        return bc ? fullExpr(bc, tables) : q(c.name);
      },
    });
    filterWarnings.push(...r.warnings);
    if (r.where) lines.push(`HAVING ${r.where}`);
  }

  // ORDER BY
  const order = model.sort.map((s) => {
    const e = refSql(s.ref, model, tables, true);
    if (!e) return null;
    return `${e} ${s.dir === 'desc' ? 'DESC' : 'ASC'}${s.nulls === 'first' ? ' NULLS FIRST' : s.nulls === 'last' ? ' NULLS LAST' : ''}`;
  }).filter((x): x is string => !!x);
  if (order.length) lines.push(`ORDER BY ${order.join(', ')}`);

  const limit = typeof model.limit === 'number' && model.limit >= 0 ? Math.floor(model.limit) : null;
  const offset = typeof model.offset === 'number' && model.offset >= 0 ? Math.floor(model.offset) : null;
  if (limit !== null) {
    lines.push(`LIMIT ${limit}${offset !== null ? ` OFFSET ${offset}` : ''}`);
    if (!model.sort.length) warn('limitWithoutOrder', 'LIMIT without ORDER BY: which rows come back is arbitrary.');
  } else if (offset !== null) lines.push(`OFFSET ${offset}`);

  for (const w of filterWarnings) warn('filter', w);
  return { sql: lines.join('\n'), params: pb.params, warnings };
}
