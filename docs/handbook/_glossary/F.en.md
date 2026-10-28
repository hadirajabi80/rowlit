<!-- Glossary fragment of writer package F (II-10, II-12, II-13, II-14, II-15, II-20). Package H merges it into en/glossary.md. -->
<!-- Row format: anchor, term, beginner meaning (first sentence), deeper note (second), owner chapter. -->

<a id="aggregate-strip"></a>
### aggregate strip
A status row that shows Count, Sum, Avg, Min and Max of the selected grid cells. Decimals are summed exactly with `BigInt`, so totals do not drift. *Owner: II-13.*

<a id="animation-frame-batching"></a>
### animation-frame batching
Applying many incoming events in one go, once per screen frame (about 16 ms). The results store queues events per execution and flushes on `requestAnimationFrame`, so a 100 000-row stream costs one React update per frame. *Owner: II-13.*

<a id="bidi-rtl-text"></a>
### bidi / RTL text
Text that reads right to left (Persian, Arabic, Hebrew) or mixes directions. The grid decides direction by the first strong character (Unicode UAX #9) and draws RTL cells with the canvas in RTL mode. *Owner: II-13.*

<a id="bridge"></a>
### bridge (`window.dbstudio`)
The object the Electron preload exposes to the page. Its TypeScript contract is `DbStudioBridge`; new members are optional so older preloads still work. *Owner: II-20.*

<a id="bulk-load"></a>
### bulk load
Writing many rows with the database's fast path instead of one INSERT per row (`SqlBulkCopy`, PostgreSQL `COPY`, ClickHouse native insert). Rowlit uses it only for append and truncate-insert modes. *Owner: II-15.*

<a id="bundle-budget"></a>
### bundle budget
A limit on how much the gzipped UI build may grow over a committed baseline (+1 400 KB total, +120 KB initial load in CI). It forces new features to be lazy chunks. *Owner: II-20.*

<a id="cache-invalidation"></a>
### cache invalidation
Throwing away or refreshing cached data when the source changed. After DDL the engine reloads the affected schemas and bumps their version. *Owner: II-10.*

<a id="canvas-grid"></a>
### canvas grid
A table drawn on an HTML `<canvas>` instead of as DOM rows. Rowlit's results grid uses glide-data-grid, so cost depends on the visible cells, not on the row count. *Owner: II-13.*

<a id="catalog"></a>
### catalog
The database's description of itself: its tables, columns, keys, views, routines. Read from system views such as `pg_catalog` or `sys.*`. *Owner: II-10.*

<a id="catalog-version"></a>
### catalog version
An integer the engine increments whenever a cached database catalog is reloaded. It is part of the ETag and is never reused. *Owner: II-10.*

<a id="cell-kind"></a>
### cell kind
The column's `ColumnKind` (`int`, `decimal`, `string`, `datetime`, `guid`, `binary`, ...) sent with the result. The grid picks alignment, formatting and editors from it. *Owner: II-13.*

<a id="cell-viewer"></a>
### cell viewer
A side panel that shows one full cell value, fetching it from the engine's stored result when the grid holds only a truncated prefix. *Owner: II-13.*

<a id="chord"></a>
### chord
A shortcut of two strokes pressed one after the other, such as `Ctrl+K Ctrl+S`. The dispatcher waits 1.5 s for the second stroke. *Owner: II-20.*

<a id="chunk"></a>
### chunk
A separately downloaded file of the built UI. `lazy(() => import(...))` creates one per screen or feature. *Owner: II-20.*

<a id="chunked-list"></a>
### chunked list
An append-only list stored as fixed-size chunks (2 048 items). Appending never copies old items, so results can grow to millions of rows. *Owner: II-13.*

<a id="code-generation"></a>
### code generation
Turning tables, views and routines into source code (C#, Go, TypeScript, Java, Python, SQL, JSON). Pure TypeScript in `ui/src/codegen`. *Owner: II-14.*

<a id="code-splitting"></a>
### lazy loading / code splitting
Loading code only when it is first needed. Large Rowlit screens are `lazy()` components, so startup stays small. *Owner: II-20.*

<a id="command"></a>
### command
A registered user action with an id, title, optional shortcut, scope, `when` and `run`. Buttons, menus and keys only dispatch commands. *Owner: II-20.*

<a id="command-registry"></a>
### command registry
The module that stores all commands, resolves shortcuts and reports conflicts. It is framework-free so any package can register from its `commands.ts`. *Owner: II-20.*

<a id="command-scope"></a>
### command scope
Where a shortcut is active: `global`, `editor`, `grid`, `explorer`, `designer`, ... A key is resolved by walking from the focused element's innermost `data-command-scope` outwards. *Owner: II-20.*

<a id="compare-with-server"></a>
### compare with server
A diff of the object's current server definition against the text in an "Edit:" console, shown in a Monaco diff editor. *Owner: II-14.*

<a id="component"></a>
### component
A React function that returns UI. Rowlit keeps logic in pure modules and stores, and components mostly draw. *Owner: II-20.*

<a id="conditional-request"></a>
### conditional request / 304
A request that carries `If-None-Match: <etag>`. If nothing changed the server answers `304 Not Modified` with no body. *Owner: II-10.*

<a id="connection-guard"></a>
### connection guard
`ConnectionGuard`: runs catalog and session-open calls with a deadline and detects dead connections, so a vanished server cannot hang the app. *Owner: II-10.*

<a id="contrast-ratio"></a>
### contrast ratio
The WCAG measure of how different two colours are. Rowlit's tests require 4.5:1 for text and 3:1 for UI parts for every theme. *Owner: II-20.*

<a id="culling"></a>
### culling
Not drawing what is off screen. The ER diagram renders only cards and edges inside the padded viewport. *Owner: II-15.*

<a id="data-tab"></a>
### Data tab
A tab that shows one table or view page by page, with server-side filter and sort, and in-place editing when the table has a key. *Owner: II-13.*

<a id="ddl-apply-runner"></a>
### DDL apply runner
`DdlApplyRunner`: executes a designer script on a dedicated connection, in one transaction when asked, and throws `DDL_FAILED` with the failing index. *Owner: II-14.*

<a id="ddl-preview"></a>
### DDL preview
The generated script shown as editable text before it is applied. *Owner: II-14.*

<a id="ddl-scripter"></a>
### DDL scripter
`IDdlScripter`: a pure per-provider component that turns a table model (or the diff of two) into DDL statements. *Owner: II-14.*

<a id="decoration"></a>
### decoration
A visual mark on editor text (a highlight, an inline hint) that is not part of the text. Rowlit uses them for the run flash and the parameter hint. *Owner: II-12.*

<a id="default-schema"></a>
### default schema
The schema used when a name is not qualified. The engine reports one per database; some dialects also let a session change it. *Owner: II-10.*

<a id="dependency"></a>
### dependency (uses / used by)
A relation between objects: a view *uses* a table, a trigger is *used by* a table. The engine returns one level of both directions. *Owner: II-10.*

<a id="describe"></a>
### describe
Asking the server for the result columns of a `SELECT` without running it (`SchemaOnly`). *Owner: II-14.*

<a id="design-token"></a>
### design token
A named design value, here a CSS custom property such as `--bg-panel`. Colours are written only in the theme files. *Owner: II-20.*

<a id="designer"></a>
### designer
A form-based editor for a table, view or routine that produces DDL instead of requiring hand-written SQL. *Owner: II-14.*

<a id="designer-database"></a>
### designer database
`IDesignerDatabase`: the I/O side of the designer. It reads models and applies scripts on its own short-lived connection. *Owner: II-14.*

<a id="detached-window"></a>
### detached window
A second Electron window that shows tabs moved out of the main window. It runs its own copy of the UI. *Owner: II-20.*

<a id="edit-console"></a>
### edit console
A console opened by F4 on a procedure, view, trigger and similar objects, holding a re-runnable `CREATE OR ALTER/REPLACE` script. Ctrl+S applies it to the database. *Owner: II-14.*

<a id="editor-group"></a>
### editor group
One tab strip with its own active tab. Up to three groups can be split side by side or stacked. *Owner: II-20.*

<a id="error-boundary"></a>
### error boundary
A React component that catches render errors in its subtree and shows a panel instead of unmounting the app. *Owner: II-20.*

<a id="error-report"></a>
### error report
The CSV of rows an import could not write, with row number, column and message. Served by `GET /import/errors/{jobId}`. *Owner: II-15.*

<a id="er-diagram"></a>
### ER diagram
An entity-relationship diagram: tables as cards, foreign keys as lines. Rowlit's can create foreign keys by dragging. *Owner: II-15.*

<a id="estimated-vs-actual-plan"></a>
### estimated / actual plan
An estimated plan is the optimiser's choice without running the statement. An actual plan runs it and adds real row counts and timings. *Owner: II-15.*

<a id="etag"></a>
### ETag
A short tag that identifies a version of a response. Rowlit's is a hash of connection, database, versions and schema names, prefixed by a per-start epoch. *Owner: II-10.*

<a id="explorer-node"></a>
### explorer node
One row of the explorer tree with a stable string id (`c:`, `d:`, `s:`, `f:`, `o:`, `sq:` prefixes). *Owner: II-10.*

<a id="export-scope"></a>
### export scope
What an export writes: `loaded`, `selection`, `filtered`, `all` or `rerun`. The last three run a fresh query in the engine with no row cap. *Owner: II-15.*

<a id="find-in-database"></a>
### Find in database
Search of object names, columns, code and optionally table data across connections, streamed as `db.search`. *Owner: II-10.*

<a id="font-zoom"></a>
### font zoom
Changing the editor font size with Ctrl + wheel (9 to 32 px) without touching the whole-window zoom. *Owner: II-12.*

<a id="foreign-catalog"></a>
### foreign catalog
The cached catalog of *another* database of the same server, used by IntelliSense for names such as `Other.dbo.Orders`. *Owner: II-10.*

<a id="format-options"></a>
### format options
`settings.format`: keyword and identifier case, indent, comma style, line width, blank lines. Validated and clamped by `resolveFormatOptions`. *Owner: II-12.*

<a id="formatted-ddl"></a>
### formatted DDL
The object tab's DDL shown through the formatter, with a toggle to see the stored text. *Owner: II-12.*

<a id="formatter"></a>
### formatter
Code that rewrites SQL layout without changing meaning. Rowlit's is token-based and verified by a token-equality check. *Owner: II-12.*

<a id="fuzzy-filter"></a>
### fuzzy filter
Matching where the typed letters need only appear in order (`ordl` finds `order_lines`), ranked by word starts and contiguity. *Owner: II-10.*

<a id="ghost-card"></a>
### ghost card
A name-only table card in the ER diagram for a table that a foreign key points to but that is not part of the diagram. *Owner: II-15.*

<a id="grid-controller"></a>
### grid controller
An imperative handle each grid registers by key so commands can act on the focused grid. *Owner: II-13.*

<a id="hook"></a>
### hook
A React function starting with `use` that adds state or effects to a component, such as `useState` or `useCatalog`. *Owner: II-20.*

<a id="import-dialect"></a>
### import dialect
`ImportDialect`: per-engine import knowledge: quoting, types, `CREATE TABLE`, upsert syntax, savepoints, bulk method. *Owner: II-15.*

<a id="import-wizard"></a>
### Import Wizard
The six-step tab (Source, Format, Target, Columns, Options, Run) that loads CSV, TSV, XLSX, JSON and NDJSON files into a table. *Owner: II-15.*

<a id="keyless-table"></a>
### keyless table
A table with no primary key. Paging it needs a stable order (`rowid`, `ROWID` or ordered columns) and editing needs a row identity. *Owner: II-13.*

<a id="keymap"></a>
### keymap
The effective shortcuts: command defaults plus the user's overrides in `settings.ui.keybindings`. *Owner: II-20.*

<a id="keymap-preset"></a>
### keymap preset
A set of overrides that imitates another tool (JetBrains, VS Code, SSMS). *Owner: II-20.*

<a id="language-id"></a>
### language id
The name Monaco uses for a language, here one per dialect, such as `dbstudio-pgsql`. *Owner: II-12.*

<a id="layout-engine-dagre"></a>
### layout engine (dagre)
The library that computes layered graph layouts. The ER diagram runs it in a Web Worker. *Owner: II-15.*

<a id="layout-rule"></a>
### layout rule
A per-dialect table of the formatter (statement-start words, function-like keywords, extra clauses). *Owner: II-12.*

<a id="lazy-loading"></a>
### lazy loading
Loading data only when needed: the catalog loads one schema when its node is expanded. *Owner: II-10.*

<a id="level-of-detail"></a>
### level of detail (LOD)
Drawing less when zoomed out. ER cards become header-only below zoom 0.45 and boxes below 0.2. *Owner: II-15.*

<a id="local-history"></a>
### local history
A private, compressed timeline of each console's text, with diff, restore and labels. Stored in the engine's `local-history.db`. *Owner: II-12.*

<a id="local-history-snapshot"></a>
### snapshot (local history)
One saved version of an editor's text, taken on run, save, close or every two minutes while typing. Labelled snapshots are never pruned. *Owner: II-12.*

<a id="lru-cache"></a>
### LRU cache
A cache that, when full, drops the least recently used entries first. The catalog cache budget is 128 MB by default. *Owner: II-10.*

<a id="lttb"></a>
### LTTB
Largest-Triangle-Three-Buckets: a downsampling method that keeps the visual shape of a long line with few points. *Owner: II-13.*

<a id="mapping"></a>
### mapping
In an import, the assignment of each target column to a source column, a constant or an expression. *Owner: II-15.*

<a id="marker"></a>
### marker
A squiggle with a message in the editor. Rowlit keeps separate marker owners for soft, server, execution and formatter diagnostics. *Owner: II-12.*

<a id="menu-model"></a>
### menu model
Pure data (`MENUS`, `CONTEXT_MENUS`) from which both the native menu and the in-app context menus are built. *Owner: II-20.*

<a id="metadata"></a>
### metadata
Data about data; here, the catalog. *Owner: II-10.*

<a id="minimap"></a>
### minimap
A small overview (180 x 120 px) of the whole ER diagram with the viewport as a frame. *Owner: II-15.*

<a id="monaco"></a>
### Monaco
The code editor component of Visual Studio Code, embedded in Rowlit for consoles and previews. *Owner: II-12.*

<a id="monaco-action"></a>
### Monaco action
A named, optionally keyed operation attached to one editor instance. Rowlit re-registers key-bound actions when the keymap changes. *Owner: II-12.*

<a id="monaco-model"></a>
### model / URI (Monaco)
A Monaco text model is the document; its URI (`dbstudio-tab://tab/<id>.sql`) lets providers find the right editor's IntelliSense. *Owner: II-12.*

<a id="naming-convention"></a>
### naming convention
How generated code spells identifiers (`pascal`, `camel`, `snake`, `asIs`), including singularising table names. *Owner: II-14.*

<a id="objects-tab"></a>
### Objects tab
A permanent first tab listing the objects of the explorer selection with counts, sizes and dates. *Owner: II-10.*

<a id="optimistic-concurrency"></a>
### optimistic concurrency
Assuming nobody else changed a row and checking at write time. Rowlit's *verify unchanged* adds the old values to the `WHERE`. *Owner: II-13.*

<a id="out-parameter"></a>
### OUT parameter
A routine parameter the routine writes back. Execute routine shows OUT values and the return value in an outputs card. *Owner: II-14.*

<a id="overlay-editor"></a>
### overlay editor
The text box the grid opens over a cell while you edit it. It lives in a global `#portal` element. *Owner: II-13.*

<a id="paging"></a>
### paging
Reading a table in pages with `OFFSET/LIMIT` or `OFFSET/FETCH` and a stable `ORDER BY`. The default page is 1 000 rows. *Owner: II-13.*

<a id="pending-change"></a>
### pending change
An edit in the grid's buffer (update, insert, delete) not yet saved. Shown with colour and listed in the SQL preview. *Owner: II-13.*

<a id="plan-node"></a>
### plan node
One operator of a normalised execution plan with estimated and actual rows, cost and warnings. *Owner: II-15.*

<a id="plan-reader"></a>
### plan reader
`IPlanReader`: per-provider component that builds the explain script and the `PlanNode` tree. *Owner: II-15.*

<a id="platform-adapter"></a>
### platform adapter
The `Platform` interface that hides whether Rowlit runs in Electron or a browser. *Owner: II-20.*

<a id="postfix-completion"></a>
### postfix completion
A template triggered after an expression, such as `Customers.sel`. *Owner: II-12.*

<a id="prisma-schema"></a>
### Prisma schema
The `schema.prisma` file format. Rowlit generates it as a flavor of the TypeScript generator, for PostgreSQL only. *Owner: II-14.*

<a id="procedure-wizard"></a>
### procedure wizard
A dialog that creates a procedure, function, package or trigger from a per-dialect template in an edit console. *Owner: II-14.*

<a id="quick-filter"></a>
### quick filter
The cell context-menu submenu that builds a filter condition from the cell's value and kind. *Owner: II-13.*

<a id="quit-guard"></a>
### quit guard
The check that warns about unsaved grid edits and open transactions before quitting or closing a window. *Owner: II-20.*

<a id="react"></a>
### React
The UI library (version 18.3) Rowlit's renderer is built with. *Owner: II-20.*

<a id="record-view"></a>
### record view
The selected row shown as a vertical form, with edit and foreign-key navigation. *Owner: II-13.*

<a id="released-results"></a>
### released results
A background result whose rows beyond the first 1 000 were dropped to save memory. *Owner: II-13.*

<a id="reload-vs-re-run"></a>
### reload vs re-run
*Reload* fetches released rows back from the engine's stored copy without running the query. *Re-run* executes the query again. *Owner: II-13.*

<a id="result-chart"></a>
### result chart
A chart (bar, line, pie, KPI and more) built from a result set or Data tab. A lazy chunk with settings remembered per query. *Owner: II-13.*

<a id="result-writer"></a>
### result writer
`IResultWriter`: streams rows into CSV, TSV, JSON, SQL INSERT, Markdown or XLSX. *Owner: II-15.*

<a id="row-source"></a>
### row source
A reader that streams rows from an import file (CSV, TSV, XLSX, JSON, NDJSON). *Owner: II-15.*

<a id="rowid"></a>
### rowid / ROWID
A hidden row identity of SQLite and Oracle tables. Rowlit uses it to page and edit keyless tables. *Owner: II-13.*

<a id="run-target"></a>
### run target
What Run executes: the selection, else the statement at the cursor, else the whole document for Run script. *Owner: II-12.*

<a id="saved-filter"></a>
### saved filter
A named grid filter stored by the engine per connection and column signature. *Owner: II-13.*

<a id="saved-query"></a>
### saved query
A query stored in `queries.json` under a connection, database and schema. A bound console saves back to it with Ctrl+S. *Owner: II-10.*

<a id="scope-colour"></a>
### scope colour
A colour tag on a database or schema, stored in `settings.ui.scopeColors`. *Owner: II-10.*

<a id="search-path"></a>
### search path
PostgreSQL's ordered list of schemas for unqualified names. The snapshot carries it for IntelliSense. *Owner: II-10.*

<a id="selector"></a>
### selector
A function passed to a store hook that picks the part of state a component needs. *Owner: II-20.*

<a id="server-vs-client-filter"></a>
### server filter vs client filter
A server filter becomes a parameterised `WHERE` in a new query. A client filter is applied to rows already loaded. *Owner: II-13.*

<a id="session-restore"></a>
### session restore
On boot, re-attaching live engine sessions to the tabs that owned them, so open transactions survive a reload. *Owner: II-20.*

<a id="settings-bag"></a>
### settings bag (`settings.ui`)
The free-form object in settings where features keep their own keys without engine changes. *Owner: II-20.*

<a id="snapshot"></a>
### snapshot (catalog)
The compact JSON of the loaded schemas of a database, with a version and an ETag. *Owner: II-10.*

<a id="snippet"></a>
### snippet
A reusable SQL template with a prefix and placeholders, built in per dialect or defined by the user. *Owner: II-12.*

<a id="snippet-placeholder"></a>
### snippet placeholder
A stop in a snippet body: `$1`, `${1:default}`, `$0`. *Owner: II-12.*

<a id="system-type"></a>
### system type
A built-in data type, listed read-only in SQL Server's "System Data Types" group. *Owner: II-10.*

<a id="tab-kind"></a>
### tab kind
`console`, `object` or `view`; a `view` tab names a component registered with `registerTabView`. *Owner: II-20.*

<a id="table-diff"></a>
### table diff
`TableDiff.Compute(original, desired)`: columns matched by id then name, constraints by structure, producing a change list. *Owner: II-14.*

<a id="table-model"></a>
### table model
`TableModel`: the provider-neutral description of a table the designer edits. *Owner: II-14.*

<a id="theme"></a>
### theme
A named set of design-token overrides. Rowlit has 7 app themes and 22 code themes. *Owner: II-20.*

<a id="timeout-deadline"></a>
### timeout / deadline
A time limit after which a call is abandoned. Catalog calls use 15 s, 30 s and 5 min depending on the call. *Owner: II-10.*

<a id="token-equality-check"></a>
### token-equality check
The formatter's safety net: the formatted text is lexed again and must have the same tokens (case of words aside) or the original is kept. *Owner: II-12.*

<a id="toast"></a>
### toast
A short non-modal notification with an optional action button. *Owner: II-20.*

<a id="useshallow"></a>
### `useShallow`
A Zustand helper that compares selected arrays or objects shallowly so equal content does not re-render. *Owner: II-20.*

<a id="usesyncexternalstore"></a>
### `useSyncExternalStore`
The React hook for subscribing to external state. The command registry uses it. *Owner: II-20.*

<a id="verify-unchanged"></a>
### verify unchanged
The grid setting that makes `UPDATE`/`DELETE` also require the old values, detecting changes by others. *Owner: II-13.*

<a id="virtualisation"></a>
### virtualisation
Rendering only the visible part of a long list. The explorer and the grid both do it. *Owner: II-13.*

<a id="web-worker"></a>
### Web Worker
A background thread of the browser. The ER layout runs in one. *Owner: II-15.*

<a id="wire-value"></a>
### wire value
A cell as sent over the protocol: JSON scalars, big numbers and decimals as strings, `{ $bin }`, `{ $trunc }`, `{ $cursor }`. *Owner: II-13.*

<a id="workspace-file"></a>
### workspace file
The saved list of open tabs, their text, the group layout and detached tabs. Autosaved 800 ms after a change. *Owner: II-20.*

<a id="xlsx"></a>
### XLSX
The Excel workbook format (a zip of XML). Rowlit reads and writes it without a spreadsheet library. *Owner: II-15.*

<a id="upsert"></a>
### upsert
Insert a row, or update it if its key already exists (`MERGE`, `ON CONFLICT`, `ON DUPLICATE KEY`). *Owner: II-15.*

<a id="zustand-store"></a>
### Zustand store
A small global state container created with `create(...)`. Components subscribe with selectors; other code uses `getState()`. *Owner: II-20.*
