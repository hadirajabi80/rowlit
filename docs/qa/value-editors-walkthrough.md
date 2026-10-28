# Value editors walkthrough (WP-8)

Mock mode (`cd ui && npm run dev:mock`), connect "Shop (SQLite)", open `products` (Ctrl+P, type `products`, Ctrl+Enter). Checked in light and dark with `ui/scripts/shot.mjs`.

1. Select a `thumbnail` cell of an odd-numbered row (ids 1, 3, ...) and press **Shift+Enter** (or the Value viewer button in the toolbar, or right-click > View value). The viewer opens on the right with the pills **Hex | Image**; Image is chosen because the bytes start with the PNG signature. It shows the picture on a checkerboard, its size (48 x 32 px) and a fit / actual size toggle. SVG text shows as an image too.
2. **Hex** shows the dump (first 64 KB; a note says so for larger values). **Save to file** writes the bytes (`thumbnail.png`).
3. Select a `spec` cell (XML) and press Shift+Enter: the viewer opens in **edit mode** with Monaco (XML highlighting). Break the markup: the error line (`Not well-formed XML: ... (line, column)`) appears, a marker is drawn, and **Apply** is disabled. **Format** indents. **Set NULL** is offered when the column allows NULL.
4. Fix the text and press **Apply** (or Ctrl+Enter): the cell shows the pending edit in the grid, the viewer shows the **Edited** badge, and the Save (1) / Discard bar appears. Ctrl+Z in the grid undoes it. Saving works as for any cell edit.
5. JSON columns (`customers.profile`) behave the same with JSON validation; a text column in JSON mode only warns, it does not block.
6. **Load from file** (folder icon, or command "Load cell value from file..."): for a binary column it replaces the bytes at once (pending edit, image preview updates); for a text column the file text goes into the editor and Apply decides. Files over 16 MB, and non-text files for a text column, are refused with a message.
7. Edit refuses values over 8 MB of text ("too large to edit here"); truncated text is fetched in full before editing.
8. Read-only grids (joins, read-only connections) show the same viewer without Edit / Load.

Commands: `grid.editInViewer` (Shift+Enter), `grid.saveCellToFile`, `grid.loadCellFromFile` (Grid/commands.ts).

Tests: `ui/src/components/Grid/cellViewer/modes.test.ts` (mode detection, magic numbers, drafts), `ui/src/components/Grid/cellViewer.test.tsx` (viewer, editor, apply, files, writing into the edit buffer), `grid.test.ts` (binary columns writable through the viewer only).
Bundle: the viewer is a lazy chunk (`CellViewer`), Monaco loads only when someone edits (`MonacoEditor` chunk). The initial chunk shrank (the old viewer left it).
