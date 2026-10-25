// What the Keyboard shortcuts dialog lists: one row per command with its effective shortcuts, the editor's built-in keys,
// and the rules that decide what can be edited. Reads the command registry; no React.
import { displayShortcut, normalizeShortcut } from '../../commands/keys';
import {
  allConflicts, EDITOR_ACTION_COMMANDS, EDITOR_BUILTIN_KEYS, type KeymapEntry,
} from '../../commands/keymap';
import {
  defaultShortcutsOf, isOverridden, listCommands, shortcutsOf, type ShortcutBinding,
} from '../../commands/registry';

export const BUILTIN_CATEGORY = 'Editor (built-in)';
const BUILTIN_PREFIX = 'builtin:';

export interface KeymapRow {
  id: string;
  title: string;
  category: string;
  scope: string;
  /** Effective shortcuts as bindings (primary first). */
  bindings: ShortcutBinding[];
  /** What the command ships with. */
  defaults: string[];
  /** The user changed it (rebound or unbound). */
  edited: boolean;
  /** Can be changed here; false for the editor's built-ins and for keys a view handles itself. */
  editable: boolean;
  /** Why it cannot be changed. */
  lockedReason?: string;
  builtin: boolean;
  /** One of its keys is bound to another command of the same scope. */
  conflicting: boolean;
}

/** The commands the rules work on (id, defaults, title, scope). */
export function commandEntries(): { id: string; title: string; scope: string; shortcut?: string; altShortcuts?: string[] }[] {
  return listCommands().map((c) => ({ id: c.id, title: c.title, scope: c.scope ?? 'global', shortcut: c.shortcut, altShortcuts: c.altShortcuts }));
}

/** Effective keys of every command, for conflict checks. */
export function keymapEntries(): KeymapEntry[] {
  return listCommands().map((c) => ({ id: c.id, title: c.title, scope: c.scope ?? 'global', keys: shortcutsOf(c) }));
}

function binding(commandId: string, scope: string, shortcut: string, primary: boolean): ShortcutBinding {
  return { key: normalizeShortcut(shortcut), display: displayShortcut(shortcut), commandId, scope, primary };
}

export function isBuiltinId(id: string): boolean {
  return id.startsWith(BUILTIN_PREFIX);
}

/** Every row of the dialog, unsorted: commands (with or without keys) and the editor's built-in keys. */
export function buildKeymapRows(): KeymapRow[] {
  const entries = keymapEntries();
  const clash = new Set<string>();
  for (const c of allConflicts(entries)) {
    clash.add(c.id);
    clash.add(c.with);
  }
  const rows: KeymapRow[] = [];
  for (const c of listCommands()) {
    const keys = shortcutsOf(c);
    // Internal commands (palette: false) without a key have nothing to show or to bind.
    if (c.palette === false && !keys.length && !isOverridden(c.id)) continue;
    const scope = c.scope ?? 'global';
    const host = c.keyHandler === 'host' && !EDITOR_ACTION_COMMANDS.includes(c.id);
    rows.push({
      id: c.id,
      title: c.title,
      category: c.category,
      scope,
      bindings: keys.map((k, i) => binding(c.id, scope, k, i === 0)),
      defaults: defaultShortcutsOf(c),
      edited: isOverridden(c.id),
      editable: !host,
      lockedReason: host ? 'This key is handled by the view itself and cannot be changed' : undefined,
      builtin: false,
      conflicting: clash.has(c.id),
    });
  }
  for (const b of EDITOR_BUILTIN_KEYS) {
    const id = `${BUILTIN_PREFIX}${normalizeShortcut(b.key)}`;
    rows.push({
      id, title: b.title, category: BUILTIN_CATEGORY, scope: 'editor', bindings: [binding(id, 'editor', b.key, true)], defaults: [b.key],
      edited: false, editable: false, lockedReason: 'Built into the code editor; it cannot be changed', builtin: true, conflicting: false,
    });
  }
  return rows;
}

/** Text filter: command name, id, category or any of its keys (as shown, and as written). */
export function rowMatches(r: KeymapRow, needle: string): boolean {
  if (!needle) return true;
  const keys = r.bindings.map((b) => `${b.display} ${displayShortcut(b.key)}`).join(' ');
  return `${r.category} ${r.title} ${r.id} ${keys}`.toLowerCase().includes(needle);
}

export type RowFilter = 'assigned' | 'all' | 'edited' | 'unassigned' | 'conflicts';

export function rowInFilter(r: KeymapRow, f: RowFilter): boolean {
  if (f === 'assigned') return r.bindings.length > 0 || r.edited;
  if (f === 'edited') return r.edited;
  if (f === 'unassigned') return !r.builtin && r.bindings.length === 0;
  if (f === 'conflicts') return r.conflicting;
  return true;
}
