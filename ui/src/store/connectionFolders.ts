import type { ConnectionProfile } from '../api/types';
import { useConnections } from './connections';
import { useSettings } from './settings';

export const CONNECTION_FOLDERS_KEY = 'connectionFolders';

export function savedConnectionFolders(ui: Record<string, unknown>): string[] {
  const value = ui[CONNECTION_FOLDERS_KEY];
  return Array.isArray(value) ? [...new Set(value.filter((f): f is string => typeof f === 'string').map((f) => f.trim()).filter(Boolean))] : [];
}

export function connectionFolderNames(connections: readonly ConnectionProfile[], ui: Record<string, unknown>): string[] {
  return [...new Set([...savedConnectionFolders(ui), ...connections.flatMap((c) => c.folder ? [c.folder] : [])])].sort();
}

export function rememberConnectionFolders(...names: (string | null)[]): void {
  const settings = useSettings.getState();
  const saved = savedConnectionFolders(settings.settings.ui);
  const next = [...new Set([...saved, ...names.flatMap((n) => n?.trim() ? [n.trim()] : [])])];
  if (next.length !== saved.length) settings.update({ ui: { [CONNECTION_FOLDERS_KEY]: next } });
}

/** Moving a saved profile keeps its password and its open sessions. */
export async function moveConnectionToFolder(id: string, folder: string | null): Promise<void> {
  const store = useConnections.getState();
  const c = store.connections.find((c) => c.id === id);
  if (!c || c.folder === folder) return;
  await store.save({
    name: c.name, providerId: c.providerId, props: c.props, color: c.color, readOnly: c.readOnly,
    folder, savePassword: c.savePassword, password: null,
  }, id);
  rememberConnectionFolders(c.folder, folder);
}
