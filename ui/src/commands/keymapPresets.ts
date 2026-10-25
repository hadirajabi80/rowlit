// Preset keymaps: override maps applied on top of the defaults (commands/keymap.ts), for people who come from another
// tool. A preset only lists what differs from Rowlit's defaults; choosing one replaces the user's overrides with it.
//
// Every id must be a registered command and the result must have no same-scope conflict: keymapPresets.test.ts
// checks both against the real registry, so a command that is renamed or a default that moves fails the build here
// instead of silently dropping a binding.
//
// "Search everywhere" (double Shift) is not supported by the key dispatcher; JetBrains' Go to symbol maps to the
// command that finds a database object, next to Rowlit's own key for it.
import { normalizeShortcut } from './keys';
import { allConflicts, effectiveKeys, parseShortcut, type CommandKeys, type KeybindingOverrides, type KeymapEntry } from './keymap';

export interface KeymapPreset {
  id: string;
  name: string;
  description: string;
  overrides: KeybindingOverrides;
}

export const DEFAULT_PRESET_ID = 'rowlit';

export const KEYMAP_PRESETS: readonly KeymapPreset[] = [
  {
    id: DEFAULT_PRESET_ID,
    name: 'Rowlit (default)',
    description: 'The shortcuts Rowlit ships with.',
    overrides: {},
  },
  {
    id: 'jetbrains',
    name: 'JetBrains / DataGrip',
    description: 'Ctrl+Shift+F10 runs the script, Ctrl+Alt+L formats, Ctrl+Shift+N finds an object, Ctrl+Shift+A finds a command.',
    overrides: {
      'run.script': ['Mod+Shift+F10'],
      'run.cancel': ['Mod+F2'],
      'format.document': ['Mod+Alt+L'],
      'view.goToObject': ['Mod+Shift+N', 'Mod+P'],
      'file.newConnection': ['Mod+Alt+Insert'],
      'view.commandPalette': ['Mod+Shift+A', 'Mod+Shift+P'],
      'tab.close': ['Mod+F4', 'Mod+W'],
      'tab.next': ['Alt+ArrowRight', 'Mod+PageDown'],
      'tab.prev': ['Alt+ArrowLeft', 'Mod+PageUp'],
    },
  },
  {
    id: 'vscode',
    name: 'VS Code / Azure Data Studio',
    description: 'F5 runs the script, F1 opens the command palette, Ctrl+K Ctrl+S the keyboard shortcuts, Ctrl+T finds an object.',
    overrides: {
      'run.script': ['F5'],
      'format.document': ['Shift+Alt+F'],
      'view.commandPalette': ['Mod+Shift+P', 'F1'],
      'view.shortcuts': ['Mod+K Mod+S'],
      'view.goToObject': ['Mod+P', 'Mod+T'],
      'file.newConsole': ['Mod+N'],
      'view.toggleResults': ['Mod+J'],
      'snippet.insert': ['Mod+Alt+J'],
    },
  },
  {
    id: 'ssms',
    name: 'SQL Server Management Studio',
    description: 'Ctrl+E runs, Ctrl+M includes the actual plan, Ctrl+Shift+R refreshes the catalog, F8 shows the explorer.',
    overrides: {
      'run.statement': ['Mod+E', 'Mod+Enter'],
      'explain.actual': ['Mod+M'],
      'connections.refreshCatalog': ['Mod+Shift+R'],
      'view.maximizeResults': ['Shift+Alt+Enter'],
      'view.focusExplorer': ['F8', 'Alt+1'],
      'connections.changeDatabase': ['Mod+U', 'Mod+Shift+D'],
    },
  },
];

export function getPreset(id: string): KeymapPreset | undefined {
  return KEYMAP_PRESETS.find((p) => p.id === id);
}

function sameOverrides(a: KeybindingOverrides, b: KeybindingOverrides): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const x = a[k], y = b[k];
    if (x === undefined || y === undefined) return false;
    if (x === null || y === null) return x === y;
    return x.length === y.length && x.every((s, i) => normalizeShortcut(s) === normalizeShortcut(y[i]));
  });
}

/** The preset's overrides limited to commands that exist (a preset never fails on a command this build lacks). */
export function presetOverrides(preset: KeymapPreset, known: (id: string) => boolean = () => true): KeybindingOverrides {
  const out: KeybindingOverrides = {};
  for (const [id, keys] of Object.entries(preset.overrides)) if (known(id)) out[id] = keys;
  return out;
}

/**
 * The preset whose overrides are exactly these (the default one for none), else null: the keymap is custom. `known`
 * limits the preset to the commands that exist, as applying it does.
 */
export function detectPreset(o: KeybindingOverrides, known: (id: string) => boolean = () => true): KeymapPreset | null {
  return KEYMAP_PRESETS.find((p) => sameOverrides(presetOverrides(p, known), o)) ?? null;
}

/** Problems of a preset against the command list: unknown ids, invalid shortcuts, same-scope conflicts. Empty = valid. */
export function validatePreset(preset: KeymapPreset, cmds: readonly (CommandKeys & { title: string; scope: string })[]): string[] {
  const problems: string[] = [];
  const byId = new Map(cmds.map((c) => [c.id, c]));
  for (const [id, keys] of Object.entries(preset.overrides)) {
    const c = byId.get(id);
    if (!c) {
      problems.push(`${id} is not a command`);
      continue;
    }
    for (const k of keys ?? []) {
      const p = parseShortcut(k, c.scope);
      if (!p.ok) problems.push(`${id}: ${k}: ${p.reason}`);
    }
  }
  const entries: KeymapEntry[] = cmds.map((c) => ({ id: c.id, title: c.title, scope: c.scope, keys: effectiveKeys(c, preset.overrides) }));
  for (const c of allConflicts(entries)) problems.push(`${c.key} is bound to both ${c.id} and ${c.with}`);
  return problems;
}
