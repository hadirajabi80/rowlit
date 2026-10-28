// Chart data -> scene geometry for the cartesian charts (bar, horizontal bar, stacked bar, line, area, scatter);
// pie and KPI live in scenePie.ts. Pure functions of (data, spec, size).
import { autoBucket, bucketStart } from './aggregate';
import { legendHeight, legendShapes, type LegendItem } from './legend';
import { lttb } from './lttb';
import { formatTick, formatValue, linearScale, linearTicks, logDomain, logScale, logTicks, niceDomain, type Scale } from './scale';
import { kpiScene, pieScene } from './scenePie';
import { empty, r2, seriesColor, truncate, type Mark, type Scene, type Shape, type TipRow } from './sceneTypes';
import type { ChartData, ChartSpec, XKind } from './types';
import { formatTime, type TimeUnit } from './values';

export const MIN_W = 160;
export const MIN_H = 120;
/** Per-element interaction (focusable marks) stops here; beyond it the chart is one focus stop with a cursor. */
export const SPARSE_MARKS = 300;
const MARK_CAP = 2000;
const TICK_PX = 11 * 0.58;

const TYPE_NAME: Record<string, string> = {
  bar: 'Bar', hbar: 'Horizontal bar', stacked: 'Stacked bar', line: 'Line', area: 'Area', scatter: 'Scatter', pie: 'Pie', donut: 'Donut', kpi: 'KPI',
};

export function buildScene(data: ChartData, spec: ChartSpec, width: number, height: number): Scene {
  const w = Math.max(MIN_W, Math.floor(width)), h = Math.max(MIN_H, Math.floor(height));
  if (!data.series.length) return empty(w, h, spec.y.length ? 'None of the chosen columns exist in this result' : 'Choose a Y column to chart');
  if (spec.type === 'kpi') return kpiScene(data, w, h);
  if (!data.categories.length) return empty(w, h, data.skippedRows ? 'No row has a readable X value' : 'No rows to chart');
  if (spec.type === 'pie' || spec.type === 'donut') return pieScene(data, spec, w, h);
  return cartesian(data, spec, w, h);
}

/** Tick instants for a continuous time axis: bucket boundaries thinned to at most `max` labels. */
export function timeTicks(min: number, max: number, unit: TimeUnit, max_: number): { ticks: number[]; unit: TimeUnit } {
  const span = max - min;
  const u: TimeUnit = unit === 'none' ? (span <= 86_400_000 ? 'none' : autoBucket(span)) : unit;
  if (u === 'none' || span <= 0) {
    const n = Math.max(1, max_);
    return { ticks: Array.from({ length: n + 1 }, (_, i) => min + (span * i) / n), unit: u };
  }
  const all: number[] = [];
  let t = bucketStart(min, u);
  if (t < min) t = nextUnit(t, u);
  for (let i = 0; t <= max && i < 20_000; i++) { all.push(t); t = nextUnit(t, u); }
  if (all.length <= 1) return { ticks: [min, max], unit: u };
  const step = Math.ceil(all.length / Math.max(1, max_));
  return { ticks: all.filter((_, i) => i % step === 0), unit: u };
}

function nextUnit(t: number, u: TimeUnit): number {
  const d = new Date(t);
  switch (u) {
    case 'hour': return t + 3_600_000;
    case 'day': return t + 86_400_000;
    case 'week': return t + 7 * 86_400_000;
    case 'month': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    case 'year': return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
    default: return t + 1;
  }
}

interface ValueAxis { scale: Scale; ticks: number[]; log: boolean }

