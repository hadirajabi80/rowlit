// Built-in snippets per dialect (PLAN-M1.5 A4, library expanded in 1.5). Bodies use Monaco snippet syntax: `$1`,
// `${1:default}`, `$0`, `\$` for a literal dollar; `\t` is converted to the editor's indentation on insert.
//
// The data lives in ./data/<dialect>.ts (plus ./data/common.ts for the snippets every SQL dialect shares) and is loaded
// on demand, one dialect at a time, so none of it lands in the initial bundle (ensureBuiltins / loadedBuiltins).
import type { Dialect } from '../api/types';

export const SNIPPET_CATEGORIES = ['Query', 'DML', 'DDL', 'Programmability', 'DBA'] as const;
export type SnippetCategory = (typeof SNIPPET_CATEGORIES)[number];

/** Display names (the picker and Settings show these). */
export const CATEGORY_LABELS: Record<SnippetCategory, string> = {
  Query: 'Query',
  DML: 'DML',
  DDL: 'DDL',
  Programmability: 'Programmability',
  DBA: 'DBA / admin',
};

export interface SnippetDef {
  id: string;
  name: string;
  prefix: string;
  /** null = every dialect. */
  dialects: Dialect[] | null;
  body: string;
  description?: string | null;
  builtin?: boolean;
  /** Built-ins only. */
  category?: SnippetCategory;
  /** Built-ins only: read-only and runnable as inserted (placeholders at their defaults) on a bare server; used by the live tests. */
  run?: boolean;
}

const Q: SnippetCategory = 'Query';
const D: SnippetCategory = 'DML';
const L: SnippetCategory = 'DDL';
const P: SnippetCategory = 'Programmability';
const A: SnippetCategory = 'DBA';
export const CAT = { Q, D, L, P, A } as const;

/**
 * A snippet factory for the data files: `const s = defs(['tsql'])`, then `s(prefix, name, category, description, body)`;
 * a trailing `true` marks a read-only snippet that runs as inserted.
 */
export function defs(dialects: Dialect[] | null) {
  return (prefix: string, name: string, category: SnippetCategory, description: string, body: string, run?: true): SnippetDef => ({
    id: `builtin:${prefix}:${dialects ? dialects.join('+') : 'all'}`,
    name, prefix, dialects, body, description, category, builtin: true, ...(run ? { run: true } : {}),
  });
}

type Loader = () => Promise<SnippetDef[]>;

const LOADERS: Record<Dialect, Loader> = {
  tsql: () => import('./data/tsql').then((m) => m.SNIPPETS),
  plsql: () => import('./data/plsql').then((m) => m.SNIPPETS),
  sqlite: () => import('./data/sqlite').then((m) => m.SNIPPETS),
  pgsql: () => import('./data/pgsql').then((m) => m.SNIPPETS),
  mysql: () => import('./data/mysql').then((m) => m.SNIPPETS),
  clickhouse: () => import('./data/clickhouse').then((m) => m.SNIPPETS),
  snowflake: () => import('./data/snowflake').then((m) => m.SNIPPETS),
  cql: () => import('./data/cql').then((m) => m.SNIPPETS),
};

export const SNIPPET_DIALECTS = Object.keys(LOADERS) as Dialect[];

const loaded = new Map<Dialect, SnippetDef[]>();
const pending = new Map<Dialect, Promise<SnippetDef[]>>();

/** The built-ins of a dialect once ensureBuiltins() resolved (empty before: the completer falls back to the dialect spec's own few). */
export function loadedBuiltins(dialect: Dialect): readonly SnippetDef[] {
  return loaded.get(dialect) ?? NONE;
}
const NONE: readonly SnippetDef[] = [];

export function builtinsReady(dialect: Dialect): boolean {
  return loaded.has(dialect);
}

/** Loads (once) the built-in snippets of a dialect: its own data merged with the shared ones (a dialect's own prefix wins). */
export function ensureBuiltins(dialect: Dialect): Promise<readonly SnippetDef[]> {
  const hit = loaded.get(dialect);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(dialect);
  if (!p) {
    p = Promise.all([import('./data/common'), LOADERS[dialect]()]).then(
      ([common, own]) => {
        const taken = new Set(own.map((s) => s.prefix));
        const shared = common.COMMON.filter((s) => (!s.dialects || s.dialects.includes(dialect)) && !taken.has(s.prefix))
          // the shared entry belongs to this dialect's list: one id and one dialect, like the dialect's own
          .map((s): SnippetDef => ({ ...s, id: `builtin:${s.prefix}:${dialect}`, dialects: [dialect] }));
        const all = [...own, ...shared];
        loaded.set(dialect, all);
        pending.delete(dialect);
        return all;
      },
      (e: unknown) => {
        pending.delete(dialect);
        console.warn('[snippets] built-ins unavailable for', dialect, e);
        return [];
      },
    );
    pending.set(dialect, p);
  }
  return p;
}

/** Every dialect's built-ins (Settings → Snippets). */
export async function loadAllBuiltins(): Promise<SnippetDef[]> {
  const lists = await Promise.all(SNIPPET_DIALECTS.map((d) => ensureBuiltins(d)));
  // the shared snippets are one entry per dialect after loading: merge identical ones back into a single entry
  const byKey = new Map<string, SnippetDef>();
  for (const s of lists.flat()) {
    const key = `${s.prefix}\u0000${s.body}\u0000${s.name}`;
    const hit = byKey.get(key);
    if (hit) hit.dialects = [...(hit.dialects ?? []), ...(s.dialects ?? [])];
    else byKey.set(key, { ...s, dialects: s.dialects ? [...s.dialects] : null });
  }
  return [...byKey.values()].map((s) => (s.dialects && s.dialects.length >= SNIPPET_DIALECTS.length ? { ...s, id: `builtin:${s.prefix}:all`, dialects: null } : s));
}
