// Tab identity of an editor's local history. The same text can be reached through several identities over its life (a
// console gets saved to a file, a file is reopened in a new tab after a restart, a saved query is renamed), so a tab has a
// primary key (where new snapshots go) plus the aliases its older snapshots may sit under; the history view lists the union.
//
//   q:<saved query id>                         a console bound to a saved query
//   o:<connection>|<database>|<schema>|<type>|<name>   an F4 "Edit:" console of a database object
//   f:<file path>                              a console saved to / opened from a .sql file
//   t:<tab id>                                 any other console (the tab id is persisted in the workspace)
import type { ConsoleTab } from '../../store/tabs';

/** The key under which new snapshots of the tab are stored. */
export function primaryKey(tab: ConsoleTab): string {
  if (tab.savedQuery) return `q:${tab.savedQuery.id}`;
  if (tab.edit) {
    const r = tab.edit.ref;
    return `o:${tab.edit.connectionId}|${tab.edit.database ?? ''}|${r.schema ?? ''}|${r.type}|${r.name}`;
  }
  if (tab.filePath) return `f:${tab.filePath}`;
  return `t:${tab.id}`;
}

/** Every key the tab's history can live under, primary first. */
export function historyKeys(tab: ConsoleTab): string[] {
  const keys = [primaryKey(tab)];
  const own = `t:${tab.id}`;
  if (!keys.includes(own)) keys.push(own);
  if (tab.filePath) {
    const f = `f:${tab.filePath}`;
    if (!keys.includes(f)) keys.push(f);
  }
  return keys;
}

/** A readable name for the history view's header. */
export function historyTitle(tab: ConsoleTab): string {
  return tab.title;
}
