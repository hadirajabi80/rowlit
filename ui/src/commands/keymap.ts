// User-customisable keymap: the data model and the rules around it, framework-free (no React, no stores) so every rule
// is unit-tested on its own.
//
// Model. A command ships with defaults (`shortcut` + `altShortcuts`). The user's overrides are a map
//
//   { [commandId]: string[] | null }
//
// where an array REPLACES the command's shortcuts (the first is the primary one, the rest are alternatives; chords are
// written "Mod+K Mod+S") and null means "unbound". A command without an entry keeps its defaults. The effective
// shortcuts of every command are `override ?? defaults`; the registry (registry.ts) resolves them for the dispatcher,
// the menus, tooltips, the palette, the shortcut dialog and the editor.
//
// Persistence. The overrides live in `settings.ui.keybindings`. The engine merges nested objects key by key and
// deletes a key whose patch value is null, so a map would lose "unbound" and could never drop an entry; they are stored
// as an array of entries (arrays replace wholesale): [{ command, keys: string[] }] where an empty `keys` means unbound.
// A map is accepted when read (hand-edited settings, imported files).
import { displayShortcut, isMac, isModifierOnly, normalizeShortcut } from './keys';

export type KeybindingOverrides = Record<string, string[] | null>;

/** settings.ui key holding the overrides. */
export const KEYBINDINGS_UI_KEY = 'keybindings';

/** Exported keymap files: `{ format, version, keybindings }`. */
export const KEYMAP_FILE_FORMAT = 'rowlit-keymap';

/** At most this many shortcuts per command (primary + alternatives). */
export const MAX_SHORTCUTS_PER_COMMAND = 4;
/** A chord has at most two strokes ("Mod+K Mod+S"). */
export const MAX_STROKES = 2;

/** Scopes whose keys also reach text fields and the editor, so a plain letter bound there would block typing. */
const TYPING_SCOPES = new Set(['global', 'console', 'editor']);

/** Commands that also have a Monaco action (editor/keyActions.ts): their keys are bound inside the editor too. */
export const EDITOR_ACTION_COMMANDS: readonly string[] = [
  'run.statement', 'run.script', 'format.selection', 'snippet.insert', 'explain.estimated', 'explain.actual', 'editor.triggerSuggest',
];

// ---------------------------------------------------------------------------------------------- canonical form

const KEY_LABELS: Record<string, string> = {
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', pageup: 'PageUp', pagedown: 'PageDown',
  enter: 'Enter', escape: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', click: 'Click',
};

/**
 * The platform-neutral way shortcuts are stored and exported: "Mod+Shift+P", "MacCtrl+Space", "Mod+K Mod+S". Input is a
 * normalised shortcut ("ctrl+shift+p"); `normalizeShortcut(canonicalShortcut(x)) === x`.
 */
export function canonicalShortcut(normalized: string): string {
  return normalized
    .split(' ')
    .map((stroke) => {
      const parts = stroke.split('+');
      const key = parts.pop() ?? '';
      const mods = ['ctrl', 'macctrl', 'alt', 'shift'].filter((m) => parts.includes(m)).map((m) => (m === 'ctrl' ? 'Mod' : m === 'macctrl' ? 'MacCtrl' : m === 'alt' ? 'Alt' : 'Shift'));
      const k = KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : /^f\d+$/.test(key) ? key.toUpperCase() : key);
      return [...mods, k].join('+');
    })
    .join(' ');
}

const NAMED_KEYS = new Set(Object.keys(KEY_LABELS).filter((k) => k !== 'click'));
const PUNCTUATION = new Set(['=', '-', ',', '.', '/', '\\', '`', '[', ']', ';', "'"]);

function validKey(key: string): boolean {
  if (/^[a-z0-9]$/.test(key)) return true;
  if (/^f([1-9]|1\d|2[0-4])$/.test(key)) return true;
  return NAMED_KEYS.has(key) || PUNCTUATION.has(key);
}

export type ParsedShortcut = { ok: true; normalized: string; canonical: string } | { ok: false; reason: string };

/**
 * Validates a shortcut for a command in `scope`: one or two strokes, each with a real key. In a scope that reaches the
 * editor and text fields (global, console, editor) the first stroke needs Ctrl/Cmd/Alt (or is an F-key): a bare
 * letter or Shift+letter would be swallowed from typing.
 */
