// Saving link profiles (through /connections, like any connection) and the caches that must reload afterwards.
import { errorMessage } from '../../../api/client';
import {
  isWideScope, linkDefinitionOf, linkProps, linkTableName, linksApi, memberScopeOf, type LinkDefinition, type LinkProblem,
} from '../../../api/links';
import type { ConnectionInput, ConnectionProfile } from '../../../api/types';
import { dbKey, useCatalog } from '../../../store/catalog';
import { getConnection, useConnections } from '../../../store/connections';
import { useLinks } from '../../../store/links';
import { toast, useUi } from '../../../store/ui';

/** Saves (creates when `id` is undefined) a link profile, then drops the caches built from its old definition. */
export async function saveLinkProfile(input: ConnectionInput, id?: string): Promise<ConnectionProfile> {
  const saved = await useConnections.getState().save(input, id);
  forgetLink(saved.id);
  return saved;
}

/** The explorer catalog and the builder's link catalog of a link reload on next use. */
export function forgetLink(id: string): void {
  useLinks.getState().forget(id);
  useCatalog.getState().forget(id);
}

/**
 * The engine's opinion of a definition (POST /links/validate). Null when the engine cannot answer (no link runtime
 * yet, older engine, network): the editor then relies on its own checks.
 */
export async function engineProblems(definition: LinkDefinition, id: string | null): Promise<LinkProblem[] | null> {
  try {
    const r = await linksApi.validate({ definition, id, probe: false });
    return r.problems ?? [];
  } catch {
    return null;
  }
}

function inputOf(p: ConnectionProfile, def: LinkDefinition): ConnectionInput {
  return {
    name: p.name, providerId: p.providerId, color: p.color, folder: p.folder, readOnly: true,
    props: { ...p.props, ...linkProps(def) }, savePassword: false, password: null,
  };
}

/** Source tables of a member's schema (tables and views), from the member connection's catalog. */
async function sourceTables(connectionId: string, database: string | null, schema: string): Promise<{ name: string; type: string }[] | null> {
  try {
    await useCatalog.getState().loadSchema(connectionId, database, schema);
    const s = useCatalog.getState().dbs[dbKey(connectionId, database)]?.loaded[schema];
    if (!s) return null;
    return s.objects.filter((o) => o.t === 'table' || o.t === 'view' || o.t === 'mview').map((o) => ({ name: o.n, type: o.t }));
  } catch {
    return null;
  }
}

/**
 * Removes one mounted table (alias.linkName) from a link and saves it. A member that mounts all tables is turned into
 * an explicit list of its other tables; a member left without tables is removed (after asking).
 */
export async function unmountTable(linkId: string, alias: string, linkName: string): Promise<void> {
  const p = getConnection(linkId);
  if (!p) throw new Error('The linked database no longer exists.');
  const def = linkDefinitionOf(p);
  const idx = def.members.findIndex((m) => m.alias === alias);
  if (idx < 0) throw new Error(`The link has no source “${alias}”.`);
  const m = def.members[idx];
  let tables = m.tables;
  const scope = memberScopeOf(m);
  if (isWideScope(scope)) {
    toast('warning', `${alias} mounts a whole ${scope}`, 'Edit the link to narrow it to a list of tables instead.');
    return;
  }
  if (scope === 'schema') {
    if (!m.connectionId || !m.schema) {
      toast('warning', `${alias} mounts every table of its source`, 'Edit the link to choose the tables to keep instead.');
      return;
    }
    const all = await sourceTables(m.connectionId, m.database ?? null, m.schema);
    if (!all) {
      toast('warning', `Could not read the tables of ${alias}`, 'Edit the link to choose the tables to keep instead.');
      return;
    }
    const renames = new Map(m.tables.map((t) => [t.name, t]));
    tables = all.map((t) => renames.get(t.name) ?? { name: t.name, type: t.type });
  }
  const left = tables.filter((t) => linkTableName(t) !== linkName);
  if (left.length === tables.length) throw new Error(`${alias}.${linkName} is not part of the link.`);
  let members = def.members.map((x, i) => (i === idx ? { ...x, scope: 'tables' as const, allTables: false, tables: left } : x));
  if (!left.length) {
    const ok = await useUi.getState().askConfirm({
      title: `Remove the source “${alias}”?`,
      message: `${alias}.${linkName} was its last table, so the source goes too.`,
      confirmLabel: 'Remove source',
    });
    if (!ok) return;
    members = members.filter((_, i) => i !== idx);
  }
  try {
    await saveLinkProfile(inputOf(p, { ...def, members }), p.id);
    toast('success', `Removed ${alias}.${linkName} from “${p.name}”`);
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}
