// Query builder model operations (pure): tables on the canvas, columns, joins (kept in a valid SQL order), filters,
// grouping, sort and limit. Every function returns a new BuilderModel; the view records the previous one for undo.
import type {
  BuilderAggregate, BuilderColumn, BuilderJoin, BuilderJoinCondition, BuilderJoinType, BuilderModel, BuilderRef, BuilderSort, BuilderTable,
} from '../../../api/links';
import { builderColumnKey, parseBuilderColumnKey } from '../../../api/links';
import type { FilterGroup, FilterNode } from '../../../filter/model';

export const BUILDER_VERSION = 1;

/** Persisted state of a query builder tab (ViewTab.state of view 'links.builder'). */
export interface BuilderTabState {
  linkId: string;
  model: BuilderModel;
  /** 'sql' = Advanced mode: the SQL below is edited by hand and runs instead of the model. */
  mode: 'builder' | 'sql';
  sql?: string | null;
  /** The linked view this tab edits (Save updates it). */
  viewId?: string | null;
  viewName?: string | null;
  /** Bottom panel tab and sizes (UI only). */
  panel?: BottomTab;
  panelHeight?: number;
  sqlWidth?: number;
  listWidth?: number;
}

export type BottomTab = 'columns' | 'filters' | 'group' | 'sort' | 'limit' | 'results';

export function emptyModel(): BuilderModel {
  return { version: BUILDER_VERSION, tables: [], joins: [], columns: [], filter: null, groupBy: [], autoGroup: true, having: null, sort: [], limit: null, offset: null, distinct: false };
}

/** Normalises a stored model (older or partial JSON) so every list exists. */
export function normalizeModel(m: Partial<BuilderModel> | null | undefined): BuilderModel {
  const e = emptyModel();
  if (!m) return e;
  return {
    ...e, ...m,
    tables: m.tables ?? [], joins: (m.joins ?? []).map((j) => ({ ...j, on: j.on ?? [] })), columns: m.columns ?? [], groupBy: m.groupBy ?? [], sort: m.sort ?? [],
  };
}

