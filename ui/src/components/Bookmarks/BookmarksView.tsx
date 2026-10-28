import { Bookmark, Trash2 } from 'lucide-react';
import type { TabViewProps } from '../layout/tabViews';
import { getEditor } from '../../app/editors';
import { useTabs } from '../../store/tabs';
import { replaceBookmarks } from '../../editor/bookmarks';
import { shortcutLabelOf } from '../../commands/registry';
import './bookmarks.css';

export function BookmarksView({ visible }: TabViewProps) {
  const tabs = useTabs((s) => s.tabs);
  const activate = useTabs((s) => s.activate);
  if (!visible) return null;
  const toggleShortcut = shortcutLabelOf('editor.toggleBookmark');
  const rows = tabs.flatMap((t) => t.kind === 'console' ? (t.bookmarks ?? []).map((line, i) => ({ tab: t, line, number: i + 1, preview: t.text.split(/\r?\n/)[line - 1]?.trim() || '(empty line)' })) : []);
  return <div className="bookmarks-view"><header><Bookmark size={17}/><div><h2>Bookmarks</h2><p>Saved with this workspace</p></div></header>{rows.length ? <div className="bookmarks-list">{rows.map((r) => <div className="bookmarks-row" key={`${r.tab.id}:${r.line}`}><button onClick={() => { activate(r.tab.id); setTimeout(() => getEditor(r.tab.id)?.revealLine(r.line), 0); }}><b>{r.number}</b><span><strong>{r.tab.title} · line {r.line}</strong><em>{r.preview}</em></span></button><button className="icon-btn" aria-label="Remove bookmark" onClick={() => replaceBookmarks(r.tab.id, (r.tab.bookmarks ?? []).filter((n) => n !== r.line))}><Trash2 size={13}/></button></div>)}</div> : <div className="workspace-missing"><Bookmark size={24}/><p>No bookmarks yet.</p><span>Use {toggleShortcut ?? 'the Toggle bookmark command'} in a console.</span></div>}</div>;
}
