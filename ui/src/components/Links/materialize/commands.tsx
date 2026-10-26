// Linked databases, WP-D commands: links.materialize (write a link query / view / mounted table into a table of a writable
// connection) and links.addTable ("Add to link…" in the explorer's table and view menus and the Objects tab). The
// dialogs are lazy chunks (dynamic import on first use); this module only registers commands and menu entries.
import { getEditor } from '../../../app/editors';
import { extendContextMenu } from '../../../commands/menuModel';
import { registerCommands, type Command } from '../../../commands/registry';
import { toast } from '../../../store/ui';
import { useSessions } from '../../../store/sessions';
import { resolveParams } from '../../ParamsDialog/ParamsDialog';
import { activeLinkConsole, materializeSourceOf, tableSourceOf } from './args';
import { hasSource, type MaterializeSource } from './model';

/** The query of the active linked console (selection or the statement at the cursor), with `$name` values asked for. */
async function consoleSource(): Promise<MaterializeSource | null> {
  const tab = activeLinkConsole();
  if (!tab?.connectionId) return null;
  const target = getEditor(tab.id)?.getRunTarget('statement');
  const sql = target?.text ?? '';
  if (!target || !hasSource({ sql })) {
    toast('info', 'Nothing to materialize', 'Put the cursor in a SELECT statement of the linked console.');
    return null;
  }
  const params = await resolveParams(tab.id, tab.connectionId, 'duckdb', target.batches, { confirmLabel: 'Materialize' });
  if (params === null) return null;
  return { connectionId: tab.connectionId, sql, params: params ?? null, sessionId: useSessions.getState().byTab[tab.id] ?? null };
}

export async function openMaterialize(source: MaterializeSource): Promise<void> {
  const [{ mountDialog }, { MaterializeDialog }] = await Promise.all([import('./mount'), import('./MaterializeDialog')]);
  mountDialog('links.materialize', 'the materialize dialog', (close) => <MaterializeDialog source={source} onClose={close} />);
}

const COMMANDS: Command[] = [
  {
    id: 'links.materialize', title: 'Materialize result to a table…', category: 'Database', icon: 'Table2',
    keywords: 'link linked federated materialize save result table copy snapshot insert create',
    when: (a) => !!materializeSourceOf(a) || !!activeLinkConsole(),
    run: async (a) => {
      const source = materializeSourceOf(a) ?? (await consoleSource());
      if (source) await openMaterialize(source);
    },
  },
  {
    id: 'links.addTable', title: 'Add to link…', category: 'Database', icon: 'Link',
    keywords: 'link linked federated add mount table join across connections',
    when: (a) => !!tableSourceOf(a),
    run: async (a) => {
      const source = tableSourceOf(a);
      if (!source) return;
      const [{ mountDialog }, { AddToLinkDialog }] = await Promise.all([import('./mount'), import('./AddToLinkDialog')]);
      mountDialog('links.addTable', 'the Add to link dialog', (close) => <AddToLinkDialog source={source} onClose={close} />);
    },
  },
];

let registered = false;

/** Called from components/Links/commands.ts (block LINKS-WPD). */
export function registerMaterializeCommands(): void {
  if (registered) return;
  registered = true;
  registerCommands(COMMANDS);
  // hidden on links and on non-relational sources (the command's `when` needs a mountable table)
  for (const id of ['explorer.table', 'explorer.view']) extendContextMenu(id, [{ command: 'links.addTable', optional: true, hideDisabled: true }]);
  // a mounted table of a link (WP-C registers explorer.linkTable; the entry joins it once the menu exists)
  extendContextMenu('explorer.linkTable', [{ command: 'links.materialize', optional: true, hideDisabled: true }]);
}
