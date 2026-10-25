// Resources (docs/resources.md): REST client of the engine's resource manager — the status-bar popover snapshot,
// memory reports, "Free memory now", and the explorer's Close connection / Close database / Disconnect all.
import type { M2Http } from './client';
import type { MemoryLevel, ResourcesSettings } from './types';

export interface MemoryInfo {
  /** Engine process working set. */
  engineBytes: number;
  managedBytes: number;
  /** Electron processes as last reported by a window (0 in browser mode). */
  appBytes: number;
  usedBytes: number;
  limitBytes: number;
  totalBytes: number;
  level: MemoryLevel;
  autoLimit: boolean;
}

export type BlockerKind = 'transaction' | 'query' | 'export' | 'import' | 'job' | 'stream';

export interface ResourceBlocker {
  kind: BlockerKind;
  label: string;
  connectionId: string;
  sessionId?: string | null;
  tabId?: string | null;
  jobId?: string | null;
  streamId?: string | null;
}

export interface ConnectionResources {
  connectionId: string;
  name: string;
  providerId: string;
  /** Holds server resources: a session with its connection, a source client or a stream. */
  connected: boolean;
  sessions: number;
  openSessions: number;
  releasedSessions: number;
  streams: number;
  sourceClient: boolean;
  jobs: number;
  catalogBytes: number;
  catalogSchemas: number;
  lastUsed: string | null;
  blockers: ResourceBlocker[];
}

export interface ResourceTotals {
  openConnections: number;
  sessions: number;
  openSessions: number;
  releasedSessions: number;
  streams: number;
  sourceClients: number;
  catalogBytes: number;
  resultBytes: number;
  resultCapBytes: number;
}

export interface ResourcesSnapshot {
  memory: MemoryInfo;
  totals: ResourceTotals;
  connections: ConnectionResources[];
  policy: ResourcesSettings;
}

export interface CloseResourcesResult {
  connections: number;
  sessions: number;
  rolledBack: number;
  cancelled: number;
  streams: number;
  sourceClients: number;
  catalogBytes: number;
}

/** `detail` of a 409 RESOURCE_BUSY. */
export interface ResourceBusyDetail { blockers: ResourceBlocker[] }

export function createResourcesApi(http: M2Http) {
  const { json, enc } = http;
  return {
    snapshot: () => json<ResourcesSnapshot>('GET', '/resources'),
    /** Reports the Electron processes' memory and returns the snapshot. */
    report: (appBytes: number) => json<ResourcesSnapshot>('POST', '/resources/report', { body: { appBytes } }),
    /** "Free memory now": one policy pass as under critical pressure. */
    trim: () => json<ResourcesSnapshot>('POST', '/resources/trim', { body: { aggressive: true } }),
    /** 409 RESOURCE_BUSY (detail.blockers) unless `force`. */
    closeAll: (force = false) => json<CloseResourcesResult>('POST', '/resources/close-all', { body: { force } }),
    connection: (cid: string, database?: string | null) =>
      json<ConnectionResources>('GET', `/connections/${enc(cid)}/resources`, { query: { database: database ?? undefined } }),
    /** Close connection (no database) / Close database. 409 RESOURCE_BUSY (detail.blockers) unless `force`. */
    close: (cid: string, opts: { database?: string | null; force?: boolean } = {}) =>
      json<CloseResourcesResult>('POST', `/connections/${enc(cid)}/close`, { body: { database: opts.database ?? null, force: !!opts.force } }),
  };
}

export type ResourcesApi = ReturnType<typeof createResourcesApi>;
