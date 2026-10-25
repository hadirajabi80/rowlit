// The `results` view tab ("Open in a new tab" in the results pane's dock menu): the results and messages of one console
// as a page of their own, so they can sit in a split editor group next to the editor, or fill a whole group. It shows
// the console's latest execution live (a new run lands here, not in the console), with the same grid, filter, export
// and Messages as the docked pane. Closing the tab, or "Dock back" in its menu, returns the pane to the console.
import { useEffect } from 'react';
import { useCommandContext } from '../../commands/useCommands';
import { useDialect } from '../../store/connections';
import { useTabs } from '../../store/tabs';
import { ErrorBoundary } from '../common/ErrorBoundary';
import type { TabViewProps } from '../layout/tabViews';
import { resultsTabTitle } from './dock';
import { ResultsPane } from './ResultsPane';

export function ResultsTabView({ tab, theme }: TabViewProps) {
  useCommandContext();
  const consoleId = (tab.state as { consoleTabId?: string } | null)?.consoleTabId ?? '';
  const target = useTabs((s) => s.tabs.find((t) => t.id === consoleId));
  const consoleTab = target?.kind === 'console' ? target : undefined;
  const dialect = useDialect(consoleTab?.connectionId ?? null);

  // The title follows the console's name; the tab closes with its console (or when the console left this window).
  const title = consoleTab ? resultsTabTitle(consoleTab.title) : null;
  useEffect(() => {
    if (title && title !== tab.title) useTabs.getState().updateView(tab.id, { title });
  }, [title, tab.id, tab.title]);
  useEffect(() => {
    if (consoleId && !consoleTab) useTabs.getState().close(tab.id);
  }, [consoleId, consoleTab, tab.id]);

  if (!consoleTab) return null;
  return (
    <div className="results-page" data-region="results" data-command-scope="results">
      <ErrorBoundary area="the results" variant="panel">
        <ResultsPane tabId={consoleTab.id} dialect={dialect} theme={theme} inTab />
      </ErrorBoundary>
    </div>
  );
}
