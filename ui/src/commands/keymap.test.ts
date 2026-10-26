// User keymap: the resolver (defaults / overrides / unbound / chords), what is stored, the conflict rules, binding and
// importing, and reserved keys.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installKeyDispatcher, isEditorOwned, resolveKey, routeMenuCommand } from './dispatcher';
import { normalizeShortcut, setPlatformForTests } from './keys';
import {
  allConflicts, bindKey, canonicalShortcut, defaultKeys, effectiveKeys, findKeyConflicts, overridesToStored, parseKeymapFile, parseShortcut,
  reservedWarnings, sanitizeOverrides, serializeKeymap, settleImport, unbindKey, withKeys, type KeymapEntry,
} from './keymap';
import {
  advertisedShortcuts, commandsForKey, getKeybindingOverrides, isChordPrefix, isOverridden, keymapVersion, listBindings, primaryShortcut,
  registerCommands, resetCommandsForTests, setKeybindingOverrides, shortcutLabelOf, shortcutsOf, subscribeKeymap, type Command,
} from './registry';
import { commandView } from './useCommands';

const ran = vi.fn();
const cmds: Command<never>[] = [
  { id: 't.run', title: 'Run', category: 'Query', shortcut: 'Mod+Enter', altShortcuts: ['F9'], run: () => ran('run') },
  { id: 't.find', title: 'Find in database', category: 'Database', shortcut: 'Mod+Shift+F', run: () => ran('find') },
  { id: 't.new', title: 'New console', category: 'File', shortcut: 'Mod+N', run: () => ran('new') },
  { id: 't.sheet', title: 'Keyboard shortcuts', category: 'Help', shortcut: 'F1', altShortcuts: ['Mod+K Mod+S'], run: () => ran('sheet') },
  { id: 't.free', title: 'Unbound command', category: 'Misc', run: () => ran('free') },
  { id: 't.gridFind', title: 'Filter rows', category: 'Data', shortcut: 'Mod+F', scope: 'grid', run: () => ran('grid') },
  { id: 't.hosted', title: 'Hosted', category: 'Data', shortcut: 'F2', scope: 'grid', keyHandler: 'host', run: () => ran('host') },
];

beforeEach(() => {
  setPlatformForTests(false);
  resetCommandsForTests();
  registerCommands(cmds);
});
afterEach(() => {
  setPlatformForTests(null);
  resetCommandsForTests();
  ran.mockReset();
});

const cmd = (id: string) => cmds.find((c) => c.id === id)!;
const keysOf = (id: string) => shortcutsOf(cmd(id)).map(normalizeShortcut);
const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe('effective shortcuts (override ?? defaults)', () => {
  it('without overrides a command answers to its shortcut and alternatives', () => {
    expect(shortcutsOf(cmd('t.run'))).toEqual(['Mod+Enter', 'F9']);
    expect(primaryShortcut('t.run')).toBe('Mod+Enter');
    expect(primaryShortcut('t.free')).toBeUndefined();
    expect(isOverridden('t.run')).toBe(false);
  });

  it('an array replaces the shortcuts (first is primary), null unbinds, other commands keep theirs', () => {
    setKeybindingOverrides({ 't.run': ['Mod+Alt+R', 'F8'], 't.new': null });
    expect(keysOf('t.run')).toEqual(['ctrl+alt+r', 'f8']);
    expect(primaryShortcut('t.run')).toBe('Mod+Alt+R');
    expect(keysOf('t.new')).toEqual([]);
    expect(primaryShortcut('t.new')).toBeUndefined();
    expect(keysOf('t.find')).toEqual(['ctrl+shift+f']);
    expect(isOverridden('t.run')).toBe(true);
    expect(isOverridden('t.find')).toBe(false);
  });

  it('commands without a default can be given a shortcut', () => {
    setKeybindingOverrides({ 't.free': ['Mod+Alt+U'] });
    expect(keysOf('t.free')).toEqual(['ctrl+alt+u']);
    expect(commandsForKey('ctrl+alt+u', 'global').map((c) => c.id)).toEqual(['t.free']);
  });

  it('chords work as overrides and make their first stroke a prefix', () => {
    setKeybindingOverrides({ 't.find': ['Mod+K Mod+F'] });
    expect(keysOf('t.find')).toEqual(['ctrl+k ctrl+f']);
    expect(isChordPrefix('ctrl+k', ['global'])).toBe(true);
    expect(commandsForKey('ctrl+k ctrl+f', 'global').map((c) => c.id)).toEqual(['t.find']);
  });

  it('listBindings, tooltips and labels follow the overrides', () => {
    setKeybindingOverrides({ 't.new': ['Mod+Alt+N'] });
    expect(listBindings().filter((b) => b.commandId === 't.new').map((b) => b.key)).toEqual(['ctrl+alt+n']);
    expect(commandView('t.new').tooltip).toBe('New console (Ctrl+Alt+N)');
    expect(commandView('t.new').shortcut).toBe('Mod+Alt+N');
    expect(shortcutLabelOf('t.new')).toBe('Ctrl+Alt+N');
    setKeybindingOverrides({ 't.new': null });
    expect(commandView('t.new').tooltip).toBe('New console');
    expect(shortcutLabelOf('t.new')).toBeUndefined();
  });

  it('a rebound command advertises everything the user gave it; a default one only its primary', () => {
    expect(advertisedShortcuts(cmd('t.run'))).toEqual(['Mod+Enter']);
    setKeybindingOverrides({ 't.run': ['F8', 'Mod+Alt+R'] });
    expect(advertisedShortcuts({ ...cmd('t.run'), id: 't.run' })).toEqual(['F8', 'Mod+Alt+R']);
  });

  it('changing the overrides notifies keymap subscribers and bumps the version', () => {
    const seen = vi.fn();
    const off = subscribeKeymap(seen);
    const v = keymapVersion();
    setKeybindingOverrides({ 't.run': ['F8'] });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(keymapVersion()).toBe(v + 1);
    off();
    setKeybindingOverrides({});
    expect(seen).toHaveBeenCalledTimes(1);
    expect(getKeybindingOverrides()).toEqual({});
  });
});

