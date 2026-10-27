// Opens the local history tab of a console. One tab per editor (re-opening activates it).
import { getActiveConsole, useTabs, type ConsoleTab } from '../../store/tabs';
import { historyKeys, historyTitle } from './keys';
import type { LocalHistoryTabState } from './model';

export const LOCAL_HISTORY_VIEW = 'local-history';

/** The console a command acts on: the one named by `args.tabId`, else the active console. */
export function targetConsole(args?: unknown): ConsoleTab | undefined {
  const id = args && typeof args === 'object' && typeof (args as { tabId?: unknown }).tabId === 'string' ? (args as { tabId: string }).tabId : null;
  if (id) {
    const t = useTabs.getState().tabs.find((x) => x.id === id);
    return t?.kind === 'console' ? t : undefined;
  }
  return getActiveConsole();
}

export function openLocalHistory(tab: ConsoleTab): string {
  const state: LocalHistoryTabState = { tabId: tab.id, keys: historyKeys(tab), title: historyTitle(tab) };
  return useTabs.getState().openView({
    view: LOCAL_HISTORY_VIEW,
    title: `History: ${tab.title}`,
    connectionId: tab.connectionId,
    database: tab.database,
    state,
    key: `${LOCAL_HISTORY_VIEW}:${tab.id}`,
  });
}
