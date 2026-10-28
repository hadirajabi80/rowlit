// Pie / donut and KPI-number scenes.
import { legendHeight, legendShapes } from './legend';
import { formatTick, formatValue } from './scale';
import { empty, r2, seriesColor, truncate, type Mark, type Scene, type Shape } from './sceneTypes';
import type { ChartData, ChartSpec } from './types';

const pt = (cx: number, cy: number, r: number, a: number) => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`;

function slicePath(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  if (inner > 0) {
    return `M${pt(cx, cy, r, a0)}A${r} ${r} 0 ${large} 1 ${pt(cx, cy, r, a1)}L${pt(cx, cy, inner, a1)}A${inner} ${inner} 0 ${large} 0 ${pt(cx, cy, inner, a0)}Z`;
  }
  return `M${cx} ${cy}L${pt(cx, cy, r, a0)}A${r} ${r} 0 ${large} 1 ${pt(cx, cy, r, a1)}Z`;
}

export function pieScene(data: ChartData, spec: ChartSpec, w: number, h: number): Scene {
  const s = data.series[0];
  const slices = s ? data.categories.map((c, i) => ({ c, i, v: s.values[i] ?? 0 })).filter((x) => x.v > 0) : [];
  const total = slices.reduce((a, x) => a + x.v, 0);
  if (!s || !slices.length) return empty(w, h, 'No positive values to chart');
  const donut = spec.type === 'donut';
  const items = slices.map((x, k) => ({ name: x.c.label, color: seriesColor(k) }));
  const legend = spec.legend ? items : [];
  const lh = legendHeight(legend, w - 16);
  const availH = h - lh - 8;
  const cx = w / 2, cy = 8 + availH / 2;
  const R = Math.max(24, Math.min(w - 20, availH - 4) / 2);
  const inner = donut ? R * 0.58 : 0;
  const shapes: Shape[] = [];
  const marks: Mark[] = [];
  let a = -Math.PI / 2;
  const sorted = slices.length === 1;
  slices.forEach((x, k) => {
    const frac = x.v / total;
    const a1 = a + frac * 2 * Math.PI * (sorted ? 0.99999 : 1);
    const mid = (a + a1) / 2;
    const rm = inner ? (R + inner) / 2 : R * 0.68;
    const pct = `${Number((frac * 100).toFixed(frac < 0.1 ? 1 : 0))}%`;
    marks.push({
      x: r2(cx + rm * Math.cos(mid)), y: r2(cy + rm * Math.sin(mid)), cat: x.i, series: 0, title: x.c.label,
      rows: [{ name: s.name, color: seriesColor(k), value: `${formatValue(x.v)} (${pct})`, active: true }],
      aria: `${x.c.label}: ${formatValue(x.v)}, ${pct}`,
      geo: { k: 'arc', d: slicePath(cx, cy, R, inner, a, a1) },
    });
    shapes.push({ k: 'arc', d: slicePath(cx, cy, R, inner, a, a1), fill: seriesColor(k), mark: marks.length - 1 });
    if (spec.labels && frac >= 0.05) shapes.push({ k: 'text', x: r2(cx + rm * Math.cos(mid)), y: r2(cy + rm * Math.sin(mid) + 4), text: pct, cls: 'label', anchor: 'middle' });
    a = a1;
  });
  if (donut) {
    shapes.push({ k: 'text', x: cx, y: r2(cy + 2), text: formatTick(total), cls: 'center', anchor: 'middle', size: Math.min(26, inner / 1.6), title: formatValue(total) });
    shapes.push({ k: 'text', x: cx, y: r2(cy + 18), text: 'Total', cls: 'tick', anchor: 'middle' });
  }
  shapes.push(...legendShapes(legend, 8, h - lh, w - 16));
  const title = `${donut ? 'Donut' : 'Pie'} chart of ${s.name}${data.xName ? ` by ${data.xName}` : ''}`;
  return {
    w, h, kind: 'pie', horizontal: false, title,
    desc: `${title}: ${slices.length} slices, total ${formatValue(total)}.${data.droppedCategories ? ` Smaller categories are grouped as Other.` : ''}`,
    shapes, marks, bySeries: [marks.map((_, i) => i)], thinned: 0, message: null,
  };
}

export function kpiScene(data: ChartData, w: number, h: number): Scene {
  const tiles = data.series.map((s) => ({ name: s.name, v: s.values[0] ?? null }));
  if (!tiles.length) return empty(w, h, 'Choose a numeric column for the KPI');
  const cols = Math.max(1, Math.min(tiles.length, Math.floor(w / 170)));
  const rows = Math.ceil(tiles.length / cols);
  const tw = w / cols, th = h / rows;
  const shapes: Shape[] = [];
  tiles.forEach((t, i) => {
    const cx = (i % cols) * tw + tw / 2, cy = Math.floor(i / cols) * th + th / 2;
    const text = t.v === null ? '—' : Math.abs(t.v) >= 1e9 ? formatTick(t.v) : t.v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const size = Math.max(16, Math.min(56, th * 0.4, (tw - 24) / Math.max(2, text.length * 0.6)));
    shapes.push({ k: 'text', x: r2(cx), y: r2(cy + size * 0.2), text, cls: 'kpi-value', anchor: 'middle', size: r2(size), title: t.v === null ? undefined : formatValue(t.v) });
    shapes.push({ k: 'text', x: r2(cx), y: r2(cy + size * 0.2 + 22), text: truncate(t.name, Math.max(8, Math.floor((tw - 16) / 6.4))), cls: 'kpi-label', anchor: 'middle', title: t.name });
  });
  const desc = tiles.map((t) => `${t.name}: ${t.v === null ? 'no value' : formatValue(t.v)}`).join('; ');
  return { w, h, kind: 'kpi', horizontal: false, title: `KPI: ${tiles.map((t) => t.name).join(', ')}`, desc, shapes, marks: [], bySeries: [], thinned: 0, message: null };
}
