// Display helpers shared by the steps (kept out of the component files for fast refresh).
import { schemaIsDatabase, schemaLevelLabel } from '../../store/connections';
import { fileNameOf } from '../ImportWizard/files';
import { normalizeDumpPath } from './model';
import type { Transfer } from './useTransfer';

/** "Schema", "Database" (MySQL) or "Keyspace". */
export function levelOf(providerId: string | undefined): string {
  const l = providerId && schemaIsDatabase(providerId) ? schemaLevelLabel(providerId) : 'schema';
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** "Warehouse › public" or "shop.sql (PostgreSQL script)". */
export function describeTarget(t: Transfer): string {
  const { s } = t;
  if (s.targetKind === 'file') {
    const d = t.dumpDialects?.find((x) => x.provider === s.dumpProvider);
    return `${fileNameOf(normalizeDumpPath(s.filePath))} (${d?.name ?? s.dumpProvider} script)`;
  }
  const schema = s.targetSchema.trim() || t.target.defaultSchema;
  return `${t.targetConn?.name ?? s.targetCid}${s.targetDb ? ` › ${s.targetDb}` : ''}${schema ? ` › ${schema}` : ''}`;
}
