// The drawing model between the chart data and the SVG: pure geometry, no DOM. The renderer (ChartSvg) maps these
// shapes 1:1 to elements, which keeps the layout code unit-testable and the export a plain serialisation of the DOM.

export interface TipRow { name: string; color: string; value: string; active: boolean }

export type MarkGeo =
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'dot'; r: number }
  | { k: 'arc'; d: string };

/** One interactive data point: a bar, a line/scatter point or a pie slice. */
export interface Mark {
  /** Tooltip anchor in SVG pixels. */
  x: number;
  y: number;
  cat: number;
  series: number;
  title: string;
  rows: TipRow[];
  /** Screen-reader text. */
  aria: string;
  geo: MarkGeo;
}

export type Shape =
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: string; mark?: number }
  | { k: 'path'; d: string; fill: string; stroke: string; sw: number; fo?: number }
  | { k: 'dots'; d: string; stroke: string; sw: number }
  | { k: 'dot'; cx: number; cy: number; r: number; fill: string; mark?: number }
  | { k: 'arc'; d: string; fill: string; mark?: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; cls: 'grid' | 'axis' }
  | { k: 'text'; x: number; y: number; text: string; cls: 'tick' | 'axis-title' | 'label' | 'legend' | 'center' | 'kpi-value' | 'kpi-label'; anchor: 'start' | 'middle' | 'end'; rotate?: number; size?: number; title?: string };

export interface Scene {
  w: number;
  h: number;
  kind: 'cartesian' | 'pie' | 'kpi' | 'empty';
  /** Category axis runs vertically (horizontal bars): Up/Down arrows move between categories. */
  horizontal: boolean;
  title: string;
  desc: string;
  shapes: Shape[];
  marks: Mark[];
  /** Mark indices per series, in reading order (the keyboard walks these). */
  bySeries: number[][];
  /** Points dropped by downsampling (lines) or de-duplication (scatter). */
  thinned: number;
  /** Empty state text. */
  message: string | null;
}

export const empty = (w: number, h: number, message: string, title = 'Chart'): Scene => ({
  w, h, kind: 'empty', horizontal: false, title, desc: message, shapes: [], marks: [], bySeries: [], thinned: 0, message,
});

/** `var(--chart-N)`: the palette repeats after 8 series. */
export const seriesColor = (i: number) => `var(--chart-${(i % 8) + 1})`;

export const r2 = (n: number) => Math.round(n * 100) / 100;
/** Rough text width (11px UI font). */
export const textWidth = (s: string, size = 11) => s.length * size * 0.58;
export const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);
