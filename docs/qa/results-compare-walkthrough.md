# Pinned results and result comparison walkthrough (WP-7)

Mock mode (`cd ui && npm run dev:mock`), connect "Shop (SQLite)", open a console. Checked in light and dark with `ui/scripts/shot.mjs`.

## Pin

1. Run `SELECT id, name, country_id FROM customers WHERE id < 9`. Hover the **Result 1** tab: a pin button appears next to it (always visible on a pinned tab).
2. Click the pin (or the palette command **Pin result**, `Ctrl+Alt+K`; `Ctrl+Alt+P` is the query parameters dialog). The tab becomes a pinned tab: pin glyph, the source table as its title (`customers`, or `Result n`), its row count. The toolbar shows a **Pinned** badge; the grid is read-only and has no server filter (a pinned result is a copy of the rows loaded at that moment).
3. Run another query. The new result lands as **Result 1** next to the pinned tab; the pinned one keeps its rows. Pins are listed before the run's own tabs. Several pins of one console get `name`, `name (2)`, ...
4. The unpin button on a pinned tab removes the copy. While the run it was pinned from is still shown, the original result tab comes back; after a re-run the copy simply goes away.
5. A result that is still loading, was released from memory (Reload first) or has no columns cannot be pinned (the pin button is disabled / a toast says why).
6. Pins live in memory for the session. They are dropped with their console (closed, or moved to another window); they are not saved in the workspace.

## Compare

1. With a pinned result and a newer result in the same console, click **Compare with...** (the two-branch icon in the result toolbar; palette: **Compare result with...**). The menu lists the other result sets of this run and the pinned results of every console.
2. Pick the baseline. A tab **Compare: baseline ⇄ shown result** opens. A is the baseline, B the result you were looking at: **added** rows exist only in B, **removed** rows only in A.
3. The merged grid has a **Status** column. Added rows are green, removed rows red; a changed row is a pair of lines, **Changed (before)** and **Changed (after)**, with the differing cells red and green and the Status cell amber. The summary chips (+added, -removed, ~changed, =same) and the status line give the counts.
4. **Key** picks the columns that identify a row. It starts on the primary-key columns both results report; without any, whole rows are compared (a changed row then shows as one removed and one added row, and the notice says so). Rows with the same key occurring several times pair up in order and are counted in a notice.
5. **Ignore case**, **Trim text**, **Differences only** (on by default), **Search in differences**, **Swap A and B**.
6. Numbers compare by value (`1.50` = `1.5` = `1`), NULL equals NULL only, booleans equal 0/1, truncated values equal when their lengths agree and the previews overlap. Columns that only one side has are listed in a notice and not compared; columns with different types compare as text.
7. **Export**: the shown lines (Status column first) as CSV or Markdown to a file, or **Copy differences as Markdown**. The record view button shows the selected line transposed.
8. Warnings: a side that is truncated, still loading or released ("holds n of m rows"), missing key columns, duplicate keys.
9. Over 50,000 rows (both sets together) the diff runs in a Web Worker (`diff.worker.ts`); the tab shows "Comparing n rows..." meanwhile.
10. The compared rows are snapshots held in memory and released when the tab closes. After a restart the restored tab says "This comparison is no longer available" and offers to close.

Tests: `ui/src/components/ResultsCompare/__tests__/` (`diff.test.ts` matching, numbers, NULLs, duplicates, composite and missing keys, options; `merged.test.ts` merged lines, tints, CSV/Markdown; `compareView.test.tsx` the tab with two fixtures; `pinPane.test.tsx` the pane: pin, next run, unpin, command, close, Compare menu), `ui/src/store/resultsPins.test.ts` (pins survive `begin`, numbering, unpin, `clearTab`/`dropPins`), `ui/src/components/Grid/dataGrid.test.tsx` (`cellTint`).

Bundle: the view, diff and merge code are the lazy `ResultsCompareView` chunk (+ its CSS) and `diff.worker`; the compare menu code loads on the first click of **Compare with...**. The initial chunk grows by about 1.8 KB gzipped (pin tabs, store, toggle helpers).
