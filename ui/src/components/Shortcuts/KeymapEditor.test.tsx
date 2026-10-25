// Keyboard shortcuts dialog as the keymap editor: rows, recording (single keys, chords, macOS modifiers), live conflicts
// (Replace / Keep both / Cancel), add / remove / reset, presets, import and export.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { installKeyDispatcher } from '../../commands/dispatcher';
import { setPlatformForTests } from '../../commands/keys';
import { KEYBINDINGS_UI_KEY, serializeKeymap } from '../../commands/keymap';
import { installKeymap } from '../../commands/keymapSettings';
import {
  getKeybindingOverrides, primaryShortcut, registerCommands, resetCommandsForTests, setKeybindingOverrides, shortcutsOf, getCommand, type Command,
} from '../../commands/registry';
import { setPlatform } from '../../platform';
import { createBrowserPlatform } from '../../platform/browser';
import type { Platform } from '../../platform/types';
import { DEFAULT_SETTINGS, useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { KeymapEditor } from './KeymapEditor';
import { classifyRecorderKey, nextStrokes } from './recorder';

const ran = vi.fn();
const cmds: Command<never>[] = [
  { id: 't.new', title: 'New console', category: 'File', shortcut: 'Mod+N', altShortcuts: ['Mod+T'], run: () => ran('new') },
  { id: 't.find', title: 'Find in database', category: 'Database', shortcut: 'Mod+Shift+F', run: () => ran('find') },
  { id: 't.run', title: 'Run statement', category: 'Query', shortcut: 'Mod+Enter', run: () => ran('run') },
  { id: 't.free', title: 'Unbound command', category: 'Misc', run: () => ran('free') },
  { id: 't.grid', title: 'Filter rows', category: 'Data', shortcut: 'Mod+F', scope: 'grid', run: () => ran('grid') },
  { id: 't.hosted', title: 'Hosted key', category: 'Data', shortcut: 'F2', scope: 'grid', keyHandler: 'host', run: () => ran('host') },
  { id: 't.hidden', title: 'Internal', category: 'Misc', palette: false, run: () => ran('hidden') },
];

let uninstall: () => void = () => {};
let uninstallKeymap: () => void = () => {};

beforeEach(() => {
  setPlatformForTests(false);
  resetCommandsForTests();
  registerCommands(cmds);
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ui: {} } });
  vi.spyOn(api, 'putSettings').mockImplementation(async (p) => p as never);
  uninstall = installKeyDispatcher();
  uninstallKeymap = installKeymap();
  useUi.getState().setShortcutsOpen(true);
});
afterEach(() => {
  act(() => useUi.getState().setShortcutsOpen(false));
  uninstall();
  uninstallKeymap();
  setPlatform(null);
  setPlatformForTests(null);
  resetCommandsForTests();
  ran.mockReset();
  vi.restoreAllMocks();
});

const row = (id: string) => document.querySelector<HTMLElement>(`.sheet-row[data-command="${id}"]`)!;
const key = (init: KeyboardEventInit & { key: string }) => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => void (document.activeElement ?? document.body).dispatchEvent(e));
  return e;
};
const ctrl = (k: string, extra: KeyboardEventInit = {}) => key({ key: k.toLowerCase(), code: `Key${k.toUpperCase()}`, ctrlKey: true, ...extra });
const click = (el: Element) => act(() => void fireEvent.click(el));
const startEdit = (id: string, label: string) => click(within(row(id)).getByRole('button', { name: label }));
const recorder = () => document.querySelector<HTMLElement>('.sheet-recorder')!;
const showAll = () => click(screen.getByRole('button', { name: 'All' }));
const stored = () => useSettings.getState().settings.ui[KEYBINDINGS_UI_KEY];

