// Recording a shortcut in the Keyboard shortcuts dialog: what a keydown means while a binding is being captured.
// Framework-free so the rules (chords, AltGr, macOS modifiers, accept / cancel) are unit-tested on their own.
import { eventStroke, isAltGraphCharacter, isMac, isModifierOnly } from '../../commands/keys';
import { eventModifiers, type KeyEventLike } from './keySearch';

export type RecorderKey =
  /** Escape: stop recording without changing anything. */
  | { kind: 'cancel' }
  /** Plain Enter after a combination: take it. */
  | { kind: 'accept' }
  /** Plain Backspace / Delete: drop the last stroke. */
  | { kind: 'back' }
  /** A modifier went down: the held set to show ("" = none). */
  | { kind: 'held'; mods: string }
  /** A combination (normalised stroke). */
  | { kind: 'stroke'; stroke: string }
  /** AltGr produced a character, or an IME is composing: not a shortcut, nothing recorded. */
  | { kind: 'ignore' }
  /** Not ours: Tab / Enter / Space on a dialog button keep their meaning. */
  | { kind: 'pass' };

export interface RecorderContext {
  /** The strokes recorded so far. */
  strokes: readonly string[];
  /** Focus is on a button of the recorder (Assign / Replace / Cancel). */
  onButton: boolean;
}

/** The meaning of one keydown while recording. `mac`: ⌘ is Mod, ⌃ is MacCtrl, ⌥ is Alt. */
export function classifyRecorderKey(e: KeyEventLike, ctx: RecorderContext, mac = isMac()): RecorderKey {
  if (e.isComposing) return { kind: 'ignore' };
  if (!mac && e.key === 'AltGraph') return { kind: 'ignore' };
  const stroke = eventStroke(e);
  if (isModifierOnly(stroke)) return { kind: 'held', mods: eventModifiers(e, mac) };
  // AltGr+L types "ł": a character, not Ctrl+Alt+L.
  if (isAltGraphCharacter(e, mac)) return { kind: 'ignore' };
  const recorded = ctx.strokes.length > 0;
  if (stroke === 'escape') return { kind: 'cancel' };
  if (ctx.onButton && (stroke === 'enter' || stroke === 'space')) return { kind: 'pass' };
  // Tab walks to the buttons once there is something to confirm; before that it is a key like any other.
  if (recorded && (stroke === 'tab' || stroke === 'shift+tab')) return { kind: 'pass' };
  if (recorded && stroke === 'enter') return { kind: 'accept' };
  if (recorded && (stroke === 'backspace' || stroke === 'delete')) return { kind: 'back' };
  return { kind: 'stroke', stroke };
}

/** The strokes after one more: a third stroke starts a new shortcut (a chord has two). */
export function nextStrokes(strokes: readonly string[], stroke: string): string[] {
  return strokes.length >= 2 ? [stroke] : [...strokes, stroke];
}
