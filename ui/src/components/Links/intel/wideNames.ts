// Completion of the multi-part names of wide link members (whole database / whole connection) in linked consoles:
// `crm.` → the member's schemas (or databases), `crm.sales.` → that schema's tables, `crm.shop.` → the schemas of database
// shop, `crm.shop.dbo.` → its tables, and the columns of such a table (`FROM crm.sales.orders o` … `o.`). The core
// completer knows the link's explorer catalog only (aliases = schemas, the default schema's tables); the levels below
// come from the links store (POST /links/{cid}/browse, /resolve), loaded on demand: a "Loading …" row shows meanwhile and
// the open suggest list refreshes when the level arrives. Loaded lazily by components/Links/commands.ts (registered for
// the duckdb dialect with intel registerCompletionSource).
import { isWideSchema, type LinkBrowseResult, type LinkCatalogSchema, type SourceTable } from '../../../api/links';
import { activeBinding } from '../../../editor/registry';
import { refreshSuggest } from '../../../editor/suggestKey';
import { matchScore, needsQuoting, quoteIdent, sortTextFor, type CompleteEnv, type CompletionItem, type CursorContext } from '../../../intel';
import { getConnection } from '../../../store/connections';
import { browseKey, tableKey, useLinks } from '../../../store/links';

type NamePart = { text: string; quoted?: boolean };

/** Scores above the core completer's object items: after a wide member's qualifier these are the answers. */
const BASE = 6000;

const same = (a: string, p: NamePart) => (p.quoted ? a === p.text : a.toLowerCase() === p.text.toLowerCase());

// ---------------------------------------------------------------- refresh when a level arrives

let waitingFor: string | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** The suggest list of the focused console on `linkId` shows a Loading row: re-run it once the links store changes. */
function refreshWhenLoaded(linkId: string): void {
  waitingFor = linkId;
  if (unsubscribe) return;
  unsubscribe = useLinks.subscribe((s, prev) => {
    if (s.browse === prev.browse && s.extra === prev.extra && s.resolved === prev.resolved && s.catalogs === prev.catalogs) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const link = waitingFor;
      waitingFor = null;
      unsubscribe?.();
      unsubscribe = null;
      const b = activeBinding();
      if (!b || !link || b.connectionId() !== link || !b.suggestLoading || !b.editor.hasTextFocus()) return;
      b.suggestLoading = false;
      refreshSuggest(b.editor);
    }, 30);
  });
}

// ---------------------------------------------------------------- data

interface Member {
  linkId: string;
  s: LinkCatalogSchema;
  levels: readonly string[];
  defaultPath: readonly string[];
}

/** The wide member a qualifier starts with, when the console is a link's. */
function memberOf(env: CompleteEnv, alias: NamePart): Member | null {
  const linkId = env.index.snapshot?.connectionId;
  if (!linkId || getConnection(linkId)?.providerId !== 'linked') return null;
  const st = useLinks.getState();
  const entry = st.catalogs[linkId];
  if (!entry) {
    void st.loadCatalog(linkId);
    return null;
  }
  const s = entry.catalog?.schemas.find((x) => same(x.alias, alias));
  if (!s || !isWideSchema(s)) return null;
  return { linkId, s, levels: s.levels ?? [], defaultPath: s.defaultPath ?? [] };
}

type Level = LinkBrowseResult | 'loading' | null;

/** A loaded level (path = catalog spellings), or 'loading' (its load started), or null (it failed). */
function level(m: Member, path: readonly string[]): Level {
  const st = useLinks.getState();
  const e = st.browse[m.linkId]?.[browseKey(m.s.alias, path)];
  if (e?.result) return e.result;
  if (e?.status === 'error') return null;
  if (!e) void st.browseLevel(m.linkId, m.s.alias, path);
  return 'loading';
}

/** The catalog spelling of the typed names below the alias (each level looked up in its parent), or 'loading' / null. */
function resolvePath(m: Member, parts: readonly NamePart[]): string[] | 'loading' | null {
  const out: string[] = [];
  for (const p of parts) {
    if (out.length >= m.levels.length) return null;
    const r = level(m, out);
    if (r === 'loading' || r === null) return r;
    const child = r.children.find((c) => same(c.name, p));
    if (!child) return null;
    out.push(child.name);
  }
  return out;
}

