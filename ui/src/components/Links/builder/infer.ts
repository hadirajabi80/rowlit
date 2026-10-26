// Join suggestions for the query builder: foreign keys inside one source (the member's own FKs), the link's virtual
// relations, and naming conventions across sources (orders.customer_id → customers.id, same-named key columns).
// Pure: the canvas draws them as dashed hints, adding a table auto-joins the best one.
import type { BuilderModel, BuilderTable, LinkCatalog, SourceTable } from '../../../api/links';

export type SuggestionReason = 'fk' | 'relation' | 'name';

export interface JoinSuggestion {
  /** Many side (the column that references). */
  fromTable: string;
  fromColumns: string[];
  /** One side (the referenced key). */
  toTable: string;
  toColumns: string[];
  reason: SuggestionReason;
  /** 0..100; ≥ 80 is confident enough to join automatically. */
  score: number;
  /** "foreign key fk_orders_customer", "relation Orders → CRM", "name match". */
  label: string;
}

export const AUTO_JOIN_SCORE = 80;

const lc = (s: string) => s.toLowerCase();

/** The catalog table a builder table shows (alias + link name). */
export function sourceTableOf(catalog: LinkCatalog | null | undefined, t: Pick<BuilderTable, 'alias' | 'table'>): SourceTable | undefined {
  const s = catalog?.schemas.find((x) => x.alias === t.alias);
  return s?.tables.find((x) => x.linkName === t.table) ?? s?.tables.find((x) => lc(x.linkName) === lc(t.table));
}

/** Singular / plural spellings of a table name for name matching ("customers" → customer, customers). */
export function nameForms(name: string): string[] {
  const n = lc(name).replace(/^(tbl_?|t_)/, '');
  const out = new Set([n]);
  if (n.endsWith('ies')) out.add(`${n.slice(0, -3)}y`);
  else if (n.endsWith('ses') || n.endsWith('xes')) out.add(n.slice(0, -2));
  else if (n.endsWith('s')) out.add(n.slice(0, -1));
  else {
    out.add(`${n}s`);
    if (n.endsWith('y')) out.add(`${n.slice(0, -1)}ies`);
  }
  return [...out];
}

const GENERIC = new Set(['id', 'name', 'title', 'description', 'created_at', 'updated_at', 'created', 'modified', 'status', 'type', 'code', 'notes', 'comment', 'value', 'date']);

/** The key column of a table: its single-column primary key, else a column named id. */
function keyColumn(t: SourceTable): string | null {
  if (t.primaryKey.length === 1) return t.primaryKey[0];
  return t.columns.find((c) => lc(c.name) === 'id')?.name ?? null;
}

const kindClassOf = (k: string | undefined) => (k === 'int' || k === 'float' || k === 'decimal' ? 'number' : k === 'string' || k === 'guid' ? 'string' : k ?? 'other');

