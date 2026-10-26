// Card geometry of the query builder canvas (pure): fixed-height rows, so a join edge anchors at its column row
// without measuring the DOM; long tables scroll inside the card (anchors follow the scroll and clamp to the body).
import type { BuilderTable } from '../../../api/links';
import type { Rect } from '../../ErDiagram/edges';

export const BCARD = {
  headerH: 40,
  rowH: 26,
  padY: 4,
  minW: 240,
  maxW: 340,
  /** Rows shown before the card body scrolls. */
  maxRows: 12,
  /** Footer with the "n of m columns" summary. */
  footH: 24,
} as const;

const CHAR = 7.2;

export interface CardSize {
  w: number;
  h: number;
  /** Visible body height (rows area). */
  bodyH: number;
  rows: number;
}

/** Size of a card for its column names and types. */
export function cardSize(t: Pick<BuilderTable, 'alias' | 'as' | 'table' | 'collapsed'>, columns: readonly { name: string; type: string }[]): CardSize {
  // header: strip, select-all, alias badge, name, FROM marker, three buttons
  let w = (t.alias.length + Math.max(t.as.length + 3, t.table.length)) * CHAR + 200;
  for (const c of columns) w = Math.max(w, 64 + c.name.length * CHAR + Math.min(14, c.type.length) * 6.4 + 24);
  w = Math.round(Math.min(BCARD.maxW, Math.max(BCARD.minW, w)));
  if (t.collapsed) return { w, h: BCARD.headerH, bodyH: 0, rows: columns.length };
  const shown = Math.min(BCARD.maxRows, Math.max(1, columns.length));
  const bodyH = shown * BCARD.rowH + BCARD.padY * 2;
  return { w, h: BCARD.headerH + bodyH + BCARD.footH, bodyH, rows: columns.length };
}

/** Diagram y of a column row's centre (clamped to the visible body when scrolled out; the header when collapsed). */
export function rowAnchor(t: Pick<BuilderTable, 'y' | 'collapsed'>, size: CardSize, index: number, scrollTop = 0): number {
  if (t.collapsed || index < 0) return t.y + BCARD.headerH / 2;
  const top = t.y + BCARD.headerH;
  const y = top + BCARD.padY + index * BCARD.rowH + BCARD.rowH / 2 - scrollTop;
  return Math.max(top + 6, Math.min(top + size.bodyH - 6, y));
}

export function cardRectOf(t: Pick<BuilderTable, 'x' | 'y'>, size: CardSize): Rect {
  return { x: t.x, y: t.y, w: size.w, h: size.h };
}

/** Where a new card goes: right of the rightmost card (top-aligned), or the origin. */
export function nextCardPosition(tables: readonly Pick<BuilderTable, 'x' | 'y'>[], sizes: readonly CardSize[]): { x: number; y: number } {
  if (!tables.length) return { x: 40, y: 40 };
  let best = 0;
  for (let i = 1; i < tables.length; i++) if (tables[i].x + (sizes[i]?.w ?? 0) > tables[best].x + (sizes[best]?.w ?? 0)) best = i;
  const right = tables[best].x + (sizes[best]?.w ?? BCARD.minW);
  return { x: right + 120, y: tables[best].y };
}

export interface PlacedCard { id: string; x: number; y: number; w: number; h: number }

const GAP_X = 110;
const GAP_Y = 48;
/** Cards flow left to right and wrap below past this width (diagram units). */
export const FLOW_WIDTH = 1100;

const overlaps = (a: Omit<PlacedCard, 'id'>, b: Omit<PlacedCard, 'id'>) =>
  a.x < b.x + b.w + 24 && b.x < a.x + a.w + 24 && a.y < b.y + b.h + 24 && b.y < a.y + a.h + 24;

/**
 * Position of a new card of size w × h: next to the card it joins (`near`: right of it, moving down until free), else
 * in reading order after the others, wrapping into a new row past FLOW_WIDTH.
 */
export function placeCard(cards: readonly PlacedCard[], w: number, h: number, near?: PlacedCard | null): { x: number; y: number } {
  const free = (x: number, y: number) => !cards.some((c) => overlaps({ x, y, w, h }, c));
  if (near) {
    const x = near.x + near.w + GAP_X;
    for (let k = 0; k < 40; k++) {
      const y = near.y + k * GAP_Y;
      if (free(x, y)) return { x, y };
    }
  }
  if (!cards.length) return { x: 40, y: 40 };
  const rowTop = Math.max(...cards.map((c) => c.y));
  const row = cards.filter((c) => c.y + c.h > rowTop - 10);
  const right = Math.max(...row.map((c) => c.x + c.w));
  let x = right + GAP_X;
  let y = Math.min(...row.map((c) => c.y));
  if (x + w > FLOW_WIDTH) {
    x = 40;
    y = Math.max(...cards.map((c) => c.y + c.h)) + GAP_Y;
  }
  for (let k = 0; k < 60 && !free(x, y); k++) y += GAP_Y;
  return { x, y };
}
