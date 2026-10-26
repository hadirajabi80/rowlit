// The query builder tab (view 'links.builder'): tables of a linked database on a canvas, joins drawn between columns,
// the output, filters, grouping, sort and limit in the bottom panel, the SQL on the right (or edited by hand in
// Advanced mode), Run in the tab's own session on the link with the results in the normal ResultsPane.
import {
  CircleStop, DatabaseZap, Maximize2, Network, Pencil, Play, Redo2, RefreshCw, Save, SquareTerminal, Undo2, Workflow, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { linksApi, type BuilderJoinType, type BuilderModel, type BuilderTable, type LinkedView } from '../../../api/links';
import { newConsole } from '../../../app/actions';
import { contextMenuEntries } from '../../../commands/menuModel';
import { displayShortcut } from '../../../commands/keys';
import { getCommand, keyHint, runCommand } from '../../../commands/registry';
import { useCommandContext } from '../../../commands/useCommands';
import { inlineParams } from '../../../filter/sql';
import { formatCount } from '../../../lib/format';
import type { RowlitObjectDrag } from '../../../lib/dragObject';
import { useConnection } from '../../../store/connections';
import { useLinks } from '../../../store/links';
import { useTabExecution } from '../../../store/results';
import { isRunning } from '../../../store/resultsReducer';
import { useSavedQueries } from '../../../store/savedQueries';
import { useSessions } from '../../../store/sessions';
import { useTabs, type ViewTab } from '../../../store/tabs';
import { toast, useUi } from '../../../store/ui';
import { showContextMenu } from '../../common/Menu';
import { Splitter } from '../../common/Splitter';
import { commandMenuItems } from '../../layout/commandMenu';
import type { TabViewProps } from '../../layout/tabViews';
import { ResultsPane } from '../../ResultsPane/ResultsPane';
import { cancelBuilderQuery, refreshSources, runBuilderQuery } from './actions';
import { BottomPanel } from './BottomPanel';
import type { CardColumnState } from './BuilderCard';
import { Canvas, type CanvasHandle } from './Canvas';
import { builderCatalogOf, columnsOf, memberColor, tableOf } from './catalog';
import { compileBuilder } from './compile';
import { registerBuilder, type BuilderController } from './controller';
import { cardSize, placeCard, type CardSize } from './geometry';
import { autoJoinFor, suggestJoins, type JoinSuggestion } from './infer';
import { JoinPopover } from './JoinPopover';
import * as M from './model';
import type { BottomTab, BuilderTabState } from './model';
import { PlanDialog } from './PlanDialog';
import { SaveViewDialog, type SaveViewValue } from './SaveViewDialog';
import { SqlPanel } from './SqlPanel';
import { TableList, type TableListHandle } from './TableList';
import './builder.css';

interface LightState extends BuilderTabState {
  pendingAdd?: { alias: string; table: string }[];
  /** The SQL Advanced mode started from (unchanged → back to the builder without parsing). */
  sqlBase?: string | null;
  inline?: boolean;
}

const tabState = (id: string): LightState | null => {
  const t = useTabs.getState().tabs.find((x): x is ViewTab => x.kind === 'view' && x.id === id);
  return (t?.state as LightState | undefined) ?? null;
};

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function BuilderView({ tab, theme, visible }: TabViewProps) {
  useCommandContext();
  const st = (tab.state ?? {}) as LightState;
  const linkId = st.linkId ?? tab.connectionId ?? '';
  const link = useConnection(linkId);
  const model = useMemo(() => M.normalizeModel(st.model), [st.model]);
  const mode = st.mode ?? 'builder';
  const entry = useLinks((s) => s.catalogs[linkId]);
  const catalog = entry?.catalog ?? null;
  const history = useLinks((s) => s.history[tab.id]);
  const exec = useTabExecution(tab.id);
  const running = isRunning(exec);
  const canvasRef = useRef<CanvasHandle>(null);
  const listRef = useRef<TableListHandle>(null);
  const [activeJoin, setActiveJoin] = useState<string | null>(null);
  const [joinAnchor, setJoinAnchor] = useState<DOMRect | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [parsing, setParsing] = useState(false);
  const [zoom, setZoom] = useState(1);
  /** Transient note on the canvas ("Joined orders.customer_id = customers.id · Undo"). */
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  const [filterFocus, setFilterFocus] = useState<{ column: string | null; nonce: number } | null>(null);
  const [sizesUi, setSizesUi] = useState({ list: st.listWidth ?? 220, sql: st.sqlWidth ?? 340, panel: st.panelHeight ?? 250 });
  const panel: BottomTab = st.panel ?? 'columns';

  useEffect(() => {
    if (linkId) void useLinks.getState().loadCatalog(linkId);
  }, [linkId]);

  // ---------------------------------------------------------------- state plumbing
  const patch = useCallback((p: Partial<LightState>) => {
    const cur = tabState(tab.id) ?? st;
    useTabs.getState().updateView(tab.id, { state: { ...cur, ...p } });
  }, [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentModel = useCallback(() => M.normalizeModel(tabState(tab.id)?.model), [tab.id]);

  /** Applies a model change (one undo step; `key` merges quick edits of one field). */
  const apply = useCallback((fn: (m: BuilderModel) => BuilderModel, key?: string) => {
    const prev = currentModel();
    const next = fn(prev);
    if (next === prev) return;
    useLinks.getState().record(tab.id, prev, key ?? null);
    patch({ model: next });
  }, [currentModel, patch, tab.id]);

  const undo = useCallback(() => {
    const prev = useLinks.getState().undo(tab.id, currentModel());
    if (prev) patch({ model: prev });
  }, [tab.id, currentModel, patch]);
  const redo = useCallback(() => {
    const next = useLinks.getState().redo(tab.id, currentModel());
    if (next) patch({ model: next });
  }, [tab.id, currentModel, patch]);

  // ---------------------------------------------------------------- derived
  const bcat = useMemo(() => builderCatalogOf(catalog), [catalog]);
  const compiled = useMemo(() => compileBuilder(model, bcat), [model, bcat]);
  const sizes = useMemo(() => {
    const out = new Map<string, CardSize>();
    for (const t of model.tables) out.set(t.id, cardSize(t, columnsOf(catalog, t).map((c) => ({ name: c.name, type: c.sourceType }))));
    return out;
  }, [model.tables, catalog]);
  const missing = useMemo(() => new Set(entry?.status === 'ready' ? model.tables.filter((t) => !tableOf(catalog, t.alias, t.table)).map((t) => t.id) : []), [model.tables, catalog, entry?.status]);
  const columnStates = useMemo(() => {
    const filtered = new Set<string>();
    const walk = (n: NonNullable<BuilderModel['filter']> | NonNullable<BuilderModel['filter']>['items'][number]) => {
      if (n.kind === 'condition') filtered.add(n.column);
      else n.items.forEach(walk);
    };
    if (model.filter) walk(model.filter);
    const joined = new Set<string>();
    for (const j of model.joins) for (const c of j.on) {
      joined.add(`${j.left}.${c.leftColumn}`);
      joined.add(`${j.right}.${c.rightColumn}`);
    }
    const out = new Map<string, Map<string, CardColumnState>>();
    for (const t of model.tables) {
      const m = new Map<string, CardColumnState>();
      for (const c of columnsOf(catalog, t)) {
        const cols = model.columns.filter((x) => x.tableId === t.id && x.column === c.name && !x.expr);
        const sort = model.sort.find((s) => (s.ref.tableId === t.id && s.ref.column === c.name) || (!!s.ref.columnId && cols.some((x) => x.id === s.ref.columnId)));
        m.set(c.name, {
          selected: cols.some((x) => x.output !== false), agg: cols.find((x) => x.agg)?.agg ?? null, sort: sort?.dir ?? null,
          filtered: filtered.has(`${t.id}.${c.name}`), joined: joined.has(`${t.id}.${c.name}`),
        });
      }
      out.set(t.id, m);
    }
    return out;
  }, [model, catalog]);
  const suggestions = useMemo(() => suggestJoins(model, catalog).filter((s) => s.score >= 50 && !M.connected(model, s.fromTable, s.toTable)).slice(0, 4), [model, catalog]);
  const onCanvas = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of model.tables) m.set(`${t.alias}.${t.table}`, (m.get(`${t.alias}.${t.table}`) ?? 0) + 1);
    return m;
  }, [model.tables]);

  const runnableSql = mode === 'sql' ? (st.sql ?? '') : compiled.sql;
  const runParams = mode === 'sql' ? [] : compiled.params;

  // ---------------------------------------------------------------- tables
  const addTables = useCallback((items: { alias: string; table: string }[], at?: { x: number; y: number }) => {
    if (!items.length) return;
    const cat = useLinks.getState().catalogs[linkId]?.catalog ?? null;
    const prev = currentModel();
    let m = prev;
    const joinedMsgs: string[] = [];
    const sizeOf = (t: BuilderTable) => cardSize(t, columnsOf(cat, t).map((c) => ({ name: c.name, type: c.sourceType })));
    items.forEach((it, i) => {
      const placed = m.tables.map((t) => ({ id: t.id, x: t.x, y: t.y, ...sizeOf(t) }));
      const r = M.addTable(m, it.alias, it.table, at && i === 0 ? at : { x: 0, y: 0 });
      m = r.model;
      const s = autoJoinFor(m, cat, r.id);
      if (!(at && i === 0)) {
        // next to the table it joins, else after the others (rows wrap)
        const partner = s ? (s.fromTable === r.id ? s.toTable : s.fromTable) : null;
        const me = sizeOf(m.tables.find((t) => t.id === r.id)!);
        const pos = placeCard(placed, me.w, Math.min(me.h, 240), placed.find((c) => c.id === partner) ?? null);
        m = M.moveTable(m, r.id, pos.x, pos.y);
      }
      if (s && s.fromColumns.length && s.fromColumns.length === s.toColumns.length) {
        let jm = m;
        for (let k = 0; k < s.fromColumns.length; k++) {
          const c = M.connect(jm, s.fromTable, s.fromColumns[k], s.toTable, s.toColumns[k]);
          jm = c.model;
        }
        if (jm !== m) {
          const ft = jm.tables.find((t) => t.id === s.fromTable);
          const tt = jm.tables.find((t) => t.id === s.toTable);
          joinedMsgs.push(`${ft?.as}.${s.fromColumns.join(', ')} = ${tt?.as}.${s.toColumns.join(', ')} (${s.label})`);
          m = jm;
        }
      }
    });
    if (m === prev) return;
    useLinks.getState().record(tab.id, prev, null);
    patch({ model: m, panel: tabState(tab.id)?.panel === 'results' ? 'columns' : tabState(tab.id)?.panel });
    if (joinedMsgs.length) setNotice({ text: `Joined ${joinedMsgs.join(' · ')}`, at: Date.now() });
    const last = m.tables[m.tables.length - 1];
    requestAnimationFrame(() => {
      canvasRef.current?.reveal(last.id);
      canvasRef.current?.focusTable(last.id);
    });
  }, [currentModel, linkId, patch, tab.id]);

  // tables requested before the view mounted (explorer "Add to query builder")
  useEffect(() => {
    if (!st.pendingAdd?.length || entry?.status !== 'ready') return;
    const items = st.pendingAdd;
    patch({ pendingAdd: [] });
    addTables(items);
  }, [st.pendingAdd, entry?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDropObject = useCallback((d: RowlitObjectDrag, world: { x: number; y: number }) => {
    if (d.connectionId === linkId && d.schema) {
      addTables([{ alias: d.schema, table: d.name }], world);
      return;
    }
    // a table of a member connection: find where the link mounts it
    const cat = useLinks.getState().catalogs[linkId]?.catalog;
    const s = cat?.schemas.find((x) => x.connectionId === d.connectionId && (!d.schema || !x.tables.length || x.tables.some((t) => (t.schema ?? '') === (d.schema ?? t.schema ?? ''))));
    const t = s?.tables.find((x) => x.name === d.name && (!d.schema || !x.schema || x.schema === d.schema));
    if (s && t) {
      addTables([{ alias: s.alias, table: t.linkName }], world);
      return;
    }
    toast('info', `${d.name} is not part of “${link?.name ?? 'this link'}”`, 'Add it to the link first; it then appears in the list on the left.', getCommand('links.addTable')
      ? { label: 'Add to link…', run: () => void runCommand('links.addTable', { connectionId: d.connectionId, database: d.database, schema: d.schema, name: d.name, type: d.type }) }
      : { label: 'Edit link…', run: () => void runCommand('links.edit', { connectionId: linkId }) });
  }, [addTables, link?.name, linkId]);

  // ---------------------------------------------------------------- joins
  const openJoin = useCallback((joinId: string) => {
    setActiveJoin(joinId);
    requestAnimationFrame(() => setJoinAnchor(canvasRef.current?.joinRect(joinId) ?? null));
  }, []);
  const onConnect = useCallback((ft: string, fc: string, tt: string, tc: string) => {
    const prev = currentModel();
    const r = M.connect(prev, ft, fc, tt, tc);
    if (!r.joinId) {
      if ('reason' in r && r.reason === 'cycle') toast('info', 'These tables are already joined through another table', 'A query joins each table once. Remove a join first, or add the condition to the existing join.');
      return;
    }
    if (r.model !== prev) {
      useLinks.getState().record(tab.id, prev, null);
      patch({ model: r.model });
    }
    openJoin(r.joinId);
  }, [currentModel, openJoin, patch, tab.id]);
  const acceptSuggestion = useCallback((s: JoinSuggestion) => {
    apply((m) => {
      let n = m;
      for (let k = 0; k < Math.min(s.fromColumns.length, s.toColumns.length); k++) n = M.connect(n, s.fromTable, s.fromColumns[k], s.toTable, s.toColumns[k]).model;
      return n;
    });
  }, [apply]);

  // ---------------------------------------------------------------- run, mode, save, plan
  const run = useCallback(() => {
    const cur = tabState(tab.id);
    const sql = (cur?.mode ?? 'builder') === 'sql' ? cur?.sql ?? '' : compiled.sql;
    const params = (cur?.mode ?? 'builder') === 'sql' ? [] : compiled.params;
    patch({ panel: 'results' });
    void runBuilderQuery(tab.id, linkId, sql, params, tab.title);
  }, [compiled, linkId, patch, tab.id, tab.title]);
  const cancel = useCallback(() => void cancelBuilderQuery(tab.id), [tab.id]);

  const toggleMode = useCallback(async () => {
    const cur = tabState(tab.id) ?? st;
    if ((cur.mode ?? 'builder') === 'builder') {
      const sql = inlineParams(compiled.sql, compiled.params, 'duckdb');
      patch({ mode: 'sql', sql, sqlBase: sql });
      return;
    }
    const sql = cur.sql ?? '';
    if (sql === cur.sqlBase || !sql.trim()) {
      patch({ mode: 'builder' });
      return;
    }
    setParsing(true);
    let reason: string | null = null;
    try {
      const r = await linksApi.parse(linkId, { sql });
      if (r.model) {
        const parsed = M.normalizeModel(r.model);
        const prev = currentModel();
        // keep the cards where the user put them
        const tables = parsed.tables.map((t) => {
          const old = prev.tables.find((o) => o.alias === t.alias && o.table === t.table && o.as === t.as) ?? prev.tables.find((o) => o.alias === t.alias && o.table === t.table);
          return old ? { ...t, x: old.x, y: old.y, collapsed: old.collapsed } : t;
        });
        useLinks.getState().record(tab.id, prev, null);
        patch({ mode: 'builder', model: { ...parsed, tables }, sql: null, sqlBase: null });
        return;
      }
      reason = r.reason ?? 'It uses SQL the builder cannot show.';
    } catch (e) {
      reason = errorMessage(e);
    } finally {
      setParsing(false);
    }
    const ok = await useUi.getState().askConfirm({
      title: 'This SQL cannot be shown in the builder',
      message: `${reason}\n\nGo back to the builder anyway? Your SQL edits are lost (the builder keeps the query it had).`,
      confirmLabel: 'Discard SQL edits',
    });
    if (ok) patch({ mode: 'builder', sql: null, sqlBase: null });
  }, [compiled, currentModel, linkId, patch, st, tab.id]);

  const discardSql = useCallback(() => patch({ mode: 'builder', sql: null, sqlBase: null }), [patch]);

  const inlinedSql = mode === 'sql' ? st.sql ?? '' : inlineParams(compiled.sql, compiled.params, 'duckdb');
  const openInConsole = useCallback(() => {
    if (!inlinedSql.trim()) return;
    newConsole(linkId, null, inlinedSql);
  }, [inlinedSql, linkId]);

  const saveView = useCallback(async (v: SaveViewValue) => {
    setSaving({ busy: true, error: null });
    try {
      const cur = tabState(tab.id) ?? st;
      const curMode = cur.mode ?? 'builder';
      const view: LinkedView = await useLinks.getState().saveView(linkId, v.replace ? cur.viewId ?? null : null, {
        name: v.name, description: v.description || null, sql: inlinedSql, builder: curMode === 'builder' ? currentModel() : null,
      });
      patch({ viewId: view.id, viewName: view.name });
      useTabs.getState().updateView(tab.id, { title: `${view.name} (${link?.name ?? 'link'})` });
      void useSavedQueries.getState().load(linkId).catch(() => undefined);
      setSaveOpen(false);
      setSaving({ busy: false, error: null });
      toast('success', `Saved linked view “${view.name}”`, 'It is under the link’s Queries in the explorer.');
    } catch (e) {
      setSaving({ busy: false, error: errorMessage(e) });
    }
  }, [currentModel, inlinedSql, link?.name, linkId, patch, st, tab.id]);

  const materialize = useCallback(() => {
    if (!runnableSql.trim()) return;
    runCommand('links.materialize', {
      connectionId: linkId, sql: runnableSql, params: runParams, sessionId: useSessions.getState().byTab[tab.id] ?? null, name: st.viewName ?? undefined,
    });
  }, [linkId, runParams, runnableSql, st.viewName, tab.id]);
  const canMaterialize = !!getCommand('links.materialize');

  const autoLayout = useCallback(async () => {
    const m = currentModel();
    if (m.tables.length < 2) return canvasRef.current?.fit();
    const { computeLayout } = await import('../../ErDiagram/layout');
    const r = computeLayout({
      nodes: m.tables.map((t) => ({ key: t.id, w: sizes.get(t.id)?.w ?? 240, h: sizes.get(t.id)?.h ?? 200, schema: t.alias })),
      edges: m.joins.map((j) => ({ from: j.right, to: j.left })),
      mode: 'layered-lr',
    });
    const pos = Object.fromEntries(Object.entries(r.positions).map(([k, [x, y]]) => [k, [x + 40, y + 40] as const]));
    apply((mm) => M.moveTables(mm, pos));
    requestAnimationFrame(() => canvasRef.current?.fit());
  }, [apply, currentModel, sizes]);

  // ---------------------------------------------------------------- menus
  const menu = useCallback((id: string, at: { clientX: number; clientY: number }, args: Record<string, string | undefined>) => {
    showContextMenu(at, commandMenuItems(contextMenuEntries(id), { tabId: tab.id, ...args }));
  }, [tab.id]);

  // ---------------------------------------------------------------- controller (builder.* commands, shortcuts)
  const ctl = useRef<BuilderController | null>(null);
  ctl.current = {
    tabId: tab.id, linkId,
    addTables: () => listRef.current?.focusSearch(),
    autoLayout: () => void autoLayout(),
    fit: () => canvasRef.current?.fit(),
    selectAllColumns: (tableId, on) => {
      const t = model.tables.find((x) => x.id === tableId);
      if (t) apply((m) => M.setAllColumns(m, tableId, columnsOf(catalog, t).map((c) => c.name), on));
    },
    removeTable: (tableId) => apply((m) => M.removeTable(m, tableId)),
    toggleCollapse: (tableId) => apply((m) => M.setCollapsed(m, tableId, !m.tables.find((t) => t.id === tableId)?.collapsed)),
    makeFrom: (tableId) => apply((m) => M.makeFromTable(m, tableId)),
    isFrom: (tableId) => model.tables[0]?.id === tableId,
    isCollapsed: (tableId) => !!model.tables.find((t) => t.id === tableId)?.collapsed,
    toggleOutput: (tableId, column) => apply((m) => M.toggleColumn(m, tableId, column)),
    isOutput: (tableId, column) => M.isColumnSelected(model, tableId, column),
    filterOn: (tableId, column) => {
      patch({ panel: 'filters' });
      setFilterFocus({ column: M.filterKey(tableId, column), nonce: Date.now() });
    },
    sortBy: (tableId, column) => {
      const pc = M.plainColumn(model, tableId, column);
      apply((m) => M.cycleSort(m, pc ? { columnId: pc.id } : { tableId, column }));
    },
    joinFrom: (tableId, column) => {
      const other = model.tables.find((t) => t.id !== tableId && !M.connected(model, t.id, tableId));
      if (!other) {
        toast('info', 'Add another table first', 'Then drag a column of one table onto a column of the other.');
        return;
      }
      const cols = columnsOf(catalog, model.tables.find((t) => t.id === tableId)!);
      const fc = column || cols.find((c) => c.isPk)?.name || cols[0]?.name;
      const oc = columnsOf(catalog, other);
      const tc = oc.find((c) => c.name === fc)?.name ?? oc.find((c) => c.isPk)?.name ?? oc[0]?.name;
      if (fc && tc) onConnect(tableId, fc, other.id, tc);
    },
    setJoinType: (joinId, type: BuilderJoinType) => apply((m) => M.updateJoin(m, joinId, { type })),
    joinType: (joinId) => model.joins.find((j) => j.id === joinId)?.type ?? null,
    editJoin: openJoin,
    removeJoin: (joinId) => {
      setActiveJoin(null);
      apply((m) => M.removeJoin(m, joinId));
    },
    run, cancel, running: () => running,
    undo, redo, canUndo: () => !!history?.past.length, canRedo: () => !!history?.future.length,
    saveView: () => setSaveOpen(true),
    plan: () => setPlanOpen(true),
    refreshSources: () => void refreshSources(linkId, tab.id),
    toggleMode: () => void toggleMode(),
    mode: () => mode,
    openInConsole,
  };
  useEffect(() => registerBuilder({
    get tabId() { return ctl.current!.tabId; },
    get linkId() { return ctl.current!.linkId; },
    ...Object.fromEntries(Object.keys(ctl.current!).filter((k) => k !== 'tabId' && k !== 'linkId').map((k) => [k, (...a: unknown[]) => (ctl.current as unknown as Record<string, (...x: unknown[]) => unknown>)[k](...a)])),
  } as BuilderController), [tab.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const aj = activeJoin ? model.joins.find((j) => j.id === activeJoin) : undefined;
  const ajLeft = aj ? model.tables.find((t) => t.id === aj.left) : undefined;
  const ajRight = aj ? model.tables.find((t) => t.id === aj.right) : undefined;
  useEffect(() => {
    if (activeJoin && !aj) setActiveJoin(null);
  }, [activeJoin, aj]);

  const rsRows = exec?.resultSets.reduce((a, r) => a + r.rowCount, 0) ?? 0;
  const resultsBadge = running ? '…' : exec ? (exec.errorCount ? '!' : formatCount(rsRows)) : null;

  if (!link) {
    return visible ? (
      <div className="workspace-missing">
        <p>This linked database no longer exists.</p>
      </div>
    ) : null;
  }

  const persistSizes = (next: typeof sizesUi) => patch({ listWidth: next.list, sqlWidth: next.sql, panelHeight: next.panel });

  return (
    <div
      className="lkb"
      data-command-scope="builder"
      style={{ display: visible ? undefined : 'none' }}
      onKeyDown={(e) => {
        const inEditor = !!(e.target as HTMLElement).closest('.monaco-editor');
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
          if (inEditor || e.defaultPrevented) return;
          e.preventDefault();
          if (!running) run();
        } else if ((e.key === 'F5' && e.shiftKey) || (e.key === 'Escape' && running && !inEditor && !activeJoin)) {
          if (!running) return;
          e.preventDefault();
          cancel();
        } else if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          setSaveOpen(true);
        }
      }}
    >
      <header className="lkb-toolbar" role="toolbar" aria-label="Query builder">
        <span className="lkb-title" style={{ ['--member' as string]: memberColor(catalog, catalog?.schemas[0]?.alias ?? '') }}>
          <Workflow size={15} aria-hidden="true" />
          <b>{st.viewName ?? 'Query builder'}</b>
          <span className="muted">· {link.name}</span>
        </span>
        <span className="lkb-tb-group">
          {running ? (
            <button type="button" className="btn lkb-run stop" onClick={cancel} title="Cancel (Shift+F5)"><CircleStop size={14} /> Cancel</button>
          ) : (
            <button type="button" className="btn btn-run lkb-run" onClick={run} disabled={!runnableSql.trim()} title={`Run the query (${displayShortcut('Mod+Enter')})`}><Play size={14} /> Run</button>
          )}
          <button type="button" className="icon-btn" aria-label="Undo" title={`Undo${keyHint('links.undo', ' (', ')')}`} disabled={!history?.past.length || mode === 'sql'} onClick={undo}><Undo2 size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Redo" title={`Redo${keyHint('links.redo', ' (', ')')}`} disabled={!history?.future.length || mode === 'sql'} onClick={redo}><Redo2 size={15} /></button>
        </span>
        <span className="lkb-tb-group">
          <button type="button" className="btn" onClick={() => setSaveOpen(true)} disabled={!runnableSql.trim()} title={`Save as linked view (${displayShortcut('Mod+S')})`}><Save size={13} /> {st.viewId ? 'Save view' : 'Save as view…'}</button>
          {canMaterialize && <button type="button" className="btn" onClick={materialize} disabled={!runnableSql.trim()} title="Write the result into a table of a writable connection"><DatabaseZap size={13} /> Materialize…</button>}
          <button type="button" className="btn" onClick={() => setPlanOpen(true)} disabled={!runnableSql.trim()} title="What each source is asked for"><Network size={13} /> Plan</button>
          <button type="button" className="icon-btn" aria-label="Refresh sources" title="Refresh sources: read the tables from their servers again on the next run" onClick={() => void refreshSources(linkId, tab.id)}><RefreshCw size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Open SQL in a console" title="Open the SQL in a console" disabled={!inlinedSql.trim()} onClick={openInConsole}><SquareTerminal size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Edit link" title="Edit the linked database" onClick={() => runCommand('links.edit', { connectionId: linkId })}><Pencil size={14} /></button>
        </span>
        <span className="flex-1" />
        <span className="lkb-tb-group" aria-label="Zoom">
          <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out (-)" onClick={() => canvasRef.current?.zoom(-1)}><ZoomOut size={14} /></button>
          <button type="button" className="lkb-zoom" title="Reset zoom (0)" onClick={() => canvasRef.current?.zoomReset()}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => canvasRef.current?.zoom(1)}><ZoomIn size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Fit to view" title="Fit (F)" onClick={() => canvasRef.current?.fit()}><Maximize2 size={14} /></button>
          <button type="button" className="icon-btn" aria-label="Auto layout" title="Arrange the tables automatically" disabled={model.tables.length < 2} onClick={() => void autoLayout()}><Network size={14} /></button>
        </span>
      </header>
      <div className="lkb-main" style={{ gridTemplateRows: `minmax(160px, 1fr) auto ${sizesUi.panel}px` }}>
        <div className="lkb-top" style={{ gridTemplateColumns: `${sizesUi.list}px auto minmax(240px, 1fr) auto ${sizesUi.sql}px` }}>
          <TableList
            ref={listRef}
            linkId={linkId}
            catalog={catalog}
            loading={entry?.status === 'loading'}
            error={entry?.status === 'error' ? entry.error : null}
            onCanvas={onCanvas}
            onAdd={(alias, table) => addTables([{ alias, table }])}
            onEdit={() => runCommand('links.edit', { connectionId: linkId })}
            onRetry={() => void useLinks.getState().loadCatalog(linkId, true)}
          />
          <ResizeBar dir="vertical" label="Resize the table list" value={sizesUi.list} min={160} max={420} onChange={(v) => setSizesUi((s) => ({ ...s, list: v }))} onEnd={(v) => persistSizes({ ...sizesUi, list: v })} />
          <div className={`lkb-stage${mode === 'sql' ? ' dim' : ''}`}>
            <Canvas
              ref={canvasRef}
              model={model}
              catalog={catalog}
              sizes={sizes}
              columnStates={columnStates}
              suggestions={mode === 'sql' ? [] : suggestions}
              activeJoin={activeJoin}
              missing={missing}
              onMove={(id, x, y) => apply((m) => M.moveTable(m, id, x, y), `move:${id}`)}
              onConnect={onConnect}
              onJoinClick={openJoin}
              onJoinMenu={(joinId, at) => menu('builder.join', at, { joinId })}
              onJoinRemove={(joinId) => apply((m) => M.removeJoin(m, joinId))}
              onAcceptSuggestion={acceptSuggestion}
              onToggle={(tableId, column) => apply((m) => M.toggleColumn(m, tableId, column))}
              onToggleAll={(tableId, on) => ctl.current?.selectAllColumns(tableId, on)}
              onCardMenu={(tableId, at, column) => menu(column ? 'builder.column' : 'builder.table', at, { tableId, column })}
              onCanvasMenu={(at) => menu('builder.canvas', at, {})}
              onRemoveTable={(id) => apply((m) => M.removeTable(m, id))}
              onCollapse={(id) => ctl.current?.toggleCollapse(id)}
              onDropObject={onDropObject}
              onZoomChange={setZoom}
            />
            {notice && mode === 'builder' && (
              <div className="lkb-notice" role="status">
                <span>{notice.text}</span>
                <button type="button" className="link-btn" aria-label="Undo the automatic join" onClick={() => { setNotice(null); undo(); }}>Undo</button>
                <button type="button" className="icon-btn xs" aria-label="Dismiss" onClick={() => setNotice(null)}><X size={12} /></button>
              </div>
            )}
            {mode === 'sql' && (
              <div className="lkb-stage-veil" role="note">
                SQL mode: the query runs as written on the right. <button type="button" className="link-btn" onClick={() => void toggleMode()}>Return to the builder</button>
              </div>
            )}
          </div>
          <ResizeBar dir="vertical" label="Resize the SQL panel" invert value={sizesUi.sql} min={260} max={760} onChange={(v) => setSizesUi((s) => ({ ...s, sql: v }))} onEnd={(v) => persistSizes({ ...sizesUi, sql: v })} />
          <SqlPanel
            tabId={tab.id}
            linkId={linkId}
            theme={theme}
            mode={mode}
            compiled={compiled}
            inline={st.inline !== false}
            onInline={(v) => patch({ inline: v })}
            sql={st.sql ?? ''}
            onSqlChange={(sql) => patch({ sql })}
            onToggleMode={() => void toggleMode()}
            onDiscardSql={discardSql}
            parsing={parsing}
            onRun={run}
            onOpenInConsole={openInConsole}
          />
        </div>
        <ResizeBar dir="horizontal" label="Resize the bottom panel" invert value={sizesUi.panel} min={120} max={720} onChange={(v) => setSizesUi((s) => ({ ...s, panel: v }))} onEnd={(v) => persistSizes({ ...sizesUi, panel: v })} />
        <BottomPanel
          tab={panel}
          onTab={(t) => patch({ panel: t })}
          model={model}
          catalog={catalog}
          apply={apply}
          disabled={mode === 'sql'}
          filterFocus={filterFocus}
          resultsBadge={resultsBadge}
          results={<div className="lkb-results"><ResultsPane tabId={tab.id} dialect="duckdb" theme={theme} /></div>}
        />
      </div>
      {aj && ajLeft && ajRight && (
        <JoinPopover
          join={aj}
          left={ajLeft}
          right={ajRight}
          leftColumns={columnsOf(catalog, ajLeft)}
          rightColumns={columnsOf(catalog, ajRight)}
          anchor={joinAnchor}
          onType={(type) => apply((m) => {
            const j = m.joins.find((x) => x.id === aj.id);
            if (j && type !== 'cross' && !j.on.length) {
              const l = columnsOf(catalog, ajLeft);
              const r = columnsOf(catalog, ajRight);
              const lc = l.find((c) => c.isPk)?.name ?? l[0]?.name;
              const rc = r.find((c) => c.name === lc)?.name ?? r[0]?.name;
              if (lc && rc) return M.updateJoin(m, aj.id, { type, on: [{ leftColumn: lc, rightColumn: rc, op: '=', ignoreCase: false, trim: false }] });
            }
            return M.updateJoin(m, aj.id, { type });
          })}
          onCondition={(i, p) => apply((m) => M.updateCondition(m, aj.id, i, p))}
          onAddCondition={() => apply((m) => {
            const l = columnsOf(catalog, ajLeft);
            const r = columnsOf(catalog, ajRight);
            const used = new Set(aj.on.map((c) => c.leftColumn));
            const lc = l.find((c) => !used.has(c.name))?.name ?? l[0]?.name ?? '';
            const rc = r.find((c) => c.name === lc)?.name ?? r[0]?.name ?? '';
            return M.updateJoin(m, aj.id, { type: aj.type === 'cross' ? 'inner' : aj.type, on: [...aj.on, { leftColumn: lc, rightColumn: rc, op: '=', ignoreCase: false, trim: false }] });
          })}
          onRemoveCondition={(i) => apply((m) => M.removeCondition(m, aj.id, i))}
          onRemove={() => {
            setActiveJoin(null);
            apply((m) => M.removeJoin(m, aj.id));
          }}
          onClose={() => setActiveJoin(null)}
        />
      )}
      {planOpen && <PlanDialog linkId={linkId} sql={runnableSql} params={runParams} onClose={() => setPlanOpen(false)} />}
      {saveOpen && (
        <SaveViewDialog
          initialName={st.viewName ?? suggestViewName(model)}
          existing={st.viewId ? st.viewName ?? null : null}
          busy={saving.busy}
          error={saving.error}
          onSave={(v) => void saveView(v)}
          onClose={() => {
            setSaveOpen(false);
            setSaving({ busy: false, error: null });
          }}
        />
      )}
    </div>
  );
}

/** "customers × orders" from the canvas tables. */
function suggestViewName(m: BuilderModel): string {
  const names = m.tables.map((t) => t.as);
  return names.length ? names.slice(0, 3).join(' × ') + (names.length > 3 ? ' …' : '') : 'Linked view';
}

/** A splitter that reports an absolute size (px) for a pane next to it. */
function ResizeBar({ dir, label, value, min, max, invert, onChange, onEnd }: {
  dir: 'vertical' | 'horizontal'; label: string; value: number; min: number; max: number; invert?: boolean;
  onChange(v: number): void; onEnd(v: number): void;
}) {
  const start = useRef(value);
  const last = useRef(value);
  return (
    <Splitter
      direction={dir}
      ariaLabel={label}
      onDragStart={() => {
        start.current = value;
        last.current = value;
      }}
      onDrag={(d) => {
        last.current = clampN(start.current + (invert ? -d : d), min, max);
        onChange(last.current);
      }}
      onDragEnd={() => onEnd(last.current)}
    />
  );
}
