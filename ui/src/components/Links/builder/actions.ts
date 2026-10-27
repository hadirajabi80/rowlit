// Engine actions of a query builder tab: run the query in the tab's own session on the link (results in the normal
// ResultsPane, keyed by the tab id), cancel, refresh the sources, the push-down plan, and the clean-up on close.
import { api, errorMessage, isApiError } from '../../../api/client';
import { linksApi, type PushdownPlan } from '../../../api/links';
import type { QueryParam } from '../../../api/types';
import { offerCloseIdle } from '../../../app/actions';
import { resolveParams } from '../../ParamsDialog/ParamsDialog';
import { getConnection, useConnections } from '../../../store/connections';
import { useLinks } from '../../../store/links';
import { useResults } from '../../../store/results';
import { createExecution, isRunning } from '../../../store/resultsReducer';
import { useSessions } from '../../../store/sessions';
import { useSettings } from '../../../store/settings';
import { toast } from '../../../store/ui';

let seq = 0;

/** Runs `sql` on the link in the tab's session; errors end up in the tab's Messages. */
export async function runBuilderQuery(tabId: string, linkId: string, sql: string, params: QueryParam[], title: string, opts: { askParams?: boolean } = {}): Promise<void> {
  const conn = getConnection(linkId);
  if (!conn) {
    toast('error', 'The linked database no longer exists');
    return;
  }
  if (!sql.trim()) {
    toast('info', 'Nothing to run', 'Add a table to the canvas first.');
    return;
  }
  const r = useResults.getState();
  if (isRunning(r.executions[r.byTab[tabId]])) {
    toast('warning', 'The query is still running', 'Cancel it first or wait for it to finish.');
    return;
  }
  const batches = [{ sql, line: 1, col: 1 }];
  // Advanced (SQL) mode runs the text as written: its `$name` / `?` values are asked for, as in a console.
  if (opts.askParams) {
    const asked = await resolveParams(tabId, conn.id, 'duckdb', batches);
    if (asked === null) return; // cancelled
    if (asked) params = asked;
  }
  const maxRows = useSettings.getState().settings.results.maxRows;
  const localId = `lb${++seq}`;
  useResults.getState().begin(createExecution({
    localId, tabId, connectionId: conn.id, sessionId: useSessions.getState().byTab[tabId] ?? null, label: 'script', batches, maxRows,
    confirmedDestructive: false, params,
  }));
  try {
    const session = await useSessions.getState().ensure(tabId, conn.id, null, 'auto');
    useConnections.getState().touch(conn.id);
    const res = await api.execute(session.sessionId, {
      batches, maxRows, stopOnError: true, label: 'script', source: { tabId, title },
      ...(params.length ? { params } : {}),
    });
    useResults.getState().attach(localId, res.executionId);
  } catch (e) {
    if (isApiError(e, 'SESSION_LIMIT')) {
      useResults.getState().fail(localId, errorMessage(e), 'SESSION_LIMIT');
      offerCloseIdle(conn.id, () => void runBuilderQuery(tabId, linkId, sql, params, title));
      return;
    }
    useResults.getState().fail(localId, errorMessage(e), isApiError(e) ? e.code : null);
  }
}

export async function cancelBuilderQuery(tabId: string): Promise<void> {
  const s = useSessions.getState().forTab(tabId);
  const r = useResults.getState();
  if (!s || !isRunning(r.executions[r.byTab[tabId]])) return;
  try {
    await api.cancel(s.sessionId);
  } catch (e) {
    toast('error', 'Cancel failed', errorMessage(e));
  }
}

/** Drops the cached source rows of a link (all sessions, or the tab's session); the next run fetches again. */
export async function refreshSources(linkId: string, tabId: string | null): Promise<void> {
  const sessionId = tabId ? useSessions.getState().byTab[tabId] ?? null : null;
  try {
    const r = await linksApi.refreshSources(linkId, { sessionId });
    void useLinks.getState().loadCatalog(linkId, true);
    toast('success', 'Sources refreshed', r.invalidated ? `${r.invalidated} cached table${r.invalidated === 1 ? '' : 's'} dropped: the next run reads the sources again.` : 'Nothing was cached: the next run reads the sources.');
  } catch (e) {
    toast('error', 'Could not refresh the sources', errorMessage(e));
  }
}

/** The engine's push-down plan of a statement on the link. */
export function loadPlan(linkId: string, sql: string, params: QueryParam[]): Promise<PushdownPlan> {
  return linksApi.plan(linkId, { sql, params });
}

export function disposeBuilder(tabId: string): void {
  useResults.getState().clearTab(tabId);
  void useSessions.getState().close(tabId, true).catch(() => undefined);
  useLinks.getState().clearHistory(tabId);
}
