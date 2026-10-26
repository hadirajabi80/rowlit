# Linked databases — WP-C (UI: link editor + visual query builder) notes

Base: WP0 `32f3723`. Owned paths only (wp0.md 2, WP-C): `ui/src/components/Links/**` (not `materialize/**`, `native/**`,
the LINKS-WPD blocks of `commands.ts`), `ui/src/store/links.ts`, `ui/src/mocks/packs/linked.ts`,
`engine/tests/DbStudio.Federation.Tests/Goldens/Builder/c-*.json`, this file. No frozen file was edited.

## 1. What is in

| Piece | Where | Notes |
|---|---|---|
| Commands, menus, tab view | `components/Links/commands.ts`, `open.ts` | `links.new {folder, connectAfter, members, addTables}`, `links.edit {connectionId, addTables}`, `links.duplicate`, `links.builder {connectionId}`, `links.builderAddTable`, `links.removeTable`, `links.openView`, `links.refreshSources`, `links.plan`, builder-scoped `links.undo/redo/toggleSql` + `links.run/cancel/saveView/openInConsole`, the `builder.*` menu commands. Menus registered with `registerContextMenu`: `explorer.link`, `explorer.linkTable`, `builder.canvas|table|column|join`; `extendContextMenu('explorer.savedQuery', [links.openView])`. View `links.builder` (lazy). |
| Link editor | `components/Links/editor/**` | Dialog in its own body-level React root (`host.tsx`): name, colour, folder; sources list; connection → database → schema → tables (fuzzy search with highlights, select matching / none, mount all, per-table rename), alias auto-slug (`slugifyAlias` + `uniqueAlias`) until edited, live validation (`isValidAlias`, duplicates, `isValidTableName`), engine `POST /links/validate` when available (local checks only on 501/404/network), drops of explorer rows, `addTables` / `members` pre-population, discard guard, save through `/connections` (other props, relations, options kept; caches forgotten), new link → opens the builder. `save.ts unmountTable` for "Remove from linked database…". |
| Query builder | `components/Links/builder/**` | See section 2. |
| Store | `store/links.ts` | Link catalogs (`GET /links/{cid}/catalog`, fallback rebuilt from the link's explorer catalog when the runtime answers 501/404), linked views, per-tab undo / redo history (coalescing per field, 100 steps). |
| Mock pack | `mocks/packs/linked.ts` | Provider `linked` (dialect duckdb) + `c_link` "Sales (linked)" in "Linked databases": `crm` → c_pg (customers, countries), `shop` → c_shop (orders, order_lines), `erp` → c_prod (products), two virtual relations. Patches the MockEngine instance (catalog per alias, `$name` binds inlined, a small SQL evaluator over the members' rows with hash joins, aggregates, ORDER/LIMIT, DuckDB-like errors) and serves every `/links` route (validate, catalog, compile via `compileBuilder`, parse of the canonical subset, plan with per-dialect source queries and caching, views mirrored into the link's saved queries under schema `views`, refresh-sources; materialize / native-script 501). |

## 2. The builder (view `links.builder`)

- **Layout**: toolbar (Run / Cancel, undo / redo, Save as view, Materialize… when `links.materialize` exists, Plan,
  Refresh sources, Open in console, Edit link, zoom / fit / auto layout) · left: sources and tables (search, click or
  Enter adds, drag onto the canvas) · centre: canvas · right: SQL · bottom tabs Columns, Filters, Group by (+ Having),
  Sort, Limit, Results (the normal `ResultsPane`, keyed by the tab id: grid, filters, export, code). All three panes
  resize (sizes persisted in the tab state).
- **Canvas** (`Canvas.tsx`, `BuilderCard.tsx`, `geometry.ts`): ErDiagram `viewport.ts` (zoom at point, fit, steps),
  `edges.ts routeEdge` for join curves and `Minimap.tsx` (4+ tables), imports only. Cards: member colour strip + alias
  badge, FROM marker, select-all (tri-state), collapse, menu, remove; rows with output checkbox, key marker, kind chip,
  aggregate / filter / sort / join marks; long tables scroll inside the card (anchors follow). Drag a column (or its
  port) onto a column of another card → join (INNER), the join editor opens; compatible kinds are highlighted while
  dragging. Join badges (Venn icon per type) open the editor; dashed "+" edges are suggestions (FK inside a member,
  virtual relations, naming `orders.customer_id → customers.id`, same-named key-ish columns); adding a table joins it
  automatically when confident (≥ 80) and places it next to its partner, with a canvas note "Joined … · Undo".
  Explorer drops (`application/x-rowlit-object`) of the link's own tables or of a member connection's mounted tables;
  others get a toast with "Add to link…" (WP-D's `links.addTable`).
- **Join editor** (`JoinPopover.tsx`): Inner / Left / Right / Full / Cross with Venn icons and a plain-words explanation,
  conditions (column, operator, column, Ignore case → `lower()`, Trim → `trim()`), "Different types" warning, add /
  remove conditions, remove join. A second path between joined tables is refused with an explanation.
- **Model rules** (`model.ts`): joins are kept in SQL order from the FROM table (flipped with LEFT↔RIGHT when drawn the
  other way); when the FROM table is not joined but others are, the first table of the largest joined group becomes
  FROM; a second joined group compiles with a `CROSS JOIN` of its first table (see R-C1). A colliding output name gets
  an alias (`countries_name`). Removing a table removes its joins, columns, filters, sort and group refs.
- **SQL panel** (`SqlPanel.tsx`): read-only `SqlEditor` (dialect duckdb) showing `compileBuilder`'s SQL (display layout
  breaks long SELECT / WHERE / ON / ORDER lines; "Values" shows binds inlined; Copy and Run use the canonical text),
  compile warnings (cartesian, joinKinds, limitWithoutOrder, filter). **Advanced**: editable `SqlEditor` with the link's
  catalog (IntelliSense), runs as written; "Back to builder" sends `inlineParams(sql, params, 'duckdb')`-style literal
  SQL to `POST /links/{cid}/parse` (unchanged SQL returns without parsing; `model: null` → confirm "discard SQL edits").
- **Run** (`actions.ts`): `useSessions.ensure(tabId, linkId)` + `api.execute` with `$fp` params, results in the tab's
  ResultsPane; Cancel through the session; Ctrl+Enter / Shift+F5 / Esc / Ctrl+S handled by the view (the console's
  global commands own those keys elsewhere). **Save as linked view**: `PUT /links/{cid}/views/{id|new}` with the inlined
  SQL and the model; the tab follows the view (title, key). **Plan**: `POST /links/{cid}/plan` → per source: provider
  logo, the source query, columns, pushed predicates / limit, cached / fetch, rows, warnings. **Materialize…**:
  `runCommand('links.materialize', { connectionId, sql, params, sessionId, name })` (WP-D).
- **Keyboard**: canvas focusable (+ / - / 0 / F, Shift+F10 menu), cards in Tab order (arrows move, Shift = 40 px, Delete
  removes, Enter goes to the columns, Shift+F10 / ContextMenu menu), join badges are buttons (Enter edits, Delete
  removes), the join editor's types are a radio group with arrow keys, bottom tabs with arrow keys, Ctrl+Z / Ctrl+Shift+Z
  / Ctrl+Y in the builder (text fields and Monaco keep their own undo), Ctrl+Alt+Q builder ↔ SQL.

## 3. Compiler (`builder/compile.ts`) and goldens

`compileBuilder(model, catalog)` follows the BuilderModel.cs header and WP-B.md section 2 (identical rules: SELECT items
and aliases, `ON TRUE` + cartesian for a non-cross join without conditions, CROSS JOIN for unreached tables, HAVING
kinds count → int / avg → float / expressions → other / else source kind, shared `$fp` numbering, refs, LIMIT / OFFSET,
warning codes compared as a sorted list). Wire models that leave out empty lists are accepted.
Goldens `c-001…c-006` (SELECT *, joins + quoting + self join + hidden sort helper, aggregates + HAVING + calculated
column + NULLS FIRST + LIMIT/OFFSET, explicit GROUP BY + DISTINCT + nested OR filter + cartesian + limitWithoutOrder,
explicit CROSS JOIN + joinKinds + bool / date / case-sensitive filters, ON TRUE + OFFSET only). Verified both ways:
the UI test passes all `b-000…b-010` (copied from main for the check, not committed here) and all `c-*`; WP-B's
`BuilderGoldenTests` on main (compile + parse round trip) pass with these `c-*` (34/34, run in a scratch copy).

## 4. Requests and notes for the integration

- **R-C1 (WP-B, optional)**: a join whose `left` is not attached yet is 400 in `BuilderCompiler`; the UI writes
  `CROSS JOIN <left>` (warning cartesian) before it, so a half-built canvas with two joined groups still runs. Only
  `POST /compile` differs (the UI runs its own compiled SQL); aligning would make the two compilers identical there too.
- **WP-D overlap resolved**: `links.addTable` and its explorer / Objects tab menu entries are WP-D's (WP-C registers
  neither); `links.new` reads `members` (WP-D's "Add to link… › New link…"); `links.builder {connectionId}` exists;
  the builder calls `links.materialize` with `{ connectionId, sql, params, sessionId, name }`.
- **Shell dialog host (orchestrator, optional)**: link dialogs use their own body-level React root (like WP-D's
  `mountDialog`); the shell's `askConfirm` renders below such a root, so the editor uses an inline discard bar instead.
  A shell-level host would remove both workarounds.
- **SqlEditor (optional)**: a `wordWrap` prop would let the SQL preview wrap instead of the display layout of
  `SqlPanel.previewLayout`.
- **Saved query opening (optional)**: double-click on a linked view in the explorer opens it in a console
  (`queries.open`); "Open in query builder" is on its context menu. The shell could route linked views with a builder
  model to `links.openView` by default.
- **Mock packs**: pack handlers run after the core catalog / session routes, so the linked pack patches the MockEngine
  instance (`schemasFor`, `defaultSchema`, `databases`, `interpret`, `execute`); a pack hook for catalogs would be
  cleaner.

## 5. Measurements

- **Initial load** (bundle-size.mjs): 1497.8 → **1498.0 KB** gzipped (**+0.2 KB**; budget +120 KB over the initial
  baseline, change +45.9 KB). Lazy: links commands chunk 5.9 KB gz (loaded with the other command modules), builder
  view 28.3 KB gz + CSS, link editor 8.6 KB gz. Total change +1145.7 KB (budget +1400).
- **Tests**: `npm run lint` 0 errors, `typecheck` clean; links tests 6 files / 69 tests (goldens, builder model + join
  inference + placement + undo, builder view over MSW, editor model + dialog, mock pack); full suite 224 files, the only
  failures under load were Redis `browser.test.tsx` and `tokens.test.ts` hook timeouts (both pass alone).
- **Engine goldens**: WP-B's `BuilderGoldenTests` (main) with the c-* goldens 34/34.