/** The engine name of a table named by `parts` below the alias: the default database / schema prefix left out. */
function engineName(m: Member, parts: readonly string[]): string {
  // a shorter name is relative to the default database (`dbo.orders` of a whole connection = `shop.dbo.orders`)
  const missing = Math.max(0, m.levels.length + 1 - parts.length);
  const def = m.defaultPath.slice(missing);
  let k = 0;
  while (k < def.length && k < parts.length - 1 && parts[k].toLowerCase() === def[k].toLowerCase()) k++;
  return parts.slice(k).join('.');
}

/** A loaded table of the member named by `parts` (alias left out), in the catalog (+ tables loaded on demand). */
function tableNamed(m: Member, parts: readonly NamePart[]): SourceTable | null {
  const texts = parts.map((p) => p.text);
  const tables = useLinks.getState().catalogs[m.linkId]?.catalog?.schemas.find((x) => x.alias === m.s.alias)?.tables ?? m.s.tables;
  const eq = (t: SourceTable) => {
    if (t.path?.length === parts.length && t.path.every((x, i) => same(x, parts[i]))) return true;
    const names = [texts.join('.'), engineName(m, texts)];
    return names.some((n) => t.linkName.toLowerCase() === n.toLowerCase());
  };
  return tables.find(eq) ?? null;
}

// ---------------------------------------------------------------- items

function ident(name: string, c: CursorContext, env: CompleteEnv): string {
  if (!needsQuoting(name, env.spec)) return name;
  const q = quoteIdent(name, c.prefixQuoted ?? env.spec.quote[0]);
  return c.prefixQuoted && c.closingQuoteAfter ? q.slice(0, -1) : q;
}

function item(c: CursorContext, label: string, extra: Partial<CompletionItem> & Pick<CompletionItem, 'kind' | 'insertText'>, rank = 0): CompletionItem | null {
  const ms = c.prefixText ? matchScore(c.prefixText, label) : 0;
  if (c.prefixText && ms < 0) return null;
  const score = BASE + ms * 10 + rank;
  return { label, filterText: label, sortText: sortTextFor(score), score, ...extra };
}

function loadingItem(c: CursorContext, what: string, linkId: string): CompletionItem {
  refreshWhenLoaded(linkId);
  const score = BASE + 2000;
  return {
    label: `Loading ${what}…`, kind: 'schema', detail: 'loading objects', insertText: c.prefixText, filterText: c.prefixText,
    sortText: sortTextFor(score), score, loading: true,
  };
}

function containerItems(c: CursorContext, env: CompleteEnv, m: Member, r: LinkBrowseResult, owner: string): CompletionItem[] {
  const kind = r.level === 'database' ? 'database' : 'schema';
  return r.children.map((ch) => item(c, ch.name, {
    kind, insertText: `${ident(ch.name, c, env)}.`, command: 'retrigger', detail: `${kind} of ${owner}${ch.isDefault ? ' (default)' : ''}`,
    usageKey: `link:${m.s.alias}:${ch.name}`,
  }, ch.isDefault ? 5 : 0)).filter((x): x is CompletionItem => !!x);
}

function tableItems(c: CursorContext, env: CompleteEnv, m: Member, r: LinkBrowseResult, owner: string): CompletionItem[] {
  return r.tables.map((t) => {
    const name = t.path?.length ? t.path[t.path.length - 1] : t.linkName;
    return item(c, name, {
      kind: t.type === 'view' || t.type === 'mview' ? 'view' : 'table', insertText: ident(name, c, env), detail: `${t.type === 'view' ? 'view' : 'table'} of ${owner}`,
      description: `${t.columns.length} columns`, documentation: t.comment ?? undefined, usageKey: `link:${m.s.alias}:${t.linkName}`,
    });
  }).filter((x): x is CompletionItem => !!x);
}

