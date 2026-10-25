// The dock control in the header of the results / messages pane: a button that opens "Position: Bottom / Right / Left",
// "Open in a new tab", "Hide results" and "Open results automatically". Every entry runs a registered command
// (components/ResultsPane/commands.ts), so the palette and the menu agree. The position it sets is the one of the
// console's kind: query consoles, or "Edit:" consoles, which can have their own.
import { ExternalLink, PanelBottom, PanelLeft, PanelRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { displayShortcut } from '../../commands/keys';
import { getCommand, runCommand } from '../../commands/registry';
import { useSettings } from '../../store/settings';
import { showMenuBelow, type MenuItem } from '../common/Menu';
import { autoOpenFrom, dockFrom, hasEditDock, isEditConsole, type ResultsDock } from './dock';

const DOCK_ICON: Record<ResultsDock, ReactNode> = {
  bottom: <PanelBottom size={14} aria-hidden="true" />,
  right: <PanelRight size={14} aria-hidden="true" />,
  left: <PanelLeft size={14} aria-hidden="true" />,
};

const DOCK_COMMAND: Record<ResultsDock, string> = { bottom: 'results.dockBottom', right: 'results.dockRight', left: 'results.dockLeft' };

/** The items of the dock menu for the console `tabId` (also used by the tests). */
export function dockMenuItems(tabId: string, inTab: boolean): MenuItem[] {
  const ui = useSettings.getState().settings.ui;
  const edit = isEditConsole(tabId);
  const dock = dockFrom(ui, edit);
  const target = { kind: 'tab', tabId };
  const hide = getCommand('view.toggleResults')?.shortcut;
  const items: MenuItem[] = [
    { id: 'results.dock.head', label: edit ? 'Position in Edit: consoles' : 'Position in query consoles', disabled: true },
    ...(['bottom', 'right', 'left'] as ResultsDock[]).map((d): MenuItem => ({
      id: `results.dock.${d}`,
      label: d === 'bottom' ? 'Bottom' : d === 'right' ? 'Right' : 'Left',
      icon: DOCK_ICON[d],
      checked: !inTab && dock === d,
      onClick: () => runCommand(DOCK_COMMAND[d], target),
    })),
  ];
  if (edit && hasEditDock(ui)) {
    items.push({ id: 'results.dock.same', label: 'Same position as query consoles', onClick: () => runCommand('results.dockSame', target) });
  }
  items.push(
    { id: 'sep1', separator: true },
    { id: 'results.openInTab', label: 'Open in a new tab', icon: <ExternalLink size={14} aria-hidden="true" />, checked: inTab, disabled: inTab, onClick: () => runCommand('results.openInTab', target) },
  );
  if (!inTab) {
    items.push({ id: 'results.hide', label: 'Hide results', shortcut: hide ? displayShortcut(hide) : undefined, onClick: () => runCommand('view.toggleResults', target) });
  }
  items.push(
    { id: 'sep2', separator: true },
    { id: 'results.autoOpen', label: 'Open results automatically when a query runs', checked: autoOpenFrom(ui), onClick: () => runCommand('results.toggleAutoOpen') },
  );
  return items;
}

export function DockButton({ tabId, inTab }: { tabId: string; inTab: boolean }) {
  const edit = isEditConsole(tabId);
  const dock = useSettings((s) => dockFrom(s.settings.ui, edit));
  return (
    <button
      className="icon-btn sm"
      title={inTab ? 'Results are in a tab: dock them back into the console, or choose a position' : 'Move the results: bottom, right, left, or their own tab'}
      aria-label="Results position"
      aria-haspopup="menu"
      data-testid="results-dock"
      onClick={(e) => showMenuBelow(e.currentTarget, dockMenuItems(tabId, inTab))}
    >
      {inTab ? <ExternalLink size={14} aria-hidden="true" /> : DOCK_ICON[dock]}
    </button>
  );
}
