# Glossary

Terms are sorted by their stable English anchor. The owner marks the chapter that introduces the term.

<a id="_id"></a>
### _id
The unique primary key field of every MongoDB document. Deeper: defaults to an `ObjectId` (4-byte time, 5-byte random, 3-byte counter). *Owner: I-16.*

<a id="accelerated-database-recovery"></a>
### Accelerated Database Recovery — بازیابی شتاب‌یافتهٔ پایگاه داده
SQL Server 2019+ option that keeps row versions in a persistent version store inside the database. Deeper: undo becomes a logical revert, so rollback and crash recovery are nearly instant and the log can be truncated despite long transactions. *Owner: I-11.* See also: version store.

<a id="access-path"></a>
### access path — مسیر دسترسی
The way a plan reads one table: a full scan, an index seek, an index-only scan, a bitmap scan or a fetch by row address. The optimizer costs each candidate path and picks one per table. *Owner: I-08.* See also: table scan, index seek.

<a id="acid"></a>
### ACID — ACID
The four transaction guarantees: atomicity, consistency, isolation, durability. Deeper: each letter is kept by a different engine part (undo, constraints, concurrency control, WAL). *Owner: I-09.*

<a id="activity-source"></a>
### activity source — activity source
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="actual-plan"></a>
### actual plan — طرح واقعی
A plan captured while the statement really runs, with real row counts, times and I/O per operator. Compare its actual rows with the estimated rows to find wrong estimates; it executes the statement, so wrap DML in a rolled-back transaction. *Owner: I-08.* See also: estimated plan, EXPLAIN.

<a id="adapter"></a>
### adapter
Code that converts one interface into the one a client expects. Deeper: a Rowlit provider adapts a driver to Core's `IDbProvider`/`IDbSession` contract. *Owner: II-03.* See also: ports and adapters.

<a id="ado-net"></a>
### ADO.NET
.NET's standard database API: `DbConnection`, `DbCommand`, `DbDataReader`, transactions and parameters. Deeper: seven of Rowlit's eight relational providers sit on it through `AdoSessionBase`; Cassandra uses its own driver API. *Owner: II-09.* See also: driver, AdoSessionBase.

<a id="advanced-mode"></a>
### Advanced mode (query builder)
The query builder's SQL mode, where the compiled SQL is edited by hand. "Back to builder" parses it with `BuilderParser`; SQL outside the builder subset (CTEs, subqueries, windows…) keeps the tab in SQL mode with the reason. *Owner: II-16.*

<a id="aes-gcm"></a>
### AES-GCM — رمزنگاری احرازشده
Authenticated encryption used for optional secret-bearing connection exports. It detects tampering as well as hiding plaintext. *Owner: II-19.*

<a id="aggregate"></a>
### aggregate — تابع تجمیعی
A function that turns many rows into one value: `count`, `sum`, `avg`, `min`, `max`. Aggregates skip NULLs (except `count(*)`); with `GROUP BY` they run once per group, with `OVER` they become window functions. *Owner: I-03.* See also: GROUP BY, window function.

<a id="aggregate-strip"></a>
### aggregate strip
A status row that shows Count, Sum, Avg, Min and Max of the selected grid cells. Decimals are summed exactly with `BigInt`, so totals do not drift. *Owner: II-13.*

<a id="aggregation-pipeline"></a>
### aggregation pipeline
A MongoDB query as an array of stages (`$match`, `$group`, `$lookup`, …). Deeper: put `$match` and `$sort` first to use indexes. *Owner: I-16.*

<a id="alias"></a>
### alias — نام مستعار
A temporary name given to a column or table inside one statement with `AS`. Required for derived tables and self joins; select-list aliases cannot be used in `WHERE` in standard SQL. *Owner: I-03.*

<a id="all-errors"></a>
### ALL_ERRORS
Oracle data-dictionary view listing compile errors of PL/SQL units. Deeper: after a `CREATE` that "succeeds with compilation errors" (ORA-24344) the Oracle session reads it and sends `exec.diagnostics`. *Owner: II-09.* See also: DBMS_OUTPUT.

<a id="all-views"></a>
### ALL_* views
Oracle's dictionary views: `USER_*` (yours), `ALL_*` (visible to you), `DBA_*` (everything). Deeper: `V$` views show the running instance. *Owner: I-17.*

<a id="analyzer"></a>
### analyzer
The pipeline that turns text into terms (character filters, tokenizer, token filters). Deeper: same analyzer at index and search time. *Owner: I-16.*

<a id="anchor-type"></a>
### anchor type
One `typeof(...)` per module assembly in `Host/ModuleAssemblies.cs`. Deeper: it keeps the compiled assembly reference so `EngineModules.Discover` can find the assembly's modules. *Owner: II-07.* See also: reflection, engine module.

<a id="animation-frame-batching"></a>
### animation-frame batching
Applying many incoming events in one go, once per screen frame (about 16 ms). The results store queues events per execution and flushes on `requestAnimationFrame`, so a 100 000-row stream costs one React update per frame. *Owner: II-13.*

<a id="anomaly"></a>
### anomaly — ناهنجاری
A failure caused by storing a fact in more than one place: the update anomaly (copies disagree), the insert anomaly (a fact cannot be stored without another), the delete anomaly (deleting one fact destroys another). Normalisation removes them. *Owner: I-05.* See also: normal form.

<a id="anti-join"></a>
### anti-join — پادپیوند
A join that keeps the rows of one input that have **no** match in the other (`NOT EXISTS`, `NOT IN`, `LEFT JOIN … IS NULL`). Optimizers implement it with the same algorithms as joins, stopping at the first match. *Owner: I-08.* See also: semi-join.

