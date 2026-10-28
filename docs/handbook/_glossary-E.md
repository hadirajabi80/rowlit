# Glossary fragment — package E (II-03, II-05, II-06, II-07, II-08, II-09)

Rows for `glossary.md`, alphabetical by English term. Package H merges them; anchors are the lower-case kebab of the
English term. Terms these chapters only *link* (driver, CORS, origin, preflight, secret store, data folder, synonym,
rowid, mutation, MergeTree, consistency level, bind variable, resource manager, Zustand, throttling) are owned elsewhere.

## English rows

<a id="ado-net"></a>
### ADO.NET
.NET's standard database API: `DbConnection`, `DbCommand`, `DbDataReader`, transactions and parameters. Deeper: seven of Rowlit's eight relational providers sit on it through `AdoSessionBase`; Cassandra uses its own driver API. *Owner: II-09.* See also: driver, AdoSessionBase.

<a id="adapter"></a>
### adapter
Code that converts one interface into the one a client expects. Deeper: a Rowlit provider adapts a driver to Core's `IDbProvider`/`IDbSession` contract. *Owner: II-03.* See also: ports and adapters.

<a id="all-errors"></a>
### ALL_ERRORS
Oracle data-dictionary view listing compile errors of PL/SQL units. Deeper: after a `CREATE` that "succeeds with compilation errors" (ORA-24344) the Oracle session reads it and sends `exec.diagnostics`. *Owner: II-09.* See also: DBMS_OUTPUT.

<a id="anchor-type"></a>
### anchor type
One `typeof(...)` per module assembly in `Host/ModuleAssemblies.cs`. Deeper: it keeps the compiled assembly reference so `EngineModules.Discover` can find the assembly's modules. *Owner: II-07.* See also: reflection, engine module.

<a id="animation-frame-batching"></a>
### animation-frame batching
Collecting many events and applying them once per browser repaint. Deeper: `store/results.ts` queues `exec.*` events and applies them in one `requestAnimationFrame` callback. *Owner: II-06.*

<a id="asp-net-core"></a>
### ASP.NET Core
Microsoft's web framework for .NET. Deeper: the engine host is an ASP.NET Core minimal-API app on Kestrel. *Owner: II-05.* See also: minimal API, Kestrel.

<a id="assembly"></a>
### assembly
A compiled .NET library or executable (`.dll`/`.exe`) with metadata about its types and references. *Owner: II-07.* See also: reflection.

<a id="attached-database"></a>
### attached database
An extra SQLite database file opened on the same connection under a schema name (`ATTACH DATABASE ... AS name`). Deeper: Rowlit lists attached files as schemas. *Owner: II-09.*

<a id="attention"></a>
### attention
The TDS signal SQL Server clients send to cancel a running batch. Deeper: `SqlCommand.Cancel()` sends it; the server acknowledges through `InfoMessage`. *Owner: II-09.* See also: cancel.

<a id="auth-frame"></a>
### auth frame
The first WebSocket message, `{"type":"auth","token","clientId"}`, that authenticates the socket. Deeper: wrong or late (over 2 s) means close code 4401. *Owner: II-06.*

<a id="back-pressure"></a>
### back-pressure
A way for a slow consumer to slow a fast producer down. Deeper: the hub does not slow publishers; a client whose queue passes 200 000 frames is disconnected instead. *Owner: II-06.*

<a id="backoff"></a>
### backoff
Waiting longer after each failed retry. Deeper: `EngineSocket` reconnects after growing delays from 250 ms to 8 s. *Owner: II-06.* See also: reconnect.

<a id="batch"></a>
### batch
One unit the UI sends to the server: a `GO`-delimited block in T-SQL, usually one statement elsewhere. Deeper: `SqlBatch(Sql, Line, Col)` carries its document position so errors map back. *Owner: II-08.* See also: statement, script.

<a id="bearer-token"></a>
### bearer token
A secret whose holder is trusted, sent as `Authorization: Bearer <token>`. Deeper: the engine creates 32 random bytes per run and prints them once in the READY line. *Owner: II-03.* See also: trust boundary.

<a id="bind"></a>
### bind
Attaching a value to a placeholder so it travels separately from the SQL text. *Owner: II-08.* See also: query parameter, param binder.

<a id="broken-session"></a>
### broken session
A session whose connection died. Deeper: the next run reopens it under the same id; if a transaction was lost it answers `409 SESSION_BROKEN`. *Owner: II-08.*

<a id="busy"></a>
### busy
The state of a session that is executing or reserved. Deeper: `SessionHandle.TryReserve` makes a second run answer `409 SESSION_BUSY`. *Owner: II-08.*

<a id="camelcase"></a>
### camelCase
Writing names with a lower-case first word and capitalised later words (`connectionId`). Deeper: all engine JSON uses it (`CoreJson`). *Owner: II-05.*

<a id="cancel"></a>
### cancel
Stopping a running statement. Deeper: each driver does it differently: TDS attention, TNS break, PostgreSQL cancel request, `sqlite3_interrupt`, `KILL QUERY`, `SYSTEM$CANCEL_QUERY`. *Owner: II-08.* See also: late cancel, attention.

<a id="cancellationtoken"></a>
### CancellationToken
.NET's object for asking an operation to stop. Deeper: request tokens flow into services; executions use their own so they outlive the 202 response. *Owner: II-05.*

<a id="case-folding"></a>
### case folding
What a server does to unquoted names: Oracle and Snowflake upper-case them, PostgreSQL and Cassandra lower-case them, others preserve. *Owner: II-09.* See also: identifier rules.

<a id="cassandracsharpdriver"></a>
### CassandraCSharpDriver
The DataStax C# driver for Cassandra and ScyllaDB (3.22.1 in Rowlit). *Owner: II-09.*

<a id="cell-fetch"></a>
### cell fetch
Getting the full value of a truncated cell later with `GET .../cell?row&col`, without re-running the query. *Owner: II-08.* See also: result store, wire value.

<a id="cell-kind"></a>
### cell kind
`ColumnInfo.kind` (`int`, `decimal`, `string`, `datetime`, `binary`, `json`…), telling the grid how to render and align a column. *Owner: II-08.* See also: wire value.

<a id="channel"></a>
### channel
`System.Threading.Channels.Channel<T>`, an async producer/consumer queue. Deeper: the hub keeps one unbounded `Channel<byte[]>` per WebSocket client. *Owner: II-06.*

<a id="clean-architecture"></a>
### clean architecture
Robert C. Martin's concentric-circle style in which source dependencies point only inward. Deeper: Rowlit does not use the name; its engine is layered with interface seams but Core still references ASP.NET, SQLite and SSH.NET. *Owner: II-03.* See also: dependency rule, hexagonal architecture.

<a id="clickhouse-driver"></a>
### ClickHouse.Driver
The official ClickHouse ADO.NET client over HTTP (1.5.0 in Rowlit). *Owner: II-09.* See also: HTTP session.

<a id="client-id"></a>
### client id
The opaque id a UI window sends in `X-DbStudio-Client` and the WebSocket auth frame. Deeper: normalised to at most 128 printable ASCII characters; it decides who owns sessions and streams. *Owner: II-05.* See also: client presence.

<a id="client-presence"></a>
### client presence
The engine's record of which UI clients have a live WebSocket (`ClientPresence`). Deeper: when a client's last socket closes it raises `ClientGone`, which starts the orphan grace period. *Owner: II-05.*

<a id="composition-root"></a>
### composition root
The one place where an application builds its objects and wires implementations to interfaces. Deeper: Rowlit has `Program.cs` plus one `IEngineModule` per feature package. *Owner: II-03.*

<a id="connection-pooling"></a>
### connection pooling
Keeping closed connections open to reuse them. Deeper: Rowlit turns it off for tab sessions (`Pooling=false`, state belongs to the tab) and on for catalog readers. *Owner: II-08.*

<a id="connection-profile"></a>
### connection profile
A saved, named record of how to reach a server: provider id, props, folder, colour, read-only flag; never the password. *Owner: II-08.* See also: connection store, form spec.

<a id="connection-store"></a>
### connection store
`ConnectionStore`: keeps profiles in `connections.json`, strips password fields to the secret store and resolves secrets and SSH tunnels before a driver opens. *Owner: II-08.*

<a id="connection-string"></a>
### connection string
The `key=value;` text a driver reads to connect. Deeper: providers build it from profile props; ClickHouse and Cassandra have none and return a description. *Owner: II-09.*

<a id="contract"></a>
### contract
The agreed shape of requests, responses, events or interfaces that two sides code against. Deeper: `IDbProvider` is frozen by the plan; DTOs in `Host/Contracts` mirror `ui/src/api/types.ts`. *Owner: II-05.*

<a id="cqlsh"></a>
### cqlsh
Cassandra's command-line shell. Deeper: Rowlit's CQL console understands its commands `CONSISTENCY`, `TRACING`, `PAGING`, `SHOW`, `DESCRIBE`. *Owner: II-09.*

<a id="dbms-output"></a>
### DBMS_OUTPUT
Oracle's server-side buffer for PL/SQL output (`PUT_LINE`). Deeper: Rowlit enables it per session and drains it with `GET_LINES` after every batch. *Owner: II-09.*

<a id="dbstudio-ready"></a>
### DBSTUDIO_READY
The one stdout line `DBSTUDIO_READY {"port","token"}` the engine prints when it listens. Deeper: the Electron supervisor waits for it (15 s, 180 s for `dotnet run`). *Owner: II-05.*

<a id="ddl-scope"></a>
### DDL scope
How far a DDL statement reaches: `Object`, `Database` (schema list changes) or `Temporary` (no catalog change). Deeper: drives catalog invalidation and `HasTempObjects`. *Owner: II-08.*

<a id="default-interface-member"></a>
### default interface member
A C# interface member with a body, so adding it does not break implementers. Deeper: how `IDbSession` gained schema members, `LostTransaction` and `FindUnboundParameter`. *Owner: II-07.*

