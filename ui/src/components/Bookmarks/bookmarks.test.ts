import { describe, expect, it } from 'vitest';
import { useTabs } from '../../store/tabs';

describe('bookmark persistence', () => {
  it('normalizes lines and survives a workspace round trip', () => {
    const id = useTabs.getState().newConsole({ text: 'one\ntwo\nthree' });
    useTabs.getState().setBookmarks(id, [3, 1, 3, -1]);
    const saved = useTabs.getState().serialize();
    useTabs.setState({ tabs: [] });
    useTabs.getState().restore(saved);
    const tab = useTabs.getState().tabs.find((t) => t.id === id);
    expect(tab?.kind === 'console' ? tab.bookmarks : []).toEqual([1, 3]);
  });
});
