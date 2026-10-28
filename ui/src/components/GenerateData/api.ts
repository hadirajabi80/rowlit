// REST wrappers of the mock data generator (contract: api/types.generate.ts). Same authenticated requests as the shared
// client (which does not export its request helper), same error mapping.
import { api, API_PREFIX, ApiError, errorMessage, getClientConfig } from '../../api/client';
import { CLIENT_ID_HEADER, uiClientId } from '../../api/clientId';
import type { ApiErrorBody } from '../../api/types';
import type { GenerateRequest, GeneratePlan, GeneratePreview, GeneratorInfo } from '../../api/types.generate';

async function json<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const c = getClientConfig();
  if (!c) throw new ApiError('NETWORK', 'The Rowlit engine is not connected yet', 0);
  const headers: Record<string, string> = { Authorization: `Bearer ${c.token}`, [CLIENT_ID_HEADER]: uiClientId() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${c.baseUrl}${API_PREFIX}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new ApiError('ABORTED', 'Request aborted', 0);
    throw new ApiError('NETWORK', `Cannot reach the Rowlit engine (${errorMessage(e)})`, 0);
  }
  const text = await res.text();
  if (res.ok) return (text ? JSON.parse(text) : undefined) as T;
  let parsed: ApiErrorBody | null = null;
  try {
    parsed = text ? (JSON.parse(text) as ApiErrorBody) : null;
  } catch {
    parsed = null;
  }
  if (parsed?.error?.code) throw new ApiError(parsed.error.code, parsed.error.message, res.status, parsed.error.detail);
  throw new ApiError(res.status === 401 ? 'UNAUTHORIZED' : res.status === 404 ? 'NOT_FOUND' : 'HTTP', `${res.status} ${res.statusText || 'HTTP error'}`, res.status);
}

const enc = encodeURIComponent;

export interface PlanQuery {
  connectionId: string;
  database?: string | null;
  schema?: string | null;
  table: string;
}

export const generateApi = {
  generators: (signal?: AbortSignal) => json<GeneratorInfo[]>('GET', '/generate/generators', undefined, signal),
  plan: (q: PlanQuery, signal?: AbortSignal) => {
    const p = [`connectionId=${enc(q.connectionId)}`, `table=${enc(q.table)}`];
    if (q.database) p.push(`database=${enc(q.database)}`);
    if (q.schema) p.push(`schema=${enc(q.schema)}`);
    return json<GeneratePlan>('GET', `/generate/plan?${p.join('&')}`, undefined, signal);
  },
  preview: (req: GenerateRequest, signal?: AbortSignal) => json<GeneratePreview>('POST', '/generate/preview', req, signal),
  run: (req: GenerateRequest) => json<{ jobId: string }>('POST', '/generate/run', req),
  cancel: (jobId: string) => api.cancelJob(jobId),
  /** The CSV report of the rows the server rejected, as bytes (a Blob keeps the UTF-8 BOM, so Excel opens Persian text correctly). */
  errorReport: async (jobId: string): Promise<Blob> => {
    const c = getClientConfig();
    if (!c) throw new ApiError('NETWORK', 'The Rowlit engine is not connected yet', 0);
    const res = await fetch(`${c.baseUrl}${API_PREFIX}/generate/errors/${enc(jobId)}`, { headers: { Authorization: `Bearer ${c.token}`, [CLIENT_ID_HEADER]: uiClientId() } });
    if (!res.ok) throw new ApiError(res.status === 404 ? 'NOT_FOUND' : 'HTTP', `${res.status} ${res.statusText || 'HTTP error'}`, res.status);
    return res.blob();
  },
};