<a id="delimiter"></a>
### DELIMITER
A `mysql` client command that changes the statement terminator so procedure bodies with `;` stay whole. Deeper: Rowlit's MySQL splitter honours it; the server never sees it. *Owner: II-09.*

<a id="dependency-injection"></a>
### dependency injection
A container builds objects and hands each the dependencies it declares, instead of classes creating them. *Owner: II-05.* See also: singleton, keyed service.

<a id="dependency-inversion"></a>
### dependency inversion
The inner, higher-level code declares the interface it needs and the outer code implements it. Deeper: applied at Rowlit's driver edge (`IDbProvider`, `ITunnelResolver`). *Owner: II-03.* See also: SOLID.

<a id="dependency-rule"></a>
### dependency rule
Clean architecture's rule that source dependencies point only inward. Deeper: holds for Core versus providers; not for Core versus ASP.NET. *Owner: II-03.*

<a id="describe"></a>
### describe
Getting a query's result columns without running it (`SchemaOnly | KeyInfo`). Deeper: also decides whether a result is editable. *Owner: II-08.*

<a id="destructive-statement"></a>
### destructive statement
DELETE/UPDATE without WHERE, DROP or TRUNCATE. Deeper: the UI asks before running one; read-only connections are guarded in the engine. *Owner: II-08.*

<a id="dialect-info"></a>
### dialect info
`DialectInfo`, a static table of per-dialect traits (database level, quoting, comment and string syntax). Deeper: lets Core switch on traits instead of dialect names. *Owner: II-09.*

<a id="drain"></a>
### drain
Reading and discarding the rest of a result set after the row cap so later result sets can be read. *Owner: II-08.* See also: MaxRows, truncation.

<a id="dropped-items"></a>
### dropped items
Stream items a stream had to skip, reported as `dropped` on `stream.data`. *Owner: II-06.*

<a id="dto"></a>
### DTO
Data transfer object: a plain record that only carries data across a boundary. *Owner: II-05.*

<a id="endpoint"></a>
### endpoint
One HTTP method plus path and the code that answers it. *Owner: II-05.* See also: route group.

<a id="engine-module"></a>
### engine module
A class implementing `IEngineModule { ConfigureServices; MapEndpoints }`, the composition root of one feature package. Deeper: 17 are discovered at start-up. *Owner: II-07.*

<a id="error-code"></a>
### error code
The machine-readable `code` of an error (`TX_OPEN`, `READ_ONLY`, `SSH_TUNNEL`…). *Owner: II-05.* See also: error envelope.

<a id="error-envelope"></a>
### error envelope
The single error body shape `{"error":{"code","message","detail"}}` of every non-2xx answer. *Owner: II-05.*

<a id="event"></a>
### event
A small JSON message with a `type` and `ts` pushed from engine to UI over the WebSocket. *Owner: II-06.*

<a id="event-types"></a>
### event types
The `type` strings of `Core/Services/Events.cs`: `exec.*`, `session.changed`, `catalog.changed`, `stream.*`, `job.*`, `resources.*`, `export.*`, `engine.log`, `auth.ok`, `pong`. *Owner: II-06.*

<a id="exact-decimal"></a>
### exact decimal
`ExactDecimal`, a parameter value kept as text because `System.Decimal` cannot hold it (at most 20 000 digits). *Owner: II-08.*

<a id="execution-id"></a>
### execution id
The `x…` id returned by `POST /execute` that ties every `exec.*` event to one run. *Owner: II-08.*

<a id="execution-label"></a>
### execution label
Why a run happened: `statement`, `selection`, `script`, `filter`, `data`, `multi`, `explain`. *Owner: II-08.*

<a id="fan-out"></a>
### fan-out
Sending one message to many receivers. Deeper: `WsHub.Publish` serialises an event once and queues it to every authenticated client. *Owner: II-06.*

<a id="form-spec"></a>
### form spec
`ConnectionFormSpec`: a provider's list of field descriptions that the generic connection dialog renders. *Owner: II-08.*

<a id="frame"></a>
### frame
One message on a WebSocket. *Owner: II-06.*

<a id="gateway"></a>
### gateway
In Rowlit's Snowflake provider, `ISnowflakeGateway`: a small seam over one pooled connection used for catalog and module calls, replaced by a fake in tests. *Owner: II-09.*

<a id="get-ddl"></a>
### GET_DDL
Snowflake (and Oracle `DBMS_METADATA.GET_DDL`) function returning an object's DDL text. *Owner: II-09.*

<a id="graceful-shutdown"></a>
### graceful shutdown
Stopping new work, finishing or cancelling current work and releasing resources before exit. Deeper: the engine disposes resources, sessions, streams, jobs and source clients in that order with bounded waits. *Owner: II-05.*

<a id="health-check"></a>
### health check
A cheap endpoint that only reports "up": `GET /api/v1/health` (token required). *Owner: II-05.*

<a id="hexagonal-architecture"></a>
### hexagonal architecture
Alistair Cockburn's ports-and-adapters style: the core talks to the world only through ports it owns. Deeper: Rowlit's provider boundary resembles it without using the name. *Owner: II-03.* See also: ports and adapters.

<a id="history"></a>
### history
The engine's log of every execution in `history.db`, with full-text search and pinning. *Owner: II-08.*

<a id="host-key-fingerprint"></a>
### host key fingerprint
A short hash (SHA-256) of an SSH server's public key, used to recognise the server. *Owner: II-08.* See also: known hosts.

<a id="hosted-service"></a>
### hosted service
A background task the .NET host starts and stops with the app (`BackgroundService`); e.g. `ParentWatchdog`. *Owner: II-05.*

<a id="http-session"></a>
### HTTP session
ClickHouse's `session_id` mechanism that gives stateless HTTP requests shared server state. Deeper: each Rowlit console is one. *Owner: II-09.*

<a id="identifier-rules"></a>
### identifier rules
`IdentifierRules(quoteOpen, quoteClose, caseFolding, reservedWords)`: how a provider quotes and folds names. *Owner: II-09.*

<a id="idle-ping"></a>
### idle ping
The engine's `SELECT 1` every 60 s on sessions idle for 30 s, to detect dead connections early. *Owner: II-08.*

<a id="infomessage"></a>
### InfoMessage
The SqlClient event that carries `PRINT` output and server messages (and, with `FireInfoMessageEventOnUserErrors`, errors). *Owner: II-09.*

<a id="interface"></a>
### interface
A list of members a type promises to implement, with no implementation (or default members). *Owner: II-09.*

<a id="jump-host"></a>
### jump host / bastion
A hardened server whose job is to accept SSH logins from outside and reach the private network. *Owner: II-08.* See also: SSH tunnel.

<a id="keep-alive"></a>
### keep-alive
Small periodic messages that keep an idle connection open through firewalls and NAT. Deeper: WebSocket keep-alive every 30 s; SSH keep-alive every 30 s. *Owner: II-06.*

<a id="kestrel"></a>
### Kestrel
ASP.NET Core's built-in HTTP server; the engine binds it to `127.0.0.1` only. *Owner: II-05.*

<a id="keyed-service"></a>
### keyed service
A DI registration with a key, resolved by `GetKeyedService<T>(key)`. Deeper: Rowlit keys per-provider features by provider id and stream factories by stream kind. *Owner: II-05.* See also: provider features.

<a id="keyspace"></a>
### keyspace
Cassandra's top-level namespace for tables, with its replication settings; Rowlit shows keyspaces as schemas. *Owner: II-09.*

<a id="kill-query"></a>
### KILL QUERY
MySQL/MariaDB (and ClickHouse) statement that stops another connection's running statement; Rowlit's cancel sends it on a side connection. *Owner: II-09.*

<a id="known-hosts"></a>
### known hosts
The list of SSH servers and their host key fingerprints a client trusts; Rowlit keeps it in `ssh-known-hosts.json`. *Owner: II-08.*

<a id="late-cancel"></a>
### late cancel
A cancel that arrives after the statement finished. Deeper: Rowlit reports the batch as Ok with a warning saying where its changes went. *Owner: II-08.*

<a id="layered-architecture"></a>
### layered architecture
Code organised in levels, each using only the levels below. Deeper: Rowlit's engine is Core → providers/features → Host. *Owner: II-03.*

<a id="lazy-begin"></a>
### lazy begin
Starting the manual-mode transaction only before the first batch that writes or sets a savepoint. *Owner: II-08.*

<a id="lightweight-transaction"></a>
### lightweight transaction
Cassandra's compare-and-set on one partition (`IF EXISTS`, `IF col = x`), answered with `[applied]`. *Owner: II-09.*

<a id="local-port-forwarding"></a>
### local port forwarding
SSH carrying bytes written to a local port to a remote host:port through the encrypted connection (`ssh -L`). *Owner: II-08.*

<a id="lock-wait"></a>
### lock wait
A statement waiting for a lock another session holds; Rowlit rewrites lock-timeout errors to name the holder sessions. *Owner: II-08.*

<a id="loopback"></a>
### loopback
The `127.0.0.1` network interface that never leaves the machine; the engine listens only there. *Owner: II-03.*

<a id="main-process"></a>
### main process
Electron's Node.js process that owns windows and native APIs and supervises the engine. *Owner: II-03.*

<a id="maxrows"></a>
### MaxRows
The row cap per result set (default 10 000; 0 = unlimited). *Owner: II-08.* See also: truncation, drain.

<a id="microservices"></a>
### microservices
Many small separately deployed programs talking over a network. Deeper: Rowlit is not built this way. *Owner: II-03.*

<a id="microsoft-data-sqlclient"></a>
### Microsoft.Data.SqlClient
Microsoft's ADO.NET driver for SQL Server (7.1.1 in Rowlit). *Owner: II-09.*

<a id="microsoft-data-sqlite"></a>
### Microsoft.Data.Sqlite
Microsoft's ADO.NET driver for SQLite (10.0.13 in Rowlit), synchronous under the hood. *Owner: II-09.*

