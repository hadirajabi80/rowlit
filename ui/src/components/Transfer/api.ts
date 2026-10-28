// REST wrappers of Data Transfer (contract: api/types.transfer.ts). Same authenticated requests as the shared client
// (which does not export its request helper), same error mapping.
import { api, API_PREFIX, ApiError, errorMessage, getClientConfig } from '../../api/client';
import { CLIENT_ID_HEADER, uiClientId } from '../../api/clientId';
import type { ApiErrorBody } from '../../api/types';
import type { DumpDialect, TransferPlan, TransferSpec, TransferSupport, TransferTypesInfo } from '../../api/types.transfer';

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

export const transferApi = {
  plan: (spec: TransferSpec, signal?: AbortSignal) => json<TransferPlan>('POST', '/transfer/plan', spec, signal),
  run: (spec: TransferSpec) => json<{ jobId: string }>('POST', '/transfer/run', spec),
  types: (provider: string, connectionId?: string | null, signal?: AbortSignal) =>
    json<TransferTypesInfo>('GET', `/transfer/types?provider=${enc(provider)}${connectionId ? `&connectionId=${enc(connectionId)}` : ''}`, undefined, signal),
  support: (connectionId: string, signal?: AbortSignal) => json<TransferSupport>('GET', `/transfer/support?connectionId=${enc(connectionId)}`, undefined, signal),
  dumpDialects: (signal?: AbortSignal) => json<DumpDialect[]>('GET', '/transfer/dump-dialects', undefined, signal),
  cancel: (jobId: string) => api.cancelJob(jobId),
};
