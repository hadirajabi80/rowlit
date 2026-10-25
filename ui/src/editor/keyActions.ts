// The editor's actions that mirror a registry command (Run, Run script, Explain, Insert snippet, Format selection,
// Trigger suggest) take their keys from the command's EFFECTIVE shortcuts, so a user's keymap (commands/keymap.ts) applies
// inside Monaco too. Monaco cannot change an action's keybinding after it was added, so when the keymap changes the
// action is disposed and added again with the new keys.
//
// Framework-free: the Monaco namespace is passed in (only KeyMod / KeyCode are used), so the conversion and the
// re-registration are unit-tested with a fake editor.
import { normalizeShortcut } from '../commands/keys';
import { getCommand, shortcutsOf, subscribeCommands } from '../commands/registry';

/** The parts of the Monaco namespace the conversion reads. */
export interface MonacoKeys {
  KeyMod: { CtrlCmd: number; Shift: number; Alt: number; WinCtrl: number; chord(first: number, second: number): number };
  KeyCode: Record<string, number>;
}

const NAMED: Record<string, string> = {
  enter: 'Enter', escape: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', arrowup: 'UpArrow', arrowdown: 'DownArrow',
  arrowleft: 'LeftArrow', arrowright: 'RightArrow', '=': 'Equal', '-': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash',
  '\\': 'Backslash', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight', ';': 'Semicolon', "'": 'Quote',
};

/** Monaco key code number of a normalised key name ("a", "5", "f5", "enter"), null when Monaco has none. */
function keyCodeOf(key: string, m: MonacoKeys): number | null {
  let name: string | undefined;
  if (/^[a-z]$/.test(key)) name = `Key${key.toUpperCase()}`;
  else if (/^\d$/.test(key)) name = `Digit${key}`;
  else if (/^f\d+$/.test(key)) name = key.toUpperCase();
  else name = NAMED[key];
  const code = name ? m.KeyCode[name] : undefined;
  return typeof code === 'number' ? code : null;
}

/** Monaco keybinding (a number; a chord packs two) of one shortcut, null when it cannot be expressed. */
export function shortcutToMonaco(shortcut: string, m: MonacoKeys): number | null {
  const strokes = normalizeShortcut(shortcut).split(' ');
  if (strokes.length > 2) return null;
  const nums: number[] = [];
  for (const stroke of strokes) {
    const parts = stroke.split('+');
    const key = parts.pop() ?? '';
    const code = keyCodeOf(key, m);
    if (code === null) return null;
    let n = code;
    // Monaco's CtrlCmd is Ctrl off macOS and Cmd on macOS, as Mod is; WinCtrl is the physical Control key on macOS.
    if (parts.includes('ctrl')) n |= m.KeyMod.CtrlCmd;
    if (parts.includes('macctrl')) n |= m.KeyMod.WinCtrl;
    if (parts.includes('alt')) n |= m.KeyMod.Alt;
    if (parts.includes('shift')) n |= m.KeyMod.Shift;
    nums.push(n);
  }
  return nums.length === 2 ? m.KeyMod.chord(nums[0], nums[1]) : nums[0];
}

/** Monaco keybindings of a list of shortcuts (those Monaco cannot express are left out). */
export function monacoKeybindings(shortcuts: readonly string[], m: MonacoKeys): number[] {
  const out: number[] = [];
  for (const s of shortcuts) {
    const n = shortcutToMonaco(s, m);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The shortcuts of a command now, or `fallback` while the command is not registered yet. */
export function liveShortcuts(commandId: string, fallback: readonly string[]): readonly string[] {
  const c = getCommand(commandId);
  return c ? shortcutsOf(c) : fallback;
}

/** True while the command still answers to this shortcut; true too while the command is not registered. */
export function commandHasKey(commandId: string, shortcut: string): boolean {
  const key = normalizeShortcut(shortcut);
  const c = getCommand(commandId);
  return !c || shortcutsOf(c).map(normalizeShortcut).includes(key);
}

export interface KeyActionDef<A extends { id: string }> {
  /** The registry command whose shortcuts become the action's keybindings. */
  commandId: string;
  /** Shortcuts used until the command is registered. */
  fallback: readonly string[];
  /** The Monaco action without `keybindings`. */
  action: A;
}

export interface ActionHost<A extends { id: string }> {
  addAction(descriptor: A & { keybindings: number[] }): { dispose(): void };
}

/**
 * Adds the actions to an editor with their commands' current keys and keeps them in step with the keymap: whenever the
 * effective keys of a command change, its action is re-registered. Returns a disposer (actions and subscription).
 */
export function bindCommandActions<A extends { id: string }>(
  editor: ActionHost<A>,
  m: MonacoKeys,
  defs: readonly KeyActionDef<A>[],
): { dispose(): void } {
  const live: ({ keys: string; dispose(): void } | null)[] = defs.map(() => null);
  const sync = () => {
    defs.forEach((def, i) => {
      const keybindings = monacoKeybindings(liveShortcuts(def.commandId, def.fallback), m);
      const sig = keybindings.join(',');
      if (live[i]?.keys === sig) return;
      live[i]?.dispose();
      const d = editor.addAction({ ...def.action, keybindings });
      live[i] = { keys: sig, dispose: () => d.dispose() };
    });
  };
  sync();
  const off = subscribeCommands(sync);
  return {
    dispose() {
      off();
      for (const l of live) l?.dispose();
      live.fill(null);
    },
  };
}
