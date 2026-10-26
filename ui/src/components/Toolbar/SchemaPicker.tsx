// The schema picker (lazy chunk, SchemaPickerHost): a filterable list of the database's schemas for the console's
// schema pill. PostgreSQL / Snowflake: choosing one runs SET search_path / USE SCHEMA on the session. SQL Server cannot
// change a session's schema: the list sets the tab's "Editor schema" (completion, diagnostics, explorer reveal) only.
import { FolderTree, RotateCcw, Search, Telescope } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { switchSchema } from '../../app/actions';
import { fuzzyMatch } from '../../lib/fuzzy';
import { resolveScopeColor, useScopeColors } from '../../lib/scopeColors';
import { dbKey, useCatalog } from '../../store/catalog';
import { useConsoleSchema } from '../../store/consoleSchema';
import { useTabs, type ConsoleTab } from '../../store/tabs';
import { useUi } from '../../store/ui';
import { connColorCss } from '../../theme/connColors';
import { useRestoreFocus } from '../common/focus';
import { useExplorer } from '../Explorer/explorerStore';

interface Row {
  key: string;
  label: string;
  detail?: string;
  group: string;
  current: boolean;
  positions: number[];
  color?: string;
  icon?: 'reset' | 'reveal';
  run: () => void;
}

export function SchemaPicker() {
  const sw = useUi((s) => s.switcher)!;
  const close = () => useUi.getState().openSwitcher(null);
  const tab = useTabs((s) => s.tabs.find((t) => t.id === sw.tabId));
  if (!tab || tab.kind !== 'console') return null;
  return <Body tab={tab} close={close} anchor={sw.anchor ?? null} />;
}

