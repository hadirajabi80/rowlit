// The query builder canvas: table cards on a pannable / zoomable surface (ErDiagram viewport math, edge routing and
// minimap), join edges with a join-type badge, dashed join suggestions, drag column → column to join, card drag,
// drops of tables from the list / the explorer (application/x-rowlit-object).
import { Plus, Workflow } from 'lucide-react';
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent,
} from 'react';
import type { BuilderJoin, BuilderJoinType, BuilderModel, LinkCatalog, SourceColumn } from '../../../api/links';
import { kindClass } from '../../../filter/model';
import { readObjectDrag, ROWLIT_OBJECT_MIME, type RowlitObjectDrag } from '../../../lib/dragObject';
import { routeEdge, type Rect } from '../../ErDiagram/edges';
import { Minimap, type MinimapHandle } from '../../ErDiagram/Minimap';
import type { CardGeom, ErNode } from '../../ErDiagram/model';
import { clampZoom, fitTransform, stepZoom, zoomAt, type Transform } from '../../ErDiagram/viewport';
import { BuilderCard, type CardColumnState } from './BuilderCard';
import { columnsOf, memberColor, memberLabel } from './catalog';
import { BCARD, cardRectOf, rowAnchor, type CardSize } from './geometry';
import type { JoinSuggestion } from './infer';
import { VennIcon, JOIN_LABEL } from './joinTypes';

export interface CanvasHandle {
  fit(): void;
  zoom(dir: 1 | -1): void;
  zoomReset(): void;
  /** World point at the centre of the view (where "add" puts a card when there is room). */
  center(): { x: number; y: number };
  /** Screen rect of a join badge (to anchor the join popover). */
  joinRect(joinId: string): DOMRect | null;
  focusTable(tableId: string): void;
  /** Fits the view when the card is (partly) outside it. */
  reveal(tableId: string): void;
  zoomLevel(): number;
}

interface Props {
  model: BuilderModel;
  catalog: LinkCatalog | null;
  sizes: ReadonlyMap<string, CardSize>;
  columnStates: ReadonlyMap<string, ReadonlyMap<string, CardColumnState>>;
  suggestions: readonly JoinSuggestion[];
  activeJoin: string | null;
  missing: ReadonlySet<string>;
  onMove(tableId: string, x: number, y: number): void;
  onConnect(fromTable: string, fromColumn: string, toTable: string, toColumn: string): void;
  onJoinClick(joinId: string): void;
  onJoinMenu(joinId: string, at: { clientX: number; clientY: number }): void;
  onJoinRemove(joinId: string): void;
  onAcceptSuggestion(s: JoinSuggestion): void;
  onToggle(tableId: string, column: string): void;
  onToggleAll(tableId: string, on: boolean): void;
  onCardMenu(tableId: string, at: { clientX: number; clientY: number }, column?: string): void;
  onCanvasMenu(at: { clientX: number; clientY: number }): void;
  onRemoveTable(tableId: string): void;
  onCollapse(tableId: string): void;
  onDropObject(drag: RowlitObjectDrag, world: { x: number; y: number }): void;
  onZoomChange?(k: number): void;
}

interface LinkDrag {
  tableId: string;
  column: string;
  kindClass: string;
  from: [number, number];
  to: [number, number];
  target: { tableId: string; column: string } | null;
}

const toGeom = (s: CardSize): CardGeom => ({ w: s.w, h: s.h, rows: [], more: 0, moreRow: false } as unknown as CardGeom);