describe('the dispatcher uses the effective bindings', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installKeyDispatcher();
  });
  afterEach(() => uninstall());

  it('runs a command from its new key and no longer from the old one', () => {
    setKeybindingOverrides({ 't.new': ['Mod+Alt+N'] });
    press({ key: 'n', code: 'KeyN', ctrlKey: true });
    expect(ran).not.toHaveBeenCalled();
    press({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true });
    expect(ran).toHaveBeenCalledWith('new');
  });

  it('an unbound command does not run from its former key', () => {
    setKeybindingOverrides({ 't.find': null });
    const e = press({ key: 'f', code: 'KeyF', ctrlKey: true, shiftKey: true });
    expect(ran).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('runs a chord assigned by the user', () => {
    setKeybindingOverrides({ 't.find': ['Mod+K Mod+F'] });
    press({ key: 'k', code: 'KeyK', ctrlKey: true });
    expect(ran).not.toHaveBeenCalled();
    press({ key: 'f', code: 'KeyF', ctrlKey: true });
    expect(ran).toHaveBeenCalledWith('find');
  });

  it('a key another command gave up is free for the next one', () => {
    setKeybindingOverrides({ 't.find': null, 't.new': ['Mod+Shift+F'] });
    press({ key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true });
    expect(ran).toHaveBeenCalledWith('new');
  });

  it('scoped commands keep winning in their scope with a user key', () => {
    setKeybindingOverrides({ 't.find': ['Mod+F'] });
    expect(resolveKey('ctrl+f', ['grid', 'global'])).toBe('t.gridFind');
    expect(resolveKey('ctrl+f', ['global'])).toBe('t.find');
  });

  it('host-handled commands are never dispatched, whatever their keys', () => {
    expect(resolveKey('f2', ['grid', 'global'])).toBeNull();
    setKeybindingOverrides({ 't.hosted': ['F3'] });
    expect(resolveKey('f3', ['grid', 'global'])).toBeNull();
  });

  it('the native menu routes to the scoped command bound to the same effective key', () => {
    setKeybindingOverrides({ 't.find': ['Mod+F'] });
    const grid = document.createElement('div');
    grid.setAttribute('data-command-scope', 'grid');
    const input = document.createElement('button');
    grid.appendChild(input);
    document.body.appendChild(grid);
    expect(routeMenuCommand('t.find', input)).toBe('t.gridFind');
    grid.remove();
  });

  it('a key the editor keeps for a command action is released once the command moves off it', () => {
    // the real ids: run.statement owns Mod+Enter inside the editor
    resetCommandsForTests();
    registerCommands([{ id: 'run.statement', title: 'Run', category: 'Query', shortcut: 'Mod+Enter', run: () => {} }]);
    expect(isEditorOwned('ctrl+enter')).toBe(true);
    setKeybindingOverrides({ 'run.statement': ['Mod+Alt+R'] });
    expect(isEditorOwned('ctrl+enter')).toBe(false);
    expect(isEditorOwned('ctrl+f')).toBe(true);
  });
});

