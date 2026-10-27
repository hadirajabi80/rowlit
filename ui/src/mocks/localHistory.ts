// Local history mock routes (/local-history, engine Core/LocalHistory/LocalHistoryModule.cs): an in-memory store per
// MockEngine with the engine's rules (dedupe against the key's latest snapshot, 200 unlabelled per key, labels survive).
import { http, HttpResponse, type JsonBodyType, type RequestHandler } from 'msw';
import type { SnapshotReason, SnapshotText } from '../components/LocalHistory/api';
import type { MockEngine } from './engine';

const P = '*/api/v1';
const PER_KEY = 200;

const stores = new WeakMap<MockEngine, SnapshotText[]>();
let seq = 0;

export function localHistoryStore(engine: MockEngine): SnapshotText[] {
  let s = stores.get(engine);
  if (!s) stores.set(engine, (s = []));
  return s;
}

function err(status: number, code: string, message: string, detail?: unknown) {
  return HttpResponse.json({ error: { code, message, detail } }, { status });
}

const info = ({ text: _text, ...rest }: SnapshotText) => rest;

export function createLocalHistoryHandlers(engine: MockEngine, ok: (body: JsonBodyType, init?: ResponseInit) => Promise<Response>): RequestHandler[] {
  return [
    http.post(`${P}/local-history`, async ({ request }) => {
      const b = (await request.json()) as { key?: string; text?: string; reason?: SnapshotReason; label?: string | null; title?: string | null };
      if (!b.key) return err(400, 'VALIDATION', 'key is required.', { field: 'key' });
      if (typeof b.text !== 'string') return err(400, 'VALIDATION', 'text is required.', { field: 'text' });
      const all = localHistoryStore(engine);
      const latest = [...all].reverse().find((x) => x.key === b.key);
      if (latest && latest.text === b.text) {
        if (b.label && !latest.label) latest.label = b.label;
        return ok({ id: latest.id, added: false });
      }
      const snap: SnapshotText = {
        id: ++seq, key: b.key, at: new Date().toISOString(), reason: b.reason ?? 'auto', label: b.label ?? null, size: b.text.length, title: b.title ?? null, text: b.text,
      };
      all.push(snap);
      const mine = all.filter((x) => x.key === b.key && !x.label);
      for (const old of mine.slice(0, Math.max(0, mine.length - PER_KEY))) all.splice(all.indexOf(old), 1);
      return ok({ id: snap.id, added: true });
    }),
    http.get(`${P}/local-history`, ({ request }) => {
      const url = new URL(request.url);
      const keys = url.searchParams.getAll('key');
      if (!keys.length) return err(400, 'VALIDATION', 'key is required.', { field: 'key' });
      const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 100));
      const before = url.searchParams.get('before');
      const list = localHistoryStore(engine)
        .filter((x) => keys.includes(x.key) && (!before || x.id < Number(before)))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
        .map(info);
      return ok(list as unknown as JsonBodyType);
    }),
    http.delete(`${P}/local-history`, ({ request }) => {
      const keys = new URL(request.url).searchParams.getAll('key');
      if (!keys.length) return err(400, 'VALIDATION', 'key is required.', { field: 'key' });
      const all = localHistoryStore(engine);
      const before = all.length;
      stores.set(engine, all.filter((x) => !keys.includes(x.key)));
      return ok({ removed: before - localHistoryStore(engine).length });
    }),
    http.post(`${P}/local-history/prune`, () => ok({ removed: 0, bytes: 0 })),
    http.get(`${P}/local-history/:id`, ({ params }) => {
      const s = localHistoryStore(engine).find((x) => x.id === Number(params.id));
      return s ? ok(s as unknown as JsonBodyType) : err(404, 'NOT_FOUND', `Snapshot ${String(params.id)} was not found.`);
    }),
    http.patch(`${P}/local-history/:id`, async ({ params, request }) => {
      const s = localHistoryStore(engine).find((x) => x.id === Number(params.id));
      if (!s) return err(404, 'NOT_FOUND', `Snapshot ${String(params.id)} was not found.`);
      const b = (await request.json()) as { label?: string | null };
      s.label = b.label?.trim() ? b.label.trim() : null;
      return ok(s as unknown as JsonBodyType);
    }),
    http.delete(`${P}/local-history/:id`, ({ params }) => {
      const all = localHistoryStore(engine);
      const i = all.findIndex((x) => x.id === Number(params.id));
      if (i < 0) return err(404, 'NOT_FOUND', `Snapshot ${String(params.id)} was not found.`);
      all.splice(i, 1);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
