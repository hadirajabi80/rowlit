// Pure model of the Schema compare tab: persisted tab state, options, item grouping / filtering / selection and the
// warnings shown before an apply. No React, no stores: unit-tested on its own.
import type {
  CompareItem, CompareKind, CompareOptions, CompareScript, CompareSeverity, CompareStatus, ItemWarning,
} from '../../api/types.schemaCompare';

export const SCHEMA_COMPARE_VIEW_ID = 'schema-compare';

/** One side of the comparison as the pickers hold it (catalog keys, not yet an engine endpoint). */
export interface SideState {
  connectionId: string | null;
  /** Catalog database key (null: the connection's default / providers without a database level). */
  database: string | null;
  /** Schema (MySQL/MariaDB: the database; Oracle: the user). Null: the default schema. */
  schema: string | null;
}

/** What a schema-compare tab persists in the workspace: the two sides and the options (never the result). */
export interface SchemaCompareTabState {
  source: SideState;
  target: SideState;
  options?: Partial<CompareOptions>;
}

export const EMPTY_SIDE: SideState = { connectionId: null, database: null, schema: null };

export const DEFAULT_OPTIONS: CompareOptions = {
  tables: true, columns: true, primaryKeys: true, foreignKeys: true, uniques: true, checks: true, indexes: true, defaults: true,
  comments: true, views: true, procedures: true, functions: true, triggers: true, sequences: true,
  ignoreWhitespace: true, ignoreCase: true, ignoreComments: true, ignoreCollation: true, ignoreConstraintNames: false,
};

export function withDefaults(o: Partial<CompareOptions> | undefined): CompareOptions {
  return { ...DEFAULT_OPTIONS, ...(o ?? {}) };
}

/** Only the options that differ from the defaults (what the tab persists and the request sends). */
export function changedOptions(o: CompareOptions): Partial<CompareOptions> {
  const out: Partial<CompareOptions> = {};
  for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof CompareOptions)[]) if (o[k] !== DEFAULT_OPTIONS[k]) out[k] = o[k];
  return out;
}

export interface OptionDef {
  key: keyof CompareOptions;
  label: string;
  /** Unchecked unless its parent is on (columns, keys... need tables). */
  needs?: keyof CompareOptions;
}

export const OPTION_GROUPS: { title: string; options: OptionDef[] }[] = [
  {
    title: 'Objects',
    options: [
      { key: 'tables', label: 'Tables' },
      { key: 'views', label: 'Views' },
      { key: 'procedures', label: 'Procedures and packages' },
      { key: 'functions', label: 'Functions' },
      { key: 'triggers', label: 'Triggers' },
      { key: 'sequences', label: 'Sequences' },
    ],
  },
  {
    title: 'Table parts',
    options: [
      { key: 'columns', label: 'Columns', needs: 'tables' },
      { key: 'primaryKeys', label: 'Primary keys', needs: 'tables' },
      { key: 'foreignKeys', label: 'Foreign keys', needs: 'tables' },
      { key: 'uniques', label: 'Unique constraints', needs: 'tables' },
      { key: 'checks', label: 'Check constraints', needs: 'tables' },
      { key: 'indexes', label: 'Indexes', needs: 'tables' },
      { key: 'defaults', label: 'Column defaults', needs: 'tables' },
      { key: 'comments', label: 'Comments', needs: 'tables' },
    ],
  },
  {
    title: 'Ignore',
    options: [
      { key: 'ignoreWhitespace', label: 'Whitespace in definitions' },
      { key: 'ignoreCase', label: 'Keyword and identifier case' },
      { key: 'ignoreComments', label: 'Comments in definitions' },
      { key: 'ignoreCollation', label: 'Column collations' },
      { key: 'ignoreConstraintNames', label: 'Constraint and index names' },
    ],
  },
];

// ------------------------------------------------------------------ items

export const KIND_ORDER: readonly CompareKind[] = ['type', 'sequence', 'table', 'view', 'func', 'proc', 'package', 'trigger'];

export const KIND_LABELS: Record<CompareKind, string> = {
  table: 'Tables', view: 'Views', proc: 'Procedures', func: 'Functions', trigger: 'Triggers', sequence: 'Sequences', type: 'Types',
  package: 'Packages',
};

export const STATUS_LABELS: Record<CompareStatus, string> = {
  create: 'Create', drop: 'Drop', alter: 'Alter', identical: 'Identical',
};

export const STATUS_ORDER: readonly CompareStatus[] = ['create', 'alter', 'drop', 'identical'];

export interface ItemFilter {
  statuses: ReadonlySet<CompareStatus>;
  search: string;
}

/** Default filter: everything that differs (identical items hidden). */
export const DEFAULT_FILTER: ItemFilter = { statuses: new Set<CompareStatus>(['create', 'alter', 'drop']), search: '' };

export function matchesFilter(item: CompareItem, f: ItemFilter): boolean {
  if (!f.statuses.has(item.status)) return false;
  const q = f.search.trim().toLowerCase();
  if (!q) return true;
  return item.name.toLowerCase().includes(q) || (item.detail ?? '').toLowerCase().includes(q)
    || item.changes.some((c) => c.toLowerCase().includes(q));
}

