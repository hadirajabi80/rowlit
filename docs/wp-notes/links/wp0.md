# Linked databases — WP0 foundation (notes for WP-A, WP-B, WP-C, WP-D)

Base: `main` @ `4ec9ffa`. Plan: `plan-links.md` (Fable). WP0 changes no behaviour for existing users except one thing:
the **"Linked databases"** entry appears (Welcome card, last entry of the connection dialog's type list, Ctrl+P
"New linked database…") and answers *"Linked databases are coming soon"* until WP-C registers the real `links.new`.
The engine registers **no** provider yet: `GET /providers` is unchanged, `GET /links/engine` is the only new route.

## 0. Rules (same as Batch 3, `docs/wp-notes/README.md` R1–R4, with these labels)

- **R1** Create files only under your "Owns" paths (section 2); edit shared files only inside your own
  `// LINKS-WPA begin … // LINKS-WPA end` blocks (`LINKS-WPB`, `LINKS-WPC`, `LINKS-WPD`). `LINKS-WP0` markers are WP0's:
  not yours to edit.
- **R2 frozen**: everything Batch 3's R2 lists (api/types.ts, client.ts, store/*, commands/*, Explorer, layout, app,
  Toolbar, StatusBar, editor/*, intel/* except your dialect files, format/index|layout, mocks fixtures/handlers/engine,
  package.json, Program.cs, Host csproj, slnx, ModuleAssemblies.cs, Core except your blocks, ci.yml, release.yml) **plus
  the contracts**: `engine/src/DbStudio.Federation/Contracts/*.cs` and `ui/src/api/links.ts` (WP0 wrote both sides; an
  engine contract change needs the TS twin in the same request).
- **R3** Requests go into your own notes file `docs/wp-notes/links/WP-A.md` (`WP-B.md`, `WP-C.md`, `WP-D.md`), format as in
  the Batch 3 README; local stubs behind `TODO(LINKS-WPA-shared)` (…`-WPB-`, `-WPC-`, `-WPD-`). File:line refer to the WP0
  commit (`git log -1 --format=%h -- docs/wp-notes/links/wp0.md`).
- **R4** Before handing in: `DBSTUDIO_IT=0 dotnet test engine/DbStudio.slnx -c Release` green + your Docker ITs;
  `cd ui && npm run lint && npm run typecheck && npm test && npm run test:intel`; `npm run build && node
  .github/scripts/bundle-size.mjs --dist ui/dist --budget-kb 1400 --initial-kb 120` and print your **initial** delta (the
  whole feature has ≤ 1.5 KB gzipped on the initial load; WP0 used 0.9 KB, so WP-C + WP-D share **≤ 0.6 KB**: keep
  everything behind `components/Links/commands.ts` (lazy chunk) and `lazy()` views); `cd desktop && npm test`.

## 1. Frozen contracts

Engine `engine/src/DbStudio.Federation/Contracts/` (namespace `DbStudio.Federation.Contracts`, JSON = `CoreJson.Options`,
camelCase) and their TS twins in `ui/src/api/links.ts`:

| File | What | Implemented by → used by |
|---|---|---|
| `LinkModels.cs` | `LinkIds` (`ProviderId "linked"`, `DefaultFolder`, `ViewsSchema "views"`), `LinkProps` (profile prop keys `members`, `relations`, `options`, `linkVersion`), `LinkDefinition` (+ `FromProfile` / `WriteTo` / `FindMember`), `LinkMember` (alias, kind connection\|files, connectionId, database, schema, allTables, tables, label), `MountedTable` (name, as, type, options; `LinkName`), `LinkTableRef(alias, table)`, `VirtualRelation` (from/fromColumns → to/toColumns, FK-shaped), `LinkOptions` (per-link overrides), `FederationLimits` | WP0 (done) → all |
| `LinkSql.cs` | `LinkSql.QuoteIdent/NeedsQuoting/Qualified` (DuckDB quoting, PostgreSQL reserved words), `LinkRules` (alias regex `^[a-z_][a-z0-9_]{0,62}$`, `ReservedAliases`, `Slugify`, `UniqueAlias`, `IsValidTableName`) | WP0 (done; UI twins `quoteIdent(…, 'duckdb')`, `slugifyAlias`, `uniqueAlias`, `isValidAlias`, same test cases both sides) |
| `BuilderModel.cs` | `BuilderModel` (tables, joins, columns, filter, groupBy, autoGroup, having, sort, limit, offset, distinct), `BuilderTable`, `BuilderJoin(+Condition)`, `BuilderColumn`, `BuilderRef`, `BuilderSort`, `BuilderFilterNode` (= ui `FilterNode`), `BuilderRefs.ColumnKey` (`"t1.status"`), token classes; **header = the canonical SQL both compilers emit** | WP-B (C# compiler) + WP-C (TS compiler) |
| `IFederationEngine.cs` | `IFederationEngineFactory` (`OpenAsync`, `Probe`), `IFederationEngine` (schemas = aliases, `CreateTableAsync`, `OpenAppender`, `ExecuteReaderAsync`, `SerializeSqlAsync`, `Interrupt`), `IFederationAppender` (value conversion rules), `FederatedColumn`, `FederationEngineFeatures`, `SqlAst`, `FederationEngineInfo` | WP-A → WP-A, WP-B (fetchers) |
| `ISourceFetcher.cs` | `ISourceFetcher` keyed by provider id (`LoadCatalogAsync`, `Accept`, `Describe`, `FetchAsync`), `FetcherKeys.Files`, `SourceContext`, `SourceCatalog/SourceTable/SourceColumn`, `FetchRequest/FetchResult`, `PushdownPredicate/PushdownLiteral/PushdownOps`, `FetchException` | WP-A (relational) + WP-B (mongodb, elasticsearch, files) → WP-A |
| `ILinkRuntime.cs` | `ILinkRuntime` (`Definition`, `ValidateAsync`, `CatalogAsync`, `PlanAsync`, `OpenQueryAsync`, `RefreshSourcesAsync`, `SerializeSqlAsync`), `LinkQuery`, `LinkQueryOptions`, `LinkFetchProgress`, `LinkCatalog(Schema)` — the WP-A ↔ WP-B seam | WP-A → WP-B |
| `LinkApi.cs` | REST route table + DTOs: validate, catalog, compile/parse/plan, `PushdownPlan/SourceFetchPlan/PlanWarning(Codes)`, linked views, materialize (request/preview/result, modes), native scripts (kinds), refresh-sources | WP-B (endpoints) → WP-C/WP-D (UI) |

Key semantics (read the XML docs before coding):
- A **link is a connection**: `ConnectionProfile { providerId: "linked", readOnly: true, folder: "Linked databases",
  props: LinkDefinition }`, CRUD through `/connections`, no password. Credentials of members never leave the engine
  (`ConnectionStore.WithSecrets` + `GetPassword` inside `SourceContext`).
- In SQL a mounted table is `alias.table` (DuckDB schema = member alias, table = `MountedTable.LinkName`), so user SQL
  runs unchanged on the engine; aliases are lower-case identifiers, never `main/temp/system/memory/information_schema/
  pg_catalog/views` nor a reserved word.
- Push-down is an **optimisation only**: the engine re-applies every predicate, a fetcher may drop what it cannot render
  (`Accept`), dropping any predicate drops the limit, the projection is never empty.
- Parameters: DuckDB `$name` (UI `placeholder(name, 'duckdb')`, engine `SearchSql.Param`); the builder/filter binds are
  `$fp1…`. `IFederationEngine.ExecuteReaderAsync` binds by `QueryParam.BareName`.
- Builder SQL parity: `engine/tests/DbStudio.Federation.Tests/Goldens/Builder/*.json` = `{ name, catalog: {"alias.table":
  [{name, kind, type}]}, model, sql, params, warnings }`; `b-*` files by WP-B, `c-*` by WP-C, both compilers must pass
  all of them. `b-000-seed.json` is WP0's illustration of the canonical layout (WP-B may correct it).

## 2. What each WP finds

### WP-A — engine federation core

- **Owns**: `engine/src/DbStudio.Federation/{Provider,Engine,Pushdown,Runtime}/**`, `Fetchers/RelationalFetcher.cs`,
  `Diagnostics/**` (WP0's `DuckDbProbe`; extend, keep `GET /links/engine`'s shape), `engine/tests/DbStudio.Federation.Tests/WpA/**`,
  `docs/wp-notes/links/WP-A.md`.
- **Blocks**: `FederationModule.cs` LINKS-WPA (`ConfigureServices`: replace `UnavailableLinkRuntime` with `LinkRuntime`,
  add `IDbProvider LinkedProvider`, `IFederationEngineFactory`, keyed `ISourceFetcher` for sqlserver, oracle, postgresql,
  mysql, mariadb, sqlite, clickhouse, snowflake, cassandra; keyed `IParamBinder`/`IPlanReader` for "linked" if you need
  them); `Core/Search/SearchSql.cs` LINKS-WPA ×4 (Param `$name`, ILIKE, `regexp_matches`, DuckDB text types);
  `Core/Sql/StatementClassifier.cs` LINKS-WPA (`ClassifyDuckDb`: FROM-first/DESCRIBE/SUMMARIZE/SHOW/PIVOT = query;
  ATTACH/INSTALL/LOAD/COPY/EXPORT/IMPORT = other, so `ReadOnlyGuard` refuses them).
- **Stubs**: `Provider/LinkedProvider.cs`, `LinkCatalogReader.cs`, `FederatedSession.cs`, `Engine/DuckDbEngine.cs`,
  `SqliteFederationEngine.cs`, `Pushdown/QueryAnalyzer.cs`, `PushdownSql.cs`, `TypeMap.cs`, `Fetchers/RelationalFetcher.cs`,
  `Runtime/LinkRuntime.cs` (each a placeholder class with the spec in its header; replace it). `Runtime/UnavailableLinkRuntime.cs`
  may be deleted once yours is registered.
- **Given by WP0**: `Dialect.DuckDb` (wire `duckdb`; `DialectInfo`: no database level, not schema-is-database, default
  schema `main` (answer the first alias in the catalog reader), nested comments, `$$` strings, `"` quoting);
  `SourceRegistry.DisplayOrder` ends with `linked`; settings `links.{memoryLimitMb 0=auto, maxRowsPerSource 2000000,
  fetchTimeoutSeconds 300, threads 0, cacheSources true}` (validated in `SettingsService`, LINKS-WP0); `DuckDbProbe.
  OpenInMemory()` with `LockdownStatements` (`autoinstall/autoload_known_extensions=false`, `enable_external_access=false`:
  apply them on every federation connection, set `memory_limit/threads/temp_directory` *before* them, then
  `SET lock_configuration = true` so user SQL cannot undo them).
- **UI contract you must meet**: the console of a link has no Tx toggle/Commit/Rollback and no Explain
  (`providerLevels.hasTransactions/hasExplain('linked') = false`), so `SetTransactionModeAsync(Manual)`, commit, rollback
  and EXPLAIN may throw NOT_SUPPORTED. `LinkedProvider.FormSpec` = no fields (the UI never shows the generic form for
  `linked`). The catalog reader's schemas are the aliases (the explorer, Ctrl+P, Objects tab and IntelliSense use them).
- **Tests**: unit (`WpA/`): push-down SQL snapshots for the 8 source dialects, outer-join safety, type map, analyzer
  fixtures, cap/truncation, cancellation. Docker IT (pattern `engine/tests/DbStudio.Import.Tests/DockerImportTests.cs`
  `Target.Reachable()`): SQL Server customers × PostgreSQL orders × MySQL products, order 1 total 120.50 (ShopSchema).

### WP-B — engine services

- **Owns**: `engine/src/DbStudio.Federation/{Endpoints,Builder,Views,Materialize,Native}/**`,
  `Fetchers/{MongoFetcher,ElasticFetcher,FileFetcher}.cs`, `engine/tests/DbStudio.Federation.Tests/WpB/**`,
  `Goldens/Builder/b-*.json`, `docs/wp-notes/links/WP-B.md`.
- **Blocks**: `FederationModule.cs` LINKS-WPB ×2 (`ConfigureServices`: stores, `MaterializeService`, scripter, keyed
  fetchers `mongodb`, `elasticsearch`, `FetcherKeys.Files`; `MapEndpoints`: `LinkEndpoints.Map(links)` on the `/links`
  group — `GET /links/engine` is WP0's, keep it).
- **Stubs**: `Endpoints/LinkEndpoints.cs`, `Builder/BuilderCompiler.cs`, `Builder/BuilderParser.cs`, `Views/LinkedViewStore.cs`,
  `Materialize/MaterializeService.cs`, `Native/NativeLinkScripter.cs`, the three P3 fetchers.
- **Before WP-A lands**: `ILinkRuntime` resolves to `UnavailableLinkRuntime` (definitions from the profile,
  `SerializeSqlAsync` really parses with DuckDB, everything else 501) — so endpoints map and the parser can be built and
  tested; fake `ILinkRuntime` in endpoint tests (`Microsoft.AspNetCore.TestHost` is referenced).
- **Note (FileFetcher)**: the federation DuckDB has `enable_external_access = false`, so `read_csv_auto` / `read_parquet`
  are not available on it; read files through Import's row sources (`Parsing/RowSources`, `JsonRowSource`,
  `XlsxRowSource`) and append (deviation 3). Parquet: skip in P3 or use a separate short-lived DuckDB with external access.
- **Tests**: compile/parse goldens (all `Goldens/Builder/*.json`), scripter snapshots, Docker IT materialize into
  PostgreSQL and MySQL (100k rows < 30 s with progress), Mongo/ES fetch.

### WP-C — UI link editor + query builder

- **Owns**: `ui/src/components/Links/**` except `materialize/**`, `native/**` and the LINKS-WPD blocks of
  `components/Links/commands.ts`; `ui/src/store/links.ts`; `ui/src/mocks/packs/linked.ts`;
  `engine/tests/DbStudio.Federation.Tests/Goldens/Builder/c-*.json`; `docs/wp-notes/links/WP-C.md`.
- **Stubs**: `components/Links/commands.ts` (WP0 placeholders `links.new`, `links.edit`, `links.duplicate` → toast; replace
  the list, keep the ids and the LINKS-WPD blocks), `components/Links/builder/compile.ts` (signature
  `compileBuilder(model, catalog): CompileResult`), `components/Links/__tests__/goldens.test.ts` (loads the shared goldens:
  extend it to compare your compiler's output), `store/links.ts`, `mocks/packs/linked.ts` (inert; `linkedConnections`
  is a ready sample link over the mock `c_shop` + `c_pg`; list it with a `ProviderInfo { id: 'linked', dialect: 'duckdb',
  kind: 'relational', formSpec: { fields: [] } }` when you activate the pack).
- **Entry points already routed to your commands** (WP0): Welcome card `linked` and the connection dialog's last entry
  → `links.new {folder, connectAfter}`; `connections.edit` / `connections.duplicate` on a link (the dialog host) →
  `links.edit {connectionId}` / `links.duplicate {connectionId}`. Other reserved ids: see the header of
  `components/Links/commands.ts` (`links.builder`, `links.refreshSources`, `links.plan`, …).
- **Menus**: register `explorer.link` (link connection row) and `explorer.linkTable` (its tables/views) with
  `registerContextMenu` (ids: `commands/menuModel.ts LINK_MENU_IDS`); the Explorer switches a link's rows to them as soon
  as they have entries (`hasContextMenu`). Builder menus: `api/links.ts BUILDER_MENU_IDS` (`builder.canvas|table|column|
  join`). Menu icons must exist in `components/layout/commandMenu.tsx ICONS` (e.g. Link, Network, Workflow, RefreshCw…).
- **Drag & drop**: explorer object and column rows now carry `application/x-rowlit-object` (`lib/dragObject.ts`:
  `ROWLIT_OBJECT_MIME`, `RowlitObjectDrag {connectionId, providerId, database, schema, name, type, column}`,
  `readObjectDrag(dataTransfer)`), next to the old `text/plain` and `application/x-dbstudio-object`.
- **Builder filters**: `buildPredicate(group, columns, 'duckdb', { paramPrefix: 'fp', columnRef })` — `columnRef` is new
  (WP0): pass columns named by `builderColumnKey` (`"t2.status"`) and render `orders.status`. Canvas: reuse
  `components/ErDiagram/{edges,viewport,layout}.ts` + `Minimap.tsx` read-only (imports only; R3 for changes).
- **Tests**: compile goldens, join inference, reducers, editor flows over msw (activate the mock pack), bundle check.

### WP-D — UI IntelliSense + wizards

- **Owns**: `ui/src/intel/dialect/duckdb.ts`, `intel/dialect/data/duckdb-*.json`, `ui/src/format/rules/duckdb.ts`,
  `ui/src/snippets/data/duckdb.ts`, `ui/src/intel/__tests__/fixtures/shop-duckdb.json`, `ui/src/intel/__tests__/duckdb*.test.ts`,
  `ui/src/components/Links/{materialize,native}/**`, `docs/qa/links-walkthrough.md`, `docs/wp-notes/links/WP-D.md`.
- **Blocks**: `components/Links/commands.ts` LINKS-WPD ×2 (imports + `registerMaterializeCommands()` /
  `registerNativeLinkCommands()` calls; add more of your registrations there), `snippets/library.test.ts` LINKS-WPD
  (`MIN.duckdb`; when your library is ready add `'duckdb'` to `DIALECTS` and drop it from `PENDING` — R3 the two lines
  outside the block, or ask the orchestrator), `editor/dev/EditorPlayground.tsx` LINKS-WPD (sample).
- **Stubs**: `intel/dialect/duckdb.ts` (ANSI base, `$$` / `$1` / `?`, operators; **add a LexHook for `$name`**: the
  filter/builder binds are `$fp1`, traits.ts only lexes `$1`), `data/duckdb-functions.json` (empty), `format/rules/duckdb.ts`
  (SQLite rules), `snippets/data/duckdb.ts` (empty: the shared snippets only), `materialize/commands.ts`,
  `native/commands.ts`. The lazy-dialect rules of Batch 3 apply unchanged (`docs/wp-notes/wp0.md` 2, "no-import rule").
- **Given by WP0**: `dbstudio-duckdb` Monaco language, `SEMICOLON_ONLY` includes duckdb, shop fixture with schemas
  `shop` + `archive` (aliases), `fixtures.duckdb` in `intel/__tests__/helpers.ts`, codegen type table
  `codegen/types/duckdb.json`, `quoteIdent(…, 'duckdb')`.
- **"Add to link…"**: `extendContextMenu('explorer.table' | 'explorer.view', […])` with `optional, hideDisabled`
  entries running `links.addTable` (args: the explorer `ObjectTarget`); Objects tab menus likewise.
- **Tests**: `npm run test:intel` (`crm.` completes tables, `crm.customers.` columns, FK join suggestion across a virtual
  relation), wizard flows over msw, drag-drop integration.

## 3. DuckDB native library (verified by WP0)

- Package **DuckDB.NET.Data.Full 1.5.6.1** (DuckDB **v1.5.6**, MIT), referenced by `DbStudio.Federation` only. Natives:
  win-x64 `duckdb.dll` 36.7 MB, win-arm64 42.8 MB, linux-x64 70.5 MB, linux-arm64 62.9 MB, `osx` `libduckdb.dylib`
  **117.0 MB universal** (x86_64 59.7 MB + arm64 57.2 MB). JSON functions are statically linked: `json_serialize_sql`
  works with no extension (`WpZero/DuckDbSmokeTests`). Untyped parameters do not bind to `json_serialize_sql` (overloads):
  use `CAST($sql AS VARCHAR)` (as `DuckDbProbe` does).
- **Windows single-file** (`scripts/build.ps1 -EngineOnly` arguments, into a scratch folder): `duckdb.dll` is bundled and
  self-extracted like SNI/e_sqlite3; the published engine starts, `GET /links/engine` answers
  `{ engine: "duckdb", version: "v1.5.6", serializeSql: true }`, and `scripts/ci/kafka-native-smoke.mjs` passes
  (it now checks `/links/engine` too). Size **77,510,935 → 90,409,854 bytes (+12.3 MiB, 73.9 → 86.2 MiB)**.
- **macOS** (cross-published `-r osx-arm64` on Windows): `libduckdb.dylib` lands next to `Rowlit.Engine` (RID fallback
  osx-arm64 → osx) and its header has an arm64 slice — `node scripts/ci/kafka-native-smoke.mjs --mac-static <dir> arm64`
  (new, runs on any OS) passes. **CI must verify on the mac runner** (the script does it in the existing step:
  `libduckdb.dylib` is in `MAC_DYLIBS`): `file`/`otool -L` (system deps only), the REST check (`/links/engine` under the
  hardened runtime) and `codesign --verify --strict` of the packaged dylib. **Size**: each mac engine carries 117 MB
  uncompressed (both slices); `lipo -thin arm64` (resp. `x86_64`) before signing would save ~57–60 MB per engine —
  recommended for the integration pass (scripts/build.sh), not done in WP0.

## 4. Deviations from the plan (and why)

1. **Fifth/sixth/seventh contract files**: besides the four named ones, `ILinkRuntime.cs` (the WP-A ↔ WP-B seam: without
   it WP-B's materialize/compile/plan would have to reach into WP-A's internals), `LinkApi.cs` (REST DTOs the UI codes
   against) and `LinkSql.cs` (quoting/naming implemented once). All frozen.
2. **`UnavailableLinkRuntime` + `GET /links/engine`** (WP0): minimal APIs need a registered `ILinkRuntime` to map WP-B's
   endpoints; the engine route feeds the native smoke test.
3. **DuckDB lockdown includes `enable_external_access = false`** (plan: no extensions, no network): user SQL in a linked
   console cannot read local files (`read_csv`, `COPY … TO`); FileFetcher therefore reads through Import's row sources.
4. **Explorer menus** are routed (`explorer.link`, `explorer.linkTable`) instead of only `extendContextMenu`, because a
   link's connection row needs different entries (no designer); the shell menus stay until WP-C registers them.
5. **Builder `columnRef` option** added to `filter/sql.ts` `buildPredicate` (multi-table filters); duckdb in filter SQL:
   `$name` binds, ILIKE, `TRUE/FALSE`, `ESCAPE '\'`, time binds typed `time`.
6. **No `components/Links/entry.ts`**: `components/Links/commands.ts` is already auto-loaded as a lazy chunk at startup
   (commands/index.ts glob), which is exactly what entry.ts was for. WP-C may still add one.
7. Snippets: `SNIPPET_DIALECTS` includes duckdb (shared snippets only until WP-D fills `data/duckdb.ts`); the library
   shape test skips it (`PENDING`). Shared snippets for "every dialect" keep their `builtin:<prefix>:all` ids.
8. Import Wizard refuses `linked` targets (read-only), like Cassandra.
9. `Batch3FoundationTests.Unknown_dialect_message_lists_all_eight` now expects "…, cql or duckdb".

## 5. Measurements (WP0)

- **Initial load** (bundle-size.mjs): 1482.2 → **1483.1 KB** gzipped (**+0.9 KB**; index +0.47, actions +0.18,
  menuModel +0.09, sql +0.08, splitter/theme/css/connections/icons/providerLevels +0.13). Lazy: `duckdb` dialect chunk
  1.08 KB, links commands +0.36 KB (in the commands chunk), logos +0.11 KB. Total change vs the M1 baseline +1043.4 →
  +1046.0 KB (budget +1400).
- **Engine publish** win-x64 single-file: +12.3 MiB (section 3).
- **Tests**: `dotnet build engine/DbStudio.slnx -c Release` 0 errors; `DBSTUDIO_IT=0 dotnet test` green (Federation 25/25,
  Core 545/546 + 1 skipped, all other projects unchanged); UI `npm run lint` 0 errors, `typecheck` clean, `npm test`
  207 files / 2453 tests green (a first run under machine load had hook timeouts in `tokens.test.ts` and
  `SearchDialog.test.tsx`; both pass alone and in the full re-run), `npm run test:intel` 1083/1084: only the known
  "5,000-line T-SQL formats in < 150 ms" timing test under load (passes alone); desktop `npm test` 129 pass / 2 skipped.

## 6. How to test against the sample servers

Docker compose project **dbstudio-it** (`engine/tests/docker/compose.yml`, README there; `docker ps` shows what runs):

| Server | Address | Login | Shop schema |
|---|---|---|---|
| SQL Server | `localhost,14333` | `sa` / `DbStudio_Dev_2026!` | db `shop`, `dbo` (+ `Sales`) |
| PostgreSQL | `localhost:15432` | `shop` / `shop` | db `shop`, `public` |
| MySQL | `localhost:13306` | `shop` (or `root`) / `shop` | db `shop` (MariaDB `13307`) |
| Oracle | `localhost:15211` service `FREEPDB1` | `shop` / `shop` | schema `SHOP` |
| ClickHouse | `localhost:18123` (http) | `shop` / `shop` | db `shop` |
| MongoDB | `mongodb://localhost:27018/?directConnection=true` | (no auth) | db `shop` (replica set rs0) |
| Elasticsearch | `http://localhost:19200` (profile `search`, security off) | — | seeded by `seed-elasticsearch.sh` |

Start what you need: `docker compose -p dbstudio-it -f engine/tests/docker/compose.yml up -d mssql postgres mysql oracle
clickhouse mongo` (`--profile search` for Elasticsearch). Every server holds the same ShopSchema data (3 countries,
5 customers, 6 orders — order 1 total 120.50 — 4 products, 7 order lines). Integration tests skip (not fail) when
`DBSTUDIO_IT=0` or the port is closed (`Target.Reachable()` pattern). Never run the installed app or touch `%APPDATA%`:
the engine and smoke tests take `DBSTUDIO_DATA_DIR` (a temp dir) and `DBSTUDIO_SECRET_STORE=memory`.
UI: `npm run dev:mock` (mock engine; activate `mocks/packs/linked.ts` to see links), component tests over msw.