<a id="appender"></a>
### appender
A bulk writer that adds rows to one engine table without SQL INSERTs (DuckDB's Appender API). Rowlit's `IFederationAppender` converts driver values per column kind and stores a value it cannot convert as NULL, counting it for the `conversion` warning. *Owner: II-16.*

<a id="apply"></a>
### APPLY — APPLY
SQL Server and Oracle's `CROSS APPLY` / `OUTER APPLY`: a join in which the right side is evaluated for each row of the left side and may refer to its columns. The equivalent of the standard `LATERAL`. *Owner: I-04.* See also: LATERAL.

<a id="archivelog-mode"></a>
### ARCHIVELOG mode — حالت ARCHIVELOG
Oracle mode in which every filled online redo log is copied to an archived redo log before reuse. Deeper: required for media recovery, PITR and Data Guard; NOARCHIVELOG allows crash recovery only. *Owner: I-11.*

<a id="aries"></a>
### ARIES — ARIES
The classic crash-recovery algorithm (IBM, 1992): analysis, redo, undo. Deeper: repeats history during redo and writes compensation log records during undo so recovery is idempotent. *Owner: I-11.*

<a id="artifact"></a>
### artifact — محصول ساخت
A file retained from a build or CI job, such as an installer, test result, or update manifest. *Owner: II-24.*

<a id="asar"></a>
### asar — asar
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="asp-net-core"></a>
### ASP.NET Core
Microsoft's web framework for .NET. Deeper: the engine host is an ASP.NET Core minimal-API app on Kestrel. *Owner: II-05.* See also: minimal API, Kestrel.

<a id="assembly"></a>
### assembly
A compiled .NET library or executable (`.dll`/`.exe`) with metadata about its types and references. *Owner: II-07.* See also: reflection.

<a id="ast"></a>
### AST (abstract syntax tree)
The tree a parser builds from SQL text: statements, clauses, expressions and table references as nested nodes. The link analyzer reads DuckDB's AST as JSON from `json_serialize_sql`, so it understands the statement exactly as the engine will run it. *Owner: II-16.* See also: parser (I-08).

<a id="asynchronous-replication"></a>
### asynchronous replication — همانندسازی ناهمگام
COMMIT returns before any replica has the change. Deeper: no commit latency cost, but a failover can lose the transactions inside the replication lag. *Owner: I-12.*

<a id="atomicity"></a>
### atomicity — اتمی‌بودن
All statements of a transaction take effect, or none. Deeper: implemented with undo information and recovery. *Owner: I-09.*

<a id="attached-database"></a>
### attached database
An extra SQLite database file opened on the same connection under a schema name (`ATTACH DATABASE ... AS name`). Deeper: Rowlit lists attached files as schemas. *Owner: II-09.*

<a id="attention"></a>
### attention
The TDS signal SQL Server clients send to cancel a running batch. Deeper: `SqlCommand.Cancel()` sends it; the server acknowledges through `InfoMessage`. *Owner: II-09.* See also: cancel.

<a id="attribute"></a>
### attribute — صفت
Formal word for a column of a relation: a named property of the things the table describes. *Owner: I-02.* See also: relation, domain.

<a id="audit"></a>
### audit
A tamper-resistant record of logins, changes and reads. Deeper: ship the log off the host; audit meaningfully, not everything. *Owner: I-14.*

## I-15 OLTP vs OLAP and columnar engines

<a id="auth-frame"></a>
### auth frame
The first WebSocket message, `{"type":"auth","token","clientId"}`, that authenticates the socket. Deeper: wrong or late (over 2 s) means close code 4401. *Owner: II-06.*

<a id="authentication"></a>
### authentication
Proving who you are to the server (password, ticket, certificate, signed token). Deeper: the server decides which method applies (PostgreSQL `pg_hba.conf`, SQL Server login type); weak methods over unencrypted links can be replayed or stolen. *Owner: I-14.* See also: authorisation, SCRAM, Kerberos.

<a id="authorisation"></a>
### authorisation
Deciding what an authenticated principal may do (read, change, create). Deeper: implemented with roles, privileges, ownership, row policies; the principle of least privilege governs its design. *Owner: I-14.* See also: privilege, role, least privilege.

<a id="auto-increment"></a>
### auto_increment
MySQL's column attribute that generates ascending integers. Deeper: read back with `LAST_INSERT_ID()`. *Owner: I-17.*

<a id="auto-update"></a>
### auto-update — به‌روزرسانی خودکار
The signed metadata, download, verification and deferred-install flow that moves an installed app to a newer release. *Owner: II-22.*

<a id="autocommit"></a>
### autocommit — ثبت خودکار
Mode in which every statement is its own transaction and commits when it ends. Deeper: the default in PostgreSQL, SQL Server, MySQL, SQLite and Snowflake; Oracle leaves it to the client. *Owner: I-09.*

<a id="autovacuum"></a>
### autovacuum — جاروی خودکار (autovacuum)
PostgreSQL background workers that run VACUUM and ANALYZE when a table has enough dead tuples or changes. Deeper: triggers at threshold + scale factor × rows (defaults 50 + 20 %), and forces anti-wraparound vacuums. *Owner: I-10.*

<a id="avro"></a>
### Avro
A compact binary row format with an embedded or registered schema. Deeper: the usual Kafka format with the Schema Registry. *Owner: I-16.*

<a id="awr"></a>
### AWR — مخزن خودکار بار کاری (AWR)
Oracle's Automatic Workload Repository: periodic snapshots of performance statistics. Deeper: with ASH and ADDM it needs the Diagnostics Pack licence on Enterprise Edition; Statspack is the free alternative. *Owner: I-13.*

<a id="b-plus-tree"></a>
### B+tree — درخت B+ (B+tree)
The tree structure behind almost every relational index: separator keys in internal pages, all keys (and row pointers or rows) in linked leaf pages. Shallow (3–4 levels for millions of rows) and good for both seeks and range scans. *Owner: I-07.* See also: B-tree, leaf node, fan-out.

<a id="b-tree"></a>
### B-tree — درخت B (B-tree)
A balanced search tree of pages (Bayer and McCreight, 1970) where every leaf is at the same depth. In database speech "B-tree index" nearly always means the B+tree variant; SQLite's index trees are classic B-trees with keys in interior pages. *Owner: I-07.* See also: B+tree.

<a id="back-pressure"></a>
### back-pressure
A way for a slow consumer to slow a fast producer down. Deeper: the hub does not slow publishers; a client whose queue passes 200 000 frames is disconnected instead. *Owner: II-06.*

<a id="backoff"></a>
### backoff
Waiting longer after each failed retry. Deeper: `EngineSocket` reconnects after growing delays from 250 ms to 8 s. *Owner: II-06.* See also: reconnect.

<a id="backup"></a>
### backup — پشتیبان
A copy of the data kept aside to restore later. Deeper: comes as full, differential, incremental or log backups, physical or logical; a replica is not a backup. *Owner: I-12.*

<a id="backward-inference"></a>
### backward inference
Guessing the table from the columns already typed: in `SELECT name, price FROM |` tables that have all those columns rank first. The completer looks them up in a column-name index of the catalog and adds +25 relevance. *Owner: II-11.*

<a id="bag"></a>
### bag — چندمجموعه
A collection that may contain duplicates and has no order (a multiset). SQL tables and query results are bags; the formal relational model uses sets. This is why `UNION ALL` and `DISTINCT` exist. *Owner: I-02.*

<a id="batch"></a>
### batch
One unit the UI sends to the server: a `GO`-delimited block in T-SQL, usually one statement elsewhere. Deeper: `SqlBatch(Sql, Line, Col)` carries its document position so errors map back. *Owner: II-08.* See also: statement, script.

<a id="batch-separator"></a>
### batch separator
A client-side word that ends a group of statements sent together. Deeper: `GO` (SQL Server), `/` (Oracle), `DELIMITER` (MySQL); not understood by the server. *Owner: I-17.*

<a id="bearer-token"></a>
### bearer token
A secret whose holder is trusted, sent as `Authorization: Bearer <token>`. Deeper: the engine creates 32 random bytes per run and prints them once in the READY line. *Owner: II-03.* See also: trust boundary.

<a id="bidi-rtl-text"></a>
### bidi / RTL text
Text that reads right to left (Persian, Arabic, Hebrew) or mixes directions. The grid decides direction by the first strong character (Unicode UAX #9) and draws RTL cells with the canvas in RTL mode. *Owner: II-13.*

<a id="binary-safe-text"></a>
### binary-safe text
Showing bytes that are not valid UTF-8 as text with `\xHH` escapes while keeping the real bytes. Rowlit's Redis package sends the display text plus a side map from that text to the base64 bytes, so an edit writes the exact original bytes back (`BinaryText`). *Owner: II-17.*

<a id="bind"></a>
### bind
Attaching a value to a placeholder so it travels separately from the SQL text. *Owner: II-08.* See also: query parameter, param binder.

<a id="bind-peeking"></a>
### bind peeking — نگاه به مقدار bind (bind peeking)
Oracle's version of parameter sniffing: on a hard parse the optimizer looks at the current bind values and plans for them. Adaptive cursor sharing (11g) adds child cursors when the plan is bad for other values. *Owner: I-08.* See also: parameter sniffing.

<a id="bind-variable"></a>
### bind variable
A placeholder in a statement filled in at execution time. Deeper: the placeholder syntax differs per dialect (`@name`, `:name`, `$1`, `?`, `{name:Type}`); chapter I-17 lists the styles. *Owner: I-14 (styles: I-17).*

<a id="binder"></a>
### binder
The part of a language processor that maps names in a parsed statement to the objects they mean. In Rowlit's IntelliSense `Binder` resolves table sources, aliases, CTEs, temp tables and qualifiers against the catalog index, lazily and without failing; the DBMS binder of Part I-08 does the same job strictly. *Owner: II-11.*

<a id="binlog"></a>
### binlog (binary log) — لاگ دودویی (binlog)
MySQL's server-level log of committed changes, used for replication and point-in-time recovery. Deeper: kept consistent with the InnoDB redo log through an internal two-phase commit; row format is the default. *Owner: I-12.*

<a id="bitmap-heap-scan"></a>
### bitmap heap scan — پویش بیت‌نگاشتی هیپ (bitmap heap scan)
PostgreSQL access path that first collects matching row pointers from one or more indexes into an in-memory bitmap ordered by page, then visits each heap page once in file order. A lossy bitmap (one bit per page) needs a recheck of the condition. *Owner: I-07.* See also: bitmap index.

<a id="bitmap-index"></a>
### bitmap index — نمایهٔ بیت‌نگاشت (bitmap index)
An index that stores one compressed bit string per distinct value, one bit per row (Oracle). Very fast for combining low-cardinality predicates in warehouses; unsuitable for concurrent OLTP writes because one entry covers many rows. *Owner: I-07.* See also: bitmap heap scan.

<a id="bloat"></a>
### bloat — حجیم‌شدگی (bloat)
Space in tables and indexes taken by dead row versions or empty pages. Deeper: in PostgreSQL it grows when VACUUM cannot keep up or the xmin horizon is held back. *Owner: I-10.*

<a id="block"></a>
### block — بلوک
Oracle's (and PostgreSQL's internal) name for a page: the fixed-size unit of storage and I/O, 8 KB by default. *Owner: I-06.* See also: page.

<a id="blocker"></a>
### blocker — blocker
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="blocking-chain"></a>
### blocking chain — زنجیرهٔ انسداد
A queue of sessions each waiting for a lock held by the next, ending at a head blocker. Deeper: find the head with `pg_blocking_pids`, `blocking_session_id` or `v$session.blocking_session`. *Owner: I-10.*

<a id="blockmap"></a>
### blockmap — blockmap
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="bloom-filter"></a>
### Bloom filter — فیلتر بلوم (Bloom filter)
A compact bit array that answers "definitely not present" or "maybe present" for a value. Used as skip indexes (ClickHouse), PostgreSQL's `bloom` extension, and run-time join filters pushed into scans. *Owner: I-07.* See also: skip index, hash join.

<a id="bottleneck"></a>
### bottleneck — گلوگاه
The one resource or step that limits the whole system. Deeper: improving anything else does not change what users see. *Owner: I-13.*

<a id="bridge"></a>
### bridge (`window.dbstudio`)
The object the Electron preload exposes to the page. Its TypeScript contract is `DbStudioBridge`; new members are optional so older preloads still work. *Owner: II-20.*

<a id="brin"></a>
### BRIN — نمایهٔ بازهٔ بلوکی (BRIN)
PostgreSQL's block range index: a tiny summary (min/max by default) per range of heap pages (128 by default). Effective only when the physical row order follows the column, such as append-only timestamps. *Owner: I-07.* See also: zone map.

<a id="broken-session"></a>
### broken session
A session whose connection died. Deeper: the next run reopens it under the same id; if a transaction was lost it answers `409 SESSION_BROKEN`. *Owner: II-08.*

<a id="broker"></a>
### broker
A Kafka server. Deeper: partitions have a leader broker and follower replicas. *Owner: I-16.*

<a id="bson"></a>
### BSON
MongoDB's binary JSON format with extra types. Deeper: `ObjectId`, `Decimal128`, dates, binary; 16 MiB document limit. *Owner: I-16.*

<a id="buffer-pool"></a>
### buffer pool — استخر بافر (buffer pool)
The shared memory area where an engine caches data and index pages (`shared_buffers`, buffer cache, InnoDB buffer pool). A page found there is a logical read; otherwise it is a physical read from storage. *Owner: I-06.* See also: dirty page, clock sweep, logical read.

<a id="build"></a>
### build — ساخت
The repeatable conversion of source code and assets into executable outputs. *Owner: II-24.*

<a id="build-side"></a>
### build side — سمت ساخت (build side)
The input of a hash join that is read first into an in-memory hash table, normally the smaller one. If it does not fit in memory the join spills in batches. *Owner: I-08.* See also: probe side, hash join.

<a id="bulk-api"></a>
### bulk API (`_bulk`)
The Elasticsearch endpoint that indexes, updates or deletes many documents in one request, written as NDJSON action and document lines. Rowlit's import job sends `_bulk` batches of at most `batchSize` documents and 5 MB, with `refresh=false` during the load and one refresh at the end. *Owner: II-18.*

<a id="bulk-load"></a>
### bulk load
Writing many rows with the database's fast path instead of one INSERT per row (`SqlBulkCopy`, PostgreSQL `COPY`, ClickHouse native insert). Rowlit uses it only for append and truncate-insert modes. *Owner: II-15.*

<a id="bundle-budget"></a>
### bundle budget
A limit on how much the gzipped UI build may grow over a committed baseline (+1 400 KB total, +120 KB initial load in CI). It forces new features to be lazy chunks. *Owner: II-20.*

<a id="bushy-tree"></a>
### bushy tree — درخت انبوه (bushy tree)
A join tree in which both inputs of a join may themselves be joins. It enlarges the search space but can be better for star schemas and parallel hash joins. *Owner: I-08.* See also: left-deep tree, join order.

<a id="busy"></a>
### busy
The state of a session that is executing or reserved. Deeper: `SessionHandle.TryReserve` makes a second run answer `409 SESSION_BUSY`. *Owner: II-08.*

<a id="cache-invalidation"></a>
### cache invalidation
Throwing away or refreshing cached data when the source changed. After DDL the engine reloads the affected schemas and bumps their version. *Owner: II-10.*

<a id="camelcase"></a>
### camelCase
Writing names with a lower-case first word and capitalised later words (`connectionId`). Deeper: all engine JSON uses it (`CoreJson`). *Owner: II-05.*

<a id="cancel"></a>
### cancel
Stopping a running statement. Deeper: each driver does it differently: TDS attention, TNS break, PostgreSQL cancel request, `sqlite3_interrupt`, `KILL QUERY`, `SYSTEM$CANCEL_QUERY`. *Owner: II-08.* See also: late cancel, attention.

<a id="cancellationtoken"></a>
### CancellationToken
.NET's object for asking an operation to stop. Deeper: request tokens flow into services; executions use their own so they outlive the 202 response. *Owner: II-05.*

<a id="candidate-key"></a>
### candidate key — کلید کاندید
A minimal set of columns whose values are unique in every row: remove any column and uniqueness is lost. A table can have several; one becomes the primary key, the others are alternate keys, usually declared `UNIQUE`. *Owner: I-02.* See also: primary key.

<a id="canonical-sql"></a>
### canonical SQL (builder)
The one fixed text layout the query builder's model compiles to: one clause per line, upper-case keywords, quoted identifiers only where needed, filter values as `$fp1…` binds. Two compilers (TypeScript and C#) must produce it byte for byte. *Owner: II-16.*

<a id="canvas-grid"></a>
### canvas grid
A table drawn on an HTML `<canvas>` instead of as DOM rows. Rowlit's results grid uses glide-data-grid, so cost depends on the visible cells, not on the row count. *Owner: II-13.*

<a id="cap"></a>
### CAP theorem — قضیهٔ CAP
During a network partition a replicated system must give up consistency (linearizability) or availability. Deeper: proved by Gilbert and Lynch (2002); not "pick any two". *Owner: I-12.* See also: PACELC.

<a id="cardinality-estimate"></a>
### cardinality estimate — تخمین کاردینالیتی
The optimizer's guess of how many rows an operator returns, computed from statistics and selectivity formulas. Every cost depends on it, and errors multiply up the plan tree. *Owner: I-08.* See also: selectivity, statistics.

<a id="cardinality-relationship"></a>
### cardinality (relationship) — کاردینالیتی ارتباط
How many rows on one side may relate to a row on the other: one-to-one, one-to-many, many-to-many. Shown on ER diagrams by the line ends. Not to be confused with the number of rows in a table, nor with a column's number of distinct values in statistics. *Owner: I-02.* See also: ER diagram, crow's foot.

<a id="cardinality-statistics"></a>
### cardinality (statistics) — کاردینالیتی (در آمار)
In optimizer language, the number of distinct values in a column, or the number of rows an operator returns. Not the same as relationship cardinality in data modelling (I-02). *Owner: I-07.* See also: selectivity, density.

<a id="cascade"></a>
### cascade — آبشاری
A referential action: when a parent row is deleted (or its key updated), the database applies the change to child rows too (`ON DELETE CASCADE`). Convenient for line items, dangerous for high-level tables. Other actions are `RESTRICT`, `NO ACTION`, `SET NULL`, `SET DEFAULT`. *Owner: I-05.* See also: foreign key.

<a id="case-folding"></a>
### case folding
What a server does to unquoted names: Oracle and Snowflake upper-case them, PostgreSQL and Cassandra lower-case them, others preserve. *Owner: II-09.* See also: identifier rules.

<a id="cassandracsharpdriver"></a>
### CassandraCSharpDriver
The DataStax C# driver for Cassandra and ScyllaDB (3.22.1 in Rowlit). *Owner: II-09.*

<a id="catalog"></a>
### catalog
The database's description of itself: its tables, columns, keys, views, routines. Read from system views such as `pg_catalog` or `sys.*`. *Owner: II-10.*

<a id="catalog-index"></a>
### catalog index
The in-memory lookup structure the IntelliSense builds from the catalog snapshot (`CatalogIndex`). It holds per-schema name maps keyed by the dialect's case folding, the foreign-key graph in both directions, built-in system schemas, Oracle PUBLIC synonyms and the catalogs of other databases of the server, and asks the host for schemas it does not have yet. *Owner: II-11.*

<a id="catalog-version"></a>
### catalog version
An integer the engine increments whenever a cached database catalog is reloaded. It is part of the ETag and is never reused. *Owner: II-10.*

<a id="causal-consistency"></a>
### causal consistency — سازگاری علّی
Everyone sees causally related writes in the same order; unrelated writes may differ. Deeper: weaker than linearizability, stronger than eventual. *Owner: I-12.*

<a id="cdc"></a>
### CDC (change data capture) — ثبت تغییرات داده (CDC)
Reading a database's log and publishing each row change as an event. Deeper: PostgreSQL logical decoding, the MySQL binlog, SQL Server CDC; Debezium to Kafka is typical. *Owner: I-12.*

<a id="cell-fetch"></a>
### cell fetch
Getting the full value of a truncated cell later with `GET .../cell?row&col`, without re-running the query. *Owner: II-08.* See also: result store, wire value.

<a id="cell-kind"></a>
### cell kind
The column's `ColumnKind` (`int`, `decimal`, `string`, `datetime`, `guid`, `binary`, ...) sent with the result. The grid picks alignment, formatting and editors from it. *Owner: II-13.*

<a id="cell-viewer"></a>
### cell viewer
A side panel that shows one full cell value, fetching it from the engine's stored result when the grid holds only a truncated prefix. *Owner: II-13.*

<a id="certificate"></a>
### certificate
A public key plus an identity (host name) signed by a certificate authority. Deeper: clients verify the chain, the validity dates and the host name. *Owner: I-14.*

<a id="certificate-authority"></a>
### certificate authority (CA)
An organisation whose signature on certificates clients trust. Deeper: "verify-ca" checks the chain only, "verify-full" also checks the host name. *Owner: I-14.*

<a id="change-stream"></a>
### change stream
A subscription to the changes of a MongoDB collection. Deeper: needs a replica set. *Owner: I-16.*

<a id="channel"></a>
### channel
`System.Threading.Channels.Channel<T>`, an async producer/consumer queue. Deeper: the hub keeps one unbounded `Channel<byte[]>` per WebSocket client. *Owner: II-06.*

<a id="check-constraint"></a>
### CHECK — قید CHECK
A constraint that tests a condition on each row, such as `qty > 0`. It passes when the condition is TRUE or UNKNOWN, so combine it with `NOT NULL`. Not supported by Snowflake and not enforced by Cassandra. *Owner: I-05.* See also: constraint.

<a id="checkpoint"></a>
### checkpoint — نقطهٔ وارسی (checkpoint)
Writing dirty pages so that recovery can start from a recent log position. Deeper: fuzzy; bounds recovery time and lets old log be recycled. *Owner: I-11.*

<a id="chord"></a>
### chord
A shortcut of two strokes pressed one after the other, such as `Ctrl+K Ctrl+S`. The dispatcher waits 1.5 s for the second stroke. *Owner: II-20.*

<a id="chunk"></a>
### chunk
A separately downloaded file of the built UI. `lazy(() => import(...))` creates one per screen or feature. *Owner: II-20.*

<a id="chunked-list"></a>
### chunked list
An append-only list stored as fixed-size chunks (2 048 items). Appending never copies old items, so results can grow to millions of rows. *Owner: II-13.*

<a id="ci"></a>
### CI — یکپارچه‌سازی پیوسته
Automated gates that build and test each proposed change in a clean runner. *Owner: II-24.*

<a id="clause-marker"></a>
### clause marker
A note the partial parser leaves in a scope: "from this offset on, the cursor is in clause X" (`select`, `from`, `join`, `on`, `where`, `set`, `ddl`...). The cursor context takes the last marker before the cursor to know what to suggest; marker data carries details such as the table an `ON` belongs to. *Owner: II-11.*

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

<a id="client-server"></a>
### client/server — کلاینت/سرور
An arrangement in which the DBMS runs as a separate server program and applications (clients) connect to it over a network. PostgreSQL, SQL Server, Oracle, MySQL, ClickHouse and Cassandra work this way. The opposite is an embedded database. *Owner: I-01.*

<a id="clock-sweep"></a>
### clock sweep — جاروب ساعتی (clock sweep)
PostgreSQL's buffer replacement algorithm: a hand circles the buffers, decrements usage counts and evicts the first buffer whose count is zero. It approximates LRU cheaply; big scans use a small ring buffer instead. *Owner: I-06.* See also: buffer pool.

<a id="closure"></a>
### closure — خاصیت بستار
The property that every relational operator takes relations and returns a relation, so operators compose without limit. It is why a subquery can appear wherever a table can. Also, in dependency theory, the set of columns determined by a given set. *Owner: I-02.*

<a id="cluster"></a>
### cluster — کلاستر
In PostgreSQL, one server instance together with its data directory, which holds several databases. In Cassandra, the set of nodes that form one distributed database. The word has different meanings in other products. *Owner: I-01.* See also: instance.

<a id="clustered-index"></a>
### clustered index — نمایهٔ خوشه‌ای (clustered index)
A B+tree whose leaf level **is** the table, sorted by the index key (SQL Server, InnoDB). Secondary indexes then point to rows by clustering key, not by physical address. *Owner: I-06.* See also: heap, index-organised table, key lookup.

<a id="clustering-factor"></a>
### clustering factor — ضریب خوشه‌بندی (clustering factor)
Oracle index statistic: how many table-block changes a full scan of the index in key order would cause. Close to the number of blocks means good physical order and cheap range scans; close to the number of rows means random access. *Owner: I-07.* See also: statistics.

<a id="clustering-key"></a>
### clustering key
In Cassandra, the part of the primary key that orders rows inside a partition. Deeper: `CLUSTERING ORDER BY`. *Owner: I-16.*

<a id="code-generation"></a>
### code generation
Turning tables, views and routines into source code (C#, Go, TypeScript, Java, Python, SQL, JSON). Pure TypeScript in `ui/src/codegen`. *Owner: II-14.*

<a id="code-signing"></a>
### code signing — امضای کد
A platform signature binding a package to a publisher and protecting its integrity. *Owner: II-24.*

<a id="code-splitting"></a>
### lazy loading / code splitting
Loading code only when it is first needed. Large Rowlit screens are `lazy()` components, so startup stays small. *Owner: II-20.*

<a id="codec"></a>
### codec
A rule that turns the bytes of a message into readable text and back (string, JSON, hex, integers, Avro, Protobuf, JSON Schema). Rowlit's `MessageCodec` decodes Kafka keys, values and headers for the browser and encodes them for produce; a decode failure falls back to hex with an error text instead of failing. *Owner: II-18.*

<a id="collation"></a>
### collation — ترتیب مرتب‌سازی و مقایسه
The rules for comparing and sorting text: case and accent sensitivity and language ordering. It decides whether `'a' = 'A'` and how names sort. Defaults differ by engine (SQL Server case-insensitive, PostgreSQL locale-based, SQLite binary). *Owner: I-05.*

<a id="column-store"></a>
### column store
Storage that keeps all values of one column together. Deeper: reads only needed columns, compresses well; costly for single-row access. *Owner: I-15.*

<a id="columnstore"></a>
### columnstore — ستون‌انبار (columnstore)
An index or table stored column by column in compressed segments with min/max metadata (SQL Server columnstore, Oracle In-Memory). Enables segment elimination and batch-mode execution for analytics. *Owner: I-07.* See also: vectorised execution, column store (I-15).

<a id="command"></a>
### command
A registered user action with an id, title, optional shortcut, scope, `when` and `run`. Buttons, menus and keys only dispatch commands. *Owner: II-20.*

<a id="command-palette"></a>
### command palette — command palette
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="command-registry"></a>
### command registry
The module that stores all commands, resolves shortcuts and reports conflicts. It is framework-free so any package can register from its `commands.ts`. *Owner: II-20.*

<a id="command-scope"></a>
### command scope
Where a shortcut is active: `global`, `editor`, `grid`, `explorer`, `designer`, ... A key is resolved by walking from the focused element's innermost `data-command-scope` outwards. *Owner: II-20.*

<a id="commit"></a>
### commit — commit (ثبت نهایی)
Ending a transaction so its changes become permanent and visible. Deeper: durable once the commit record is flushed to the log. *Owner: I-09.*

<a id="commitlog"></a>
### commitlog
Cassandra's sequential write-ahead file for crash recovery. Deeper: periodic sync every 10 s by default. *Owner: I-16.*

<a id="compaction"></a>
### compaction
The background merging of SSTables. Deeper: size-tiered, leveled, time-window, unified. *Owner: I-16.*

<a id="compare-with-server"></a>
### compare with server
A diff of the object's current server definition against the text in an "Edit:" console, shown in a Monaco diff editor. *Owner: II-14.*

<a id="compensation-log-record"></a>
### compensation log record (CLR) — رکورد لاگ جبرانی (CLR)
A log record written while undoing a change during rollback or recovery. Deeper: its undoNextLSN keeps recovery from undoing the same change twice after a second crash. *Owner: I-11.*

<a id="completer"></a>
### completer
The function that produces the suggestion list for a cursor position (`complete` in `intel/complete/completer.ts`). It chooses item sources by clause and qualifier, then appends dialect, package and editor sources (snippets, postfix templates) and sorts by score. *Owner: II-11.*

<a id="completion-item"></a>
### completion item
One row of the suggestion list: a label, a kind (table, column, keyword, snippet...), the text to insert, a sort key and optional documentation. Rowlit items also carry a usage key for ranking, an object reference for definition and a `loading` flag for "Loading <schema>…" rows. *Owner: II-11.*

<a id="component"></a>
### component
A React function that returns UI. Rowlit keeps logic in pure modules and stores, and components mostly draw. *Owner: II-20.*

<a id="composite-index"></a>
### composite index — نمایهٔ ترکیبی (composite index)
An index on several columns, sorted by the first, then the second within equal first values, and so on. Column order decides which queries it can seek: equality columns first, then one range or sort column. *Owner: I-07.* See also: leftmost prefix, ESR rule.

<a id="composite-key"></a>
### composite key — کلید مرکب
A key made of more than one column, such as `(order_id, product_id)` in `order_lines`. *Owner: I-02.* See also: primary key.

<a id="composition-root"></a>
### composition root
The one place where an application builds its objects and wires implementations to interfaces. Deeper: Rowlit has `Program.cs` plus one `IEngineModule` per feature package. *Owner: II-03.*

<a id="compression-rle-dictionary-delta"></a>
### compression (RLE / dictionary / delta)
Run-length encoding stores a value and its repeat count; dictionary encoding replaces values with small codes; delta encoding stores differences. Deeper: followed by LZ4 or ZSTD; ClickHouse `CODEC(Delta, ZSTD)`. *Owner: I-15.*

<a id="conditional-request"></a>
### conditional request / 304
A request that carries `If-None-Match: <etag>`. If nothing changed the server answers `304 Not Modified` with no body. *Owner: II-10.*

<a id="confluent-wire-format"></a>
### Confluent wire format
The byte layout producers use when a Kafka message is serialised with a Schema Registry schema: a magic byte `0`, a 4-byte big-endian schema id, then the payload (Protobuf adds message indexes). Rowlit's `auto` decoder recognises it and fetches the schema by id. *Owner: II-18.*

<a id="conformance-test"></a>
### conformance test — conformance test
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="connection"></a>
### connection — اتصال
A communication channel between an application and a DBMS, opened with a login and closed when done. On the server it is represented by a session. Opening connections is expensive, so applications usually reuse them. *Owner: I-01.* See also: session, driver.

<a id="connection-guard"></a>
### connection guard
`ConnectionGuard`: runs catalog and session-open calls with a deadline and detects dead connections, so a vanished server cannot hang the app. *Owner: II-10.*

<a id="connection-pool"></a>
### connection pool — استخر اتصال
A set of open connections lent to callers and returned instead of closed. Deeper: client-side (ADO.NET, HikariCP) or server-side (PgBouncer); stateful sessions do not fit pooling. *Owner: I-13.*

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

<a id="connections-file"></a>
### connections file — connections file
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="consensus"></a>
### consensus — اجماع
Nodes agreeing on one value despite failures. Deeper: Paxos and Raft; needed for leader election and replicated logs. *Owner: I-12.*

<a id="consistency"></a>
### consistency (ACID) — سازگاری
A transaction moves the database from one valid state to another; declared constraints hold. Deeper: not the C of CAP. *Owner: I-09.*

<a id="consistency-level"></a>
### consistency level
How many replicas must respond to a Cassandra read or write. Deeper: `R + W > RF` gives strong consistency. *Owner: I-16.*

<a id="consistent-read"></a>
### consistent read — خواندن سازگار
Oracle reading a block as of the query's SCN by applying undo to a copy. Deeper: produces CR blocks in the buffer cache; fails with ORA-01555 when undo is gone. *Owner: I-10.*

<a id="console"></a>
### console — console
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="constraint"></a>
### constraint — قید
A rule the database enforces on every write: `NOT NULL`, `PRIMARY KEY`, `UNIQUE`, `FOREIGN KEY`, `CHECK`. Named constraints give readable error messages. *Owner: I-05.*

<a id="consumer-group"></a>
### consumer group
Consumers sharing a `group.id` that split a topic's partitions. Deeper: one consumer per partition at a time; rebalances on membership change. *Owner: I-16.*

<a id="consumer-lag"></a>
### consumer lag
`log end offset − committed offset`: records not yet processed. Deeper: the main health signal of a consumer. *Owner: I-16.*

<a id="context-isolation"></a>
### context isolation — context isolation
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="contextbridge"></a>
### contextbridge — contextbridge
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="contract"></a>
### contract
The agreed shape of requests, responses, events or interfaces that two sides code against. Deeper: `IDbProvider` is frozen by the plan; DTOs in `Host/Contracts` mirror `ui/src/api/types.ts`. *Owner: II-05.*

<a id="contrast-ratio"></a>
### contrast ratio
The WCAG measure of how different two colours are. Rowlit's tests require 4.5:1 for text and 3:1 for UI parts for every theme. *Owner: II-20.*

<a id="correlated-subquery"></a>
### correlated subquery — زیرپرس‌وجوی همبسته
A subquery that refers to a column of the outer query, so it conceptually runs once per outer row. Optimizers often rewrite it into a join (decorrelation). *Owner: I-04.* See also: subquery.

<a id="cors"></a>
### cors — cors
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="cost-based-optimizer"></a>
### cost-based optimizer — بهینه‌ساز هزینه‌محور (cost-based optimizer)
An optimizer that estimates the cost of alternative plans from statistics and chooses the cheapest, as opposed to a rule-based optimizer with fixed preferences. All engines in this book are cost-based. *Owner: I-08.* See also: cost model, optimizer.

<a id="cost-model"></a>
### cost model — مدل هزینه (cost model)
The formulas that turn estimated page reads and per-row CPU work into a cost number, such as PostgreSQL's `seq_page_cost`, `random_page_cost` and `cpu_tuple_cost`. Costs compare plans of one query, not different queries. *Owner: I-08.* See also: cardinality estimate.

<a id="covering-index"></a>
### covering index — نمایهٔ پوشا (covering index)
An index that contains every column a query needs, so the table is never read. Built by adding key columns or `INCLUDE` columns. *Owner: I-07.* See also: INCLUDE columns, index-only scan, key lookup.

<a id="cql"></a>
### CQL
Cassandra Query Language: SQL-shaped, without joins and ad hoc filtering. Deeper: partition key required. *Owner: I-17.*

<a id="cqlsh"></a>
### cqlsh
Cassandra's command-line shell. Deeper: Rowlit's CQL console understands its commands `CONSISTENCY`, `TRACING`, `PAGING`, `SHOW`, `DESCRIBE`. *Owner: II-09.*

<a id="crash-recovery"></a>
### crash recovery — بازیابی پس از خرابی
Bringing the database back to a correct state after a crash by replaying and reversing the log. Deeper: ARIES phases analysis, redo, undo; PostgreSQL needs redo only. *Owner: I-11.*

<a id="crows-foot"></a>
### crow's foot — نمادگذاری پای کلاغی
The ER diagram notation in which a three-pronged fork means "many", a bar "exactly one" and a circle "zero". *Owner: I-02.* See also: ER diagram.

<a id="csp"></a>
### csp — csp
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="cte"></a>
### CTE — عبارت جدولی مشترک
Common table expression: a named subquery defined with `WITH` before the main statement, so the statement reads top to bottom. Whether it is materialised or expanded is an optimizer decision. *Owner: I-04.* See also: recursive CTE.

<a id="ctid"></a>
### ctid — ctid
PostgreSQL's physical row address: (block number, line pointer). It changes when a row is updated or the table is rewritten, so it must never be used as an identity. *Owner: I-06.* See also: RID, rowid.

<a id="culling"></a>
### culling
Not drawing what is off screen. The ER diagram renders only cards and edges inside the padded viewport. *Owner: II-15.*

<a id="cursor-context"></a>
### cursor context
A description of where the cursor sits in a statement: clause, qualifier chain, typed prefix, enclosing function call, whether a table source or an operand precedes it. `detectContext` computes it from the statement model; the completer, signature help and type positions all read it. *Owner: II-11.*

<a id="cursor-es-sql"></a>
### cursor (ES SQL)
A server-side token that Elasticsearch or OpenSearch SQL returns when a result has more rows than one page. Sending it back fetches the next page; closing it (`_sql/close`) frees the server context early, which the Rowlit SQL tab does when a result is replaced or fully read. *Owner: II-18.*

<a id="custom-scheme"></a>
### custom scheme — custom scheme
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="data-directory"></a>
### data directory — data directory
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="data-folder"></a>
### data folder — data folder
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="data-masking"></a>
### data masking
Returning a disguised version of a value to users without the right to see it. Deeper: SQL Server Dynamic Data Masking, Snowflake masking policies; the stored value is unchanged. *Owner: I-14.*

<a id="data-tab"></a>
### Data tab
A tab that shows one table or view page by page, with server-side filter and sort, and in-place editing when the table has a key. *Owner: II-13.*

<a id="data-transfer"></a>
### data transfer — data transfer
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="data-type"></a>
### data type — نوع داده
The kind of values a column can hold (integer, exact decimal, text, timestamp) and how they are stored and compared. Choosing it is part of physical design. *Owner: I-05.* See also: domain.

<a id="data-warehouse"></a>
### data warehouse
A database organised for analysis and fed from operational systems. Deeper: ELT loads raw data first. *Owner: I-15.*

<a id="database"></a>
### database — پایگاه داده
An organised, persistent collection of data managed by a DBMS. In some products "database" is also a named container of schemas and tables inside one server. *Owner: I-01.* See also: DBMS.

<a id="database-client"></a>
### database client — کلاینت پایگاه داده
Software that connects to a DBMS, sends operations, and presents results. *Owner: II-01.*

<a id="database-link"></a>
### database link (Oracle)
An Oracle object (`CREATE DATABASE LINK`) that lets SQL on one Oracle server read tables of another server as `table@link`. Rowlit only writes the script; the engine never runs it. *Owner: II-16.*

<a id="dba"></a>
### DBA — مدیر پایگاه داده
Database administrator: the person responsible for installing, securing, backing up, tuning and upgrading the DBMS. *Owner: I-01.*

<a id="dbms"></a>
### DBMS — سامانه مدیریت پایگاه داده
Database management system: the software that stores the data and provides durability, concurrency control, a query language and access control. PostgreSQL, SQL Server and SQLite are DBMSs. *Owner: I-01.* See also: RDBMS.

<a id="dbms-output"></a>
### DBMS_OUTPUT
Oracle's server-side buffer for PL/SQL output (`PUT_LINE`). Deeper: Rowlit enables it per session and drains it with `GET_LINES` after every batch. *Owner: II-09.*

<a id="dbstudio-ready"></a>
### DBSTUDIO_READY
The one stdout line `DBSTUDIO_READY {"port","token"}` the engine prints when it listens. Deeper: the Electron supervisor waits for it (15 s, 180 s for `dotnet run`). *Owner: II-05.*

<a id="dcl"></a>
### DCL — DCL
Data Control Language: statements that manage permissions (`GRANT`, `REVOKE`). *Owner: I-03.*

<a id="ddl"></a>
### DDL — DDL
Data Definition Language: statements that define or change structure (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`). In some engines DDL commits implicitly. *Owner: I-03.*

<a id="ddl-apply-runner"></a>
### DDL apply runner
`DdlApplyRunner`: executes a designer script on a dedicated connection, in one transaction when asked, and throws `DDL_FAILED` with the failing index. *Owner: II-14.*

<a id="ddl-preview"></a>
### DDL preview
The generated script shown as editable text before it is applied. *Owner: II-14.*

<a id="ddl-scope"></a>
### DDL scope
How far a DDL statement reaches: `Object`, `Database` (schema list changes) or `Temporary` (no catalog change). Deeper: drives catalog invalidation and `HasTempObjects`. *Owner: II-08.*

<a id="ddl-scripter"></a>
### DDL scripter
`IDdlScripter`: a pure per-provider component that turns a table model (or the diff of two) into DDL statements. *Owner: II-14.*

<a id="dead-tuple"></a>
### dead tuple — تاپل مرده
A PostgreSQL row version no snapshot can see any more. Deeper: occupies space until VACUUM removes it. *Owner: I-10.*

<a id="deadlock"></a>
### deadlock — بن‌بست
A cycle of transactions each waiting for a lock another holds. Deeper: detected by the engine and broken by rolling back a victim; prevent with consistent access order. *Owner: I-10.*

<a id="deadlock-graph"></a>
### deadlock graph — گراف بن‌بست
The engine's report of the processes and resources in a deadlock. Deeper: SQL Server `xml_deadlock_report` in `system_health`; InnoDB `LATEST DETECTED DEADLOCK`. *Owner: I-10.*

<a id="deadlock-victim"></a>
### deadlock victim — قربانی بن‌بست
The transaction the engine rolls back to break a deadlock. Deeper: SQL Server error 1205, PostgreSQL 40P01, MySQL 1213; retry it. *Owner: I-10.*

<a id="decoration"></a>
### decoration
A visual mark on editor text (a highlight, an inline hint) that is not part of the text. Rowlit uses them for the run flash and the parameter hint. *Owner: II-12.*

<a id="dedicated-connection"></a>
### dedicated connection (Redis)
A separate Redis connection opened for one job instead of the shared multiplexer. `RawRedisConnection` speaks RESP2 directly and is used for MONITOR, MULTI/EXEC/WATCH batches and blocking commands, which would otherwise hold the shared pipe for everyone. *Owner: II-17.*

<a id="default-interface-member"></a>
### default interface member
A C# interface member with a body, so adding it does not break implementers. Deeper: how `IDbSession` gained schema members, `LostTransaction` and `FindUnboundParameter`. *Owner: II-07.*

<a id="default-schema"></a>
### default schema
The schema used when a name is not qualified. The engine reports one per database; some dialects also let a session change it. *Owner: II-10.*

<a id="default-value"></a>
### DEFAULT — مقدار پیش‌فرض
The value a column receives when an `INSERT` omits it, for example `qty DEFAULT 1`. *Owner: I-05.*

<a id="defence-in-depth"></a>
### defence in depth
Using several independent protections so one failure is not fatal. Deeper: authentication, authorisation, encryption, injection defence and audit each cover what the others miss. *Owner: I-14.*

<a id="delayed-durability"></a>
### delayed durability — ماندگاری تأخیری
SQL Server option to return from COMMIT before the log flush. Deeper: faster commits; a crash can lose the latest ones. *Owner: I-11.*

<a id="delimiter"></a>
### DELIMITER
A `mysql` client command that changes the statement terminator so procedure bodies with `;` stay whole. Deeper: Rowlit's MySQL splitter honours it; the server never sees it. *Owner: II-09.*

<a id="denormalisation"></a>
### denormalisation — غیرنرمال‌سازی
Adding redundancy to a normalised design on purpose, for historical accuracy, read speed or because the engine has no joins. It needs a stated way to keep the copies consistent. *Owner: I-05.* See also: normal form.

<a id="density"></a>
### density — چگالی (density)
SQL Server statistics term: 1 / number of distinct values, the average selectivity of an equality on that column or column prefix. Used when the actual value is unknown. *Owner: I-07.* See also: selectivity, histogram.

<a id="dependency"></a>
### dependency (uses / used by)
A relation between objects: a view *uses* a table, a trigger is *used by* a table. The engine returns one level of both directions. *Owner: II-10.*

<a id="dependency-injection"></a>
### dependency injection
A container builds objects and hands each the dependencies it declares, instead of classes creating them. *Owner: II-05.* See also: singleton, keyed service.

<a id="dependency-inversion"></a>
### dependency inversion
The inner, higher-level code declares the interface it needs and the outer code implements it. Deeper: applied at Rowlit's driver edge (`IDbProvider`, `ITunnelResolver`). *Owner: II-03.* See also: SOLID.

<a id="dependency-rule"></a>
### dependency rule
Clean architecture's rule that source dependencies point only inward. Deeper: holds for Core versus providers; not for Core versus ASP.NET. *Owner: II-03.*

<a id="derived-table"></a>
### derived table — جدول مشتق‌شده
A subquery used in the `FROM` clause as if it were a table; it needs an alias. *Owner: I-04.* See also: CTE.

<a id="describe"></a>
### describe
Getting a query's result columns without running it (`SchemaOnly | KeyInfo`). Deeper: also decides whether a result is editable. *Owner: II-08.*

<a id="design-token"></a>
### design token
A named design value, here a CSS custom property such as `--bg-panel`. Colours are written only in the theme files. *Owner: II-20.*

<a id="designer"></a>
### designer
A form-based editor for a table, view or routine that produces DDL instead of requiring hand-written SQL. *Owner: II-14.*

<a id="designer-database"></a>
### designer database
`IDesignerDatabase`: the I/O side of the designer. It reads models and applies scripts on its own short-lived connection. *Owner: II-14.*

<a id="destructive-statement"></a>
### destructive statement
DELETE/UPDATE without WHERE, DROP or TRUNCATE. Deeper: the UI asks before running one; read-only connections are guarded in the engine. *Owner: II-08.*

<a id="detached-window"></a>
### detached window
A second Electron window that shows tabs moved out of the main window. It runs its own copy of the UI. *Owner: II-20.*

<a id="dev-token"></a>
### dev token — dev token
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="dev-tools-console"></a>
### Dev Tools console
A text editor in which you type raw REST requests (`GET /_cat/indices`) followed by JSON bodies and run them against the cluster, as in Kibana. Rowlit sanitises the path, limits the methods, cuts answers at 5 MB and, on read-only connections, allows only GET/HEAD and the POST APIs that read. *Owner: II-18.*

<a id="development-server"></a>
### development server — development server
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="diagnostic"></a>
### diagnostic
A problem found in the source text, with a range, a severity (error, warning, info), a code and a message. The editor shows diagnostics as markers; in Rowlit they come from the IntelliSense (soft), the engine (server) or the last run. *Owner: II-11.*

<a id="dialect"></a>
### dialect
One engine's variant of SQL. Deeper: differences in spelling, semantics and capability. *Owner: I-17.*

<a id="dialect-info"></a>
### dialect info
`DialectInfo`, a static table of per-dialect traits (database level, quoting, comment and string syntax). Deeper: lets Core switch on traits instead of dialect names. *Owner: II-09.*

<a id="dialect-spec"></a>
### dialect spec
The data object that teaches the IntelliSense one SQL dialect (`DialectSpec`): keywords, statement starts, data types, function catalog, quoting, case folding, batch separator, keyword lists per position and optional hooks (lexer traits, splitter, classifier, completion source, formatter rules). The lexer, splitter, parser, completer and formatter all read it. *Owner: II-11.*

<a id="dictionary-clickhouse"></a>
### dictionary (ClickHouse)
An in-memory key-to-attributes table refreshed from a source, read with `dictGet`. Deeper: replaces joins for small lookups; layouts such as `FLAT`. *Owner: I-15.*

<a id="differential-backup"></a>
### differential backup — پشتیبان تفاضلی
Pages changed since the last full backup. Deeper: restore = full + latest differential. *Owner: I-12.*

<a id="dirty-page"></a>
### dirty page — صفحهٔ کثیف (dirty page)
A page modified in the buffer pool but not yet written to the data file. It is flushed later by background writers or checkpoints, always after its log records are durable. *Owner: I-06.* See also: buffer pool, checkpoint, WAL.

<a id="dirty-read"></a>
### dirty read — خواندن کثیف
Reading another transaction's uncommitted change. Deeper: possible only at READ UNCOMMITTED / NOLOCK in SQL Server and MySQL. *Owner: I-09.*

<a id="distinct"></a>
### DISTINCT — حذف تکراری‌ها
A `SELECT` option that removes duplicate rows from the result. It applies to the whole row. *Owner: I-03.*

<a id="dmg"></a>
### DMG — تصویر دیسک macOS
A macOS disk-image package used to distribute an application. *Owner: II-24.*

<a id="dml"></a>
### DML — DML
Data Manipulation Language: statements that change rows (`INSERT`, `UPDATE`, `DELETE`, `MERGE`). *Owner: I-03.*

<a id="dmv"></a>
### DMV (dynamic management view) — نمای مدیریتی پویا (DMV)
SQL Server `sys.dm_*` views of live and cumulative server state. Deeper: reset at restart; plan-cache based ones forget evicted statements. *Owner: I-13.*

<a id="dock"></a>
### dock — dock
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="docker-compose"></a>
### Docker Compose — Docker Compose
A tool that starts several containers from one YAML file. Rowlit's repository uses it to start the sample database servers (`engine/tests/docker/compose.yml`, project `dbstudio-it`). *Owner: I-18.*

<a id="document-store"></a>
### document store
A database of nested JSON-like documents. Deeper: MongoDB; embed or reference. *Owner: I-16.*

<a id="domain"></a>
### domain — دامنه
The set of values an attribute may take. In SQL it is approximated by a data type plus constraints; PostgreSQL also has `CREATE DOMAIN`. *Owner: I-02.*

<a id="dotnet-run"></a>
### dotnet run — dotnet run
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="double-buffering"></a>
### double buffering — بافرگذاری دوگانه (double buffering)
The same page cached twice, in the database's buffer pool and in the operating-system page cache. PostgreSQL relies on it; engines using direct I/O avoid it. *Owner: I-06.* See also: buffer pool.

<a id="doublewrite-buffer"></a>
### doublewrite buffer — بافر نوشتن دوگانه
InnoDB area where pages are written and synced before their real location. Deeper: repairs torn pages after a crash. *Owner: I-11.*

<a id="dpapi"></a>
### dpapi — dpapi
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="dql"></a>
### DQL — DQL
Data Query Language: the `SELECT` statement (some authors count it as DML). *Owner: I-03.*

<a id="drain"></a>
### drain
Reading and discarding the rest of a result set after the row cap so later result sets can be read. *Owner: II-08.* See also: MaxRows, truncation.

<a id="driver"></a>
### driver — درایور
A library inside the application that speaks a DBMS's wire protocol: it sends SQL, receives rows. JDBC, ODBC, ADO.NET, `psycopg` are drivers or driver standards. *Owner: I-01.* See also: wire protocol.

<a id="dropped-items"></a>
### dropped items
Stream items a stream had to skip, reported as `dropped` on `stream.data`. *Owner: II-06.*

<a id="dry-run"></a>
### dry run
Running an operation in preview mode: it computes and shows what would change without changing anything. Rowlit's Kafka offset reset always allows a dry run, even on a read-only connection, and its dialog shows the from/to table before you apply. *Owner: II-18.*

<a id="dto"></a>
### DTO
Data transfer object: a plain record that only carries data across a boundary. *Owner: II-05.*

<a id="duckdb"></a>
### DuckDB
An embedded, in-process analytical SQL database with a columnar, vectorised engine (MIT licence). Rowlit runs one locked-down in-memory DuckDB per linked console session as its federation engine (DuckDB.NET, DuckDB v1.5.6 at WP0). *Owner: II-16.* See also: DuckDB SQL (I-17).

<a id="duckdb-sql"></a>
### DuckDB SQL
The PostgreSQL-style dialect of the embedded analytic engine DuckDB. Deeper: used inside Rowlit for linked databases. *Owner: I-17.*

<a id="durability"></a>
### durability — ماندگاری
A committed change survives crashes and power loss. Deeper: kept by flushing the WAL at commit. *Owner: I-09.*

<a id="edit-console"></a>
### edit console
A console opened by F4 on a procedure, view, trigger and similar objects, holding a re-runnable `CREATE OR ALTER/REPLACE` script. Ctrl+S applies it to the database. *Owner: II-14.*

<a id="editor-group"></a>
### editor group
One tab strip with its own active tab. Up to three groups can be split side by side or stacked. *Owner: II-20.*

<a id="electron"></a>
### electron — electron
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="electron-fuses"></a>
### electron fuses — electron fuses
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="electron-updater"></a>
### electron updater — electron updater
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="embedded-database"></a>
### embedded database — پایگاه داده توکار
A DBMS delivered as a library linked into the application, with the database in a file the process opens directly. SQLite and DuckDB are examples. No server, no network, one process writes at a time. *Owner: I-01.* See also: client/server.

<a id="encrypt-trustservercertificate"></a>
### Encrypt / TrustServerCertificate
SQL Server connection options: `Encrypt` (Optional, Mandatory, Strict) chooses encryption; `TrustServerCertificate=true` skips certificate validation. Deeper: Strict is TDS 8.0, TLS before the first protocol byte. *Owner: I-14.*

<a id="endpoint"></a>
### endpoint
One HTTP method plus path and the code that answers it. *Owner: II-05.* See also: route group.

<a id="engine-module"></a>
### engine module
A class implementing `IEngineModule { ConfigureServices; MapEndpoints }`, the composition root of one feature package. Deeper: 17 are discovered at start-up. *Owner: II-07.*

<a id="engine-name"></a>
### engine name (wide member)
The single table name a nested table of a wide member gets inside the federation engine: the parts below the alias joined with dots, defaults left out (`crm.sales.orders` → `crm."sales.orders"`). `LinkNames.Rewrite` turns user SQL into engine names before analysis. *Owner: II-16.*

<a id="entitlements"></a>
### entitlements — entitlements
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="environment-variable"></a>
### environment variable — environment variable
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="er-diagram"></a>
### ER diagram — نمودار موجودیت-ارتباط
Entity-relationship diagram: a picture of tables (entities) and the foreign-key relationships between them, with cardinality marked at the line ends. *Owner: I-02.* See also: crow's foot.

<a id="error-boundary"></a>
### error boundary
A React component that catches render errors in its subtree and shows a panel instead of unmounting the app. *Owner: II-20.*

<a id="error-code"></a>
### error code
The machine-readable `code` of an error (`TX_OPEN`, `READ_ONLY`, `SSH_TUNNEL`…). *Owner: II-05.* See also: error envelope.

<a id="error-envelope"></a>
### error envelope
The single error body shape `{"error":{"code","message","detail"}}` of every non-2xx answer. *Owner: II-05.*

<a id="error-report"></a>
### error report
The CSV of rows an import could not write, with row number, column and message. Served by `GET /import/errors/{jobId}`. *Owner: II-15.*

<a id="error-tolerant-parsing"></a>
### error-tolerant parsing
Parsing that keeps going on invalid input and returns the best structure it can instead of an error. An editor needs it because a statement is always incomplete while you type; Rowlit's partial parser guarantees progress on every token and catches its own failures. *Owner: II-11.*

<a id="esbuild"></a>
### esbuild — esbuild
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="esr-rule"></a>
### ESR rule — قاعدهٔ ESR
MongoDB's guidance for compound index field order: Equality fields, then Sort fields, then Range fields. The same rule applies to B-tree composite indexes in relational engines. *Owner: I-07.* See also: composite index.

<a id="estimated-plan"></a>
### estimated plan — طرح تخمینی (estimated plan)
The plan the optimizer would use, with its estimates, produced without running the statement (`EXPLAIN`, `SHOWPLAN_XML`, `EXPLAIN PLAN`). Safe for any statement but cannot show wrong estimates. *Owner: I-08.* See also: actual plan.

<a id="estimated-vs-actual-plan"></a>
### estimated / actual plan
An estimated plan is the optimiser's choice without running the statement. An actual plan runs it and adds real row counts and timings. *Owner: II-15.*

<a id="etag"></a>
### ETag
A short tag that identifies a version of a response. Rowlit's is a hash of connection, database, versions and schema names, prefixed by a per-start epoch. *Owner: II-10.*

<a id="event"></a>
### event
A small JSON message with a `type` and `ts` pushed from engine to UI over the WebSocket. *Owner: II-06.*

<a id="event-log"></a>
### event log
An append-only, ordered, replayable sequence of events. Deeper: Kafka. *Owner: I-16.*

<a id="event-types"></a>
### event types
The `type` strings of `Core/Services/Events.cs`: `exec.*`, `session.changed`, `catalog.changed`, `stream.*`, `job.*`, `resources.*`, `export.*`, `engine.log`, `auth.ok`, `pong`. *Owner: II-06.*

<a id="eventual-consistency"></a>
### eventual consistency — سازگاری نهایی
If writes stop, replicas eventually converge; reads in between may be stale. *Owner: I-12.*

<a id="exact-decimal"></a>
### exact decimal
`ExactDecimal`, a parameter value kept as text because `System.Decimal` cannot hold it (at most 20 000 digits). *Owner: II-08.*

<a id="exclusive-lock"></a>
### exclusive lock (X) — قفل انحصاری
Lock for writing; incompatible with every other mode. *Owner: I-10.*

<a id="execute-routine-dialog"></a>
### execute routine dialog
The dialog that calls a procedure or function with typed parameters, all passed as bind values, and shows OUT values and result sets. *Owner: II-14.*

<a id="execution-id"></a>
### execution id
The `x…` id returned by `POST /execute` that ties every `exec.*` event to one run. *Owner: II-08.*

<a id="execution-label"></a>
### execution label
Why a run happened: `statement`, `selection`, `script`, `filter`, `data`, `multi`, `explain`. *Owner: II-08.*

<a id="explain"></a>
### EXPLAIN — EXPLAIN
The command family that shows a query plan: `EXPLAIN [ANALYZE]` (PostgreSQL, MySQL), `SET SHOWPLAN_XML`/`STATISTICS XML` (SQL Server), `EXPLAIN PLAN` + `DBMS_XPLAN` (Oracle), `EXPLAIN QUERY PLAN` (SQLite), `EXPLAIN PLAN/PIPELINE` (ClickHouse), `EXPLAIN USING` (Snowflake). Cassandra has none. *Owner: I-08.* See also: estimated plan, actual plan.

<a id="explain-mongo"></a>
### explain (Mongo)
MongoDB's description of how it will run (or ran) a find or an aggregate: which index, how many keys and documents examined. Rowlit normalises the classic, SBE and sharded shapes into the same `PlanNode` tree as relational plans and adds warnings for collection scans and in-memory sorts. *Owner: II-17.*

<a id="explain-sampling"></a>
### EXPLAIN sampling (links)
A plain `EXPLAIN` on a link reads at most 1,000 rows per source, because a plan needs no data. The inner query is still analysed, so the plan shows the real push-down; `EXPLAIN ANALYZE` reads normally. *Owner: II-16.*

<a id="explorer"></a>
### explorer — explorer
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="explorer-node"></a>
### explorer node
One row of the explorer tree with a stable string id (`c:`, `d:`, `s:`, `f:`, `o:`, `sq:` prefixes). *Owner: II-10.*

<a id="export-scope"></a>
### export scope
What an export writes: `loaded`, `selection`, `filtered`, `all` or `rerun`. The last three run a fresh query in the engine with no row cap. *Owner: II-15.*

<a id="expression"></a>
### expression — عبارت
Anything that evaluates to a value: a column, a literal, arithmetic, a function call, `CASE`. *Owner: I-03.*

<a id="expression-index"></a>
### expression index — نمایهٔ عبارتی (expression index)
An index on the result of an expression such as `lower(name)` (Oracle: function-based index; MySQL: functional key part). A query can use it only with the identical expression; the function must be deterministic. *Owner: I-07.* See also: SARGable.

<a id="extended-json"></a>
### Extended JSON
A text form of BSON that preserves types (`{"$oid": …}`, `{"$numberLong": …}`). Deeper: canonical and relaxed modes. *Owner: I-16.*

<a id="extent"></a>
### extent — اکستنت (extent)
A run of consecutive pages allocated together: 8 pages (64 KB) in SQL Server, 1 MB in InnoDB, tablespace-dependent in Oracle. *Owner: I-06.* See also: page, tablespace.

<a id="fact-dimension-table"></a>
### fact / dimension table
A fact table holds measurable events; dimension tables describe their context. Deeper: define the grain first; use surrogate keys and slowly changing dimensions. *Owner: I-15.*

<a id="failover"></a>
### failover — جابه‌جایی خودکار (failover)
Promoting a replica to primary when the primary fails. Deeper: needs failure detection, choice of the new primary and fencing of the old one. *Owner: I-12.*

<a id="fake"></a>
### fake — fake
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="fake-engine"></a>
### fake engine — fake engine
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="fan-out"></a>
### fan-out — ضریب انشعاب (fan-out)
The number of child pointers an internal B+tree page holds, typically hundreds. High fan-out keeps trees shallow: height grows with log base fan-out of the row count. *Owner: I-07.* See also: index height.

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

<a id="fencing"></a>
### fencing — حصارکشی (fencing)
Actively stopping an old primary from accepting writes. Deeper: STONITH, storage revocation, leases; prevents split brain. *Owner: I-12.*

<a id="fetch-relay"></a>
### fetch relay
The engine object that ties one Kafka browse job to its `kafka.fetch` stream: a one-time token, a sink the job waits for, and a cancellation that fires when the stream closes. It lets messages flow on a stream while progress and the result flow on the job. *Owner: II-18.*

<a id="fetch-request"></a>
### fetch request
What one source is asked for (`FetchRequest`): the table, the projection (never empty), conjunctive predicates, an optional limit, the row cap and a timeout. A fetcher's `Accept` may remove predicates it cannot render, and must then remove the limit too. *Owner: II-16.*

<a id="fill-factor"></a>
### fill factor — ضریب پرشدگی (fill factor)
The percentage of a page filled when it is built or rebuilt, leaving the rest for later inserts and updates (Oracle: PCTFREE, the percentage kept free). Lower values mean fewer splits and more HOT updates but more pages to read. *Owner: I-06.* See also: PCTFREE, page split.

<a id="filtered-index"></a>
### filtered index — نمایهٔ فیلترشده (filtered index)
SQL Server's partial index: `CREATE INDEX … WHERE <simple predicate>`. Cannot be used by a parameterised predicate whose value is unknown at compile time. *Owner: I-07.* See also: partial index.

<a id="find-in-database"></a>
### Find in database
Search of object names, columns, code and optionally table data across connections, streamed as `db.search`. *Owner: II-10.*

<a id="fixture"></a>
### fixture — fixture
A fixed, known data set (or the code that creates it) used in tests and examples. The `shop` seeds are the handbook's fixture. *Owner: I-18.* See also: seed.

<a id="fk-join-suggestion"></a>
### FK join suggestion
A completion after `JOIN` that offers the tables linked by a foreign key to a table already in the query, plus a ready snippet such as `orders o ON o.customer_id = c.id`. Rowlit builds it from the catalog's foreign-key graph, joins composite keys with `AND` and generates a unique alias. *Owner: II-11.*

<a id="font-zoom"></a>
### font zoom
Changing the editor font size with Ctrl + wheel (9 to 32 px) without touching the whole-window zoom. *Owner: II-12.*

<a id="foreign-catalog"></a>
### foreign catalog
The cached catalog of *another* database of the same server, used by IntelliSense for names such as `Other.dbo.Orders`. *Owner: II-10.*

<a id="foreign-key"></a>
### foreign key — کلید خارجی
Columns in one table whose values must match a key in another table (or be NULL). It links rows and is enforced as referential integrity. *Owner: I-02.* See also: referential integrity.

<a id="form-spec"></a>
### form spec
`ConnectionFormSpec`: a provider's list of field descriptions that the generic connection dialog renders. *Owner: II-08.*

<a id="format-options"></a>
### format options
`settings.format`: keyword and identifier case, indent, comma style, line width, blank lines. Validated and clamped by `resolveFormatOptions`. *Owner: II-12.*

<a id="formatted-ddl"></a>
### formatted DDL
The object tab's DDL shown through the formatter, with a toggle to see the stored text. *Owner: II-12.*

<a id="formatter"></a>
### formatter
Code that rewrites SQL layout without changing meaning. Rowlit's is token-based and verified by a token-equality check. *Owner: II-12.*

<a id="forwarded-record"></a>
### forwarded record — رکورد ارجاعی (forwarded record)
A row in a SQL Server heap that moved to another page because it grew, leaving a forwarding stub at its old RID. Reads through the stub cost an extra page read; rebuilding the heap removes them. *Owner: I-06.* See also: row chaining.

<a id="fragmentation"></a>
### fragmentation — چندپارگی (fragmentation)
Logical fragmentation: index pages whose key order differs from their file order. Internal fragmentation: pages emptier than needed. On SSDs page density matters more than order. *Owner: I-07.* See also: index bloat, rebuild / reorganize.

<a id="frame"></a>
### frame — قاب
The part of a window partition that a window function sees for the current row, such as `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW`. With `ORDER BY` and no frame, the default is `RANGE ... UNBOUNDED PRECEDING AND CURRENT ROW`. *Owner: I-04.* See also: window function.

<a id="free-space-map"></a>
### free space map — نقشهٔ فضای آزاد (free space map)
A structure that records roughly how much free space each page has, so inserts find room without reading pages (PostgreSQL `_fsm` fork, SQL Server PFS pages). *Owner: I-06.* See also: fill factor.

<a id="freezing"></a>
### freezing — منجمدسازی (freezing)
PostgreSQL marking old tuples as visible to everyone regardless of transaction id. Deeper: prevents transaction id wraparound. *Owner: I-10.*

<a id="fsync"></a>
### fsync — fsync
System call that returns only when data reached the storage device. Deeper: the one synchronous I/O on the commit path. *Owner: I-11.*

<a id="full-backup"></a>
### full backup — پشتیبان کامل
A copy of the whole database. *Owner: I-12.*

<a id="full-page-write"></a>
### full page write — نوشتن صفحهٔ کامل
PostgreSQL logging the whole page image at its first change after a checkpoint. Deeper: protects against torn pages; shows as `fpi` in `EXPLAIN (WAL)`. *Owner: I-11.*

<a id="full-text-index"></a>
### full-text index — نمایهٔ تمام‌متن (full-text index)
An inverted index over words produced by an analyzer, answering word and phrase queries (`tsvector` + GIN, SQL Server full-text, MySQL `FULLTEXT`, Oracle Text, SQLite FTS5). *Owner: I-07.* See also: inverted index, GIN.

<a id="function"></a>
### function — تابع
Stored code that returns a value (scalar) or a table and can be used inside a query. Written in the engine's procedural language. *Owner: I-04.* See also: stored procedure.

<a id="functional-dependency"></a>
### functional dependency — وابستگی تابعی
`A → B`: for each value of A there is exactly one value of B. Dependencies are business facts; normal forms are rules about them. *Owner: I-05.*

<a id="fuzzy-checkpoint"></a>
### fuzzy checkpoint — checkpoint فازی
A checkpoint that runs while transactions continue. Deeper: recovery starts at the redo point remembered at its start. *Owner: I-11.*

<a id="fuzzy-filter"></a>
### fuzzy filter
Matching where the typed letters need only appear in order (`ordl` finds `order_lines`), ranked by word starts and contiguity. *Owner: II-10.*

<a id="gap-lock"></a>
### gap lock — قفل شکاف
InnoDB lock on the space between index records that blocks inserts there. Deeper: used at REPEATABLE READ; gap locks never conflict with each other. *Owner: I-10.*

<a id="gate"></a>
### gate — gate
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="gatekeeper"></a>
### gatekeeper — gatekeeper
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="gateway"></a>
### gateway
In Rowlit's Snowflake provider, `ISnowflakeGateway`: a small seam over one pooled connection used for catalog and module calls, replaced by a fake in tests. *Owner: II-09.*

<a id="gateway-seam"></a>
### gateway seam
One interface at the edge of a package through which all calls to an external system pass, so a real and a fake backend can be swapped. `IMongoGateway` is implemented by `DriverMongoGateway` (MongoDB.Driver) and by the in-memory `MongoFake` used in unit tests. *Owner: II-17.*

<a id="gc-heap"></a>
### gc heap — gc heap
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="generic-plan"></a>
### generic plan — طرح عمومی (generic plan)
A PostgreSQL plan for a prepared statement built without parameter values, reused for every execution; custom plans are built per execution with the values. `plan_cache_mode` chooses. *Owner: I-08.* See also: prepared statement, parameter sniffing.

<a id="generic-stand-in"></a>
### generic stand-in
The temporary dialect spec used until a lazily loaded dialect has arrived: the SQLite tables under the real dialect id. It lets every code path keep working (and keep seeing `'mysql'`, `'cql'`...) while the chunk loads, and is also the fallback if the chunk fails. *Owner: II-11.*

<a id="get-ddl"></a>
### GET_DDL
Snowflake (and Oracle `DBMS_METADATA.GET_DDL`) function returning an object's DDL text. *Owner: II-09.*

<a id="ghost-card"></a>
### ghost card
A name-only table card in the ER diagram for a table that a foreign key points to but that is not part of the diagram. *Owner: II-15.*

<a id="gin"></a>
### GIN — نمایهٔ معکوس عمومی (GIN)
PostgreSQL's generalized inverted index: one entry per element (array member, JSON key, word, trigram) pointing to every row that contains it. Ideal for `@>`, `?`, full-text and `pg_trgm`; writes are expensive. *Owner: I-07.* See also: inverted index.

<a id="gist"></a>
### GiST — درخت جست‌وجوی عمومی (GiST)
PostgreSQL's generalized search tree: a balanced tree of bounding predicates for geometry, ranges, nearest-neighbour search and exclusion constraints. *Owner: I-07.* See also: SP-GiST.

<a id="go"></a>
### GO
The SQL Server batch separator of SSMS and `sqlcmd`, optionally `GO n`. Deeper: variables do not cross it. *Owner: I-17.*

<a id="go-to-definition"></a>
### go to definition
Jumping from a name to where it is defined (F12 or Ctrl+click). Local names (aliases, CTEs, variables, temp tables) jump inside the editor; catalog objects open their Data tab or definition; Alt+F12 always opens the DDL. *Owner: II-11.*

<a id="golden-file"></a>
### golden file — golden file
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="golden-test"></a>
### golden test
A test that compares output with a stored expected file. The builder's goldens (`Goldens/Builder/*.json`: catalog, model, SQL, params, warnings) are run by both the C# and the TypeScript compiler, which keeps them identical. *Owner: II-16.* See also: golden file (II-23).

<a id="graceful-shutdown"></a>
### graceful shutdown
Stopping new work, finishing or cancelling current work and releasing resources before exit. Deeper: the engine disposes resources, sessions, streams, jobs and source clients in that order with bounded waits. *Owner: II-05.*

<a id="grant-revoke"></a>
### GRANT / REVOKE
`GRANT` gives a privilege, `REVOKE` removes it. Deeper: SQL Server also has `DENY`, which overrides `GRANT`; `WITH GRANT OPTION` lets the grantee pass it on. *Owner: I-14.*

<a id="granule"></a>
### granule
The unit of ClickHouse's sparse index: by default 8,192 rows. Deeper: a query reads whole granules. *Owner: I-15.*

<a id="grid-controller"></a>
### grid controller
An imperative handle each grid registers by key so commands can act on the focused grid. *Owner: II-13.*

<a id="group-by"></a>
### GROUP BY — گروه‌بندی
A clause that forms one group per distinct combination of the listed columns so aggregates are computed per group. Every selected column must be grouped or aggregated. *Owner: I-03.*

<a id="group-commit"></a>
### group commit — commit گروهی
Several commits made durable by one log flush. Deeper: raises throughput under load. *Owner: I-11.*

<a id="handshake"></a>
### handshake — handshake
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="hardened-runtime"></a>
### hardened runtime — hardened runtime
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="hash-index"></a>
### hash index — نمایهٔ هش (hash index)
An index that places entries in buckets by a hash of the key; it answers equality only, with no order or ranges (PostgreSQL `USING hash`, MEMORY engine, SQL Server memory-optimized tables). *Owner: I-07.* See also: hash join.

<a id="hash-join"></a>
### hash join — پیوند هش (hash join)
Join algorithm that builds a hash table from one input and probes it with each row of the other. Linear cost for large unsorted inputs, equality only, needs memory and may spill. *Owner: I-08.* See also: build side, probe side.

<a id="hash-slot"></a>
### hash slot
One of 16,384 buckets: `CRC16(key) mod 16384`. Deeper: hash tags `{…}` keep related keys together. *Owner: I-16.*

<a id="hash-tag"></a>
### hash tag
The text inside `{…}` of a Redis key, the only part hashed to find the slot. Deeper: keeps related keys on one node. *Owner: I-16.*

<a id="having"></a>
### HAVING — HAVING
A clause that filters groups after aggregation, unlike `WHERE`, which filters rows before. *Owner: I-03.*

<a id="head-blocker"></a>
### head blocker — مسدودکنندهٔ سرِ زنجیره
The session at the start of a blocking chain, itself not waiting for a lock. *Owner: I-10.*

<a id="health-check"></a>
### health check
A cheap endpoint that only reports "up": `GET /api/v1/health` (token required). *Owner: II-05.*

<a id="heap"></a>
### heap — هیپ (heap)
A table stored without any key order: rows go wherever there is free space and are found by physical address. PostgreSQL tables and Oracle tables by default are heaps. *Owner: I-06.* See also: clustered index, RID.

<a id="hexagonal-architecture"></a>
### hexagonal architecture
Alistair Cockburn's ports-and-adapters style: the core talks to the world only through ports it owns. Deeper: Rowlit's provider boundary resembles it without using the name. *Owner: II-03.* See also: ports and adapters.

<a id="hint"></a>
### hint — راهنمای بهینه‌ساز (hint)
An instruction in the query that overrides one optimizer decision (join method, index, order, parallelism). It freezes today's choice; plan guides and baselines attach hints without changing query text. *Owner: I-08.* See also: plan cache.

<a id="histogram"></a>
### histogram — هیستوگرام (histogram)
Statistics that cut a column's sorted values into buckets (equi-depth in PostgreSQL, up to 200 steps in SQL Server, several kinds in Oracle) to estimate ranges and non-common values. *Owner: I-07.* See also: statistics, most common values.

<a id="history"></a>
### history
The engine's log of every execution in `history.db`, with full-text search and pinning. *Owner: II-08.*

<a id="history-list-length"></a>
### history list length — طول فهرست تاریخچه
InnoDB's count of undo log records not yet purged. Deeper: a steadily rising value means a long transaction blocks purge. *Owner: I-10.*

<a id="hmr"></a>
### hmr — hmr
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="hook"></a>
### hook
A React function starting with `use` that adds state or effects to a component, such as `useState` or `useCatalog`. *Owner: II-20.*

<a id="host-key-fingerprint"></a>
### host key fingerprint
A short hash (SHA-256) of an SSH server's public key, used to recognise the server. *Owner: II-08.* See also: known hosts.

<a id="hosted-service"></a>
### hosted service
A background task the .NET host starts and stops with the app (`BackgroundService`); e.g. `ParentWatchdog`. *Owner: II-05.*

<a id="hot-reload"></a>
### hot reload — hot reload
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="hot-update"></a>
### HOT update — به‌روزرسانی HOT
PostgreSQL heap-only tuple update: when no indexed column changes and the page has room, the new row version stays on the same page and no index entry is added. Free space from a lower fill factor makes it possible. *Owner: I-06.* See also: fill factor.

<a id="hover"></a>
### hover
The card that appears when the mouse rests on a name. Rowlit shows an object's type, comment, columns with PK/FK badges (first 25), a routine's signature or a column's type and keys, as untrusted Markdown. *Owner: II-11.*

<a id="htap"></a>
### HTAP
Hybrid transactional and analytical processing: one system serves both. Deeper: usually two copies of the data (row and column) kept in sync. *Owner: I-15.*

<a id="http-session"></a>
### HTTP session
ClickHouse's `session_id` mechanism that gives stateless HTTP requests shared server state. Deeper: each Rowlit console is one. *Owner: II-09.*

<a id="ide"></a>
### IDE — محیط توسعهٔ یکپارچه
A client that combines editing, navigation, diagnostics and task-specific tools in one workspace. *Owner: II-01.*

<a id="identifier-rules"></a>
### identifier rules
`IdentifierRules(quoteOpen, quoteClose, caseFolding, reservedWords)`: how a provider quotes and folds names. *Owner: II-09.*

<a id="identity"></a>
### identity column — ستون هویت
A column that generates its own values from an internal sequence (`GENERATED ... AS IDENTITY`, `IDENTITY(1,1)`, `AUTO_INCREMENT`). *Owner: I-04.* See also: sequence.

<a id="identity-column"></a>
### identity column
A standard-SQL column whose values are generated. Deeper: `GENERATED … AS IDENTITY`; SQL Server `IDENTITY(1,1)`. *Owner: I-17 (also I-04).*

<a id="idle-ping"></a>
### idle ping
The engine's `SELECT 1` every 60 s on sessions idle for 30 s, to detect dead connections early. *Owner: II-08.*

<a id="idle-reaper"></a>
### idle reaper
A timer that closes resources nobody used for a while. `SourceClientManager` checks every 30 s and closes source clients idle longer than `connections.sourceIdleSeconds` (default 600) unless a lease is held; the resource manager shortens the limit under memory pressure. *Owner: II-17.*

<a id="idle-timeout"></a>
### idle timeout — idle timeout
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="implicit-commit"></a>
### implicit commit — commit ضمنی
A commit the engine performs on its own, for example around DDL in Oracle and MySQL. *Owner: I-09.*

<a id="implicit-conversion"></a>
### implicit conversion — تبدیل ضمنی
The engine converting one side of a comparison to the other's type. Deeper: if the column is converted the predicate is no longer SARGable (SQL Server `CONVERT_IMPLICIT`). *Owner: I-13.*

<a id="import-dialect"></a>
### import dialect
`ImportDialect`: per-engine import knowledge: quoting, types, `CREATE TABLE`, upsert syntax, savepoints, bulk method. *Owner: II-15.*

<a id="import-wizard"></a>
### Import Wizard
The six-step tab (Source, Format, Target, Columns, Options, Run) that loads CSV, TSV, XLSX, JSON and NDJSON files into a table. *Owner: II-15.*

<a id="include-columns"></a>
### INCLUDE columns — ستون‌های INCLUDE
Non-key columns stored only in an index's leaf entries (`INCLUDE (total)`; SQL Server, PostgreSQL 11+). They make the index covering without widening internal pages or affecting uniqueness. *Owner: I-07.* See also: covering index.

<a id="incremental-backup"></a>
### incremental backup — پشتیبان افزایشی
Pages changed since the last backup of any kind. Deeper: PostgreSQL 17 native, Oracle RMAN level 1. *Owner: I-12.*

<a id="incremental-lexing"></a>
### incremental lexing
Re-tokenising only the part of a text around an edit and reusing the rest of the old tokens. Rowlit's `relex` restarts at the start of the edited line and stops as soon as a new token equals a shifted old one; an edit that opens a string may re-lex to the end. *Owner: II-11.*

<a id="index"></a>
### index — نمایه (index)
A separate sorted (or hashed) structure that maps key values to row locations, so queries read a few pages instead of the whole table. Costs space and write work. *Owner: I-07.* See also: B+tree, covering index.

<a id="index-bloat"></a>
### index bloat — آماس نمایه (index bloat)
An index larger than its live entries need, because of half-empty pages and dead entries after updates and deletes. PostgreSQL 13+ deduplication and 14+ bottom-up deletion reduce it; `REINDEX CONCURRENTLY` removes it. *Owner: I-07.* See also: fragmentation.

<a id="index-condition-pushdown"></a>
### index condition pushdown — فروراندن شرط به نمایه (index condition pushdown)
MySQL/InnoDB optimisation that checks conditions on index columns inside the index before fetching the row (`Extra: Using index condition`). It reduces row lookups when a later key column cannot narrow the seek. *Owner: I-07.* See also: residual predicate.

<a id="index-height"></a>
### index height — ارتفاع نمایه (index height)
The number of levels from the root to the leaves of a B+tree; every point lookup reads one page per level. Three or four levels cover tens of millions to billions of keys. *Owner: I-07.* See also: fan-out.

<a id="index-only-scan"></a>
### index-only scan — پویش فقط‌نمایه (index-only scan)
A plan step that answers a query from the index alone. In PostgreSQL it still checks the visibility map and visits heap pages that are not all-visible (`Heap Fetches`). *Owner: I-07.* See also: covering index, visibility map.

<a id="index-organised-table"></a>
### index-organised table — جدول سازمان‌یافته با نمایه (IOT)
Oracle's clustered table (`ORGANIZATION INDEX`): the rows live in the primary-key B-tree. Secondary indexes use logical rowids. *Owner: I-06.* See also: clustered index.

<a id="index-rebuild"></a>
### rebuild / reorganize — بازسازی / سازمان‌دهی مجدد
Index maintenance: a rebuild creates the index again (dense pages, fresh statistics in SQL Server), a reorganize compacts and reorders leaf pages in place (SQL Server, always online). PostgreSQL uses `REINDEX [CONCURRENTLY]`. *Owner: I-07.* See also: fragmentation.

<a id="index-scan"></a>
### index scan — پویش نمایه (index scan)
Reading all or a large part of an index in key order. In PostgreSQL's plan vocabulary `Index Scan` also names a seek with row fetches; SQL Server's `Index Scan` is a full index read. *Owner: I-08.* See also: index seek.

<a id="index-seek"></a>
### index seek — جست‌وجوی نمایه (index seek)
Descending a B+tree from the root to the first qualifying key, then reading forward while keys qualify. The access path for selective SARGable predicates. *Owner: I-08.* See also: seek predicate.

<a id="infomessage"></a>
### InfoMessage
The SqlClient event that carries `PRINT` output and server messages (and, with `FireInfoMessageEventOnUserErrors`, errors). *Owner: II-09.*

<a id="information-schema"></a>
### information_schema
The standard set of metadata views. Deeper: in PostgreSQL, MySQL, SQL Server, Snowflake. *Owner: I-17.*

<a id="instance"></a>
### instance — نمونه
A running copy of the DBMS software with its processes and memory. One machine can run several. In Oracle and SQL Server, databases live inside an instance. *Owner: I-01.*

<a id="integration-test"></a>
### integration test — integration test
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="intellisense"></a>
### IntelliSense
The family of editor helps that understand the code: completion, signature help, hover, go to definition and instant diagnostics. The name comes from Visual Studio; in Rowlit it is the pure TypeScript library `ui/src/intel` working over a cached catalog snapshot, with no database round trip while you type. *Owner: II-11.*

<a id="intent-lock"></a>
### intent lock — قفل نیت
Lock on a container (table, page) announcing locks on its rows (IS, IX, SIX). Deeper: makes table-level lock checks cheap. *Owner: I-10.*

<a id="interesting-order"></a>
### interesting order — ترتیب سودمند (interesting order)
A sort order of an intermediate result that a later operator can use (merge join, `ORDER BY`, `GROUP BY`). Dynamic-programming optimizers keep plans that deliver one even if they are not the cheapest so far. *Owner: I-08.* See also: merge join.

<a id="interface"></a>
### interface
A list of members a type promises to implement, with no implementation (or default members). *Owner: II-09.*

<a id="internal-node"></a>
### internal node — گرهٔ داخلی (internal node)
A non-leaf B+tree page holding separator keys and child pointers; the root is the top internal node. *Owner: I-07.* See also: leaf node.

<a id="interrupt"></a>
### interrupt (engine)
Stopping a running query from another thread. `IFederationEngine.Interrupt` cancels every running DuckDB command; the linked session's cancel also cancels the running fetches' driver commands (about 120 ms in the QA round). *Owner: II-16.*

<a id="inverted-index"></a>
### inverted index — نمایهٔ معکوس (inverted index)
A map from each term or element to the list of rows or documents that contain it; the basis of full-text search, GIN and Elasticsearch. *Owner: I-07 (also used in I-16).* See also: full-text index, GIN.

<a id="ipc"></a>
### ipc — ipc
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="ipc-validation"></a>
### ipc validation — ipc validation
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="isolation"></a>
### isolation — جداسازی
Concurrent transactions do not see each other's partial work, to the degree the isolation level promises. *Owner: I-09.*

<a id="isolation-level"></a>
### isolation level — سطح جداسازی
Setting that decides which anomalies a transaction may observe. Deeper: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE, plus SNAPSHOT. *Owner: I-09.*

<a id="isr"></a>
### ISR (in-sync replicas)
The Kafka replicas that are caught up with the leader. Deeper: `acks=all` waits for the ISR; `min.insync.replicas` sets the floor. *Owner: I-16.*

<a id="job"></a>
### job — job
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="join"></a>
### join — پیوند
An operation that combines rows of two tables that satisfy a condition. Kinds: inner, left/right/full outer, cross, self, natural. In the algebra it is a product followed by a selection. *Owner: I-03.* See also: selection.

<a id="join-inference"></a>
### join inference
The query builder's join suggestions (`infer.ts`): same-source foreign keys (score 100), the link's virtual relations (95), naming conventions (85 or 55) and shared key-like column names (70 or 40). A suggestion of 80 or more joins a new table automatically. *Owner: II-16.*

<a id="join-order"></a>
### join order — ترتیب پیوند (join order)
The sequence in which a plan joins its tables. The search space grows factorially; engines use dynamic programming (PostgreSQL up to 12 relations), Cascades search (SQL Server) or greedy search (MySQL). *Owner: I-08.* See also: left-deep tree.

<a id="journal"></a>
### journal (SQLite) — ژورنال
SQLite's rollback journal: original pages copied aside before change. Deeper: an undo log; modes DELETE, TRUNCATE, PERSIST. *Owner: I-11.*

<a id="jump-host"></a>
### jump host / bastion
A hardened server whose job is to accept SSH logins from outside and reach the private network. *Owner: II-08.* See also: SSH tunnel.

<a id="keep-alive"></a>
### keep-alive
Small periodic messages that keep an idle connection open through firewalls and NAT. Deeper: WebSocket keep-alive every 30 s; SSH keep-alive every 30 s. *Owner: II-06.*

<a id="kerberos"></a>
### Kerberos
A ticket-based network authentication protocol: a key distribution centre issues tickets, so the password never crosses the network. Deeper: tickets are bound to a service principal name (SPN); the "double hop" problem needs constrained delegation. *Owner: I-14.* See also: SSO.

<a id="kestrel"></a>
### Kestrel
ASP.NET Core's built-in HTTP server; the engine binds it to `127.0.0.1` only. *Owner: II-05.*

<a id="key-delimiter"></a>
### key delimiter (Redis)
The character that splits Redis key names into levels, by convention `:` (`user:1001:profile`). Rowlit uses it per connection to build the folder tree of the key browser and the namespaces of the memory analysis. *Owner: II-17.*

<a id="key-lookup"></a>
### key lookup — جست‌وجوی کلید (key lookup)
SQL Server operator that fetches the rest of a row from the clustered index after a nonclustered index seek, once per row. Many executions of it are a sign that a covering index is missing. *Owner: I-07.* See also: RID lookup, covering index.

<a id="key-pair-authentication"></a>
### key-pair authentication
Login by signing a short-lived token with a private key; the server holds the public key. Deeper: Snowflake's `snowflake_jwt`; the private key can be encrypted with a passphrase. *Owner: I-14.*

<a id="key-value-store"></a>
### key-value store
A database mapping a key to a value. Deeper: Redis values have types; access is by key. *Owner: I-16.*

<a id="keychain"></a>
### keychain — keychain
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="keyed-service"></a>
### keyed service
A DI registration with a key, resolved by `GetKeyedService<T>(key)`. Deeper: Rowlit keys per-provider features by provider id and stream factories by stream kind. *Owner: II-05.* See also: provider features.

<a id="keyless-table"></a>
### keyless table
A table with no primary key. Paging it needs a stable order (`rowid`, `ROWID` or ordered columns) and editing needs a row identity. *Owner: II-13.*

<a id="keymap"></a>
### keymap
The effective shortcuts: command defaults plus the user's overrides in `settings.ui.keybindings`. *Owner: II-20.*

<a id="keymap-preset"></a>
### keymap preset
A set of overrides that imitates another tool (JetBrains, VS Code, SSMS). *Owner: II-20.*

<a id="keyset-pagination"></a>
### keyset pagination — صفحه‌بندی کلیدی (keyset)
Fetching the next page with `WHERE key > last_key ORDER BY key LIMIT n`. Deeper: constant cost per page and stable under inserts; needs a unique sort key and an index. *Owner: I-13.*

<a id="keyspace"></a>
### keyspace
Cassandra's top-level namespace for tables, with its replication settings; Rowlit shows keyspaces as schemas. *Owner: II-09.*

<a id="kill"></a>
### kill — kill
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="kill-query"></a>
### KILL QUERY
MySQL/MariaDB (and ClickHouse) statement that stops another connection's running statement; Rowlit's cancel sends it on a side connection. *Owner: II-09.*

<a id="known-hosts"></a>
### known hosts
The list of SSH servers and their host key fingerprints a client trusts; Rowlit keeps it in `ssh-known-hosts.json`. *Owner: II-08.*

<a id="kraft"></a>
### KRaft
Kafka's built-in Raft quorum for metadata, replacing ZooKeeper (removed in Kafka 4.0). Deeper: controller nodes. *Owner: I-16.*

<a id="lakehouse"></a>
### lakehouse
A data lake of columnar files (Parquet) with a transactional table format (Iceberg, Delta, Hudi). Deeper: lets several engines query one copy with ACID guarantees. *Owner: I-15.*

<a id="language-id"></a>
### language id
The name Monaco uses for a language, here one per dialect, such as `dbstudio-pgsql`. *Owner: II-12.*

<a id="language-service"></a>
### language service
A component that understands a language well enough to answer editor questions about a document (what can go here, what is this name, where is it defined, what is wrong). Rowlit's is the `Intel` object, one per editor, with no DOM or Monaco dependency. *Owner: II-11.*

<a id="latch"></a>
### latch — latch (قفل سبک داخلی)
Short in-memory lock protecting a physical structure such as a buffer page. Deeper: held microseconds, no deadlock detection; seen as `PAGELATCH_*`, `LWLock`. *Owner: I-10.*

<a id="late-cancel"></a>
### late cancel
A cancel that arrives after the statement finished. Deeper: Rowlit reports the batch as Ok with a warning saying where its changes went. *Owner: II-08.*

<a id="late-materialisation"></a>
### late materialisation
Delaying the assembly of full rows until after filtering. Deeper: ClickHouse `PREWHERE`. *Owner: I-15.*

<a id="latency"></a>
### latency — تأخیر (latency)
Time one operation takes. Deeper: report percentiles, not averages. *Owner: I-13.*

<a id="lateral"></a>
### LATERAL — LATERAL
A join in which the right side may refer to columns of the left side ("for each row, run this subquery"). Standard SQL; PostgreSQL, MySQL 8, Oracle and Snowflake have it, SQL Server calls it `APPLY`. *Owner: I-04.* See also: APPLY.

<a id="layered-architecture"></a>
### layered architecture
Code organised in levels, each using only the levels below. Deeper: Rowlit's engine is Core → providers/features → Host. *Owner: II-03.*

<a id="layout-engine-dagre"></a>
### layout engine (dagre)
The library that computes layered graph layouts. The ER diagram runs it in a Web Worker. *Owner: II-15.*

<a id="layout-rule"></a>
### layout rule
A per-dialect table of the formatter (statement-start words, function-like keywords, extra clauses). *Owner: II-12.*

<a id="lazy-begin"></a>
### lazy begin
Starting the manual-mode transaction only before the first batch that writes or sets a savepoint. *Owner: II-08.*

<a id="lazy-dialect"></a>
### lazy dialect
A dialect whose spec is a separate code chunk loaded on first use instead of being part of the initial bundle. In Rowlit MySQL, ClickHouse, Snowflake, CQL and DuckDB are lazy (`ensureDialect`), to respect the bundle budget; until loaded they answer with the generic stand-in. *Owner: II-11.*

<a id="lazy-loading"></a>
### lazy loading — بارگذاری تنبل
ORM behaviour that loads related objects only when first accessed. Deeper: the usual cause of N+1 queries. *Owner: I-13.*

<a id="leaf-node"></a>
### leaf node — گرهٔ برگ (leaf node)
The bottom level of a B+tree: every key in order with its row pointer (or the row, in a clustered index), linked to its neighbours for range scans. *Owner: I-07.* See also: internal node.

<a id="lease"></a>
### lease
A counted "I am still using this" claim on a shared object. Streams, jobs and Workbench batches take a lease on a connection's source client (`AcquireLease`), and the idle reaper never closes a client while a lease is held. *Owner: II-17.*

<a id="least-privilege"></a>
### least privilege
Each account gets only the permissions its job needs. Deeper: web applications should not own tables; reporting accounts are read-only. *Owner: I-14.*

<a id="left-deep-tree"></a>
### left-deep tree — درخت چپ‌عمیق (left-deep tree)
A join tree in which every join's inner input is a base table. Pipelines well with nested loops and keeps the search small. *Owner: I-08.* See also: bushy tree.

<a id="leftmost-prefix"></a>
### leftmost prefix — قاعدهٔ پیشوند چپ (leftmost prefix)
A composite B-tree index can be searched only on a leading run of its columns; `(a, b)` serves `a = ?` and `a = ? AND b = ?`, not `b = ?` alone (except by skip scan). *Owner: I-07.* See also: composite index, skip scan.

<a id="level-of-detail"></a>
### level of detail (LOD)
Drawing less when zoomed out. ER cards become header-only below zoom 0.45 and boxes below 0.2. *Owner: II-15.*

<a id="lexer"></a>
### lexer / tokenizer
The program that cuts source text into tokens (words, strings, numbers, operators, comments). Rowlit has one lexer engine driven by dialect tables, with a whole-document mode, a per-line mode for syntax highlighting and an incremental mode for edits. *Owner: II-11.*

<a id="lexer-hook"></a>
### lexer hook / lexer traits
A dialect's extension point into the shared lexer. Newer dialects declare `LexTraits` as data (backtick identifiers, `#` comments, backslash escapes, parameter prefixes...) and `traitLexer` turns them into a hook the lexer calls before its own rules, so no dialect edits `lexer.ts`. *Owner: II-11.*

<a id="librdkafka"></a>
### librdkafka
The C client library for Apache Kafka that Confluent.Kafka wraps for .NET. Because it is native code, Rowlit must ship it inside the published engine (self-extracted on Windows, a signed dylib next to the apphost on macOS) and checks in CI that it loads. *Owner: II-18.*

<a id="lightweight-transaction"></a>
### lightweight transaction (LWT) — تراکنش سبک (LWT)
Cassandra compare-and-set on one partition (`IF NOT EXISTS`, `IF col = x`) using Paxos. Deeper: linearizable but costs several round trips. *Owner: I-09.*

<a id="limit-offset"></a>
### LIMIT / OFFSET / TOP / FETCH — LIMIT/OFFSET
The engine-specific ways to return only the first N rows or skip some: `LIMIT`/`OFFSET`, SQL Server `TOP`, standard `OFFSET ... FETCH`. Always combine with `ORDER BY`. *Owner: I-03.*

<a id="line-pointer"></a>
### line pointer — اشاره‌گر سطر (line pointer)
PostgreSQL's 4-byte slot entry in a page header area that points to a tuple's offset; the second part of a `ctid`. *Owner: I-06.* See also: slotted page, ctid.

<a id="linearizability"></a>
### linearizability — خطی‌پذیری
Each operation appears to take effect at one instant between start and end; acknowledged writes are seen by all later reads. Deeper: about single objects in real time, unlike serializability. *Owner: I-12.*

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

<a id="lint"></a>
### lint — lint
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="literal"></a>
### literal — مقدار لفظی
A value written directly in a statement: `42`, `'Alice'`, `DATE '2026-01-05'`. *Owner: I-03.*

<a id="littles-law"></a>
### Little's law — قانون لیتل
Concurrency = throughput × latency. *Owner: I-13.*

<a id="lob"></a>
### LOB — شیء بزرگ (LOB)
Large object: a value too big for in-row storage (`varchar(max)`, `BLOB`, `CLOB`), stored in separate pages or segments with a pointer in the row. *Owner: I-06.* See also: off-row, TOAST.

<a id="local-history"></a>
### local history
A private, compressed timeline of each console's text, with diff, restore and labels. Stored in the engine's `local-history.db`. *Owner: II-12.*

<a id="local-history-snapshot"></a>
### snapshot (local history)
One saved version of an editor's text, taken on run, save, close or every two minutes while typing. Labelled snapshots are never pruned. *Owner: II-12.*

<a id="local-port-forwarding"></a>
### local port forwarding
SSH carrying bytes written to a local port to a remote host:port through the encrypted connection (`ssh -L`). *Owner: II-08.*

<a id="lock"></a>
### lock — قفل
Registration that a transaction uses a resource in a mode; incompatible requests wait. *Owner: I-10.*

<a id="lock-compatibility"></a>
### lock compatibility matrix — ماتریس سازگاری قفل‌ها
Table saying which lock modes can be held together. *Owner: I-10.*

<a id="lock-escalation"></a>
### lock escalation — ارتقای قفل
Replacing many fine locks with one coarse lock. Deeper: SQL Server at about 5,000 locks per statement on one object; PostgreSQL, Oracle and InnoDB never escalate. *Owner: I-10.*

<a id="lock-timeout"></a>
### lock timeout — مهلت قفل
Maximum time to wait for a lock before failing. Deeper: `lock_timeout`, `SET LOCK_TIMEOUT`, `innodb_lock_wait_timeout`. *Owner: I-10.*

<a id="lock-wait"></a>
### lock wait
A statement waiting for a lock another session holds; Rowlit rewrites lock-timeout errors to name the holder sessions. *Owner: II-08.*

<a id="lockdown"></a>
### lockdown (DuckDB)
The settings applied to every federation DuckDB before user SQL runs: no extension auto-install or auto-load, no external (file or network) access, then `lock_configuration = true` so they cannot be changed. *Owner: II-16.* See also: read-only enforcement (II-19).

<a id="log-backup"></a>
### log backup — پشتیبان لاگ
A backup of log records since the previous log backup (WAL archive, archived redo, binlog). Deeper: the basis of PITR; in SQL Server FULL recovery also what allows log truncation. *Owner: I-12.*

<a id="log-compaction"></a>
### log compaction
A Kafka policy that keeps only the latest record per key. Deeper: a null value (tombstone) removes the key. *Owner: I-16.*

<a id="log-record"></a>
### log record — رکورد لاگ
One entry of the WAL describing one change. *Owner: I-11.*

<a id="log-source"></a>
### log source — log source
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="log-truncation"></a>
### log truncation — کوتاه‌سازی لاگ
Making old log space reusable. Deeper: blocked by active transactions, missing log backups, replicas or slots (`log_reuse_wait_desc`). *Owner: I-11.*

<a id="logical-backup"></a>
### logical backup — پشتیبان منطقی
Export of SQL or rows (`pg_dump`, `mysqldump`, Data Pump). Deeper: portable and selective, slow to restore, no PITR. *Owner: I-12.*

<a id="logical-plan"></a>
### logical plan — طرح منطقی (logical plan)
A query expressed as relational operators (scan, filter, join, aggregate) without choosing algorithms or order. The optimizer turns it into a physical plan. *Owner: I-08.* See also: physical plan.

<a id="logical-read"></a>
### logical read / physical read — خواندن منطقی / خواندن فیزیکی
A logical read finds the page in the buffer pool; a physical read fetches it from storage. Plans and I/O statistics report both (`shared hit` / `read`, `logical reads` / `physical reads`). *Owner: I-06.* See also: buffer pool.

<a id="logical-replication"></a>
### logical replication — همانندسازی منطقی
Shipping row changes to an independent database. Deeper: allows other versions and subsets; DDL usually not replicated. *Owner: I-12.*

<a id="loopback"></a>
### loopback
The `127.0.0.1` network interface that never leaves the machine; the engine listens only there. *Owner: II-03.*

<a id="lost-update"></a>
### lost update — به‌روزرسانی گم‌شده
Two read-modify-write transactions where the second write overwrites the first. Deeper: fix with atomic updates, locking reads, version checks or a stronger level. *Owner: I-09.*

<a id="lru-budget"></a>
### lru budget — lru budget
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="lru-cache"></a>
### LRU cache
A cache that, when full, drops the least recently used entries first. The catalog cache budget is 128 MB by default. *Owner: II-10.*

<a id="lsm-tree"></a>
### LSM tree
Log-structured merge tree: writes go to a log and an in-memory table, are flushed to immutable sorted files and merged later. Deeper: write amplification versus read amplification. *Owner: I-16.*

<a id="lsn"></a>
### LSN (log sequence number) — شمارهٔ ترتیبی لاگ (LSN)
Monotonic position of a record in the log. Deeper: pages store the LSN of the last change applied (pageLSN). *Owner: I-11.*

<a id="lttb"></a>
### LTTB
Largest-Triangle-Three-Buckets: a downsampling method that keeps the visual shape of a long line with few points. *Owner: II-13.*

<a id="main-process"></a>
### main process
Electron's Node.js process that owns windows and native APIs and supervises the engine. *Owner: II-03.*

<a id="man-in-the-middle"></a>
### man-in-the-middle
An attacker who sits between client and server and relays or alters traffic. Deeper: encryption without certificate verification does not stop it. *Owner: I-14.*

<a id="manual-transaction"></a>
### manual transaction — تراکنش دستی
Mode in which statements stay in an open transaction until an explicit COMMIT or ROLLBACK. *Owner: I-09.*

<a id="mapping"></a>
### mapping
The Elasticsearch declaration of a field's type and indexing. Deeper: `text` versus `keyword`; dynamic mapping guesses. *Owner: I-16.*

<a id="marker"></a>
### marker
A squiggle with a message in the editor. Rowlit keeps separate marker owners for soft, server, execution and formatter diagnostics. *Owner: II-12.*

<a id="match-score"></a>
### match score
How well a typed prefix matches a label: exact 100, case-insensitive exact 96, prefix 90, word starts 70, substring 50, subsequence 20-30, none −1. It is added to the item's group weight (× 1 000), usage boost and relevance to sort the list. *Owner: II-11.*

<a id="materialize"></a>
### materialize (links)
Writing the result of a link query into a real table of a writable connection, as a job, in mode create, replace (swap after a complete load) or append. Reuses the import's target writer and bulk paths. *Owner: II-16.*

<a id="materialized-view"></a>
### materialized view — نمای مادی‌شده
A view whose result is stored and must be refreshed. PostgreSQL, Oracle and Snowflake have them; SQL Server's equivalent is an indexed view; MySQL has none. *Owner: I-04.* See also: view.

<a id="materialized-view-clickhouse"></a>
### materialized view (ClickHouse)
An insert trigger that runs a query on each inserted block and writes the result to a target table. Deeper: blind to rows that existed before and to updates and deletes. *Owner: I-15.*

<a id="maxrows"></a>
### MaxRows
The row cap per result set (default 10 000; 0 = unlimited). *Owner: II-08.* See also: truncation, drain.

<a id="member-alias"></a>
### member alias
The short name a member is mounted under (`crm`): the DuckDB schema of its tables in SQL. Lower-case identifier of at most 63 characters, unique in the link, not a reserved word, not `main`, `temp`, `system`, `memory`, `information_schema`, `pg_catalog` or `views`. *Owner: II-16.*

<a id="memory-analysis"></a>
### memory analysis (Redis)
A job that samples keys with SCAN and `MEMORY USAGE` and reports where memory goes. Rowlit aggregates namespaces at two delimiter levels, the top 100 keys, per-type totals and TTL buckets; it is a sample (default 100 000 keys), not an exact census. *Owner: II-17.*

<a id="memory-grant"></a>
### memory grant — سهمیهٔ حافظه (memory grant)
SQL Server's working memory reserved for a query's sorts and hashes before it runs, sized from estimates. Too small causes spills; too large makes other queries wait. *Owner: I-08.* See also: spill.

<a id="memory-pressure"></a>
### memory pressure — memory pressure
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="memtable"></a>
### memtable
A sorted in-memory table that receives writes before being flushed. Deeper: one per Cassandra table. *Owner: I-16.*

<a id="menu-model"></a>
### menu model
Pure data (`MENUS`, `CONTEXT_MENUS`) from which both the native menu and the in-app context menus are built. *Owner: II-20.*

<a id="merge"></a>
### MERGE — MERGE
A statement that, in one atomic step, inserts, updates or deletes target rows depending on whether they match source rows. SQL Server, Oracle, Snowflake, PostgreSQL 15+. *Owner: I-04.* See also: upsert.

<a id="merge-join"></a>
### merge join — پیوند ادغامی (merge join)
Join algorithm that walks two inputs sorted on the join key in step. Cheap when both inputs are already ordered; otherwise it needs sorts. *Owner: I-08.* See also: interesting order.

<a id="mergetree"></a>
### MergeTree
The main ClickHouse table engine family: sorted immutable parts merged in the background. Deeper: variants Replacing, Summing, Aggregating, Collapsing; `Replicated` prefix. *Owner: I-15.*

<a id="metadata"></a>
### metadata
Data about data; here, the catalog. *Owner: II-10.*

<a id="micro-partition"></a>
### micro-partition
Snowflake's immutable columnar storage file (about 50 to 500 MB uncompressed). Deeper: min/max metadata per column enables pruning. *Owner: I-15.*

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

<a id="minimap"></a>
### minimap
A small overview (180 x 120 px) of the whole ER diagram with the viewport as a frame. *Owner: II-15.*

<a id="mock"></a>
### mock — mock
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="mock-mode"></a>
### mock mode — mock mode
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="modular-monolith"></a>
### modular monolith
One deployable program split into modules with explicit boundaries. Deeper: the Rowlit engine. *Owner: II-03.*

<a id="module"></a>
### module
A unit of code with one purpose and a clear interface; in the engine, an `IEngineModule` class. *Owner: II-03.* See also: engine module.

<a id="monaco"></a>
### Monaco
The code editor component of Visual Studio Code, embedded in Rowlit for consoles and previews. *Owner: II-12.*

<a id="monaco-action"></a>
### Monaco action
A named, optionally keyed operation attached to one editor instance. Rowlit re-registers key-bound actions when the keymap changes. *Owner: II-12.*

<a id="monaco-model"></a>
### model / URI (Monaco)
A Monaco text model is the document; its URI (`dbstudio-tab://tab/<id>.sql`) lets providers find the right editor's IntelliSense. *Owner: II-12.*

<a id="monitor"></a>
### MONITOR
A Redis command that streams every command the server processes. It is costly for the server, so Rowlit runs it only as a stream on a dedicated connection that stops itself after 10 minutes by default (60 at most). *Owner: II-17.*

<a id="monolith"></a>
### monolith
One deployable program. *Owner: II-03.*

<a id="most-common-values"></a>
### most common values (MCV) — پرتکرارترین مقدارها (MCV)
Statistics listing the most frequent values of a column with their frequencies (`pg_stats.most_common_vals`, Oracle frequency histograms). They give exact estimates for skewed values. *Owner: I-07.* See also: histogram.

<a id="mounted-table"></a>
### mounted table
A source table, view, collection, index or file as it appears in a link, addressed `alias.table`. It can be renamed inside the link (`As`) and carry fetcher options. *Owner: II-16.*

<a id="mru"></a>
### MRU / usage store
"Most recently used": ranking that favours what you picked before. Rowlit's `UsageStore` adds an exponentially growing weight per accepted item (half-life 14 days), gives up to +15 points, keeps at most 2 000 keys and is saved per connection in the settings. *Owner: II-11.*

<a id="msw"></a>
### msw — msw
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="multi-run"></a>
### multi-run
Running the same batches on several connections at once, each with its own session and history entry (label `multi`). *Owner: II-08.*

<a id="multiplexer"></a>
### multiplexer (Redis)
StackExchange.Redis' `ConnectionMultiplexer`: one object that sends every caller's commands over one pipelined socket per server and reconnects by itself. Rowlit keeps exactly one per Redis connection, inside the `RedisClient`. *Owner: II-17.*

<a id="multiplexing"></a>
### multiplexing
Carrying many logical conversations over one connection, told apart by ids (`executionId`, `streamId`, `jobId`). *Owner: II-06.*

<a id="mutation"></a>
### mutation
An asynchronous ClickHouse `ALTER TABLE … UPDATE/DELETE` that rewrites affected parts. Deeper: tracked in `system.mutations`; lightweight `DELETE` marks rows instead. *Owner: I-15.*

<a id="mvcc"></a>
### MVCC (multi-version concurrency control) — کنترل هم‌روندی چندنسخه‌ای (MVCC)
Writers create new row versions; readers read the version valid for their snapshot. Deeper: readers and writers do not block each other; old versions must be cleaned up. *Owner: I-10.*

<a id="mysqlconnector"></a>
### MySqlConnector
An MIT-licensed asynchronous ADO.NET driver for MySQL and MariaDB (2.4.0 in Rowlit). *Owner: II-09.*

<a id="n-plus-1"></a>
### N+1 queries — پرس‌وجوهای N+1
One query for a list plus one query per item. Deeper: costs round trips; fix with a join or an `IN` list. *Owner: I-13.*

<a id="namespace"></a>
### namespace — فضای نام
A named container that gives its objects unique names and a common owner or permissions. In a database it is a schema (second meaning). *Owner: I-01.* See also: schema.

<a id="naming-convention"></a>
### naming convention
How generated code spells identifiers (`pascal`, `camel`, `snake`, `asIs`), including singularising table names. *Owner: II-14.*

<a id="native-library"></a>
### native library
A platform-specific compiled library (DLL, dylib, so) used by a .NET package, e.g. SQL Server's SNI, `e_sqlite3`, `sf_mini_core`. *Owner: II-09.* See also: self-extract.

<a id="native-link-script"></a>
### native link script
A script Rowlit generates so that a target server reaches a member's server by its own means (linked server, FDW, database link, FEDERATED, ClickHouse engines). Secrets are placeholders and the engine never runs it. *Owner: II-16.*

<a id="natural-key"></a>
### natural key — کلید طبیعی
A key made of real-world data that is already unique, such as an ISBN. Looks convenient, but the real world changes it. *Owner: I-02.* See also: surrogate key.

<a id="nested-loop-join"></a>
### nested loop join — پیوند حلقهٔ تودرتو (nested loop join)
Join algorithm that probes the inner input once per outer row, ideally through an index seek. Best for small outer inputs; SQLite's only join algorithm. *Owner: I-08.* See also: hash join, merge join.

<a id="newsql"></a>
### NewSQL / distributed SQL
Databases that keep SQL and ACID while scaling out through consensus-replicated ranges. Deeper: Spanner, CockroachDB, TiDB, YugabyteDB. *Owner: I-16.*

<a id="next-key-lock"></a>
### next-key lock — قفل کلید بعدی
InnoDB record lock plus a gap lock on the gap before it. Deeper: prevents phantoms for locking reads at REPEATABLE READ. *Owner: I-10.*

<a id="nls"></a>
### NLS
Oracle National Language Support settings such as `NLS_DATE_FORMAT`; Rowlit sets them at session open. *Owner: II-09.*

<a id="no-backslash-escapes"></a>
### NO_BACKSLASH_ESCAPES
A MySQL `sql_mode` in which backslash is an ordinary character in strings. Deeper: Rowlit's MySQL lexers assume escapes are on. *Owner: II-09.*

<a id="non-repeatable-read"></a>
### non-repeatable read — خواندن تکرارناپذیر
The same row read twice in a transaction returns different values. *Owner: I-09.*

<a id="normal-form"></a>
### normal form — شکل نرمال
A rule about a table's design that rules out certain anomalies: 1NF (atomic values), 2NF (no partial dependency on the key), 3NF (no dependency between non-key columns), BCNF (every determinant is a candidate key), 4NF (no independent multi-valued dependencies). *Owner: I-05.* See also: anomaly, functional dependency.

<a id="normalisation"></a>
### normalisation — نرمال‌سازی
Splitting tables until each stores facts about one kind of thing and each fact is stored once. *Owner: I-05.*

<a id="nosql"></a>
### NoSQL
A loose label for non-relational databases built for scale, flexible schema or a specialised access pattern. Deeper: five families here plus NewSQL. *Owner: I-16.*

<a id="notarization"></a>
### notarization — گواهی‌گذاری Apple
Apple service that scans a signed macOS application and issues a ticket Gatekeeper can verify. *Owner: II-24.*

<a id="npgsql"></a>
### Npgsql
The ADO.NET driver for PostgreSQL (9.0.5 in Rowlit). *Owner: II-09.*

<a id="npm-script"></a>
### npm script — npm script
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="nsis"></a>
### NSIS — سازندهٔ نصب Windows
The installer technology used by electron-builder for Rowlit on Windows. *Owner: II-24.*

<a id="nuget-audit"></a>
### nuget audit — nuget audit
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="null"></a>
### NULL — مقدار تهی
The marker for "no value here" (unknown or not applicable). Not zero or an empty string (except in Oracle, where `''` is NULL). Comparisons with NULL are UNKNOWN. *Owner: I-02.* See also: three-valued logic.

<a id="oauth"></a>
### OAuth
A framework in which an identity provider issues access tokens that a client presents instead of a password. Deeper: tokens expire; the database validates the signature and claims. *Owner: I-14.* See also: SSO.

<a id="objects-tab"></a>
### Objects tab
A permanent first tab listing the objects of the explorer selection with counts, sizes and dates. *Owner: II-10.*

<a id="observer"></a>
### observer
An object that receives callbacks about events another object produces. Deeper: `IExecutionSink` is the observer of an execution. *Owner: II-09.* See also: sink.

<a id="odp-net"></a>
### ODP.NET
Oracle Data Provider for .NET; Rowlit uses the managed `Oracle.ManagedDataAccess.Core` (no Instant Client). *Owner: II-09.*

<a id="off-row"></a>
### off-row — بیرون از سطر (off-row)
Storage of a large column value outside the row's page, with only a pointer in the row (TOAST, LOB, row-overflow, off-page columns, overflow pages). *Owner: I-06.* See also: TOAST, LOB.

<a id="offset"></a>
### offset
The position of a record in its partition. Deeper: consumers commit offsets to `__consumer_offsets`. *Owner: I-16.*

<a id="offset-pagination"></a>
### offset pagination — صفحه‌بندی با OFFSET
`LIMIT n OFFSET k`: the engine produces and discards k rows. Deeper: cost grows with depth; unstable under inserts. *Owner: I-13.*

<a id="offset-reset"></a>
### offset reset
Changing the committed offsets of a Kafka consumer group so that its consumers start reading from another position (earliest, latest, an offset, a time, or shifted by N). Rowlit clamps every target to the partition's watermarks and refuses to apply it while the group has active members (`409 GROUP_ACTIVE`). *Owner: II-18.*

<a id="olap"></a>
### OLAP
Online analytical processing: few large queries that scan a few columns of many rows. Deeper: wants throughput; column stores, star schemas. *Owner: I-15.*

<a id="oltp"></a>
### OLTP
Online transaction processing: many small reads and writes of a few whole rows. Deeper: wants low latency and ACID; row stores. *Owner: I-15.* See also: OLAP.

<a id="onion-architecture"></a>
### onion architecture
Jeffrey Palermo's concentric layers with the domain at the centre and infrastructure outside. *Owner: II-03.* See also: clean architecture.

<a id="opensearch"></a>
### OpenSearch
An open-source fork of Elasticsearch 7.10, with the same core REST API and its own plugins (for example SQL under `_plugins/_sql`). Rowlit supports both with one transport and detects the flavor from `GET /`. *Owner: II-18.*

<a id="operator"></a>
### operator — عملگر (operator)
One node of a physical plan (scan, seek, join, sort, aggregate, exchange). Each reports estimated and, in an actual plan, real rows and time. *Owner: I-08.* See also: physical plan.

<a id="oplog"></a>
### oplog
The capped collection (`local.oplog.rs`) of changes that secondaries replay. Deeper: entries are idempotent; change streams use it. *Owner: I-16.*

<a id="optimistic-concurrency"></a>
### optimistic concurrency
Assuming nobody else changed a row and checking at write time. Rowlit's *verify unchanged* adds the old values to the `WHERE`. *Owner: II-13.*

<a id="optimizer"></a>
### optimizer — بهینه‌ساز (optimizer)
The engine component that chooses how to execute a declarative query: access paths, join order and algorithms, from statistics and a cost model. *Owner: I-08.* See also: cost-based optimizer.

<a id="ora-01555"></a>
### ORA-01555 (snapshot too old) — خطای ORA-01555
Oracle error when the undo needed for a consistent read was overwritten. Deeper: size undo, tune `UNDO_RETENTION`, shorten queries. *Owner: I-10.*

<a id="order-by"></a>
### ORDER BY — مرتب‌سازی
The only way to obtain a defined row order. Can use aliases; each key is `ASC` or `DESC`; NULL placement differs by engine. *Owner: I-03.*

<a id="origin"></a>
### origin — origin
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="orphan-session"></a>
### orphan session
A session whose owning UI window is gone; closed with rollback after `orphanGraceSeconds` (90). *Owner: II-08.*

<a id="out-parameter"></a>
### OUT parameter
A routine parameter the routine writes back. Execute routine shows OUT values and the return value in an outputs card. *Owner: II-14.*

<a id="over-indexing"></a>
### over-indexing — نمایه‌گذاری بیش از اندازه
More indexes than the workload needs. Deeper: each one slows writes and uses memory. *Owner: I-13.*

<a id="overflow-page"></a>
### overflow page — صفحهٔ سرریز (overflow page)
SQLite page holding the tail of a record too large for its B-tree page, chained from the cell. *Owner: I-06.* See also: off-row.

<a id="overlay-editor"></a>
### overlay editor
The text box the grid opens over a cell while you edit it. It lives in a global `#portal` element. *Owner: II-13.*

<a id="ownership-block"></a>
### ownership block
A labelled region `// WP-MY begin … // WP-MY end` in a shared file that only one work package may edit. *Owner: II-07.*

<a id="pacelc"></a>
### PACELC — PACELC
If Partition, choose Availability or Consistency; Else, choose Latency or Consistency. *Owner: I-12.*

<a id="package"></a>
### package — پکیج
Oracle: a named bundle of procedures, functions and variables, with a public specification and a private body (`ORDER_API` in the Oracle `shop` seed). Not to be confused with a work package. *Owner: I-04.*

<a id="page"></a>
### page — صفحه (page)
The fixed-size block (8 KB in PostgreSQL and SQL Server, 16 KB in InnoDB, 4 KB in SQLite by default) that an engine reads, writes, caches and logs as a unit. *Owner: I-06.* See also: block, slotted page.

<a id="page-split"></a>
### page split — شکافتن صفحه (page split)
When a B+tree page is full, the engine moves about half of its entries to a new page and adds a separator to the parent; a root split grows the tree. Random keys cause frequent splits and half-empty pages. *Owner: I-07.* See also: fill factor.

<a id="pagelsn"></a>
### pageLSN — pageLSN
LSN stored in a page of the last log record applied to it. Deeper: redo skips records older than it. *Owner: I-11.*

<a id="paging"></a>
### paging
Reading a table in pages with `OFFSET/LIMIT` or `OFFSET/FETCH` and a stable `ORDER BY`. The default page is 1 000 rows. *Owner: II-13.*

<a id="paging-state"></a>
### paging state
The opaque Cassandra token that resumes a query at the next page. *Owner: II-09.*

<a id="param-binder"></a>
### param binder
`IParamBinder`, a keyed per-provider service that finds placeholders and binds parameter values. *Owner: II-08.*

<a id="parameter-sniffing"></a>
### parameter sniffing — parameter sniffing (بو کشیدن پارامتر)
SQL Server compiles a parameterised plan for the values of its first execution and reuses it for every value. Harmful when data is skewed; fixed with `RECOMPILE`, `OPTIMIZE FOR`, plan forcing or PSP optimization. *Owner: I-08.* See also: bind peeking, generic plan.

<a id="parameterised-query"></a>
### parameterised query
SQL text with placeholders, sent separately from the values (also called a prepared statement). Deeper: the parser sees values only as data; some drivers (MySqlConnector) escape client-side. *Owner: I-14.* See also: bind variable.

<a id="parent-watchdog"></a>
### parent watchdog
`ParentWatchdog`: stops the engine when the process given by `--parent-pid` exits. *Owner: II-05.*

<a id="parse-tree"></a>
### parse tree — درخت تجزیه (parse tree)
The tree the parser builds from the tokens of a statement, before names are resolved. *Owner: I-08.* See also: parser.

<a id="parser"></a>
### parser — تجزیه‌گر (parser)
The first pipeline stage: tokenises the SQL text and checks its grammar, producing a parse tree; syntax errors come from here. *Owner: I-08.* See also: binder.

<a id="part"></a>
### part
An immutable, sorted chunk of a MergeTree table written by one insert or merge. Deeper: named `partition_minblock_maxblock_level`. *Owner: I-15.*

<a id="partial-count"></a>
### partial count
A count of what has been seen so far rather than the server's total. Folder counts in the Redis key tree count only scanned keys; the header shows "scanned X of ~Y" until the scan is complete. *Owner: II-17.*

<a id="partial-index"></a>
### partial index — نمایهٔ جزئی (partial index)
An index on only the rows matching a `WHERE` clause (PostgreSQL, SQLite). Usable only when the query's predicate implies the index predicate. *Owner: I-07.* See also: filtered index.

<a id="partial-parser"></a>
### partial parser
A parser that understands only the structure a tool needs (scopes, sources, aliases, clause positions) and skips everything else, instead of implementing a full grammar. Rowlit's hand-written recursive-descent parser builds a statement model from incomplete SQL in nine dialects. *Owner: II-11.*

<a id="partition-clickhouse"></a>
### partition (ClickHouse)
A coarse split of a table (for example per month) used for data management and pruning. Deeper: parts never span partitions; too many partitions hurt. *Owner: I-15.*

<a id="partition-kafka"></a>
### partition (Kafka)
An ordered append-only sequence of records within a topic. Deeper: order is guaranteed only within a partition; the key chooses the partition. *Owner: I-16.*

<a id="partition-key"></a>
### partition key
In Cassandra, the part of the primary key that decides which nodes store a row. Deeper: hashed to a token; queries must name it. *Owner: I-16.*

<a id="partition-key-table"></a>
### partition key (table partitioning) — کلید پارتیشن
Column(s) whose value decides the partition of a row. Deeper: queries must compare it directly for pruning. Not the Cassandra partition key (see `partition-key`). *Owner: I-12.*

<a id="partition-pruning"></a>
### partition pruning — هرس پارتیشن
The planner skipping partitions that cannot contain matching rows. Deeper: at plan time and, in PostgreSQL 11+, at execution time. *Owner: I-12.*

<a id="pausable-stream"></a>
### pausable stream
An engine stream that can pause at its source instead of having its items dropped while paused (`IPausableEngineStream`). The Kafka tail is one: it pauses the consumer, the broker keeps the messages, and the backlog arrives on resume. *Owner: II-18.*

<a id="pbkdf2"></a>
### PBKDF2 — مشتق‌سازی کلید
A password-based key derivation function that repeatedly applies a pseudorandom function with a salt. *Owner: II-19.*

<a id="pctfree"></a>
### PCTFREE — PCTFREE
Oracle's per-block free-space reserve (default 10%), the inverse of a fill factor; room for rows to grow without migrating. *Owner: I-06.* See also: fill factor, row chaining.

<a id="pending-change"></a>
### pending change
An edit in the grid's buffer (update, insert, delete) not yet saved. Shown with colour and listed in the SQL preview. *Owner: II-13.*

<a id="pending-definition"></a>
### pending definition
The answer "nothing found yet, but the schema or database that would contain it is loading". `Intel.pendingDefinition` requests the missing piece from the host; the editor shows "Loading Sales…" and retries on every catalog change for up to 15 seconds. *Owner: II-11.*

<a id="percentile"></a>
### percentile — صدک
The value below which a given share of measurements fall (p50, p95, p99). *Owner: I-13.*

<a id="pessimistic-concurrency"></a>
### pessimistic concurrency — هم‌روندی بدبینانه
Lock what you read because you expect a conflict (`SELECT … FOR UPDATE`, `UPDLOCK`). *Owner: I-10.*

<a id="pg-catalog"></a>
### pg_catalog
PostgreSQL's system catalog (`pg_class`, `pg_attribute`, `pg_namespace`). Deeper: what `psql` reads. *Owner: I-17.*

<a id="pg-hba-conf"></a>
### pg_hba.conf
PostgreSQL's host-based authentication file: lines of (connection type, database, user, address, method). Deeper: first match wins; `reject` closes a door; `hostssl` requires TLS. *Owner: I-14.*

<a id="pg-stat-statements"></a>
### pg_stat_statements — pg_stat_statements
PostgreSQL extension that aggregates statistics per normalised statement. Deeper: needs `shared_preload_libraries`; sort by total time. *Owner: I-13.*

<a id="pgbouncer"></a>
### PgBouncer — PgBouncer
Lightweight connection pooler for PostgreSQL with session, transaction and statement modes. Deeper: transaction mode breaks session state. *Owner: I-13.*

<a id="phantom-read"></a>
### phantom read — خواندن شبح (phantom)
A repeated range query returns new or missing rows because another transaction inserted or deleted. *Owner: I-09.*

<a id="physical-backup"></a>
### physical backup — پشتیبان فیزیکی
Copy of data files or pages (`pg_basebackup`, `BACKUP DATABASE`, RMAN). Deeper: fast restore, same version only. *Owner: I-12.*

<a id="physical-connection"></a>
### physical connection
One real socket to the server with its own server-side state. *Owner: II-08.*

<a id="physical-plan"></a>
### physical plan — طرح فیزیکی (physical plan)
The executable tree of operators with concrete algorithms, access paths and order, chosen by the optimizer. This is what `EXPLAIN` shows. *Owner: I-08.* See also: logical plan.

<a id="physical-replication"></a>
### physical replication — همانندسازی فیزیکی
Shipping the log itself; the replica replays it into a byte-identical copy. *Owner: I-12.*

<a id="ping-pong"></a>
### ping/pong
A small request and its reply that prove a connection is alive (`{"type":"ping"}` → `pong`). *Owner: II-06.*

<a id="pinned"></a>
### pinned
A history entry marked to be kept when history is cleared. *Owner: II-08.*

<a id="pinned-result"></a>
### pinned result — pinned result
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="pipe"></a>
### pipe
A Snowflake object (Snowpipe) that loads files continuously as they arrive in a stage. Deeper: serverless compute. *Owner: I-15.*

<a id="pipeline-breaker"></a>
### pipeline breaker — شکنندهٔ خط لوله (pipeline breaker)
An operator that must consume its whole input before producing output (sort, hash build, hash aggregate). Where memory is needed and spills happen. *Owner: I-08.* See also: Volcano model, spill.

<a id="pitr"></a>
### PITR (point-in-time recovery) — بازیابی به نقطه‌ای از زمان (PITR)
Restoring a backup and replaying the log up to a chosen moment. *Owner: I-12.*

<a id="pivot"></a>
### PIVOT — محوری‌سازی
Turning row values into columns. Portable form: conditional aggregation (`sum(CASE WHEN ... END)`); SQL Server, Oracle and Snowflake also have a `PIVOT` operator. *Owner: I-04.*

<a id="pl-pgsql"></a>
### PL/pgSQL
PostgreSQL's default procedural language. Deeper: bodies in `$$…$$`, `RAISE NOTICE`. *Owner: I-17.*

<a id="pl-sql"></a>
### PL/SQL
Oracle's procedural language. Deeper: blocks, packages, `DBMS_OUTPUT`, ref cursors. *Owner: I-17.*

<a id="plan-cache"></a>
### plan cache — حافظهٔ نهان طرح (plan cache)
A store of compiled plans reused by later executions of the same statement (SQL Server instance-wide, Oracle shared cursor cache, PostgreSQL per session for prepared statements). *Owner: I-08.* See also: prepared statement.

<a id="plan-node"></a>
### plan node
One operator of a normalised execution plan with estimated and actual rows, cost and warnings. *Owner: II-15.*

<a id="plan-reader"></a>
### plan reader
`IPlanReader`: per-provider component that builds the explain script and the `PlanNode` tree. *Owner: II-15.*

<a id="plan-warning"></a>
### plan warning (links)
A coded note in a push-down plan: `rowCap`, `fallback`, `joinKinds`, `joinCollation`, `limitWithoutOrder`, `cartesian`, `decimalWidened`, `conversion`, `fullScan`, `cached`, `fallbackEngine`. The console prints them as messages. *Owner: II-16.*

<a id="platform-adapter"></a>
### platform adapter
The `Platform` interface that hides whether Rowlit runs in Electron or a browser. *Owner: II-20.*

<a id="plugin-system"></a>
### plugin system
Loading code unknown at build time (a plugin folder, load contexts). Deeper: Rowlit has none; modules are compiled in. *Owner: II-07.*

<a id="popover"></a>
### popover — popover
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="ports-and-adapters"></a>
### ports and adapters
Another name for hexagonal architecture: ports are interfaces the core owns, adapters implement them outside. *Owner: II-03.*

<a id="postfix-completion"></a>
### postfix completion
A template triggered after an expression, such as `Customers.sel`. *Owner: II-12.*

<a id="precision-scale"></a>
### precision / scale — دقت و مقیاس
For exact decimals: precision is the total number of significant digits, scale the digits after the decimal point. `numeric(12,2)` holds up to 9,999,999,999.99. *Owner: I-05.*

<a id="predicate"></a>
### predicate — گزاره
A condition that is TRUE, FALSE or UNKNOWN for a row, such as `total > 100`. `WHERE` keeps rows where it is TRUE. *Owner: I-03.*

<a id="predicate-push-down"></a>
### predicate push-down — فروراندن گزاره (predicate push-down)
Applying a filter as early as possible: below joins, into views and scans, or to a remote source, so fewer rows flow up the plan. Rowlit's federation uses it per source (II-16). *Owner: I-08.* See also: projection pruning, push-down (II-16).

<a id="preflight"></a>
### preflight — preflight
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="preload"></a>
### preload
A script Electron runs before the page, with access to `contextBridge`; it publishes `window.dbstudio`. *Owner: II-03.*

<a id="preload-bridge"></a>
### preload bridge — preload bridge
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="prepare-diagnostics"></a>
### prepare diagnostics
Syntax and name checks done by asking the server to compile a statement without running it (PostgreSQL `PREPARE` read-only, SQLite `sqlite3_prepare`). *Owner: II-09.*

<a id="prepared-statement"></a>
### prepared statement — دستور آماده (prepared statement)
A statement parsed and planned once with parameters and executed many times with different values. Saves compile time and prevents SQL injection. *Owner: I-08.* See also: plan cache, generic plan.

<a id="primary-key"></a>
### primary key — کلید اصلی
The candidate key chosen as the table's identifier. Unique, never NULL, at most one per table; the DBMS indexes it. *Owner: I-02.*

<a id="primary-replica"></a>
### primary / replica — اصلی / رونوشت
The server that accepts writes, and the servers that follow its changes. *Owner: I-12.*

<a id="principal"></a>
### principal
Anything that can be granted rights: a user, group or role. Deeper: in Kerberos a principal is also the name of a user or service in the realm. *Owner: I-14.*

<a id="prisma-schema"></a>
### Prisma schema
The `schema.prisma` file format. Rowlit generates it as a flavor of the TypeScript generator, for PostgreSQL only. *Owner: II-14.*

<a id="privilege"></a>
### privilege
One permission, such as `SELECT` on a table or `CREATE TABLE` in a schema. Deeper: object privileges apply to an object, system privileges to the server. *Owner: I-14.*

<a id="probe-side"></a>
### probe side — سمت کاوش (probe side)
The input of a hash join streamed row by row against the hash table of the build side. *Owner: I-08.* See also: build side.

<a id="procedure-wizard"></a>
### procedure wizard
A dialog that creates a procedure, function, package or trigger from a per-dialect template in an edit console. *Owner: II-14.*

<a id="process"></a>
### process
A running program with its own memory, isolated by the operating system. *Owner: II-03.*

<a id="process-tree-kill"></a>
### process tree kill — process tree kill
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="producer"></a>
### producer
A program that writes messages to Kafka topics. Rowlit's Produce view acts as one: it sends up to 1 000 messages per request with `acks=all` and reports the partition and offset of each, plus Avro fields the schema did not write. *Owner: II-18.*

<a id="projection"></a>
### projection — تصویر
The algebra operation (π) that keeps only some columns; in SQL, the column list of `SELECT`. *Owner: I-02.*

<a id="projection-clickhouse"></a>
### projection (ClickHouse)
A hidden, differently sorted or pre-aggregated copy of data inside each part. Deeper: chosen automatically by the optimizer. *Owner: I-15.*

<a id="projection-pruning"></a>
### projection pruning — هرس ستون‌ها (projection pruning)
Reading and carrying only the columns a query uses. In column stores it is the main saving; in federation it reduces data fetched from sources. *Owner: I-08.* See also: predicate push-down.

<a id="protobuf"></a>
### Protobuf
Protocol Buffers: Google's schema-based binary format. Deeper: field numbers allow evolution. *Owner: I-16.*

<a id="provider"></a>
### provider — provider
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="provider-features"></a>
### provider features
`ProviderFeatures`: looks up a provider's keyed scripter, designer database, plan reader and binder by id; missing means `400 NOT_SUPPORTED`. *Owner: II-07.*

<a id="provider-registry"></a>
### provider registry
`ProviderRegistry`: every relational `IDbProvider` by id and dialect. *Owner: II-07.*

<a id="pub-sub"></a>
### pub/sub
Publish and subscribe messaging with no storage. Deeper: offline subscribers miss messages; use streams for durability. *Owner: I-16.*

<a id="publish"></a>
### publish — انتشار باینری
The .NET stage that assembles an application and, optionally, its runtime for a target RID. *Owner: II-24.*

<a id="push-down"></a>
### push-down
Sending part of a query (columns, filters, limits) to the system that holds the data, so less data travels. In Rowlit's federation it is an optimisation only: a fetch may return more rows than needed, never fewer, and DuckDB re-applies every predicate. *Owner: II-16.* See also: predicate push-down (I-08), projection, predicate.

<a id="push-down-plan"></a>
### push-down plan
What each mounted table of a query would be asked for (`PushdownPlan`): source query text, projection, predicates, limit, row cap, cache state, plus warnings. `POST /links/{cid}/plan` computes it without fetching. *Owner: II-16.*

<a id="pushdown-predicate"></a>
### pushdown predicate
A single-table condition `column OP literal(s)` that may be sent to a source: `=`, `<>`, `<`, `>`, `<=`, `>=`, `IN`, `BETWEEN`, `LIKE`, `IS NOT NULL`. Never IS NULL, OR, functions, parameters or a column on both sides; literals are typed and rendered per dialect. *Owner: II-16.*

<a id="qa-round"></a>
### qa round — qa round
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="qa-walkthrough"></a>
### qa walkthrough — qa walkthrough
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="query"></a>
### query — پرس‌وجو
A request for data (or, loosely, for any operation) sent to the DBMS as a statement. *Owner: I-01.*

<a id="query-analyzer"></a>
### query analyzer (links)
The component that reads a link statement's DuckDB AST and decides, per mounted table, the columns to fetch, the predicates a source may evaluate and whether a limit can be pushed (`QueryAnalyzer`). It is conservative and falls back to whole tables when unsure. *Owner: II-16.*

<a id="query-builder"></a>
### query builder (links)
The visual editor of link queries: tables on a canvas, joins drawn between columns, output, filters, grouping, sort and limit, with the compiled SQL beside it. Its state is a `BuilderModel`. *Owner: II-16.*

<a id="query-dsl"></a>
### query DSL
Elasticsearch's JSON language for searches: a body with `query`, `aggs`, `sort`, `highlight` and other keys. Rowlit passes the user's body through, adds `seq_no_primary_term` and exact totals, caps `size`, and offers context-aware completion of keys and field names. *Owner: II-18.*

<a id="query-id"></a>
### query id
A server-side id of one statement (Snowflake, ClickHouse `query_id`) used for plans, history and cancel. *Owner: II-09.*

<a id="query-parameter"></a>
### query parameter
A placeholder (`@id`, `:id`, `$1`, `?`) whose value is sent apart from the SQL text. *Owner: II-08.*

<a id="query-store"></a>
### Query Store — Query Store (انبارهٔ پرس‌وجو)
SQL Server feature that persists query texts, plans and runtime statistics in the database. Deeper: on by default for new databases in SQL Server 2022; can force plans. *Owner: I-13.*

<a id="queued-frames"></a>
### queued frames
Frames waiting in a client's hub queue; above `MaxQueuedFrames` (200 000) the client is disconnected. *Owner: II-06.*

<a id="quick-filter"></a>
### quick filter
The cell context-menu submenu that builds a filter condition from the cell's value and kind. *Owner: II-13.*

<a id="quit-guard"></a>
### quit guard
The check that warns about unsaved grid edits and open transactions before quitting or closing a window. *Owner: II-20.*

<a id="quorum"></a>
### quorum — حد نصاب
A majority (or a configured count) of nodes that must agree or acknowledge. Deeper: R + W > RF gives overlapping reads and writes. *Owner: I-12.*

<a id="quoting"></a>
### quoting
Wrapping an identifier so special characters, spaces and reserved words are allowed. Deeper: `[ ]`, `" "` or backticks; the closing character is doubled to escape it. *Owner: I-17.*

<a id="r1-r4-rules"></a>
### R1–R4 rules
The work-package rules in `docs/wp-notes/README.md`: own paths and labelled blocks, frozen files, requests for shared changes, hand-in gates. *Owner: II-07.*

<a id="raft"></a>
### Raft — Raft
Consensus algorithm with terms, an elected leader and majority-replicated log entries. Deeper: etcd, ClickHouse Keeper, KRaft. *Owner: I-12.*

<a id="random-io"></a>
### random I/O — ورودی/خروجی تصادفی (random I/O)
Reads of pages at scattered positions, each a separate request; much more expensive per page than sequential I/O, especially on hard disks. *Owner: I-06.* See also: sequential scan.

<a id="ranker"></a>
### ranker
The scoring that orders completion items: group × 1 000 + match score + usage boost + relevance, minus 20 for deprecated functions. Scores are written into Monaco's `sortText` as seven digits so Monaco keeps the order. *Owner: II-11.*

<a id="rbar"></a>
### RBAR — RBAR (ردیف به ردیف)
"Row by agonizing row": processing rows in a loop instead of one set-based statement. *Owner: I-13.*

<a id="rcsi"></a>
### RCSI (read committed snapshot isolation) — RCSI
SQL Server option that makes READ COMMITTED read row versions instead of waiting for locks. *Owner: I-10.*

<a id="rdb-aof"></a>
### RDB / AOF
Redis persistence: RDB is a point-in-time snapshot, AOF a log of write commands. Deeper: `appendfsync always/everysec/no`. *Owner: I-16.*

<a id="rdbms"></a>
### RDBMS — سامانه مدیریت پایگاه داده رابطه‌ای
Relational DBMS: a DBMS that stores data in related tables and is queried with SQL. *Owner: I-01.* See also: DBMS.

<a id="react"></a>
### React
The UI library (version 18.3) Rowlit's renderer is built with. *Owner: II-20.*

<a id="read-committed"></a>
### READ COMMITTED — READ COMMITTED
Isolation level that sees only committed data, with a new snapshot per statement in MVCC engines. Deeper: the default of PostgreSQL, SQL Server, Oracle and Snowflake. *Owner: I-09.*

<a id="read-only-connection"></a>
### read-only connection
A profile flagged read-only; the engine refuses non-queries (`403 READ_ONLY`) unless the user confirms. *Owner: II-08.*

<a id="read-only-enforcement"></a>
### read only enforcement — read only enforcement
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="read-only-guard"></a>
### read-only guard
`ReadOnlyGuard`: the engine check that refuses non-query batches on a read-only connection with `403 READ_ONLY` unless confirmed. *Owner: II-08.* See also: statement classifier.

<a id="read-skew"></a>
### read skew — انحراف خواندن (read skew)
Two reads in one transaction see different moments of related data. *Owner: I-09.*

<a id="read-uncommitted"></a>
### READ UNCOMMITTED — READ UNCOMMITTED
Weakest level; allows dirty reads where supported. *Owner: I-09.*

<a id="read-view"></a>
### read view — نمای خواندن (read view)
InnoDB's record of which transactions were active when a consistent read began. *Owner: I-10.*

<a id="read-your-writes"></a>
### read-your-writes — خواندن نوشته‌های خود
A client always sees its own earlier writes. *Owner: I-12.*

<a id="rebalancing"></a>
### rebalancing — توازن‌بخشی دوباره
Moving data between shards when shards are added or uneven. *Owner: I-12.*

<a id="reconnect"></a>
### reconnect
Opening a lost connection again; the UI's socket reconnects with backoff, a broken session reconnects on the next run. *Owner: II-06.*

<a id="record-view"></a>
### record view
The selected row shown as a vertical form, with edit and foreign-key navigation. *Owner: II-13.*

<a id="recovery-model"></a>
### recovery model — مدل بازیابی
SQL Server setting (SIMPLE, FULL, BULK_LOGGED) that decides when the log can be truncated and whether log backups exist. *Owner: I-11.*

<a id="recursive-cte"></a>
### recursive CTE — CTE بازگشتی
A CTE that refers to itself: an anchor member produces starting rows, a recursive member produces the next rows from the previous ones, until a step returns nothing. Used for trees and series. Cycles in the data make it run forever without a guard. *Owner: I-04.*

<a id="redis-cluster"></a>
### Redis Cluster
Redis horizontal scaling by 16,384 hash slots over several masters. Deeper: no strong consistency; `MOVED`/`ASK` redirects. *Owner: I-16.*

<a id="redis-command-table"></a>
### Redis command table
The file `redis-commands.json` with every Redis command's syntax, complexity, key positions and flags (`readonly`, `blocking`, `transaction`, `blocked` …). The engine uses it for read-only enforcement and dedicated routing, the UI for completion and hover; a test keeps the two copies identical. *Owner: II-17.*

<a id="redo"></a>
### redo — بازاجرا (redo)
Re-applying logged changes to pages that missed them. *Owner: I-11.*

<a id="redo-point"></a>
### redo point — نقطهٔ بازاجرا
Log position from which crash recovery starts, remembered at the start of the last checkpoint. *Owner: I-11.*

<a id="ref-cursor"></a>
### REF CURSOR
An Oracle pointer to an open result set. Deeper: out parameters of this type stream as extra result sets; cursor columns are shown as `{"$cursor":true}`. *Owner: II-09.*

<a id="referential-integrity"></a>
### referential integrity — تمامیت ارجاعی
The rule that every foreign key value matches an existing key (or is NULL). Enforced by the engine once the foreign key is declared (except in engines such as Snowflake, where foreign keys are informational only). *Owner: I-02.*

<a id="reflection"></a>
### reflection
The runtime API that inspects assemblies and types and creates instances. *Owner: II-07.*

<a id="refresh"></a>
### refresh
Making buffered documents searchable by writing a new segment (default every 1 s). Deeper: why Elasticsearch is near-real-time. *Owner: I-16.*

<a id="refresh-sources"></a>
### Refresh sources
The command that drops the fetched copies of a link's sources (one session or all) and forgets the link catalog, so the next query reads current data. *Owner: II-16.*

<a id="registry-pattern"></a>
### registry pattern
One object maps keys to implementations so callers never construct them. *Owner: II-07.*

<a id="reindex"></a>
### reindex
Copying documents from one Elasticsearch index (or several) into another, optionally filtered by a query or changed by a script. Rowlit starts it as a server task (`wait_for_completion=false`), polls its progress every 500 ms in an engine job, and cancels the server task when the job is cancelled. *Owner: II-18.*

<a id="rejson"></a>
### ReJSON (RedisJSON)
The Redis module that adds a JSON value type with commands such as `JSON.GET` and `JSON.SET`. Rowlit detects it with `MODULE LIST` and edits JSON keys through plain `Execute` calls. *Owner: II-17.*

<a id="relation"></a>
### relation — رابطه
The formal word for a table: a set of tuples that share the same attributes. *Owner: I-02.* See also: tuple, attribute.

<a id="relational-algebra"></a>
### relational algebra — جبر رابطه‌ای
The set of operations on relations (selection, projection, rename, product, union, difference, join, division) that optimizers use internally to represent and rewrite queries. *Owner: I-02.*

<a id="release-notes"></a>
### release notes — release notes
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="release-reason"></a>
### release reason
Why a session was released: `idle`, `closed`, `pressure` or `limit`. *Owner: II-08.*

<a id="release-vs-close"></a>
### release vs close — release vs close
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="released-results"></a>
### released results
A background result whose rows beyond the first 1 000 were dropped to save memory. *Owner: II-13.*

<a id="released-session"></a>
### released session
A session whose connection the engine closed on purpose; it reopens quietly on next use with the same id. *Owner: II-08.*

<a id="reload-vs-re-run"></a>
### reload vs re-run
*Reload* fetches released rows back from the engine's stored copy without running the query. *Re-run* executes the query again. *Owner: II-13.*

<a id="renderer"></a>
### renderer
The Chromium process that draws the web page; in Rowlit it is sandboxed and holds no driver. *Owner: II-03.*

<a id="repeatable-read"></a>
### REPEATABLE READ — REPEATABLE READ
Level that prevents non-repeatable reads. Deeper: lock-based in SQL Server (phantoms possible), snapshot isolation in PostgreSQL, hybrid in InnoDB (its default). *Owner: I-09.*

<a id="replica-set"></a>
### replica set
A MongoDB group of one primary and several secondaries holding the same data. Deeper: elections on failure; write concern controls durability. *Owner: I-16.*

<a id="replication"></a>
### replication — همانندسازی
Keeping live copies of data on other servers. *Owner: I-12.*

<a id="replication-factor"></a>
### replication factor (RF)
The number of nodes that store each partition. Deeper: per keyspace; usually 3 in production. *Owner: I-16.*

<a id="replication-lag"></a>
### replication lag — تأخیر همانندسازی
How far a replica is behind the primary. Deeper: `pg_stat_replication`, `Seconds_Behind_Source`, AG queues. *Owner: I-12.*

<a id="replication-slot"></a>
### replication slot — اسلات همانندسازی
PostgreSQL object that retains WAL until a consumer has received it. Deeper: an abandoned slot fills the disk; limit with `max_slot_wal_keep_size`. *Owner: I-12.*

<a id="residual-predicate"></a>
### residual predicate — گزارهٔ باقی‌مانده (residual predicate)
A condition checked after a row or index entry is read, which only discards rows (PostgreSQL `Filter`, SQL Server `Predicate`, Oracle `filter`). *Owner: I-07.* See also: seek predicate.

<a id="resource-manager"></a>
### resource manager — resource manager
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="resource-policy"></a>
### resource policy — resource policy
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="resp"></a>
### RESP
Redis Serialization Protocol: prefixed, `\r\n`-framed types (`+ - : $ *`). Deeper: RESP2 is common; RESP3 adds maps and push. *Owner: I-16.*

<a id="restore-drill"></a>
### restore drill — تمرین بازگردانی
Regularly restoring backups to prove they work and to measure the real RTO. *Owner: I-12.*

<a id="result-chart"></a>
### result chart
A chart (bar, line, pie, KPI and more) built from a result set or Data tab. A lazy chunk with settings remembered per query. *Owner: II-13.*

<a id="result-set"></a>
### result set — مجموعه نتیجه
The table of rows a query returns to the client. *Owner: I-01.*

<a id="result-store"></a>
### result store
`ResultStore`: the latest execution's capped rows per session (256 MB LRU) for paging, cell fetch and export. *Owner: II-08.*

<a id="result-writer"></a>
### result writer
`IResultWriter`: streams rows into CSV, TSV, JSON, SQL INSERT, Markdown or XLSX. *Owner: II-15.*

<a id="results-pane"></a>
### results pane — results pane
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="retention"></a>
### retention
The rule that deletes old Kafka data by age or size (default 7 days). Deeper: independent of whether consumers read it. *Owner: I-16.*

<a id="reverse-key-index"></a>
### reverse key index — نمایهٔ کلید معکوس (reverse key index)
Oracle index that stores key bytes reversed, spreading sequential inserts over many leaves to avoid a hot right-most block; it cannot serve range scans. *Owner: I-07.* See also: page split.

<a id="rewriter"></a>
### rewriter — بازنویس (rewriter)
Pipeline stage that applies always-valid transformations: view expansion, rules, row-level security, constant folding. *Owner: I-08.* See also: binder, optimizer.

<a id="rid"></a>
### RID — RID
Row identifier in a SQL Server heap: file : page : slot (8 bytes). Nonclustered indexes on a heap point to rows by RID. *Owner: I-06.* See also: RID lookup, ctid.

<a id="rid-lookup"></a>
### RID lookup — جست‌وجوی RID (RID lookup)
SQL Server operator that fetches a heap row by its RID after a nonclustered index seek. *Owner: I-07.* See also: key lookup.

<a id="role"></a>
### role
A named bundle of privileges that can be granted to users or other roles. Deeper: PostgreSQL makes no difference between users and roles (a role with `LOGIN`); Snowflake builds a role hierarchy. *Owner: I-14.* See also: privilege.

<a id="role-interface"></a>
### role interface
A small interface a class implements to announce one capability, discovered by a type test (`IObjectBrowserProvider`). *Owner: II-07.*

<a id="role-snowflake"></a>
### role (Snowflake)
Snowflake's unit of privileges; the current role decides what a session may see and do. *Owner: II-09.*

<a id="rollback"></a>
### rollback — بازگردانی (rollback)
Ending a transaction by undoing all its changes. *Owner: I-09.*

<a id="round-trip"></a>
### round trip — رفت‌وبرگشت
A request sent to the server and its reply coming back. Deeper: fixed network cost per statement. *Owner: I-13.*

<a id="route-group"></a>
### route group
A shared path prefix for several endpoints (`/api/v1/sessions`). *Owner: II-05.*

<a id="row-cap"></a>
### row cap (max rows per source)
The most rows read from one mounted table per query, 2,000,000 by default (`links.maxRowsPerSource`). The source is asked for cap + 1 rows to detect truncation, which the plan reports as `rowCap`. *Owner: II-16.*

<a id="row-chaining"></a>
### row migration / chaining — مهاجرت سطر / زنجیره‌شدن سطر
Oracle: migration moves a grown row to another block leaving a pointer; chaining splits a row larger than a block over several blocks. Both cost extra reads. *Owner: I-06.* See also: forwarded record, PCTFREE.

<a id="row-level-security"></a>
### row-level security (RLS)
A predicate the engine adds to every query on a table so a user sees only some rows. Deeper: PostgreSQL policies, SQL Server security policies, Oracle VPD, Snowflake row access policies; owners and superusers can bypass unless forced. *Owner: I-14.*

<a id="row-overflow"></a>
### row-overflow — سرریز سطر (row-overflow)
SQL Server allocation unit for variable-length values that push a row past 8,060 bytes; the row keeps a 24-byte pointer. *Owner: I-06.* See also: LOB.

<a id="row-source"></a>
### row source
A reader that streams rows from an import file (CSV, TSV, XLSX, JSON, NDJSON). *Owner: II-15.*

<a id="row-store"></a>
### row store
Storage that keeps all fields of a row together. Deeper: best for fetching or updating whole rows. *Owner: I-15.*

<a id="row-versioning"></a>
### row versioning — نسخه‌بندی سطرها
SQL Server's MVCC: previous row versions kept in the version store. *Owner: I-10.*

<a id="rowid"></a>
### rowid / ROWID — rowid / ROWID
SQLite: the 64-bit integer key of every rowid table (aliased by `INTEGER PRIMARY KEY`). Oracle: the physical address of a row (object, file, block, row). *Owner: I-06.* See also: RID, ctid.

<a id="rpo"></a>
### RPO (recovery point objective) — هدف نقطهٔ بازیابی (RPO)
Maximum acceptable data loss, measured in time. *Owner: I-12.*

<a id="rto"></a>
### RTO (recovery time objective) — هدف زمان بازیابی (RTO)
Maximum acceptable time until the system works again. *Owner: I-12.*

<a id="run-target"></a>
### run target
What Run executes: the selection, else the statement at the cursor, else the whole document for Run script. *Owner: II-12.*

<a id="saga"></a>
### saga — saga (زنجیرهٔ تراکنش‌های جبران‌پذیر)
A sequence of local transactions with compensating actions instead of one distributed transaction. *Owner: I-12.*

<a id="sai"></a>
### SAI — نمایهٔ پیوست به ذخیره‌سازی (SAI)
Cassandra 5's storage-attached index, built per SSTable and memtable, supporting equality and range queries on non-key columns much more cheaply than legacy secondary indexes. *Owner: I-07.* See also: secondary index.

<a id="sandbox"></a>
### sandbox — sandbox
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="sargable"></a>
### SARGable — SARGable (قابل‌جست‌وجو با نمایه)
A predicate the engine can answer with an index: the column alone on one side of the comparison. *Owner: I-13.*

<a id="saved-filter"></a>
### saved filter
A named grid filter stored by the engine per connection and column signature. *Owner: II-13.*

<a id="saved-query"></a>
### saved query
A query stored in `queries.json` under a connection, database and schema. A bound console saves back to it with Ctrl+S. *Owner: II-10.*

<a id="savepoint"></a>
### savepoint — نقطهٔ ذخیره (savepoint)
Named marker inside a transaction; rolling back to it undoes only later work. *Owner: I-09.*

<a id="savepoint-per-statement"></a>
### savepoint per statement
PostgreSQL decision D-PG3: each manual-mode batch runs inside `SAVEPOINT dbstudio_stmt`, so one error does not abort the transaction. *Owner: II-08.*

<a id="scan"></a>
### SCAN
The Redis command that walks the keyspace with a cursor, doing a bounded amount of work per call, instead of `KEYS *`, which blocks the server. Rowlit's key browser also stops each request after 400 ms or 64 calls and lets the user press "Scan more". *Owner: II-17.*

<a id="scatter-gather"></a>
### scatter-gather — پخش و گردآوری (scatter-gather)
Sending a query to every shard and merging the results. *Owner: I-12.*

<a id="schema"></a>
### schema — اسکیما
Two meanings. (1) Structure: the definition of tables, columns and types. (2) Namespace: a named container of objects inside a database (`sales.invoices`). In Oracle a schema is a user; in MySQL "schema" means database. *Owner: I-01.* See also: namespace.

<a id="schema-analysis"></a>
### schema analysis (Mongo)
Inferring the shape of a schemaless collection from a sample of its documents: field paths, type distributions, probabilities and min/max/distinct statistics. In Rowlit it runs as a job over 1 000 documents by default. *Owner: II-17.*

<a id="schema-compare"></a>
### schema compare — schema compare
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="schema-mode"></a>
### schema mode
`None`, `ReadOnly` or `Session`: whether a session's default schema can be changed. *Owner: II-08.*

<a id="schema-registry"></a>
### Schema Registry
A service storing versioned schemas for Kafka messages and enforcing compatibility. Deeper: messages carry a magic byte and a 4-byte schema id. *Owner: I-16.*

<a id="scn"></a>
### SCN (system change number) — شمارهٔ تغییر سیستم (SCN)
Oracle's database-wide logical clock stamped on every commit. *Owner: I-10.*

<a id="scope-colour"></a>
### scope colour
A colour tag on a database or schema, stored in `settings.ui.scopeColors`. *Owner: II-10.*

<a id="scoped-source-fetcher"></a>
### scoped source fetcher
A fetcher that can list what a wide member spans (`IScopedSourceFetcher`): the connection's default database and schema, its databases and the schemas of one database, names only. Relational and MongoDB fetchers implement it. *Owner: II-16.*

<a id="scram"></a>
### SCRAM
Salted Challenge Response Authentication Mechanism: both sides prove they know the password by answering a fresh challenge, without sending it. Deeper: the server stores a salted, iterated hash; `-PLUS` variants bind to the TLS channel. *Owner: I-14.* See also: TLS.

<a id="script"></a>
### script
The whole editor text, run with the label `script`. *Owner: II-08.*

<a id="scriptdom"></a>
### ScriptDom
Microsoft's T-SQL parser library; Rowlit uses it for SQL Server syntax diagnostics. *Owner: II-09.*

<a id="scroll-es"></a>
### scroll (Elasticsearch)
A way to read a whole result set page by page through a server-side context kept alive for a given time. Rowlit's export job scrolls 1 000 documents at a time with a 2-minute keep-alive and clears the scroll at the end. *Owner: II-18.*

<a id="search-after"></a>
### search_after
Elasticsearch paging by the sort values of the last hit instead of a growing `from` offset, so deep pages stay cheap (the idea of keyset pagination). When the Rowlit paging toolbar sends `search_after`, the engine removes `from` from the body. *Owner: II-18.* See also: keyset pagination.

<a id="search-engine"></a>
### search engine
A system built around an inverted index for relevance-ranked text search. Deeper: Elasticsearch, OpenSearch, Solr. *Owner: I-16.*

<a id="search-path"></a>
### search_path
PostgreSQL's ordered list of schemas used to resolve unqualified names. Deeper: default `"$user", public`. *Owner: I-17.*

<a id="secondary-index"></a>
### secondary index — نمایهٔ ثانویه (secondary index)
Any index other than the one that orders the table itself. In Cassandra, a node-local index on a non-key column that requires a query to every node. *Owner: I-07.* See also: SAI, clustered index.

<a id="secret-store"></a>
### secret store — secret store
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="seed"></a>
### seed — seed
A script that creates and fills a database with known data. The handbook's `shop` seeds are in `engine/tests/docker/`. *Owner: I-18.* See also: fixture.

<a id="seek-predicate"></a>
### seek predicate — گزارهٔ جست‌وجو (seek predicate)
A condition that limits which part of an index is read (SQL Server `Seek Predicates`, Oracle `access`, PostgreSQL `Index Cond` on leading columns). *Owner: I-07.* See also: residual predicate.

<a id="segment"></a>
### segment
An immutable mini-index inside a Lucene shard. Deeper: deletes are marks; merges rewrite segments. *Owner: I-16.*

<a id="selection"></a>
### selection — گزینش
The algebra operation (σ) that keeps the rows satisfying a condition; in SQL, `WHERE`. Not the SQL `SELECT` keyword. *Owner: I-02.*

<a id="selectivity"></a>
### selectivity — گزینندگی (selectivity)
The fraction of rows a predicate keeps; "highly selective" means a small fraction. The optimizer multiplies it by row counts to estimate cardinalities. *Owner: I-07.* See also: cardinality estimate.

<a id="selector"></a>
### selector
A function passed to a store hook that picks the part of state a component needs. *Owner: II-20.*

<a id="self-contained"></a>
### self-contained — همراه runtime
A .NET publication that carries the runtime instead of requiring a system installation. *Owner: II-24.*

<a id="self-extract"></a>
### self-extract
A single-file .NET app unpacking bundled native libraries at start (`IncludeNativeLibrariesForSelfExtract`). *Owner: II-09.*

<a id="semantic-versioning"></a>
### semantic versioning — semantic versioning
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="semi-join"></a>
### semi-join — نیم‌پیوند (semi-join)
A join that returns each row of one input at most once if a match exists (`EXISTS`, `IN`). Subquery unnesting turns such subqueries into semi-joins. *Owner: I-08.* See also: anti-join.

<a id="sentinel"></a>
### Sentinel
Redis watcher processes that detect a failed primary and promote a replica. Deeper: quorum-based; one shard of data. *Owner: I-16.*

<a id="separation-of-concerns"></a>
### separation of concerns
Each part handles one kind of problem. *Owner: II-03.*

<a id="seq-no-primary-term"></a>
### seq_no / primary_term
Elasticsearch counters returned on each write. Deeper: `if_seq_no` and `if_primary_term` give optimistic concurrency. *Owner: I-16.*

<a id="sequence"></a>
### sequence — سکوئنس
A database object that hands out unique increasing numbers (`CREATE SEQUENCE`). *Owner: I-04.* See also: identity column.

<a id="sequence-number"></a>
### sequence number
A counter on stream batches (`seq`) that lets the UI detect gaps. *Owner: II-06.*

<a id="sequential-scan"></a>
### sequential scan — پویش ترتیبی (sequential scan)
Reading all pages of a table in file order; cheap per page thanks to read-ahead and large requests. *Owner: I-06.* See also: table scan, random I/O.

<a id="serial"></a>
### serial
PostgreSQL's older shorthand for an integer column with a sequence default. Deeper: replaced by identity columns. *Owner: I-17.*

<a id="serializable"></a>
### SERIALIZABLE — SERIALIZABLE
Strongest level: the result equals some serial order. Deeper: 2PL in SQL Server and MySQL, SSI in PostgreSQL, snapshot isolation in Oracle. *Owner: I-09.*

<a id="serialization-failure"></a>
### serialization failure — شکست سریال‌پذیری
Error telling the application to retry the transaction (SQLSTATE 40001, SQL Server 3960, ORA-08177). *Owner: I-09.*

<a id="serilog"></a>
### Serilog
A .NET structured-logging library; the engine writes `logs/engine-<date>.log` with it. *Owner: II-05.*

<a id="server-diagnostics"></a>
### server diagnostics
Syntax errors found by the database's own parser through the engine (`POST /sql/diagnostics`): ScriptDom for SQL Server, a prepare for PostgreSQL and SQLite. They are debounced 400 ms, superseded by newer requests and shown as markers next to the soft ones; other dialects answer `NOT_SUPPORTED`. *Owner: II-11.*

<a id="server-vs-client-filter"></a>
### server filter vs client filter
A server filter becomes a parameterised `WHERE` in a new query. A client filter is applied to rows already loaded. *Owner: II-13.*

<a id="service-lifetime"></a>
### service lifetime
How long a DI instance lives: singleton, scoped (per request) or transient. *Owner: II-05.*

<a id="session"></a>
### session — نشست
The server-side state of one connection: user, current database, open transaction, temporary tables, settings. *Owner: I-01.*

<a id="session-handle"></a>
### session handle
`SessionHandle`: wraps an `IDbSession` with busy reservation, activity, release state and owner. *Owner: II-08.*

<a id="session-restore"></a>
### session restore
On boot, re-attaching live engine sessions to the tabs that owned them, so open transactions survive a reload. *Owner: II-20.*

<a id="set-operation"></a>
### set operation — عملگر مجموعه‌ای
`UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT` (Oracle `MINUS`): combine the results of two queries with the same columns. *Owner: I-03.*

<a id="settings-bag"></a>
### settings bag (`settings.ui`)
The free-form object in settings where features keep their own keys without engine changes. *Owner: II-20.*

<a id="severity"></a>
### severity — severity
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="shard-key"></a>
### shard key — کلید شارد
Column(s) that decide on which shard a row lives. *Owner: I-12.*

<a id="shard-replica-elasticsearch"></a>
### shard / replica (Elasticsearch)
A shard is one Lucene index holding part of an index; a replica is a copy. Deeper: primary shard count is fixed at creation. *Owner: I-16.*

<a id="sharding"></a>
### sharding — شاردینگ
Spreading rows over independent servers. *Owner: I-12.*

<a id="shared-lock"></a>
### shared lock (S) — قفل اشتراکی
Lock for reading; many holders allowed. *Owner: I-10.*

<a id="shell-json"></a>
### shell JSON
The relaxed JSON that people type in the MongoDB shell: comments, single quotes, unquoted keys, regex literals and helpers such as `ObjectId("…")` or `ISODate("…")`. Rowlit parses it straight to BSON with a hand-written parser whose errors carry line and column. *Owner: II-17.*

<a id="shortcut-sheet"></a>
### shortcut sheet — shortcut sheet
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="sidecar"></a>
### sidecar
A helper process started and owned by the main application, living and dying with it; Rowlit's engine. *Owner: II-03.*

<a id="sign-off"></a>
### sign off — sign off
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="signature-help"></a>
### signature help
The box that shows a function's or procedure's parameters while you type its arguments, with the current parameter highlighted. Rowlit counts depth-0 commas, follows Oracle named arguments (`p => v`) and T-SQL `EXEC p a, b`, and prefers user routines over built-ins. *Owner: II-11.*

<a id="single-file"></a>
### single-file — تک‌فایلی
A .NET publish mode that bundles managed application payloads into one apphost. *Owner: II-24.*

<a id="single-instance-lock"></a>
### single instance lock — single instance lock
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="singleton"></a>
### singleton
One instance for the whole process lifetime; almost every engine service is one. *Owner: II-05.*

<a id="sink"></a>
### sink
The object an execution reports to (`IExecutionSink`): result sets, rows, messages, errors. *Owner: II-08.* See also: observer.

<a id="skip-index"></a>
### skip index — نمایهٔ پرش (skip index)
ClickHouse data skipping index (`minmax`, `set`, `bloom_filter`, `tokenbf_v1`, `ngrambf_v1`): a summary per block of granules that lets reads skip blocks that cannot match. *Owner: I-07.* See also: sparse index, zone map.

<a id="skip-locked"></a>
### SKIP LOCKED — SKIP LOCKED
Locking-read option that skips rows other transactions hold; the basis of database job queues. *Owner: I-10.*

<a id="skip-scan"></a>
### skip scan — پویش پرشی (skip scan)
Using a composite index without its leading column by seeking once per distinct leading value (Oracle, MySQL 8.0.13+, SQLite after `ANALYZE`, PostgreSQL 18). *Owner: I-07.* See also: leftmost prefix.

<a id="skippable-test"></a>
### skippable test — skippable test
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="slotted-page"></a>
### slotted page — صفحهٔ شکاف‌دار (slotted page)
Page layout with a header, a slot array pointing to rows, free space, and rows packed from the other end; rows can move inside the page without changing their address. *Owner: I-06.* See also: line pointer.

<a id="slow-query-log"></a>
### slow query log — لاگ پرس‌وجوهای کند
Log of statements slower than a threshold (MySQL `long_query_time`, PostgreSQL `log_min_duration_statement`). *Owner: I-13.*

<a id="slowlog"></a>
### slowlog (Redis)
Redis' in-memory list of commands that ran longer than a threshold (`SLOWLOG GET`, `SLOWLOG RESET`). Rowlit reads it on request in the Slowlog tab and also as a log source in the Logs view. *Owner: II-17.*

<a id="smartscreen"></a>
### smartscreen — smartscreen
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="smoke-test"></a>
### smoke test — smoke test
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="snapshot"></a>
### snapshot (catalog)
The compact JSON of the loaded schemas of a database, with a version and an ETag. *Owner: II-10.*

<a id="snapshot-isolation"></a>
### snapshot isolation — جداسازی تصویر لحظه‌ای
Each transaction reads one snapshot; first committer wins on write conflicts. Deeper: allows write skew. *Owner: I-09.*

<a id="snapshot-mvcc"></a>
### snapshot (MVCC) — تصویر لحظه‌ای (snapshot)
The set of committed transactions a statement or transaction sees. *Owner: I-10.*

<a id="sni"></a>
### SNI
SQL Server Network Interface, SqlClient's native network library on Windows. *Owner: II-09.*

<a id="snippet"></a>
### snippet
A reusable SQL template with a prefix and placeholders, built in per dialect or defined by the user. *Owner: II-12.*

<a id="snippet-placeholder"></a>
### snippet placeholder
A stop in a snippet body: `$1`, `${1:default}`, `$0`. *Owner: II-12.*

<a id="snowflake-data"></a>
### Snowflake.Data
Snowflake's .NET driver (6.4.0 in Rowlit). *Owner: II-09.*

<a id="soft-diagnostics"></a>
### soft diagnostics
Instant warnings computed in the UI by the IntelliSense, without the server: unterminated strings, unbalanced parentheses, unknown tables or columns, duplicate aliases, `DELETE` without `WHERE` and more. They are only raised when the relevant schema is loaded, so a lazy catalog never causes false alarms. *Owner: II-11.*

<a id="solid"></a>
### SOLID
Five object-oriented design principles: single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion. *Owner: II-03.*

<a id="source"></a>
### source — source
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

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

<a id="sp-gist"></a>
### SP-GiST — SP-GiST
PostgreSQL's space-partitioned GiST: unbalanced partitioning trees (quadtrees, k-d trees, radix tries) for points, IP ranges and text prefixes. *Owner: I-07.* See also: GiST.

<a id="sparse-index"></a>
### sparse index — نمایهٔ تُنُک (sparse index)
An index with one entry per block of rows rather than per row, such as ClickHouse's primary index (one mark per 8,192-row granule). Tiny, but requires data sorted by the key. *Owner: I-07.* See also: skip index.

<a id="spill"></a>
### spill — سرریز به دیسک (spill)
Writing a sort, hash table or aggregate to disk because it exceeded its memory budget; often ten times slower. Usually caused by underestimated rows. *Owner: I-08.* See also: memory grant, pipeline breaker.

<a id="split-brain"></a>
### split brain — دوپارگی (split brain)
Two nodes both acting as primary and accepting writes. *Owner: I-12.*

<a id="splitter"></a>
### splitter (statement splitter)
The step that finds where statements and batches begin and end. Rowlit's handles `;`, T-SQL `GO [n]`, Oracle `/` and PL/SQL blocks, MySQL `DELIMITER`, dollar-quoted bodies and blank lines, and drives Ctrl+Enter, the parser and "run script". *Owner: II-11.*

<a id="sql"></a>
### SQL — SQL
Structured Query Language: the declarative language of relational databases. You say what result you want, and the DBMS decides how to compute it. *Owner: I-01.*

<a id="sql-injection"></a>
### SQL injection
Making a program run attacker-chosen SQL because input was glued into the statement text. Deeper: fixed by parameters for values and allowlists for identifiers. *Owner: I-14.* See also: parameterised query.

<a id="sqlite-fallback-engine"></a>
### SQLite fallback engine
The federation engine used when libduckdb cannot load: an in-memory SQLite with one attached database per alias. It guarantees only the builder's SQL subset, has no parser (whole tables are read) and does not spill. *Owner: II-16.*

<a id="sqlite-master"></a>
### sqlite_master
SQLite's table of schema objects (also `sqlite_schema`). Deeper: combined with `pragma_*` functions. *Owner: I-17.*

<a id="sqlstate"></a>
### SQLSTATE
The five-character standard SQL error code (e.g. `42P01`). *Owner: II-09.*

<a id="ssh-tunnel"></a>
### SSH tunnel
An encrypted pipe through an SSH server that forwards a local port to the database. *Owner: II-08.*

<a id="ssi"></a>
### SSI (serializable snapshot isolation) — جداسازی تصویر لحظه‌ای سریال‌پذیر (SSI)
Snapshot isolation plus detection of dangerous read/write dependencies; PostgreSQL SERIALIZABLE. *Owner: I-09.*

<a id="sslmode"></a>
### sslmode
PostgreSQL's TLS setting: `disable`, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`. Deeper: only `verify-full` prevents impersonation. *Owner: I-14.*

<a id="sso"></a>
### SSO (single sign-on)
Logging in once with an identity provider and reusing that login for many services. Deeper: Snowflake `externalbrowser` opens the provider in a browser and hands the database a proof. *Owner: I-14.* See also: OAuth, Kerberos.

<a id="sstable"></a>
### SSTable
An immutable sorted file of data flushed from a memtable. Deeper: accompanied by index, summary and Bloom filter files. *Owner: I-16.*

<a id="stage"></a>
### stage
A named location for files used by `COPY INTO` (Snowflake). Deeper: internal or external (a cloud bucket). *Owner: I-15.*

<a id="stage-preview"></a>
### stage preview
The result of running an aggregation pipeline only up to one stage, shown under that stage's card. Rowlit previews 10 documents, debounced 500 ms, and never runs a trailing `$out` or `$merge` in a preview. *Owner: II-17.*

<a id="star-schema"></a>
### star schema
A fact table surrounded by dimension tables. Deeper: denormalised dimensions; "snowflake schema" normalises them. *Owner: I-15.*

<a id="statement"></a>
### statement
One SQL command. *Owner: II-08.*

<a id="statement-classifier"></a>
### statement classifier
`StatementClassifier`: heuristic classification of statements (Query, Dml, Ddl…) for read-only, history and catalog invalidation. *Owner: II-08.*

<a id="statement-model"></a>
### statement model
The structure the partial parser builds for one statement: a tree of scopes with their table sources, CTEs, projections, joins, clause markers, identifier chains, and the tables and variables the statement creates. Cached per statement under its start offset and text. *Owner: II-11.*

<a id="statement-scope"></a>
### scope (statement model)
One query level inside a statement: the main SELECT, a subquery, a CTE body, an EXISTS, a PL/SQL block. A scope owns its sources and markers; an `outer` link lets correlated subqueries and LATERAL/APPLY see the enclosing sources. *Owner: II-11.*

<a id="statistics"></a>
### statistics — آمار (statistics)
Summaries the optimizer keeps about tables and columns: row and page counts, nulls, distinct values, most common values, histograms, correlation. Refreshed by `ANALYZE`, auto-stats or `DBMS_STATS`. *Owner: I-07.* See also: histogram, cardinality estimate.

<a id="status-bar"></a>
### status bar — status bar
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="steal-no-force"></a>
### steal / no-force — steal / no-force
Buffer policy: uncommitted pages may be written (steal), committed ones need not be (no-force). Deeper: requires both undo and redo. *Owner: I-11.*

<a id="stored-procedure"></a>
### stored procedure — رویه ذخیره‌شده
Code stored in the database and run with `CALL` or `EXEC`; may change data, return result sets and OUT parameters. *Owner: I-04.* See also: function.

<a id="stream"></a>
### stream — stream
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="stream-snowflake"></a>
### stream (Snowflake)
An object that records changes to a table since last consumed. Deeper: built-in change data capture. *Owner: I-15.*

<a id="streaming-replication"></a>
### streaming replication — همانندسازی جریانی
PostgreSQL physical replication over a continuous WAL stream. *Owner: I-12.*

<a id="strict"></a>
### STRICT
A SQLite table option that enforces column types. *Owner: II-09.*

<a id="structured-logging"></a>
### structured logging
Logging that keeps named values (`{Port}`) as data, not only text. *Owner: II-05.*

<a id="stub"></a>
### stub
Placeholder code that stands in until the real change lands, marked `TODO(WP<XX>-shared)`. *Owner: II-07.*

<a id="subject"></a>
### subject
The Schema Registry name under which versions of a schema are stored (usually `<topic>-value`). Deeper: has a compatibility mode. *Owner: I-16.*

## I-17 Dialect comparison

<a id="subquery"></a>
### subquery — زیرپرس‌وجو
A `SELECT` inside another statement, in parentheses: scalar (one value), `IN` (one column), `EXISTS`, or a derived table. *Owner: I-04.*

<a id="subscription"></a>
### subscription
A handler registered for one event type or id (`executionId`, `streamId`, `jobId`) on `EngineSocket`. *Owner: II-06.*

<a id="suggest-guard"></a>
### suggest guard
A small patch on Monaco's suggest model (`suggest-guard.ts`) that swallows one re-entrancy `TypeError` in Monaco 0.57 when the completion model disappears mid-call. Any other error is rethrown. *Owner: II-11.*

<a id="supervisor"></a>
### supervisor — supervisor
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="supply-chain"></a>
### supply chain — supply chain
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="surrogate-key"></a>
### surrogate key — کلید جانشین
A system-generated identifier with no business meaning, such as an identity integer or a UUID. Stable and small. *Owner: I-02.* See also: natural key.

<a id="switchover"></a>
### switchover — جابه‌جایی برنامه‌ریزی‌شده (switchover)
A planned role change between primary and replica without data loss. *Owner: I-12.*

<a id="symbol"></a>
### symbol
The named thing under the cursor once resolved: an alias, a table, a column, a CTE, a variable, a function, a package member, a schema, a database. `symbolAt` computes it once and both hover and go to definition use it. *Owner: II-11.*

<a id="synchronous-replication"></a>
### synchronous replication — همانندسازی همگام
COMMIT waits for at least one replica to confirm. *Owner: I-12.*

<a id="synonym"></a>
### synonym — مترادف
An alias for another database object (SQL Server, Oracle). *Owner: I-04.*

<a id="sys-catalog-views"></a>
### sys catalog views
SQL Server's catalog views (`sys.tables`, `sys.columns`, `sys.objects`). Deeper: richer than `INFORMATION_SCHEMA`. *Owner: I-17.*

<a id="system-catalog"></a>
### system catalog — فهرست سیستمی
The tables and views in which the DBMS stores definitions of its own objects (`information_schema`, `pg_catalog`, `sys.*`). Tools such as Rowlit read it to show the object tree. *Owner: I-01.*

<a id="system-schema"></a>
### system_schema
Cassandra's keyspace of schema tables (`keyspaces`, `tables`, `columns`). Deeper: partitioned by keyspace. *Owner: I-17.*

<a id="system-tables"></a>
### system.* tables
ClickHouse's metadata and monitoring tables (`system.tables`, `system.parts`, `system.query_log`). Deeper: read-only views of server state. *Owner: I-17.*

<a id="system-type"></a>
### system type
A built-in data type, listed read-only in SQL Server's "System Data Types" group. *Owner: II-10.*

<a id="t-sql"></a>
### T-SQL
Transact-SQL, SQL Server's dialect and procedural language. Deeper: `@variables`, `TRY…CATCH`, `GO`. *Owner: I-17.*

<a id="tab-kind"></a>
### tab kind
`console`, `object` or `view`; a `view` tab names a component registered with `registerTabView`. *Owner: II-20.*

<a id="table-diff"></a>
### table diff
`TableDiff.Compute(original, desired)`: columns matched by id then name, constraints by structure, producing a change list. *Owner: II-14.*

<a id="table-model"></a>
### table model
`TableModel`: the provider-neutral description of a table the designer edits. *Owner: II-14.*

<a id="table-partitioning"></a>
### table partitioning — پارتیشن‌بندی جدول
Splitting one logical table into physical pieces by range, list or hash. *Owner: I-12.*

<a id="table-scan"></a>
### table scan — پویش جدول (table scan)
An access path that reads every row of a table (PostgreSQL `Seq Scan`, SQL Server `Table Scan` / `Clustered Index Scan`, Oracle `TABLE ACCESS FULL`, MySQL `type: ALL`). Right for large fractions and small tables. *Owner: I-08.* See also: sequential scan.

<a id="table-variable"></a>
### table variable — متغیر جدولی
SQL Server: a variable of table type (`DECLARE @t TABLE (...)`) scoped to a batch. *Owner: I-04.* See also: temporary table.

<a id="tablespace"></a>
### tablespace — فضای جدول (tablespace)
A named group of data files where objects are placed (Oracle, PostgreSQL, InnoDB; SQL Server filegroups). *Owner: I-06.* See also: extent.

<a id="tail"></a>
### tail (live tail)
Following a log or topic and showing new entries as they arrive, like `tail -f`. In Rowlit a Kafka tail is a `kafka.tail` stream that starts at the high watermark (or given offsets) and can be filtered, paused and resumed; the UI keeps the newest 10 000 messages. *Owner: II-18.*

<a id="task-es"></a>
### task (Elasticsearch)
A long-running operation that Elasticsearch runs on the server and exposes under `_tasks` (reindex, update-by-query, delete-by-query…), with status and an optional cancel. Rowlit shows them live through the `es.tasks` stream and cancels cancellable ones. *Owner: II-18.*

<a id="task-snowflake"></a>
### task (Snowflake)
A scheduled or stream-triggered SQL statement. Deeper: tasks can form a dependency graph. *Owner: I-15.*

<a id="tcl"></a>
### TCL — TCL
Transaction Control Language: `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`. *Owner: I-03.*

<a id="tde"></a>
### TDE (transparent data encryption)
Encryption of data files below the SQL layer, invisible to applications. Deeper: protects stolen disks and backups, not authorised users; the key must be stored elsewhere. *Owner: I-14.*

<a id="temp-objects"></a>
### temp objects
Temporary tables or objects a session created; such sessions are never released automatically. *Owner: II-08.*

<a id="temp-table"></a>
### temporary table — جدول موقت
A table visible only to the session (or transaction) that created it and dropped automatically afterwards. *Owner: I-04.*

<a id="testcontainers"></a>
### testcontainers — testcontainers
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="text-fallback"></a>
### text fallback (analyzer)
What the link analyzer does when DuckDB cannot serialize a statement (PIVOT, DESCRIBE, SHOW…): fetch every table named `alias.table` in the text, whole and without predicates, with the warning `fallback`. *Owner: II-16.*

<a id="theme"></a>
### theme
A named set of design-token overrides. Rowlit has 7 app themes and 22 code themes. *Owner: II-20.*

<a id="threat-model"></a>
### threat model — threat model
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="three-valued-logic"></a>
### three-valued logic — منطق سه‌مقداری
SQL's logic with TRUE, FALSE and UNKNOWN. Any comparison with NULL is UNKNOWN; `WHERE` keeps only TRUE. *Owner: I-02.* See also: NULL.

<a id="throttling"></a>
### throttling — throttling
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="throughput"></a>
### throughput — توان عملیاتی (throughput)
Operations completed per unit of time. *Owner: I-13.*

<a id="time-travel"></a>
### time travel
Querying or restoring data as it was in the past. Deeper: Snowflake keeps history for 1 to 90 days, then 7 days fail-safe. *Owner: I-15.*

<a id="time-zone"></a>
### time zone — منطقه زمانی
The offset rules used to display or interpret a timestamp. Store instants in UTC or in a type that normalises to UTC. *Owner: I-05.*

<a id="timeout-deadline"></a>
### timeout / deadline
A time limit after which a call is abandoned. Catalog calls use 15 s, 30 s and 5 min depending on the call. *Owner: II-10.*

<a id="timeprovider"></a>
### TimeProvider
.NET's injectable clock; tests use it to move time. *Owner: II-05.*

<a id="tls"></a>
### TLS (Transport Layer Security)
The protocol that encrypts and authenticates a network connection (successor of SSL). Deeper: gives confidentiality, integrity and, with certificate verification, server authenticity. *Owner: I-14.*

<a id="toast"></a>
### TOAST — TOAST
PostgreSQL's off-row storage: values in rows wider than about 2 KB are compressed and/or moved in chunks to a side table, leaving an 18-byte pointer. *Owner: I-06.* See also: off-row, LOB.

<a id="token"></a>
### token
The smallest unit a lexer produces: a word, string, number, operator, punctuation or comment, with its offsets and line. Rowlit's tokens also carry an upper-cased copy for keyword matching and an `unterminated` flag. *Owner: II-11.*

<a id="token-equality-check"></a>
### token-equality check
The formatter's safety net: the formatted text is lexed again and must have the same tokens (case of words aside) or the original is kept. *Owner: II-12.*

<a id="token-ring"></a>
### token ring
Cassandra's hash space (−2⁶³ to 2⁶³−1) divided among nodes. Deeper: virtual nodes spread ownership. *Owner: I-16.*

<a id="tombstone"></a>
### tombstone
A marker that hides deleted data in an immutable-file store. Deeper: kept for `gc_grace_seconds` (10 days default); many tombstones slow reads. *Owner: I-16.*

<a id="topic"></a>
### topic
A named stream of records in Kafka, split into partitions. Deeper: retention and compaction are per topic. *Owner: I-16.*

<a id="torn-page"></a>
### torn page — صفحهٔ پاره (torn page)
A page only partly written when power failed. *Owner: I-11.*

<a id="tracing-cql"></a>
### tracing (CQL)
Cassandra's per-request record of coordinator work in `system_traces`; Rowlit's replacement for EXPLAIN. *Owner: II-09.*

<a id="transaction"></a>
### transaction — تراکنش
Statements treated as one all-or-nothing unit of work. *Owner: I-09.*

<a id="transaction-id-wraparound"></a>
### transaction id wraparound — دورزدن شناسهٔ تراکنش (wraparound)
PostgreSQL's 32-bit transaction ids running around; prevented by freezing. *Owner: I-10.*

<a id="transaction-log"></a>
### transaction log — لاگ تراکنش
SQL Server's name for its write-ahead log (`.ldf`). *Owner: I-11.*

<a id="transaction-mode"></a>
### transaction mode
`Auto` (driver autocommit) or `Manual` (engine transaction until Commit or Rollback). *Owner: II-08.*

<a id="trigger"></a>
### trigger — تریگر
Code that runs automatically before or after an `INSERT`, `UPDATE` or `DELETE` on a table. *Owner: I-04.*

<a id="trigger-character"></a>
### trigger character
A character that opens the completion list by itself. Rowlit's are `. ( , @ : # [ "` and the space, the space only after words such as `FROM`, `JOIN`, `ON` or `INTO`. *Owner: II-11.*

<a id="trim"></a>
### trim — trim
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

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

<a id="ttl"></a>
### TTL (time to live)
A lifetime after which data expires automatically. Deeper: Redis `EXPIRE`, Cassandra TTL, MongoDB TTL index. *Owner: I-16.*

<a id="ttl-countdown"></a>
### TTL countdown
The remaining lifetime of a Redis key, counted down in the UI from the TTL read when the key was loaded, so the user sees it reach zero without re-querying. Rowlit highlights it under 60 s. *Owner: II-17.*

<a id="tunnel-resolver"></a>
### tunnel resolver
`ITunnelResolver`: turns a profile into one pointed at the local end of its tunnel; implemented by `SshTunnelService`. *Owner: II-08.*

<a id="tuple"></a>
### tuple — چندتایی
Formal word for a row of a relation. *Owner: I-02.*

<a id="tuple-version"></a>
### tuple version — نسخهٔ تاپل
One physical version of a row in a PostgreSQL heap. *Owner: I-10.*

<a id="two-phase-commit"></a>
### two-phase commit (2PC) — commit دومرحله‌ای (2PC)
Prepare then commit across several participants, led by a coordinator. Deeper: in-doubt participants block. *Owner: I-12.*

<a id="two-phase-locking"></a>
### two-phase locking (2PL) — قفل‌گذاری دومرحله‌ای (2PL)
Acquire locks in a growing phase, release in a shrinking phase; strict 2PL holds them to commit. *Owner: I-09.*

<a id="txopen"></a>
### TxOpen
Whether a session has an open transaction, engine-owned or user-typed; sent in `exec.done` and `session.changed`. *Owner: II-08.*

<a id="type-check"></a>
### type check — type check
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="type-map"></a>
### type map (links)
The rules that turn a source column type into a column kind and a DuckDB type (`TypeMap`), e.g. `decimal(p,s)` → `DECIMAL(38,s)`, `datetimeoffset` → `TIMESTAMPTZ` in UTC, decimals wider than 38 digits → `VARCHAR` with a warning. *Owner: II-16.*

<a id="udt"></a>
### UDT (user-defined type)
A custom composite type. Deeper: Cassandra `address`, PostgreSQL composite types, SQL Server alias and table types. *Owner: I-17.*

<a id="unbound-parameter"></a>
### unbound parameter
A placeholder without a value; PostgreSQL and SQLite reject the run before anything executes. *Owner: II-08.*

<a id="undo"></a>
### undo — بازگردانی (undo)
Information to reverse a change or to rebuild an older row version. *Owner: I-10.*

<a id="undo-log"></a>
### undo log — لاگ بازگردانی
Stored before-images used for rollback, recovery and MVCC reads (InnoDB, Oracle undo segments). *Owner: I-11.*

<a id="unique-constraint"></a>
### UNIQUE — قید یکتایی
A constraint that forbids two rows with the same values in the listed columns. How it treats NULLs differs by engine. *Owner: I-05.*

<a id="unique-index"></a>
### unique index — نمایهٔ یکتا (unique index)
An index that rejects duplicate keys; it enforces `PRIMARY KEY` and `UNIQUE` constraints. NULL handling differs per engine. *Owner: I-07.* See also: index.

<a id="uniquifier"></a>
### uniquifier — یکتاساز (uniquifier)
A hidden 4-byte value SQL Server adds to duplicate keys of a non-unique clustered index so every row has a unique locator. *Owner: I-06.* See also: clustered index.

<a id="unit-test"></a>
### unit test — unit test
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="update-lock"></a>
### update lock (U) — قفل به‌روزرسانی
SQL Server lock taken while an UPDATE searches rows; prevents conversion deadlocks. *Owner: I-10.*

<a id="upsert"></a>
### upsert — upsert
"Insert, or update if it exists", done atomically: `ON CONFLICT` (PostgreSQL, SQLite), `ON DUPLICATE KEY UPDATE` (MySQL), `MERGE`. *Owner: I-04.* See also: MERGE.

<a id="user-data-dir"></a>
### user data dir — user data dir
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="useshallow"></a>
### `useShallow`
A Zustand helper that compares selected arrays or objects shallowly so equal content does not re-render. *Owner: II-20.*

<a id="usesyncexternalstore"></a>
### `useSyncExternalStore`
The React hook for subscribing to external state. The command registry uses it. *Owner: II-20.*

<a id="uuid"></a>
### UUID / GUID — UUID
A 128-bit identifier that can be generated anywhere without coordination. Random values scatter inserts in indexes; time-ordered variants fix that. *Owner: I-05.*

<a id="vacuum"></a>
### VACUUM — VACUUM
PostgreSQL command that removes dead tuples, updates the visibility map and freezes old rows. *Owner: I-10.*

<a id="validation-rule"></a>
### validation rule (Mongo)
A collection's `validator` (often a `$jsonSchema`) with a level (`off`, `strict`, `moderate`) and an action (`error`, `warn`, `errorAndLog`) that MongoDB applies to inserts and updates. Rowlit reads it from `listCollections` and writes it with `collMod`. *Owner: II-17.*

<a id="vectorised-execution"></a>
### vectorised execution — اجرای برداری (vectorised execution)
Executing operators on batches of column values instead of one row at a time, so tight loops use CPU caches and SIMD (ClickHouse, DuckDB, Snowflake, SQL Server batch mode). *Owner: I-08 (also I-15).* See also: Volcano model.

<a id="verify-unchanged"></a>
### verify unchanged
The grid setting that makes `UPDATE`/`DELETE` also require the old values, detecting changes by others. *Owner: II-13.*

<a id="version-store"></a>
### version store — انبارهٔ نسخه‌ها
Where SQL Server keeps previous row versions (`tempdb`, or the persistent version store). *Owner: I-10.*

<a id="view"></a>
### view — نما
A stored `SELECT` that is queried like a table and holds no data of its own. *Owner: I-04.* See also: materialized view.

<a id="virtual-relation"></a>
### virtual relation
A foreign key the user declares between two mounted tables (typically of different members, where no real FK can exist). The link catalog reports it as a foreign key and the builder suggests joins from it. *Owner: II-16.*

<a id="virtual-warehouse"></a>
### virtual warehouse
A Snowflake compute cluster that you size, start and suspend independently of storage. Deeper: billed per second while running. *Owner: I-15.*

<a id="virtualisation"></a>
### virtualisation
Rendering only the visible part of a long list. The explorer and the grid both do it. *Owner: II-13.*

<a id="visibility-map"></a>
### visibility map — نقشهٔ مرئی‌بودن (visibility map)
PostgreSQL per-table bitmap (`_vm` fork) marking pages whose rows are all visible (and all frozen). Index-only scans skip heap visits for those pages; VACUUM sets the bits. *Owner: I-07.* See also: index-only scan, VACUUM.

<a id="vite"></a>
### vite — vite
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="vlf"></a>
### VLF (virtual log file) — فایل لاگ مجازی (VLF)
Unit into which SQL Server divides its transaction log. *Owner: I-11.*

<a id="volcano-model"></a>
### Volcano model — مدل Volcano (iterator model)
Execution model in which each operator implements `open`/`next`/`close` and pulls one row at a time from its children (Graefe, 1994). Simple and pipelined; per-row overhead is its cost. *Owner: I-08.* See also: vectorised execution.

<a id="wait-statistics"></a>
### wait statistics — آمار انتظار
Records of what sessions wait on and for how long. *Owner: I-13.*

<a id="wal"></a>
### WAL (write-ahead log) — لاگ پیش‌نویس (WAL)
Sequential log written before data pages change and flushed at commit. *Owner: I-11.*

<a id="wal-mode"></a>
### WAL mode (SQLite) — حالت WAL
SQLite journal mode that appends new pages to a `-wal` file; readers do not block the writer. *Owner: I-11.*

<a id="warehouse"></a>
### warehouse
In Snowflake, the compute cluster that runs queries (see virtual warehouse). Deeper: must be running for `INFORMATION_SCHEMA` and data queries. *Owner: I-17 (see I-15).*

<a id="watermark"></a>
### watermark (low / high)
The first offset still stored in a Kafka partition (low) and the offset the next message will get (high). Rowlit computes start offsets, message estimates, browse ends and lag from them; `high − low` is an upper bound on the message count of a compacted or purged partition. *Owner: II-18.*

<a id="web-worker"></a>
### Web Worker
A background thread of the browser. The ER layout runs in one. *Owner: II-15.*

<a id="websocket"></a>
### WebSocket
A long-lived two-way connection that starts as an HTTP request; Rowlit has one per UI window. *Owner: II-06.*

<a id="websocket-hub"></a>
### WebSocket hub
`WsHub`: accepts sockets, authenticates them and fans events out to every client queue. *Owner: II-06.*

<a id="welcome-screen"></a>
### welcome screen — welcome screen
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="wide-column-store"></a>
### wide-column store
A database where a partition key leads to sorted rows with flexible columns. Deeper: Cassandra; not a column store in the OLAP sense. *Owner: I-16.*

<a id="wide-member"></a>
### wide member
A member with scope `database` or `connection`, spanning several schemas or databases. Its nested tables are named with three or four parts and loaded lazily, one container at a time, when something names them. *Owner: II-16.*

<a id="wildcard-index"></a>
### wildcard index
A MongoDB index on `$**` (or `path.$**`) that indexes every field below a path, useful for documents whose fields vary. A `wildcardProjection` can include or exclude paths, and only on a single whole-document `$**` key. *Owner: II-17.*

<a id="window-function"></a>
### window function — تابع پنجره‌ای
A function with `OVER (...)` that computes a value per row from a window of related rows without collapsing them (ranking, running totals, `LAG`). *Owner: I-04.* See also: frame, window partition.

<a id="window-partition"></a>
### window partition — بخش‌بندی پنجره
The `PARTITION BY` part of a window: the independent groups the calculation restarts in. Not the same as table partitioning. *Owner: I-04.*

<a id="wire-protocol"></a>
### wire protocol — پروتکل شبکه‌ای
The byte-level network language a DBMS speaks (PostgreSQL frontend/backend protocol, SQL Server TDS, MySQL protocol, Oracle TNS, CQL native protocol). Drivers implement it. *Owner: I-01.*

<a id="wire-value"></a>
### wire value
A cell as sent over the protocol: JSON scalars, big numbers and decimals as strings, `{ $bin }`, `{ $trunc }`, `{ $cursor }`. *Owner: II-13.*

<a id="without-rowid"></a>
### WITHOUT ROWID — WITHOUT ROWID
SQLite table option that stores the table clustered on its declared primary key instead of a hidden rowid, saving a separate index for non-integer keys. *Owner: I-06.* See also: rowid, clustered index.

<a id="work-package"></a>
### work package — بستهٔ کاری
A scoped, testable unit of parallel work with explicit file ownership and hand-off rules. *Owner: II-24.*

<a id="workflow"></a>
### workflow — workflow
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="working-set"></a>
### working set — working set
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="workspace"></a>
### workspace — workspace
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="workspace-file"></a>
### workspace file
The saved list of open tabs, their text, the group layout and detached tabs. Autosaved 800 ms after a change. *Owner: II-20.*

<a id="write-skew"></a>
### write skew — write skew (انحراف نوشتن)
Two transactions read overlapping data and write different rows, together breaking a rule each checked. Deeper: allowed by snapshot isolation. *Owner: I-09.*

<a id="xlsx"></a>
### XLSX
The Excel workbook format (a zip of XML). Rowlit reads and writes it without a spreadsheet library. *Owner: II-15.*

<a id="xmin-xmax"></a>
### xmin / xmax — xmin / xmax
PostgreSQL tuple fields: id of the creating and of the deleting (or locking) transaction. *Owner: I-10.*

<a id="zone-map"></a>
### zone map — نقشهٔ ناحیه (zone map)
Min/max (and sometimes other) summaries per block of rows used to skip blocks: PostgreSQL BRIN, ClickHouse minmax indexes, Snowflake micro-partition metadata, DuckDB row groups. *Owner: I-07.* See also: BRIN, skip index.

<a id="zustand"></a>
### zustand — zustand
A handbook term used by the chapter that links here; that chapter gives its precise operational meaning. *Owner: cross-reference.*

<a id="zustand-store"></a>
### Zustand store
A small global state container created with `create(...)`. Components subscribe with selectors; other code uses `getState()`. *Owner: II-20.*