describe('shortcut text', () => {
  it('parses, validates and canonicalises', () => {
    const p = parseShortcut('ctrl+shift+p');
    expect(p).toMatchObject({ ok: true, normalized: 'ctrl+shift+p', canonical: 'Mod+Shift+P' });
    expect(canonicalShortcut('ctrl+k ctrl+s')).toBe('Mod+K Mod+S');
    expect(canonicalShortcut('macctrl+space')).toBe('MacCtrl+Space');
    expect(canonicalShortcut('alt+arrowup')).toBe('Alt+ArrowUp');
    expect(canonicalShortcut('f5')).toBe('F5');
    for (const s of ['Mod+Shift+P', 'Mod+K Mod+S', 'Alt+ArrowUp', 'F12', 'Mod+=', 'Mod+\\']) {
      const n = normalizeShortcut(s);
      expect(normalizeShortcut(canonicalShortcut(n))).toBe(n);
    }
  });

  it('rejects modifiers alone, long chords, unknown keys, and plain keys where they would block typing', () => {
    expect(parseShortcut('')).toMatchObject({ ok: false });
    expect(parseShortcut('Mod+Shift')).toMatchObject({ ok: false });
    expect(parseShortcut('Mod+K Mod+K Mod+K')).toMatchObject({ ok: false });
    expect(parseShortcut('Mod+Banana')).toMatchObject({ ok: false });
    expect(parseShortcut('a', 'global')).toMatchObject({ ok: false });
    expect(parseShortcut('Shift+A', 'global')).toMatchObject({ ok: false });
    expect(parseShortcut('Delete', 'console')).toMatchObject({ ok: false });
    // F-keys and modified keys are fine, and scopes without text fields may use plain keys
    expect(parseShortcut('F9', 'global')).toMatchObject({ ok: true });
    expect(parseShortcut('Alt+A', 'global')).toMatchObject({ ok: true });
    expect(parseShortcut('Delete', 'grid')).toMatchObject({ ok: true });
    // the second stroke of a chord may be a plain key
    expect(parseShortcut('Mod+K F', 'global')).toMatchObject({ ok: true });
  });

  it('on macOS Ctrl stays a different key from Cmd', () => {
    setPlatformForTests(true);
    expect(parseShortcut('MacCtrl+Space')).toMatchObject({ ok: true, normalized: 'macctrl+space', canonical: 'MacCtrl+Space' });
    expect(parseShortcut('Mod+Alt+L')).toMatchObject({ ok: true, normalized: 'ctrl+alt+l' });
  });
});

describe('stored form', () => {
  it('round-trips through the array form, keeping null as an empty list', () => {
    const o = { 't.run': ['Mod+Alt+R', 'F8'], 't.new': null };
    const stored = overridesToStored(o);
    expect(stored).toEqual([{ command: 't.new', keys: [] }, { command: 't.run', keys: ['Mod+Alt+R', 'F8'] }]);
    expect(sanitizeOverrides(stored)).toEqual(o);
  });

  it('reads a map too and drops junk without throwing', () => {
    expect(sanitizeOverrides({ 'a.b': ['Mod+P', 7, 'Mod+Banana', 'mod+p'], 'c.d': null, 'e.f': 'F5', '__proto__': ['F5'] })).toEqual({ 'a.b': ['Mod+P'], 'c.d': null });
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides('nope')).toEqual({});
    expect(sanitizeOverrides([null, 3, { command: 5 }, { command: 'x', keys: ['F5'] }])).toEqual({ x: ['F5'] });
  });

  it('keeps at most four shortcuts per command', () => {
    const six = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7'];
    expect(sanitizeOverrides({ x: six }).x).toHaveLength(4);
  });

  it('withKeys drops an override equal to the defaults and unbinds with an empty list', () => {
    const run = { id: 't.run', shortcut: 'Mod+Enter', altShortcuts: ['F9'] };
    expect(withKeys({}, run, ['Mod+Enter', 'F9'])).toEqual({});
    expect(withKeys({ 't.run': ['F8'] }, run, ['mod+enter', 'f9'])).toEqual({});
    expect(withKeys({}, run, ['F8'])).toEqual({ 't.run': ['F8'] });
    expect(withKeys({}, run, [])).toEqual({ 't.run': null });
    expect(withKeys({ 't.run': ['F8'] }, run, null)).toEqual({});
    expect(defaultKeys(run)).toEqual(['Mod+Enter', 'F9']);
    expect(effectiveKeys(run, { 't.run': null })).toEqual([]);
    expect(effectiveKeys(run, {})).toEqual(['Mod+Enter', 'F9']);
  });
});

