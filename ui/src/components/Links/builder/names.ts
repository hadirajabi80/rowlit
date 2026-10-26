// Names the bottom panel shows for the model's columns: readable FilterBar columns (as.column / output titles) mapped to
// the keys the model stores (tableId.column / column ids), and output column titles.
import type { BuilderAggregate, BuilderColumn, BuilderModel, LinkCatalog } from '../../../api/links';
import { builderColumnKey } from '../../../api/links';
import type { ColumnInfo, ColumnKind } from '../../../api/types';
import type { FilterGroup, FilterNode } from '../../../filter/model';
import { columnsOf } from './catalog';
import { baseExpr, outputKind } from './compile';

export const AGGS: { value: BuilderAggregate | ''; label: string }[] = [
  { value: '', label: '—' }, { value: 'count', label: 'Count' }, { value: 'countDistinct', label: 'Count distinct' }, { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' }, { value: 'min', label: 'Min' }, { value: 'max', label: 'Max' },
];
export const NUMERIC_ONLY = new Set<BuilderAggregate>(['sum', 'avg']);

const info = (name: string, kind: ColumnKind, dbType: string, i: number): ColumnInfo => ({
  name, ordinal: i, dbType, kind, nullable: true, size: null, precision: null, scale: null, table: null, schema: null, isKey: false,
});

/** A filter tree with every condition column renamed (the FilterBar shows readable names; the model stores keys). */
export function remapFilter(g: FilterGroup | null | undefined, fn: (column: string) => string): FilterGroup | null {
  if (!g) return null;
  const walk = (n: FilterNode): FilterNode => (n.kind === 'condition' ? { ...n, column: fn(n.column) } : { ...n, items: n.items.map(walk) });
  return walk(g) as FilterGroup;
}

interface ColumnNames {
  columns: ColumnInfo[];
  toDisplay(key: string): string;
  toKey(display: string): string;
}

/** WHERE: every column of every canvas table, shown as `as.column`, stored as `tableId.column`. */
export function whereNames(model: BuilderModel, catalog: LinkCatalog | null): ColumnNames {
  const cols: ColumnInfo[] = [];
  const d2k = new Map<string, string>();
  const k2d = new Map<string, string>();
  for (const t of model.tables) {
    for (const c of columnsOf(catalog, t)) {
      const display = `${t.as}.${c.name}`;
      const key = builderColumnKey(t.id, c.name);
      cols.push(info(display, c.kind as ColumnKind, c.sourceType, cols.length));
      d2k.set(display, key);
      k2d.set(key, display);
    }
  }
  return { columns: cols, toDisplay: (k) => k2d.get(k) ?? k, toKey: (d) => d2k.get(d) ?? d };
}

/** A readable name for an output column: alias, else `as.column`, else the expression / aggregate. */
export function columnTitle(c: BuilderColumn, model: BuilderModel): string {
  if (c.alias?.trim()) return c.alias.trim();
  const tables = new Map(model.tables.map((t) => [t.id, t]));
  const base = baseExpr(c, tables);
  const t = c.tableId ? tables.get(c.tableId) : undefined;
  const plain = t && c.column && !c.expr ? `${t.as}.${c.column}` : base ?? '*';
  return c.agg ? `${AGGS.find((a) => a.value === c.agg)?.label.toLowerCase() ?? c.agg}(${plain})` : plain;
}

/** HAVING: the model's columns by their titles, stored by id. */
export function havingNames(model: BuilderModel, catalog: LinkCatalog | null): ColumnNames {
  const cols: ColumnInfo[] = [];
  const d2k = new Map<string, string>();
  const k2d = new Map<string, string>();
  model.columns.forEach((c) => {
    let display = columnTitle(c, model);
    for (let n = 2; d2k.has(display); n++) display = `${columnTitle(c, model)} #${n}`;
    const t = c.tableId ? model.tables.find((x) => x.id === c.tableId) : undefined;
    const src = t && c.column ? columnsOf(catalog, t).find((x) => x.name === c.column) : undefined;
    cols.push(info(display, outputKind(c, src?.kind as ColumnKind | undefined), src?.sourceType ?? '', cols.length));
    d2k.set(display, c.id);
    k2d.set(c.id, display);
  });
  return { columns: cols, toDisplay: (k) => k2d.get(k) ?? k, toKey: (d) => d2k.get(d) ?? d };
}