<a id="middleware"></a>
### middleware
A chain of components that see each HTTP request on the way in and the response on the way out. Deeper: the engine runs error handling, CORS, WebSockets and token auth, in that order. *Owner: II-05.*

<a id="minimal-api"></a>
### minimal API
ASP.NET Core style where endpoints are lambdas mapped on route groups, without controllers. *Owner: II-05.*

<a id="modular-monolith"></a>
### modular monolith
One deployable program split into modules with explicit boundaries. Deeper: the Rowlit engine. *Owner: II-03.*

<a id="module"></a>
### module
A unit of code with one purpose and a clear interface; in the engine, an `IEngineModule` class. *Owner: II-03.* See also: engine module.

<a id="monolith"></a>
### monolith
One deployable program. *Owner: II-03.*

<a id="multi-run"></a>
### multi-run
Running the same batches on several connections at once, each with its own session and history entry (label `multi`). *Owner: II-08.*

<a id="multiplexing"></a>
### multiplexing
Carrying many logical conversations over one connection, told apart by ids (`executionId`, `streamId`, `jobId`). *Owner: II-06.*

<a id="mysqlconnector"></a>
### MySqlConnector
An MIT-licensed asynchronous ADO.NET driver for MySQL and MariaDB (2.4.0 in Rowlit). *Owner: II-09.*

<a id="native-library"></a>
### native library
A platform-specific compiled library (DLL, dylib, so) used by a .NET package, e.g. SQL Server's SNI, `e_sqlite3`, `sf_mini_core`. *Owner: II-09.* See also: self-extract.

<a id="nls"></a>
### NLS
Oracle National Language Support settings such as `NLS_DATE_FORMAT`; Rowlit sets them at session open. *Owner: II-09.*

<a id="no-backslash-escapes"></a>
### NO_BACKSLASH_ESCAPES
A MySQL `sql_mode` in which backslash is an ordinary character in strings. Deeper: Rowlit's MySQL lexers assume escapes are on. *Owner: II-09.*

<a id="npgsql"></a>
### Npgsql
The ADO.NET driver for PostgreSQL (9.0.5 in Rowlit). *Owner: II-09.*

<a id="observer"></a>
### observer
An object that receives callbacks about events another object produces. Deeper: `IExecutionSink` is the observer of an execution. *Owner: II-09.* See also: sink.

<a id="odp-net"></a>
### ODP.NET
Oracle Data Provider for .NET; Rowlit uses the managed `Oracle.ManagedDataAccess.Core` (no Instant Client). *Owner: II-09.*

<a id="onion-architecture"></a>
### onion architecture
Jeffrey Palermo's concentric layers with the domain at the centre and infrastructure outside. *Owner: II-03.* See also: clean architecture.

<a id="orphan-session"></a>
### orphan session
A session whose owning UI window is gone; closed with rollback after `orphanGraceSeconds` (90). *Owner: II-08.*

<a id="ownership-block"></a>
### ownership block
A labelled region `// WP-MY begin … // WP-MY end` in a shared file that only one work package may edit. *Owner: II-07.*

<a id="paging-state"></a>
### paging state
The opaque Cassandra token that resumes a query at the next page. *Owner: II-09.*

<a id="param-binder"></a>
### param binder
`IParamBinder`, a keyed per-provider service that finds placeholders and binds parameter values. *Owner: II-08.*

<a id="parent-watchdog"></a>
### parent watchdog
`ParentWatchdog`: stops the engine when the process given by `--parent-pid` exits. *Owner: II-05.*

<a id="physical-connection"></a>
### physical connection
One real socket to the server with its own server-side state. *Owner: II-08.*

<a id="ping-pong"></a>
### ping/pong
A small request and its reply that prove a connection is alive (`{"type":"ping"}` → `pong`). *Owner: II-06.*

<a id="pinned"></a>
### pinned
A history entry marked to be kept when history is cleared. *Owner: II-08.*

<a id="plugin-system"></a>
### plugin system
Loading code unknown at build time (a plugin folder, load contexts). Deeper: Rowlit has none; modules are compiled in. *Owner: II-07.*

<a id="ports-and-adapters"></a>
### ports and adapters
Another name for hexagonal architecture: ports are interfaces the core owns, adapters implement them outside. *Owner: II-03.*

<a id="preload"></a>
### preload
A script Electron runs before the page, with access to `contextBridge`; it publishes `window.dbstudio`. *Owner: II-03.*

<a id="prepare-diagnostics"></a>
### prepare diagnostics
Syntax and name checks done by asking the server to compile a statement without running it (PostgreSQL `PREPARE` read-only, SQLite `sqlite3_prepare`). *Owner: II-09.*

<a id="process"></a>
### process
A running program with its own memory, isolated by the operating system. *Owner: II-03.*

<a id="provider-features"></a>
### provider features
`ProviderFeatures`: looks up a provider's keyed scripter, designer database, plan reader and binder by id; missing means `400 NOT_SUPPORTED`. *Owner: II-07.*

<a id="provider-registry"></a>
### provider registry
`ProviderRegistry`: every relational `IDbProvider` by id and dialect. *Owner: II-07.*

<a id="query-id"></a>
### query id
A server-side id of one statement (Snowflake, ClickHouse `query_id`) used for plans, history and cancel. *Owner: II-09.*

<a id="query-parameter"></a>
### query parameter
A placeholder (`@id`, `:id`, `$1`, `?`) whose value is sent apart from the SQL text. *Owner: II-08.*

<a id="queued-frames"></a>
### queued frames
Frames waiting in a client's hub queue; above `MaxQueuedFrames` (200 000) the client is disconnected. *Owner: II-06.*

<a id="r1-r4-rules"></a>
### R1–R4 rules
The work-package rules in `docs/wp-notes/README.md`: own paths and labelled blocks, frozen files, requests for shared changes, hand-in gates. *Owner: II-07.*

<a id="read-only-guard"></a>
### read-only guard
`ReadOnlyGuard`: the engine check that refuses non-query batches on a read-only connection with `403 READ_ONLY` unless confirmed. *Owner: II-08.* See also: statement classifier.

<a id="read-only-connection"></a>
### read-only connection
A profile flagged read-only; the engine refuses non-queries (`403 READ_ONLY`) unless the user confirms. *Owner: II-08.*

<a id="reconnect"></a>
### reconnect
Opening a lost connection again; the UI's socket reconnects with backoff, a broken session reconnects on the next run. *Owner: II-06.*

<a id="ref-cursor"></a>
### REF CURSOR
An Oracle pointer to an open result set. Deeper: out parameters of this type stream as extra result sets; cursor columns are shown as `{"$cursor":true}`. *Owner: II-09.*

<a id="reflection"></a>
### reflection
The runtime API that inspects assemblies and types and creates instances. *Owner: II-07.*

<a id="registry-pattern"></a>
### registry pattern
One object maps keys to implementations so callers never construct them. *Owner: II-07.*

<a id="release-reason"></a>
### release reason
Why a session was released: `idle`, `closed`, `pressure` or `limit`. *Owner: II-08.*

<a id="released-session"></a>
### released session
A session whose connection the engine closed on purpose; it reopens quietly on next use with the same id. *Owner: II-08.*

<a id="renderer"></a>
### renderer
The Chromium process that draws the web page; in Rowlit it is sandboxed and holds no driver. *Owner: II-03.*

<a id="result-store"></a>
### result store
`ResultStore`: the latest execution's capped rows per session (256 MB LRU) for paging, cell fetch and export. *Owner: II-08.*

<a id="role-interface"></a>
### role interface
A small interface a class implements to announce one capability, discovered by a type test (`IObjectBrowserProvider`). *Owner: II-07.*

<a id="role-snowflake"></a>
### role (Snowflake)
Snowflake's unit of privileges; the current role decides what a session may see and do. *Owner: II-09.*

<a id="route-group"></a>
### route group
A shared path prefix for several endpoints (`/api/v1/sessions`). *Owner: II-05.*

<a id="savepoint-per-statement"></a>
### savepoint per statement
PostgreSQL decision D-PG3: each manual-mode batch runs inside `SAVEPOINT dbstudio_stmt`, so one error does not abort the transaction. *Owner: II-08.*

<a id="schema-mode"></a>
### schema mode
`None`, `ReadOnly` or `Session`: whether a session's default schema can be changed. *Owner: II-08.*

<a id="script"></a>
### script
The whole editor text, run with the label `script`. *Owner: II-08.*

<a id="scriptdom"></a>
### ScriptDom
Microsoft's T-SQL parser library; Rowlit uses it for SQL Server syntax diagnostics. *Owner: II-09.*

<a id="search-path"></a>
### search_path
PostgreSQL's list of schemas searched for unqualified names. *Owner: II-09.*

<a id="self-extract"></a>
### self-extract
A single-file .NET app unpacking bundled native libraries at start (`IncludeNativeLibrariesForSelfExtract`). *Owner: II-09.*

<a id="separation-of-concerns"></a>
### separation of concerns
Each part handles one kind of problem. *Owner: II-03.*

<a id="sequence-number"></a>
### sequence number
A counter on stream batches (`seq`) that lets the UI detect gaps. *Owner: II-06.*

<a id="serilog"></a>
### Serilog
A .NET structured-logging library; the engine writes `logs/engine-<date>.log` with it. *Owner: II-05.*

<a id="service-lifetime"></a>
### service lifetime
How long a DI instance lives: singleton, scoped (per request) or transient. *Owner: II-05.*

<a id="session"></a>
### session
Rowlit's engine object for one tab's private database connection. *Owner: II-08.* See also: session handle.

<a id="session-handle"></a>
### session handle
`SessionHandle`: wraps an `IDbSession` with busy reservation, activity, release state and owner. *Owner: II-08.*

<a id="sidecar"></a>
### sidecar
A helper process started and owned by the main application, living and dying with it; Rowlit's engine. *Owner: II-03.*

<a id="singleton"></a>
### singleton
One instance for the whole process lifetime; almost every engine service is one. *Owner: II-05.*

<a id="sink"></a>
### sink
The object an execution reports to (`IExecutionSink`): result sets, rows, messages, errors. *Owner: II-08.* See also: observer.