export function parseShortcut(input: string, scope: string = 'global'): ParsedShortcut {
  const text = (input ?? '').trim();
  if (!text) return { ok: false, reason: 'Press a key combination' };
  const normalized = normalizeShortcut(text);
  const strokes = normalized.split(' ');
  if (strokes.length > MAX_STROKES) return { ok: false, reason: 'A chord has at most two key combinations' };
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (isModifierOnly(s)) return { ok: false, reason: 'Add a key to the modifiers' };
    const parts = s.split('+');
    const key = parts.pop() ?? '';
    if (!validKey(key)) return { ok: false, reason: `“${key}” cannot be used in a shortcut` };
    const mods = parts;
    if (i === 0 && TYPING_SCOPES.has(scope) && !/^f\d+$/.test(key) && !mods.some((m) => m === 'ctrl' || m === 'macctrl' || m === 'alt')) {
      return { ok: false, reason: `Add ${isMac() ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'}: a plain key would stop you typing` };
    }
  }
  return { ok: true, normalized, canonical: canonicalShortcut(normalized) };
}

/** True when two lists name the same shortcuts in the same order (compared normalised). */
export function sameShortcuts(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => normalizeShortcut(x) === normalizeShortcut(b[i]));
}

// ---------------------------------------------------------------------------------------------- overrides

function cleanKeys(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of list) {
    if (typeof k !== 'string') continue;
    // scope is not known here: structure only (the scope rule is applied when a key is recorded)
    const p = parseShortcut(k, 'scoped');
    if (!p.ok || seen.has(p.normalized)) continue;
    seen.add(p.normalized);
    out.push(p.canonical);
    if (out.length >= MAX_SHORTCUTS_PER_COMMAND) break;
  }
  return out;
}

/**
 * Overrides from anything stored or imported: the stored array form, a map, or junk. Malformed shortcuts are dropped; a
 * command left without a valid shortcut by that is unbound (an explicit empty list / null stays "unbound").
 */
export function sanitizeOverrides(raw: unknown): KeybindingOverrides {
  const out: KeybindingOverrides = {};
  const put = (id: unknown, keys: unknown) => {
    if (typeof id !== 'string' || !id || id === '__proto__' || id.length > 120) return;
    if (keys === null) {
      out[id] = null;
      return;
    }
    const list = cleanKeys(keys);
    if (!list) return;
    out[id] = list.length ? list : null;
  };
  if (Array.isArray(raw)) {
    for (const e of raw) {
      if (e && typeof e === 'object') put((e as { command?: unknown }).command, (e as { keys?: unknown }).keys ?? []);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [id, keys] of Object.entries(raw as Record<string, unknown>)) put(id, keys);
  }
  return out;
}

/** The settings.ui form: an array of { command, keys } (empty keys = unbound), sorted so saves are stable. */
export function overridesToStored(o: KeybindingOverrides): { command: string; keys: string[] }[] {
  return Object.keys(o).sort().map((command) => ({ command, keys: o[command] ?? [] }));
}

export function overrideCount(o: KeybindingOverrides): number {
  return Object.keys(o).length;
}

export interface CommandKeys {
  id: string;
  shortcut?: string;
  altShortcuts?: readonly string[];
}

/** A command's shipped shortcuts: primary first, then the alternatives. */
export function defaultKeys(c: Pick<CommandKeys, 'shortcut' | 'altShortcuts'>): string[] {
  return c.shortcut ? [c.shortcut, ...(c.altShortcuts ?? [])] : [];
}

/** effective = override ?? defaults (null = unbound). */
export function effectiveKeys(c: CommandKeys, o: KeybindingOverrides): string[] {
  const has = Object.prototype.hasOwnProperty.call(o, c.id);
  if (has) return o[c.id] ?? [];
  return defaultKeys(c);
}

/**
 * The overrides after setting a command's shortcuts to `keys`: an entry equal to the defaults is dropped (so "reset"
 * and "edited back to the default" look the same), an empty list is "unbound", `null` forgets the override.
 */
export function withKeys(o: KeybindingOverrides, c: CommandKeys, keys: string[] | null): KeybindingOverrides {
  const next: KeybindingOverrides = { ...o };
  const defaults = defaultKeys(c);
  if (keys === null || sameShortcuts(keys, defaults)) delete next[c.id];
  else next[c.id] = keys.length ? keys : null;
  return next;
}

// ---------------------------------------------------------------------------------------------- conflicts

/** What the conflict rules need to know about a command. */
export interface KeymapEntry {
  id: string;
  title: string;
  scope: string;
  /** Effective shortcuts (any spelling). */
  keys: readonly string[];
}

