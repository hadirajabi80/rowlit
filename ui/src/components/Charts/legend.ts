// Legend layout: swatch + name items wrapped into rows across the bottom of the chart.
import { r2, textWidth, truncate, type Shape } from './sceneTypes';

const ROW_H = 18;

export interface LegendItem { name: string; color: string }

export function legendHeight(items: LegendItem[], width: number): number {
  return items.length ? layout(items, width).rows * ROW_H + 6 : 0;
}

function layout(items: LegendItem[], width: number): { rows: number; at: { x: number; row: number }[] } {
  const at: { x: number; row: number }[] = [];
  let x = 0, row = 0;
  for (const it of items) {
    const w = 18 + textWidth(truncate(it.name, 28)) + 14;
    if (x > 0 && x + w > width) { x = 0; row++; }
    at.push({ x, row });
    x += w;
  }
  return { rows: row + 1, at };
}

/** Shapes of the legend, its top edge at `top`, centred in [left, left + width]. */
export function legendShapes(items: LegendItem[], left: number, top: number, width: number): Shape[] {
  if (!items.length) return [];
  const { at, rows } = layout(items, width);
  // centre each row
  const rowWidth: number[] = Array(rows).fill(0);
  items.forEach((it, i) => { rowWidth[at[i].row] = Math.max(rowWidth[at[i].row], at[i].x + 18 + textWidth(truncate(it.name, 28)) + 14); });
  const out: Shape[] = [];
  items.forEach((it, i) => {
    const ox = left + at[i].x + Math.max(0, (width - rowWidth[at[i].row]) / 2);
    const cy = top + 3 + at[i].row * ROW_H + ROW_H / 2;
    out.push({ k: 'rect', x: r2(ox), y: r2(cy - 5), w: 10, h: 10, fill: it.color });
    out.push({ k: 'text', x: r2(ox + 15), y: r2(cy + 4), text: truncate(it.name, 28), cls: 'legend', anchor: 'start', title: it.name });
  });
  return out;
}
