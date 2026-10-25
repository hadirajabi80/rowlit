// Monaco keybindings of the command-backed editor actions: shortcut conversion, and re-registration when the user's
// keymap changes (unit-level: a fake editor, no Monaco).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setPlatformForTests } from '../commands/keys';
import { registerCommands, resetCommandsForTests, setKeybindingOverrides } from '../commands/registry';
import { bindCommandActions, commandHasKey, monacoKeybindings, shortcutToMonaco, type MonacoKeys } from './keyActions';

// Distinct numbers shaped like Monaco's: key codes below 256, modifiers above.
const KeyCode: Record<string, number> = {
  Enter: 3, Escape: 9, Space: 10, UpArrow: 16, KeyA: 31, KeyF: 36, KeyJ: 40, KeyK: 41, KeyL: 42, KeyS: 49, KeyI: 39, Digit1: 22, F5: 63, F9: 67, F10: 68, Equal: 85,
};
const m: MonacoKeys = {
  KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512, WinCtrl: 256, chord: (a, b) => (b << 16) | a },
  KeyCode,
};
const { CtrlCmd, Shift, Alt, WinCtrl } = m.KeyMod;

beforeEach(() => {
  setPlatformForTests(false);
  resetCommandsForTests();
});
afterEach(() => {
  setPlatformForTests(null);
  resetCommandsForTests();
});

describe('shortcut -> Monaco keybinding', () => {
  it('maps modifiers and keys', () => {
    expect(shortcutToMonaco('Mod+Enter', m)).toBe(CtrlCmd | KeyCode.Enter);
    expect(shortcutToMonaco('Mod+Shift+L', m)).toBe(CtrlCmd | Shift | KeyCode.KeyL);
    expect(shortcutToMonaco('Shift+Alt+F', m)).toBe(Shift | Alt | KeyCode.KeyF);
    expect(shortcutToMonaco('F5', m)).toBe(KeyCode.F5);
    expect(shortcutToMonaco('Mod+Alt+ArrowUp', m)).toBe(CtrlCmd | Alt | KeyCode.UpArrow);
    expect(shortcutToMonaco('Mod+=', m)).toBe(CtrlCmd | KeyCode.Equal);
    expect(shortcutToMonaco('Mod+1', m)).toBe(CtrlCmd | KeyCode.Digit1);
  });

  it('chords pack two strokes', () => {
    expect(shortcutToMonaco('Mod+K Mod+F', m)).toBe(m.KeyMod.chord(CtrlCmd | KeyCode.KeyK, CtrlCmd | KeyCode.KeyF));
  });

  it('MacCtrl is the physical Control key on macOS and Ctrl elsewhere', () => {
    setPlatformForTests(true);
    expect(shortcutToMonaco('MacCtrl+Space', m)).toBe(WinCtrl | KeyCode.Space);
    expect(shortcutToMonaco('Mod+Space', m)).toBe(CtrlCmd | KeyCode.Space);
    setPlatformForTests(false);
    expect(shortcutToMonaco('MacCtrl+Space', m)).toBe(CtrlCmd | KeyCode.Space);
  });

  it('keys Monaco has no code for are skipped', () => {
    expect(shortcutToMonaco('Mod+F11', m)).toBeNull();
    expect(monacoKeybindings(['Mod+F11', 'F5', 'f5'], m)).toEqual([KeyCode.F5]);
  });
});

describe('command-backed actions follow the keymap', () => {
  type Action = { id: string; label: string };
  function fakeEditor() {
    const live = new Map<string, number[]>();
    const log: string[] = [];
    return {
      live,
      log,
      addAction(d: Action & { keybindings: number[] }) {
        live.set(d.id, d.keybindings);
        log.push(`add ${d.id}`);
        return { dispose: () => { live.delete(d.id); log.push(`dispose ${d.id}`); } };
      },
    };
  }
  const defs = [
    { commandId: 'run.statement', fallback: ['Mod+Enter'], action: { id: 'a.run', label: 'Run' } },
    { commandId: 'run.script', fallback: ['F5', 'Mod+Shift+Enter'], action: { id: 'a.script', label: 'Script' } },
  ];

  it('uses the fallback until the command is registered, then the command\'s keys', () => {
    const ed = fakeEditor();
    const b = bindCommandActions(ed, m, defs);
    expect(ed.live.get('a.run')).toEqual([CtrlCmd | KeyCode.Enter]);
    expect(ed.live.get('a.script')).toEqual([KeyCode.F5, CtrlCmd | Shift | KeyCode.Enter]);
    registerCommands([
      { id: 'run.statement', title: 'Run', category: 'Query', shortcut: 'Mod+Enter', run: () => {} },
      { id: 'run.script', title: 'Run script', category: 'Query', shortcut: 'F9', run: () => {} },
    ]);
    expect(ed.live.get('a.run')).toEqual([CtrlCmd | KeyCode.Enter]);
    expect(ed.live.get('a.script')).toEqual([KeyCode.F9]);
    b.dispose();
    expect(ed.live.size).toBe(0);
  });

  it('re-registers an action when its command\'s keys change, and only that one', () => {
    registerCommands([
      { id: 'run.statement', title: 'Run', category: 'Query', shortcut: 'Mod+Enter', run: () => {} },
      { id: 'run.script', title: 'Run script', category: 'Query', shortcut: 'F5', run: () => {} },
    ]);
    const ed = fakeEditor();
    const b = bindCommandActions(ed, m, defs);
    expect(ed.log).toEqual(['add a.run', 'add a.script']);
    setKeybindingOverrides({ 'run.statement': ['Mod+Alt+S', 'F10'] });
    expect(ed.live.get('a.run')).toEqual([CtrlCmd | Alt | KeyCode.KeyS, KeyCode.F10]);
    expect(ed.log).toEqual(['add a.run', 'add a.script', 'dispose a.run', 'add a.run']);
    // unbinding leaves the action with no key at all
    setKeybindingOverrides({ 'run.statement': null });
    expect(ed.live.get('a.run')).toEqual([]);
    // back to the default
    setKeybindingOverrides({});
    expect(ed.live.get('a.run')).toEqual([CtrlCmd | KeyCode.Enter]);
    b.dispose();
    expect(ed.live.size).toBe(0);
    // a disposed binding stops listening
    const before = ed.log.length;
    setKeybindingOverrides({ 'run.statement': ['F9'] });
    expect(ed.log.length).toBe(before);
  });

  it('commandHasKey says whether a command still answers to a key (true while unregistered)', () => {
    expect(commandHasKey('format.document', 'Mod+Alt+L')).toBe(true);
    registerCommands([{ id: 'format.document', title: 'Format SQL', category: 'Edit', shortcut: 'Shift+Alt+F', altShortcuts: ['Mod+Alt+L'], run: () => {} }]);
    expect(commandHasKey('format.document', 'Mod+Alt+L')).toBe(true);
    setKeybindingOverrides({ 'format.document': ['Shift+Alt+F'] });
    expect(commandHasKey('format.document', 'Mod+Alt+L')).toBe(false);
    expect(commandHasKey('format.document', 'Shift+Alt+F')).toBe(true);
  });
});
