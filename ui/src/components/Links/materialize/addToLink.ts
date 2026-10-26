// "Add to link…": pure rules that mount a table of a connection into a link's definition (find or create the member of
// that connection / database / schema, add the table once). The dialog and the command call it; WP-C's editor owns the
// full editing UI.
import {
  LINK_PROVIDER_ID, linkDefinitionOf, linkProps, slugifyAlias, uniqueAlias, type LinkDefinition, type LinkMember, type MountedTable,
} from '../../../api/links';
import type { ConnectionInput, ConnectionProfile } from '../../../api/types';

/** The table being added: an explorer object (the flat shape of `links.addTable`'s arguments). */
export interface TableSource {
  connectionId: string;
  database: string | null;
  schema: string | null;
  name: string;
  /** ObjectType token (table | view | ...). */
  type: string;
}

export interface AddResult {
  definition: LinkDefinition;
  /** The member the table now belongs to. */
  alias: string;
  /** The name SQL uses (`alias.table`). */
  table: string;
  /** The table was already mounted: the definition is unchanged. */
  already: boolean;
  /** A new member was created for the connection / schema. */
  newMember: boolean;
}

const sameScope = (m: LinkMember, s: TableSource) =>
  (m.kind ?? 'connection') === 'connection' && m.connectionId === s.connectionId && (m.database ?? null) === (s.database ?? null) && (m.schema ?? null) === (s.schema ?? null);

/** Proposal for the alias of a new member: the schema when it says something, else the connection's name. */
export function aliasProposal(source: TableSource, connectionName: string): string {
  const schema = source.schema?.trim().toLowerCase();
  const generic = !schema || schema === 'dbo' || schema === 'public' || schema === 'main';
  return slugifyAlias(generic ? connectionName : `${connectionName}_${schema}`);
}

export function addTableToDefinition(definition: LinkDefinition, source: TableSource, connectionName: string): AddResult {
  const mounted: MountedTable = { name: source.name, type: source.type };
  const members = definition.members.map((m) => ({ ...m, tables: [...m.tables] }));
  const at = members.findIndex((m) => sameScope(m, source));
  if (at >= 0) {
    const m = members[at];
    const have = m.tables.find((t) => t.name === source.name);
    if (m.allTables || have) {
      return { definition, alias: m.alias, table: have?.as ?? source.name, already: true, newMember: false };
    }
    m.tables.push(mounted);
    return { definition: { ...definition, members }, alias: m.alias, table: source.name, already: false, newMember: false };
  }
  const alias = uniqueAlias(aliasProposal(source, connectionName), members.map((m) => m.alias));
  const member: LinkMember = {
    alias, kind: 'connection', connectionId: source.connectionId, database: source.database ?? null, schema: source.schema ?? null,
    allTables: false, tables: [mounted],
  };
  return { definition: { ...definition, members: [...members, member] }, alias, table: source.name, already: false, newMember: true };
}

/** The member a brand new link starts with (the "New link…" route of the dialog). */
export function initialMember(source: TableSource, connectionName: string): LinkMember {
  return addTableToDefinition({ version: 1, members: [], relations: [], options: {} }, source, connectionName).definition.members[0];
}

/** The profile as the connection API wants it back, with the new definition merged into props. */
export function profileInput(profile: ConnectionProfile, definition: LinkDefinition): ConnectionInput {
  return {
    name: profile.name,
    providerId: profile.providerId,
    color: profile.color,
    folder: profile.folder,
    readOnly: profile.readOnly,
    props: { ...profile.props, ...linkProps(definition) },
    savePassword: profile.savePassword,
    password: null,
  };
}

export const isLink = (c: Pick<ConnectionProfile, 'providerId'> | undefined | null): boolean => c?.providerId === LINK_PROVIDER_ID;

export { linkDefinitionOf };
