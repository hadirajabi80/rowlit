// Native link wizard: pure helpers (which connections can reach a member natively, how the script is shown).
import type { ConnectionProfile } from '../../../api/types';
import { LINK_PROVIDER_ID, linkDefinitionOf, type LinkMember, type NativeLinkKind } from '../../../api/links';

/** Servers that can reach another database natively (linked server, foreign data wrapper, DB link, FEDERATED, ENGINE=). */
export const NATIVE_TARGET_PROVIDERS: ReadonlySet<string> = new Set(['sqlserver', 'postgresql', 'oracle', 'mysql', 'mariadb', 'clickhouse']);

export const KIND_LABEL: Record<NativeLinkKind, string> = {
  linkedServer: 'Linked server (sp_addlinkedserver)',
  fdw: 'Foreign data wrapper (postgres_fdw, mysql_fdw …)',
  dbLink: 'Database link (CREATE DATABASE LINK)',
  federated: 'FEDERATED table (MySQL / MariaDB)',
  clickhouseEngine: 'ClickHouse table engine (PostgreSQL / MySQL)',
};

export const kindLabel = (k: string): string => KIND_LABEL[k as NativeLinkKind] ?? k;

/** The connections whose server can host a native link: not a link, not the member's own connection. */
export function nativeTargets(connections: readonly ConnectionProfile[], member: LinkMember | undefined): ConnectionProfile[] {
  return connections.filter((c) => NATIVE_TARGET_PROVIDERS.has(c.providerId) && c.providerId !== LINK_PROVIDER_ID && c.id !== member?.connectionId);
}

/** The members of a link that live in a connection (file members have no server to reach). */
export function connectionMembers(link: Pick<ConnectionProfile, 'props'> | undefined): LinkMember[] {
  return link ? linkDefinitionOf(link).members.filter((m) => (m.kind ?? 'connection') === 'connection' && !!m.connectionId) : [];
}

export interface ScriptPart {
  text: string;
  /** A placeholder the user must replace (`<password>`). */
  placeholder: boolean;
}

/** Splits the script at its placeholders so the view can mark them; text outside them is kept verbatim. */
export function scriptParts(script: string, placeholders: readonly string[]): ScriptPart[] {
  const tokens = [...new Set(placeholders.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!tokens.length) return [{ text: script, placeholder: false }];
  const re = new RegExp(tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const parts: ScriptPart[] = [];
  let at = 0;
  for (const m of script.matchAll(re)) {
    if (m.index > at) parts.push({ text: script.slice(at, m.index), placeholder: false });
    parts.push({ text: m[0], placeholder: true });
    at = m.index + m[0].length;
  }
  if (at < script.length) parts.push({ text: script.slice(at), placeholder: false });
  return parts;
}

/** Title of the console the script opens in. */
export function scriptTitle(alias: string): string {
  return `Native link: ${alias}`;
}
