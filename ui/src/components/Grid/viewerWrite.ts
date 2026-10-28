// The value viewer's write path into the grid's pending edits. Kept apart from editValue.ts (which carries the typed-text
// parsers) so that the result views can import it without pulling those into the initial load.
import type { CellValue } from '../../api/types';
import { useEdits } from '../../store/edits';
import type { RowRef } from './gridTypes';

/**
 * The value viewer's Apply: the same write as typing the value into the cell, so the pending buffer, Save and Discard
 * behave as for any other edit. `original` is the value of the source row before any pending edit (the buffer drops an
 * edit that sets it back).
 */
export function setCellFromViewer(gridKey: string, ref: RowRef, col: number, value: CellValue, original: CellValue): void {
  if (ref.ins) useEdits.getState().setInsertCell(gridKey, ref.ins.id, col, value);
  else useEdits.getState().setCell(gridKey, ref.src, col, value, original);
}
