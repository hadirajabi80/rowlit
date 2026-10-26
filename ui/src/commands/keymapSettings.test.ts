// settings.ui.keybindings <-> registry overrides <-> the native menu's accelerators.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { createBrowserPlatform } from '../platform/browser';
import { setPlatform } from '../platform';
import type { Platform } from '../platform/types';
import { DEFAULT_SETTINGS, useSettings } from '../store/settings';
import { setPlatformForTests } from './keys';
import { KEYBINDINGS_UI_KEY } from './keymap';
import { commitKeybindings, customizedCount, installKeymap, menuShortcutOverrides, overridesFromSettings } from './keymapSettings';
import { getKeybindingOverrides, primaryShortcut, registerCommands, resetCommandsForTests, setKeybindingOverrides } from './registry';

const setMenuShortcuts = vi.fn();
let uninstall: () => void = () => {};

beforeEach(() => {
  setPlatformForTests(false);
  resetCommandsForTests();
  registerCommands([
    { id: 'file.save', title: 'Save', category: 'File', shortcut: 'Mod+S', run: () => {} },
    { id: 'view.settings', title: 'Settings…', category: 'Preferences', shortcut: 'Mod+,', run: () => {} },
    { id: 'file.sampleDb', title: 'Open the sample database', category: 'File', run: () => {} },
  ]);
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ui: {} } });
  vi.spyOn(api, 'putSettings').mockImplementation(async (p) => p as never);
  setPlatform({ ...createBrowserPlatform(), setMenuShortcuts } as Platform);
});
afterEach(() => {
  uninstall();
  uninstall = () => {};
  setPlatform(null);
  setPlatformForTests(null);
  resetCommandsForTests();
  setMenuShortcuts.mockReset();
  vi.restoreAllMocks();
});

describe('keymap settings', () => {
  it('applies the overrides stored in settings.ui.keybindings, also when settings load later', () => {
    uninstall = installKeymap();
    expect(getKeybindingOverrides()).toEqual({});
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ui: { [KEYBINDINGS_UI_KEY]: [{ command: 'file.save', keys: ['Mod+Alt+S'] }, { command: 'view.settings', keys: [] }] } } });
    expect(getKeybindingOverrides()).toEqual({ 'file.save': ['Mod+Alt+S'], 'view.settings': null });
    expect(primaryShortcut('file.save')).toBe('Mod+Alt+S');
    expect(primaryShortcut('view.settings')).toBeUndefined();
    // back to nothing
    useSettings.setState({ settings: { ...DEFAULT_SETTINGS, ui: {} } });
    expect(getKeybindingOverrides()).toEqual({});
  });

  it('reads a hand-written map and survives garbage in the settings', () => {
    expect(overridesFromSettings({ [KEYBINDINGS_UI_KEY]: { 'file.save': ['F7'] } })).toEqual({ 'file.save': ['F7'] });
    expect(overridesFromSettings({ [KEYBINDINGS_UI_KEY]: 'oops' })).toEqual({});
    expect(overridesFromSettings({})).toEqual({});
  });

  it('commitKeybindings applies at once and saves the array form with the settings', () => {
    uninstall = installKeymap();
    commitKeybindings({ 'file.save': ['Mod+Alt+S'], 'view.settings': null });
    expect(primaryShortcut('file.save')).toBe('Mod+Alt+S');
    expect(customizedCount()).toBe(2);
    expect(useSettings.getState().settings.ui[KEYBINDINGS_UI_KEY]).toEqual([
      { command: 'file.save', keys: ['Mod+Alt+S'] },
      { command: 'view.settings', keys: [] },
    ]);
    commitKeybindings({});
    expect(customizedCount()).toBe(0);
    expect(useSettings.getState().settings.ui[KEYBINDINGS_UI_KEY]).toEqual([]);
  });

  it('tells the native menu only about the menu items whose shortcut changed', () => {
    setKeybindingOverrides({ 'file.save': ['Mod+Alt+S'], 'view.settings': null, 'file.sampleDb': ['Mod+Alt+B'], 'not.in.menu': ['F8'] });
    // file.sampleDb is in the menu without an accelerator: it gains one; view.settings loses its
    expect(menuShortcutOverrides()).toEqual({ 'file.save': 'Mod+Alt+S', 'view.settings': null, 'file.sampleDb': 'Mod+Alt+B' });
    setKeybindingOverrides({ 'file.save': ['Mod+S'] });
    expect(menuShortcutOverrides()).toEqual({});
  });

  it('sends the accelerators when the keymap changes, and {} once to restore the shipped menu', () => {
    uninstall = installKeymap();
    // nothing customised: the menu is left alone
    expect(setMenuShortcuts).not.toHaveBeenCalled();
    commitKeybindings({ 'file.save': ['Mod+Alt+S'] });
    expect(setMenuShortcuts).toHaveBeenLastCalledWith({ 'file.save': 'Mod+Alt+S' });
    commitKeybindings({});
    expect(setMenuShortcuts).toHaveBeenLastCalledWith({});
    const calls = setMenuShortcuts.mock.calls.length;
    commitKeybindings({});
    expect(setMenuShortcuts).toHaveBeenCalledTimes(calls);
  });

  it('is a no-op for the menu in the browser build', () => {
    setPlatform(createBrowserPlatform());
    uninstall = installKeymap();
    expect(() => commitKeybindings({ 'file.save': ['Mod+Alt+S'] })).not.toThrow();
    expect(primaryShortcut('file.save')).toBe('Mod+Alt+S');
  });
});
