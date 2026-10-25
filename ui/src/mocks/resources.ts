// Mock of the engine's resource manager (docs/resources.md): GET /resources, memory reports, trim, Close connection /
// Close database / Disconnect all over the MockEngine sessions. Without client ids every session is "this window's".
import { http, HttpResponse, type JsonBodyType } from 'msw';
import type { CloseResourcesResult, ConnectionResources, ResourceBlocker, ResourcesSnapshot } from '../api/resources';
import { DEFAULT_RESOURCES } from '../store/settings';
import type { MockEngine } from './engine';

const P = '*/api/v1';
const MB = 1024 * 1024;

export function createResourcesHandlers(engine: MockEngine, ok: (body: JsonBodyType, init?: ResponseInit) => Promise<Response>) {
  let appBytes = 0;
  const sessionsOf = (cid: string, database?: string | null) =>
    [...engine.sessions.values()].filter((s) => s.connectionId === cid && (database == null || (s.database ?? '').toLowerCase() === database.toLowerCase()));

  const blockers = (cid: string, database?: string | null): ResourceBlocker[] => sessionsOf(cid, database).flatMap((s) => [
    ...(s.state === 'executing' ? [{ kind: 'query' as const, label: `${s.label ?? s.sessionId} — running query`, connectionId: cid, sessionId: s.sessionId }] : []),
    ...(s.txOpen && !s.released ? [{ kind: 'transaction' as const, label: `${s.label ?? s.sessionId} — uncommitted transaction`, connectionId: cid, sessionId: s.sessionId }] : []),
  ]);

  const describe = (cid: string, database?: string | null): ConnectionResources => {
    const list = sessionsOf(cid, database);
    const open = list.filter((s) => !s.released).length;
    return {
      connectionId: cid, name: engine.conn(cid)?.name ?? cid, providerId: engine.conn(cid)?.providerId ?? '', connected: open > 0,
      sessions: list.length, openSessions: open, releasedSessions: list.length - open, streams: 0, sourceClient: false, jobs: 0,
      catalogBytes: 0, catalogSchemas: 0, lastUsed: null, blockers: blockers(cid, database),
    };
  };

  const snapshot = (): ResourcesSnapshot => {
    const ids = [...new Set([...engine.sessions.values()].map((s) => s.connectionId))];
    const conns = ids.map((cid) => describe(cid));
    const all = [...engine.sessions.values()];
    const engineBytes = 180 * MB;
    const used = engineBytes + appBytes;
    const limit = 4096 * MB;
    return {
      memory: { engineBytes, managedBytes: 90 * MB, appBytes, usedBytes: used, limitBytes: limit, totalBytes: 16384 * MB, level: used >= limit ? 'critical' : used >= limit * 0.85 ? 'high' : 'normal', autoLimit: true },
      totals: {
        openConnections: conns.filter((c) => c.connected).length, sessions: all.length, openSessions: all.filter((s) => !s.released).length,
        releasedSessions: all.filter((s) => s.released).length, streams: 0, sourceClients: 0, catalogBytes: 0, resultBytes: 0, resultCapBytes: 256 * MB,
      },
      connections: conns,
      policy: { ...DEFAULT_RESOURCES, ...engine.settings.resources },
    };
  };

  const close = (cid: string, database: string | null | undefined, force: boolean): CloseResourcesResult | ResourceBlocker[] => {
    const b = blockers(cid, database);
    if (b.length && !force) return b;
    let n = 0;
    let rolledBack = 0;
    for (const s of sessionsOf(cid, database)) {
      if (s.released) continue;
      if (s.txOpen) rolledBack++;
      s.released = true;
      s.releasedReason = 'closed';
      s.txOpen = false;
      s.state = 'idle';
      n++;
      engine.changed(s);
    }
    return { connections: 1, sessions: n, rolledBack, cancelled: 0, streams: 0, sourceClients: 0, catalogBytes: 0 };
  };

  const busy = (b: ResourceBlocker[]) =>
    HttpResponse.json({ error: { code: 'RESOURCE_BUSY', message: `Closing would interrupt ${b.length} item(s).`, detail: { blockers: b } } }, { status: 409 });

  return [
    http.get(`${P}/resources`, () => ok(snapshot() as unknown as JsonBodyType)),
    http.post(`${P}/resources/report`, async ({ request }) => {
      const body = (await request.json().catch(() => null)) as { appBytes?: number } | null;
      if (typeof body?.appBytes === 'number') appBytes = body.appBytes;
      return ok(snapshot() as unknown as JsonBodyType);
    }),
    http.post(`${P}/resources/trim`, () => ok(snapshot() as unknown as JsonBodyType)),
    http.post(`${P}/resources/close-all`, async ({ request }) => {
      const force = !!((await request.json().catch(() => null)) as { force?: boolean } | null)?.force;
      const ids = [...new Set([...engine.sessions.values()].map((s) => s.connectionId))];
      const b = ids.flatMap((cid) => blockers(cid));
      if (b.length && !force) return busy(b);
      const total: CloseResourcesResult = { connections: 0, sessions: 0, rolledBack: 0, cancelled: 0, streams: 0, sourceClients: 0, catalogBytes: 0 };
      for (const cid of ids) {
        const r = close(cid, null, true) as CloseResourcesResult;
        total.connections++;
        total.sessions += r.sessions;
        total.rolledBack += r.rolledBack;
      }
      return ok(total as unknown as JsonBodyType);
    }),
    http.get(`${P}/connections/:id/resources`, ({ params, request }) =>
      ok(describe(String(params.id), new URL(request.url).searchParams.get('database')) as unknown as JsonBodyType)),
    http.post(`${P}/connections/:id/close`, async ({ params, request }) => {
      const body = (await request.json().catch(() => null)) as { database?: string | null; force?: boolean } | null;
      const r = close(String(params.id), body?.database ?? null, !!body?.force);
      return Array.isArray(r) ? busy(r) : ok(r as unknown as JsonBodyType);
    }),
  ];
}
