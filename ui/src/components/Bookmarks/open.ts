import { registerTabView } from '../layout/tabViews';
import { useTabs } from '../../store/tabs';
import { BookmarksTab } from './views';

const VIEW = 'bookmarks';
let registered = false;
export function openBookmarks(): string {
  if (!registered) { registered = true; registerTabView(VIEW, { component: BookmarksTab, icon: 'Bookmark' }); }
  return useTabs.getState().openView({ view: VIEW, title: 'Bookmarks', key: VIEW });
}