export type ConflictKind =
  /** Same key, same scope: an error, one of the two must give it up. */
  | 'same-scope'
  /** The key is the first stroke of a chord of the same scope (or the chord starts with an existing key): the dispatcher waits for the chord, the single key would never run. */
  | 'chord'
  /** Same key in another scope: allowed; the more specific scope wins where it applies. */
  | 'other-scope';

export interface KeyConflict {
  kind: ConflictKind;
  commandId: string;
  title: string;
  /** The conflicting binding of that command (normalised). */
  key: string;
  scope: string;
}

/** Bindings that collide with `key` (normalised) bound to `commandId` in `scope`. */
export function findKeyConflicts(key: string, commandId: string, scope: string, entries: readonly KeymapEntry[]): KeyConflict[] {
  const out: KeyConflict[] = [];
  const first = key.split(' ')[0];
  const isChord = key.includes(' ');
  for (const e of entries) {
    if (e.id === commandId) continue;
    for (const raw of e.keys) {
      const k = normalizeShortcut(raw);
      const same = e.scope === scope;
      if (k === key) out.push({ kind: same ? 'same-scope' : 'other-scope', commandId: e.id, title: e.title, key: k, scope: e.scope });
      else if (same && ((!isChord && k.startsWith(`${key} `)) || (isChord && k === first))) {
        out.push({ kind: 'chord', commandId: e.id, title: e.title, key: k, scope: e.scope });
      }
    }
  }
  return out;
}

/** Every same-scope collision between the entries (the shortcut dialog's "needs attention" list). */
export function allConflicts(entries: readonly KeymapEntry[]): { id: string; key: string; with: string }[] {
  const seen = new Map<string, string>();
  const out: { id: string; key: string; with: string }[] = [];
  for (const e of entries) {
    for (const raw of e.keys) {
      const k = normalizeShortcut(raw);
      const slot = `${e.scope}\u0001${k}`;
      const owner = seen.get(slot);
      if (owner && owner !== e.id) out.push({ id: e.id, key: k, with: owner });
      else seen.set(slot, e.id);
    }
  }
  return out;
}

/** `key` taken away from `commandId`: the keys that remain (null when none). */
function without(keys: readonly string[], key: string): string[] {
  return keys.filter((k) => normalizeShortcut(k) !== key);
}

/**
 * Binds `key` to a command. `replace` takes the key away from the commands of the same scope that hold it (and from
 * chords that clash with it); without it the call is refused (returns null) while a same-scope conflict exists.
 * `replaceScoped` takes it away from the commands of other scopes too (without it they keep it: the more specific scope
 * wins where it applies). `index` replaces that shortcut of the command, `undefined` appends one. Returns the new
 * overrides.
 */
