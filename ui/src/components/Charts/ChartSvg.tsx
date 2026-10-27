// Renders a chart Scene as SVG with a tooltip and keyboard navigation.
//
// Keyboard: marks (bars, points, slices) are focusable with a roving tabindex while there are at most SPARSE_MARKS of
// them; arrows move between categories / series, Home/End jump to the ends, Escape clears. Charts with more marks are
// a single focus stop (the plot group) that drives the same cursor. The focused or hovered mark shows a ring and a
// tooltip (role="tooltip"), and keyboard moves are announced through a polite live region.
import { forwardRef, type FocusEvent, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { SPARSE_MARKS } from './scene';
import type { Mark, Scene, Shape } from './sceneTypes';

/** Styles live inside the SVG so an exported file looks the same without the app's stylesheet. */
export const SVG_STYLE = `
.cs-tick{font:11px var(--font-ui);fill:var(--fg-muted)}
.cs-axis-title{font:600 11px var(--font-ui);fill:var(--fg-muted)}
.cs-legend{font:11px var(--font-ui);fill:var(--fg)}
.cs-label{font:600 10.5px var(--font-ui);fill:var(--fg);paint-order:stroke;stroke:var(--bg-panel);stroke-width:3px;stroke-linejoin:round}
.cs-center{font:600 22px var(--font-ui);fill:var(--fg)}
.cs-kpi-value{font-family:var(--font-ui);font-weight:600;fill:var(--fg)}
.cs-kpi-label{font:12px var(--font-ui);fill:var(--fg-muted)}
.cs-grid{stroke:var(--border-subtle);stroke-width:1}
.cs-axis{stroke:var(--border-strong);stroke-width:1}
.cs-arc{stroke:var(--bg-panel);stroke-width:1.5}
.cs-bar{shape-rendering:crispEdges}
`;

const TEXT_CLASS: Record<string, string> = {
  tick: 'cs-tick', 'axis-title': 'cs-axis-title', label: 'cs-label', legend: 'cs-legend', center: 'cs-center', 'kpi-value': 'cs-kpi-value', 'kpi-label': 'cs-kpi-label',
};

interface Props {
  scene: Scene;
  /** Accessible name suffix, e.g. the result tab. */
  label?: string;
}

type Active = { mark: number; by: 'pointer' | 'keyboard' } | null;

export const ChartSvg = forwardRef<SVGSVGElement, Props>(function ChartSvg({ scene, label }, ref) {
  const { marks, bySeries, horizontal } = scene;
  const tipId = useId();
  const [active, setActive] = useState<Active>(null);
  const [announce, setAnnounce] = useState('');
  const rootRef = useRef<SVGSVGElement | null>(null);
  const setRefs = useCallback((el: SVGSVGElement | null) => {
    rootRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [ref]);
  const sparse = marks.length > 0 && marks.length <= SPARSE_MARKS;
  const first = bySeries.find((s) => s.length)?.[0] ?? 0;
  const rover = active ? active.mark : first;

  // a different chart (not just a resize) invalidates the cursor
  const [shown, setShown] = useState(scene.title + scene.marks.length);
  if (shown !== scene.title + scene.marks.length) {
    setShown(scene.title + scene.marks.length);
    setActive(null);
  }

  // keyboard moves put DOM focus on the new mark when marks are focusable
  useEffect(() => {
    if (active?.by !== 'keyboard' || !sparse) return;
    const el = rootRef.current?.querySelector<SVGElement>(`[data-mi="${active.mark}"]`);
    if (el && el !== document.activeElement) el.focus();
  }, [active, sparse]);

  const move = (key: string): number | null => {
    if (!marks.length) return null;
    const cur = active ? active.mark : first;
    const m = marks[cur];
    const list = bySeries[m.series] ?? [];
    const pos = list.indexOf(cur);
    const alongCats = (d: number) => list[Math.max(0, Math.min(list.length - 1, pos + d))];
    const acrossSeries = (d: number) => {
      const s = Math.max(0, Math.min(bySeries.length - 1, m.series + d));
      if (s === m.series) return cur;
      const cand = bySeries[s];
      if (!cand.length) return cur;
      let best = cand[0];
      for (const i of cand) if (Math.hypot(marks[i].x - m.x, marks[i].y - m.y) < Math.hypot(marks[best].x - m.x, marks[best].y - m.y)) best = i;
      return best;
    };
    const pie = scene.kind === 'pie';
    switch (key) {
      case 'ArrowRight': return horizontal && !pie ? acrossSeries(1) : alongCats(1);
      case 'ArrowLeft': return horizontal && !pie ? acrossSeries(-1) : alongCats(-1);
      case 'ArrowDown': return horizontal || pie ? alongCats(1) : acrossSeries(1);
      case 'ArrowUp': return horizontal || pie ? alongCats(-1) : acrossSeries(-1);
      case 'Home': return list[0];
      case 'End': return list[list.length - 1];
      default: return null;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setActive(null); return; }
    const next = move(e.key);
    if (next === null || next === undefined) return;
    e.preventDefault();
    setActive({ mark: next, by: 'keyboard' });
    setAnnounce(marks[next].aria);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!marks.length || scene.kind !== 'cartesian') return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    let best = -1, bd = 36 * 36;
    for (let i = 0; i < marks.length; i++) {
      const g = marks[i].geo;
      let d: number;
      if (g.k === 'rect') {
        const dx = x < g.x ? g.x - x : x > g.x + g.w ? x - g.x - g.w : 0;
        const dy = y < g.y ? g.y - y : y > g.y + g.h ? y - g.y - g.h : 0;
        d = dx * dx + dy * dy;
      } else d = (marks[i].x - x) ** 2 + (marks[i].y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    setActive((a) => (best < 0 ? null : a?.mark === best && a.by === 'pointer' ? a : { mark: best, by: 'pointer' }));
  };

  const m = active ? marks[active.mark] : null;
  const render = (s: Shape, i: number) => {
    switch (s.k) {
      case 'rect': return <rect key={i} className="cs-bar" x={s.x} y={s.y} width={s.w} height={s.h} style={{ fill: s.fill }} {...markProps(s.mark)} />;
      case 'dot': return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} style={{ fill: s.fill }} {...markProps(s.mark)} />;
      case 'arc': return <path key={i} className="cs-arc" d={s.d} style={{ fill: s.fill }} {...markProps(s.mark)} />;
      case 'path': return <path key={i} d={s.d} fill={s.fill === 'none' ? 'none' : undefined} style={{ fill: s.fill === 'none' ? undefined : s.fill, stroke: s.stroke, strokeWidth: s.sw, fillOpacity: s.fo, strokeLinejoin: 'round', strokeLinecap: 'round' }} />;
      case 'dots': return <path key={i} d={s.d} fill="none" strokeLinecap="round" style={{ stroke: s.stroke, strokeWidth: s.sw, strokeOpacity: 0.75 }} />;
      case 'line': return <line key={i} className={`cs-${s.cls}`} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
      case 'text':
        return (
          <text
            key={i} className={TEXT_CLASS[s.cls]} x={s.x} y={s.y} textAnchor={s.anchor} fontSize={s.size}
            transform={s.rotate ? `rotate(${s.rotate} ${s.x} ${s.y})` : undefined}
          >
            {s.title && s.title !== s.text ? <title>{s.title}</title> : null}
            {s.text}
          </text>
        );
    }
  };
  function markProps(mi: number | undefined) {
    if (mi === undefined) return {};
    const mk = marks[mi];
    return {
      'data-mi': mi,
      role: 'img' as const,
      'aria-label': mk.aria,
      'aria-describedby': active?.mark === mi ? tipId : undefined,
      ...(sparse ? {
        tabIndex: mi === rover ? 0 : -1,
        onFocus: () => setActive((a) => (a?.mark === mi && a.by === 'keyboard' ? a : { mark: mi, by: 'keyboard' })),
        onBlur: (e: FocusEvent) => { if (!(e.relatedTarget as Element | null)?.closest?.('[data-mi]')) setActive(null); },
      } : {}),
      onPointerEnter: scene.kind === 'pie' ? () => setActive({ mark: mi, by: 'pointer' }) : undefined,
    };
  }

  return (
    <div className="chart-stage" onPointerLeave={() => setActive((a) => (a?.by === 'pointer' ? null : a))}>
      <svg
        ref={setRefs}
        width={scene.w}
        height={scene.h}
        viewBox={`0 0 ${scene.w} ${scene.h}`}
        xmlns="http://www.w3.org/2000/svg"
        role={marks.length ? 'group' : 'img'}
        aria-roledescription="chart"
        aria-label={label ? `${scene.title} (${label})` : scene.title}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
      >
        <title>{scene.title}</title>
        <desc>{scene.desc}</desc>
        <style>{SVG_STYLE}</style>
        <g tabIndex={marks.length && !sparse ? 0 : undefined} className="chart-plot" aria-describedby={active ? tipId : undefined}>
          {scene.shapes.map(render)}
        </g>
        {m && <Cursor mark={m} />}
      </svg>
      {m && (
        <div
          id={tipId}
          role="tooltip"
          className={`chart-tip${m.y < 90 ? ' below' : ''}`}
          style={{ left: Math.max(110, Math.min(scene.w - 110, m.x)), top: m.y }}
        >
          <div className="chart-tip-title">{m.title}</div>
          {m.rows.map((r, i) => (
            <div key={i} className={`chart-tip-row${r.active ? ' on' : ''}`}>
              <span className="chart-tip-swatch" style={{ background: r.color }} />
              <span className="chart-tip-name">{r.name}</span>
              <span className="chart-tip-value">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
    </div>
  );
});

/** The ring around the active mark. Not part of an export (data-export="skip"). */
function Cursor({ mark }: { mark: Mark }) {
  const g = mark.geo;
  return (
    <g data-export="skip" pointerEvents="none" className="chart-cursor">
      {g.k === 'rect' && <rect x={g.x - 1.5} y={g.y - 1.5} width={g.w + 3} height={g.h + 3} />}
      {g.k === 'dot' && <circle cx={mark.x} cy={mark.y} r={g.r + 2} />}
      {g.k === 'arc' && <path d={g.d} />}
    </g>
  );
}
