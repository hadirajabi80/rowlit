// Preset keymaps map only to commands that exist, use valid shortcuts, and leave no same-scope conflict once applied on
// top of the real command set.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initCommands } from '.';
import { normalizeShortcut, setPlatformForTests } from './keys';
import { effectiveKeys, sanitizeOverrides } from './keymap';
import { DEFAULT_PRESET_ID, detectPreset, getPreset, KEYMAP_PRESETS, presetOverrides, validatePreset } from './keymapPresets';
import { getCommand, hasCommand, listCommands } from './registry';

beforeAll(() => initCommands(), 60_000);
afterEach(() => setPlatformForTests(null));

const list = () => listCommands().map((c) => ({ id: c.id, title: c.title, scope: c.scope ?? 'global', shortcut: c.shortcut, altShortcuts: c.altShortcuts }));

describe('keymap presets', () => {
  it('offers the default, JetBrains, VS Code and SSMS keymaps', () => {
    expect(KEYMAP_PRESETS.map((p) => p.id)).toEqual([DEFAULT_PRESET_ID, 'jetbrains', 'vscode', 'ssms']);
    expect(getPreset(DEFAULT_PRESET_ID)?.overrides).toEqual({});
    expect(new Set(KEYMAP_PRESETS.map((p) => p.name)).size).toBe(KEYMAP_PRESETS.length);
  });

  for (const platform of [false, true]) {
    for (const preset of KEYMAP_PRESETS) {
      it(`${preset.name} is valid on ${platform ? 'macOS' : 'Windows/Linux'}: real commands, valid keys, no same-scope conflict`, () => {
        setPlatformForTests(platform);
        expect(validatePreset(preset, list())).toEqual([]);
      });
    }
  }

  it('every preset id is a registered command, so none is dropped when applied', () => {
    for (const preset of KEYMAP_PRESETS) {
      for (const id of Object.keys(preset.overrides)) expect(hasCommand(id), `${preset.id}: ${id}`).toBe(true);
      expect(presetOverrides(preset, hasCommand)).toEqual(preset.overrides);
    }
  });

  it('presets survive the stored form unchanged and are not no-ops against the defaults', () => {
    for (const preset of KEYMAP_PRESETS) {
      const norm = (o: Record<string, string[] | null>) => Object.fromEntries(Object.entries(o).map(([id, keys]) => [id, keys?.map(normalizeShortcut) ?? null]));
      expect(norm(sanitizeOverrides(preset.overrides))).toEqual(norm(preset.overrides));
      for (const [id, keys] of Object.entries(preset.overrides)) {
        const c = getCommand(id)!;
        expect(effectiveKeys(c, preset.overrides), `${preset.id}: ${id} changes nothing`).not.toEqual(effectiveKeys(c, {}));
        expect(keys?.length, `${preset.id}: ${id}`).toBeGreaterThan(0);
      }
    }
  });

  it('JetBrains runs the script with its own key and formats with the Reformat key', () => {
    const o = getPreset('jetbrains')!.overrides;
    expect(o['run.script']).toEqual(['Mod+Shift+F10']);
    expect(o['format.document']?.[0]).toBe('Mod+Alt+L');
  });

  it('VS Code moves the palette to F1 and keeps the keyboard-shortcuts chord', () => {
    const o = getPreset('vscode')!.overrides;
    expect(o['view.commandPalette']).toContain('F1');
    expect(o['view.shortcuts']).toEqual(['Mod+K Mod+S']);
  });

  it('SSMS has the actual plan on Ctrl+M and refreshes the catalog with Ctrl+Shift+R', () => {
    const o = getPreset('ssms')!.overrides;
    expect(o['explain.actual']).toEqual(['Mod+M']);
    expect(o['connections.refreshCatalog']).toEqual(['Mod+Shift+R']);
    expect(o['view.maximizeResults']).not.toContain('Mod+Shift+R');
  });

  it('detects which preset the current overrides are (none: custom)', () => {
    expect(detectPreset({})?.id).toBe(DEFAULT_PRESET_ID);
    expect(detectPreset(getPreset('ssms')!.overrides)?.id).toBe('ssms');
    expect(detectPreset({ ...getPreset('ssms')!.overrides, 'run.cancel': ['F9'] })).toBeNull();
    expect(detectPreset({ 'run.cancel': null })).toBeNull();
  });

  it('a preset naming a command this build lacks drops that entry only', () => {
    const p = { id: 'x', name: 'X', description: '', overrides: { 'run.script': ['F7'], 'gone.command': ['F8'] } };
    expect(presetOverrides(p, hasCommand)).toEqual({ 'run.script': ['F7'] });
    expect(validatePreset(p, list())).toEqual(['gone.command is not a command']);
  });
});
