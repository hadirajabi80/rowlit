# Linked databases — WP-A (engine federation core)

Base: `main` @ `32f3723` (WP0). Owned paths only (`Federation/{Provider,Engine,Pushdown,Runtime}/**`,
`Fetchers/RelationalFetcher.cs`, `tests/DbStudio.Federation.Tests/WpA/**`) plus the `LINKS-WPA` block of
`FederationModule.cs`. No frozen contract changed; no shared file outside the block was edited.

## What is registered (FederationModule, LINKS-WPA)

- `IDbProvider` **`LinkedProvider`** (`linked`, dialect `duckdb`, empty FormSpec): `GET /providers` now lists `linked`.
  Also `IObjectBrowserProvider` (Objects tab list + FK dependencies from the link catalog).
- `DuckDbEngineFactory` as `IFederationEngineFactory`; `LinkRuntime` as `ILinkRuntime` (replaces
  `UnavailableLinkRuntime`, which stays in the tree for tests that want a runtime without an engine).
- Keyed `ISourceFetcher` `RelationalFetcher` for sqlserver, oracle, postgresql, mysql, mariadb, sqlite, clickhouse,
  snowflake, cassandra; keyed `IParamBinder` `linked` (`$name`, `$1`, `?`).

## How it works

- **Session** (`Provider/FederatedSession.cs`, an `AdoSessionBase` over the engine's DuckDB connection): every batch is
  analysed, the mounted tables it reads are fetched into the session's engine (parallel, ≤ 6 at a time), then the SQL
  runs unchanged on DuckDB and streams like any console. Messages: one Info per source
  (`crm.customers: 1,204 rows from Microsoft SQL Server in 120 ms.`, or `… from the session cache.`), then the plan's
  warnings (rowCap, fallback, limitWithoutOrder, joinKinds, joinCollation, decimalWidened, conversion, fullScan, cached,
  fallbackEngine). If DuckDB reports a column the projection missed (Binder Error), the tables are fetched whole and the
  statement retried once.
- **Read-only, always**: `ValidateBatch` refuses anything that is not a query (SET/PRAGMA/RESET allowed) with
  `READ_ONLY`, also when the user confirmed writes (`WritesConfirmed`); `OpenQueryAsync` throws 403 READ_ONLY. Inside
  DuckDB: no extension install/load, `enable_external_access = false` (no files, no ATTACH), `lock_configuration`.
- **No transactions / database / schema switch**: `SetTransactionModeAsync(Manual)` → NotSupportedException (interface
  re-implementation over AdoSessionBase), Commit/Rollback are no-ops, `ChangeDatabaseAsync` → NotSupported, SchemaMode
  `None` (the schema endpoint answers NOT_SUPPORTED). No `IPlanReader` for `linked` → Explain NOT_SUPPORTED.
- **Cancel** (< 1 s, tested): cancels every running fetch (`DbCommand.Cancel`, `sqlite3_interrupt` for SQLite members,
  `IDbSession.Cancel` for Cassandra) and interrupts DuckDB (`DuckDBCommand.Cancel`).
- **Engine config** (before the lockdown): `memory_limit` = `links.memoryLimitMb` (0 = 25 % of the memory available to
  the process, ≥ 512 MB), `threads`, `temp_directory = <DataDir>/tmp/links/<sessionId>` (deleted on close; the whole
  `tmp/links` is cleared when the runtime starts), `TimeZone = UTC`, `search_path = <first alias>` (unqualified table
  names resolve to the default schema the catalog reader reports), one schema per alias.
- **Caps**: `links.maxRowsPerSource` (link option overrides, `LinkQueryOptions.MaxRowsPerSource` overrides both) — the
  source SQL asks for cap + 1 rows; a hit sets `Truncated` and the rowCap warning. `links.fetchTimeoutSeconds` →
  `FetchException` "did not answer within N s".
- **Source cache** (per session/context, `links.cacheSources`): a cached table serves a later statement when it has all
  the needed columns and no predicate the new statement lacks (a superset of the rows) and was not cut short
  differently (limit / cap). A refetch keeps the union of the old and new columns. `RefreshSourcesAsync` drops tables
  (and the link catalog, which is otherwise cached 2 min, keyed by the link's props).
- **Resources (docs/resources.md)**: a federated session holds no server connection between statements (each fetch
  opens and closes its own), only the engine's memory. It is **not** flagged `HasTempObjects`: releasing it (idle /
  pressure / limit) disposes the engine and its spill directory — exactly the memory the policy wants back — and the
  next run re-fetches transparently (`SessionManager` reopens it with the same id). Nothing to change in Core.

## Push-down rules (Pushdown/QueryAnalyzer.cs, PushdownSql.cs)

- Projection always pushed, conservative: every column name the statement mentions that a table has (qualified
  `alias.col` only that table; unqualified → every table with that column); `*`, `t.*`, `COLUMNS(…)`, NATURAL JOIN, a
  bare alias (row struct), `t(a, b)` column aliases, DESCRIBE/SUMMARIZE (SHOW_REF), unknown table refs → whole table.
  `count(*)` only → the first key column.
- Predicates: `col OP literal` conjuncts with = <> < > <= >= IN BETWEEN LIKE IS NOT NULL (never IS NULL / OR / NOT /
  functions / casts on the column / parameters / ILIKE / ESCAPE / LIKE with `\`). Strings push only =, IN, LIKE
  (case-insensitive or padding collations give a superset; `<>` and ranges could drop rows). Dates/datetimes/guids/bools
  with typed or parseable literals; datetimeoffset and time never. WHERE conjuncts push to any table of their SELECT
  (null-rejecting, the engine re-applies the WHERE); ON conjuncts: INNER both sides, LEFT right side, RIGHT left side,
  SEMI both, ANTI right side, FULL none; POSITIONAL / ASOF / TABLESAMPLE: none. A table read several times keeps only
  the predicates every occurrence has.
- Per dialect (`Accept`): SQLite no date/time/guid/bool predicates; ClickHouse no datetime predicates; Cassandra only `=`
  on the whole partition key (never ALLOW FILTERING) — the partition key comes from the CQL catalog comments and is
  carried in `SourceTable.Options["_partitionKey"]`. Dropping any predicate drops the limit.
- LIMIT (+ OFFSET) only for one-table SELECTs without joins, CTEs, GROUP BY/HAVING/QUALIFY, aggregates, windows,
  subqueries, DISTINCT, ORDER BY, whose WHERE pushed completely. Rendered `TOP (n)` / `FETCH FIRST n ROWS ONLY` (Oracle
  12c+) / `LIMIT n`.
- DuckDB rewrites some expressions itself (`NOT (a = b)` arrives as `a <> b`), the analyzer sees the rewritten form.

## Type map (Pushdown/TypeMap.cs)

As the plan, with these specifics: `NUMBER(p,0)` (Oracle, Snowflake) → int; unsigned 64-bit, 128-bit and
NUMBER(19..38,0) → HUGEINT; 256-bit → VARCHAR; **decimal without precision (Oracle `NUMBER`, PostgreSQL `numeric`) →
DOUBLE** (deviation: DECIMAL(38,s) needs a scale); `money` → DECIMAL(38,4); ClickHouse `Nullable`/`LowCardinality`
unwrapped, `DecimalN(S)`; MySQL `unsigned`/`zerofill`; PostgreSQL arrays → VARCHAR; Cassandra collections → JSON.
A value that cannot be converted is stored as NULL and counted (conversion warning). Result kinds come from DuckDB.NET's
type names (TIMESTAMPTZ read back as UTC offsets, BLOB from its stream, LIST/STRUCT/MAP as JSON text).

## For WP-B (ILinkRuntime)

- `OpenQueryAsync(linkId, sql, params, options)`: with `SessionId` of an open console it fills/reuses that session's
  cache and runs the query on a **duplicated DuckDB connection** (the console stays usable); otherwise a private engine
  that `LinkQuery.DisposeAsync` closes. Values in `Reader` are raw DuckDB.NET values (BLOB = Stream, TIMESTAMPTZ =
  DateTime UTC, HUGEINT = BigInteger); `Columns` are console kinds.
- `PlanAsync` never fetches (`Rows`/`Truncated` null; `Cached`/`FetchedAt` filled when some open session holds a
  reusable copy). `SerializeSqlAsync` = `json_serialize_sql` (Supported false without DuckDB).
- `ValidateAsync(probe: true)` loads every member's catalog (60 s timeout each); unreachable members are warnings
  (`memberUnreachable`), missing tables `tableMissing` warnings.
- `CatalogAsync`: schemas in member order; a member that cannot be read has `Error` and no tables (the explorer schema
  then answers 503 SOURCE_UNAVAILABLE; a statement naming `alias.` of it fails with that message).
- Fetchers for P3 (`MongoFetcher`, …) are resolved per member through `FetcherKeys.For`; whatever `Accept` returns is
  what the runtime fetches; the runtime creates the engine table with exactly `Request.Columns` (engine types from
  `TypeMap.ToEngine` of the source columns) and disposes the appender after `FetchAsync`.

## Requests

None.

## Tests

- `WpA/QueryAnalyzerTests` (analyzer fixtures, outer-join safety), `PushdownSqlTests` (snapshots: T-SQL, Oracle,
  PostgreSQL, MySQL, ClickHouse, SQLite, Snowflake, CQL ×2), `TypeMapTests`, `EngineTests` (lockdown, appender
  conversions, interrupt < 1 s, SQLite fallback), `FederatedSessionTests` (two SQLite members end to end: cross-member
  join + GROUP BY, catalog reader, cap/truncation, LIMIT push, cache + refresh, read-only refusals even when confirmed,
  no tx, open query, plan, validation, fetch cancel < 1 s, engine cancel < 1 s, params, failing member).
- `WpA/DockerFederationTests` (compose project dbstudio-it; skipped when `DBSTUDIO_IT=0` or a port is closed):
  SQL Server customers × PostgreSQL orders/lines × MySQL products GROUP BY (ShopSchema totals, order 1 = 120.50, pushed
  `WHERE "id" = 1`, LEFT JOIN ON push to the right side only); Oracle × ClickHouse × MariaDB; same join natively vs
  across three servers; PostgreSQL `pg_sleep` view fetch cancelled < 1 s; read-only on writable members; 1M-row
  ClickHouse table (~700 MB incompressible payload) under `memoryLimitMb = 512` completes with spill files present.

## Known gaps

- DuckDB.NET returns DECIMAL(38,s) values without trailing zeros (`120.5`, not `120.50`): values are exact, only the
  display scale is lost (DECIMAL ≤ 18 digits keep it).
- `AdoSessionBase.DescribeAsync` (describe probes) runs on the engine without fetching: it fails for tables the session
  has not read yet (non-virtual in Core; harmless for the console).
- `SHOW TABLES` / `duckdb_tables()` list only what the session has fetched; DESCRIBE of a mounted table works (it fetches).
- The SQLite fallback runs only simple SQL (no parser: whole tables, no push-down).
- Oracle push-down uses `FETCH FIRST` (12c+).
