import { getConnection } from '../../store/connections';
import { getActiveTab, useTabs } from '../../store/tabs';
import type { SecurityFilter } from './model';

export const SECURITY_VIEW = 'security';
export interface SecurityState { connectionId: string; database: string | null; filter: SecurityFilter }
const providers = new Set(['postgresql', 'mysql', 'mariadb', 'sqlserver', 'oracle', 'clickhouse', 'snowflake']);

export function securityContext(a?: unknown): SecurityState | null {
  const o = a && typeof a === 'object' ? a as { connectionId?: unknown; database?: unknown; filter?: unknown } : null;
  const active = getActiveTab();
  const connectionId = typeof o?.connectionId === 'string' ? o.connectionId : active?.connectionId;
  if (!connectionId || !providers.has(getConnection(connectionId)?.providerId ?? '')) return null;
  const filter = o?.filter === 'users' || o?.filter === 'roles' ? o.filter : 'all';
  return { connectionId, database: typeof o?.database === 'string' ? o.database : active?.database ?? null, filter };
}
export function openSecurity(state: SecurityState): string {
  const c = getConnection(state.connectionId);
  return useTabs.getState().openView({ view: SECURITY_VIEW, title: `Security — ${c?.name ?? state.connectionId}`, connectionId: state.connectionId,
    database: state.database, state, key: `${state.connectionId}:${state.database ?? ''}:security:${state.filter}` });
}