<a id="sni"></a>
### SNI
SQL Server Network Interface, SqlClient's native network library on Windows. *Owner: II-09.*

<a id="snowflake-data"></a>
### Snowflake.Data
Snowflake's .NET driver (6.4.0 in Rowlit). *Owner: II-09.*

<a id="solid"></a>
### SOLID
Five object-oriented design principles: single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion. *Owner: II-03.*

<a id="source-registry"></a>
### source registry
`SourceRegistry`: every provider id, relational and not, in a fixed display order. *Owner: II-07.*

<a id="sqlstate"></a>
### SQLSTATE
The five-character standard SQL error code (e.g. `42P01`). *Owner: II-09.*

<a id="ssh-tunnel"></a>
### SSH tunnel
An encrypted pipe through an SSH server that forwards a local port to the database. *Owner: II-08.*

<a id="statement"></a>
### statement
One SQL command. *Owner: II-08.*

<a id="statement-classifier"></a>
### statement classifier
`StatementClassifier`: heuristic classification of statements (Query, Dml, Ddl…) for read-only, history and catalog invalidation. *Owner: II-08.*

<a id="strict"></a>
### STRICT
A SQLite table option that enforces column types. *Owner: II-09.*

<a id="structured-logging"></a>
### structured logging
Logging that keeps named values (`{Port}`) as data, not only text. *Owner: II-05.*

<a id="stub"></a>
### stub
Placeholder code that stands in until the real change lands, marked `TODO(WP<XX>-shared)`. *Owner: II-07.*

<a id="subscription"></a>
### subscription
A handler registered for one event type or id (`executionId`, `streamId`, `jobId`) on `EngineSocket`. *Owner: II-06.*

<a id="temp-objects"></a>
### temp objects
Temporary tables or objects a session created; such sessions are never released automatically. *Owner: II-08.*

<a id="timeprovider"></a>
### TimeProvider
.NET's injectable clock; tests use it to move time. *Owner: II-05.*

<a id="tracing-cql"></a>
### tracing (CQL)
Cassandra's per-request record of coordinator work in `system_traces`; Rowlit's replacement for EXPLAIN. *Owner: II-09.*

<a id="transaction-mode"></a>
### transaction mode
`Auto` (driver autocommit) or `Manual` (engine transaction until Commit or Rollback). *Owner: II-08.*

<a id="trimming"></a>
### trimming
Removing unused code at publish; off in Rowlit because modules are created by reflection. *Owner: II-07.*

<a id="truncation"></a>
### truncation
Stopping a result set at `MaxRows` and marking it `truncated`. *Owner: II-08.*

<a id="trust-boundary"></a>
### trust boundary
A line where calls or data cross from a less trusted side to a more trusted one and must be checked. *Owner: II-03.*

<a id="trust-on-first-use"></a>
### trust on first use
Accepting a server's key the first time and refusing any different key later. *Owner: II-08.*

<a id="tunnel-resolver"></a>
### tunnel resolver
`ITunnelResolver`: turns a profile into one pointed at the local end of its tunnel; implemented by `SshTunnelService`. *Owner: II-08.*

<a id="txopen"></a>
### TxOpen
Whether a session has an open transaction, engine-owned or user-typed; sent in `exec.done` and `session.changed`. *Owner: II-08.*

<a id="udt"></a>
### UDT
User-defined type; in Cassandra a named composite column type. *Owner: II-09.*

<a id="unbound-parameter"></a>
### unbound parameter
A placeholder without a value; PostgreSQL and SQLite reject the run before anything executes. *Owner: II-08.*

<a id="warehouse"></a>
### warehouse
Snowflake's compute cluster, billed while running; Rowlit's catalog never resumes one. *Owner: II-09.* See also: role (Snowflake).

<a id="websocket"></a>
### WebSocket
A long-lived two-way connection that starts as an HTTP request; Rowlit has one per UI window. *Owner: II-06.*

<a id="websocket-hub"></a>
### WebSocket hub
`WsHub`: accepts sockets, authenticates them and fans events out to every client queue. *Owner: II-06.*

<a id="wire-value"></a>
### wire value
The JSON form of a cell: big integers and decimals as strings, `{"$bin"}`, `{"$trunc"}`, `{"$cursor"}`. *Owner: II-08.*

<a id="without-rowid"></a>
### WITHOUT ROWID
A SQLite table option that stores the table clustered by its primary key, with no hidden rowid. *Owner: II-09.*

<a id="work-package"></a>
### work package (WP)
A unit of work given to one team or agent with its own files and notes (WP-MY, LINKS-WPA…). *Owner: II-07.*

## Persian rows (ردیف‌های فارسی)

<div dir="rtl">

<a id="ado-net"></a>
### ADO.NET — ADO.NET
API استاندارد پایگاه داده در ‎.NET (‏`DbConnection`، `DbCommand`، `DbDataReader`). هفت فراهم‌کنندهٔ رابطه‌ای Rowlit از راه `AdoSessionBase` روی آن سوارند. *مالک: II-09.*

<a id="adapter"></a>
### adapter — مبدل
کدی که یک واسط را به واسطی که کلاینت انتظار دارد تبدیل می‌کند؛ فراهم‌کنندهٔ Rowlit درایور را با قرارداد هسته جور می‌کند. *مالک: II-03.*

<a id="all-errors"></a>
### ALL_ERRORS — ALL_ERRORS
نمای فرهنگ دادهٔ Oracle با خطاهای کامپایل واحدهای PL/SQL؛ پس از `CREATE` با ORA-24344 خوانده و به `exec.diagnostics` تبدیل می‌شود. *مالک: II-09.*

<a id="anchor-type"></a>
### anchor type — نوع لنگر
یک `typeof(...)` برای هر اسمبلی ماژول در `ModuleAssemblies.cs` که ارجاع کامپایل‌شده را نگه می‌دارد تا کشف ماژول‌ها کار کند. *مالک: II-07.*

<a id="animation-frame-batching"></a>
### animation-frame batching — دسته‌بندی به ازای فریم نمایش
جمع کردن رویدادها و اعمال آن‌ها یک بار در هر رسم دوبارهٔ مرورگر (`requestAnimationFrame`). *مالک: II-06.*

<a id="asp-net-core"></a>
### ASP.NET Core — ASP.NET Core
چارچوب وب مایکروسافت برای ‎.NET؛ میزبان موتور یک برنامهٔ minimal API روی Kestrel است. *مالک: II-05.*

<a id="assembly"></a>
### assembly — اسمبلی
کتابخانه یا برنامهٔ اجرایی کامپایل‌شدهٔ ‎.NET همراه فرادادهٔ نوع‌ها و ارجاع‌ها. *مالک: II-07.*

<a id="attached-database"></a>
### attached database — پایگاه دادهٔ الحاقی
پروندهٔ SQLite دیگری که روی همان اتصال با نام یک شِما باز می‌شود (`ATTACH DATABASE`). *مالک: II-09.*

<a id="attention"></a>
### attention — سیگنال attention
سیگنال TDS که کلاینت SQL Server برای لغو دستهٔ در حال اجرا می‌فرستد. *مالک: II-09.*

<a id="auth-frame"></a>
### auth frame — فریم احراز هویت
نخستین پیام WebSocket با توکن و شناسهٔ کلاینت؛ نادرست یا دیرتر از ۲ ثانیه یعنی بستن با کد 4401. *مالک: II-06.*

<a id="back-pressure"></a>
### back-pressure — فشار برگشتی
راهی که مصرف‌کنندهٔ کند تولیدکنندهٔ تند را کند کند؛ هاب Rowlit به‌جایش کلاینتی را که صفش از ۲۰۰٬۰۰۰ فریم بگذرد قطع می‌کند. *مالک: II-06.*

<a id="backoff"></a>
### backoff — عقب‌نشینی
انتظار طولانی‌تر پس از هر تلاش ناموفق؛ `EngineSocket` از ۲۵۰ میلی‌ثانیه تا ۸ ثانیه. *مالک: II-06.*

<a id="batch"></a>
### batch — دسته
یک واحد فرستاده‌شده به کارساز: بلوک جداشده با `GO` در T-SQL و معمولاً یک دستور در بقیه، همراه سطر و ستونش در سند. *مالک: II-08.*

<a id="bearer-token"></a>
### bearer token — توکن حامل
رمزی که هرکس داشته باشد مورد اعتماد است؛ موتور در هر اجرا ۳۲ بایت تصادفی می‌سازد. *مالک: II-03.*

<a id="bind"></a>
### bind — مقیدسازی
وصل کردن یک مقدار به جای‌نگهدار تا جدا از متن SQL منتقل شود. *مالک: II-08.*

<a id="broken-session"></a>
### broken session — نشست شکسته
نشستی که اتصالش مُرده؛ اجرای بعدی با همان شناسه دوباره بازش می‌کند و اگر تراکنشی از دست رفته باشد `409 SESSION_BROKEN` می‌دهد. *مالک: II-08.*

<a id="busy"></a>
### busy — مشغول
وضعیت نشستی که در حال اجرا یا رزروشده است؛ اجرای دوم `409 SESSION_BUSY` می‌گیرد. *مالک: II-08.*

<a id="camelcase"></a>
### camelCase — camelCase
نوشتن نام با واژهٔ اول کوچک و بقیه با حرف اول بزرگ (`connectionId`)؛ قرارداد همهٔ JSON موتور. *مالک: II-05.*

<a id="cancel"></a>
### cancel — لغو
متوقف کردن دستور در حال اجرا؛ هر درایور راه خودش را دارد (attention، TNS break، cancel request، `sqlite3_interrupt`، `KILL QUERY`). *مالک: II-08.*

<a id="cancellationtoken"></a>
### CancellationToken — توکن لغو
شیء ‎.NET برای درخواست توقف یک عملیات. *مالک: II-05.*

