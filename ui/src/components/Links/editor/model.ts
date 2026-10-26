// Link editor draft (pure): the members being edited, alias auto-slugging, table selection and renames, the problems
// that block saving, and the LinkDefinition / ConnectionInput the dialog saves. No React, no stores.
import {
  isValidAlias, isValidTableName, LINK_DEFAULT_FOLDER, LINK_PROVIDER_ID, LINK_VERSION, linkDefinitionOf, linkProps, slugifyAlias, uniqueAlias,
  type LinkDefinition, type LinkMember, type LinkOptions, type MountedTable, type VirtualRelation,
} from '../../../api/links';
import type { ConnectionInput, ConnectionProfile } from '../../../api/types';
import type { LinkEditorTable } from './open';

export interface DraftTable {
  /** Source table name. */
  name: string;
  /** Rename inside the link ('' = keep the source name). */
  as: string;
  type?: string | null;
  /** Fields of the stored MountedTable the editor does not show (options), kept as they were. */
  rest?: Omit<MountedTable, 'name' | 'as' | 'type'>;
}

export interface DraftMember {
  /** Local id (React key, selection). */
  key: string;
  alias: string;
  /** The user typed the alias: it no longer follows the connection name. */
  aliasTouched: boolean;
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  allTables: boolean;
  /** Selected tables (allTables: only the renamed ones matter). */
  tables: DraftTable[];
  label: string;
  /** Fields of the stored LinkMember the editor does not show (kind files…), kept as they were. */
  rest?: Partial<LinkMember>;
}

export interface LinkDraft {
  name: string;
  color: string | null;
  folder: string;
  members: DraftMember[];
  relations: VirtualRelation[];
  options: LinkOptions;
  /** The link's other profile props (kept on save). */
  extraProps: Record<string, unknown>;
}

export interface DraftProblem {
  severity: 'error' | 'warning';
  message: string;
  /** Member key, when the problem belongs to a member. */
  member?: string | null;
  field?: 'name' | 'connection' | 'schema' | 'alias' | 'tables' | 'table' | null;
  /** Source table name (rename problems). */
  table?: string | null;
}

let keySeq = 0;
export const memberKey = () => `m${++keySeq}`;

export function emptyDraft(folder?: string | null): LinkDraft {
  return { name: '', color: null, folder: folder ?? LINK_DEFAULT_FOLDER, members: [], relations: [], options: {}, extraProps: {} };
}

/** The draft of an existing link (edit) or of its copy (duplicate). */
export function draftFromProfile(p: ConnectionProfile, mode: 'edit' | 'duplicate'): LinkDraft {
  const def = linkDefinitionOf(p);
  const extraProps = { ...p.props };
  for (const k of Object.keys(linkProps(def))) delete extraProps[k];
  return {
    name: mode === 'duplicate' ? `${p.name} (copy)` : p.name,
    color: p.color,
    folder: p.folder ?? '',
    members: def.members.map(draftMemberOf),
    relations: def.relations,
    options: def.options,
    extraProps,
  };
}

/** The draft form of a stored member (alias kept as typed). */
export function draftMemberOf(m: LinkMember): DraftMember {
  const { alias, connectionId, database, schema, allTables, tables, label, ...rest } = m;
  return {
    key: memberKey(), alias, aliasTouched: true, connectionId: connectionId ?? null, database: database ?? null, schema: schema ?? null,
    allTables: !!allTables, label: label ?? '',
    tables: (tables ?? []).map(({ name, as, type, ...trest }) => ({ name, as: as ?? '', type: type ?? null, ...(Object.keys(trest).length ? { rest: trest } : {}) })),
    ...(Object.keys(rest).length ? { rest } : {}),
  };
}

/**
 * Adds ready-made members (links.new { members }, e.g. WP-D's "Add to link… › New link…"): each keeps its alias unless
 * another member has it already (then alias_2…). Returns the key of the first added member.
 */
export function addMembers(d: LinkDraft, members: readonly LinkMember[]): { draft: LinkDraft; select: string | null } {
  let draft = d;
  let select: string | null = null;
  for (const lm of members) {
    const m = draftMemberOf(lm);
    const alias = uniqueAlias(m.alias || 'db', draft.members.map((x) => x.alias).filter(Boolean));
    draft = { ...draft, members: [...draft.members, { ...m, alias }] };
    select ??= m.key;
  }
  return { draft, select };
}

/** Aliases of the members other than `exceptKey`. */
const otherAliases = (d: LinkDraft, exceptKey: string | null) => d.members.filter((m) => m.key !== exceptKey).map((m) => m.alias).filter(Boolean);

/** Alias proposal for a member from its connection name (and schema when the connection is already a member). */
export function proposeAlias(d: LinkDraft, exceptKey: string | null, conn: Pick<ConnectionProfile, 'id' | 'name'> | undefined, schema: string | null): string {
  if (!conn) return '';
  const sameConn = d.members.some((m) => m.key !== exceptKey && m.connectionId === conn.id);
  const base = slugifyAlias(sameConn && schema ? `${conn.name} ${schema}` : conn.name);
  return uniqueAlias(base, otherAliases(d, exceptKey));
}

