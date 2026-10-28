// REST wrappers of Schema compare (engine SchemaCompareModule; contracts in api/types.schemaCompare.ts). Built on the
// shared client's `http` helpers so the module stays in the lazy chunk.
import { api, http } from '../../api/client';
import type {
  CompareApplyRequest, CompareApplyResult, CompareItemDetail, CompareRequest, CompareScript, CompareSupport,
} from '../../api/types.schemaCompare';

const enc = encodeURIComponent;

export const schemaCompareApi = {
  /** Starts the `schema.compare` job; its `job.done` carries the CompareResult. */
  start: (req: CompareRequest) => http.json<{ jobId: string }>('POST', '/schema-compare', { body: req }),
  support: (connectionId: string, signal?: AbortSignal) =>
    http.json<CompareSupport>('GET', '/schema-compare/support', { query: { connectionId }, signal }),
  item: (compareId: string, itemId: string, signal?: AbortSignal) =>
    http.json<CompareItemDetail>('GET', `/schema-compare/${enc(compareId)}/item`, { query: { item: itemId }, signal }),
  script: (compareId: string, itemIds: string[] | null) =>
    http.json<CompareScript>('POST', `/schema-compare/${enc(compareId)}/script`, { body: { itemIds } }),
  apply: (compareId: string, req: CompareApplyRequest) =>
    http.json<CompareApplyResult>('POST', `/schema-compare/${enc(compareId)}/apply`, { body: req }),
  discard: (compareId: string) => http.json<void>('DELETE', `/schema-compare/${enc(compareId)}`),
  cancel: (jobId: string) => api.cancelJob(jobId),
};
