// Glue between the keymap (commands/keymap.ts), the settings store (settings.ui.keybindings, persisted engine-side) and
// the places that need the effective shortcuts outside the renderer's own key handling: the registry (dispatcher,
// tooltips, palette, editor) and the native application menu (accelerators, built in the Electron main process).
import { getPlatform } from '../platform';
import { useSettings } from '../store/settings';
import { normalizeShortcut } from './keys';
import {
  KEYBINDINGS_UI_KEY, overrideCount, overridesToStored, sanitizeOverrides, type KeybindingOverrides,
} from './keymap';
import { MENUS } from './menuModel';
import { getCommand, getKeybindingOverrides, primaryShortcut, setKeybindingOverrides, subscribeKeymap } from './registry';

/** The user's overrides as stored in the settings. */
export function overridesFromSettings(ui: Record<string, unknown> = useSettings.getState().settings.ui): KeybindingOverrides {
  return sanitizeOverrides(ui?.[KEYBINDINGS_UI_KEY]);
}

/** Makes `next` the user's keymap: applied at once, saved with the settings. */
export function commitKeybindings(next: KeybindingOverrides): void {
  const clean = sanitizeOverrides(next);
  if (JSON.stringify(clean) !== JSON.stringify(getKeybindingOverrides())) setKeybindingOverrides(clean);
  useSettings.getState().update({ ui: { [KEYBINDINGS_UI_KEY]: overridesToStored(clean) } });
}

/** How many commands the user rebound or unbound. */
export function customizedCount(): number {
  return overrideCount(getKeybindingOverrides());
}

/**
 * Native-menu accelerators that differ from the menu model's: { commandId: "Mod+Shift+K" | null } for the menu items
 * whose command the user rebound (null = unbound). The main process rebuilds the menu from it.
 */
export function menuShortcutOverrides(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const menu of MENUS) {
    for (const it of menu.items) {
      if (it.type !== undefined && it.type !== 'command') continue;
      if (out[it.command] !== undefined || !getCommand(it.command)) continue;
      const eff = primaryShortcut(it.command);
      const base = it.shortcut;
      if ((eff ? normalizeShortcut(eff) : '') === (base ? normalizeShortcut(base) : '')) continue;
      out[it.command] = eff ?? null;
    }
  }
  return out;
}

let sentToMenu = false;

/** Tells the desktop shell which accelerators to show (a no-op in the browser build). */
export function syncNativeMenu(): void {
  const platform = getPlatform();
  if (typeof platform.setMenuShortcuts !== 'function') return;
  const map = menuShortcutOverrides();
  const empty = Object.keys(map).length === 0;
  // Nothing changed from the shipped menu and nothing was sent before: leave the menu alone.
  if (empty && !sentToMenu) return;
  sentToMenu = !empty;
  platform.setMenuShortcuts(map);
}

/**
 * Keeps the registry's overrides in step with settings.ui.keybindings (also when the settings load or change from
 * elsewhere) and the native menu with the registry. Returns the uninstaller.
 */
export function installKeymap(): () => void {
  const offMenu = subscribeKeymap(syncNativeMenu);
  let lastRaw: unknown;
  const apply = () => {
    const raw = useSettings.getState().settings.ui?.[KEYBINDINGS_UI_KEY];
    if (raw === lastRaw) return;
    lastRaw = raw;
    const next = sanitizeOverrides(raw);
    if (JSON.stringify(next) !== JSON.stringify(getKeybindingOverrides())) setKeybindingOverrides(next);
  };
  apply();
  const off = useSettings.subscribe(apply);
  return () => {
    off();
    offMenu();
  };
}