export function newMember(d: LinkDraft, conn?: Pick<ConnectionProfile, 'id' | 'name'>, place: Partial<Pick<DraftMember, 'database' | 'schema'>> = {}): DraftMember {
  const key = memberKey();
  return {
    key, alias: conn ? proposeAlias(d, key, conn, place.schema ?? null) : '', aliasTouched: false, connectionId: conn?.id ?? null,
    database: place.database ?? null, schema: place.schema ?? null, allTables: false, tables: [], label: '',
  };
}

export function updateMember(d: LinkDraft, key: string, fn: (m: DraftMember) => DraftMember): LinkDraft {
  return { ...d, members: d.members.map((m) => (m.key === key ? fn(m) : m)) };
}

export function removeMember(d: LinkDraft, key: string): LinkDraft {
  return { ...d, members: d.members.filter((m) => m.key !== key) };
}

/** A new connection for the member: database / schema / tables reset, the alias follows unless the user typed it. */
export function setConnection(d: LinkDraft, key: string, conn: Pick<ConnectionProfile, 'id' | 'name'>): LinkDraft {
  return updateMember(d, key, (m) => ({
    ...m, connectionId: conn.id, database: null, schema: null, tables: [], allTables: false,
    alias: m.aliasTouched && m.alias ? m.alias : proposeAlias(d, key, conn, null),
  }));
}

export function setPlace(d: LinkDraft, key: string, place: { database?: string | null; schema?: string | null }, conn?: Pick<ConnectionProfile, 'id' | 'name'>): LinkDraft {
  return updateMember(d, key, (m) => {
    const database = place.database !== undefined ? place.database : m.database;
    const schema = place.schema !== undefined ? place.schema : m.schema;
    const moved = database !== m.database || schema !== m.schema;
    const next = { ...m, database, schema, ...(moved ? { tables: [], allTables: false } : {}) };
    // the alias follows the place too while it is automatic (a second member on the same connection gets the schema)
    if (!m.aliasTouched && conn && moved) next.alias = proposeAlias(d, key, conn, schema);
    return next;
  });
}

export function setAlias(d: LinkDraft, key: string, alias: string): LinkDraft {
  return updateMember(d, key, (m) => ({ ...m, alias, aliasTouched: true }));
}

export function isSelected(m: DraftMember, name: string): boolean {
  return m.allTables || m.tables.some((t) => t.name === name);
}

/** Checks / unchecks tables (no effect while allTables is on). */
export function setTables(d: LinkDraft, key: string, tables: readonly { name: string; type?: string | null }[], on: boolean): LinkDraft {
  return updateMember(d, key, (m) => {
    if (m.allTables) return m;
    if (on) {
      const add = tables.filter((t) => !m.tables.some((x) => x.name === t.name)).map((t) => ({ name: t.name, as: '', type: t.type ?? null }));
      return add.length ? { ...m, tables: [...m.tables, ...add] } : m;
    }
    const drop = new Set(tables.map((t) => t.name));
    return { ...m, tables: m.tables.filter((t) => !drop.has(t.name)) };
  });
}

export function setAllTables(d: LinkDraft, key: string, on: boolean): LinkDraft {
  // the explicit list stays (its renames apply to "all tables" too; turning it off keeps the earlier selection)
  return updateMember(d, key, (m) => ({ ...m, allTables: on }));
}

/** Renames a table inside the link ('' = source name); under allTables the table is added to carry the rename. */
export function renameTable(d: LinkDraft, key: string, table: { name: string; type?: string | null }, as: string): LinkDraft {
  return updateMember(d, key, (m) => {
    const has = m.tables.some((t) => t.name === table.name);
    if (!has) return as ? { ...m, tables: [...m.tables, { name: table.name, as, type: table.type ?? null }] } : m;
    return { ...m, tables: m.tables.map((t) => (t.name === table.name ? { ...t, as } : t)) };
  });
}

/** The name SQL uses for a draft table. */
export const linkNameOf = (t: Pick<DraftTable, 'name' | 'as'>) => t.as.trim() || t.name;

/**
 * Adds explorer tables (Add to link…, drops): each goes to the member on the same connection + database + schema, or a
 * new member for it. Returns the draft and the key of the member to select (the last one touched).
 */
