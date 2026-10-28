<!-- Glossary fragment of writer package G (II-11, II-16, II-17, II-18). Package H merges it into en/glossary.md. -->
<!-- Row format: anchor, term, beginner meaning (first sentence), deeper note (second), owner chapter. -->

<a id="advanced-mode"></a>
### Advanced mode (query builder)
The query builder's SQL mode, where the compiled SQL is edited by hand. "Back to builder" parses it with `BuilderParser`; SQL outside the builder subset (CTEs, subqueries, windows…) keeps the tab in SQL mode with the reason. *Owner: II-16.*

<a id="appender"></a>
### appender
A bulk writer that adds rows to one engine table without SQL INSERTs (DuckDB's Appender API). Rowlit's `IFederationAppender` converts driver values per column kind and stores a value it cannot convert as NULL, counting it for the `conversion` warning. *Owner: II-16.*

<a id="ast"></a>
### AST (abstract syntax tree)
The tree a parser builds from SQL text: statements, clauses, expressions and table references as nested nodes. The link analyzer reads DuckDB's AST as JSON from `json_serialize_sql`, so it understands the statement exactly as the engine will run it. *Owner: II-16.* See also: parser (I-08).

<a id="backward-inference"></a>
### backward inference
Guessing the table from the columns already typed: in `SELECT name, price FROM |` tables that have all those columns rank first. The completer looks them up in a column-name index of the catalog and adds +25 relevance. *Owner: II-11.*

<a id="binary-safe-text"></a>
### binary-safe text
Showing bytes that are not valid UTF-8 as text with `\xHH` escapes while keeping the real bytes. Rowlit's Redis package sends the display text plus a side map from that text to the base64 bytes, so an edit writes the exact original bytes back (`BinaryText`). *Owner: II-17.*

<a id="binder"></a>
### binder
The part of a language processor that maps names in a parsed statement to the objects they mean. In Rowlit's IntelliSense `Binder` resolves table sources, aliases, CTEs, temp tables and qualifiers against the catalog index, lazily and without failing; the DBMS binder of Part I-08 does the same job strictly. *Owner: II-11.*

<a id="bulk-api"></a>
### bulk API (`_bulk`)
The Elasticsearch endpoint that indexes, updates or deletes many documents in one request, written as NDJSON action and document lines. Rowlit's import job sends `_bulk` batches of at most `batchSize` documents and 5 MB, with `refresh=false` during the load and one refresh at the end. *Owner: II-18.*

<a id="canonical-sql"></a>
### canonical SQL (builder)
The one fixed text layout the query builder's model compiles to: one clause per line, upper-case keywords, quoted identifiers only where needed, filter values as `$fp1…` binds. Two compilers (TypeScript and C#) must produce it byte for byte. *Owner: II-16.*

<a id="catalog-index"></a>
### catalog index
The in-memory lookup structure the IntelliSense builds from the catalog snapshot (`CatalogIndex`). It holds per-schema name maps keyed by the dialect's case folding, the foreign-key graph in both directions, built-in system schemas, Oracle PUBLIC synonyms and the catalogs of other databases of the server, and asks the host for schemas it does not have yet. *Owner: II-11.*

<a id="clause-marker"></a>
### clause marker
A note the partial parser leaves in a scope: "from this offset on, the cursor is in clause X" (`select`, `from`, `join`, `on`, `where`, `set`, `ddl`...). The cursor context takes the last marker before the cursor to know what to suggest; marker data carries details such as the table an `ON` belongs to. *Owner: II-11.*

<a id="codec"></a>
### codec
A rule that turns the bytes of a message into readable text and back (string, JSON, hex, integers, Avro, Protobuf, JSON Schema). Rowlit's `MessageCodec` decodes Kafka keys, values and headers for the browser and encodes them for produce; a decode failure falls back to hex with an error text instead of failing. *Owner: II-18.*

<a id="completer"></a>
### completer
The function that produces the suggestion list for a cursor position (`complete` in `intel/complete/completer.ts`). It chooses item sources by clause and qualifier, then appends dialect, package and editor sources (snippets, postfix templates) and sorts by score. *Owner: II-11.*

<a id="completion-item"></a>
### completion item
One row of the suggestion list: a label, a kind (table, column, keyword, snippet...), the text to insert, a sort key and optional documentation. Rowlit items also carry a usage key for ranking, an object reference for definition and a `loading` flag for "Loading <schema>…" rows. *Owner: II-11.*

<a id="confluent-wire-format"></a>
### Confluent wire format
The byte layout producers use when a Kafka message is serialised with a Schema Registry schema: a magic byte `0`, a 4-byte big-endian schema id, then the payload (Protobuf adds message indexes). Rowlit's `auto` decoder recognises it and fetches the schema by id. *Owner: II-18.*

<a id="cursor-context"></a>
### cursor context
A description of where the cursor sits in a statement: clause, qualifier chain, typed prefix, enclosing function call, whether a table source or an operand precedes it. `detectContext` computes it from the statement model; the completer, signature help and type positions all read it. *Owner: II-11.*

<a id="cursor-es-sql"></a>
### cursor (ES SQL)
A server-side token that Elasticsearch or OpenSearch SQL returns when a result has more rows than one page. Sending it back fetches the next page; closing it (`_sql/close`) frees the server context early, which the Rowlit SQL tab does when a result is replaced or fully read. *Owner: II-18.*

<a id="database-link"></a>
### database link (Oracle)
An Oracle object (`CREATE DATABASE LINK`) that lets SQL on one Oracle server read tables of another server as `table@link`. Rowlit only writes the script; the engine never runs it. *Owner: II-16.*

<a id="dedicated-connection"></a>
### dedicated connection (Redis)
A separate Redis connection opened for one job instead of the shared multiplexer. `RawRedisConnection` speaks RESP2 directly and is used for MONITOR, MULTI/EXEC/WATCH batches and blocking commands, which would otherwise hold the shared pipe for everyone. *Owner: II-17.*

<a id="dev-tools-console"></a>
### Dev Tools console
A text editor in which you type raw REST requests (`GET /_cat/indices`) followed by JSON bodies and run them against the cluster, as in Kibana. Rowlit sanitises the path, limits the methods, cuts answers at 5 MB and, on read-only connections, allows only GET/HEAD and the POST APIs that read. *Owner: II-18.*

<a id="diagnostic"></a>
### diagnostic
A problem found in the source text, with a range, a severity (error, warning, info), a code and a message. The editor shows diagnostics as markers; in Rowlit they come from the IntelliSense (soft), the engine (server) or the last run. *Owner: II-11.*

<a id="dialect-spec"></a>
### dialect spec
The data object that teaches the IntelliSense one SQL dialect (`DialectSpec`): keywords, statement starts, data types, function catalog, quoting, case folding, batch separator, keyword lists per position and optional hooks (lexer traits, splitter, classifier, completion source, formatter rules). The lexer, splitter, parser, completer and formatter all read it. *Owner: II-11.*

<a id="dry-run"></a>
### dry run
Running an operation in preview mode: it computes and shows what would change without changing anything. Rowlit's Kafka offset reset always allows a dry run, even on a read-only connection, and its dialog shows the from/to table before you apply. *Owner: II-18.*

<a id="duckdb"></a>
### DuckDB
An embedded, in-process analytical SQL database with a columnar, vectorised engine (MIT licence). Rowlit runs one locked-down in-memory DuckDB per linked console session as its federation engine (DuckDB.NET, DuckDB v1.5.6 at WP0). *Owner: II-16.* See also: DuckDB SQL (I-17).

<a id="engine-name"></a>
### engine name (wide member)
The single table name a nested table of a wide member gets inside the federation engine: the parts below the alias joined with dots, defaults left out (`crm.sales.orders` → `crm."sales.orders"`). `LinkNames.Rewrite` turns user SQL into engine names before analysis. *Owner: II-16.*

<a id="error-tolerant-parsing"></a>
### error-tolerant parsing
Parsing that keeps going on invalid input and returns the best structure it can instead of an error. An editor needs it because a statement is always incomplete while you type; Rowlit's partial parser guarantees progress on every token and catches its own failures. *Owner: II-11.*

<a id="explain-mongo"></a>
### explain (Mongo)
MongoDB's description of how it will run (or ran) a find or an aggregate: which index, how many keys and documents examined. Rowlit normalises the classic, SBE and sharded shapes into the same `PlanNode` tree as relational plans and adds warnings for collection scans and in-memory sorts. *Owner: II-17.*

<a id="explain-sampling"></a>
### EXPLAIN sampling (links)
A plain `EXPLAIN` on a link reads at most 1,000 rows per source, because a plan needs no data. The inner query is still analysed, so the plan shows the real push-down; `EXPLAIN ANALYZE` reads normally. *Owner: II-16.*

<a id="fdw"></a>
### FDW (foreign data wrapper)
A PostgreSQL extension type (postgres_fdw, mysql_fdw, oracle_fdw, tds_fdw) that exposes tables of another server as local foreign tables. Rowlit's native scripts create the server, user mapping and `IMPORT FOREIGN SCHEMA`; a whole database becomes one import per remote schema. *Owner: II-16.*

<a id="federated-engine"></a>
### FEDERATED engine (MySQL / MariaDB)
A MySQL storage engine whose table stores no data and forwards every read to a table on another MySQL server (MariaDB: FEDERATEDX). It maps one table at a time and is disabled by default in MySQL. *Owner: II-16.*

<a id="federated-query"></a>
### federated query
One query that reads tables of several independent databases. In Rowlit it is DuckDB SQL over a link's mounted tables; the sources are fetched, then the statement runs unchanged on the local engine. *Owner: II-16.*

<a id="federated-session"></a>
### federated session
The console session of a linked database (`FederatedSession`). It is query-only, has no transactions, and before each batch fetches the mounted tables the batch reads into its own federation context. *Owner: II-16.*

<a id="federation"></a>
### federation
Querying several separate databases as if they were one, without merging them permanently. Unlike sharding (one dataset split by key over servers), federation joins different datasets that belong to different systems. *Owner: II-16.* See also: sharding (I-12).

<a id="federation-context"></a>
### federation context
The state behind one linked console session or one-off link query: an engine instance, the limits and the cache of fetched source tables. Prepares are serialized per context; Refresh sources and materialize reach it by session id. *Owner: II-16.*

<a id="federation-engine"></a>
### federation engine
The local database a federated query finally runs on (`IFederationEngine`): its schemas are member aliases, its tables the fetched sources. DuckDB by default, SQLite when DuckDB cannot load. *Owner: II-16.*

<a id="fetch-relay"></a>
### fetch relay
The engine object that ties one Kafka browse job to its `kafka.fetch` stream: a one-time token, a sink the job waits for, and a cancellation that fires when the stream closes. It lets messages flow on a stream while progress and the result flow on the job. *Owner: II-18.*

<a id="fetch-request"></a>
### fetch request
What one source is asked for (`FetchRequest`): the table, the projection (never empty), conjunctive predicates, an optional limit, the row cap and a timeout. A fetcher's `Accept` may remove predicates it cannot render, and must then remove the limit too. *Owner: II-16.*

<a id="fk-join-suggestion"></a>
### FK join suggestion
A completion after `JOIN` that offers the tables linked by a foreign key to a table already in the query, plus a ready snippet such as `orders o ON o.customer_id = c.id`. Rowlit builds it from the catalog's foreign-key graph, joins composite keys with `AND` and generates a unique alias. *Owner: II-11.*

<a id="gateway-seam"></a>
### gateway seam
One interface at the edge of a package through which all calls to an external system pass, so a real and a fake backend can be swapped. `IMongoGateway` is implemented by `DriverMongoGateway` (MongoDB.Driver) and by the in-memory `MongoFake` used in unit tests. *Owner: II-17.*

<a id="generic-stand-in"></a>
### generic stand-in
The temporary dialect spec used until a lazily loaded dialect has arrived: the SQLite tables under the real dialect id. It lets every code path keep working (and keep seeing `'mysql'`, `'cql'`...) while the chunk loads, and is also the fallback if the chunk fails. *Owner: II-11.*

<a id="go-to-definition"></a>
### go to definition
Jumping from a name to where it is defined (F12 or Ctrl+click). Local names (aliases, CTEs, variables, temp tables) jump inside the editor; catalog objects open their Data tab or definition; Alt+F12 always opens the DDL. *Owner: II-11.*

<a id="golden-test"></a>
### golden test
A test that compares output with a stored expected file. The builder's goldens (`Goldens/Builder/*.json`: catalog, model, SQL, params, warnings) are run by both the C# and the TypeScript compiler, which keeps them identical. *Owner: II-16.* See also: golden file (II-23).

<a id="hover"></a>
### hover
The card that appears when the mouse rests on a name. Rowlit shows an object's type, comment, columns with PK/FK badges (first 25), a routine's signature or a column's type and keys, as untrusted Markdown. *Owner: II-11.*

<a id="idle-reaper"></a>
### idle reaper
A timer that closes resources nobody used for a while. `SourceClientManager` checks every 30 s and closes source clients idle longer than `connections.sourceIdleSeconds` (default 600) unless a lease is held; the resource manager shortens the limit under memory pressure. *Owner: II-17.*

<a id="incremental-lexing"></a>
### incremental lexing
Re-tokenising only the part of a text around an edit and reusing the rest of the old tokens. Rowlit's `relex` restarts at the start of the edited line and stops as soon as a new token equals a shifted old one; an edit that opens a string may re-lex to the end. *Owner: II-11.*

<a id="intellisense"></a>
### IntelliSense
The family of editor helps that understand the code: completion, signature help, hover, go to definition and instant diagnostics. The name comes from Visual Studio; in Rowlit it is the pure TypeScript library `ui/src/intel` working over a cached catalog snapshot, with no database round trip while you type. *Owner: II-11.*

<a id="interrupt"></a>
### interrupt (engine)
Stopping a running query from another thread. `IFederationEngine.Interrupt` cancels every running DuckDB command; the linked session's cancel also cancels the running fetches' driver commands (about 120 ms in the QA round). *Owner: II-16.*

<a id="join-inference"></a>
### join inference
The query builder's join suggestions (`infer.ts`): same-source foreign keys (score 100), the link's virtual relations (95), naming conventions (85 or 55) and shared key-like column names (70 or 40). A suggestion of 80 or more joins a new table automatically. *Owner: II-16.*

<a id="key-delimiter"></a>
### key delimiter (Redis)
The character that splits Redis key names into levels, by convention `:` (`user:1001:profile`). Rowlit uses it per connection to build the folder tree of the key browser and the namespaces of the memory analysis. *Owner: II-17.*

<a id="language-service"></a>
### language service
A component that understands a language well enough to answer editor questions about a document (what can go here, what is this name, where is it defined, what is wrong). Rowlit's is the `Intel` object, one per editor, with no DOM or Monaco dependency. *Owner: II-11.*

<a id="lazy-dialect"></a>
### lazy dialect
A dialect whose spec is a separate code chunk loaded on first use instead of being part of the initial bundle. In Rowlit MySQL, ClickHouse, Snowflake, CQL and DuckDB are lazy (`ensureDialect`), to respect the bundle budget; until loaded they answer with the generic stand-in. *Owner: II-11.*

<a id="lease"></a>
### lease
A counted "I am still using this" claim on a shared object. Streams, jobs and Workbench batches take a lease on a connection's source client (`AcquireLease`), and the idle reaper never closes a client while a lease is held. *Owner: II-17.*

<a id="lexer"></a>
### lexer / tokenizer
The program that cuts source text into tokens (words, strings, numbers, operators, comments). Rowlit has one lexer engine driven by dialect tables, with a whole-document mode, a per-line mode for syntax highlighting and an incremental mode for edits. *Owner: II-11.*

<a id="lexer-hook"></a>
### lexer hook / lexer traits
A dialect's extension point into the shared lexer. Newer dialects declare `LexTraits` as data (backtick identifiers, `#` comments, backslash escapes, parameter prefixes...) and `traitLexer` turns them into a hook the lexer calls before its own rules, so no dialect edits `lexer.ts`. *Owner: II-11.*

<a id="librdkafka"></a>
### librdkafka
The C client library for Apache Kafka that Confluent.Kafka wraps for .NET. Because it is native code, Rowlit must ship it inside the published engine (self-extracted on Windows, a signed dylib next to the apphost on macOS) and checks in CI that it loads. *Owner: II-18.*

<a id="link-catalog"></a>
### link catalog
The resolved structure of a link: per member alias its mounted tables with columns, keys and same-source foreign keys, plus the virtual relations. Cached for 2 minutes per link and keyed by the link's fingerprint; wide members hold only their default container. *Owner: II-16.*

<a id="link-definition"></a>
### link definition
What a link mounts (`LinkDefinition`): members, virtual relations, options and a version, stored in four props of the link's connection profile (`members`, `relations`, `options`, `linkVersion`). *Owner: II-16.*

<a id="link-fingerprint"></a>
### link fingerprint
The cache key of a link catalog: the serialized props of the link profile. Any edit of the link changes it, so the cached catalog is dropped at once, even within its 2-minute TTL. *Owner: II-16.*

<a id="link-member"></a>
### link member
One source of a link: a saved connection (relational, MongoDB, Elasticsearch) or a set of local files, mounted under an alias with a scope. Its credentials stay in the engine; a member that is itself a link is refused. *Owner: II-16.*

<a id="link-scope"></a>
### link scope
How much of its connection a member mounts: `tables` (an explicit list), `schema` (every table of one schema), `database` (every schema) or `connection` (every database). What a level means depends on the provider (`MemberScopes`). *Owner: II-16.*

<a id="linked-database"></a>
### linked database (link)
A saved connection with provider id `linked` that points to no server but mounts tables of other connections under aliases, so one DuckDB query can join them. Always read-only. *Owner: II-16.*

<a id="linked-server"></a>
### linked server (SQL Server)
A SQL Server object (`sp_addlinkedserver`) that lets T-SQL reach another server as `server.database.schema.table` or through `OPENQUERY`. Rowlit writes the script with the password as a placeholder. *Owner: II-16.*

<a id="linked-view"></a>
### linked view
A query saved on a link: the SQL is an ordinary saved query of the link under schema `views`, the builder model (when any) is kept in `linked-views.json`. *Owner: II-16.*

<a id="lockdown"></a>
### lockdown (DuckDB)
The settings applied to every federation DuckDB before user SQL runs: no extension auto-install or auto-load, no external (file or network) access, then `lock_configuration = true` so they cannot be changed. *Owner: II-16.* See also: read-only enforcement (II-19).

<a id="match-score"></a>
### match score
How well a typed prefix matches a label: exact 100, case-insensitive exact 96, prefix 90, word starts 70, substring 50, subsequence 20-30, none −1. It is added to the item's group weight (× 1 000), usage boost and relevance to sort the list. *Owner: II-11.*

<a id="materialize"></a>
### materialize (links)
Writing the result of a link query into a real table of a writable connection, as a job, in mode create, replace (swap after a complete load) or append. Reuses the import's target writer and bulk paths. *Owner: II-16.*

<a id="member-alias"></a>
### member alias
The short name a member is mounted under (`crm`): the DuckDB schema of its tables in SQL. Lower-case identifier of at most 63 characters, unique in the link, not a reserved word, not `main`, `temp`, `system`, `memory`, `information_schema`, `pg_catalog` or `views`. *Owner: II-16.*

<a id="memory-analysis"></a>
### memory analysis (Redis)
A job that samples keys with SCAN and `MEMORY USAGE` and reports where memory goes. Rowlit aggregates namespaces at two delimiter levels, the top 100 keys, per-type totals and TTL buckets; it is a sample (default 100 000 keys), not an exact census. *Owner: II-17.*

<a id="monitor"></a>
### MONITOR
A Redis command that streams every command the server processes. It is costly for the server, so Rowlit runs it only as a stream on a dedicated connection that stops itself after 10 minutes by default (60 at most). *Owner: II-17.*

<a id="mounted-table"></a>
### mounted table
A source table, view, collection, index or file as it appears in a link, addressed `alias.table`. It can be renamed inside the link (`As`) and carry fetcher options. *Owner: II-16.*

<a id="mru"></a>
### MRU / usage store
"Most recently used": ranking that favours what you picked before. Rowlit's `UsageStore` adds an exponentially growing weight per accepted item (half-life 14 days), gives up to +15 points, keeps at most 2 000 keys and is saved per connection in the settings. *Owner: II-11.*

<a id="multiplexer"></a>
### multiplexer (Redis)
StackExchange.Redis' `ConnectionMultiplexer`: one object that sends every caller's commands over one pipelined socket per server and reconnects by itself. Rowlit keeps exactly one per Redis connection, inside the `RedisClient`. *Owner: II-17.*

<a id="native-link-script"></a>
### native link script
A script Rowlit generates so that a target server reaches a member's server by its own means (linked server, FDW, database link, FEDERATED, ClickHouse engines). Secrets are placeholders and the engine never runs it. *Owner: II-16.*

<a id="offset-reset"></a>
### offset reset
Changing the committed offsets of a Kafka consumer group so that its consumers start reading from another position (earliest, latest, an offset, a time, or shifted by N). Rowlit clamps every target to the partition's watermarks and refuses to apply it while the group has active members (`409 GROUP_ACTIVE`). *Owner: II-18.*

<a id="opensearch"></a>
### OpenSearch
An open-source fork of Elasticsearch 7.10, with the same core REST API and its own plugins (for example SQL under `_plugins/_sql`). Rowlit supports both with one transport and detects the flavor from `GET /`. *Owner: II-18.*

<a id="partial-count"></a>
### partial count
A count of what has been seen so far rather than the server's total. Folder counts in the Redis key tree count only scanned keys; the header shows "scanned X of ~Y" until the scan is complete. *Owner: II-17.*

<a id="partial-parser"></a>
### partial parser
A parser that understands only the structure a tool needs (scopes, sources, aliases, clause positions) and skips everything else, instead of implementing a full grammar. Rowlit's hand-written recursive-descent parser builds a statement model from incomplete SQL in nine dialects. *Owner: II-11.*

<a id="pausable-stream"></a>
### pausable stream
An engine stream that can pause at its source instead of having its items dropped while paused (`IPausableEngineStream`). The Kafka tail is one: it pauses the consumer, the broker keeps the messages, and the backlog arrives on resume. *Owner: II-18.*

<a id="pending-definition"></a>
### pending definition
The answer "nothing found yet, but the schema or database that would contain it is loading". `Intel.pendingDefinition` requests the missing piece from the host; the editor shows "Loading Sales…" and retries on every catalog change for up to 15 seconds. *Owner: II-11.*

<a id="plan-warning"></a>
### plan warning (links)
A coded note in a push-down plan: `rowCap`, `fallback`, `joinKinds`, `joinCollation`, `limitWithoutOrder`, `cartesian`, `decimalWidened`, `conversion`, `fullScan`, `cached`, `fallbackEngine`. The console prints them as messages. *Owner: II-16.*

<a id="producer"></a>
### producer
A program that writes messages to Kafka topics. Rowlit's Produce view acts as one: it sends up to 1 000 messages per request with `acks=all` and reports the partition and offset of each, plus Avro fields the schema did not write. *Owner: II-18.*

<a id="push-down"></a>
### push-down
Sending part of a query (columns, filters, limits) to the system that holds the data, so less data travels. In Rowlit's federation it is an optimisation only: a fetch may return more rows than needed, never fewer, and DuckDB re-applies every predicate. *Owner: II-16.* See also: predicate push-down (I-08), projection, predicate.

<a id="push-down-plan"></a>
### push-down plan
What each mounted table of a query would be asked for (`PushdownPlan`): source query text, projection, predicates, limit, row cap, cache state, plus warnings. `POST /links/{cid}/plan` computes it without fetching. *Owner: II-16.*

<a id="pushdown-predicate"></a>
### pushdown predicate
A single-table condition `column OP literal(s)` that may be sent to a source: `=`, `<>`, `<`, `>`, `<=`, `>=`, `IN`, `BETWEEN`, `LIKE`, `IS NOT NULL`. Never IS NULL, OR, functions, parameters or a column on both sides; literals are typed and rendered per dialect. *Owner: II-16.*

<a id="query-analyzer"></a>
### query analyzer (links)
The component that reads a link statement's DuckDB AST and decides, per mounted table, the columns to fetch, the predicates a source may evaluate and whether a limit can be pushed (`QueryAnalyzer`). It is conservative and falls back to whole tables when unsure. *Owner: II-16.*

<a id="query-builder"></a>
### query builder (links)
The visual editor of link queries: tables on a canvas, joins drawn between columns, output, filters, grouping, sort and limit, with the compiled SQL beside it. Its state is a `BuilderModel`. *Owner: II-16.*

<a id="query-dsl"></a>
### query DSL
Elasticsearch's JSON language for searches: a body with `query`, `aggs`, `sort`, `highlight` and other keys. Rowlit passes the user's body through, adds `seq_no_primary_term` and exact totals, caps `size`, and offers context-aware completion of keys and field names. *Owner: II-18.*

<a id="ranker"></a>
### ranker
The scoring that orders completion items: group × 1 000 + match score + usage boost + relevance, minus 20 for deprecated functions. Scores are written into Monaco's `sortText` as seven digits so Monaco keeps the order. *Owner: II-11.*

<a id="redis-command-table"></a>
### Redis command table
The file `redis-commands.json` with every Redis command's syntax, complexity, key positions and flags (`readonly`, `blocking`, `transaction`, `blocked` …). The engine uses it for read-only enforcement and dedicated routing, the UI for completion and hover; a test keeps the two copies identical. *Owner: II-17.*

<a id="refresh-sources"></a>
### Refresh sources
The command that drops the fetched copies of a link's sources (one session or all) and forgets the link catalog, so the next query reads current data. *Owner: II-16.*

<a id="reindex"></a>
### reindex
Copying documents from one Elasticsearch index (or several) into another, optionally filtered by a query or changed by a script. Rowlit starts it as a server task (`wait_for_completion=false`), polls its progress every 500 ms in an engine job, and cancels the server task when the job is cancelled. *Owner: II-18.*

<a id="rejson"></a>
### ReJSON (RedisJSON)
The Redis module that adds a JSON value type with commands such as `JSON.GET` and `JSON.SET`. Rowlit detects it with `MODULE LIST` and edits JSON keys through plain `Execute` calls. *Owner: II-17.*

<a id="row-cap"></a>
### row cap (max rows per source)
The most rows read from one mounted table per query, 2,000,000 by default (`links.maxRowsPerSource`). The source is asked for cap + 1 rows to detect truncation, which the plan reports as `rowCap`. *Owner: II-16.*

<a id="scan"></a>
### SCAN
The Redis command that walks the keyspace with a cursor, doing a bounded amount of work per call, instead of `KEYS *`, which blocks the server. Rowlit's key browser also stops each request after 400 ms or 64 calls and lets the user press "Scan more". *Owner: II-17.*

<a id="schema-analysis"></a>
### schema analysis (Mongo)
Inferring the shape of a schemaless collection from a sample of its documents: field paths, type distributions, probabilities and min/max/distinct statistics. In Rowlit it runs as a job over 1 000 documents by default. *Owner: II-17.*

<a id="scoped-source-fetcher"></a>
### scoped source fetcher
A fetcher that can list what a wide member spans (`IScopedSourceFetcher`): the connection's default database and schema, its databases and the schemas of one database, names only. Relational and MongoDB fetchers implement it. *Owner: II-16.*

<a id="scroll-es"></a>
### scroll (Elasticsearch)
A way to read a whole result set page by page through a server-side context kept alive for a given time. Rowlit's export job scrolls 1 000 documents at a time with a 2-minute keep-alive and clears the scroll at the end. *Owner: II-18.*

<a id="search-after"></a>
### search_after
Elasticsearch paging by the sort values of the last hit instead of a growing `from` offset, so deep pages stay cheap (the idea of keyset pagination). When the Rowlit paging toolbar sends `search_after`, the engine removes `from` from the body. *Owner: II-18.* See also: keyset pagination.

<a id="server-diagnostics"></a>
### server diagnostics
Syntax errors found by the database's own parser through the engine (`POST /sql/diagnostics`): ScriptDom for SQL Server, a prepare for PostgreSQL and SQLite. They are debounced 400 ms, superseded by newer requests and shown as markers next to the soft ones; other dialects answer `NOT_SUPPORTED`. *Owner: II-11.*

<a id="shell-json"></a>
### shell JSON
The relaxed JSON that people type in the MongoDB shell: comments, single quotes, unquoted keys, regex literals and helpers such as `ObjectId("…")` or `ISODate("…")`. Rowlit parses it straight to BSON with a hand-written parser whose errors carry line and column. *Owner: II-17.*

<a id="signature-help"></a>
### signature help
The box that shows a function's or procedure's parameters while you type its arguments, with the current parameter highlighted. Rowlit counts depth-0 commas, follows Oracle named arguments (`p => v`) and T-SQL `EXEC p a, b`, and prefers user routines over built-ins. *Owner: II-11.*

<a id="slowlog"></a>
### slowlog (Redis)
Redis' in-memory list of commands that ran longer than a threshold (`SLOWLOG GET`, `SLOWLOG RESET`). Rowlit reads it on request in the Slowlog tab and also as a log source in the Logs view. *Owner: II-17.*

<a id="soft-diagnostics"></a>
### soft diagnostics
Instant warnings computed in the UI by the IntelliSense, without the server: unterminated strings, unbalanced parentheses, unknown tables or columns, duplicate aliases, `DELETE` without `WHERE` and more. They are only raised when the relevant schema is loaded, so a lazy catalog never causes false alarms. *Owner: II-11.*

<a id="source-cache"></a>
### source cache (links)
Fetched source tables kept in a session's engine for later statements. A copy is reused when it has every needed column and no predicate the new request lacks; otherwise the new fetch is widened to the old copy's columns. On by default (`links.cacheSources`). *Owner: II-16.*

<a id="source-client"></a>
### source client
The one long-lived driver handle the engine keeps for a non-relational connection (Redis multiplexer, `MongoClient`, Kafka admin client …). It implements `IDataSourceClient` and is shared by every tab of that connection. *Owner: II-17.*

<a id="source-client-manager"></a>
### source client manager
The engine service (`SourceClientManager`) that opens source clients lazily and once per connection, maps open failures to `503 SOURCE_UNAVAILABLE`, publishes `source.client` events and closes idle clients unless a lease is held. *Owner: II-17.*

<a id="source-fetcher"></a>
### source fetcher
The per-source-kind component that reads a member's catalog and fetches a mounted table into the federation engine (`ISourceFetcher`: `LoadCatalogAsync`, `Accept`, `Describe`, `FetchAsync`). Keyed by provider id or `files`; stateless and thread-safe. *Owner: II-16.*

<a id="source-kind"></a>
### source kind
The family a provider belongs to: `Relational`, `KeyValue`, `Document`, `Stream` or `Search` (`enum SourceKind`). The UI uses it to pick the workspace and the engine to refuse source-client calls on relational connections. *Owner: II-17.*

<a id="source-registry"></a>
### source registry
The list of every provider id the engine knows (`SourceRegistry`): relational providers wrapped as kind `Relational` plus the registered non-relational ones, in a fixed display order for `GET /providers`. *Owner: II-17.*

<a id="spill"></a>
### spill
Writing intermediate query data to disk when it does not fit into the memory limit. The federation DuckDB spills to `<DataDir>/tmp/links/<sessionId>`, deleted when the session closes. *Owner: II-16.* See also: spill (I-08).

<a id="splitter"></a>
### splitter (statement splitter)
The step that finds where statements and batches begin and end. Rowlit's handles `;`, T-SQL `GO [n]`, Oracle `/` and PL/SQL blocks, MySQL `DELIMITER`, dollar-quoted bodies and blank lines, and drives Ctrl+Enter, the parser and "run script". *Owner: II-11.*

<a id="sqlite-fallback-engine"></a>
### SQLite fallback engine
The federation engine used when libduckdb cannot load: an in-memory SQLite with one attached database per alias. It guarantees only the builder's SQL subset, has no parser (whole tables are read) and does not spill. *Owner: II-16.*

<a id="stage-preview"></a>
### stage preview
The result of running an aggregation pipeline only up to one stage, shown under that stage's card. Rowlit previews 10 documents, debounced 500 ms, and never runs a trailing `$out` or `$merge` in a preview. *Owner: II-17.*

<a id="statement-model"></a>
### statement model
The structure the partial parser builds for one statement: a tree of scopes with their table sources, CTEs, projections, joins, clause markers, identifier chains, and the tables and variables the statement creates. Cached per statement under its start offset and text. *Owner: II-11.*

<a id="statement-scope"></a>
### scope (statement model)
One query level inside a statement: the main SELECT, a subquery, a CTE body, an EXISTS, a PL/SQL block. A scope owns its sources and markers; an `outer` link lets correlated subqueries and LATERAL/APPLY see the enclosing sources. *Owner: II-11.*

<a id="suggest-guard"></a>
### suggest guard
A small patch on Monaco's suggest model (`suggest-guard.ts`) that swallows one re-entrancy `TypeError` in Monaco 0.57 when the completion model disappears mid-call. Any other error is rethrown. *Owner: II-11.*

<a id="symbol"></a>
### symbol
The named thing under the cursor once resolved: an alias, a table, a column, a CTE, a variable, a function, a package member, a schema, a database. `symbolAt` computes it once and both hover and go to definition use it. *Owner: II-11.*

<a id="tail"></a>
### tail (live tail)
Following a log or topic and showing new entries as they arrive, like `tail -f`. In Rowlit a Kafka tail is a `kafka.tail` stream that starts at the high watermark (or given offsets) and can be filtered, paused and resumed; the UI keeps the newest 10 000 messages. *Owner: II-18.*

<a id="task-es"></a>
### task (Elasticsearch)
A long-running operation that Elasticsearch runs on the server and exposes under `_tasks` (reindex, update-by-query, delete-by-query…), with status and an optional cancel. Rowlit shows them live through the `es.tasks` stream and cancels cancellable ones. *Owner: II-18.*

<a id="text-fallback"></a>
### text fallback (analyzer)
What the link analyzer does when DuckDB cannot serialize a statement (PIVOT, DESCRIBE, SHOW…): fetch every table named `alias.table` in the text, whole and without predicates, with the warning `fallback`. *Owner: II-16.*

<a id="token"></a>
### token
The smallest unit a lexer produces: a word, string, number, operator, punctuation or comment, with its offsets and line. Rowlit's tokens also carry an upper-cased copy for keyword matching and an `unterminated` flag. *Owner: II-11.*

<a id="trigger-character"></a>
### trigger character
A character that opens the completion list by itself. Rowlit's are `. ( , @ : # [ "` and the space, the space only after words such as `FROM`, `JOIN`, `ON` or `INTO`. *Owner: II-11.*

<a id="ttl-countdown"></a>
### TTL countdown
The remaining lifetime of a Redis key, counted down in the UI from the TTL read when the key was loaded, so the user sees it reach zero without re-querying. Rowlit highlights it under 60 s. *Owner: II-17.*

<a id="type-map"></a>
### type map (links)
The rules that turn a source column type into a column kind and a DuckDB type (`TypeMap`), e.g. `decimal(p,s)` → `DECIMAL(38,s)`, `datetimeoffset` → `TIMESTAMPTZ` in UTC, decimals wider than 38 digits → `VARCHAR` with a warning. *Owner: II-16.*

<a id="validation-rule"></a>
### validation rule (Mongo)
A collection's `validator` (often a `$jsonSchema`) with a level (`off`, `strict`, `moderate`) and an action (`error`, `warn`, `errorAndLog`) that MongoDB applies to inserts and updates. Rowlit reads it from `listCollections` and writes it with `collMod`. *Owner: II-17.*

<a id="virtual-relation"></a>
### virtual relation
A foreign key the user declares between two mounted tables (typically of different members, where no real FK can exist). The link catalog reports it as a foreign key and the builder suggests joins from it. *Owner: II-16.*

<a id="watermark"></a>
### watermark (low / high)
The first offset still stored in a Kafka partition (low) and the offset the next message will get (high). Rowlit computes start offsets, message estimates, browse ends and lag from them; `high − low` is an upper bound on the message count of a compacted or purged partition. *Owner: II-18.*

<a id="wide-member"></a>
### wide member
A member with scope `database` or `connection`, spanning several schemas or databases. Its nested tables are named with three or four parts and loaded lazily, one container at a time, when something names them. *Owner: II-16.*

<a id="wildcard-index"></a>
### wildcard index
A MongoDB index on `$**` (or `path.$**`) that indexes every field below a path, useful for documents whose fields vary. A `wildcardProjection` can include or exclude paths, and only on a single whole-document `$**` key. *Owner: II-17.*