<a id="case-folding"></a>
### case folding — یکسان‌سازی حروف
کاری که کارساز با نام بی‌گیومه می‌کند: Oracle و Snowflake بزرگ، PostgreSQL و Cassandra کوچک، بقیه دست‌نخورده. *مالک: II-09.*

<a id="cassandracsharpdriver"></a>
### CassandraCSharpDriver — CassandraCSharpDriver
درایور C# شرکت DataStax برای Cassandra و ScyllaDB (نسخهٔ 3.22.1). *مالک: II-09.*

<a id="cell-fetch"></a>
### cell fetch — واکشی خانه
گرفتن مقدار کامل یک خانهٔ بریده‌شده با `GET .../cell` بدون اجرای دوباره. *مالک: II-08.*

<a id="cell-kind"></a>
### cell kind — نوع خانه
‏`ColumnInfo.kind` (‏`int`، `decimal`، `string`، `datetime`، `binary`، `json`…) که به جدول نتیجه می‌گوید ستون را چطور رسم و تراز کند. *مالک: II-08.*

<a id="channel"></a>
### channel — کانال
صف ناهمزمان تولیدکننده/مصرف‌کنندهٔ `Channel<T>`؛ هاب برای هر کلاینت یک `Channel<byte[]>` دارد. *مالک: II-06.*

<a id="clean-architecture"></a>
### clean architecture — معماری تمیز
سبک دایره‌های هم‌مرکز رابرت مارتین که وابستگی‌ها فقط به درون اشاره می‌کنند؛ Rowlit این نام را به کار نمی‌برد و هسته‌اش به ASP.NET، SQLite و SSH.NET ارجاع می‌دهد. *مالک: II-03.*

<a id="clickhouse-driver"></a>
### ClickHouse.Driver — ClickHouse.Driver
کلاینت رسمی ADO.NET برای ClickHouse روی HTTP (نسخهٔ 1.5.0). *مالک: II-09.*

<a id="client-id"></a>
### client id — شناسهٔ کلاینت
شناسهٔ مبهمی که هر پنجره در `X-DbStudio-Client` و فریم احراز هویت می‌فرستد و مالکیت نشست‌ها و جریان‌ها را تعیین می‌کند. *مالک: II-05.*

<a id="client-presence"></a>
### client presence — حضور کلاینت
ثبت موتور از کلاینت‌هایی که WebSocket زنده دارند؛ با بسته شدن آخرین سوکت `ClientGone` بالا می‌آید. *مالک: II-05.*

<a id="composition-root"></a>
### composition root — ریشهٔ ترکیب
تنها جایی که برنامه اشیایش را می‌سازد و پیاده‌سازی‌ها را به واسط‌ها وصل می‌کند؛ در Rowlit `Program.cs` و هر `IEngineModule`. *مالک: II-03.*

<a id="connection-pooling"></a>
### connection pooling — استخر اتصال
باز نگه داشتن اتصال‌های بسته‌شده برای استفادهٔ دوباره؛ برای نشست‌ها خاموش و برای کاتالوگ روشن است. *مالک: II-08.*

<a id="connection-profile"></a>
### connection profile — نمایهٔ اتصال
رکورد ذخیره‌شده و نام‌دار دربارهٔ چگونگی رسیدن به کارساز، بدون گذرواژه. *مالک: II-08.*

<a id="connection-store"></a>
### connection store — انبار اتصال‌ها
‏`ConnectionStore`: نمایه‌ها را در `connections.json` نگه می‌دارد، فیلدهای گذرواژه را به انبار رمز می‌برد و پیش از باز شدن درایور رمزها و تونل را حل می‌کند. *مالک: II-08.*

<a id="connection-string"></a>
### connection string — رشتهٔ اتصال
متن `key=value;` که درایور برای اتصال می‌خواند. *مالک: II-09.*

<a id="contract"></a>
### contract — قرارداد
شکل توافق‌شدهٔ درخواست‌ها، پاسخ‌ها، رویدادها یا واسط‌ها که دو طرف بر اساس آن کد می‌نویسند. *مالک: II-05.*

<a id="cqlsh"></a>
### cqlsh — cqlsh
پوستهٔ خط فرمان Cassandra؛ کنسول CQL در Rowlit فرمان‌هایش را می‌فهمد. *مالک: II-09.*

<a id="dbms-output"></a>
### DBMS_OUTPUT — DBMS_OUTPUT
بافر سمت کارساز Oracle برای خروجی PL/SQL که Rowlit پس از هر دسته با `GET_LINES` تخلیه‌اش می‌کند. *مالک: II-09.*

<a id="dbstudio-ready"></a>
### DBSTUDIO_READY — سطر DBSTUDIO_READY
تنها سطر stdout موتور با درگاه و توکن، که ناظر Electron منتظرش می‌ماند. *مالک: II-05.*

<a id="ddl-scope"></a>
### DDL scope — دامنهٔ DDL
گسترهٔ یک دستور DDL: `Object`، `Database` یا `Temporary`؛ باطل کردن کاتالوگ را می‌راند. *مالک: II-08.*

<a id="default-interface-member"></a>
### default interface member — عضو پیش‌فرض واسط
عضو واسط C# با بدنه که افزودنش پیاده‌سازها را نمی‌شکند. *مالک: II-07.*

<a id="delimiter"></a>
### DELIMITER — DELIMITER
فرمان کلاینت `mysql` برای عوض کردن پایان‌دهندهٔ دستور؛ شکنندهٔ MySQL در Rowlit آن را رعایت می‌کند. *مالک: II-09.*

<a id="dependency-injection"></a>
### dependency injection — تزریق وابستگی
ظرفی که اشیا را می‌سازد و وابستگی‌های اعلام‌شدهٔ هرکدام را به آن می‌دهد. *مالک: II-05.*

<a id="dependency-inversion"></a>
### dependency inversion — وارونگی وابستگی
کد درونی واسطی را که نیاز دارد تعریف می‌کند و کد بیرونی پیاده‌اش می‌کند؛ در لبهٔ درایور Rowlit به کار رفته است. *مالک: II-03.*

<a id="dependency-rule"></a>
### dependency rule — قاعدهٔ وابستگی
قاعدهٔ معماری تمیز که وابستگی‌های کد فقط به درون اشاره کنند. *مالک: II-03.*

<a id="describe"></a>
### describe — describe
گرفتن ستون‌های نتیجهٔ یک پرس‌وجو بدون اجرایش؛ ویرایش‌پذیری نتیجه را هم تعیین می‌کند. *مالک: II-08.*

<a id="destructive-statement"></a>
### destructive statement — دستور ویرانگر
DELETE/UPDATE بدون WHERE، DROP یا TRUNCATE. *مالک: II-08.*

<a id="dialect-info"></a>
### dialect info — اطلاعات گویش
‏`DialectInfo`: جدول ایستای ویژگی‌های هر گویش (سطح پایگاه داده، نقل‌قول، نحو توضیح و رشته). *مالک: II-09.*

<a id="drain"></a>
### drain — تخلیه
خواندن و دور ریختن باقی یک مجموعهٔ نتیجه پس از سقف سطرها تا مجموعه‌های بعدی خوانده شوند. *مالک: II-08.*

<a id="dropped-items"></a>
### dropped items — اقلام دورریخته
اقلامی که جریان مجبور شد رد کند و در `stream.data` با `dropped` گزارش می‌شوند. *مالک: II-06.*

<a id="dto"></a>
### DTO — شیء انتقال داده
رکوردی ساده که فقط داده را از مرزی عبور می‌دهد. *مالک: II-05.*

<a id="endpoint"></a>
### endpoint — نقطهٔ پایانی
یک متد HTTP همراه مسیر و کدی که پاسخش را می‌دهد. *مالک: II-05.*

<a id="engine-module"></a>
### engine module — ماژول موتور
کلاسی که `IEngineModule` را پیاده می‌کند و ریشهٔ ترکیب یک بستهٔ قابلیت است؛ ۱۷ تا کشف می‌شوند. *مالک: II-07.*

<a id="error-code"></a>
### error code — کد خطا
‏`code` ماشین‌خوان خطا (`TX_OPEN`، `READ_ONLY`، `SSH_TUNNEL`…). *مالک: II-05.*

<a id="error-envelope"></a>
### error envelope — پاکت خطا
شکل یگانهٔ بدنهٔ خطا `{"error":{"code","message","detail"}}` در هر پاسخ غیر 2xx. *مالک: II-05.*

<a id="event"></a>
### event — رویداد
پیام کوچک JSON با `type` و `ts` که موتور از راه WebSocket به رابط کاربری می‌فرستد. *مالک: II-06.*

<a id="event-types"></a>
### event types — انواع رویداد
رشته‌های `type` در `Events.cs`: ‏`exec.*`، `session.changed`، `catalog.changed`، `stream.*`، `job.*`، `resources.*`، `export.*`، `engine.log`، `auth.ok`، `pong`. *مالک: II-06.*

<a id="exact-decimal"></a>
### exact decimal — decimal دقیق
مقدار پارامتری که چون `System.Decimal` گنجایشش را ندارد به‌صورت متن نگه داشته می‌شود (حداکثر ۲۰٬۰۰۰ رقم). *مالک: II-08.*

<a id="execution-id"></a>
### execution id — شناسهٔ اجرا
شناسهٔ `x…` که `POST /execute` برمی‌گرداند و همهٔ رویدادهای `exec.*` یک اجرا را به هم می‌بندد. *مالک: II-08.*

<a id="execution-label"></a>
### execution label — برچسب اجرا
دلیل اجرا: `statement`، `selection`، `script`، `filter`، `data`، `multi`، `explain`. *مالک: II-08.*

<a id="fan-out"></a>
### fan-out — پخش
فرستادن یک پیام به گیرنده‌های زیاد؛ هاب هر رویداد را یک بار سریال و در صف همهٔ کلاینت‌ها می‌گذارد. *مالک: II-06.*

<a id="form-spec"></a>
### form spec — مشخصات فرم
فهرست توصیف فیلدهای یک فراهم‌کننده که پنجرهٔ اتصال عمومی رسمشان می‌کند. *مالک: II-08.*