describe('rows', () => {
  it('lists every command with its effective keys, unassigned ones too, and the editor built-ins read-only', () => {
    render(<KeymapEditor />);
    expect(row('t.new').textContent).toContain('New console');
    expect(row('t.new').querySelectorAll('.sheet-binding')).toHaveLength(2);
    // commands without a key are listed under All (and found by searching), not in the default view
    expect(row('t.free')).toBeNull();
    showAll();
    expect(within(row('t.free')).getByRole('button', { name: 'Assign a shortcut to Unbound command' })).toBeInTheDocument();
    // internal commands without a key are not listed
    expect(row('t.hidden')).toBeNull();
    // keys a view handles itself, and the editor's own keys, cannot be changed here
    expect(within(row('t.hosted')).queryByRole('button', { name: /Change/ })).toBeNull();
    expect(within(row('t.hosted')).getByLabelText(/handled by the view itself/)).toBeInTheDocument();
    const find = document.querySelector<HTMLElement>('.sheet-row[data-command^="builtin:"]')!;
    expect(find).toBeTruthy();
    expect(within(find).queryByRole('button', { name: /Change/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Editor (built-in)' })).toBeInTheDocument();
  });

  it('shows overridden keys with an edited marker, and unbound commands as not assigned', () => {
    setKeybindingOverrides({ 't.new': ['Mod+Alt+N'], 't.find': null });
    render(<KeymapEditor />);
    expect(row('t.new')).toHaveClass('is-edited');
    expect(row('t.new').textContent).toContain('edited');
    expect(row('t.new').querySelectorAll('.sheet-binding')).toHaveLength(1);
    expect(within(row('t.find')).getByRole('button', { name: /Assign a shortcut/ })).toBeInTheDocument();
    expect(row('t.run')).not.toHaveClass('is-edited');
  });

  it('filters by name, category and key, and by edited / not assigned', () => {
    setKeybindingOverrides({ 't.new': ['Mod+Alt+N'] });
    render(<KeymapEditor />);
    const search = screen.getByRole('textbox', { name: 'Search shortcuts' });
    fireEvent.change(search, { target: { value: 'query' } });
    expect(document.querySelectorAll('.sheet-row')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'alt+n' } });
    expect(row('t.new')).toBeTruthy();
    expect(document.querySelectorAll('.sheet-row')).toHaveLength(1);
    fireEvent.change(search, { target: { value: '' } });
    click(screen.getByRole('button', { name: /^Edited/ }));
    expect(document.querySelectorAll('.sheet-row')).toHaveLength(1);
    click(screen.getByRole('button', { name: 'Unassigned' }));
    expect([...document.querySelectorAll('.sheet-row')].map((r) => r.getAttribute('data-command'))).toEqual(['t.free']);
  });
});

describe('recording a shortcut', () => {
  it('Edit -> press keys -> Enter assigns it: applied at once, saved with the settings, row marked edited', () => {
    const { unmount } = render(<KeymapEditor />);
    startEdit('t.new', 'Change Ctrl+N for New console');
    expect(recorder()).toBeInTheDocument();
    expect(recorder()).toHaveFocus();
    // modifiers held show as a partial combination
    key({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
    key({ key: 'Alt', code: 'AltLeft', ctrlKey: true, altKey: true });
    expect(recorder().querySelector('.sheet-rec-keys')).toHaveTextContent(/Ctrl\s*\+\s*Alt\s*\+\s*…/);
    const e = ctrl('n', { altKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(recorder().querySelector('.sheet-rec-keys')).toHaveTextContent(/Ctrl\s*\+\s*Alt\s*\+\s*N/);
    // the key does not run its command while recording
    expect(ran).not.toHaveBeenCalled();
    key({ key: 'Enter', code: 'Enter' });
    expect(recorder()).toBeNull();
    expect(shortcutsOf(getCommand('t.new')!)).toEqual(['Mod+Alt+N', 'Mod+T']);
    expect(row('t.new')).toHaveClass('is-edited');
    expect(stored()).toEqual([{ command: 't.new', keys: ['Mod+Alt+N', 'Mod+T'] }]);
    // and the dispatcher now runs it from the new key (outside the dialog: a modal dialog keeps its own keys)
    unmount();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    expect(ran).toHaveBeenCalledWith('new');
  });

  it('Esc cancels the recording and changes nothing; the next Esc closes the dialog', () => {
    render(<KeymapEditor />);
    startEdit('t.new', 'Change Ctrl+N for New console');
    ctrl('p');
    key({ key: 'Escape', code: 'Escape' });
    expect(recorder()).toBeNull();
    expect(getKeybindingOverrides()).toEqual({});
    expect(useUi.getState().shortcutsOpen).toBe(true);
    key({ key: 'Escape', code: 'Escape' });
    // (the dialog's own Escape handling closes it; recording consumed the first one)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useUi.getState().shortcutsOpen).toBe(false);
  });

  it('records chords: a second combination makes "Ctrl+K Ctrl+Q"; Backspace drops the last stroke', () => {
    render(<KeymapEditor />);
    startEdit('t.run', 'Change Ctrl+Enter for Run statement');
    ctrl('k');
    ctrl('q');
    expect(recorder().querySelector('.sheet-rec-keys')).toHaveTextContent(/Ctrl\s*\+\s*K.*Ctrl\s*\+\s*Q/);
    key({ key: 'Backspace', code: 'Backspace' });
    expect(recorder().querySelector('.sheet-rec-keys')).toHaveTextContent(/^Ctrl\s*\+\s*K$/);
    ctrl('q');
    key({ key: 'Enter', code: 'Enter' });
    expect(primaryShortcut('t.run')).toBe('Mod+K Mod+Q');
  });

  it('refuses a plain letter for a global command and explains why', () => {
    render(<KeymapEditor />);
    startEdit('t.run', 'Change Ctrl+Enter for Run statement');
    key({ key: 'a', code: 'KeyA' });
    expect(recorder()).toHaveTextContent(/stop you typing/);
    expect(within(recorder()).getByRole('button', { name: 'Assign' })).toBeDisabled();
    key({ key: 'Enter', code: 'Enter' });
    expect(primaryShortcut('t.run')).toBe('Mod+Enter');
  });

  it('a scoped command may use a plain key', () => {
    render(<KeymapEditor />);
    startEdit('t.grid', 'Change Ctrl+F for Filter rows');
    key({ key: 'Delete', code: 'Delete' });
    expect(recorder()).not.toHaveTextContent(/stop you typing/);
    click(within(recorder()).getByRole('button', { name: 'Assign' }));
    expect(primaryShortcut('t.grid')).toBe('Mod+Delete'.replace('Mod+', ''));
  });

  it('adds an alternative and removes one; the command keeps the others', () => {
    render(<KeymapEditor />);
    click(within(row('t.find')).getByRole('button', { name: 'Add another shortcut to Find in database' }));
    ctrl('g', { shiftKey: true });
    click(within(recorder()).getByRole('button', { name: 'Assign' }));
    expect(shortcutsOf(getCommand('t.find')!)).toEqual(['Mod+Shift+F', 'Mod+Shift+G']);
    click(within(row('t.find')).getByRole('button', { name: 'Remove Ctrl+Shift+F from Find in database' }));
    expect(shortcutsOf(getCommand('t.find')!)).toEqual(['Mod+Shift+G']);
    click(within(row('t.find')).getByRole('button', { name: 'Remove Ctrl+Shift+G from Find in database' }));
    expect(shortcutsOf(getCommand('t.find')!)).toEqual([]);
    expect(getKeybindingOverrides()['t.find']).toBeNull();
  });

  it('assigns a shortcut to a command that had none', () => {
    render(<KeymapEditor />);
    showAll();
    click(within(row('t.free')).getByRole('button', { name: 'Assign a shortcut to Unbound command' }));
    ctrl('u', { altKey: true });
    key({ key: 'Enter', code: 'Enter' });
    expect(primaryShortcut('t.free')).toBe('Mod+Alt+U');
  });

  it('reset restores the defaults of one command; Reset all (after confirming) restores everything', async () => {
    setKeybindingOverrides({ 't.new': ['Mod+Alt+N'], 't.find': null, 't.run': ['F9'] });
    render(<KeymapEditor />);
    click(within(row('t.new')).getByRole('button', { name: 'Reset New console to its default' }));
    expect(getKeybindingOverrides()).toEqual({ 't.find': null, 't.run': ['F9'] });
    expect(shortcutsOf(getCommand('t.new')!)).toEqual(['Mod+N', 'Mod+T']);
    const ask = vi.spyOn(useUi.getState(), 'askConfirm').mockResolvedValue(true);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Reset all/ })));
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reset all shortcuts?', danger: true }));
    expect(getKeybindingOverrides()).toEqual({});
    expect(screen.getByRole('button', { name: /Reset all/ })).toBeDisabled();
  });

  it('Reset all keeps everything when the confirmation is declined', async () => {
    setKeybindingOverrides({ 't.run': ['F9'] });
    render(<KeymapEditor />);
    vi.spyOn(useUi.getState(), 'askConfirm').mockResolvedValue(false);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Reset all/ })));
    expect(getKeybindingOverrides()).toEqual({ 't.run': ['F9'] });
  });
});