export function bindKey(
  o: KeybindingOverrides,
  cmds: readonly (CommandKeys & { title: string; scope: string })[],
  commandId: string,
  shortcut: string,
  opts: { replace?: boolean; replaceScoped?: boolean; index?: number } = {},
): KeybindingOverrides | null {
  const target = cmds.find((c) => c.id === commandId);
  if (!target) return null;
  const parsed = parseShortcut(shortcut, target.scope);
  if (!parsed.ok) return null;
  const entries: KeymapEntry[] = cmds.map((c) => ({ id: c.id, title: c.title, scope: c.scope, keys: effectiveKeys(c, o) }));
  const found = findKeyConflicts(parsed.normalized, commandId, target.scope, entries);
  const hard = found.filter((c) => c.kind !== 'other-scope');
  if (hard.length && !opts.replace) return null;
  const clashes = opts.replaceScoped ? found : hard;
  let next = { ...o };
  for (const c of clashes) {
    const other = cmds.find((x) => x.id === c.commandId)!;
    next = withKeys(next, other, without(effectiveKeys(other, next), c.key));
  }
  const current = effectiveKeys(target, next).map((k) => canonicalShortcut(normalizeShortcut(k)));
  const keys = [...current];
  if (opts.index !== undefined && opts.index >= 0 && opts.index < keys.length) keys[opts.index] = parsed.canonical;
  else keys.push(parsed.canonical);
  // the same key twice on one command is one key
  const seen = new Set<string>();
  const unique = keys.filter((k) => {
    const n = normalizeShortcut(k);
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  return withKeys(next, target, unique.slice(0, MAX_SHORTCUTS_PER_COMMAND));
}

/** One binding of a command removed. */
export function unbindKey(o: KeybindingOverrides, c: CommandKeys, index: number): KeybindingOverrides {
  const keys = effectiveKeys(c, o).map((k) => canonicalShortcut(normalizeShortcut(k)));
  keys.splice(index, 1);
  return withKeys(o, c, keys);
}

// ---------------------------------------------------------------------------------------------- reserved keys

export interface ReservedKey {
  key: string;
  /** Where it applies: 'any' | 'mac' | 'win' | 'browser' (the web build; the page never sees it). */
  on: 'any' | 'mac' | 'win' | 'browser';
  why: string;
}

/** Keys the OS or the browser takes before the page sees them (or that other apps rely on): a warning, never a block. */
export const RESERVED_KEYS: readonly ReservedKey[] = [
  { key: 'alt+f4', on: 'win', why: 'closes the window' },
  { key: 'ctrl+alt+delete', on: 'win', why: 'is the Windows security screen' },
  { key: 'alt+tab', on: 'win', why: 'switches applications' },
  { key: 'alt+escape', on: 'win', why: 'switches applications' },
  { key: 'ctrl+escape', on: 'win', why: 'opens the Start menu' },
  { key: 'ctrl+q', on: 'mac', why: 'quits the application' },
  { key: 'ctrl+h', on: 'mac', why: 'hides the application' },
  { key: 'ctrl+m', on: 'mac', why: 'minimises the window' },
  { key: 'ctrl+space', on: 'mac', why: 'opens Spotlight' },
  { key: 'ctrl+tab', on: 'mac', why: 'switches applications' },
  { key: 'ctrl+w', on: 'browser', why: 'closes the browser tab' },
  { key: 'ctrl+t', on: 'browser', why: 'opens a browser tab' },
  { key: 'ctrl+n', on: 'browser', why: 'opens a browser window' },
  { key: 'ctrl+shift+n', on: 'browser', why: 'opens a private browser window' },
  { key: 'ctrl+shift+t', on: 'browser', why: 'reopens a closed browser tab' },
  { key: 'ctrl+tab', on: 'browser', why: 'switches browser tabs' },
  { key: 'ctrl+pageup', on: 'browser', why: 'switches browser tabs' },
  { key: 'ctrl+pagedown', on: 'browser', why: 'switches browser tabs' },
  { key: 'f11', on: 'browser', why: 'toggles full screen' },
];

/** Warnings for a (normalised) shortcut: only its first stroke can be taken by the system. */
export function reservedWarnings(key: string, ctx: { mac: boolean; browser: boolean }): string[] {
  const first = key.split(' ')[0];
  return RESERVED_KEYS.filter((r) => {
    if (r.key !== first) return false;
    if (r.on === 'any') return true;
    if (r.on === 'mac') return ctx.mac;
    if (r.on === 'win') return !ctx.mac;
    return ctx.browser;
  }).map((r) => `${displayShortcut(r.key, ctx.mac)} ${r.why} on this system, so it may never reach Rowlit`);
}

// ---------------------------------------------------------------------------------------------- built-in editor keys

export interface BuiltinKey {
  key: string;
  title: string;
}

/**
 * The code editor's own keys (Monaco's built-ins and the editor actions that have no command). They are not
 * customisable: a command bound to one of them does not run while the editor has focus (the editor keeps the key).
 * Listed in the shortcut dialog as "Editor (built-in)".
 */
export const EDITOR_BUILTIN_KEYS: readonly BuiltinKey[] = [
  { key: 'Mod+F', title: 'Find' },
  { key: 'Mod+H', title: 'Replace' },
  { key: 'Mod+Z', title: 'Undo' },
  { key: 'Mod+Y', title: 'Redo' },
  { key: 'Mod+Shift+Z', title: 'Redo' },
  { key: 'Mod+A', title: 'Select all' },
  { key: 'Mod+C', title: 'Copy' },
  { key: 'Mod+X', title: 'Cut' },
  { key: 'Mod+V', title: 'Paste' },
  { key: 'Mod+D', title: 'Duplicate line' },
  { key: 'Mod+Shift+U', title: 'Transform to upper case' },
  { key: 'Mod+/', title: 'Toggle line comment' },
  { key: 'Mod+]', title: 'Indent line' },
  { key: 'Mod+[', title: 'Outdent line' },
  { key: 'Alt+ArrowUp', title: 'Move line up' },
  { key: 'Alt+ArrowDown', title: 'Move line down' },
  { key: 'Shift+Alt+ArrowUp', title: 'Copy line up' },
  { key: 'Shift+Alt+ArrowDown', title: 'Copy line down' },
  { key: 'Mod+Shift+Space', title: 'Parameter info' },
  { key: 'F12', title: 'Go to definition' },
  { key: 'Shift+F12', title: 'Find all references' },
  { key: 'F2', title: 'Rename symbol' },
];

/** The built-in editor action using this (normalised) key, if any. */
export function editorBuiltinFor(key: string): BuiltinKey | undefined {
  return EDITOR_BUILTIN_KEYS.find((b) => normalizeShortcut(b.key) === key);
}

// ---------------------------------------------------------------------------------------------- keymap files

export interface KeymapFile {
  format: typeof KEYMAP_FILE_FORMAT;
  version: 1;
  keybindings: KeybindingOverrides;
}

/** The text of an exported keymap (human-readable map form). */
export function serializeKeymap(o: KeybindingOverrides): string {
  const sorted: KeybindingOverrides = {};
  for (const k of Object.keys(o).sort()) sorted[k] = o[k];
  const file: KeymapFile = { format: KEYMAP_FILE_FORMAT, version: 1, keybindings: sorted };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type KeymapParse = { ok: true; overrides: KeybindingOverrides; skipped: number } | { ok: false; error: string };

/**
 * Reads an exported keymap (or a bare `{ commandId: keys }` map). `known` filters out commands this build does not
 * have (the number dropped is reported). A bare list of entries as stored in settings is accepted too.
 */
export function parseKeymapFile(text: string, known: (id: string) => boolean = () => true): KeymapParse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  let raw: unknown = data;
  if (data && typeof data === 'object' && !Array.isArray(data) && 'keybindings' in data) {
    const f = data as { format?: unknown; keybindings: unknown };
    if (f.format !== undefined && f.format !== KEYMAP_FILE_FORMAT) return { ok: false, error: 'This is not a Rowlit keymap file.' };
    raw = f.keybindings;
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'No keybindings found in the file.' };
  const all = sanitizeOverrides(raw);
  const overrides: KeybindingOverrides = {};
  let skipped = 0;
  for (const [id, keys] of Object.entries(all)) {
    if (known(id)) overrides[id] = keys;
    else skipped++;
  }
  const entries = Array.isArray(raw) ? raw.length : Object.keys(raw as object).length;
  if (!Object.keys(overrides).length && entries > 0 && skipped === 0) return { ok: false, error: 'No valid keybindings found in the file.' };
  return { ok: true, overrides, skipped };
}

/**
 * Makes imported overrides safe to apply: a binding that collides (same scope) with another imported binding is
 * dropped (the first wins); one that collides with a command left on its defaults takes the key away from that
 * command (the imported keymap wins over the defaults it replaces).
 */
export function settleImport(
  imported: KeybindingOverrides,
  cmds: readonly (CommandKeys & { title: string; scope: string })[],
): { overrides: KeybindingOverrides; dropped: number } {
  let state: KeybindingOverrides = {};
  const claimed = new Map<string, string>();
  let dropped = 0;
  const byId = new Map(cmds.map((c) => [c.id, c]));
  const ids = Object.keys(imported).filter((id) => byId.has(id)).sort();
  // 1) imported commands first: their own keys, first wins
  for (const id of ids) {
    const c = byId.get(id)!;
    const keep: string[] = [];
    for (const k of imported[id] ?? []) {
      const p = parseShortcut(k, c.scope);
      if (!p.ok) {
        dropped++;
        continue;
      }
      const slot = `${c.scope}\u0001${p.normalized}`;
      if (claimed.has(slot)) {
        dropped++;
        continue;
      }
      claimed.set(slot, id);
      keep.push(p.canonical);
    }
    // every key it asked for was taken or invalid: it keeps what it had rather than ending up unbound
    if (!keep.length && (imported[id]?.length ?? 0) > 0) continue;
    state = withKeys(state, c, keep);
  }
  // 2) the defaults of the other commands give way to what was imported
  for (const c of cmds) {
    if (c.id in state) continue;
    const remaining = defaultKeys(c).filter((k) => {
      const owner = claimed.get(`${c.scope}\u0001${normalizeShortcut(k)}`);
      return owner === undefined || owner === c.id;
    });
    if (remaining.length !== defaultKeys(c).length) state = withKeys(state, c, remaining);
  }
  return { overrides: state, dropped };
}