const E = (id: string, scope: string, keys: string[], title = id): KeymapEntry => ({ id, scope, keys, title });

describe('conflicts', () => {
  const entries = [
    E('find', 'global', ['Mod+Shift+F'], 'Find in database'),
    E('grid.find', 'grid', ['Mod+F']),
    E('sheet', 'global', ['F1', 'Mod+K Mod+S']),
    E('edit', 'editor', ['Mod+K Mod+F']),
  ];

  it('same key in the same scope is an error naming the other command', () => {
    expect(findKeyConflicts('ctrl+shift+f', 'other', 'global', entries)).toEqual([
      { kind: 'same-scope', commandId: 'find', title: 'Find in database', key: 'ctrl+shift+f', scope: 'global' },
    ]);
  });

  it('a scoped command and a global one may share a key: reported as other-scope, not an error', () => {
    expect(findKeyConflicts('ctrl+f', 'x', 'global', entries).map((c) => c.kind)).toEqual(['other-scope']);
    expect(findKeyConflicts('ctrl+shift+f', 'x', 'grid', entries).map((c) => c.kind)).toEqual(['other-scope']);
  });

  it('a key and a chord starting with it clash in the same scope', () => {
    expect(findKeyConflicts('ctrl+k', 'x', 'global', entries).map((c) => [c.kind, c.commandId])).toEqual([['chord', 'sheet']]);
    expect(findKeyConflicts('ctrl+k ctrl+x', 'x', 'global', [E('k', 'global', ['Mod+K'])]).map((c) => c.kind)).toEqual(['chord']);
    expect(findKeyConflicts('ctrl+k', 'x', 'grid', entries)).toEqual([]);
  });

  it('a command never conflicts with itself', () => {
    expect(findKeyConflicts('ctrl+shift+f', 'find', 'global', entries)).toEqual([]);
  });

  it('allConflicts lists same-scope collisions only', () => {
    expect(allConflicts(entries)).toEqual([]);
    expect(allConflicts([...entries, E('dup', 'global', ['mod+shift+f'])])).toEqual([{ id: 'dup', key: 'ctrl+shift+f', with: 'find' }]);
  });
});

describe('bindKey / unbindKey', () => {
  const list = cmds.map((c) => ({ id: c.id, title: c.title, scope: c.scope ?? 'global', shortcut: c.shortcut, altShortcuts: c.altShortcuts }));

  it('assigns a free key as the primary shortcut when replacing the first, or appends', () => {
    expect(bindKey({}, list, 't.new', 'Mod+Alt+N', { index: 0 })).toEqual({ 't.new': ['Mod+Alt+N'] });
    expect(bindKey({}, list, 't.new', 'Mod+Alt+N')).toEqual({ 't.new': ['Mod+N', 'Mod+Alt+N'] });
    expect(bindKey({}, list, 't.free', 'Mod+Alt+U')).toEqual({ 't.free': ['Mod+Alt+U'] });
  });

  it('refuses a same-scope conflict, and Replace takes the key from the other command', () => {
    expect(bindKey({}, list, 't.new', 'Mod+Shift+F', { index: 0 })).toBeNull();
    expect(bindKey({}, list, 't.new', 'Mod+Shift+F', { index: 0, replace: true })).toEqual({ 't.new': ['Mod+Shift+F'], 't.find': null });
  });

  it('keeps both across scopes, or takes the key everywhere with replaceScoped', () => {
    expect(bindKey({}, list, 't.find', 'Mod+F', { index: 0 })).toEqual({ 't.find': ['Mod+F'] });
    expect(bindKey({}, list, 't.find', 'Mod+F', { index: 0, replaceScoped: true, replace: true })).toEqual({ 't.find': ['Mod+F'], 't.gridFind': null });
  });

  it('takes a chord key from the command whose chord it would shadow', () => {
    expect(bindKey({}, list, 't.new', 'Mod+K', { index: 0 })).toBeNull();
    const next = bindKey({}, list, 't.new', 'Mod+K', { index: 0, replace: true })!;
    expect(next['t.new']).toEqual(['Mod+K']);
    expect(next['t.sheet']).toEqual(['F1']);
  });

  it('refuses invalid keys, unknown commands, and does not duplicate a key', () => {
    expect(bindKey({}, list, 't.new', 'Mod', {})).toBeNull();
    expect(bindKey({}, list, 'nope', 'Mod+Alt+N')).toBeNull();
    expect(bindKey({}, list, 't.run', 'F9')).toEqual({});
  });

  it('unbindKey removes one shortcut and keeps the rest', () => {
    const run = list.find((c) => c.id === 't.run')!;
    expect(unbindKey({}, run, 1)).toEqual({ 't.run': ['Mod+Enter'] });
    expect(unbindKey({ 't.run': ['F8'] }, run, 0)).toEqual({ 't.run': null });
  });
});