function columnItems(c: CursorContext, env: CompleteEnv, t: SourceTable, owner: string): CompletionItem[] {
  return t.columns.map((col, i) => item(c, col.name, {
    kind: 'column', insertText: ident(col.name, c, env), detail: `${col.sourceType}${col.isPk ? ' · key' : ''}`, description: col.sourceType,
    documentation: `${owner}.${col.name}`,
  }, -i / 1000)).filter((x): x is CompletionItem => !!x);
}

/** The columns of a nested table named by `parts` below the alias, loading it by engine name when needed. */
function columnsOrLoad(c: CursorContext, env: CompleteEnv, m: Member, parts: readonly NamePart[]): CompletionItem[] | null {
  const t = tableNamed(m, parts);
  const owner = [m.s.alias, ...parts.map((p) => p.text)].join('.');
  if (t) return columnItems(c, env, t, owner);
  const name = engineName(m, parts.map((p) => p.text));
  const st = useLinks.getState();
  const status = st.resolved[m.linkId]?.[tableKey(m.s.alias, name)];
  if (status === 'missing' || status === 'error') return null;
  if (!status) void st.resolveTables(m.linkId, [{ alias: m.s.alias, table: name }]);
  return [loadingItem(c, owner, m.linkId)];
}

/** `alias.` / `alias.a.` / `alias.a.b.` (and a table's `alias.a.b.`): the next level of a wide member. */
function qualifiedItems(c: CursorContext, env: CompleteEnv, m: Member, rest: readonly NamePart[]): CompletionItem[] | null {
  const owner = [m.s.alias, ...rest.map((p) => p.text)].join('.');
  const out: CompletionItem[] = [];
  let loading = false;
  const add = (r: Level, fn: (r: LinkBrowseResult) => CompletionItem[]) => {
    if (r === 'loading') loading = true;
    else if (r) out.push(...fn(r));
  };
  // rest names a container: its children (or tables)
  const path = rest.length <= m.levels.length ? resolvePath(m, rest) : null;
  if (path === 'loading') loading = true;
  else if (path) add(level(m, path), (r) => (r.level ? containerItems(c, env, m, r, owner) : tableItems(c, env, m, r, owner)));
  // two levels (database > schema): `alias.schema.` / `alias.schema.table.` of the default database
  if (m.levels.length === 2 && m.defaultPath.length === 2 && rest.length >= 1 && !(path && path !== 'loading' && rest.length === 2)) {
    const def = m.defaultPath[0];
    const sch = resolvePath(m, [{ text: def, quoted: true }, rest[0]]);
    if (sch === 'loading') loading = true;
    else if (sch && rest.length === 1) add(level(m, sch), (r) => tableItems(c, env, m, r, owner));
  }
  // rest names a table (alias.schema.table. / alias.db.schema.table. / the default database's alias.schema.table.)
  if (rest.length >= 2 && rest.length <= m.levels.length + 1 && path === null && !out.length && !loading) return columnsOrLoad(c, env, m, rest);
  if (!out.length && loading) return [loadingItem(c, owner, m.linkId)];
  return out.length ? out : null;
}

/** The ExtraCompletionSource (duckdb). */
export function wideNameItems(c: CursorContext, env: CompleteEnv): CompletionItem[] | null {
  const q = c.qualifier as NamePart[] | null;
  if (!q?.length) return null;
  const direct = memberOf(env, q[0]);
  if (direct && q.length >= 1 && q.length <= direct.levels.length + 2) {
    // a table alias can shadow nothing here: `crm.` is the member, the core completer adds the default schema's tables
    const r = qualifiedItems(c, env, direct, q.slice(1));
    if (r) return r;
  }
  if (q.length !== 1) return null;
  // `o.` of `FROM crm.sales.orders o`: a source named with 3 / 4 parts the core catalog cannot resolve
  const target = env.binder.resolveQualifier(c.qualifier!, c.scope);
  if (!target || target.kind !== 'source' || !target.src.unresolved) return null;
  const parts = target.src.ref.parts;
  if (parts.length < 3) return null;
  const m = memberOf(env, parts[0]);
  if (!m) return null;
  return columnsOrLoad(c, env, m, parts.slice(1));
}
