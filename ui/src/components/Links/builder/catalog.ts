// The link catalog as the builder uses it: compile catalog, columns of a canvas table, member colours and labels.
import type { BuilderTable, LinkCatalog, SourceColumn, SourceTable } from '../../../api/links';
import type { ColumnKind } from '../../../api/types';
import { getConnection } from '../../../store/connections';
import { CONNECTION_PALETTE, connColorCss } from '../../../theme/connColors';
import type { BuilderCatalog } from './compile';

export function builderCatalogOf(c: LinkCatalog | null | undefined): BuilderCatalog {
  const out: BuilderCatalog = {};
  for (const s of c?.schemas ?? []) {
    for (const t of s.tables) out[`${s.alias}.${t.linkName}`] = t.columns.map((x) => ({ name: x.name, kind: x.kind as ColumnKind, dbType: x.sourceType }));
  }
  return out;
}

export function tableOf(c: LinkCatalog | null | undefined, alias: string, table: string): SourceTable | undefined {
  const s = c?.schemas.find((x) => x.alias === alias);
  return s?.tables.find((t) => t.linkName === table) ?? s?.tables.find((t) => t.linkName.toLowerCase() === table.toLowerCase());
}

export function columnsOf(c: LinkCatalog | null | undefined, t: Pick<BuilderTable, 'alias' | 'table'>): SourceColumn[] {
  return tableOf(c, t.alias, t.table)?.columns ?? [];
}

const PALETTE_ORDER = ['blue', 'purple', 'green', 'orange', 'red', 'yellow', 'grey'];

/** CSS colour of a member: its connection's colour tag, else a palette colour by member position. */
export function memberColor(c: LinkCatalog | null | undefined, alias: string): string {
  const schemas = c?.schemas ?? [];
  const i = Math.max(0, schemas.findIndex((s) => s.alias === alias));
  const conn = getConnection(schemas[i]?.connectionId ?? null);
  const own = connColorCss(conn?.color ?? null);
  if (own) return own;
  const p = CONNECTION_PALETTE.find((x) => x.id === PALETTE_ORDER[i % PALETTE_ORDER.length]);
  return p ? `var(${p.token})` : 'var(--accent)';
}

/** "Postgres Shop · public" of a member alias. */
export function memberLabel(c: LinkCatalog | null | undefined, alias: string): string {
  const s = c?.schemas.find((x) => x.alias === alias);
  const conn = getConnection(s?.connectionId ?? null);
  return conn ? conn.name : alias;
}

/** Short kind label for a column type chip. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'int': case 'float': case 'decimal': return '#';
    case 'string': return 'Aa';
    case 'bool': return '✓';
    case 'date': case 'datetime': case 'datetimeoffset': case 'time': return '◷';
    case 'json': return '{}';
    case 'guid': return 'id';
    case 'binary': return '01';
    default: return '·';
  }
}