describe('reserved keys', () => {
  it('warns for keys the OS or the browser takes, per platform', () => {
    expect(reservedWarnings('alt+f4', { mac: false, browser: false })).toHaveLength(1);
    expect(reservedWarnings('alt+f4', { mac: true, browser: false })).toEqual([]);
    expect(reservedWarnings('ctrl+q', { mac: true, browser: false })[0]).toContain('⌘Q');
    expect(reservedWarnings('ctrl+q', { mac: false, browser: false })).toEqual([]);
    expect(reservedWarnings('ctrl+w', { mac: false, browser: true })).toHaveLength(1);
    expect(reservedWarnings('ctrl+w', { mac: false, browser: false })).toEqual([]);
    expect(reservedWarnings('ctrl+k ctrl+q', { mac: true, browser: false })).toEqual([]);
  });
});

describe('keymap files', () => {
  it('exports readable JSON and imports it back', () => {
    const text = serializeKeymap({ 't.run': ['Mod+Alt+R'], 't.new': null });
    expect(JSON.parse(text)).toEqual({ format: 'rowlit-keymap', version: 1, keybindings: { 't.new': null, 't.run': ['Mod+Alt+R'] } });
    expect(parseKeymapFile(text)).toEqual({ ok: true, overrides: { 't.new': null, 't.run': ['Mod+Alt+R'] }, skipped: 0 });
  });

  it('accepts a bare map and skips commands this build does not have', () => {
    const r = parseKeymapFile('{"a.b":["F7"],"gone":["F8"]}', (id) => id === 'a.b');
    expect(r).toEqual({ ok: true, overrides: { 'a.b': ['F7'] }, skipped: 1 });
  });

  it('rejects text that is not a keymap', () => {
    expect(parseKeymapFile('nope')).toMatchObject({ ok: false });
    expect(parseKeymapFile('{"format":"other","keybindings":{}}')).toMatchObject({ ok: false });
    expect(parseKeymapFile('42')).toMatchObject({ ok: false });
    expect(parseKeymapFile('{"keybindings":{"x":"nope"}}')).toMatchObject({ ok: false });
  });

  it('settling an import: first claim wins among imported commands, defaults of others give way', () => {
    const list = cmds.map((c) => ({ id: c.id, title: c.title, scope: c.scope ?? 'global', shortcut: c.shortcut, altShortcuts: c.altShortcuts }));
    // commands are settled in id order: t.free claims the key first, so t.new's claim is dropped
    const r = settleImport({ 't.new': ['Mod+Shift+F'], 't.free': ['Mod+Shift+F', 'Mod+Alt+U'] }, list);
    expect(r.overrides['t.free']).toEqual(['Mod+Shift+F', 'Mod+Alt+U']);
    expect(r.overrides['t.new']).toBeUndefined();
    // Find in database was left on its default, which the import claimed: it gives the key up
    expect(r.overrides['t.find']).toBeNull();
    expect(r.dropped).toBe(1);
    expect(allConflicts(list.map((c) => ({ id: c.id, title: c.title, scope: c.scope, keys: effectiveKeys(c, r.overrides) })))).toEqual([]);
  });
});
