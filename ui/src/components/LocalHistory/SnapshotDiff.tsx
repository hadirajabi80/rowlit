// Side-by-side Monaco diff of a snapshot (left) against the editor's current text (right). The only Monaco user of the
// local history chunk; the view mounts it lazily-by-chunk and tests replace the module.
import { useEffect, useRef } from 'react';
import type { Dialect } from '../../api/types';
import { diffEditorOptions, plainBrackets } from '../../designer/compareOptions';
import { bindEditorFontSize } from '../../editor/fontZoom';
import * as monaco from '../../editor/monaco';
import { ensureMonacoSetup, LANGUAGE_IDS, THEME_IDS } from '../../editor/monaco-setup';
import { remeasureAfterFonts } from '../../editor/monacoOptions';
import type { EffectiveTheme } from '../../theme/useTheme';

export interface SnapshotDiffProps {
  snapshot: string;
  current: string;
  dialect: Dialect;
  theme: EffectiveTheme;
  ariaLabel: string;
}

export default function SnapshotDiff({ snapshot, current, dialect, theme, ariaLabel }: SnapshotDiffProps) {
  const host = useRef<HTMLDivElement>(null);
  const models = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    ensureMonacoSetup();
    const lang = LANGUAGE_IDS[dialect];
    const original = monaco.editor.createModel('', lang);
    const modified = monaco.editor.createModel('', lang);
    const diff = monaco.editor.createDiffEditor(host.current, diffEditorOptions(THEME_IDS[theme]));
    diff.setModel({ original, modified });
    plainBrackets(original, modified);
    const unbindFont = bindEditorFontSize(diff, { suggest: false });
    remeasureAfterFonts();
    models.current = { original, modified };
    return () => {
      unbindFont();
      diff.dispose();
      original.dispose();
      modified.dispose();
      models.current = null;
    };
    // rebuilt only for another language or theme; the texts update in place below
  }, [dialect, theme]);

  useEffect(() => {
    const m = models.current;
    if (!m) return;
    if (m.original.getValue() !== snapshot) m.original.setValue(snapshot);
    if (m.modified.getValue() !== current) m.modified.setValue(current);
  }, [snapshot, current, dialect, theme]);

  return <div className="lh-diff" ref={host} role="group" aria-label={ariaLabel} />;
}