function nextId(prefix: string, used: Iterable<string>): string {
  const set = new Set(used);
  let n = 1;
  while (set.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** A SQL alias for a new table: its name, else name2, name3… (case-insensitive, unique in the model). */
export function uniqueAs(table: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(table.toLowerCase())) return table;
  for (let n = 2; ; n++) if (!used.has(`${table}${n}`.toLowerCase())) return `${table}${n}`;
}

export interface AddTableOptions {
  x?: number;
  y?: number;
  id?: string;
}

/** Adds a mounted table (alias.table) to the canvas; returns the model and the new table's id. */
export function addTable(m: BuilderModel, alias: string, table: string, opts: AddTableOptions = {}): { model: BuilderModel; id: string } {
  const id = opts.id ?? nextId('t', m.tables.map((t) => t.id));
  // a wide member's nested table ("sales.orders") is called by its own name ("orders")
  const base = table.includes('.') && !table.endsWith('.') ? table.slice(table.lastIndexOf('.') + 1) : table;
  const t: BuilderTable = {
    id, alias, table, as: uniqueAs(base, m.tables.map((x) => x.as)),
    x: Math.round(opts.x ?? 40 + (m.tables.length % 4) * 300), y: Math.round(opts.y ?? 40 + Math.floor(m.tables.length / 4) * 280), collapsed: false,
  };
  return { model: { ...m, tables: [...m.tables, t] }, id };
}

const refUses = (r: BuilderRef, tableId: string, columns: ReadonlySet<string>) => r.tableId === tableId || (!!r.columnId && columns.has(r.columnId));

function filterWithout(g: FilterGroup | null | undefined, keep: (column: string) => boolean): FilterGroup | null {
  if (!g) return null;
  const walk = (n: FilterNode): FilterNode | null => {
    if (n.kind === 'condition') return keep(n.column) ? n : null;
    const items = n.items.map(walk).filter((x): x is FilterNode => !!x);
    return items.length ? { ...n, items } : null;
  };
  const r = walk(g);
  return r && r.kind === 'group' ? r : null;
}

/** Removes a table and everything that refers to it (joins, columns, filters, sort, group refs). */
export function removeTable(m: BuilderModel, tableId: string): BuilderModel {
  const goneColumns = new Set(m.columns.filter((c) => c.tableId === tableId).map((c) => c.id));
  const next: BuilderModel = {
    ...m,
    tables: m.tables.filter((t) => t.id !== tableId),
    joins: m.joins.filter((j) => j.left !== tableId && j.right !== tableId),
    columns: m.columns.filter((c) => !goneColumns.has(c.id)),
    filter: filterWithout(m.filter, (col) => parseBuilderColumnKey(col)?.tableId !== tableId),
    having: filterWithout(m.having, (col) => !goneColumns.has(col)),
    groupBy: m.groupBy.filter((r) => !refUses(r, tableId, goneColumns)),
    sort: m.sort.filter((s) => !refUses(s.ref, tableId, goneColumns)),
  };
  return normalizeJoins(next);
}

export function moveTable(m: BuilderModel, tableId: string, x: number, y: number): BuilderModel {
  return { ...m, tables: m.tables.map((t) => (t.id === tableId ? { ...t, x: Math.round(x), y: Math.round(y) } : t)) };
}

export function moveTables(m: BuilderModel, positions: Readonly<Record<string, readonly [number, number]>>): BuilderModel {
  return { ...m, tables: m.tables.map((t) => (positions[t.id] ? { ...t, x: Math.round(positions[t.id][0]), y: Math.round(positions[t.id][1]) } : t)) };
}

export function setCollapsed(m: BuilderModel, tableId: string, collapsed: boolean): BuilderModel {
  return { ...m, tables: m.tables.map((t) => (t.id === tableId ? { ...t, collapsed } : t)) };
}

/** Renames a table's SQL alias (must stay unique; returns the model unchanged when taken or empty). */
export function renameAs(m: BuilderModel, tableId: string, as: string): BuilderModel {
  const v = as.trim();
  if (!v || m.tables.some((t) => t.id !== tableId && t.as.toLowerCase() === v.toLowerCase())) return m;
  return { ...m, tables: m.tables.map((t) => (t.id === tableId ? { ...t, as: v } : t)) };
}

// ---------------------------------------------------------------- columns

/** The output column of a plain table column (no aggregate, no expression), if any. */
export function plainColumn(m: BuilderModel, tableId: string, column: string): BuilderColumn | undefined {
  return m.columns.find((c) => c.tableId === tableId && c.column === column && !c.expr && !c.agg);
}

/** Is the table column part of the output (as a plain column or under an aggregate)? */
export function isColumnSelected(m: BuilderModel, tableId: string, column: string): boolean {
  return m.columns.some((c) => c.tableId === tableId && c.column === column && !c.expr && c.output !== false);
}

function newColumn(m: BuilderModel, patch: Partial<BuilderColumn>): BuilderColumn {
  return { id: nextId('c', m.columns.map((c) => c.id)), tableId: null, column: null, expr: null, alias: null, agg: null, output: true, ...patch };
}

/** Checks / unchecks a table column in the card. */
export function toggleColumn(m: BuilderModel, tableId: string, column: string, on?: boolean): BuilderModel {
  const selected = isColumnSelected(m, tableId, column);
  const want = on ?? !selected;
  if (want === selected) return m;
  if (want) {
    const hidden = m.columns.find((c) => c.tableId === tableId && c.column === column && !c.expr && c.output === false);
    if (hidden) return { ...m, columns: m.columns.map((c) => (c === hidden ? { ...c, output: true } : c)) };
    // a second "name" in the results gets a telling alias (customers_name), so result columns stay distinct
    const taken = m.columns.some((c) => c.output !== false && (c.alias?.trim() || (c.expr ? '' : c.column ?? '')).toLowerCase() === column.toLowerCase());
    const t = m.tables.find((x) => x.id === tableId);
    const alias = taken && t ? uniqueOutputName(m, `${t.as}_${column}`) : null;
    return { ...m, columns: [...m.columns, newColumn(m, { tableId, column, alias })] };
  }
  const gone = new Set(m.columns.filter((c) => c.tableId === tableId && c.column === column && !c.expr).map((c) => c.id));
  return dropColumns(m, gone);
}

function dropColumns(m: BuilderModel, gone: ReadonlySet<string>): BuilderModel {
  if (!gone.size) return m;
  return {
    ...m,
    columns: m.columns.filter((c) => !gone.has(c.id)),
    having: filterWithout(m.having, (col) => !gone.has(col)),
    groupBy: m.groupBy.filter((r) => !r.columnId || !gone.has(r.columnId)),
    sort: m.sort.filter((s) => !s.ref.columnId || !gone.has(s.ref.columnId)),
  };
}

/** Selects every column of a table (in catalog order) or none. */
export function setAllColumns(m: BuilderModel, tableId: string, columns: readonly string[], on: boolean): BuilderModel {
  let next = m;
  for (const c of columns) next = toggleColumn(next, tableId, c, on);
  return next;
}

export function addCalculated(m: BuilderModel, expr: string, alias: string | null, agg: BuilderAggregate | null = null): { model: BuilderModel; id: string } {
  const c = newColumn(m, { expr, alias: alias?.trim() || null, agg });
  return { model: { ...m, columns: [...m.columns, c] }, id: c.id };
}

/** count(*) as a new output column. */
export function addCountAll(m: BuilderModel): { model: BuilderModel; id: string } {
  const c = newColumn(m, { agg: 'count', alias: uniqueOutputName(m, 'count') });
  return { model: { ...m, columns: [...m.columns, c] }, id: c.id };
}

export function uniqueOutputName(m: BuilderModel, base: string): string {
  const used = new Set(m.columns.map((c) => (c.alias ?? c.column ?? '').toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`.toLowerCase())) return `${base}_${n}`;
}

export function updateColumn(m: BuilderModel, id: string, patch: Partial<Omit<BuilderColumn, 'id'>>): BuilderModel {
  return { ...m, columns: m.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function removeColumn(m: BuilderModel, id: string): BuilderModel {
  return dropColumns(m, new Set([id]));
}

export function moveColumn(m: BuilderModel, id: string, to: number): BuilderModel {
  const from = m.columns.findIndex((c) => c.id === id);
  if (from < 0) return m;
  const cols = [...m.columns];
  const [c] = cols.splice(from, 1);
  cols.splice(Math.max(0, Math.min(cols.length, to)), 0, c);
  return { ...m, columns: cols };
}

// ---------------------------------------------------------------- joins

const flipType = (t: BuilderJoinType): BuilderJoinType => (t === 'left' ? 'right' : t === 'right' ? 'left' : t);
const flipCond = (c: BuilderJoinCondition): BuilderJoinCondition => ({
  ...c, leftColumn: c.rightColumn, rightColumn: c.leftColumn,
  op: c.op === '<' ? '>' : c.op === '>' ? '<' : c.op === '<=' ? '>=' : c.op === '>=' ? '<=' : c.op,
});

/** The join flipped (right becomes left): conditions swapped, LEFT ↔ RIGHT. */
export function flipJoin(j: BuilderJoin): BuilderJoin {
  return { ...j, left: j.right, right: j.left, type: flipType(j.type), on: j.on.map(flipCond) };
}

/**
 * Puts the joins in an order SQL can run: starting from the FROM table (tables[0]), each join attaches one new table
 * to the tables before it (flipped when it was drawn the other way). Joins that would attach a table twice (a cycle)
 * or that no longer reach a table are dropped; unreachable tables stay (CROSS JOIN, warning in the SQL panel).
 */
export function normalizeJoins(m: BuilderModel): BuilderModel {
  if (!m.tables.length) return m.joins.length ? { ...m, joins: [] } : m;
  const ids = new Set(m.tables.map((t) => t.id));
  const pending = m.joins.filter((j) => ids.has(j.left) && ids.has(j.right) && j.left !== j.right);
  // FROM table: tables[0], unless it is joined to nothing while other tables are joined (then the first table of the
  // largest joined group moves to the front, so the joins the user drew compile without a CROSS JOIN in between)
  let tables = m.tables;
  const groups = joinGroups(tables.map((t) => t.id), pending);
  const groupOf = (id: string) => groups.find((g) => g.includes(id)) ?? [id];
  if (groupOf(tables[0].id).length === 1 && groups.some((g) => g.length > 1)) {
    const largest = groups.reduce((a, g) => (g.length > a.length ? g : a), [] as string[]);
    const first = tables.find((t) => largest.includes(t.id))!;
    tables = [first, ...tables.filter((t) => t !== first)];
  }
  const attached = new Set<string>();
  const out: BuilderJoin[] = [];
  // each group in table order: its first table is the anchor, its joins follow breadth-first; groups after the first
  // start with a CROSS JOIN of their anchor (compile.ts), so a half-built query still runs
  for (const t of tables) {
    if (attached.has(t.id)) continue;
    attached.add(t.id);
    let progress = true;
    while (progress) {
      progress = false;
      for (let i = 0; i < pending.length; i++) {
        const j = pending[i];
        const l = attached.has(j.left);
        const r = attached.has(j.right);
        if (l && r) {
          pending.splice(i, 1); // a second path between attached tables: not expressible, dropped
          i--;
          continue;
        }
        if (!l && !r) continue;
        const oriented = l ? j : flipJoin(j);
        out.push(oriented);
        attached.add(oriented.right);
        pending.splice(i, 1);
        progress = true;
        break;
      }
    }
  }
  const sameJoins = out.length === m.joins.length && out.every((j, i) => j === m.joins[i]);
  if (sameJoins && tables === m.tables) return m;
  return { ...m, tables, joins: out };
}

/** Connected groups of table ids through joins (singletons included), in table order. */
export function joinGroups(ids: readonly string[], joins: readonly Pick<BuilderJoin, 'left' | 'right'>[]): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const j of joins) {
    if (!parent.has(j.left) || !parent.has(j.right)) continue;
    const a = find(j.left);
    const b = find(j.right);
    if (a !== b) parent.set(b, a);
  }
  const out = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    out.set(r, [...(out.get(r) ?? []), id]);
  }
  return [...out.values()];
}

/** The join between two tables (either direction), if any. */
export function joinBetween(m: BuilderModel, a: string, b: string): BuilderJoin | undefined {
  return m.joins.find((j) => (j.left === a && j.right === b) || (j.left === b && j.right === a));
}

/** True when a and b are already connected through other joins (a new direct join would be a cycle). */
export function connected(m: BuilderModel, a: string, b: string): boolean {
  const adj = new Map<string, string[]>();
  for (const j of m.joins) {
    adj.set(j.left, [...(adj.get(j.left) ?? []), j.right]);
    adj.set(j.right, [...(adj.get(j.right) ?? []), j.left]);
  }
  const seen = new Set([a]);
  const stack = [a];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === b) return true;
    for (const y of adj.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
  }
  return false;
}

export type JoinResult = { model: BuilderModel; joinId: string; created: boolean } | { model: BuilderModel; joinId: null; reason: 'same' | 'cycle' };

/**
 * Joins fromTable.fromColumn to toTable.toColumn (a drag from one column to another): a new condition on the join
 * between the two tables, or a new join (INNER by default). A second path between already connected tables is
 * refused ('cycle').
 */
export function connect(m: BuilderModel, fromTable: string, fromColumn: string, toTable: string, toColumn: string, opts: { type?: BuilderJoinType; ignoreCase?: boolean; trim?: boolean } = {}): JoinResult {
  if (fromTable === toTable) return { model: m, joinId: null, reason: 'same' };
  const existing = joinBetween(m, fromTable, toTable);
  if (existing) {
    const cond: BuilderJoinCondition = existing.left === fromTable
      ? { leftColumn: fromColumn, rightColumn: toColumn, op: '=', ignoreCase: !!opts.ignoreCase, trim: !!opts.trim }
      : { leftColumn: toColumn, rightColumn: fromColumn, op: '=', ignoreCase: !!opts.ignoreCase, trim: !!opts.trim };
    if (existing.on.some((c) => c.leftColumn === cond.leftColumn && c.rightColumn === cond.rightColumn)) return { model: m, joinId: existing.id, created: false };
    const type = existing.type === 'cross' ? 'inner' : existing.type;
    const joins = m.joins.map((j) => (j === existing ? { ...j, type, on: [...j.on, cond] } : j));
    return { model: { ...m, joins }, joinId: existing.id, created: false };
  }
  if (connected(m, fromTable, toTable)) return { model: m, joinId: null, reason: 'cycle' };
  const id = nextId('j', m.joins.map((j) => j.id));
  const j: BuilderJoin = {
    id, type: opts.type ?? 'inner', left: fromTable, right: toTable,
    on: [{ leftColumn: fromColumn, rightColumn: toColumn, op: '=', ignoreCase: !!opts.ignoreCase, trim: !!opts.trim }],
  };
  return { model: normalizeJoins({ ...m, joins: [...m.joins, j] }), joinId: id, created: true };
}

/** A CROSS JOIN between two tables that have no join yet. */
export function crossJoin(m: BuilderModel, a: string, b: string): JoinResult {
  if (a === b) return { model: m, joinId: null, reason: 'same' };
  if (joinBetween(m, a, b) || connected(m, a, b)) return { model: m, joinId: null, reason: 'cycle' };
  const id = nextId('j', m.joins.map((j) => j.id));
  return { model: normalizeJoins({ ...m, joins: [...m.joins, { id, type: 'cross', left: a, right: b, on: [] }] }), joinId: id, created: true };
}

export function updateJoin(m: BuilderModel, joinId: string, patch: Partial<Pick<BuilderJoin, 'type' | 'on'>>): BuilderModel {
  return { ...m, joins: m.joins.map((j) => (j.id === joinId ? { ...j, ...patch } : j)) };
}

export function updateCondition(m: BuilderModel, joinId: string, index: number, patch: Partial<BuilderJoinCondition>): BuilderModel {
  return { ...m, joins: m.joins.map((j) => (j.id === joinId ? { ...j, on: j.on.map((c, i) => (i === index ? { ...c, ...patch } : c)) } : j)) };
}

/** Removes one condition; the join goes with its last condition (unless it is a cross join). */
export function removeCondition(m: BuilderModel, joinId: string, index: number): BuilderModel {
  const j = m.joins.find((x) => x.id === joinId);
  if (!j) return m;
  if (j.on.length <= 1) return removeJoin(m, joinId);
  return updateJoin(m, joinId, { on: j.on.filter((_, i) => i !== index) });
}

export function removeJoin(m: BuilderModel, joinId: string): BuilderModel {
  return normalizeJoins({ ...m, joins: m.joins.filter((j) => j.id !== joinId) });
}

/** Makes a table the FROM table (first); joins are re-oriented from it. */
export function makeFromTable(m: BuilderModel, tableId: string): BuilderModel {
  const t = m.tables.find((x) => x.id === tableId);
  if (!t || m.tables[0]?.id === tableId) return m;
  return normalizeJoins({ ...m, tables: [t, ...m.tables.filter((x) => x.id !== tableId)] });
}

// ---------------------------------------------------------------- filters, grouping, sort, limit

export const setFilter = (m: BuilderModel, filter: FilterGroup | null): BuilderModel => ({ ...m, filter });
export const setHaving = (m: BuilderModel, having: FilterGroup | null): BuilderModel => ({ ...m, having });
export const setAutoGroup = (m: BuilderModel, autoGroup: boolean): BuilderModel => ({ ...m, autoGroup });
export const setGroupBy = (m: BuilderModel, groupBy: BuilderRef[]): BuilderModel => ({ ...m, groupBy });
export const setSort = (m: BuilderModel, sort: BuilderSort[]): BuilderModel => ({ ...m, sort });
export const setLimit = (m: BuilderModel, limit: number | null, offset: number | null = m.offset ?? null): BuilderModel => ({ ...m, limit, offset });
export const setDistinct = (m: BuilderModel, distinct: boolean): BuilderModel => ({ ...m, distinct });

/** Sort by a column (output column id or table column): toggles asc → desc → off when already the only sort. */
export function cycleSort(m: BuilderModel, ref: BuilderRef): BuilderModel {
  const same = (r: BuilderRef) => (ref.columnId ? r.columnId === ref.columnId : r.tableId === ref.tableId && r.column === ref.column && !r.columnId);
  const cur = m.sort.find((s) => same(s.ref));
  if (!cur) return { ...m, sort: [...m.sort, { ref, dir: 'asc', nulls: null }] };
  if (cur.dir === 'asc') return { ...m, sort: m.sort.map((s) => (s === cur ? { ...s, dir: 'desc' } : s)) };
  return { ...m, sort: m.sort.filter((s) => s !== cur) };
}

/** Adds a WHERE condition on a table column (the Filter on… action of a card row). */
export function filterKey(tableId: string, column: string): string {
  return builderColumnKey(tableId, column);
}

/** The tables an output column, join or ref depends on (for highlighting). */
export function tablesOfColumn(c: BuilderColumn): string[] {
  return c.tableId && !c.expr ? [c.tableId] : [];
}
