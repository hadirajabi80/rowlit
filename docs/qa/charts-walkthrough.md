# Result charts walkthrough (WP-4)

Mock mode (`cd ui && npm run dev:mock`), connect "Shop (SQLite)". Checked in light and dark with `ui/scripts/shot.mjs`.

1. Open the `orders` table (double-click). The Data tab toolbar has a **Grid | Chart | split** switch next to Export.
2. **Chart**: the grid is replaced by the chart panel. With no remembered settings the columns decide: a date X with a numeric Y gives a line chart of `sum(total)` by month.
3. Change Chart type to Bar and X axis to `status`: five bars. Chart type Donut: share labels, total in the middle, legend.
4. **Split** (the third button): grid and chart side by side; the record/value viewer stays on the right.
5. **Grid** goes back. The chart settings are remembered per query / table (localStorage `rowlit.chart.v1.<hash>`), so the next **Chart** click restores them.
6. Run a query in a console: the result toolbar has the same switch (priority 6, collapses into the "..." menu when narrow: "Show grid / Show chart / Show grid and chart").
7. Palette: "Toggle chart view of the results" (`results.toggleChart`) and "Export chart..." (`results.exportChart`; arg `format` png, svg or copy; only offered while a chart is shown).
8. **Export chart** menu in the panel: PNG, SVG, copy image.
9. Streaming: while rows load, the note "rows are still loading" shows and the chart follows the loaded rows; "the result is limited to the loaded rows" when truncated or more pages exist.

Tests: `ui/src/components/Charts/*` (pipeline layers, `resultsChart.test.tsx` result pane, `dataTabChart.test.tsx` Data tab and commands, `chartTokens.test.ts` palette contrast in every app theme).
Bundle: the chart module is the lazy `ChartPanel` chunk (+ its CSS); the initial chunk grows by about 0.9 KB gzipped (toggle, mode store, command descriptors, tokens).
