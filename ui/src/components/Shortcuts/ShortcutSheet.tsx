import { lazy, Suspense } from 'react';
import { useUi } from '../../store/ui';

// The keymap editor (rows, recorder, presets, import / export) loads on first use; F1 / Ctrl+K Ctrl+S opens it.
const KeymapEditor = lazy(() => import('./KeymapEditor').then((m) => ({ default: m.KeymapEditor })));

/** F1 / Ctrl+K Ctrl+S: the Keyboard shortcuts dialog, where every shortcut can also be changed (KeymapEditor.tsx). */
export function ShortcutSheet() {
  const open = useUi((s) => s.shortcutsOpen);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <KeymapEditor />
    </Suspense>
  );
}