describe('conflicts while recording', () => {
  it('same scope: names the other command; only Replace or Cancel; Replace takes the key from it', () => {
    render(<KeymapEditor />);
    startEdit('t.new', 'Change Ctrl+N for New console');
    ctrl('f', { shiftKey: true });
    expect(recorder()).toHaveTextContent(/Ctrl\+Shift\+F is already used by Find in database/);
    expect(within(recorder()).queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(within(recorder()).queryByRole('button', { name: 'Keep both' })).toBeNull();
    // Enter does not sneak past the conflict
    key({ key: 'Enter', code: 'Enter' });
    expect(primaryShortcut('t.new')).toBe('Mod+N');
    click(within(recorder()).getByRole('button', { name: 'Replace' }));
    expect(primaryShortcut('t.new')).toBe('Mod+Shift+F');
    expect(shortcutsOf(getCommand('t.find')!)).toEqual([]);
    expect(getKeybindingOverrides()['t.find']).toBeNull();
  });

  it('Cancel leaves both commands as they were', () => {
    render(<KeymapEditor />);
    startEdit('t.new', 'Change Ctrl+N for New console');
    ctrl('f', { shiftKey: true });
    click(within(recorder()).getByRole('button', { name: 'Cancel' }));
    expect(recorder()).toBeNull();
    expect(getKeybindingOverrides()).toEqual({});
  });

  it('another scope: allowed, with a note about which one wins; Keep both keeps the other command bound', () => {
    render(<KeymapEditor />);
    startEdit('t.find', 'Change Ctrl+Shift+F for Find in database');
    ctrl('f');
    expect(recorder()).toHaveTextContent(/Ctrl\+F is also used by Filter rows/);
    expect(recorder()).toHaveTextContent(/takes precedence/);
    click(within(recorder()).getByRole('button', { name: 'Keep both' }));
    expect(primaryShortcut('t.find')).toBe('Mod+F');
    expect(primaryShortcut('t.grid')).toBe('Mod+F');
    expect(document.querySelector('.sheet-conflicts')).toBeNull();
  });

  it('another scope: Replace removes it from the scoped command too', () => {
    render(<KeymapEditor />);
    startEdit('t.find', 'Change Ctrl+Shift+F for Find in database');
    ctrl('f');
    click(within(recorder()).getByRole('button', { name: 'Replace' }));
    expect(primaryShortcut('t.find')).toBe('Mod+F');
    expect(shortcutsOf(getCommand('t.grid')!)).toEqual([]);
  });

  it('warns about keys the system takes and keys the code editor keeps', () => {
    render(<KeymapEditor />);
    startEdit('t.find', 'Change Ctrl+Shift+F for Find in database');
    key({ key: 'F4', code: 'F4', altKey: true });
    expect(recorder()).toHaveTextContent(/closes the window/);
    // Assign still works: it is a warning, not a block
    expect(within(recorder()).getByRole('button', { name: 'Assign' })).toBeEnabled();
    key({ key: 'Escape', code: 'Escape' });
    startEdit('t.find', 'Change Ctrl+Shift+F for Find in database');
    ctrl('d');
    expect(recorder()).toHaveTextContent(/code editor keeps Ctrl\+D for “Duplicate line”/);
  });

  it('a second key the same command already has is refused as a duplicate, not a conflict', () => {
    render(<KeymapEditor />);
    startEdit('t.new', 'Change Ctrl+N for New console');
    ctrl('t');
    expect(recorder()).not.toHaveTextContent(/already used/);
    click(within(recorder()).getByRole('button', { name: 'Assign' }));
    expect(shortcutsOf(getCommand('t.new')!)).toEqual(['Mod+T']);
  });
});

describe('macOS', () => {
  beforeEach(() => setPlatformForTests(true));

  it('records ⌘ as Mod, ⌃ as MacCtrl and ⌥ as Alt', () => {
    render(<KeymapEditor />);
    startEdit('t.run', 'Change ⌘↩ for Run statement');
    key({ key: 'l', code: 'KeyL', metaKey: true, altKey: true });
    expect(recorder().querySelector('.sheet-rec-keys')).toHaveTextContent('⌥⌘L');
    key({ key: 'Enter', code: 'Enter' });
    expect(primaryShortcut('t.run')).toBe('Mod+Alt+L');
    showAll();
    startEdit('t.free', 'Assign a shortcut to Unbound command');
    key({ key: ' ', code: 'Space', ctrlKey: true });
    expect(recorder().querySelector('.sheet-rec-keys')).toHaveTextContent('⌃Space');
    key({ key: 'Enter', code: 'Enter' });
    expect(primaryShortcut('t.free')).toBe('MacCtrl+Space');
  });

  it('holding ⌘⌥ shows the partial combination with the Mac caps', () => {
    render(<KeymapEditor />);
    showAll();
    click(within(row('t.free')).getByRole('button', { name: 'Assign a shortcut to Unbound command' }));
    key({ key: 'Meta', code: 'MetaLeft', metaKey: true });
    key({ key: 'Alt', code: 'AltLeft', metaKey: true, altKey: true });
    expect([...recorder().querySelectorAll('.sheet-rec-keys kbd')].map((k) => k.textContent)).toEqual(['⌥', '⌘']);
  });
});

describe('recorder rules', () => {
  const ev = (o: Partial<KeyboardEvent>) => ({ key: 'l', code: 'KeyL', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  const none = { strokes: [] as string[], onButton: false };

  it('AltGr characters and IME input are not shortcuts', () => {
    expect(classifyRecorderKey(ev({ key: 'AltGraph', code: 'AltRight', ctrlKey: true, altKey: true }), none, false)).toEqual({ kind: 'ignore' });
    expect(classifyRecorderKey(ev({ key: 'ł', ctrlKey: true, altKey: true }), none, false)).toEqual({ kind: 'ignore' });
    expect(classifyRecorderKey(ev({ key: 'l', ctrlKey: true, altKey: true }), none, false)).toEqual({ kind: 'stroke', stroke: 'ctrl+alt+l' });
    expect(classifyRecorderKey({ ...ev({}), isComposing: true }, none, false)).toEqual({ kind: 'ignore' });
  });

  it('Escape cancels, Enter accepts only after a combination, Backspace steps back', () => {
    expect(classifyRecorderKey(ev({ key: 'Escape', code: 'Escape' }), none, false)).toEqual({ kind: 'cancel' });
    expect(classifyRecorderKey(ev({ key: 'Enter', code: 'Enter' }), none, false)).toEqual({ kind: 'stroke', stroke: 'enter' });
    expect(classifyRecorderKey(ev({ key: 'Enter', code: 'Enter' }), { strokes: ['ctrl+k'], onButton: false }, false)).toEqual({ kind: 'accept' });
    expect(classifyRecorderKey(ev({ key: 'Enter', code: 'Enter', ctrlKey: true }), { strokes: ['ctrl+k'], onButton: false }, false)).toEqual({ kind: 'stroke', stroke: 'ctrl+enter' });
    expect(classifyRecorderKey(ev({ key: 'Backspace', code: 'Backspace' }), { strokes: ['ctrl+k'], onButton: false }, false)).toEqual({ kind: 'back' });
    expect(classifyRecorderKey(ev({ key: 'Backspace', code: 'Backspace' }), none, false)).toEqual({ kind: 'stroke', stroke: 'backspace' });
  });

  it('Tab and Enter keep their meaning on the recorder buttons', () => {
    const on = { strokes: ['ctrl+k'], onButton: true };
    expect(classifyRecorderKey(ev({ key: 'Enter', code: 'Enter' }), on, false)).toEqual({ kind: 'pass' });
    expect(classifyRecorderKey(ev({ key: ' ', code: 'Space' }), on, false)).toEqual({ kind: 'pass' });
    expect(classifyRecorderKey(ev({ key: 'Tab', code: 'Tab' }), on, false)).toEqual({ kind: 'pass' });
    expect(classifyRecorderKey(ev({ key: 'Tab', code: 'Tab', shiftKey: true }), on, false)).toEqual({ kind: 'pass' });
    // before anything is recorded Tab is just a key
    expect(classifyRecorderKey(ev({ key: 'Tab', code: 'Tab' }), none, false)).toEqual({ kind: 'stroke', stroke: 'tab' });
  });

  it('modifiers alone report the held set (Mod is ⌘ on macOS)', () => {
    expect(classifyRecorderKey(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), none, false)).toEqual({ kind: 'held', mods: 'ctrl' });
    expect(classifyRecorderKey(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true, altKey: true }), none, true)).toEqual({ kind: 'held', mods: 'ctrl+alt' });
  });

  it('a third stroke starts a new shortcut', () => {
    expect(nextStrokes([], 'ctrl+k')).toEqual(['ctrl+k']);
    expect(nextStrokes(['ctrl+k'], 'ctrl+s')).toEqual(['ctrl+k', 'ctrl+s']);
    expect(nextStrokes(['ctrl+k', 'ctrl+s'], 'ctrl+p')).toEqual(['ctrl+p']);
  });
});

