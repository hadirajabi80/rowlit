// The text editor of the value viewer. Monaco loads lazily (its own chunk, only when someone edits a value); until
// then, and under the unit tests (jsdom), a textarea with the same props stands in.
import { lazy, Suspense } from 'react';
import type { EffectiveTheme } from '../../../theme/useTheme';
import type { Problem } from './modes';

export interface EditorViewProps {
  value: string;
  onChange(value: string): void;
  language: 'text' | 'json' | 'xml';
  ariaLabel: string;
  theme: EffectiveTheme;
  /** Marked in the text (at its line and column when known). */
  problem?: Problem | null;
  /** Ctrl+Enter. */
  onSubmit?(): void;
  autoFocus?: boolean;
}

const MonacoEditor = lazy(() => import('./MonacoEditor'));
const IS_TEST = import.meta.env.MODE === 'test';

function TextareaEditor(p: EditorViewProps) {
  return (
    <textarea
      className="input cell-viewer-textarea"
      aria-label={p.ariaLabel}
      value={p.value}
      spellCheck={false}
      autoFocus={p.autoFocus}
      onChange={(e) => p.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          p.onSubmit?.();
        }
      }}
    />
  );
}

export function EditorView(p: EditorViewProps) {
  if (IS_TEST) return <TextareaEditor {...p} />;
  return (
    <Suspense fallback={<TextareaEditor {...p} />}>
      <MonacoEditor {...p} />
    </Suspense>
  );
}
