// REST wrappers of the Import Wizard (contract: ./types.ts). The shared client (api/client.ts) does not export its
// request helpers, so this file sends the same authenticated requests itself (same headers, same error mapping).
import { api, API_PREFIX, ApiError, errorMessage, getClientConfig } from '../../api/client';
import { CLIENT_ID_HEADER, uiClientId } from '../../api/clientId';
import type { ApiErrorBody } from '../../api/types';
import type {
  DdlPreview, DdlRequest, ImportCapabilities, ImportRequest, PreviewRequest, PreviewResult, TableRef, TargetTableInfo,
} from './types';

async function send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
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
  if (res.ok) return res;
  let parsed: ApiErrorBody | null = null;
  try {
    const text = await res.text();
    parsed = text ? (JSON.parse(text) as ApiErrorBody) : null;
  } catch {
    parsed = null;
  }
  if (parsed?.error?.code) throw new ApiError(parsed.error.code, parsed.error.message, res.status, parsed.error.detail);
  throw new ApiError(res.status === 401 ? 'UNAUTHORIZED' : res.status === 404 ? 'NOT_FOUND' : 'HTTP', `${res.status} ${res.statusText || 'HTTP error'}`, res.status);
}

async function json<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await send(method, path, body, signal);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

export const importApi = {
  preview: (req: PreviewRequest, signal?: AbortSignal) => json<PreviewResult>('POST', '/import/preview', req, signal),
  capabilities: (cid: string, database?: string | null, signal?: AbortSignal) =>
    json<ImportCapabilities>('GET', `/connections/${enc(cid)}/import/capabilities${database ? `?database=${enc(database)}` : ''}`, undefined, signal),
  tableInfo: (cid: string, ref: TableRef, signal?: AbortSignal) =>
    json<TargetTableInfo>('POST', `/connections/${enc(cid)}/import/table-info`, ref, signal),
  ddl: (cid: string, req: DdlRequest, signal?: AbortSignal) => json<DdlPreview>('POST', `/connections/${enc(cid)}/import/ddl`, req, signal),
  start: (cid: string, req: ImportRequest) => json<{ jobId: string }>('POST', `/connections/${enc(cid)}/import/start`, req),
  /** The CSV error report of a finished job, as bytes (a Blob keeps the UTF-8 BOM, so Excel opens Persian text correctly). */
  async errorReport(jobId: string): Promise<Blob> {
    const res = await send('GET', `/import/errors/${enc(jobId)}`);
    return res.blob();
  },
  cancel: (jobId: string) => api.cancelJob(jobId),
};