function valueAxis(data: ChartData, spec: ChartSpec, len: number): ValueAxis | null {
  const stacked = spec.type === 'stacked';
  const zero = spec.type === 'bar' || spec.type === 'hbar' || stacked || spec.type === 'area';
  const log = spec.log && !stacked;
  let lo = Infinity, hi = -Infinity;
  if (stacked) {
    for (let i = 0; i < data.categories.length; i++) {
      let pos = 0, neg = 0;
      for (const s of data.series) { const v = s.values[i]; if (v !== null) { if (v >= 0) pos += v; else neg += v; } }
      lo = Math.min(lo, neg); hi = Math.max(hi, pos);
    }
  } else {
    for (const s of data.series) for (const v of s.values) if (v !== null && (!log || v > 0)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (!Number.isFinite(lo)) return null;
  if (log) {
    const d = logDomain(lo, hi);
    return { scale: logScale(d.min, d.max), ticks: logTicks(d.min, d.max), log: true };
  }
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const n = niceDomain(lo, hi, Math.max(3, Math.min(9, Math.round(len / 46))));
  return { scale: linearScale(n.min, n.max), ticks: linearTicks(n.min, n.max, n.step), log: false };
}

function cartesian(data: ChartData, spec: ChartSpec, w: number, h: number): Scene {
  const type = spec.type;
  const horizontal = type === 'hbar';
  const stacked = type === 'stacked';
  const bars = type === 'bar' || horizontal || stacked;
  const nCat = data.categories.length;
  const nSer = data.series.length;
  const kind: XKind = bars ? 'category' : data.xKind;
  const va = valueAxis(data, spec, horizontal ? w - 120 : h - 90);
  if (!va) return empty(w, h, spec.log ? 'No positive values for the log scale' : 'No numeric values to chart');

  // ---- legend and margins
  const legendItems: LegendItem[] = spec.legend && nSer > 1 ? data.series.map((s, i) => ({ name: s.name, color: seriesColor(i) })) : [];
  const lh = legendHeight(legendItems, w - 16);
  const tickText = va.ticks.map(formatTick);
  const catText = data.categories.map((c) => truncate(c.label, horizontal ? 22 : 18));
  const maxCat = catText.reduce((m, t) => Math.max(m, t.length), 0);
  const yTitle = nSer === 1 ? data.series[0].name : '';
  const xTitle = data.xName ?? '';
  const top = 12, right = 16;
  let left: number, bottom: number;
  const valueLabelW = Math.max(...tickText.map((t) => t.length)) * TICK_PX + 10;
  if (horizontal) {
    left = 10 + Math.min(150, maxCat * TICK_PX) + (xTitle ? 16 : 0);
    bottom = 24 + (yTitle ? 16 : 0) + lh;
  } else {
    left = 10 + valueLabelW + (yTitle ? 16 : 0);
    bottom = 24 + (xTitle ? 16 : 0) + lh;
  }
  // vertical category labels may need to be rotated: reserve their height after deciding
  let plotW = Math.max(40, w - left - right);
  let rotate = false;
  let slot = 0;
  if (!horizontal) {
    slot = kind === 'category' ? plotW / nCat : Infinity;
    if (kind === 'category' && maxCat * TICK_PX > slot - 4 && slot >= 10) { rotate = true; bottom += Math.min(90, maxCat * TICK_PX * 0.66); }
  }
  const plotH = Math.max(40, h - top - bottom);
  const plotX = left, plotY = top;
  if (horizontal) { plotW = Math.max(40, w - left - right); slot = plotH / nCat; }

  // ---- category axis geometry
  const catLen = horizontal ? plotH : plotW;
  const catStart = horizontal ? plotY : plotX;
  let catPx: (i: number) => number;
  let contMin = 0, contMax = 1, timeUnit: TimeUnit = 'none';
  const numTicks: { pos: number; label: string }[] = [];
  if (kind === 'category') {
    const s = catLen / nCat;
    catPx = (i) => catStart + (i + 0.5) * s;
  } else {
    contMin = Math.min(...data.categories.map((c) => c.pos));
    contMax = Math.max(...data.categories.map((c) => c.pos));
    if (kind === 'number') {
      const n = niceDomain(contMin, contMax, Math.max(3, Math.min(9, Math.round(catLen / 70))));
      if (contMin !== contMax) { contMin = n.min; contMax = n.max; for (const t of linearTicks(n.min, n.max, n.step)) numTicks.push({ pos: t, label: formatTick(t) }); }
      else { contMin -= 1; contMax += 1; numTicks.push({ pos: data.categories[0].pos, label: formatTick(data.categories[0].pos) }); }
    } else {
      const lab = Math.max(60, formatTime(contMax, data.bucket).length * TICK_PX + 14);
      const tt = timeTicks(contMin, contMax, data.bucket, Math.max(2, Math.floor(catLen / lab)));
      timeUnit = tt.unit;
      for (const t of tt.ticks) numTicks.push({ pos: t, label: formatTime(t, timeUnit) });
      if (contMin === contMax) { contMin -= 43_200_000; contMax += 43_200_000; }
    }
    const pad = 10;
    catPx = (i) => {
      const f = (data.categories[i].pos - contMin) / (contMax - contMin || 1);
      return catStart + pad + f * (catLen - 2 * pad);
    };
  }
  const valPx = (v: number) => {
    const u = Math.max(0, Math.min(1, va.scale.unit(v)));
    return horizontal ? plotX + plotW * u : plotY + plotH * (1 - u);
  };
  const valPxRaw = (v: number) => {
    const u = va.scale.unit(v);
    return horizontal ? plotX + plotW * u : plotY + plotH * (1 - u);
  };
  const baseV = va.log ? va.scale.min : Math.max(va.scale.min, Math.min(0, va.scale.max));

  // ---- grid and axes
  const shapes: Shape[] = [];
  va.ticks.forEach((t, i) => {
    const p = r2(valPxRaw(t));
    if (horizontal) {
      shapes.push({ k: 'line', x1: p, y1: plotY, x2: p, y2: plotY + plotH, cls: 'grid' });
      shapes.push({ k: 'text', x: p, y: plotY + plotH + 15, text: tickText[i], cls: 'tick', anchor: 'middle' });
    } else {
      shapes.push({ k: 'line', x1: plotX, y1: p, x2: plotX + plotW, y2: p, cls: 'grid' });
      shapes.push({ k: 'text', x: plotX - 6, y: p + 4, text: tickText[i], cls: 'tick', anchor: 'end' });
    }
  });
  shapes.push(horizontal
    ? { k: 'line', x1: r2(valPxRaw(baseV)), y1: plotY, x2: r2(valPxRaw(baseV)), y2: plotY + plotH, cls: 'axis' }
    : { k: 'line', x1: plotX, y1: r2(valPxRaw(baseV)), x2: plotX + plotW, y2: r2(valPxRaw(baseV)), cls: 'axis' });
  shapes.push(horizontal
    ? { k: 'line', x1: plotX, y1: plotY + plotH, x2: plotX + plotW, y2: plotY + plotH, cls: 'axis' }
    : { k: 'line', x1: plotX, y1: plotY + plotH, x2: plotX + plotW, y2: plotY + plotH, cls: 'axis' });

  // category / x labels
  if (kind === 'category') {
    const s = catLen / nCat;
    const step = Math.max(1, Math.ceil((horizontal ? 13 : rotate ? 13 : maxCat * TICK_PX + 8) / s));
    for (let i = 0; i < nCat; i += step) {
      const c = r2(catPx(i));
      if (horizontal) shapes.push({ k: 'text', x: plotX - 6, y: c + 4, text: catText[i], cls: 'tick', anchor: 'end', title: data.categories[i].label });
      else if (rotate) shapes.push({ k: 'text', x: c, y: plotY + plotH + 12, text: catText[i], cls: 'tick', anchor: 'end', rotate: -40, title: data.categories[i].label });
      else shapes.push({ k: 'text', x: c, y: plotY + plotH + 15, text: catText[i], cls: 'tick', anchor: 'middle', title: data.categories[i].label });
    }
  } else {
    for (const t of numTicks) {
      const x = r2(catStart + 10 + ((t.pos - contMin) / (contMax - contMin || 1)) * (catLen - 20));
      shapes.push({ k: 'line', x1: x, y1: plotY + plotH, x2: x, y2: plotY + plotH + 4, cls: 'axis' });
      shapes.push({ k: 'text', x, y: plotY + plotH + 16, text: t.label, cls: 'tick', anchor: 'middle' });
    }
  }
  if (xTitle) {
    shapes.push(horizontal
      ? { k: 'text', x: 12, y: plotY + plotH / 2, text: truncate(xTitle, 24), cls: 'axis-title', anchor: 'middle', rotate: -90 }
      : { k: 'text', x: plotX + plotW / 2, y: h - lh - 8, text: truncate(xTitle, 60), cls: 'axis-title', anchor: 'middle' });
  }
  if (yTitle) {
    shapes.push(horizontal
      ? { k: 'text', x: plotX + plotW / 2, y: h - lh - 8, text: truncate(yTitle, 60), cls: 'axis-title', anchor: 'middle' }
      : { k: 'text', x: 12, y: plotY + plotH / 2, text: truncate(yTitle, 24), cls: 'axis-title', anchor: 'middle', rotate: -90 });
  }

  // ---- marks
  const marks: Mark[] = [];
  const bySeries: number[][] = data.series.map(() => []);
  let thinned = 0;
  const tipRows = (ci: number, si: number): TipRow[] => {
    if (nSer > 8 || kind === 'category' && type === 'scatter') {
      const s = data.series[si];
      return [{ name: s.name, color: seriesColor(si), value: formatValue(s.values[ci]), active: true }];
    }
    return data.series.map((s, k) => ({ name: s.name, color: seriesColor(k), value: formatValue(s.values[ci]), active: k === si }));
  };
  const addMark = (m: Mark): number => {
    marks.push(m);
    bySeries[m.series].push(marks.length - 1);
    return marks.length - 1;
  };
  const catTitle = (ci: number) => data.categories[ci].label;
  const markBase = (ci: number, si: number, x: number, y: number, geo: Mark['geo']): Mark => ({
    x: r2(x), y: r2(y), cat: ci, series: si, title: catTitle(ci), rows: tipRows(ci, si),
    aria: `${catTitle(ci)}, ${data.series[si].name}: ${formatValue(data.series[si].values[ci])}`, geo,
  });
  const totalMarks = nCat * nSer;
  const interactive = totalMarks <= MARK_CAP;

  if (bars) {
    const inner = Math.min(slot * 0.78, 72 * (stacked ? 1 : nSer));
    const bw = stacked ? inner : Math.max(1, inner / nSer);
    const accPos = new Array<number>(nCat).fill(0), accNeg = new Array<number>(nCat).fill(0);
    const label = spec.labels && totalMarks <= 80;
    data.series.forEach((s, si) => {
      for (let ci = 0; ci < nCat; ci++) {
        const v = s.values[ci];
        if (v === null || (va.log && v <= 0)) continue;
        let from = baseV, to = v;
        if (stacked) {
          if (v >= 0) { from = accPos[ci]; accPos[ci] += v; to = accPos[ci]; } else { from = accNeg[ci]; accNeg[ci] += v; to = accNeg[ci]; }
        }
        const c0 = catPx(ci) - inner / 2 + (stacked ? 0 : si * bw);
        const a = valPx(from), b = valPx(to);
        const lo = Math.min(a, b), len = Math.max(Math.abs(a - b), v === 0 ? 0 : 1);
        const rect = horizontal ? { x: r2(lo), y: r2(c0), w: r2(len), h: r2(bw) } : { x: r2(c0), y: r2(lo), w: r2(bw), h: r2(len) };
        const mi = interactive ? addMark(markBase(ci, si, horizontal ? lo + len : c0 + bw / 2, horizontal ? c0 + bw / 2 : lo, { k: 'rect', ...rect })) : undefined;
        shapes.push({ k: 'rect', ...rect, fill: seriesColor(si), mark: mi });
        if (label) {
          const txt = formatTick(v);
          if (stacked) { if (len >= 14) shapes.push({ k: 'text', x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 + 4, text: txt, cls: 'label', anchor: 'middle' }); }
          else if (horizontal) shapes.push({ k: 'text', x: rect.x + rect.w + 4, y: rect.y + rect.h / 2 + 4, text: txt, cls: 'label', anchor: 'start' });
          else shapes.push({ k: 'text', x: rect.x + rect.w / 2, y: rect.y - 4, text: txt, cls: 'label', anchor: 'middle' });
        }
      }
    });
  } else {
    // line / area / scatter
    const maxPts = Math.max(240, Math.floor(plotW * 1.5));
    const labelPts = spec.labels && totalMarks <= 40;
    data.series.forEach((s, si) => {
      const pts: { ci: number; x: number; y: number }[] = [];
      for (let ci = 0; ci < nCat; ci++) {
        const v = s.values[ci];
        if (v === null || (va.log && v <= 0)) continue;
        pts.push({ ci, x: catPx(ci), y: valPx(v) });
      }
      if (!pts.length) return;
      const color = seriesColor(si);
      if (type === 'scatter') {
        const r = pts.length > 2000 ? 1.6 : pts.length > 400 ? 2.5 : 3.5;
        if (pts.length > 600) {
          // dense: one path of round-capped zero-length dashes, de-duplicated at 1 px
          const seen = new Set<number>();
          let d = '';
          for (const p of pts) {
            const key = Math.round(p.x) * 100_000 + Math.round(p.y);
            if (seen.has(key)) continue;
            seen.add(key);
            d += `M${r2(p.x)} ${r2(p.y)}h0`;
          }
          thinned += pts.length - seen.size;
          shapes.push({ k: 'dots', d, stroke: color, sw: r * 2 });
          const stride = Math.max(1, Math.ceil(pts.length / (MARK_CAP / nSer)));
          pts.forEach((p, k) => { if (k % stride === 0) addMark(markBase(p.ci, si, p.x, p.y, { k: 'dot', r: r + 2 })); });
        } else {
          for (const p of pts) {
            const mi = addMark(markBase(p.ci, si, p.x, p.y, { k: 'dot', r: r + 2 }));
            shapes.push({ k: 'dot', cx: r2(p.x), cy: r2(p.y), r, fill: color, mark: mi });
          }
        }
        bySeries[si].sort((a, b) => marks[a].x - marks[b].x || marks[a].y - marks[b].y);
        return;
      }
      // line / area: thin long lines to roughly two points per pixel with LTTB
      let keep = pts;
      if (pts.length > maxPts) {
        const idx = lttb(pts.map((p) => p.x), pts.map((p) => p.y), maxPts);
        keep = idx.map((i) => pts[i]);
        thinned += pts.length - keep.length;
      }
      const runs: { ci: number; x: number; y: number }[][] = [];
      for (const p of keep) {
        const run = runs[runs.length - 1];
        if (run && (keep === pts ? p.ci - run[run.length - 1].ci === 1 : true)) run.push(p);
        else runs.push([p]);
      }
      const baseY = valPx(baseV);
      let line = '', area = '';
      for (const run of runs) {
        const seg = run.map((p, k) => `${k ? 'L' : 'M'}${r2(p.x)} ${r2(p.y)}`).join('');
        line += seg;
        if (type === 'area') area += `${seg}L${r2(run[run.length - 1].x)} ${r2(baseY)}L${r2(run[0].x)} ${r2(baseY)}Z`;
      }
      if (type === 'area') shapes.push({ k: 'path', d: area, fill: color, stroke: 'none', sw: 0, fo: 0.2 });
      shapes.push({ k: 'path', d: line, fill: 'none', stroke: color, sw: 2 });
      const showDots = keep.length <= 60;
      const stride = Math.max(1, Math.ceil(keep.length / (MARK_CAP / nSer)));
      for (const [k, p] of keep.entries()) {
        const mi = k % stride === 0 ? addMark(markBase(p.ci, si, p.x, p.y, { k: 'dot', r: 5 })) : undefined;
        if (showDots) shapes.push({ k: 'dot', cx: r2(p.x), cy: r2(p.y), r: 3, fill: color, mark: mi });
        else if (mi !== undefined && keep.length <= SPARSE_MARKS) shapes.push({ k: 'dot', cx: r2(p.x), cy: r2(p.y), r: 5, fill: 'transparent', mark: mi });
        if (labelPts) shapes.push({ k: 'text', x: r2(p.x), y: r2(p.y - 8), text: formatTick(data.series[si].values[p.ci] ?? 0), cls: 'label', anchor: 'middle' });
      }
    });
  }
  shapes.push(...legendShapes(legendItems, 8, h - lh, w - 16));

  const name = TYPE_NAME[type];
  const title = `${name} chart of ${data.series.map((s) => s.name).join(', ')}${data.xName ? ` by ${data.xName}` : ''}`;
  const extra = [
    thinned ? `${thinned.toLocaleString()} points thinned for display` : '',
    data.droppedCategories ? `${data.droppedCategories} smaller categories hidden` : '',
    data.droppedSeries ? `${data.droppedSeries} more groups hidden` : '',
  ].filter(Boolean).join('; ');
  return {
    w, h, kind: 'cartesian', horizontal, title,
    desc: `${title}: ${nCat} ${kind === 'time' ? 'time points' : 'categories'}, ${nSer} series.${extra ? ` ${extra}.` : ''}`,
    shapes, marks, bySeries, thinned, message: null,
  };
}