<a id="frame"></a>
### frame — فریم
یک پیام روی WebSocket. *مالک: II-06.*

<a id="gateway"></a>
### gateway — دروازه
در فراهم‌کنندهٔ Snowflake، `ISnowflakeGateway`: درزی کوچک روی یک اتصال استخری که در آزمون‌ها با نسخهٔ ساختگی جایگزین می‌شود. *مالک: II-09.*

<a id="get-ddl"></a>
### GET_DDL — GET_DDL
تابع Snowflake (و `DBMS_METADATA.GET_DDL` در Oracle) که متن DDL یک شیء را برمی‌گرداند. *مالک: II-09.*

<a id="graceful-shutdown"></a>
### graceful shutdown — خاموشی آرام
نپذیرفتن کار تازه، تمام یا لغو کردن کار جاری و آزاد کردن منابع پیش از خروج. *مالک: II-05.*

<a id="health-check"></a>
### health check — بررسی سلامت
نقطهٔ پایانی ارزانی که فقط «زنده‌ام» می‌گوید: `GET /api/v1/health` (با توکن). *مالک: II-05.*

<a id="hexagonal-architecture"></a>
### hexagonal architecture — معماری شش‌ضلعی
سبک درگاه‌ها و مبدل‌های کاکبرن که هسته فقط از راه درگاه‌های خودش با جهان حرف می‌زند؛ مرز فراهم‌کنندهٔ Rowlit به آن شبیه است. *مالک: II-03.*

<a id="history"></a>
### history — تاریخچه
گزارش موتور از هر اجرا در `history.db` با جست‌وجوی متن کامل و سنجاق. *مالک: II-08.*

<a id="host-key-fingerprint"></a>
### host key fingerprint — اثر انگشت کلید میزبان
چکیدهٔ کوتاه (SHA-256) کلید عمومی کارساز SSH برای شناختن آن. *مالک: II-08.*

<a id="hosted-service"></a>
### hosted service — سرویس میزبانی‌شده
کار پس‌زمینه‌ای که میزبان ‎.NET همراه برنامه شروع و متوقف می‌کند؛ مثل `ParentWatchdog`. *مالک: II-05.*

<a id="http-session"></a>
### HTTP session — نشست HTTP
سازوکار `session_id` در ClickHouse که به درخواست‌های بی‌حالت HTTP وضعیت مشترک می‌دهد. *مالک: II-09.*

<a id="identifier-rules"></a>
### identifier rules — قاعده‌های شناسه
چگونگی نقل‌قول و یکسان‌سازی حروف نام‌ها در یک فراهم‌کننده، همراه واژه‌های رزرو. *مالک: II-09.*

<a id="idle-ping"></a>
### idle ping — ping بیکاری
‏`SELECT 1` موتور هر ۶۰ ثانیه روی نشست‌های بیکار برای تشخیص زودهنگام اتصال مرده. *مالک: II-08.*

<a id="infomessage"></a>
### InfoMessage — InfoMessage
رویداد SqlClient که خروجی `PRINT`، پیام‌های کارساز و (با پرچم مربوط) خطاها را حمل می‌کند. *مالک: II-09.*

<a id="interface"></a>
### interface — واسط
فهرست عضوهایی که یک نوع قول پیاده‌سازی‌شان را می‌دهد. *مالک: II-09.*

<a id="jump-host"></a>
### jump host / bastion — میزبان پرش / بستیون
کارساز سخت‌شده‌ای که ورود SSH از بیرون را می‌پذیرد و به شبکهٔ خصوصی می‌رساند. *مالک: II-08.*

<a id="keep-alive"></a>
### keep-alive — زنده‌نگه‌دار
پیام‌های کوچک دوره‌ای که اتصال بیکار را از میان دیوار آتش و NAT باز نگه می‌دارند (WebSocket و SSH هر ۳۰ ثانیه). *مالک: II-06.*

<a id="kestrel"></a>
### Kestrel — Kestrel
کارساز HTTP درونی ASP.NET Core که موتور فقط به `127.0.0.1` می‌بندد. *مالک: II-05.*

<a id="keyed-service"></a>
### keyed service — سرویس کلیددار
ثبت DI همراه یک کلید که با `GetKeyedService<T>(key)` حل می‌شود؛ کلیدها شناسهٔ فراهم‌کننده یا نوع جریان‌اند. *مالک: II-05.*

<a id="keyspace"></a>
### keyspace — keyspace
فضای نام سطح بالای Cassandra برای جدول‌ها همراه تنظیمات همانندسازی؛ در Rowlit به‌صورت شِما نشان داده می‌شود. *مالک: II-09.*

<a id="kill-query"></a>
### KILL QUERY — KILL QUERY
دستوری در MySQL/MariaDB (و ClickHouse) که دستور در حال اجرای اتصال دیگری را متوقف می‌کند. *مالک: II-09.*

<a id="known-hosts"></a>
### known hosts — میزبان‌های شناخته‌شده
فهرست کارسازهای SSH و اثر انگشت کلیدشان که کلاینت به آن‌ها اعتماد دارد (`ssh-known-hosts.json`). *مالک: II-08.*

<a id="late-cancel"></a>
### late cancel — لغو دیرهنگام
لغوی که پس از تمام شدن دستور برسد؛ دسته Ok همراه هشدار گزارش می‌شود. *مالک: II-08.*

<a id="layered-architecture"></a>
### layered architecture — معماری لایه‌ای
کدی در سطح‌ها که هر سطح فقط از سطح‌های زیرین استفاده کند؛ موتور Rowlit: هسته ← فراهم‌کننده‌ها/قابلیت‌ها ← میزبان. *مالک: II-03.*

<a id="lazy-begin"></a>
### lazy begin — آغاز تنبل
آغاز تراکنش حالت دستی فقط پیش از نخستین دسته‌ای که می‌نویسد یا نقطهٔ ذخیره می‌گذارد. *مالک: II-08.*

<a id="lightweight-transaction"></a>
### lightweight transaction — تراکنش سبک
مقایسه-و-تنظیم Cassandra روی یک پارتیشن (`IF EXISTS`) با پاسخ `[applied]`. *مالک: II-09.*

<a id="local-port-forwarding"></a>
### local port forwarding — هدایت درگاه محلی
حمل بایت‌های یک درگاه محلی به میزبان:درگاهی دور از میان اتصال رمزنگاری‌شدهٔ SSH (`ssh -L`). *مالک: II-08.*

<a id="lock-wait"></a>
### lock wait — انتظار قفل
دستوری که منتظر قفل نشستی دیگر است؛ Rowlit نشست‌های نگه‌دارنده را در پیام نام می‌برد. *مالک: II-08.*

<a id="loopback"></a>
### loopback — حلقهٔ محلی
واسط شبکهٔ `127.0.0.1` که هرگز از رایانه بیرون نمی‌رود. *مالک: II-03.*

<a id="main-process"></a>
### main process — فرایند اصلی
فرایند Node.js در Electron که صاحب پنجره‌ها و APIهای بومی است و موتور را نظارت می‌کند. *مالک: II-03.*

<a id="maxrows"></a>
### MaxRows — سقف سطرها
سقف سطرهای هر مجموعهٔ نتیجه (پیش‌فرض ۱۰٬۰۰۰؛ صفر = نامحدود). *مالک: II-08.*

<a id="microservices"></a>
### microservices — ریزسرویس‌ها
برنامه‌های کوچک بسیاری که جدا مستقر می‌شوند و از راه شبکه حرف می‌زنند؛ Rowlit چنین نیست. *مالک: II-03.*

<a id="microsoft-data-sqlclient"></a>
### Microsoft.Data.SqlClient — Microsoft.Data.SqlClient
درایور ADO.NET مایکروسافت برای SQL Server (نسخهٔ 7.1.1). *مالک: II-09.*

<a id="microsoft-data-sqlite"></a>
### Microsoft.Data.Sqlite — Microsoft.Data.Sqlite
درایور ADO.NET مایکروسافت برای SQLite (نسخهٔ 10.0.13) که در زیر همزمان است. *مالک: II-09.*

<a id="middleware"></a>
### middleware — میان‌افزار
زنجیره‌ای از مؤلفه‌ها که هر درخواست HTTP را در رفت و پاسخ را در برگشت می‌بینند؛ موتور به ترتیب خطا، CORS، WebSocket و توکن را اجرا می‌کند. *مالک: II-05.*

<a id="minimal-api"></a>
### minimal API — minimal API
سبکی در ASP.NET Core که نقطه‌های پایانی lambdaهایی روی گروه‌های مسیرند، بدون کنترل‌گر. *مالک: II-05.*

<a id="modular-monolith"></a>
### modular monolith — تک‌پارچهٔ ماژولار
یک برنامهٔ قابل‌استقرار که به ماژول‌هایی با مرزهای صریح تقسیم شده؛ موتور Rowlit. *مالک: II-03.*

<a id="module"></a>
### module — ماژول
واحدی از کد با یک هدف و واسطی روشن؛ در موتور، کلاسی از نوع `IEngineModule`. *مالک: II-03.*

<a id="monolith"></a>
### monolith — تک‌پارچه
یک برنامهٔ قابل‌استقرار. *مالک: II-03.*

<a id="multi-run"></a>
### multi-run — اجرای چندگانه
اجرای همان دسته‌ها روی چند اتصال هم‌زمان، هرکدام با نشست و مدخل تاریخچهٔ خودش (برچسب `multi`). *مالک: II-08.*

<a id="multiplexing"></a>
### multiplexing — تسهیم
حمل چند گفت‌وگوی منطقی روی یک اتصال که با شناسه‌ها از هم جدا می‌شوند. *مالک: II-06.*

<a id="mysqlconnector"></a>
### MySqlConnector — MySqlConnector
درایور ناهمزمان ADO.NET با مجوز MIT برای MySQL و MariaDB (نسخهٔ 2.4.0). *مالک: II-09.*