/** Suggestions between two tables of the model (both directions), best first. */
export function suggestBetween(catalog: LinkCatalog | null | undefined, a: BuilderTable, b: BuilderTable): JoinSuggestion[] {
  const out: JoinSuggestion[] = [];
  const ta = sourceTableOf(catalog, a);
  const tb = sourceTableOf(catalog, b);
  if (!ta || !tb) return out;
  const push = (s: JoinSuggestion) => {
    const key = (x: JoinSuggestion) => `${x.fromTable}:${x.fromColumns.join(',')}>${x.toTable}:${x.toColumns.join(',')}`;
    const k = key(s);
    const rev = `${s.toTable}:${s.toColumns.join(',')}>${s.fromTable}:${s.fromColumns.join(',')}`;
    const prev = out.findIndex((x) => key(x) === k || key(x) === rev);
    if (prev < 0) out.push(s);
    else if (out[prev].score < s.score) out[prev] = s;
  };
  for (const [x, tx, y, ty] of [[a, ta, b, tb], [b, tb, a, ta]] as const) {
    // foreign keys inside one member (same alias): refTable is the source name of the other table
    if (x.alias === y.alias) {
      for (const fk of tx.foreignKeys) {
        if (lc(fk.refTable) !== lc(ty.name)) continue;
        if (fk.refSchema && ty.schema && lc(fk.refSchema) !== lc(ty.schema)) continue;
        push({ fromTable: x.id, fromColumns: fk.columns, toTable: y.id, toColumns: fk.refColumns, reason: 'fk', score: 100, label: `foreign key ${fk.name}` });
      }
    }
    // virtual relations of the link
    for (const r of catalog?.relations ?? []) {
      if (r.from.alias === x.alias && lc(r.from.table) === lc(x.table) && r.to.alias === y.alias && lc(r.to.table) === lc(y.table)) {
        push({ fromTable: x.id, fromColumns: r.fromColumns, toTable: y.id, toColumns: r.toColumns, reason: 'relation', score: 95, label: `relation ${r.name ?? `${r.from.table} → ${r.to.table}`}` });
      }
    }
    // naming: x.<y-singular>_id / <y-singular>id → y.<key>
    const key = keyColumn(ty);
    if (key) {
      const forms = nameForms(ty.name).concat(nameForms(y.table));
      for (const c of tx.columns) {
        const n = lc(c.name);
        const m = /^(.*?)_?id$/.exec(n);
        if (!m || !m[1]) continue;
        const stem = m[1].replace(/_$/, '');
        if (!forms.includes(stem)) continue;
        const kc = ty.columns.find((k) => k.name === key);
        const compatible = kindClassOf(c.kind) === kindClassOf(kc?.kind);
        push({ fromTable: x.id, fromColumns: [c.name], toTable: y.id, toColumns: [key], reason: 'name', score: compatible ? 85 : 55, label: 'name match' });
      }
    }
  }
  // same-named, non-generic columns of the same kind (email = email, sku = sku)
  for (const ca of ta.columns) {
    if (GENERIC.has(lc(ca.name))) continue;
    const cb = tb.columns.find((c) => lc(c.name) === lc(ca.name));
    if (!cb || kindClassOf(ca.kind) !== kindClassOf(cb.kind)) continue;
    const keyish = /(_id|_key|_code|_no|_number|sku|email|uuid|guid)$/i.test(ca.name);
    push({ fromTable: a.id, fromColumns: [ca.name], toTable: b.id, toColumns: [cb.name], reason: 'name', score: keyish ? 70 : 40, label: 'same column name' });
  }
  return out.sort((p, q) => q.score - p.score);
}

/** Suggestions for every pair of tables not joined yet. */
export function suggestJoins(model: BuilderModel, catalog: LinkCatalog | null | undefined): JoinSuggestion[] {
  const out: JoinSuggestion[] = [];
  const joined = (x: string, y: string) => model.joins.some((j) => (j.left === x && j.right === y) || (j.left === y && j.right === x));
  for (let i = 0; i < model.tables.length; i++) {
    for (let k = i + 1; k < model.tables.length; k++) {
      const a = model.tables[i];
      const b = model.tables[k];
      if (joined(a.id, b.id)) continue;
      const best = suggestBetween(catalog, a, b)[0];
      if (best) out.push(best);
    }
  }
  return out.sort((p, q) => q.score - p.score);
}

/** The join to add automatically for a newly added table: the best confident suggestion to any table already there. */
export function autoJoinFor(model: BuilderModel, catalog: LinkCatalog | null | undefined, tableId: string): JoinSuggestion | null {
  const t = model.tables.find((x) => x.id === tableId);
  if (!t) return null;
  let best: JoinSuggestion | null = null;
  for (const o of model.tables) {
    if (o.id === tableId) continue;
    const s = suggestBetween(catalog, o, t)[0];
    if (s && s.score >= AUTO_JOIN_SCORE && (!best || s.score > best.score)) best = s;
  }
  return best;
}
