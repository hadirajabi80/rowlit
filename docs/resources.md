# Resources and memory

How Rowlit keeps memory and server connections in check when many connections, tabs and results are open. One
policy covers everything the engine holds per connection (tab sessions, Redis/MongoDB/Kafka/Elasticsearch clients,
streams, pooled catalog connections, the catalog cache, stored result rows) and what a window holds (result rows,
cached catalogs).

Code: `engine/src/DbStudio.Core/Services/ResourceManager.cs` (policy, close, snapshot),
`SessionManager` (session release / transparent reopen), `CatalogService` (LRU), `ResultStore` (expiry),
`engine/src/DbStudio.Host/Endpoints/ResourceEndpoints.cs`; UI `ui/src/app/resources.ts` (window policy, events),
`ui/src/store/resources.ts`, `ui/src/components/StatusBar/ResourcesItem.tsx` + `ResourcesPopover.tsx`,
`ui/src/app/actions.ts` (`disconnectConnection`, `closeDatabase`, `disconnectAll`); desktop `src/main/memory.ts`.

## Releasing a session

A session can **release** its physical connection while its id stays valid (`SessionInfo.released`,
`releasedReason`: `idle` | `closed` | `pressure` | `limit`). The tab keeps its editor, results and transaction mode;
its tab tooltip and the status bar say "Disconnected (idle)". The next run (or a database / transaction-mode switch)
reopens the connection on the database it was on (`USE` / reconnect) with the same transaction mode and prints an info
message ("Reconnected: the session had been closed after being idle."). Where the session has its own default schema
(`SchemaMode.Session`: PostgreSQL, Oracle, Snowflake) the schema it had when released (the console's schema switcher,
`SET search_path`, `USE SCHEMA`) is set again through `ChangeSchemaAsync` when the new connection starts on another one;
while released, `SessionInfo.schema` and `GET /sessions/{id}/schema` report that remembered schema, and
`POST /sessions/{id}/schema` reconnects first. (PostgreSQL re-applies it as "schema first, then the startup
search_path", like the switcher.)

What a reconnect cannot restore — session `SET` options, PostgreSQL `search_path` changes made with `SET`, variables —
is lost, which is why the automatic policies never release a session that:

- has an open transaction (`TxOpen`; only an explicit Close with confirmation rolls it back),
- is running a statement, export or describe,
- created temporary objects (`#temp`, `CREATE TEMP TABLE`, `SELECT … INTO #t`, SQLite `temp.` — detected from the DDL
  the statement classifier already extracts; sticky until the session is released or closed: `hasTempObjects`).

## Automatic policies (engine, every 30 s)

| Policy | Default | Under pressure (high / critical) |
| --- | --- | --- |
| Idle sessions release their connection | after 15 min without an execution | 5 min (⅓, min 2) / 1 min |
| Source clients (Redis, MongoDB, Kafka, ES) close | `connections.sourceIdleSeconds` (600 s), never while a stream or job holds a lease | 3 min / 1 min |
| Catalog cache (per schema snapshot, LRU by last snapshot request) | 128 MB budget, entries used in the last 10 min stay | ½ budget, 2 min / ¼ budget, 0 |
| Stored result rows (paging, full cells, "export loaded rows") | 256 MB cap (LRU, existing), unread completed results expire after 30 min | expire after 5 min, ½ cap / 1 min, ¼ cap |
| Pooled catalog connections (SQL Server, PostgreSQL per database, MySQL, Oracle) | cleared once a connection's metadata was not read for the idle timeout | same, with the shorter timeout |
| Full compacting GC | — | critical: at most every 5 min |

An evicted catalog schema reloads lazily; the reload bumps the database version, so its ETag changes and a client that
kept the old copy fetches the fresh one. Forgotten databases (Close database, Close connection, edited profile) keep
their last version, so a reload never reuses an ETag.

The idle ping (every 60 s) does not count as activity.

### Open connections limit

A connection "holds server resources" when a session holds its connection, its source client is open or a stream runs.
Before a session opens (new session or reopening a released one) or a source client opens for a connection that holds
nothing, and `maxOpenConnections` (20) connections already do, the least recently used **idle** connection (no
transaction, running work, temporary objects, streams, leases or jobs) is released (`resources.released`, reason
`limit`; the UI toasts "Closed X to free resources"). When none is idle the connect still succeeds: the limit never
makes an open fail.

### Memory pressure

The engine samples its working set and GC heap (`GC.GetGCMemoryInfo`); each window reports the Electron processes'
memory (desktop main: `app.getAppMetrics()` over the `getAppMemory` bridge; browser: the JS heap when the browser
exposes it) with its 30 s poll (`POST /resources/report`, kept for 2 min). Used = engine + the largest window report.

- Limit: `memoryLimitMb`, or **auto** = 25% of the RAM available to the process, clamped to 1–8 GB.
- Levels: `normal` below 85% of the limit, `high` up to the limit, `critical` above it. A level change is published
  (`resources.pressure`); with `trimUnderPressure` the policies use the shorter column above, and windows release their
  background results at once. A critical level toasts once per 10 min.

## Window policies (UI, every 30 s and on `resources.pressure`)

- **Results.** Console results of tabs that are not on screen (the active tab of every editor group stays) keep only
  their first page (1,000 rows) once the tab was not viewed for `releaseResultsMinutes` (10), when all results together
  exceed `resultRowBudget` (500,000 rows; least recently viewed first), or under pressure. Never touched: running
  queries, grids with unsaved or saved-but-overlaid edits, data tabs (they page from the server anyway). The grid shows
  "Results released to save memory" with **Reload** (fetches the rows back from the engine's stored copy, no query runs)
  and **Re-run**; when the engine copy is gone (expired, evicted, partial) only Re-run is offered.
- **Catalog.** Cached databases that no open tab's connection uses and whose explorer node is collapsed are evicted
  (LRU, estimated size) beyond `catalogCacheMb`; they reload when shown again (ETags make it cheap).

## Manual controls

- **Close connection** (explorer connection menu, palette; command `connections.disconnect`): releases this window's
  sessions of the connection (open tabs keep their visible results and reconnect lazily), closes its streams, source
  client and jobs, drops its catalog cache and clears its connection pools. Another window's sessions are left alone.
- **Close database** (database node menu, `connections.closeDatabase`): releases this window's sessions on that
  database and drops that database's catalog cache.
- **Disconnect all** (Connections menu, palette, Resources popover): Close connection for every connection.
- Before closing, the window confirms what it knows (open transactions → rolled back, running queries → cancelled);
  the engine answers `409 RESOURCE_BUSY` with `detail.blockers` for what only it knows (exports, imports, jobs, live
  streams), and the window confirms those before retrying with `force`.
- The explorer's filled dot means "holds server resources"; a dim dot means only a cached catalog or released sessions.

### Closing with tabs open

Open consoles and Data tabs stay open when their connection (or database) is closed: the console keeps its text and
results (status bar: "Disconnected" with a **Reconnect** button), the Data tab keeps its loaded rows under a
"Disconnected — Reconnect" banner (editing is read-only until it reconnects). **Nothing reconnects by itself.** The
catalog store marks the connection / database `closed` (`store/catalog.ts`): the explorer node folds up and its lazy
loads, a Data tab's catalog loads, console IntelliSense, server diagnostics and `catalog.changed` reloads all stay
quiet. The mark clears — and things load again — only on a user action: expanding the node, running a statement /
loading or paging a Data tab (`useSessions.ensure`), **Reconnect** (`POST /sessions/{id}/reconnect`: reopens the
released session on its database and transaction mode, no query), a catalog refresh, or opening a console on it
(`preloadCatalog`). Engine side, Close also clears the PostgreSQL diagnostics pool ("Rowlit diagnostics") next to the
catalog pools, so no pooled connection is left on the server.

Unsaved grid edits (Data tabs, console results) block the close with a prompt: **Save** (Data tabs save through their
tab; a failed save keeps the connection open), **Discard**, or **Cancel**. Edits of console results cannot be saved from
here, so the prompt then only offers Discard or Cancel.

## Status bar and popover

The status bar shows memory in use (amber at `high`, red at `critical`). A click opens the Resources popover (loaded
lazily): memory against the limit (engine, windows, result cache, metadata), every connection with what it holds
(open / released sessions, client, live views, jobs, metadata size) and a **Close** button, **Free memory now** (one
engine pass as under critical pressure plus releasing every background result), **Disconnect all** and Settings.

## Settings (`settings.json` › `resources`, Settings › Connections › Resources)

| Key | Default | Meaning |
| --- | --- | --- |
| `autoRelease` | `true` | Master switch of the automatic policies (idle sessions, connection limit, background results). |
| `idleSessionMinutes` | `15` | Idle time before a session releases its connection; `0` = never. |
| `maxOpenConnections` | `20` | Connections holding server resources at once; `0` = unlimited. |
| `memoryLimitMb` | `0` | Memory limit of engine + windows; `0` = auto (25% of RAM, 1–8 GB). |
| `trimUnderPressure` | `true` | Shorter timeouts and smaller budgets at `high` / `critical`. |
| `releaseResultsMinutes` | `10` | Background result tabs not viewed for this long keep only their first page; `0` = never. |
| `resultRowBudget` | `500000` | Rows kept across all result tabs before background ones are released. |
| `catalogCacheMb` | `128` | Catalog cache budget (engine; the window uses the same number for its own cache). |
| `resultCacheMb` | `256` | Engine copy of result rows. |
| `resultCacheMinutes` | `30` | Engine copies unread for this long are dropped; `0` = never. |

Existing related keys: `connections.maxSessionsPerProfile` (8), `connections.orphanGraceSeconds` (90),
`connections.sourceIdleSeconds` (600).

## API

- `GET /resources` → `{ memory, totals, connections[], policy }`; `POST /resources/report { appBytes }` → same.
- `POST /resources/trim { aggressive }` → snapshot after a policy pass.
- `POST /resources/close-all { force }`, `GET /connections/{id}/resources?database=`,
  `POST /connections/{id}/close { database?, force? }` → `{ connections, sessions, rolledBack, cancelled, streams, sourceClients, catalogBytes }`
  or `409 RESOURCE_BUSY { blockers: [{ kind, label, sessionId?, tabId?, jobId?, streamId? }] }`.
- Events: `session.changed` gains `released`, `releasedReason`, `hasTempObjects`; `resources.released
  { connectionId, connectionName, reason, sessions, sourceClient }`; `resources.pressure { level, usedBytes, limitBytes }`.
