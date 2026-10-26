# WP-D — DuckDB IntelliSense, Materialize / Add to link / Native link wizards (notes for the orchestrator)

Branch `worktree-agent-a07344ce986d9e9e4`, on top of WP0 (`32f3723`). file:line references are to that commit.

## What landed

- **Dialect** `ui/src/intel/dialect/duckdb.ts` (lazy chunk, `define(kit)`, no runtime import from the shell): reserved and
  contextual keywords, data types (HUGEINT, STRUCT, LIST, MAP, UNION, ENUM, UUID, TIMESTAMPTZ …), operators (`::`, `->`,
  `->>`, `//`, `**`, `^@`, `:=`, `~~` …), statement heads, the **lexer hook for `$name`** (`$name` and `$fp1` are `param`
  tokens; `$1`, `?`, `$$…$$` and `$tag$…$tag$` bodies keep their trait behaviour; a `$tag` closed by `$` is a string), E / X / B
  string prefixes, FROM-first / DESCRIBE / SUMMARIZE / SHOW / PIVOT / UNPIVOT classified as queries and COPY / EXPORT /
  IMPORT / INSTALL / LOAD / CHECKPOINT as `other` (the engine's `ReadOnlyGuard` refuses them), `DialectSpec.complete`
  (`duckdbComplete`) that offers table functions in FROM / JOIN (`range`, `generate_series`, `unnest`, `duckdb_tables()` …:
  the shared completer only does that for T-SQL / SQLite / PostgreSQL).
- **Functions** `data/duckdb-functions.json`: 489 entries with signatures, doc and return type: string, pattern, numeric,
  date / time / interval, list (incl. lambdas), struct, map, union, JSON, enum, bit, utility, 100+ aggregates, window
  functions, table functions with their output columns, niladic keywords; 26 operators. (Generated from a compact source
  list, not committed; edit the JSON.) File / network table functions (`read_csv`, `read_parquet` …) are left out on
  purpose: the federation DuckDB runs with `enable_external_access = false`.
- **Completion over the link catalog** needed no completer change: aliases are schemas (`FROM crm.` → mounted tables),
  `crm.customers.` → columns with their types, FK joins and virtual relations come from the catalog's `fk` entries, also
  across aliases (`JOIN customers c ON c.id = i.customer_id`, and the reverse direction writes `erp.invoices i ON …`).
  Tests: `ui/src/intel/__tests__/duckdb.test.ts` (29 tests) over a two-alias link and the `shop-duckdb.json` fixture (now with
  DuckDB column types and a cross-alias relation `archive.orders_2020 → shop.customers`).
- **Formatter** `format/rules/duckdb.ts`: QUALIFY is a condition clause (broken at AND / OR), ASOF / SEMI / ANTI / POSITIONAL
  join words, `COLUMNS` / `UNNEST` / `STRUCT` / `MAP` called like functions, FROM-first statements, EXCLUDE / REPLACE.
- **Snippets** `snippets/data/duckdb.ts`: 98 snippets (plus the 6 shared ones) over the 5 categories (joins across links members, GROUP BY ALL,
  window functions, QUALIFY, PIVOT / UNPIVOT, ASOF, lambdas and list comprehensions, `\$name` parameters, DBA views such as
  `duckdb_tables()`); `snippets/library.test.ts` now holds duckdb to the shape rules (WP-D block + 4 `'duckdb'` additions to
  the dialect hygiene allow-lists on lines outside the block: ILIKE, GENERATE_SERIES, LIMIT, QUALIFY — R3 note, the file is
  in the assignment's owned list).
- **Materialize dialog** `components/Links/materialize/MaterializeDialog.tsx`: target writable connection › database ›
  schema (from the catalog store), table name with live validation (datalist of existing tables for Replace / Append),
  modes create / replace / append, DDL preview from `POST /links/{cid}/materialize/preview` (debounced, newest wins),
  confirm checkbox before a replace drops an existing table, progress from `job.progress` (`done` / `total`, JSON message
  tolerated), cancel with `DELETE /jobs/{id}`, result with **Open table**; remembers the last target (localStorage, optional).
  `job.done` events that arrive before the 202 are remembered (`materialize/jobs.ts`).
- **Native link wizard** `components/Links/native/NativeLinkDialog.tsx`: link › member › target server (never the member's own
  server; only providers that can host a native link), kind (from `availableKinds`), name, script from
  `POST /links/{cid}/native-script` with `<password>`-style placeholders marked, notes, **Copy script** and **Open in console**
  (a console on the target connection titled `Native link: <alias>`). Rowlit never runs the script.
- **Add to link…** `materialize/AddToLinkDialog.tsx` + `addToLink.ts`: pick a link (or New link…), the table joins the member of
  its connection / database / schema (a new member with a unique slug alias otherwise; `allTables` and duplicates are
  detected), saved through `PUT /connections/{id}` (`useConnections.save`, other props kept).
- **Commands** (registered from the LINKS-WPD block of `components/Links/commands.ts` through `registerMaterializeCommands()` /
  `registerNativeLinkCommands()`): `links.materialize`, `links.addTable`, `links.nativeLink` (palette entries, category
  Database). `extendContextMenu`: `links.addTable` on `explorer.table` and `explorer.view` (hidden for links and non-relational
  sources, so also in the Objects tab which uses the same menus), `links.materialize` on `explorer.linkTable`,
  `links.nativeLink` on `explorer.connection` (only a link's row) and `explorer.link`.
- **Self-hosted modals** `materialize/mount.tsx`: `mountDialog(key, area, render)` creates its own React root on `<body>`
  (one dialog per key, ErrorBoundary around it); there is no generic dialog host in `App.tsx`.
- **Tests** (UI jsdom suite, MSW mock engine): `materialize/model.test.ts` (16), `materialize/materialize.test.tsx` (14),
  `native/native.test.tsx` (10); intel suite `intel/__tests__/duckdb.test.ts` (29), `snippets/library.test.ts` (duckdb).

## Arguments the commands take (for WP-C)

| Command | Arguments |
|---|---|
| `links.materialize` | `{ connectionId: <link id>, sql?: string, viewId?: string, params?: QueryParam[], sessionId?: string, name?: string }` — SQL or a linked view id; `sessionId` reuses that console's fetched sources; `name` seeds the table name. Without arguments: the active linked console's statement (selection or cursor statement, `$name` values asked with the Parameters dialog). An explorer `ObjectTarget` on a link's table = `SELECT * FROM alias.table`. |
| `links.addTable` | an explorer `ObjectTarget` of a table / view, or `{ connectionId, database, schema, name, type }` |
| `links.nativeLink` | `{ linkId \| connectionId, memberAlias?, targetConnectionId? }`, a `ConnectionTarget` of a link, or nothing (the active linked console / the dialog's link picker) |

## Requests (R3)

1. **`links.new` should accept `{ members?: LinkMember[], connectAfter?: boolean, folder?: string }`** (WP-C). "Add to link… ›
   New link…" calls `runCommand('links.new', { members: [member], connectAfter: false })`, so the editor opens with that
   member and its table already mounted. Until WP-C reads `members`, the editor simply opens empty.
2. **`links.builder { connectionId }`** is called by the "Added … to <link>" toast action ("Open query builder"); it is WP-C's
   reserved id. A missing command is a no-op.
3. **Materialize from the builder / results pane**: call `runCommand('links.materialize', { connectionId, sql, params, sessionId })`
   with the compiled SQL (builder) or `{ connectionId, viewId }` (linked view). `sql` must be a SELECT.
4. **Generic dialog host (optional, `App.tsx` is frozen)**: `mountDialog` works but a shell-level host would put dialogs inside
   the app's providers/theme root. If the orchestrator adds one, `materialize/mount.tsx` is the only file to change.
5. **Engine (WP-B)**: `job.progress` of the materialize job — the UI reads `done` as rows written and `total` as the expected
   count (or a JSON `message` `{ rows, total, phase }`); `job.done.result` must be `MaterializeResult` (`table` required).
   `native-script` should answer `NOT_SUPPORTED` / `VALIDATION` with a readable message for pairs it cannot script (the dialog
   shows it as is) and put every secret in `placeholders` as the exact text used in the script.
6. **Explorer**: `explorer.linkTable` / `explorer.link` entries (`links.materialize`, `links.nativeLink`) appear once WP-C
   registers those menus with `registerContextMenu` (`hasContextMenu` ignores extensions alone).
7. **Drag and drop** of explorer rows into the builder canvas (`application/x-rowlit-object`) belongs to WP-C's canvas; WP-D has no
   drop target. The Add to link… dialog is the non-drag route.

## Measurements

See the final report of the work package (initial-load delta, bundle budget, test counts).