export const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(p, ref) {
  const { model, catalog, sizes } = p;
  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<MinimapHandle>(null);
  const [t, setT] = useState<Transform>({ x: 24, y: 24, k: 1 });
  const tRef = useRef(t);
  tRef.current = t;
  const [scroll, setScroll] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [link, setLink] = useState<LinkDrag | null>(null);
  const linkRef = useRef<LinkDrag | null>(null);
  linkRef.current = link;
  const [focused, setFocused] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const fitted = useRef(false);

  const tables = useMemo(() => model.tables.map((x) => (drag && x.id === drag.id ? { ...x, x: drag.x, y: drag.y } : x)), [model.tables, drag]);
  const byId = useMemo(() => new Map(tables.map((x) => [x.id, x])), [tables]);
  const cols = useMemo(() => new Map(tables.map((x) => [x.id, columnsOf(catalog, x)])), [tables, catalog]);

  const size = useCallback((id: string) => sizes.get(id) ?? { w: BCARD.minW, h: BCARD.headerH, bodyH: 0, rows: 0 }, [sizes]);
  const anchor = useCallback((tableId: string, column: string | null): [number, number, Rect] | null => {
    const tb = byId.get(tableId);
    if (!tb) return null;
    const s = size(tableId);
    const i = column ? (cols.get(tableId) ?? []).findIndex((c) => c.name === column) : -1;
    return [tb.x, rowAnchor(tb, s, i, scroll[tableId] ?? 0), cardRectOf(tb, s)];
  }, [byId, size, cols, scroll]);

  // ---------------------------------------------------------------- viewport
  const viewSize = () => {
    const el = hostRef.current;
    return { w: el?.clientWidth ?? 800, h: el?.clientHeight ?? 500 };
  };
  const bounds = useCallback((): Rect | null => {
    if (!tables.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const tb of tables) {
      const s = size(tb.id);
      x1 = Math.min(x1, tb.x);
      y1 = Math.min(y1, tb.y);
      x2 = Math.max(x2, tb.x + s.w);
      y2 = Math.max(y2, tb.y + s.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }, [tables, size]);

  const fit = useCallback(() => {
    const { w, h } = viewSize();
    setT(fitTransform(bounds(), w, h, 48, 1));
  }, [bounds]);

  useLayoutEffect(() => {
    if (fitted.current || !tables.length || !hostRef.current?.clientWidth) return;
    fitted.current = true;
    fit();
  }, [tables.length, fit]);

  useEffect(() => {
    const { w, h } = viewSize();
    minimapRef.current?.update(t, w, h);
    p.onZoomChange?.(t.k);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    fit,
    zoom(dir) {
      const { w, h } = viewSize();
      setT((cur) => zoomAt(cur, stepZoom(cur.k, dir), w / 2, h / 2));
    },
    zoomReset() {
      const { w, h } = viewSize();
      setT((cur) => zoomAt(cur, 1, w / 2, h / 2));
    },
    center() {
      const { w, h } = viewSize();
      const c = tRef.current;
      return { x: (w / 2 - c.x) / c.k, y: (h / 2 - c.y) / c.k };
    },
    joinRect(joinId) {
      const el = hostRef.current?.querySelector<HTMLElement>(`[data-join-badge="${joinId}"]`);
      return el?.getBoundingClientRect() ?? null;
    },
    focusTable(tableId) {
      hostRef.current?.querySelector<HTMLElement>(`[data-table-id="${tableId}"]`)?.focus();
    },
    reveal(tableId) {
      const tb = model.tables.find((x) => x.id === tableId);
      if (!tb) return;
      const s = size(tableId);
      const { w, h } = viewSize();
      const c = tRef.current;
      const x1 = tb.x * c.k + c.x;
      const y1 = tb.y * c.k + c.y;
      if (x1 >= 0 && y1 >= 0 && x1 + s.w * c.k <= w && y1 + Math.min(s.h, 200) * c.k <= h) return;
      // everything fits at a readable zoom: fit; else bring the new card into view at the current zoom
      const b = bounds();
      const f = fitTransform(b, w, h, 48, 1);
      if (f.k >= 0.7) setT(f);
      else setT({ k: c.k, x: w / 2 - (tb.x + s.w / 2) * c.k, y: h / 2 - (tb.y + Math.min(s.h, 240) / 2) * c.k });
    },
    zoomLevel: () => tRef.current.k,
  }), [fit, model.tables, size, bounds]);

  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const r = hostRef.current!.getBoundingClientRect();
    const c = tRef.current;
    return [(clientX - r.left - c.x) / c.k, (clientY - r.top - c.y) / c.k];
  };

  // pan with the background, zoom with Ctrl+wheel (plain wheel pans: trackpads)
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const onBgPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.lkb-card, .lkb-join-badge, .lkb-suggest, .er-minimap')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    panStart.current = { x: e.clientX, y: e.clientY, tx: tRef.current.x, ty: tRef.current.y };
    hostRef.current?.focus();
  };
  const onBgPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = panStart.current;
    if (s) setT((cur) => ({ ...cur, x: s.tx + e.clientX - s.x, y: s.ty + e.clientY - s.y }));
  };
  const onBgPointerUp = () => {
    panStart.current = null;
  };
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.0022);
        setT((cur) => zoomAt(cur, clampZoom(cur.k * f), e.clientX - r.left, e.clientY - r.top));
      } else {
        setT((cur) => ({ ...cur, x: cur.x - e.deltaX, y: cur.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // ---------------------------------------------------------------- card drag
  const cardDrag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const onHeaderPointerDown = (id: string) => (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const tb = model.tables.find((x) => x.id === id);
    if (!tb) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    cardDrag.current = { id, sx: e.clientX, sy: e.clientY, ox: tb.x, oy: tb.y, moved: false };
    const move = (ev: PointerEvent) => {
      const d = cardDrag.current;
      if (!d) return;
      const k = tRef.current.k;
      const dx = (ev.clientX - d.sx) / k;
      const dy = (ev.clientY - d.sy) / k;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      d.moved = true;
      setDrag({ id: d.id, x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = cardDrag.current;
      cardDrag.current = null;
      if (d?.moved) {
        const k = tRef.current.k;
        p.onMove(d.id, Math.round(d.ox + (ev.clientX - d.sx) / k), Math.round(d.oy + (ev.clientY - d.sy) / k));
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------------------------------------------------------------- join drag (column → column)
  const hitRow = (x: number, y: number): { tableId: string; column: string } | null => {
    const el = typeof document !== 'undefined' && document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    const row = el?.closest?.('[data-col-row]') as HTMLElement | null;
    if (!row) return null;
    return { tableId: row.dataset.table ?? '', column: row.dataset.column ?? '' };
  };
  const onPortPointerDown = (tableId: string) => (column: string, e: RPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const a = anchor(tableId, column);
    if (!a) return;
    const col = (cols.get(tableId) ?? []).find((c) => c.name === column);
    const start: LinkDrag = { tableId, column, kindClass: kindClass(col?.kind as never), from: [a[0], a[1]], to: toWorld(e.clientX, e.clientY), target: null };
    let started = false;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
      started = true;
      const hit = hitRow(ev.clientX, ev.clientY);
      const target = hit && hit.tableId !== tableId ? hit : null;
      setLink({ ...start, to: toWorld(ev.clientX, ev.clientY), target });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (started) {
        const hit = hitRow(ev.clientX, ev.clientY);
        if (hit && hit.tableId && hit.tableId !== tableId) p.onConnect(tableId, column, hit.tableId, hit.column);
      }
      setLink(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---------------------------------------------------------------- edges
  interface EdgeView { id: string; joinId: string; d: string; mid: [number, number]; type: BuilderJoinType; first: boolean; dashed?: boolean }
  const edges = useMemo(() => {
    const out: EdgeView[] = [];
    for (const j of model.joins) {
      const conds = j.type === 'cross' || !j.on.length ? [null] : j.on;
      conds.forEach((c, i) => {
        const a = anchor(j.left, c?.leftColumn ?? null);
        const b = anchor(j.right, c?.rightColumn ?? null);
        if (!a || !b) return;
        const g = routeEdge(`${j.id}:${i}`, a[2], a[1], b[2], b[1]);
        out.push({ id: g.id, joinId: j.id, d: g.d, mid: g.mid, type: j.type, first: i === 0, dashed: !c });
      });
    }
    return out;
  }, [model.joins, anchor]);

  const suggestionViews = useMemo(() => p.suggestions.map((s, i) => {
    const a = anchor(s.fromTable, s.fromColumns[0] ?? null);
    const b = anchor(s.toTable, s.toColumns[0] ?? null);
    if (!a || !b) return null;
    const g = routeEdge(`s${i}`, a[2], a[1], b[2], b[1]);
    return { s, d: g.d, mid: g.mid };
  }).filter((x): x is NonNullable<typeof x> => !!x), [p.suggestions, anchor]);

  const tempPath = useMemo(() => {
    if (!link) return null;
    const [x1, y1] = link.from;
    const [x2, y2] = link.to;
    const src = byId.get(link.tableId);
    const s = src ? size(src.id) : null;
    const right = !src || !s || x2 >= src.x + s.w / 2;
    const sx = src && s ? (right ? src.x + s.w : src.x) : x1;
    const k = Math.max(40, Math.abs(x2 - sx) * 0.4) * (right ? 1 : -1);
    return `M${sx} ${y1}C${sx + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`;
  }, [link, byId, size]);

  // ---------------------------------------------------------------- minimap
  const mmNodes = useMemo(() => tables.map((x) => ({ key: x.id, ghost: false }) as unknown as ErNode), [tables]);
  const mmPositions = useMemo(() => Object.fromEntries(tables.map((x) => [x.id, [x.x, x.y] as const])), [tables]);
  const mmGeom = useMemo(() => new Map(tables.map((x) => [x.id, toGeom(size(x.id))])), [tables, size]);
  const navigate = useCallback((wx: number, wy: number) => {
    const { w, h } = viewSize();
    setT((cur) => ({ ...cur, x: w / 2 - wx * cur.k, y: h / 2 - wy * cur.k }));
  }, []);
  const emptySel = useMemo(() => new Set<string>(), []);

  // ---------------------------------------------------------------- keyboard on a card
  const onCardKey = (id: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const tb = model.tables.find((x) => x.id === id);
    if (!tb) return;
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      p.onMove(id, tb.x + moves[e.key][0], tb.y + moves[e.key][1]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      p.onRemoveTable(id);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      p.onCardMenu(id, { clientX: r.left + 24, clientY: r.top + 24 });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.querySelector<HTMLInputElement>('.lkb-card-body input')?.focus();
    }
  };

  const typeOfJoin = (j: BuilderJoin) => j.type;

  return (
    <div
      ref={hostRef}
      className={`lkb-canvas${link ? ' linking' : ''}${dropOver ? ' drop-over' : ''}`}
      tabIndex={0}
      role="application"
      aria-label="Query canvas: tables and joins. Drag a column onto a column of another table to join them."
      aria-roledescription="query canvas"
      onPointerDown={onBgPointerDown}
      onPointerMove={onBgPointerMove}
      onPointerUp={onBgPointerUp}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('.lkb-card, .lkb-join-badge')) return;
        e.preventDefault();
        p.onCanvasMenu(e);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === '=' || e.key === '+') setT((cur) => zoomAt(cur, stepZoom(cur.k, 1), viewSize().w / 2, viewSize().h / 2));
        else if (e.key === '-') setT((cur) => zoomAt(cur, stepZoom(cur.k, -1), viewSize().w / 2, viewSize().h / 2));
        else if (e.key === 'f' || e.key === 'F') fit();
        else if (e.key === '0') setT((cur) => zoomAt(cur, 1, viewSize().w / 2, viewSize().h / 2));
        else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          p.onCanvasMenu({ clientX: r.left + 40, clientY: r.top + 40 });
        }
      }}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes(ROWLIT_OBJECT_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropOver) setDropOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropOver(false);
      }}
      onDrop={(e) => {
        setDropOver(false);
        const d = readObjectDrag(e.dataTransfer);
        if (!d) return;
        e.preventDefault();
        const [x, y] = hostRef.current ? toWorld(e.clientX, e.clientY) : [40, 40];
        p.onDropObject(d, { x: Math.round(x - BCARD.minW / 2), y: Math.round(y - 16) });
      }}
    >
      <div ref={layerRef} className="lkb-layer" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})` }}>
        <svg className="lkb-edges" width="1" height="1" aria-hidden="true">
          {suggestionViews.map((v, i) => <path key={`s${i}`} className="lkb-edge suggest" d={v.d} />)}
          {edges.map((e) => (
            <path key={e.id} className={`lkb-edge ${e.type}${e.dashed ? ' cross' : ''}${p.activeJoin === e.joinId ? ' active' : ''}`} d={e.d} />
          ))}
          {tempPath && <path className={`lkb-edge temp${link?.target ? ' ok' : ''}`} d={tempPath} />}
        </svg>
        {tables.map((tb) => (
          <BuilderCard
            key={tb.id}
            table={tb}
            size={size(tb.id)}
            columns={cols.get(tb.id) ?? (EMPTY as SourceColumn[])}
            state={p.columnStates.get(tb.id) ?? EMPTY_STATE}
            color={memberColor(catalog, tb.alias)}
            memberLabel={memberLabel(catalog, tb.alias)}
            isFrom={model.tables[0]?.id === tb.id && model.tables.length > 1}
            focused={focused === tb.id}
            linking={link ? { tableId: link.tableId, column: link.column, kindClass: link.kindClass } : null}
            dropTarget={link?.target?.tableId === tb.id ? link.target.column : null}
            missing={p.missing.has(tb.id)}
            onHeaderPointerDown={onHeaderPointerDown(tb.id)}
            onToggle={(c) => p.onToggle(tb.id, c)}
            onToggleAll={(on) => p.onToggleAll(tb.id, on)}
            onPortPointerDown={onPortPointerDown(tb.id)}
            onScroll={(top) => setScroll((s) => (s[tb.id] === top ? s : { ...s, [tb.id]: top }))}
            onMenu={(e, column) => p.onCardMenu(tb.id, e, column)}
            onRemove={() => p.onRemoveTable(tb.id)}
            onCollapse={() => p.onCollapse(tb.id)}
            onFocus={() => setFocused(tb.id)}
            onKeyDown={onCardKey(tb.id)}
          />
        ))}
        {edges.filter((e) => e.first).map((e) => {
          const j = model.joins.find((x) => x.id === e.joinId)!;
          const type = typeOfJoin(j);
          const n = j.on.length;
          return (
            <button
              key={`b${e.joinId}`}
              type="button"
              className={`lkb-join-badge ${type}${p.activeJoin === e.joinId ? ' active' : ''}`}
              data-join-badge={e.joinId}
              style={{ transform: `translate(${e.mid[0]}px, ${e.mid[1]}px) translate(-50%, -50%)` }}
              aria-label={`${JOIN_LABEL[type]} between ${byId.get(j.left)?.as} and ${byId.get(j.right)?.as}${n > 1 ? `, ${n} conditions` : ''}. Enter to edit, Delete to remove.`}
              title={`${JOIN_LABEL[type]}${n > 1 ? ` · ${n} conditions` : ''} — click to change`}
              onClick={() => p.onJoinClick(e.joinId)}
              onKeyDown={(ev) => {
                if (ev.key === 'Delete' || ev.key === 'Backspace') {
                  ev.preventDefault();
                  p.onJoinRemove(e.joinId);
                }
              }}
              onContextMenu={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                p.onJoinMenu(e.joinId, ev);
              }}
            >
              <VennIcon type={type} size={18} />
              {n > 1 && <span className="lkb-join-n">{n}</span>}
            </button>
          );
        })}
        {suggestionViews.map((v, i) => (
          <button
            key={`sb${i}`}
            type="button"
            className="lkb-suggest"
            style={{ transform: `translate(${v.mid[0]}px, ${v.mid[1]}px) translate(-50%, -50%)` }}
            title={`Suggested join (${v.s.label}): ${byId.get(v.s.fromTable)?.as}.${v.s.fromColumns.join(', ')} = ${byId.get(v.s.toTable)?.as}.${v.s.toColumns.join(', ')}. Click to join.`}
            aria-label={`Join ${byId.get(v.s.fromTable)?.as}.${v.s.fromColumns.join(', ')} to ${byId.get(v.s.toTable)?.as}.${v.s.toColumns.join(', ')} (${v.s.label})`}
            onClick={() => p.onAcceptSuggestion(v.s)}
          >
            <Plus size={12} />
          </button>
        ))}
      </div>
      {!tables.length && (
        <div className="lkb-empty" aria-live="polite">
          <Workflow size={40} strokeWidth={1.2} aria-hidden="true" />
          <div className="lkb-empty-title">Build a query without writing SQL</div>
          <div className="lkb-empty-text">
            Drag tables here from the list on the left or from the explorer. Tick the columns you want, then drag a column onto a column of
            another table to join them — even across different servers.
          </div>
        </div>
      )}
      {tables.length > 3 && (
        <Minimap ref={minimapRef} nodes={mmNodes} positions={mmPositions} geom={mmGeom} selection={emptySel} onNavigate={navigate} />
      )}
    </div>
  );
});

const EMPTY: SourceColumn[] = [];
const EMPTY_STATE: ReadonlyMap<string, CardColumnState> = new Map();