<a id="native-library"></a>
### native library — کتابخانهٔ بومی
کتابخانهٔ کامپایل‌شدهٔ مخصوص سکو (DLL، dylib، so) که یک بستهٔ ‎.NET به کار می‌برد؛ مثل SNI و `e_sqlite3`. *مالک: II-09.*

<a id="nls"></a>
### NLS — NLS
تنظیمات National Language Support در Oracle مثل `NLS_DATE_FORMAT` که Rowlit هنگام باز کردن نشست تنظیم می‌کند. *مالک: II-09.*

<a id="no-backslash-escapes"></a>
### NO_BACKSLASH_ESCAPES — NO_BACKSLASH_ESCAPES
حالتی از `sql_mode` در MySQL که بک‌اسلش در رشته نویسه‌ای معمولی است؛ واژه‌کاوهای Rowlit گریز را روشن فرض می‌کنند. *مالک: II-09.*

<a id="npgsql"></a>
### Npgsql — Npgsql
درایور ADO.NET برای PostgreSQL (نسخهٔ 9.0.5). *مالک: II-09.*

<a id="observer"></a>
### observer — ناظر
شیئی که دربارهٔ رویدادهای شیء دیگر فراخوانی برگشتی می‌گیرد؛ `IExecutionSink` ناظر یک اجراست. *مالک: II-09.*

<a id="odp-net"></a>
### ODP.NET — ODP.NET
‏Oracle Data Provider for .NET؛ Rowlit نسخهٔ مدیریت‌شده را بدون Instant Client به کار می‌برد. *مالک: II-09.*

<a id="onion-architecture"></a>
### onion architecture — معماری پیازی
لایه‌های هم‌مرکز پالرمو با دامنه در مرکز و زیرساخت در بیرون. *مالک: II-03.*

<a id="orphan-session"></a>
### orphan session — نشست یتیم
نشستی که پنجرهٔ صاحبش رفته؛ پس از `orphanGraceSeconds` (۹۰) با rollback بسته می‌شود. *مالک: II-08.*

<a id="ownership-block"></a>
### ownership block — بلوک مالکیت
ناحیهٔ برچسب‌خورده `// WP-MY begin … end` در پرونده‌ای مشترک که فقط یک بستهٔ کاری می‌تواند ویرایشش کند. *مالک: II-07.*

<a id="paging-state"></a>
### paging state — وضعیت صفحه‌بندی
نشانهٔ مبهم Cassandra که پرس‌وجو را از صفحهٔ بعد ادامه می‌دهد. *مالک: II-09.*

<a id="param-binder"></a>
### param binder — مقیدکنندهٔ پارامتر
‏`IParamBinder`: سرویس کلیددار هر فراهم‌کننده که جای‌نگهدارها را پیدا و مقدارها را مقید می‌کند. *مالک: II-08.*

<a id="parent-watchdog"></a>
### parent watchdog — نگهبان والد
‏`ParentWatchdog`: وقتی فرایند `--parent-pid` خارج شود موتور را متوقف می‌کند. *مالک: II-05.*

<a id="physical-connection"></a>
### physical connection — اتصال فیزیکی
یک سوکت واقعی به کارساز با وضعیت سمت کارساز خودش. *مالک: II-08.*

<a id="ping-pong"></a>
### ping/pong — ping/pong
درخواست و پاسخی کوچک که زنده بودن اتصال را ثابت می‌کنند. *مالک: II-06.*

<a id="pinned"></a>
### pinned — سنجاق‌شده
مدخل تاریخچه‌ای که هنگام پاک کردن تاریخچه نگه داشته می‌شود. *مالک: II-08.*

<a id="plugin-system"></a>
### plugin system — سامانهٔ افزونه
بارگذاری کدی که هنگام ساخت ناشناخته بوده؛ Rowlit چنین چیزی ندارد و ماژول‌ها درون آن کامپایل شده‌اند. *مالک: II-07.*

<a id="ports-and-adapters"></a>
### ports and adapters — درگاه‌ها و مبدل‌ها
نام دیگر معماری شش‌ضلعی: درگاه‌ها واسط‌های مال هسته‌اند و مبدل‌ها بیرون پیاده‌شان می‌کنند. *مالک: II-03.*

<a id="preload"></a>
### preload — اسکریپت preload
اسکریپتی که Electron پیش از صفحه با دسترسی به `contextBridge` اجرا می‌کند و `window.dbstudio` را منتشر می‌کند. *مالک: II-03.*

<a id="prepare-diagnostics"></a>
### prepare diagnostics — پیام‌های تشخیصی با prepare
بررسی نحو و نام‌ها با خواستن از کارساز برای کامپایل بدون اجرا (‏`PREPARE` فقط‌خواندنی در PostgreSQL، `sqlite3_prepare`). *مالک: II-09.*

<a id="process"></a>
### process — فرایند
برنامه‌ای در حال اجرا با حافظهٔ خودش که سیستم‌عامل جدایش نگه می‌دارد. *مالک: II-03.*

<a id="provider-features"></a>
### provider features — قابلیت‌های فراهم‌کننده
‏`ProviderFeatures`: قابلیت‌های کلیددار یک فراهم‌کننده را با شناسه پیدا می‌کند؛ نبودنشان یعنی `400 NOT_SUPPORTED`. *مالک: II-07.*

<a id="provider-registry"></a>
### provider registry — رجیستری فراهم‌کننده‌ها
‏`ProviderRegistry`: همهٔ `IDbProvider`های رابطه‌ای بر اساس شناسه و گویش. *مالک: II-07.*

<a id="query-id"></a>
### query id — شناسهٔ پرس‌وجو
شناسهٔ سمت کارساز یک دستور (Snowflake، `query_id` در ClickHouse) برای طرح اجرا، تاریخچه و لغو. *مالک: II-09.*

<a id="query-parameter"></a>
### query parameter — پارامتر پرس‌وجو
جای‌نگهداری (`@id`، `:id`، `$1`، `?`) که مقدارش جدا از متن SQL فرستاده می‌شود. *مالک: II-08.*

<a id="queued-frames"></a>
### queued frames — فریم‌های در صف
فریم‌هایی که در صف هاب یک کلاینت منتظرند؛ بالای ۲۰۰٬۰۰۰ کلاینت قطع می‌شود. *مالک: II-06.*

<a id="r1-r4-rules"></a>
### R1–R4 rules — قاعده‌های R1 تا R4
قاعده‌های بسته‌های کاری در `docs/wp-notes/README.md`: مسیرها و بلوک‌های خود، پرونده‌های منجمد، درخواست تغییر مشترک، دروازه‌های تحویل. *مالک: II-07.*

<a id="read-only-guard"></a>
### read-only guard — نگهبان فقط‌خواندنی
‏`ReadOnlyGuard`: بررسی موتور که دسته‌های غیرپرس‌وجو را روی اتصال فقط‌خواندنی مگر با تأیید با `403 READ_ONLY` رد می‌کند. *مالک: II-08.*

<a id="read-only-connection"></a>
### read-only connection — اتصال فقط‌خواندنی
نمایه‌ای که فقط‌خواندنی علامت خورده؛ موتور غیرپرس‌وجوها را مگر با تأیید کاربر رد می‌کند. *مالک: II-08.*

<a id="reconnect"></a>
### reconnect — اتصال دوباره
باز کردن دوبارهٔ اتصال ازدست‌رفته؛ سوکت رابط کاربری با عقب‌نشینی و نشست شکسته در اجرای بعدی. *مالک: II-06.*

<a id="ref-cursor"></a>
### REF CURSOR — REF CURSOR
اشاره‌گر Oracle به یک مجموعهٔ نتیجهٔ باز؛ پارامترهای خروجی این نوع به‌صورت مجموعهٔ نتیجهٔ اضافی جاری می‌شوند. *مالک: II-09.*

<a id="reflection"></a>
### reflection — بازتاب
API زمان اجرا برای وارسی اسمبلی‌ها و نوع‌ها و ساختن نمونه‌ها. *مالک: II-07.*

<a id="registry-pattern"></a>
### registry pattern — الگوی رجیستری
یک شیء کلیدها را به پیاده‌سازی‌ها نگاشت می‌کند تا فراخواننده‌ها هرگز خودشان نسازندشان. *مالک: II-07.*

<a id="release-reason"></a>
### release reason — دلیل آزادسازی
چرا نشستی آزاد شد: `idle`، `closed`، `pressure` یا `limit`. *مالک: II-08.*

<a id="released-session"></a>
### released session — نشست آزادشده
نشستی که موتور عمداً اتصالش را بسته؛ در استفادهٔ بعدی با همان شناسه بی‌صدا باز می‌شود. *مالک: II-08.*

<a id="renderer"></a>
### renderer — رندرکننده
فرایند Chromium که صفحهٔ وب را رسم می‌کند؛ در Rowlit در جعبهٔ شنی است و درایوری ندارد. *مالک: II-03.*

<a id="result-store"></a>
### result store — انبار نتیجه
‏`ResultStore`: سطرهای سقف‌دار آخرین اجرای هر نشست (LRU تا ۲۵۶ MB) برای صفحه‌بندی، واکشی خانه و خروجی. *مالک: II-08.*

<a id="role-interface"></a>
### role interface — واسط نقش
واسط کوچکی که کلاس برای اعلام یک قابلیت پیاده می‌کند و با آزمون نوع کشف می‌شود. *مالک: II-07.*

<a id="role-snowflake"></a>
### role (Snowflake) — نقش (Snowflake)
واحد مجوزها در Snowflake؛ نقش جاری تعیین می‌کند نشست چه ببیند و چه کند. *مالک: II-09.*

<a id="route-group"></a>
### route group — گروه مسیر
پیشوند مسیر مشترک چند نقطهٔ پایانی (`/api/v1/sessions`). *مالک: II-05.*

<a id="savepoint-per-statement"></a>
### savepoint per statement — نقطهٔ ذخیره برای هر دستور
تصمیم D-PG3: هر دسته در حالت دستی درون `SAVEPOINT dbstudio_stmt` اجرا می‌شود تا یک خطا تراکنش را باطل نکند. *مالک: II-08.*