describe('presets, import and export', () => {
  const real: Command<never>[] = [
    { id: 'run.script', title: 'Run script', category: 'Query', shortcut: 'F5', altShortcuts: ['Mod+Shift+Enter'], run: () => {} },
    { id: 'format.document', title: 'Format SQL', category: 'Edit', shortcut: 'Shift+Alt+F', altShortcuts: ['Mod+Alt+L'], run: () => {} },
  ];
  beforeEach(() => registerCommands(real));

  it('choosing a preset replaces the overrides with it (no question when nothing custom would be lost)', async () => {
    render(<KeymapEditor />);
    const trigger = screen.getByRole('combobox', { name: 'Keymap' });
    expect(trigger).toHaveTextContent('Rowlit (default)');
    click(trigger);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Rowlit (default)', 'JetBrains / DataGrip', 'VS Code / Azure Data Studio', 'SQL Server Management Studio']);
    const ask = vi.spyOn(useUi.getState(), 'askConfirm');
    await act(async () => void fireEvent.click(screen.getByRole('option', { name: 'JetBrains / DataGrip' })));
    expect(ask).not.toHaveBeenCalled();
    expect(primaryShortcut('run.script')).toBe('Mod+Shift+F10');
    expect(primaryShortcut('format.document')).toBe('Mod+Alt+L');
    expect(screen.getByRole('combobox', { name: 'Keymap' })).toHaveTextContent('JetBrains / DataGrip');
    // and back to the defaults
    click(screen.getByRole('combobox', { name: 'Keymap' }));
    await act(async () => void fireEvent.click(screen.getByRole('option', { name: 'Rowlit (default)' })));
    expect(getKeybindingOverrides()).toEqual({});
  });

  it('a custom keymap is shown as Custom and asks before a preset replaces it', async () => {
    setKeybindingOverrides({ 'run.script': ['F9'] });
    render(<KeymapEditor />);
    expect(screen.getByRole('combobox', { name: 'Keymap' })).toHaveTextContent('Custom');
    const ask = vi.spyOn(useUi.getState(), 'askConfirm').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    click(screen.getByRole('combobox', { name: 'Keymap' }));
    await act(async () => void fireEvent.click(screen.getByRole('option', { name: 'VS Code / Azure Data Studio' })));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(getKeybindingOverrides()).toEqual({ 'run.script': ['F9'] });
    click(screen.getByRole('combobox', { name: 'Keymap' }));
    await act(async () => void fireEvent.click(screen.getByRole('option', { name: 'VS Code / Azure Data Studio' })));
    expect(primaryShortcut('run.script')).toBe('F5');
  });

  it('exports the overrides as a keymap file', async () => {
    const saveFile = vi.fn(async () => 'C:/keys/rowlit-keymap.json');
    setPlatform({ ...createBrowserPlatform(), saveFile } as Platform);
    setKeybindingOverrides({ 'run.script': ['F9'], 't.find': null });
    render(<KeymapEditor />);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Export/ })));
    expect(saveFile).toHaveBeenCalledTimes(1);
    const arg = saveFile.mock.calls[0] as unknown as [{ suggestedName: string; content: string }];
    expect(arg[0].suggestedName).toBe('rowlit-keymap.json');
    expect(JSON.parse(arg[0].content)).toEqual({ format: 'rowlit-keymap', version: 1, keybindings: { 'run.script': ['F9'], 't.find': null } });
    expect(useUi.getState().toasts.at(-1)?.text).toBe('Keymap exported');
  });

  it('imports a keymap file: applies it, skips commands this build does not have, reports it', async () => {
    const content = JSON.stringify({ format: 'rowlit-keymap', version: 1, keybindings: { 'run.script': ['F7'], 'not.a.command': ['F8'], 't.find': null } });
    setPlatform({ ...createBrowserPlatform(), openTextFile: async () => ({ name: 'mine.json', path: null, content }) } as Platform);
    render(<KeymapEditor />);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Import/ })));
    expect(getKeybindingOverrides()).toEqual({ 'run.script': ['F7'], 't.find': null });
    const toast = useUi.getState().toasts.at(-1)!;
    expect(toast.text).toBe('Imported 2 changed commands');
    expect(toast.detail).toContain('1 entry was skipped');
    expect(stored()).toEqual([{ command: 'run.script', keys: ['F7'] }, { command: 't.find', keys: [] }]);
  });

  it('rejects a file that is not a keymap and leaves the shortcuts alone', async () => {
    setKeybindingOverrides({ 'run.script': ['F9'] });
    setPlatform({ ...createBrowserPlatform(), openTextFile: async () => ({ name: 'x.json', path: null, content: '{"nope":' }) } as Platform);
    render(<KeymapEditor />);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Import/ })));
    expect(getKeybindingOverrides()).toEqual({ 'run.script': ['F9'] });
    expect(useUi.getState().toasts.at(-1)?.kind).toBe('error');
  });

  it('an exported keymap imports back unchanged', async () => {
    const original = { 'run.script': ['F9', 'Mod+Alt+R'], 't.find': null };
    const content = serializeKeymap(original);
    setKeybindingOverrides({});
    setPlatform({ ...createBrowserPlatform(), openTextFile: async () => ({ name: 'k.json', path: null, content }) } as Platform);
    render(<KeymapEditor />);
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: /Import/ })));
    expect(getKeybindingOverrides()).toEqual(original);
  });
});
