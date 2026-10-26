import { CircleDot, Download, Keyboard, Lock, Pencil, Plus, RotateCcw, Search, TriangleAlert, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { inTextField, isEditorOwned, pushKeyCapture } from '../../commands/dispatcher';
import { displayShortcut, isMac, shortcutKeys } from '../../commands/keys';
import {
  bindKey, editorBuiltinFor, EDITOR_ACTION_COMMANDS, findKeyConflicts, parseKeymapFile, parseShortcut, reservedWarnings, serializeKeymap,
  settleImport, unbindKey, withKeys, type KeyConflict,
} from '../../commands/keymap';
import { commitKeybindings } from '../../commands/keymapSettings';
import { detectPreset, KEYMAP_PRESETS, presetOverrides } from '../../commands/keymapPresets';
import { findConflicts, getCommand, getKeybindingOverrides, hasCommand, type ShortcutBinding } from '../../commands/registry';
import { useCommandsVersion } from '../../commands/useCommands';
import { getPlatform } from '../../platform';
import { toast, useUi } from '../../store/ui';
import { Dialog } from '../common/Dialog';
import { Select } from '../common/Select';
import { Kbd } from './Kbd';
import {
  bindingsWithModifiers, classifyKeyDown, eventModifiers, hintAnnouncement, HINT_DELAY_MS, searchStroke, spokenShortcut,
} from './keySearch';
import {
  BUILTIN_CATEGORY, buildKeymapRows, commandEntries, keymapEntries, rowInFilter, rowMatches, type KeymapRow, type RowFilter,
} from './keymapView';
import { classifyRecorderKey, nextStrokes } from './recorder';
import './shortcuts.css';

const SCOPE_LABEL: Record<string, string> = {
  global: '', editor: 'in the editor', console: 'in a console', grid: 'in a result grid', explorer: 'in the explorer', history: 'in history',
  designer: 'in a designer', dataTab: 'in a data tab', results: 'in results',
};

/** "in the results grid": where a scope applies, for messages. */
function scopeText(scope: string): string {
  return SCOPE_LABEL[scope] || (scope === 'global' ? 'everywhere' : `in ${scope}`);
}

/** A pressed combination and the bindings it found (kept after the keys are released). */
interface Found {
  key: string;
  bindings: ShortcutBinding[];
}

const bindingId = (b: Pick<ShortcutBinding, 'commandId' | 'key'>) => `${b.commandId}|${b.key}`;

const FILTERS: { id: RowFilter; label: string }[] = [
  { id: 'assigned', label: 'Assigned' },
  { id: 'all', label: 'All' },
  { id: 'edited', label: 'Edited' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'conflicts', label: 'Conflicts' },
];

/** The keymap editor behind F1 / Ctrl+K Ctrl+S: every command with its shortcuts; search by name or by pressing keys; record, add, remove, reset; presets, import and export. */
export function KeymapEditor() {
  const close = () => useUi.getState().setShortcutsOpen(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RowFilter>('assigned');
  const version = useCommandsVersion();
  const { rows, conflicts, bindings, titles, editedCount } = useMemo(() => {
    const all = buildKeymapRows();
    const flat: ShortcutBinding[] = all.flatMap((r) => r.bindings);
    return {
      rows: all,
      conflicts: findConflicts(),
      bindings: flat,
      titles: new Map(all.map((r) => [r.id, r.title])),
      editedCount: all.filter((r) => r.edited).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const [held, setHeld] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState<{ id: string; index: number } | null>(null);
  const [announce, setAnnounce] = useState('');
  const altGraph = useRef(false);
  const heldNow = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const state = useRef({ pending, recording, bindings, titles });
  state.current = { pending, recording, bindings, titles };

  const needle = q.trim().toLowerCase();
  // searching looks through every command, assigned or not
  const shown: RowFilter = needle && filter === 'assigned' ? 'all' : filter;
  const filtered = rows.filter((r) => rowMatches(r, needle) && rowInFilter(r, shown));
  const visible = useRef(filtered);
  visible.current = filtered;

  /** Follows the held modifier set: at once when released, after a short delay when pressed (AltGr, Shift+letter). */
  const holdModifiers = useCallback((mods: string) => {
    if (mods === heldNow.current) return;
    const before = heldNow.current.split('+');
    const grew = mods.split('+').some((m) => m && !before.includes(m));
    heldNow.current = mods;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // a new modifier starts a new question: drop the previous combination's selection
    if (grew) setFound(null);
    if (!mods) {
      setHeld('');
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      setHeld(mods);
      const n = bindingsWithModifiers(visible.current.flatMap((r) => r.bindings), mods).length;
      setAnnounce(hintAnnouncement(n, mods));
    }, HINT_DELAY_MS);
  }, []);

  const findStroke = useCallback((stroke: string) => {
    const { bindings: all, pending: prefix, titles: names } = state.current;
    const res = searchStroke(all, stroke, prefix);
    const nameOf = (list: ShortcutBinding[]) => [...new Set(list.map((b) => names.get(b.commandId) ?? getCommand(b.commandId)?.title ?? b.commandId))].join(', ');
    if (res.chords.length) {
      setPending(res.key);
      setFound(res.exact.length ? { key: res.key, bindings: res.exact } : null);
      const n = res.chords.length;
      setAnnounce(`${spokenShortcut(res.key)}: ${n} chord${n === 1 ? '' : 's'}, press the second key`);
      return;
    }
    setPending(null);
    setFound({ key: res.key, bindings: res.exact });
    setAnnounce(res.exact.length ? `${spokenShortcut(res.key)}: ${nameOf(res.exact)}` : `No shortcut uses ${spokenShortcut(res.key)}`);
    // a match hidden by the text filter: show the whole list again
    const onScreen = new Set(visible.current.flatMap((r) => r.bindings.map(bindingId)));
    if (res.exact.length && !res.exact.some((b) => onScreen.has(bindingId(b)))) {
      setQ('');
      setFilter('assigned');
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): boolean => {
      const { recording: rec, pending: prefix } = state.current;
      if (e.key === 'AltGraph') altGraph.current = true;
      if (e.key === 'Escape' && (rec || prefix)) {
        // Escape first ends recording / a half-typed chord; the next one closes the sheet
        e.preventDefault();
        e.stopPropagation();
        if (prefix) setPending(null);
        else setRecording(false);
        setAnnounce(prefix ? 'Chord cancelled' : 'Stopped recording keys');
        return true;
      }
      const intent = classifyKeyDown(e, {
        textField: inTextField(e.target), recording: rec, chordPending: !!prefix, altGraph: altGraph.current,
      });
      if (intent.kind === 'modifiers') {
        holdModifiers(intent.mods);
        return false;
      }
      if (intent.kind === 'pass') return false;
      // Look the keys up, never run them: no command, no native menu accelerator, no browser default (F5, Ctrl+P…).
      e.preventDefault();
      e.stopPropagation();
      findStroke(intent.stroke);
      return true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'AltGraph') altGraph.current = false;
      holdModifiers(altGraph.current ? '' : eventModifiers(e));
    };
    const reset = () => {
      altGraph.current = false;
      holdModifiers('');
    };
    const off = pushKeyCapture(onKeyDown);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', reset);
    return () => {
      off();
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', reset);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [holdModifiers, findStroke]);

  // Bring the first found command into view (instantly when the user asked for reduced motion).
  useEffect(() => {
    if (!found?.bindings.length) return;
    const el = bodyRef.current?.querySelector('.sheet-row.is-selected');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [found]);

  const hinted = useMemo(() => {
    if (pending) return new Set(bindings.filter((b) => b.key.startsWith(`${pending} `)).map(bindingId));
    if (held) return new Set(bindingsWithModifiers(bindings, held).map(bindingId));
    return null;
  }, [bindings, held, pending]);
  const selected = useMemo(() => new Set(found?.bindings.map(bindingId) ?? []), [found]);

  const groups = new Map<string, KeymapRow[]>();
  const order = (c: string) => (c === BUILTIN_CATEGORY ? 1 : 0);
  for (const r of [...filtered].sort((a, b) => order(a.category) - order(b.category) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title))) {
    if (!groups.has(r.category)) groups.set(r.category, []);
    groups.get(r.category)!.push(r);
  }
  const hintCount = hinted ? filtered.reduce((n, r) => n + r.bindings.filter((b) => hinted.has(bindingId(b))).length, 0) : 0;

  // ---- editing
  const finishEdit = useCallback((id: string, message: string) => {
    setEditing(null);
    setAnnounce(message);
    // focus goes back to the row it was started from
    setTimeout(() => {
      const row = [...document.querySelectorAll<HTMLElement>('.sheet-row')].find((el) => el.dataset.command === id);
      row?.querySelector<HTMLElement>('.sheet-chip, .sheet-add')?.focus();
    }, 0);
  }, []);

  const rowCommand = (id: string) => commandEntries().find((c) => c.id === id);
  const reset = (r: KeymapRow) => {
    const c = rowCommand(r.id);
    if (!c) return;
    commitKeybindings(withKeys(getKeybindingOverrides(), c, null));
    setAnnounce(`${r.title} is back to its default shortcut`);
  };
  const remove = (r: KeymapRow, index: number) => {
    const c = rowCommand(r.id);
    if (!c) return;
    commitKeybindings(unbindKey(getKeybindingOverrides(), c, index));
    setAnnounce(`Removed ${displayShortcut(r.bindings[index].key)} from ${r.title}`);
  };
  const startEdit = (id: string, index: number) => {
    setRecording(false);
    setPending(null);
    setFound(null);
    setEditing({ id, index });
  };

  const current = detectPreset(getKeybindingOverrides(), hasCommand);
  const presetOptions = [
    ...KEYMAP_PRESETS.map((p) => ({ value: p.id, label: p.name, title: p.description })),
    ...(current ? [] : [{ value: 'custom', label: 'Custom', title: 'Your own shortcuts' }]),
  ];
  const choosePreset = async (id: string) => {
    const preset = KEYMAP_PRESETS.find((p) => p.id === id);
    if (!preset || preset.id === current?.id) return;
    if (!current && !(await useUi.getState().askConfirm({
      title: `Switch to ${preset.name}?`,
      message: 'Your own shortcuts are replaced by this keymap. Export them first if you want to keep them.',
      confirmLabel: 'Switch keymap',
    }))) return;
    commitKeybindings(presetOverrides(preset, hasCommand));
    setEditing(null);
    setAnnounce(`Keymap: ${preset.name}`);
  };
  const resetAll = async () => {
    if (!editedCount) return;
    const ok = await useUi.getState().askConfirm({
      title: 'Reset all shortcuts?',
      message: `Every shortcut returns to the Rowlit default (${editedCount} changed command${editedCount === 1 ? '' : 's'}).`,
      confirmLabel: 'Reset all',
      danger: true,
    });
    if (!ok) return;
    commitKeybindings({});
    setEditing(null);
    setAnnounce('All shortcuts are back to their defaults');
  };
  const exportKeymap = async () => {
    try {
      const where = await getPlatform().saveFile({
        suggestedName: 'rowlit-keymap.json',
        content: serializeKeymap(getKeybindingOverrides()),
        mime: 'application/json',
        filters: [{ name: 'Rowlit keymap', extensions: ['json'] }],
      });
      if (where) toast('success', 'Keymap exported', where);
    } catch (e) {
      toast('error', 'Could not export the keymap', e instanceof Error ? e.message : String(e));
    }
  };
  const importKeymap = async () => {
    try {
      const file = await getPlatform().openTextFile({ filters: [{ name: 'Rowlit keymap', extensions: ['json'] }] });
      if (!file) return;
      const parsed = parseKeymapFile(file.content, hasCommand);
      if (!parsed.ok) {
        toast('error', 'Could not import the keymap', parsed.error);
        return;
      }
      const settled = settleImport(parsed.overrides, commandEntries());
      if (!current && !(await useUi.getState().askConfirm({
        title: 'Import this keymap?',
        message: `${file.name} replaces your own shortcuts.`,
        confirmLabel: 'Import',
      }))) return;
      commitKeybindings(settled.overrides);
      setEditing(null);
      const skipped = parsed.skipped + settled.dropped;
      toast('success', `Imported ${Object.keys(settled.overrides).length} changed command${Object.keys(settled.overrides).length === 1 ? '' : 's'}`, skipped ? `${skipped} entr${skipped === 1 ? 'y was' : 'ies were'} skipped (unknown command or conflicting key).` : undefined);
    } catch (e) {
      toast('error', 'Could not import the keymap', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog
      title={
        <span className="dialog-title-icon">
          <Keyboard size={16} /> Keyboard shortcuts
        </span>
      }
      ariaLabel="Keyboard shortcuts"
      onClose={close}
      width={880}
      className="shortcut-sheet"
    >
      <div className="search-box sheet-search">
        <Search size={14} />
        <input
          className="input borderless"
          placeholder={recording ? 'Press a key combination to find it (Esc to stop)' : `Search by command or key (e.g. “format” or “${displayShortcut('Mod+Shift')}”)`}
          aria-label="Search shortcuts"
          value={q}
          data-autofocus
          onChange={(e) => {
            setQ(e.target.value);
            setFound(null);
          }}
        />
        <button
          type="button"
          className={`search-toggle${recording ? ' on' : ''}`}
          aria-pressed={recording}
          aria-label="Record keys"
          title={recording ? 'Recording keys: every key press is looked up (Esc to stop)' : 'Record keys: look up any key press, plain keys too'}
          onClick={() => {
            setRecording((r) => !r);
            setPending(null);
            setFound(null);
            setEditing(null);
          }}
        >
          <CircleDot size={14} />
        </button>
      </div>
      <KeysBar held={held} pending={pending} found={found} recording={recording} hintCount={hintCount} titles={titles} />
      <div className="sheet-tools">
        <label className="sheet-preset">
          <span>Keymap</span>
          <Select
            aria-label="Keymap"
            size="sm"
            value={current?.id ?? 'custom'}
            options={presetOptions}
            onChange={(v) => void choosePreset(v)}
            title={current?.description ?? 'Your own shortcuts'}
          />
        </label>
        <div className="sheet-filters" role="group" aria-label="Show">
          {FILTERS.filter((f) => f.id !== 'conflicts' || conflicts.length > 0).map((f) => (
            <button key={f.id} type="button" className={`sheet-filter${filter === f.id ? ' on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id === 'edited' && editedCount > 0 ? <span className="sheet-filter-count">{editedCount}</span> : null}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button type="button" className="btn btn-xs" onClick={() => void importKeymap()} title="Replace your shortcuts with a keymap file">
          <Upload size={13} aria-hidden /> Import…
        </button>
        <button type="button" className="btn btn-xs" onClick={() => void exportKeymap()} title="Save your shortcuts to a file">
          <Download size={13} aria-hidden /> Export…
        </button>
        <button type="button" className="btn btn-xs" onClick={() => void resetAll()} disabled={!editedCount} title="Every shortcut back to the Rowlit default">
          <RotateCcw size={13} aria-hidden /> Reset all
        </button>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </div>
      {conflicts.length > 0 && (
        <div className="sheet-conflicts" role="alert">
          <TriangleAlert size={14} />
          {conflicts.length} shortcut conflict(s): {conflicts.map((c) => `${displayShortcut(c.key)} → ${c.commands.join(', ')}`).join('; ')}
        </div>
      )}
      <div ref={bodyRef} className={`sheet-body${hinted ? ' is-hinting' : ''}`} tabIndex={-1}>
        {groups.size === 0 && <div className="sheet-empty">{needle ? `No shortcut matches “${q}”.` : 'Nothing to show here.'}</div>}
        {[...groups.entries()].map(([cat, list]) => (
          <section key={cat} className="sheet-group">
            <h3>{cat}</h3>
            <dl>
              {list.map((r) => {
                const isSel = r.bindings.some((b) => selected.has(bindingId(b)));
                const isHint = !!hinted && r.bindings.some((b) => hinted.has(bindingId(b)));
                const isEditing = editing?.id === r.id;
                return (
                  <div
                    key={r.id}
                    className={`sheet-row${isSel ? ' is-selected' : ''}${isHint ? ' is-hint' : ''}${r.edited ? ' is-edited' : ''}${isEditing ? ' is-editing' : ''}`}
                    data-command={r.id}
                  >
                    <dt>
                      {r.title}
                      {SCOPE_LABEL[r.scope] ? <span className="sheet-scope">{SCOPE_LABEL[r.scope]}</span> : r.scope !== 'global' ? <span className="sheet-scope">in {r.scope}</span> : null}
                      {r.edited && (
                        <span className="sheet-edited" title={r.defaults.length ? `Default: ${r.defaults.map((k) => displayShortcut(k)).join(' or ')}` : 'Default: not assigned'}>
                          edited
                        </span>
                      )}
                      {r.conflicting && <TriangleAlert size={12} className="sheet-warn" aria-label="Conflicting shortcut" />}
                    </dt>
                    <dd>
                      {r.bindings.map((b, i) => {
                        const id = bindingId(b);
                        const cls = selected.has(id) ? ' is-selected' : hinted?.has(id) ? ' is-hint' : '';
                        return (
                          <span key={b.key} className={`sheet-binding${cls}`}>
                            {i > 0 && <span className="sheet-or">or</span>}
                            {r.editable ? (
                              <>
                                <button
                                  type="button"
                                  className="sheet-chip"
                                  aria-label={`Change ${displayShortcut(b.key)} for ${r.title}`}
                                  title="Change this shortcut"
                                  onClick={() => startEdit(r.id, i)}
                                >
                                  <Kbd shortcut={b.key} />
                                </button>
                                <button
                                  type="button"
                                  className="sheet-x"
                                  aria-label={`Remove ${displayShortcut(b.key)} from ${r.title}`}
                                  title="Remove this shortcut"
                                  onClick={() => remove(r, i)}
                                >
                                  <X size={11} />
                                </button>
                              </>
                            ) : (
                              <Kbd shortcut={b.key} />
                            )}
                          </span>
                        );
                      })}
                      {r.editable && !r.bindings.length && !isEditing && (
                        <button type="button" className="sheet-add on-empty" aria-label={`Assign a shortcut to ${r.title}`} onClick={() => startEdit(r.id, -1)}>
                          <Plus size={12} aria-hidden /> Assign
                        </button>
                      )}
                      {r.editable && r.bindings.length > 0 && r.bindings.length < 4 && (
                        <button type="button" className="sheet-add icon" aria-label={`Add another shortcut to ${r.title}`} title="Add another shortcut" onClick={() => startEdit(r.id, -1)}>
                          <Plus size={12} aria-hidden />
                        </button>
                      )}
                      {r.editable && r.bindings.length > 0 && (
                        <button type="button" className="sheet-add icon" aria-label={`Edit the shortcut of ${r.title}`} title="Change the shortcut" onClick={() => startEdit(r.id, 0)}>
                          <Pencil size={12} aria-hidden />
                        </button>
                      )}
                      {r.editable && r.edited && (
                        <button type="button" className="sheet-add icon" aria-label={`Reset ${r.title} to its default`} title="Back to the default" onClick={() => reset(r)}>
                          <RotateCcw size={12} aria-hidden />
                        </button>
                      )}
                      {!r.editable && r.lockedReason && (
                        <span className="sheet-lock" title={r.lockedReason}>
                          <Lock size={11} aria-label={r.lockedReason} />
                        </span>
                      )}
                      {isEditing && (
                        <Recorder
                          key={`${r.id}:${editing!.index}`}
                          row={r}
                          index={editing!.index}
                          onClose={(message) => finishEdit(r.id, message)}
                        />
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Records the new shortcut of one command: strokes, a live conflict report, and the way out (assign / replace / cancel). */
function Recorder({ row, index, onClose }: { row: KeymapRow; index: number; onClose: (message: string) => void }) {
  const [strokes, setStrokes] = useState<string[]>([]);
  const [held, setHeld] = useState('');
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const boxRef = useRef<HTMLDivElement>(null);
  const version = useCommandsVersion();
  const mac = isMac();

  const candidate = strokes.join(' ');
  const parsed = strokes.length ? parseShortcut(candidate, row.scope) : null;
  const ok = parsed?.ok ? parsed : null;
  const found = useMemo(() => (ok ? findKeyConflicts(ok.normalized, row.id, row.scope, keymapEntries()) : []), [ok?.normalized, row.id, row.scope, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const hard = found.filter((c) => c.kind !== 'other-scope');
  const soft = found.filter((c) => c.kind === 'other-scope');
  const warnings: string[] = [];
  if (ok) {
    warnings.push(...reservedWarnings(ok.normalized, { mac, browser: getPlatform().kind === 'browser' }));
    // a global command's key does not run while the code editor has focus when the editor keeps that key
    if ((row.scope === 'global' || row.scope === 'console') && !EDITOR_ACTION_COMMANDS.includes(row.id) && isEditorOwned(ok.normalized)) {
      const b = editorBuiltinFor(ok.normalized);
      warnings.push(`The code editor keeps ${displayShortcut(ok.normalized)}${b ? ` for “${b.title}”` : ''}, so this shortcut will not run while you are typing in it`);
    }
  }

  const assign = (replace: boolean, replaceScoped: boolean) => {
    if (!ok) return;
    const cmds = commandEntries();
    const next = bindKey(getKeybindingOverrides(), cmds, row.id, ok.canonical, { replace, replaceScoped, index: index >= 0 ? index : undefined });
    if (!next) return;
    commitKeybindings(next);
    const taken = replace ? [...hard, ...(replaceScoped ? soft : [])].map((c) => c.title) : [];
    onClose(`${row.title}: ${displayShortcut(ok.canonical)}${taken.length ? `, taken from ${[...new Set(taken)].join(', ')}` : ''}`);
  };
  const assignRef = useRef(assign);
  assignRef.current = assign;
  const stateRef = useRef({ ok, hard });
  stateRef.current = { ok, hard };

  useEffect(() => {
    boxRef.current?.focus();
    const handler = (e: KeyboardEvent): boolean => {
      const onButton = e.target instanceof Element && !!e.target.closest('.sheet-recorder button');
      const k = classifyRecorderKey(e, { strokes: strokesRef.current, onButton });
      if (k.kind === 'pass') return false;
      e.preventDefault();
      e.stopPropagation();
      switch (k.kind) {
        case 'cancel':
          onClose('Cancelled');
          break;
        case 'held':
          setHeld(k.mods);
          break;
        case 'stroke':
          setHeld('');
          setStrokes(nextStrokes(strokesRef.current, k.stroke));
          break;
        case 'back':
          setStrokes((s) => s.slice(0, -1));
          break;
        case 'accept': {
          const { ok: valid, hard: clashes } = stateRef.current;
          if (valid && !clashes.length) assignRef.current(false, false);
          break;
        }
        default:
          break;
      }
      return true;
    };
    const off = pushKeyCapture(handler);
    const up = (e: KeyboardEvent) => setHeld(eventModifiers(e));
    window.addEventListener('keyup', up, true);
    return () => {
      off();
      window.removeEventListener('keyup', up, true);
    };
    // the handler reads its state through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const names = (list: KeyConflict[]) => [...new Set(list.map((c) => c.title))].join(', ');
  let message: ReactNode;
  if (parsed && !parsed.ok) {
    message = <span className="sheet-rec-error" role="alert">{parsed.reason}</span>;
  } else if (ok && hard.length) {
    message = (
      <span className="sheet-rec-error" role="alert">
        {displayShortcut(ok.normalized)} {hard[0].kind === 'chord' ? 'clashes with the chord of' : 'is already used by'} {names(hard)}
        {hard[0].scope !== 'global' ? ` ${scopeText(hard[0].scope)}` : ''}
      </span>
    );
  } else if (ok && soft.length) {
    const otherGlobal = soft.every((c) => c.scope === 'global');
    message = (
      <span className="sheet-rec-note">
        {displayShortcut(ok.normalized)} is also used by {names(soft)}
        {otherGlobal ? ' everywhere else. Where this command applies it takes precedence.' : ` ${scopeText(soft[0].scope)}, where that command takes precedence.`}
      </span>
    );
  } else if (ok) {
    message = <span className="sheet-rec-note">Press Enter to assign, or another key combination to make a chord. Esc cancels.</span>;
  } else {
    message = <span className="sheet-rec-note">Press the new key combination. Backspace removes the last key, Esc cancels.</span>;
  }

  return (
    <div className="sheet-recorder" ref={boxRef} tabIndex={-1} role="group" aria-label={`New shortcut for ${row.title}`}>
      <div className="sheet-rec-keys" aria-hidden={strokes.length || held ? undefined : true}>
        {strokes.length ? <Caps shortcut={candidate} /> : held ? <Caps shortcut={held} more /> : <span className="sheet-rec-placeholder">Press keys…</span>}
      </div>
      <div className="sheet-rec-msg" aria-live="polite">
        {message}
        {warnings.map((w) => (
          <span key={w} className="sheet-rec-warn">
            <TriangleAlert size={12} aria-hidden /> {w}
          </span>
        ))}
      </div>
      <div className="sheet-rec-actions">
        {ok && hard.length > 0 ? (
          <button type="button" className="btn btn-xs btn-primary" onClick={() => assign(true, true)}>Replace</button>
        ) : ok && soft.length > 0 ? (
          <>
            <button type="button" className="btn btn-xs btn-primary" onClick={() => assign(false, false)} title="Both stay bound; the more specific place wins">Keep both</button>
            <button type="button" className="btn btn-xs" onClick={() => assign(true, true)}>Replace</button>
          </>
        ) : (
          <button type="button" className="btn btn-xs btn-primary" disabled={!ok} onClick={() => assign(false, false)}>Assign</button>
        )}
        <button type="button" className="btn btn-xs" onClick={() => onClose('Cancelled')}>Cancel</button>
      </div>
    </div>
  );
}

/** Key caps of a (partial) shortcut: "Ctrl + Alt + …" on Windows/Linux, "⌥⌘…" on macOS. */
function Caps({ shortcut, more }: { shortcut: string; more?: boolean }) {
  const mac = isMac();
  const caps = shortcutKeys(shortcut, mac);
  const out: ReactNode[] = [];
  caps.forEach((k, i) => {
    if (k === null) {
      out.push(<span key={i} className="kbd-chord-gap" />);
      return;
    }
    if (!mac && i > 0 && caps[i - 1] !== null) out.push(<span key={`p${i}`} className="sheet-keys-plus">+</span>);
    out.push(<kbd key={i}>{k}</kbd>);
  });
  if (more) {
    if (!mac && caps.length && caps[caps.length - 1] !== null) out.push(<span key="p-more" className="sheet-keys-plus">+</span>);
    out.push(<span key="more" className="sheet-keys-more">…</span>);
  }
  return (
    <span className="kbd-group sheet-keys-caps" aria-hidden="true">
      {out}
    </span>
  );
}

function KeysBar({ held, pending, found, recording, hintCount, titles }: { held: string; pending: string | null; found: Found | null; recording: boolean; hintCount: number; titles: Map<string, string> }) {
  const mac = isMac();
  let body: ReactNode;
  let state = 'idle';
  if (pending) {
    state = 'chord';
    body = (
      <>
        <Caps shortcut={pending} more />
        <span className="sheet-keys-text">press the second key ({hintCount} chord{hintCount === 1 ? '' : 's'})</span>
      </>
    );
  } else if (found) {
    state = 'found';
    const names = [...new Set(found.bindings.map((b) => titles.get(b.commandId) ?? getCommand(b.commandId)?.title ?? b.commandId))];
    body = (
      <>
        <Caps shortcut={found.key} />
        <span className={`sheet-keys-text${names.length ? ' is-result' : ''}`}>{names.length ? names.join(', ') : 'No command uses these keys'}</span>
      </>
    );
  } else if (held) {
    state = 'held';
    body = (
      <>
        <Caps shortcut={held} more />
        <span className="sheet-keys-text">
          {hintCount} shortcut{hintCount === 1 ? '' : 's'}
        </span>
      </>
    );
  } else {
    const mods = mac ? '⌘, ⌥, ⌃ or ⇧' : 'Ctrl, Alt or Shift';
    body = (
      <span className="sheet-keys-text">
        {recording ? 'Recording: press any key or combination to find it · Esc stops' : `Hold ${mods} to highlight its shortcuts · press a combination to find it`}
      </span>
    );
  }
  return (
    <div className="sheet-keys" data-state={state} aria-hidden={state === 'idle' ? undefined : true}>
      {body}
    </div>
  );
}