<a id="schema-mode"></a>
### schema mode — حالت شِما
‏`None`، `ReadOnly` یا `Session`: آیا شِمای پیش‌فرض نشست قابل تغییر است. *مالک: II-08.*

<a id="script"></a>
### script — اسکریپت
کل متن ویرایشگر که با برچسب `script` اجرا می‌شود. *مالک: II-08.*

<a id="scriptdom"></a>
### ScriptDom — ScriptDom
کتابخانهٔ تجزیه‌گر T-SQL مایکروسافت برای پیام‌های تشخیصی نحوی SQL Server. *مالک: II-09.*

<a id="search-path"></a>
### search_path — search_path
فهرست شِماهایی که PostgreSQL برای نام‌های بی‌پیشوند می‌گردد. *مالک: II-09.*

<a id="self-extract"></a>
### self-extract — خودبازگشایی
باز کردن کتابخانه‌های بومی بسته‌بندی‌شده هنگام شروع در برنامهٔ تک‌پرونده‌ای ‎.NET. *مالک: II-09.*

<a id="separation-of-concerns"></a>
### separation of concerns — جداسازی دغدغه‌ها
هر بخش یک نوع مسئله را حل کند. *مالک: II-03.*

<a id="sequence-number"></a>
### sequence number — شمارهٔ ترتیب
شمارنده‌ای روی دسته‌های جریان (`seq`) که به رابط کاربری اجازهٔ تشخیص شکاف می‌دهد. *مالک: II-06.*

<a id="serilog"></a>
### Serilog — Serilog
کتابخانهٔ لاگ ساخت‌یافتهٔ ‎.NET که موتور با آن `logs/engine-<date>.log` را می‌نویسد. *مالک: II-05.*

<a id="service-lifetime"></a>
### service lifetime — طول عمر سرویس
مدت زندگی یک نمونهٔ DI: تک‌نمونه، scoped (هر درخواست) یا transient. *مالک: II-05.*

<a id="session"></a>
### session — نشست
شیء موتور برای اتصال خصوصی یک زبانه به پایگاه داده. *مالک: II-08.*

<a id="session-handle"></a>
### session handle — دستگیرهٔ نشست
‏`SessionHandle`: یک `IDbSession` را با رزرو مشغولی، فعالیت، وضعیت آزادسازی و مالک می‌پیچد. *مالک: II-08.*

<a id="sidecar"></a>
### sidecar — فرایند همراه
فرایند کمکی‌ای که برنامهٔ اصلی راه می‌اندازد و صاحبش است؛ موتور Rowlit. *مالک: II-03.*

<a id="singleton"></a>
### singleton — تک‌نمونه
یک نمونه برای کل عمر فرایند؛ تقریباً همهٔ سرویس‌های موتور چنین‌اند. *مالک: II-05.*

<a id="sink"></a>
### sink — گیرنده
شیئی که اجرا به آن گزارش می‌دهد (`IExecutionSink`): مجموعه‌های نتیجه، سطرها، پیام‌ها، خطاها. *مالک: II-08.*

<a id="sni"></a>
### SNI — SNI
‏SQL Server Network Interface، کتابخانهٔ شبکهٔ بومی SqlClient در ویندوز. *مالک: II-09.*

<a id="snowflake-data"></a>
### Snowflake.Data — Snowflake.Data
درایور ‎.NET شرکت Snowflake (نسخهٔ 6.4.0). *مالک: II-09.*

<a id="solid"></a>
### SOLID — SOLID
پنج اصل طراحی شیءگرا: مسئولیت یگانه، باز/بسته، جانشینی لیسکوف، تفکیک واسط، وارونگی وابستگی. *مالک: II-03.*

<a id="source-registry"></a>
### source registry — رجیستری منبع‌ها
‏`SourceRegistry`: همهٔ شناسه‌های فراهم‌کننده، رابطه‌ای و غیررابطه‌ای، با ترتیب نمایش ثابت. *مالک: II-07.*

<a id="sqlstate"></a>
### SQLSTATE — SQLSTATE
کد خطای استاندارد پنج‌نویسه‌ای SQL (مثلاً `42P01`). *مالک: II-09.*

<a id="ssh-tunnel"></a>
### SSH tunnel — تونل SSH
لوله‌ای رمزنگاری‌شده از میان یک کارساز SSH که یک درگاه محلی را به پایگاه داده هدایت می‌کند. *مالک: II-08.*

<a id="statement"></a>
### statement — دستور
یک فرمان SQL. *مالک: II-08.*

<a id="statement-classifier"></a>
### statement classifier — طبقه‌بند دستورها
‏`StatementClassifier`: دسته‌بندی اکتشافی دستورها برای فقط‌خواندنی، تاریخچه و باطل کردن کاتالوگ. *مالک: II-08.*

<a id="strict"></a>
### STRICT — STRICT
گزینهٔ جدول SQLite که نوع ستون‌ها را تحمیل می‌کند. *مالک: II-09.*

<a id="structured-logging"></a>
### structured logging — لاگ ساخت‌یافته
لاگی که مقدارهای نام‌دار را به‌صورت داده نگه می‌دارد، نه فقط متن. *مالک: II-05.*

<a id="stub"></a>
### stub — stub
کد جانشینی که تا رسیدن تغییر واقعی جای آن را می‌گیرد، با علامت `TODO(WP<XX>-shared)`. *مالک: II-07.*

<a id="subscription"></a>
### subscription — اشتراک
گرداننده‌ای که برای یک نوع رویداد یا شناسه روی `EngineSocket` ثبت می‌شود. *مالک: II-06.*

<a id="temp-objects"></a>
### temp objects — اشیای موقت
جدول‌ها یا اشیای موقتی که نشست ساخته؛ چنین نشستی هرگز خودکار آزاد نمی‌شود. *مالک: II-08.*

<a id="timeprovider"></a>
### TimeProvider — TimeProvider
ساعت تزریق‌پذیر ‎.NET که آزمون‌ها با آن زمان را جلو می‌برند. *مالک: II-05.*

<a id="tracing-cql"></a>
### tracing (CQL) — tracing در CQL
ثبت کار هماهنگ‌کننده برای هر درخواست در `system_traces`؛ جایگزین EXPLAIN در Rowlit برای Cassandra. *مالک: II-09.*

<a id="transaction-mode"></a>
### transaction mode — حالت تراکنش
‏`Auto` (autocommit درایور) یا `Manual` (تراکنش موتور تا Commit یا Rollback). *مالک: II-08.*

<a id="trimming"></a>
### trimming — trimming
حذف کد استفاده‌نشده هنگام انتشار؛ در Rowlit خاموش است چون ماژول‌ها با بازتاب ساخته می‌شوند. *مالک: II-07.*

<a id="truncation"></a>
### truncation — برش
ایستادن یک مجموعهٔ نتیجه در `MaxRows` و علامت زدن آن با `truncated`. *مالک: II-08.*

<a id="trust-boundary"></a>
### trust boundary — مرز اعتماد
خطی که فراخوانی یا داده از سمت کم‌اعتمادتر به پراعتمادتر می‌گذرد و باید بررسی شود. *مالک: II-03.*

<a id="trust-on-first-use"></a>
### trust on first use — اعتماد در نخستین استفاده
پذیرفتن کلید کارساز در نخستین بار و رد هر کلید متفاوت پس از آن. *مالک: II-08.*

<a id="tunnel-resolver"></a>
### tunnel resolver — حل‌کنندهٔ تونل
‏`ITunnelResolver`: نمایه را به نمایه‌ای رو به سر محلی تونل تبدیل می‌کند؛ پیاده‌سازی: `SshTunnelService`. *مالک: II-08.*

<a id="txopen"></a>
### TxOpen — TxOpen
آیا نشست تراکنش باز دارد (متعلق به موتور یا تایپ‌شده به دست کاربر)؛ در `exec.done` و `session.changed` فرستاده می‌شود. *مالک: II-08.*

<a id="udt"></a>
### UDT — UDT
نوع تعریف‌شده به دست کاربر؛ در Cassandra یک نوع ستون مرکب نام‌دار. *مالک: II-09.*

<a id="unbound-parameter"></a>
### unbound parameter — پارامتر بی‌مقدار
جای‌نگهدار بدون مقدار؛ PostgreSQL و SQLite اجرا را پیش از هر کاری رد می‌کنند. *مالک: II-08.*

<a id="warehouse"></a>
### warehouse — انبار (Snowflake)
خوشهٔ پردازشی Snowflake که تا روشن است هزینه دارد؛ کاتالوگ Rowlit هرگز آن را از سر نمی‌گیرد. *مالک: II-09.*

<a id="websocket"></a>
### WebSocket — WebSocket
اتصال ماندگار دوطرفه‌ای که با یک درخواست HTTP شروع می‌شود؛ Rowlit برای هر پنجره یکی دارد. *مالک: II-06.*

<a id="websocket-hub"></a>
### WebSocket hub — هاب WebSocket
‏`WsHub`: سوکت‌ها را می‌پذیرد، احراز هویت می‌کند و رویدادها را در صف همهٔ کلاینت‌ها پخش می‌کند. *مالک: II-06.*

<a id="wire-value"></a>
### wire value — مقدار انتقال
شکل JSON یک خانه: عددهای بزرگ و decimalها به‌صورت رشته، `{"$bin"}`، `{"$trunc"}`، `{"$cursor"}`. *مالک: II-08.*

<a id="without-rowid"></a>
### WITHOUT ROWID — WITHOUT ROWID
گزینهٔ جدول SQLite که جدول را بر اساس کلید اصلی خوشه‌ای و بدون rowid پنهان نگه می‌دارد. *مالک: II-09.*

<a id="work-package"></a>
### work package (WP) — بستهٔ کاری
واحد کاری سپرده به یک تیم یا عامل با پرونده‌ها و یادداشت‌های خودش (WP-MY، LINKS-WPA…). *مالک: II-07.*

</div>
