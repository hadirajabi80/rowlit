import type { SecurityChangeRequest, SecurityKind, SecurityPrincipal } from '../../api/types.security';

export type SecurityFilter = 'all' | 'users' | 'roles';
export function filterPrincipals(rows: SecurityPrincipal[], filter: SecurityFilter, search: string): SecurityPrincipal[] {
  const q = search.trim().toLocaleLowerCase();
  return rows.filter((p) => (filter === 'all' || (filter === 'roles' ? p.kind === 'role' : p.kind !== 'role'))
    && (!q || `${p.name} ${p.host ?? ''} ${p.detail ?? ''}`.toLocaleLowerCase().includes(q)));
}
export function blankChange(action: SecurityChangeRequest['action'], kind: SecurityKind, name = ''): SecurityChangeRequest {
  return { action, kind, name, objectType: 'table', privileges: ['SELECT'] };
}
