// The Diff tab mounts a Monaco DiffEditor: target definition on the left (original), source on the right (modified),
// with the designer's compare options, and disposes everything on unmount.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const models: { text: string; lang: string; dispose: ReturnType<typeof vi.fn> }[] = [];
  const diff = { setModel: vi.fn(), dispose: vi.fn(), updateOptions: vi.fn() };
  return {
    models, diff,
    createModel: vi.fn((text: string, lang: string) => {
      const model = { text, lang, dispose: vi.fn(), updateOptions: vi.fn() };
      models.push(model);
      return model;
    }),
    createDiffEditor: vi.fn(() => diff),
  };
});
vi.mock('../../../editor/monaco', () => ({ editor: { createModel: m.createModel, createDiffEditor: m.createDiffEditor } }));
vi.mock('../../../editor/monaco-setup', () => ({
  ensureMonacoSetup: vi.fn(), LANGUAGE_IDS: { pgsql: 'dbstudio-pgsql' }, THEME_IDS: { light: 'dbstudio-light', dark: 'dbstudio-dark' },
}));
vi.mock('../../../editor/monacoOptions', () => ({ remeasureAfterFonts: vi.fn(), baseMonacoOptions: () => ({ useShadowDOM: false }) }));
vi.mock('../../../editor/fontZoom', () => ({ bindEditorFontSize: vi.fn(() => () => {}) }));

import { ItemDiff } from '../ItemDiff';

describe('ItemDiff', () => {
  it('diffs the target (left) against the source (right) and cleans up', () => {
    const view = render(
      <ItemDiff targetDdl="CREATE VIEW v AS SELECT 1" sourceDdl={null} dialect="pgsql" theme="dark" targetLabel="Staging" sourceLabel="Shop" />,
    );
    expect(m.createModel).toHaveBeenNthCalledWith(1, 'CREATE VIEW v AS SELECT 1', 'dbstudio-pgsql');
    expect(m.createModel).toHaveBeenNthCalledWith(2, '', 'dbstudio-pgsql');
    expect(m.createDiffEditor).toHaveBeenCalledWith(view.getByTestId('sc-diff'), expect.objectContaining({ readOnly: true, renderSideBySide: true, theme: 'dbstudio-dark' }));
    expect(m.diff.setModel).toHaveBeenCalledWith({ original: m.models[0], modified: m.models[1] });
    expect(view.getByText(/does not exist: dropped/)).toBeInTheDocument();
    view.unmount();
    expect(m.diff.dispose).toHaveBeenCalled();
    expect(m.models.every((x) => x.dispose.mock.calls.length === 1)).toBe(true);
  });
});
