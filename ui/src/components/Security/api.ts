import { http } from '../../api/client';
import type { SecurityApplyResult, SecurityChangeRequest, SecurityPrincipalDetail, SecurityPrincipalsResult, SecurityScriptResult } from '../../api/types.security';

const path = (connectionId: string, suffix: string) => `/security/${encodeURIComponent(connectionId)}${suffix}`;
export const securityApi = {
  list: (connectionId: string, database: string | null, signal?: AbortSignal) => http.json<SecurityPrincipalsResult>('GET', path(connectionId, '/principals'), { query: { database }, signal }),
  detail: (connectionId: string, database: string | null, name: string, kind: string, host: string | null, signal?: AbortSignal) => http.json<SecurityPrincipalDetail>('GET', path(connectionId, '/principal'), { query: { database, name, kind, host }, signal }),
  script: (connectionId: string, request: SecurityChangeRequest) => http.json<SecurityScriptResult>('POST', path(connectionId, '/script'), { body: request }),
  apply: (connectionId: string, database: string | null, request: SecurityChangeRequest) => http.json<SecurityApplyResult>('POST', path(connectionId, '/apply'), { query: { database }, body: request }),
};
