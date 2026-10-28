// "Diff" tab of a compared object: Monaco DiffEditor of the target's current definition (left) against the source's
// (right: what the target becomes). Same options as the designer's "Compare with server" dialog.
import { useEffect, useRef } from 'react';
import { diffEditorOptions, plainBrackets } from '../../designer/compareOptions';
import { bindEditorFontSize } from '../../editor/fontZoom';
import * as monaco from '../../editor/monaco';
import { ensureMonacoSetup, LANGUAGE_IDS, THEME_IDS } from '../../editor/monaco-setup';
import { remeasureAfterFonts } from '../../editor/monacoOptions';
import type { Dialect } from '../../api/types';
import type { EffectiveTheme } from '../../theme/useTheme';

export interface ItemDiffProps {
  /** Left: the target's definition now (null: the object does not exist there). */
  targetDdl: string | null;
  /** Right: the source's definition (null: the object is dropped). */
  sourceDdl: string | null;
  dialect: string;
  theme: EffectiveTheme;
  targetLabel: string;
  sourceLabel: string;
}

export function ItemDiff({ targetDdl, sourceDdl, dialect, theme, targetLabel, sourceLabel }: ItemDiffProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    ensureMonacoSetup();
    const lang = LANGUAGE_IDS[dialect as Dialect] ?? 'sql';
    const original = monaco.editor.createModel(targetDdl ?? '', lang);
    const modified = monaco.editor.createModel(sourceDdl ?? '', lang);
    const diff = monaco.editor.createDiffEditor(host.current, diffEditorOptions(THEME_IDS[theme === 'dark' ? 'dark' : 'light']));
    diff.setModel({ original, modified });
    plainBrackets(original, modified);
    const unbindFont = bindEditorFontSize(diff, { suggest: false });
    remeasureAfterFonts();
    return () => {
      unbindFont();
      diff.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [targetDdl, sourceDdl, dialect, theme]);

  return (
    <div className="sc-diff-wrap">
      <div className="sc-diff-heads" aria-hidden="true">
        <span>Target now · {targetLabel}{targetDdl === null ? ' (does not exist)' : ''}</span>
        <span>Source · {sourceLabel}{sourceDdl === null ? ' (does not exist: dropped)' : ''}</span>
      </div>
      <div className="sc-diff" ref={host} data-testid="sc-diff" aria-label="Differences between the target and the source definition" />
    </div>
  );
}
