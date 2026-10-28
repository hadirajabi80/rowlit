import { getConnection } from '../../store/connections';
import { getActiveTab, useTabs } from '../../store/tabs';

export const MONITOR_VIEW = 'monitor';
export interface MonitorState { connectionId: string; database: string | null; intervalMs: number }
const providers = new Set(['postgresql', 'sqlserver', 'mysql', 'mariadb', 'clickhouse', 'oracle', 'snowflake']);

export function monitorContext(a?: unknown): MonitorState | null {
  const o = a && typeof a === 'object' ? a as { connectionId?: unknown; database?: unknown } : null;
  const active = getActiveTab();
  const connectionId = typeof o?.connectionId === 'string' ? o.connectionId : active?.connectionId;
  if (!connectionId || !providers.has(getConnection(connectionId)?.providerId ?? '')) return null;
  return { connectionId, database: typeof o?.database === 'string' ? o.database : active?.database ?? null, intervalMs: 5000 };
}

export function openMonitor(state: MonitorState): string {
  const c = getConnection(state.connectionId);
  return useTabs.getState().openView({
    view: MONITOR_VIEW, title: `Server monitor — ${c?.name ?? state.connectionId}`, connectionId: state.connectionId,
    database: state.database, state, key: `${state.connectionId}:monitor`,
  });
}
