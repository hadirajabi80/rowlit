// Local history of editors (auto-loaded by commands/index.ts).
//   editor.localHistory   Ctrl+Alt+H   the timeline of the active console's text: diff against the editor, restore, copy, label
// Snapshots are taken by ./capture.ts from the tabs and results stores (Run, Save, close, every 2 minutes while typing),
// so no editor code is involved. The view itself is lazy (./views.tsx); this module stays small.
import { registerCommands, type Command } from '../../commands/registry';
import { registerTabView } from '../layout/tabViews';
import { startLocalHistoryCapture } from './capture';
import { LOCAL_HISTORY_VIEW, openLocalHistory, targetConsole } from './open';
import { LocalHistoryTab } from './views';

export const LOCAL_HISTORY_COMMANDS: Command<never>[] = [
  {
    id: 'editor.localHistory', title: 'Local history…', category: 'Edit', shortcut: 'Mod+Alt+H', icon: 'History',
    keywords: 'versions snapshots restore previous undo recover lost query revisions diff timeline',
    when: (args?: unknown) => !!targetConsole(args),
    run: (args?: unknown) => {
      const tab = targetConsole(args);
      if (tab) openLocalHistory(tab);
    },
  },
];

let registered = false;

export function registerLocalHistoryCommands(): void {
  if (registered) return;
  registered = true;
  registerTabView(LOCAL_HISTORY_VIEW, { component: LocalHistoryTab, icon: 'History' });
  registerCommands(LOCAL_HISTORY_COMMANDS);
  startLocalHistoryCapture();
}
