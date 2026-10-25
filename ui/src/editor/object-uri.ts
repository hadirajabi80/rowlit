// Synthetic `dbstudio-object://connectionId/db/schema/type/name` URIs for go-to-definition on catalog objects.
// Pure: no Monaco imports.
import type { CatalogObjectType, Dialect, ObjectRef } from '../api/types';
import { displayShortcut } from '../commands/keys';
import { isTabular } from '../lib/sql';

const TYPES = new Set<CatalogObjectType>(['table', 'view', 'mview', 'proc', 'func', 'tablefunc', 'synonym', 'sequence', 'package', 'type', 'trigger']);
const enc = (s: string | null | undefined) => encodeURIComponent(s ?? '') || '-';
const dec = (s: string) => (s === '-' ? '' : decodeURIComponent(s));

export function objectUri(connectionId: string, ref: ObjectRef, column?: string, owner?: string): string {
  const q: string[] = [];
  if (column) q.push('column=' + encodeURIComponent(column));
  if (owner) q.push('owner=' + encodeURIComponent(owner));
  return `dbstudio-object://${enc(connectionId)}/${enc(ref.database)}/${enc(ref.schema)}/${ref.type}/${enc(ref.name)}${q.length ? '?' + q.join('&') : ''}`;
}

export function parseObjectUri(uri: string): { connectionId: string; ref: ObjectRef; column?: string; owner?: string } | null {
  const m = /^dbstudio-object:\/\/([^/]*)\/([^/]*)\/([^/]*)\/([^/]*)\/([^?]*)(?:\?(.*))?$/.exec(uri);
  if (!m) return null;
  const type = m[4] as CatalogObjectType;
  if (!TYPES.has(type)) return null;
  const params = new Map<string, string>();
  for (const kv of (m[6] ?? '').split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    params.set(decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1)));
  }
  const db = dec(m[2]);
  const schema = dec(m[3]);
  const out: { connectionId: string; ref: ObjectRef; column?: string; owner?: string } = {
    connectionId: dec(m[1]),
    ref: { database: db || null, schema: schema || null, name: dec(m[5]), type },
  };
  if (params.has('column')) out.column = params.get('column');
  if (params.has('owner')) out.owner = params.get('owner');
  return out;
}

/** F12 / Ctrl+click on this object opens its data (a table, view, materialized view or synonym) rather than its definition. */
export function opensData(type: CatalogObjectType, dialect?: Dialect | null): boolean {
  return type !== 'tablefunc' && isTabular(type, dialect);
}

/** Shortcut of "Open definition (DDL)": the object tab of any object. */
export const OPEN_DDL_SHORTCUT = 'Alt+F12';

export function objectSummary(ref: ObjectRef, dialect?: Dialect | null): string {
  const name = [ref.schema, ref.name].filter(Boolean).join('.');
  // platform labels (design-r1-08): "F12 / Ctrl+click" on Windows and Linux, "F12 / ⌘-click" on macOS
  const go = `${displayShortcut('F12')} / ${displayShortcut('Mod+Click')}`;
  const ddl = `${displayShortcut(OPEN_DDL_SHORTCUT)} opens the DDL`;
  return opensData(ref.type, dialect)
    ? `-- ${name} (${ref.type})\n-- ${go} opens the data, ${ddl}`
    : `-- ${name} (${ref.type})\n-- ${go} opens the definition, ${ddl}`;
}