export function addSourceTables(d: LinkDraft, tables: readonly LinkEditorTable[], connections: readonly Pick<ConnectionProfile, 'id' | 'name' | 'providerId'>[]): { draft: LinkDraft; select: string | null } {
  let draft = d;
  let select: string | null = null;
  for (const t of tables) {
    const conn = connections.find((c) => c.id === t.connectionId);
    if (!conn || conn.providerId === LINK_PROVIDER_ID) continue;
    let m = draft.members.find((x) => x.connectionId === t.connectionId && (x.database ?? null) === (t.database ?? null) && (x.schema ?? null) === (t.schema ?? null));
    if (!m) {
      m = newMember(draft, conn, { database: t.database ?? null, schema: t.schema ?? null });
      draft = { ...draft, members: [...draft.members, m] };
    }
    draft = setTables(draft, m.key, [{ name: t.name, type: t.type ?? 'table' }], true);
    select = m.key;
  }
  return { draft, select };
}

/** Problems that block saving (errors) or deserve a look (warnings). */
export function validateDraft(d: LinkDraft, connections: readonly Pick<ConnectionProfile, 'id' | 'providerId'>[]): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!d.name.trim()) out.push({ severity: 'error', field: 'name', message: 'Give the linked database a name.' });
  if (!d.members.length) out.push({ severity: 'error', message: 'Add at least one source: a connection and the tables to mount.' });
  const aliases = new Map<string, number>();
  for (const m of d.members) if (m.alias) aliases.set(m.alias.toLowerCase(), (aliases.get(m.alias.toLowerCase()) ?? 0) + 1);
  for (const m of d.members) {
    const err = (field: DraftProblem['field'], message: string, table?: string) => out.push({ severity: 'error', member: m.key, field, message, ...(table ? { table } : {}) });
    const conn = connections.find((c) => c.id === m.connectionId);
    if (!m.connectionId) err('connection', 'Choose a connection.');
    else if (!conn) err('connection', 'This connection no longer exists.');
    else if (conn.providerId === LINK_PROVIDER_ID) err('connection', 'A linked database cannot be a source of another one.');
    const a = aliasProblem(m.alias, (aliases.get(m.alias.toLowerCase()) ?? 0) > 1);
    if (a) err('alias', a);
    if (m.connectionId && conn && !m.schema) err('schema', 'Choose a schema.');
    if (!m.allTables && m.tables.length === 0 && m.connectionId && m.schema) err('tables', 'Select at least one table (or mount all tables).');
    const names = new Map<string, number>();
    for (const t of m.tables) names.set(linkNameOf(t).toLowerCase(), (names.get(linkNameOf(t).toLowerCase()) ?? 0) + 1);
    for (const t of m.tables) {
      if (!t.as) continue;
      if (!isValidTableName(t.as)) err('table', `“${t.as}” is not a valid table name (no surrounding spaces or control characters, at most 63 characters).`, t.name);
      else if ((names.get(t.as.toLowerCase()) ?? 0) > 1) err('table', `Two tables of ${m.alias || 'this source'} would be called “${t.as}”.`, t.name);
    }
  }
  return out;
}

/** Why an alias cannot be used, or null. */
export function aliasProblem(alias: string, duplicate: boolean): string | null {
  if (!alias) return 'Give the source an alias: queries name its tables alias.table.';
  if (alias.length > 63) return 'At most 63 characters.';
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) return 'Lower-case letters, digits and _ only, not starting with a digit.';
  if (!isValidAlias(alias)) return `“${alias}” is reserved (an SQL keyword or a DuckDB schema name).`;
  if (duplicate) return 'Another source already uses this alias.';
  return null;
}

/** The LinkDefinition of the draft (tables without a rename carry no `as`). */
export function toDefinition(d: LinkDraft): LinkDefinition {
  return {
    version: LINK_VERSION,
    members: d.members.map((m) => {
      const tables: MountedTable[] = m.tables
        .filter((t) => !m.allTables || !!t.as.trim())
        .map((t) => ({ ...(t.rest ?? {}), name: t.name, ...(t.as.trim() && t.as.trim() !== t.name ? { as: t.as.trim() } : {}), ...(t.type ? { type: t.type } : {}) }));
      return {
        ...(m.rest ?? {}),
        alias: m.alias, kind: m.rest?.kind ?? 'connection', connectionId: m.connectionId, database: m.database, schema: m.schema,
        allTables: m.allTables, tables, ...(m.label.trim() ? { label: m.label.trim() } : {}),
      };
    }),
    relations: d.relations,
    options: d.options,
  };
}

/** The /connections body of the draft. */
export function toConnectionInput(d: LinkDraft): ConnectionInput {
  return {
    name: d.name.trim(), providerId: LINK_PROVIDER_ID, color: d.color, folder: d.folder.trim() || null, readOnly: true,
    props: { ...d.extraProps, ...linkProps(toDefinition(d)) }, savePassword: false, password: null,
  };
}

/** Comparable form of a draft (dirty check). */
export function draftSignature(d: LinkDraft): string {
  return JSON.stringify({ n: d.name, c: d.color, f: d.folder, def: toDefinition(d) });
}

/** Mounted table count shown for a member (null = all tables, count unknown here). */
export function memberTableCount(m: DraftMember): number | null {
  return m.allTables ? null : m.tables.length;
}