export interface ItemGroup {
  kind: CompareKind;
  label: string;
  items: CompareItem[];
}

/** Items that pass the filter, grouped by kind in script order (types, sequences, tables, views, routines, triggers). */
export function groupItems(items: readonly CompareItem[], f: ItemFilter): ItemGroup[] {
  const by = new Map<CompareKind, CompareItem[]>();
  for (const it of items) {
    if (!matchesFilter(it, f)) continue;
    const list = by.get(it.kind) ?? [];
    list.push(it);
    by.set(it.kind, list);
  }
  const kinds = [...by.keys()].sort((a, b) => rank(a) - rank(b));
  return kinds.map((kind) => ({
    kind, label: KIND_LABELS[kind] ?? kind, items: (by.get(kind) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
  }));
}

function rank(k: CompareKind): number {
  const i = KIND_ORDER.indexOf(k);
  return i < 0 ? KIND_ORDER.length : i;
}

export function countStatuses(items: readonly CompareItem[]): Record<CompareStatus, number> {
  const c: Record<CompareStatus, number> = { create: 0, drop: 0, alter: 0, identical: 0 };
  for (const it of items) c[it.status]++;
  return c;
}

/** Items a script can be made of (identical ones have nothing to do). */
export function differing(items: readonly CompareItem[]): CompareItem[] {
  return items.filter((i) => i.status !== 'identical');
}

/** The default selection after a comparison: every item that differs. */
export function defaultSelection(items: readonly CompareItem[]): Set<string> {
  return new Set(differing(items).map((i) => i.id));
}

export function toggle(sel: ReadonlySet<string>, id: string, on?: boolean): Set<string> {
  const next = new Set(sel);
  const want = on ?? !next.has(id);
  if (want) next.add(id);
  else next.delete(id);
  return next;
}

/** Ticks / unticks every differing item of a group (identical items are never selected). */
export function toggleMany(sel: ReadonlySet<string>, items: readonly CompareItem[], on: boolean): Set<string> {
  const next = new Set(sel);
  for (const it of items) {
    if (it.status === 'identical') continue;
    if (on) next.add(it.id);
    else next.delete(it.id);
  }
  return next;
}

/** "all" | "none" | "some" of the group's differing items are selected (the group checkbox state). */
export function groupState(sel: ReadonlySet<string>, items: readonly CompareItem[]): 'all' | 'none' | 'some' {
  const d = items.filter((i) => i.status !== 'identical');
  if (d.length === 0) return 'none';
  const n = d.filter((i) => sel.has(i.id)).length;
  return n === 0 ? 'none' : n === d.length ? 'all' : 'some';
}

/** Selected ids in the result's order (only items that still exist and differ). */
export function selectedIds(items: readonly CompareItem[], sel: ReadonlySet<string>): string[] {
  return items.filter((i) => i.status !== 'identical' && sel.has(i.id)).map((i) => i.id);
}

export function worstSeverity(warnings: readonly { severity: CompareSeverity }[]): CompareSeverity | null {
  if (warnings.some((w) => w.severity === 'dataLoss')) return 'dataLoss';
  if (warnings.some((w) => w.severity === 'warning')) return 'warning';
  return warnings.length ? 'info' : null;
}

/** The script's data-loss warnings, one per distinct message (the apply dialog lists them and asks to acknowledge). */
export function dataLossWarnings(script: Pick<CompareScript, 'warnings'> | null | undefined): ItemWarning[] {
  if (!script) return [];
  const seen = new Set<string>();
  return script.warnings.filter((w) => w.severity === 'dataLoss' && !seen.has(w.message) && seen.add(w.message));
}

/** The item id's object name for display ("func:fn_tax(amount numeric)" → "fn_tax(amount numeric)"). */
export function nameOfId(id: string | null | undefined): string {
  if (!id) return '';
  const i = id.indexOf(':');
  return i >= 0 ? id.slice(i + 1) : id;
}

// ------------------------------------------------------------------ sides

export function sameSide(a: SideState, b: SideState): boolean {
  const eq = (x: string | null, y: string | null) => (x ?? '').toLowerCase() === (y ?? '').toLowerCase();
  return !!a.connectionId && a.connectionId === b.connectionId && eq(a.database, b.database) && eq(a.schema, b.schema);
}

/**
 * Why the Compare button is disabled (null when it is not). `providerOf` returns a connection's provider id, `support`
 * the engine's verdict for a connection (undefined while unknown).
 */
export function validateSides(
  source: SideState,
  target: SideState,
  providerOf: (connectionId: string) => string | undefined,
  supportReason: (connectionId: string) => string | null | undefined,
): string | null {
  if (!source.connectionId) return 'Choose the source connection.';
  if (!target.connectionId) return 'Choose the target connection.';
  const rs = supportReason(source.connectionId);
  if (rs) return rs;
  const rt = supportReason(target.connectionId);
  if (rt) return rt;
  const ps = providerOf(source.connectionId);
  const pt = providerOf(target.connectionId);
  if (ps && pt && ps !== pt) return 'Source and target must be the same kind of database.';
  if (sameSide(source, target)) return 'Source and target are the same schema: pick another target.';
  return null;
}
