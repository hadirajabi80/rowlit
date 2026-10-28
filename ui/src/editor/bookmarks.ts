import type * as monaco from './monaco';
import { useTabs } from '../store/tabs';

type Editor = monaco.editor.IStandaloneCodeEditor;
type Controller = { toggle(): void; next(delta: 1 | -1): void; lines(): number[]; replace(lines: number[]): void; dispose(): void };
const controllers = new Map<string, Controller>();

const options = (number: number): monaco.editor.IModelDeltaDecoration['options'] => ({
  isWholeLine: true,
  glyphMarginClassName: `editor-bookmark-glyph editor-bookmark-${Math.min(number, 9)}`,
  glyphMarginHoverMessage: { value: `Bookmark ${number}` },
  stickiness: 1,
});

export function installBookmarks(tabId: string, editor: Editor): () => void {
  const model = editor.getModel();
  if (!model) return () => {};
  let ids: string[] = [];
  let updating = false;

  const currentLines = () => ids.map((id) => model.getDecorationRange(id)?.startLineNumber ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const paint = (lines: number[]) => {
    updating = true;
    ids = editor.deltaDecorations(ids, lines.map((line, i) => ({ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: options(i + 1) })));
    updating = false;
  };
  const save = () => {
    if (updating) return;
    const lines = currentLines();
    useTabs.getState().setBookmarks(tabId, lines);
    paint(lines);
  };
  const initial = useTabs.getState().tabs.find((t) => t.id === tabId && t.kind === 'console');
  paint(initial?.kind === 'console' ? (initial.bookmarks ?? []).filter((n) => n <= model.getLineCount()) : []);

  const controller: Controller = {
    toggle() {
      const line = editor.getPosition()?.lineNumber ?? 1;
      const lines = currentLines();
      const at = lines.indexOf(line);
      if (at >= 0) lines.splice(at, 1); else lines.push(line);
      lines.sort((a, b) => a - b);
      useTabs.getState().setBookmarks(tabId, lines);
      paint(lines);
      editor.focus();
    },
    next(delta) {
      const lines = currentLines();
      if (!lines.length) return;
      const line = editor.getPosition()?.lineNumber ?? 1;
      const target = delta > 0 ? (lines.find((n) => n > line) ?? lines[0]) : ([...lines].reverse().find((n) => n < line) ?? lines.at(-1)!);
      editor.revealLineInCenterIfOutsideViewport(target);
      editor.setPosition({ lineNumber: target, column: 1 });
      editor.focus();
    },
    replace(lines) {
      const clean = [...new Set(lines.filter((n) => n > 0 && n <= model.getLineCount()))].sort((a, b) => a - b);
      useTabs.getState().setBookmarks(tabId, clean);
      paint(clean);
    },
    lines: currentLines,
    dispose() { ids = editor.deltaDecorations(ids, []); },
  };
  controllers.get(tabId)?.dispose();
  controllers.set(tabId, controller);
  const sub = model.onDidChangeContent(save);
  return () => { sub.dispose(); controller.dispose(); if (controllers.get(tabId) === controller) controllers.delete(tabId); };
}

export const toggleBookmark = (tabId: string) => controllers.get(tabId)?.toggle();
export const navigateBookmark = (tabId: string, delta: 1 | -1) => controllers.get(tabId)?.next(delta);
export function replaceBookmarks(tabId: string, lines: number[]): void {
  const controller = controllers.get(tabId);
  if (controller) controller.replace(lines); else useTabs.getState().setBookmarks(tabId, lines);
}

export function bookmarkLines(tabId: string): number[] {
  return controllers.get(tabId)?.lines() ?? (useTabs.getState().tabs.find((t) => t.id === tabId && t.kind === 'console') as { bookmarks?: number[] } | undefined)?.bookmarks ?? [];
}