function Body({ tab, close, anchor }: { tab: ConsoleTab; close: () => void; anchor: { left: number; top: number; bottom: number } | null }) {
  const s = useConsoleSchema(tab);
  const cid = tab.connectionId;
  const tabId = tab.id;
  const tabSchema = tab.schema;
  const schemasResp = useCatalog((c) => (cid ? c.dbs[dbKey(cid, s.catalogDb)]?.schemasResp : undefined));
  const colors = useScopeColors();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useRestoreFocus(true, boxRef);

  useEffect(() => {
    inputRef.current?.focus();
    if (cid) void useCatalog.getState().loadSchemas(cid, s.catalogDb);
  }, [cid, s.catalogDb]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth || 420;
    const left = anchor ? Math.min(Math.max(8, anchor.left), window.innerWidth - w - 8) : Math.max(8, (window.innerWidth - w) / 2);
    setPos({ left, top: anchor ? anchor.bottom + 4 : 64 });
  }, [anchor]);

  const readOnly = s.mode === 'readOnly';
  const rows = useMemo<Row[]>(() => {
    if (!cid) return [];
    const p = q.trim();
    const out: Row[] = [];
    const path = s.searchPath ?? [];
    for (const sch of schemasResp?.schemas ?? []) {
      const m = fuzzyMatch(p, sch.name);
      if (!m) continue;
      const onPath = path.findIndex((n) => n.toLowerCase() === sch.name.toLowerCase());
      out.push({
        key: sch.name, label: sch.name, group: readOnly ? 'Editor schema' : 'Schemas', current: sch.name === s.schema, positions: m.positions,
        detail: onPath > 0 ? 'on search_path' : sch.name === s.serverSchema && readOnly ? 'login default' : undefined,
        color: connColorCss(resolveScopeColor(colors, cid, s.catalogDb, sch.name) ?? undefined) ?? undefined,
        run: () => void switchSchema(tabId, sch.name),
      });
    }
    if (p) out.sort((a, b) => (fuzzyMatch(p, b.label)?.score ?? 0) - (fuzzyMatch(p, a.label)?.score ?? 0));
    if (!p) {
      if (readOnly ? !!tabSchema : true) {
        out.push({
          key: '__reset', label: readOnly ? 'Use the login’s default schema' : 'Reset to the session’s default', group: '', current: false, positions: [], icon: 'reset',
          run: () => void switchSchema(tabId, null),
        });
      }
      if (s.schema) {
        const schema = s.schema;
        out.push({
          key: '__reveal', label: `Show ${schema} in the Explorer`, group: '', current: false, positions: [], icon: 'reveal',
          run: () => {
            const d = s.catalogDb ?? '';
            useExplorer.getState().expandAll([`c:${cid}`, `d:${cid}:${d}`, `s:${cid}:${d}:${schema}`]);
            useUi.getState().showDock('explorer');
          },
        });
      }
    }
    return out;
  }, [q, cid, schemasResp, s.schema, s.serverSchema, s.searchPath, s.catalogDb, readOnly, tabId, tabSchema, colors]);

  useEffect(() => {
    const i = rows.findIndex((r) => r.current);
    setSel(q ? 0 : Math.max(0, i));
  }, [q, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    boxRef.current?.querySelector('.switcher-item.selected')?.scrollIntoView?.({ block: 'nearest' });
  }, [sel]);

  const choose = (i: number) => {
    const r = rows[i];
    if (!r) return;
    close();
    r.run();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(rows.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  };

  let lastGroup: string | null = null;
  return (
    <div className="overlay transparent" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={boxRef}
        className="switcher schema-picker"
        role="dialog"
        aria-modal="true"
        aria-label={readOnly ? 'Choose the editor schema' : 'Change schema'}
        style={{ left: pos.left, top: pos.top }}
        onKeyDown={onKeyDown}
      >
        <div className="switcher-search">
          <Search size={14} />
          <input
            ref={inputRef}
            className="input borderless"
            placeholder={readOnly ? 'Editor schema…' : 'Switch schema…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
            role="combobox"
            aria-expanded="true"
            aria-controls="schema-list"
            spellCheck={false}
          />
        </div>
        <div className="schema-picker-note" role="note">
          {readOnly ? (
            <>
              SQL Server uses the login’s default schema{s.serverSchema ? <> (<b>{s.serverSchema}</b>)</> : null} for unqualified names; it cannot be changed per
              session. Qualify names, or change the user’s default schema. Choosing a schema here sets the <b>editor schema</b>: completion,
              diagnostics and the explorer follow it, the server does not.
            </>
          ) : s.schema ? (
            <>
              Unqualified names resolve to <b>{s.schema}</b>
              {s.searchPath && s.searchPath.length > 1 ? <> (search_path: {s.searchPath.join(', ')})</> : null}.
            </>
          ) : (
            <>Choose the schema unqualified names resolve to.</>
          )}
        </div>
        <div className="switcher-list" id="schema-list" role="listbox">
          {rows.length === 0 && <div className="switcher-empty">{schemasResp ? 'No matching schemas' : 'Loading…'}</div>}
          {rows.map((r, i) => {
            const header = r.group !== lastGroup && r.group ? r.group : null;
            lastGroup = r.group;
            return (
              <div key={r.key}>
                {header && <div className="switcher-group">{header}</div>}
                {r.key === '__reset' && <div className="menu-sep" />}
                <div
                  role="option"
                  aria-selected={i === sel}
                  className={`switcher-item${i === sel ? ' selected' : ''}${r.current ? ' current' : ''}`}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(i);
                  }}
                >
                  {r.icon === 'reset' ? <RotateCcw size={16} strokeWidth={1.5} /> : r.icon === 'reveal' ? <Telescope size={16} strokeWidth={1.5} /> : <FolderTree size={16} strokeWidth={1.5} />}
                  {r.color && <span className="scope-dot" style={{ ['--scope-color' as string]: r.color }} aria-hidden="true" />}
                  <span className="switcher-label">{highlight(r.label, r.positions)}</span>
                  {r.detail && <span className="switcher-detail">{r.detail}</span>}
                  {r.current && <span className="switcher-current">{readOnly ? 'editor' : 'current'}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function highlight(text: string, positions: number[]) {
  if (!positions.length) return text;
  const set = new Set(positions);
  return [...text].map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>));
}
