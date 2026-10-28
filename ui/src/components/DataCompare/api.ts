// REST wrappers of Data compare & sync (engine DataCompareModule; contracts in api/types.dataCompare.ts). Built on the
// shared client's `http` helpers so the module stays in the lazy chunk.
import { api, http } from '../../api/client';
import type {
  DataApplyRequest, DataComparePreview, DataCompareRequest, DataDiffPage, DataSyncRequest, DataSyncScript, DiffClass,
} from '../../api/types.dataCompare';

const enc = encodeURIComponent;

export const dataCompareApi = {
  /** Column pairs of both sides, the default key and what can be synchronized. */
  preview: (req: DataCompareRequest, signal?: AbortSignal) =>
    http.json<DataComparePreview>('POST', '/data-compare/columns', { body: req, signal }),
  /** Starts the `data.compare` job; its `job.done` carries the DataCompareResult. */
  start: (req: DataCompareRequest) => http.json<{ jobId: string }>('POST', '/data-compare', { body: req }),
  rows: (compareId: string, cls: DiffClass | null, offset: number, limit: number, signal?: AbortSignal) =>
    http.json<DataDiffPage>('GET', `/data-compare/${enc(compareId)}/rows`, {
      query: { class: cls ?? undefined, offset: String(offset), limit: String(limit) }, signal,
    }),
  script: (compareId: string, req: DataSyncRequest) => http.json<DataSyncScript>('POST', `/data-compare/${enc(compareId)}/script`, { body: req }),
  /** Starts the `data.sync` job (done / total = statements); its `job.done` carries the DataApplyResult. */
  apply: (compareId: string, req: DataApplyRequest) => http.json<{ jobId: string }>('POST', `/data-compare/${enc(compareId)}/apply`, { body: req }),
  discard: (compareId: string) => http.json<void>('DELETE', `/data-compare/${enc(compareId)}`),
  cancel: (jobId: string) => api.cancelJob(jobId),
};
