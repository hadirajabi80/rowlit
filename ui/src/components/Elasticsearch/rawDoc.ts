// Lossless document reads and writes through the console endpoint. The typed document API goes through `JSON.parse` /
// `JSON.stringify`, which round integers past 2^53 (snowflake ids, nanosecond timestamps, unsigned longs); the console
// moves the text itself, so saving such a document from the editor does not change its numbers.
import { ApiError, api } from '../../api/client';
import { stripJsonExtras } from '../../es/json';

const enc = encodeURIComponent;

export interface RawWrite {
  id: string;
  result: string;
  version: number | null;
  seqNo: number | null;
}

function errorOf(status: number, statusText: string, body: string): ApiError {
  let type: string | undefined;
  let message = `${status} ${statusText}`.trim();
  try {
    const e = (JSON.parse(body) as { error?: { type?: string; reason?: string } | string }).error;
    if (typeof e === 'string') message = e;
    else if (e) {
      type = e.type;
      message = type && e.reason ? `${type}: ${e.reason}` : e.reason ?? type ?? message;
    }
  } catch {
    /* not JSON: keep the status line */
  }
  return new ApiError('PROVIDER_ERROR', message, status, { status, esType: type });
}

/** The exact `_source` text of a document (numbers as stored). */
export async function readRawSource(cid: string, index: string, id: string, routing?: string | null): Promise<string> {
  const q = routing ? `?routing=${enc(routing)}` : '';
  const r = await api.es.console(cid, { method: 'GET', path: `/${enc(index)}/_source/${enc(id)}${q}`, body: null });
  if (r.status !== 200) throw errorOf(r.status, r.statusText, r.body);
  return r.body;
}

/** Index / replace a document from JSON text. A version conflict is an ApiError with status 409. */
export async function writeRaw(cid: string, o: {
  index: string; id: string | null; text: string; ifSeqNo?: number | null; ifPrimaryTerm?: number | null; routing?: string | null; create?: boolean;
}): Promise<RawWrite> {
  const q = ['refresh=wait_for'];
  if (o.ifSeqNo != null && o.ifPrimaryTerm != null) q.push(`if_seq_no=${o.ifSeqNo}`, `if_primary_term=${o.ifPrimaryTerm}`);
  if (o.routing) q.push(`routing=${enc(o.routing)}`);
  if (o.create && o.id) q.push('op_type=create');
  const path = `/${enc(o.index)}/_doc${o.id ? `/${enc(o.id)}` : ''}?${q.join('&')}`;
  const r = await api.es.console(cid, { method: o.id ? 'PUT' : 'POST', path, body: stripJsonExtras(o.text) });
  if (r.status >= 300) throw errorOf(r.status, r.statusText, r.body);
  const w = JSON.parse(r.body) as { _id?: string; result?: string; _version?: number; _seq_no?: number };
  return { id: w._id ?? o.id ?? '', result: w.result ?? '', version: w._version ?? null, seqNo: w._seq_no ?? null };
}
