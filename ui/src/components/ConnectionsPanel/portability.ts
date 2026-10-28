// Export / import of saved connections as a team file (engine: Core/Services/Portability/ConnectionsPortabilityModule.cs).
// Wire types mirror ConnectionsFile.cs; the helpers are pure so the dialogs stay thin. Lazy: only the commands load this.
import { http } from '../../api/client';
import type { ConnectionProfile } from '../../api/types';

export const MIN_PASSPHRASE = 8;
/** Linked databases refer to connection ids of this machine, so the engine leaves them out of the file. */
export const NOT_EXPORTABLE_PROVIDER = 'linked';
export const CONNECTIONS_FILE_FILTERS = [{ name: 'Rowlit connections', extensions: ['json'] }];

export type ImportAction = 'new' | 'update' | 'skip';

export interface ExportRequest {
  /** Empty or missing = every connection. */
  ids?: string[];
  includeSecrets: boolean;
  passphrase?: string;
}
export interface ExportResultDto {
  fileName: string;
  content: string;
  count: number;
  secretsIncluded: number;
  skipped: string[];
}
export interface ImportPreviewItem {
  ref: string;
  name: string;
  providerId: string;
  folder: string | null;
  color: string | null;
  readOnly: boolean;
  hasSecrets: boolean;
  ssh: boolean;
  /** The engine's proposal; `skip` with a `problem` cannot be changed. */
  action: ImportAction;
  existingId: string | null;
  problem: string | null;
}
export interface ImportPreviewDto {
  /** The file carries encrypted passwords. */
  encrypted: boolean;
  /** The passphrase was given and right. */
  unlocked: boolean;
  version: number;
  exportedAt: string | null;
  items: ImportPreviewItem[];
}
export interface ImportResultDto {
  created: number;
  updated: number;
  skipped: number;
  items: { ref: string; name: string; action: ImportAction; id: string | null }[];
  errors: { ref: string; name: string; message: string }[];
  passwordsImported: boolean;
}

export const portabilityApi = {
  exportConnections: (req: ExportRequest) => http.json<ExportResultDto>('POST', '/connections/export', { body: req }),
  previewImport: (content: string, passphrase?: string) =>
    http.json<ImportPreviewDto>('POST', '/connections/import/preview', { body: { content, passphrase: passphrase || undefined } }),
  importConnections: (content: string, actions: { ref: string; action: ImportAction }[], passphrase?: string) =>
    http.json<ImportResultDto>('POST', '/connections/import', { body: { content, passphrase: passphrase || undefined, actions } }),
};

/** Why the passphrase pair cannot be used yet, or null. The engine enforces the minimum again. */
export function passphraseProblem(pass: string, confirm: string): string | null {
  if (!pass) return 'Enter a passphrase.';
  if (pass.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters.`;
  if (pass !== confirm) return 'The two passphrases differ.';
  return null;
}

export interface FolderGroup {
  /** '' = connections without a folder. */
  folder: string;
  connections: ConnectionProfile[];
}

/** Exportable connections grouped by folder (no folder first), each group by name. */
export function exportGroups(connections: readonly ConnectionProfile[]): FolderGroup[] {
  const by = new Map<string, ConnectionProfile[]>();
  for (const c of connections) {
    if (c.providerId === NOT_EXPORTABLE_PROVIDER) continue;
    const key = c.folder?.trim() ?? '';
    by.set(key, [...(by.get(key) ?? []), c]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([folder, list]) => ({ folder, connections: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Connections a command argument points at: a folder (`{ folder }`), a connection (`{ connectionId }`), else none. */
export function preselectionOf(args: unknown, connections: readonly ConnectionProfile[]): string[] {
  if (!args || typeof args !== 'object') return [];
  const a = args as { folder?: unknown; connectionId?: unknown };
  if (typeof a.folder === 'string') return connections.filter((c) => (c.folder?.trim() ?? '') === a.folder).map((c) => c.id);
  if (typeof a.connectionId === 'string') return connections.some((c) => c.id === a.connectionId) ? [a.connectionId] : [];
  return [];
}

/** The action list sent to the engine: every row of the preview with the user's choice. */
export function actionsOf(items: readonly ImportPreviewItem[], chosen: Readonly<Record<string, ImportAction>>): { ref: string; action: ImportAction }[] {
  return items.map((i) => ({ ref: i.ref, action: i.problem ? 'skip' : chosen[i.ref] ?? i.action }));
}

/** "2 new, 1 updated, 1 skipped". */
export function importSummary(r: Pick<ImportResultDto, 'created' | 'updated' | 'skipped'>): string {
  return [r.created && `${r.created} new`, r.updated && `${r.updated} updated`, r.skipped && `${r.skipped} skipped`].filter(Boolean).join(', ') || 'Nothing imported';
}
