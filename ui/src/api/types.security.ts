export type SecurityKind = 'user' | 'login' | 'role';
export type SecurityAction = 'create' | 'drop' | 'password' | 'grant' | 'revoke' | 'membership';

export interface SecurityPrincipal { name: string; kind: SecurityKind; host: string | null; canLogin: boolean; disabled: boolean; system: boolean; detail: string | null }
export interface SecurityGrant { object: string; privilege: string; grantable: boolean; grantor: string | null; scope: string | null; state: string | null }
export interface SecurityPrincipalDetail {
  principal: SecurityPrincipal; attributes: Record<string, string | null>; members: string[]; memberOf: string[];
  grants: SecurityGrant[]; createScript: string[]; notes: string[];
}
export interface SecurityPrincipalsResult { providerId: string; writable: boolean; principals: SecurityPrincipal[]; notes: string[] }
export interface SecurityChangeRequest {
  action: SecurityAction; kind: SecurityKind; name: string; host?: string; password?: string; role?: string;
  database?: string; schema?: string; object?: string; objectType?: 'global' | 'database' | 'schema' | 'table';
  privileges?: string[]; grantable?: boolean; remove?: boolean; deny?: boolean;
}
export interface SecurityScriptResult { statements: string[]; previewStatements: string[]; transactional: boolean; warnings: string[] }
export interface SecurityApplyResult { applied: boolean; statements: number; elapsedMs: number }
