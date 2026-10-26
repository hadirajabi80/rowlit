// Linked databases (plan-links): the links package's commands, auto-loaded by commands/index.ts as its own lazy chunk.
// Owned by WP-C (link editor + query builder), except the LINKS-WPD block (WP-D: materialize, native links, "Add to
// link…", palette entries). WP0 stub: the entry points the shell already routes here (Welcome card, connection dialog,
// edit/duplicate of a link) answer "coming soon" until WP-C replaces them with the real editor.
//
// Reserved ids (the shell and docs/wp-notes/links/wp0.md refer to them):
//   links.new {folder?, connectAfter?}       new link editor          (Welcome, connection dialog, Ctrl+P)
//   links.edit {connectionId}                edit a link              (connection dialog host: connections.edit on a link)
//   links.duplicate {connectionId}           duplicate a link         (connections.duplicate on a link)
//   links.builder {connectionId}             open the query builder tab (view 'links.builder')
//   links.addTable {connectionId, database, schema, name, type}  "Add to link…" (WP-D)
//   links.refreshSources {connectionId}      drop the session's cached sources
//   links.plan                               push-down plan of the active console's statement
//   links.materialize / links.nativeLink     wizards (WP-D)
// Menus: commands/menuModel.ts LINK_MENU_IDS (explorer.link, explorer.linkTable, builder.*).
import { registerCommands, type Command } from '../../commands/registry';
import { toast } from '../../store/ui';
// LINKS-WPD begin (imports)
import { registerMaterializeCommands } from './materialize/commands';
import { registerNativeLinkCommands } from './native/commands';
// LINKS-WPD end

const comingSoon = () => toast('info', 'Linked databases are coming soon', 'Query across your connections in one SQL statement.');

/** WP0 placeholders of the entry points (WP-C replaces this list). */
const COMMANDS: Command<never>[] = [
  { id: 'links.new', title: 'New linked database…', category: 'File', icon: 'Link', keywords: 'link federated join across connections', run: comingSoon },
  { id: 'links.edit', title: 'Edit linked database…', category: 'Database', palette: false, run: comingSoon },
  { id: 'links.duplicate', title: 'Duplicate linked database', category: 'Database', palette: false, run: comingSoon },
];

export function registerLinksCommands(): void {
  registerCommands(COMMANDS);
  // LINKS-WPD begin
  registerMaterializeCommands();
  registerNativeLinkCommands();
  // LINKS-WPD end
}
