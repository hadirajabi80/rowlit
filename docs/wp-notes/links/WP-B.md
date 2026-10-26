# Linked databases — WP-B (engine services) notes

Base: WP0 `32f3723`. Owned paths only (wp0.md 2, WP-B) plus the two `LINKS-WPB` blocks of `FederationModule.cs`.
No R3 request against frozen files is needed; the sections below are agreements other packages code against.

## 1. What is in

| Piece | Where | Notes |
|---|---|---|
| Endpoints | `Endpoints/LinkEndpoints.cs` | every route of `Contracts/LinkApi.cs`; `GET /links/engine` (WP0) kept. Errors: 400 VALIDATION, 403 READ_ONLY, 404, and whatever `ILinkRuntime` throws (501 until WP-A lands). |
| Compiler | `Builder/BuilderCompiler.cs` + `Builder/FilterSql.cs` | `BuilderModel` → canonical SQL + `$fpN` params; `FilterSql` is a line-by-line port of `ui/src/filter/sql.ts` (duckdb branch) incl. `values.ts` / `model.ts` / `operators.ts` helpers. |
| Parser | `Builder/BuilderParser.cs` | SQL → model from `json_serialize_sql`; null + reason outside the subset. |
| Linked views | `Views/LinkedViewStore.cs` | SQL in `SavedQueryStore` (connection = link, schema `views`), builder model in `<DataDir>/linked-views.json`. |
| Materialize | `Materialize/MaterializeService.cs` | JobManager job `links.materialize` on Import's `TargetWriter` / `ImportDialect`. |
| Native scripts | `Native/NativeLinkScripter.cs` | linked server, postgres/mysql/oracle/tds fdw, Oracle DB link (+ DG4ODBC gateway), MySQL/MariaDB FEDERATED, ClickHouse PostgreSQL/MySQL database engines. |
| P3 fetchers | `Fetchers/{Mongo,Elastic,File}Fetcher.cs` | keyed `mongodb`, `elasticsearch`, `FetcherKeys.Files` (registered in the LINKS-WPB block). |

## 2. Compiler rules beyond the BuilderModel.cs header (WP-C: `builder/compile.ts` must do the same)

The goldens `Goldens/Builder/b-001…b-010` pin all of these (both compilers must pass them; `warnings` = codes, compared
as a sorted list):

1. **SELECT item** = `as.column` (`LinkSql.QuoteIdent` on both parts) or the trimmed `expr`, wrapped by the aggregate:
   `count(x)`, `count(DISTINCT x)`, `sum|avg|min|max(x)`, and `count(*)` for `agg: "count"` with neither column nor
   expr. ` AS <QuoteIdent(alias)>` whenever `alias` is non-empty (even when it equals the column name). Columns with
   `output: false` are not selected (they still serve HAVING / ORDER BY / GROUP BY). No output column → `SELECT *`.
2. **FROM / JOIN**: `FROM alias.table AS as` (AS always written). Joins in `joins` order; type upper-cased
   (`INNER|LEFT|RIGHT|FULL|CROSS JOIN`). `CROSS` has no ON. A non-cross join with an empty `on` → ` ON TRUE` + warning
   `cartesian`. Condition = `wrap(left.as.leftColumn) op wrap(right.as.rightColumn)`, wrap = `lower(trim(x))` /
   `lower(x)` / `trim(x)`, conditions joined with ` AND `. Tables no join attached follow as `CROSS JOIN` lines in
   `tables` order, one `cartesian` warning each. A join whose `left` is not attached yet, or which attaches a table
   twice, is 400 VALIDATION (the UI can treat it as "not compilable").
3. **WHERE**: `buildPredicate(filter, columns, 'duckdb', { paramPrefix: 'fp', columnRef })` where `columns` = for every
   table in `tables` order, every catalog column of `alias.table`, named `tableId.column`, kind from the catalog, and
   `columnRef` renders `as.column`. Regex conditions: dropped with warning code `filter` (the filter/sql.ts message).
4. **GROUP BY**: `autoGroup` true → when any *output* column has an aggregate, every output column without one, by its
   expression (never its alias), in column order; otherwise none. `autoGroup` false → `groupBy` refs:
   `columnId` → that column's expression (agg applied), `tableId+column` → `as.column`, `expr` → trimmed text.
5. **HAVING**: same `buildPredicate` with the SAME ParamBuilder (numbering continues after WHERE), columns = every model
   column (output or not) named by its id, `columnRef` = its expression; kinds: `count`/`countDistinct` → `int`,
   `avg` → `float`, `sum|min|max` and plain columns → the source column's kind, calculated expressions → `other`.
6. **ORDER BY**: ref `columnId` → `QuoteIdent(alias)` when that column is an output column with an alias, else its
   expression; other refs as in GROUP BY. Direction always written (`ASC` / `DESC`), then ` NULLS FIRST|LAST` when
   `nulls` is set.
7. **LIMIT / OFFSET**: `LIMIT n[ OFFSET m]`; an offset without limit is its own line `OFFSET m`. `limit` without any
   sort → warning `limitWithoutOrder`.
8. **Warnings** (codes): `cartesian`, `limitWithoutOrder`, `joinKinds` (a join compares columns whose kind classes
   differ, e.g. int = string; one per condition), `filter` (filter/sql.ts warnings).
9. Param JSON: `int` → JSON number, `float` → JSON number, `decimal` → normalized string (`"100.5"`), `datetime` →
   `"YYYY-MM-DDTHH:MM:SS[.f]"`, `time` → `"HH:MM:SS"`, `string` → string (LIKE operands already escaped).
10. `last` / `next` date operators depend on "now": goldens avoid them (the C# compiler takes an explicit `now`).

## 3. Parser (`POST /links/{cid}/parse`)

- Input SQL must carry **literal values**, not `$fp` binds: the parse request has no params, so SQL with bind
  parameters returns `model: null` ("inline their values first"). WP-C: send `inlineParams(sql, params, 'duckdb')`
  when switching Advanced → builder; the parser recognises every form filter/sql.ts produces with inlined literals
  (`lower(c) = lower('x')`, `c ILIKE '%' || 'x' || '%' ESCAPE '\'`, date ranges, `IN`, `BETWEEN`, `IS [NOT] NULL`,
  `= TRUE`, `= ''`, NOT groups), plus hand-written `c = 'x'` (→ case-sensitive), `LIKE 'x%'`, `5 < c`, `DATE '…'`.
- Round trip: for every golden, compile → inline → parse → compile gives the same statement (same DuckDB AST; DuckDB
  flattens nested ANDs, so redundant parentheses may go) and the same params.
- Calculated columns keep the user's text (sliced from the SQL by AST positions, verified by re-parsing).
- Out of the subset (model null + reason): CTEs, set operations, subqueries, windows, QUALIFY, SAMPLE, DISTINCT ON,
  USING / NATURAL / SEMI / ANTI / ASOF joins, nested joins, table functions, GROUPING SETS / ROLLUP / CUBE, non-column
  join conditions or ON over more than two tables, filters the filter model cannot express (column = column,
  functions, `LIKE 'a%b'`, `= NULL`), aggregates inside calculated columns, ORDER BY / GROUP BY expressions that are
  not columns of the query, several statements, bind parameters.
- With `UnavailableLinkRuntime` (or a 503 member) the catalog falls back to empty: qualified references still parse.

## 4. Materialize (WP-D: wizard)

- `POST /links/{cid}/materialize/preview` runs the query wrapped as `SELECT * FROM (<sql>) AS q LIMIT 0` with a
  one-row cap per source (no session cache) to learn the result columns; returns the DDL (create/replace), the
  mapped columns and warnings (`TableExists`).
- `POST /links/{cid}/materialize` → 202 `{ jobId }`. **`job.progress.message`** = JSON `MaterializeProgress`
  `{ phase: preparing|fetching|writing|committing|done, fetched, written, rows, total, rate, source? }` (`rows` =
  `written`; `total` is always null: the result size is unknown before it is read), `done` = rows written, `total` null;
  `job.done.result` = `MaterializeResult`. Cancel = `DELETE /jobs/{id}`.
- Modes: `create` (fails when the table exists), `replace` (loads a new `<table>_rowlit_xxxxxx`, then drops the old
  table and renames — a failure keeps the old table), `append` (result columns matched by name, case-insensitive;
  an unknown column is an error). Table / column names are folded per dialect (PostgreSQL lower, Oracle/Snowflake
  upper) like the Import Wizard. Types: int → bigint, decimal(p,s) from the result, strings → unbounded text,
  timestamptz → UTC timestamp (warning), uuid, binary and json mapped per dialect.
- Refusals: read-only target 403 READ_ONLY, a link / non-relational / Cassandra target 400.
- Measured (Docker IT, this machine): 100,000 rows × 10 columns into PostgreSQL 4.8 s (COPY), MySQL 7.2 s
  (multi-row INSERT).

## 5. Native scripts (WP-D: wizard)

`POST /links/{cid}/native-script { targetConnectionId, memberAlias, kind?, name? }` → script with `<password>` (and
`<user>`, `<service>`, `<database>`, `<gateway_tns_alias>`, `<odbc driver>` when unknown) placeholders, notes and
`availableKinds`. Pairs: SQL Server ← any relational (MSOLEDBSQL / OraOLEDB / MSDASQL ODBC), PostgreSQL ← postgresql,
mysql, mariadb, oracle, sqlserver, Oracle ← any relational (native link, or DG4ODBC for non-Oracle), MySQL/MariaDB ←
mysql/mariadb (FEDERATED tables with the member catalog's column lists), ClickHouse ← postgresql/mysql/mariadb
(database engine). Other pairs: 400. Snapshots: `tests/…/WpB/Snapshots/native-*.sql`.

## 6. P3 fetchers (WP-A: runtime)

- Clients: when `SourceContext.Services` has `SourceClientManager` and the member's connection is saved, the fetchers
  use the shared client (with a lease); otherwise they open one through `SourceContext.Source` with
  `Profile`/`Password` — please fill `Source` (the `IDataSourceProvider` of mongodb / elasticsearch) and `Profile`.
- Mongo: schema = MongoDB database (member `schema`, else the profile's database). Fields sampled as one BSON type push
  `$eq/$ne/$lt…/$in/between/$regex(LIKE without '\')/IS NOT NULL`; a field sampled as only strings (or ObjectIds)
  reads values of other BSON types as NULL (counted in `ConversionFailures`, warning in `FetchResult.Warnings`) so
  pushed string filters stay exact.
- Elasticsearch: `_id` + mapping leaves; `term/terms/range/exists` on keyword, numeric, date, boolean, ip and
  `text` fields with a `.keyword` sub-field; scroll paging (`size` ≤ 1000); dates are UTC.
- Files: `MountedTable.Name` must be an absolute path; formats csv/tsv/json/ndjson/xlsx (Parquet → catalog warning);
  only the projection and (when no predicate) the limit apply.

## 7. Tests

`engine/tests/DbStudio.Federation.Tests/WpB/`: goldens (compile + parse round trip, all `Goldens/Builder/*.json`),
parser subset/refusals, scripter snapshots, linked views, materialize into SQLite, endpoints over TestServer with a
fake `ILinkRuntime` (in-memory DuckDB), file/Mongo/ES fetchers; Docker ITs `DockerMaterializeTests` (PostgreSQL,
MySQL) and `DockerFetcherTests` (Mongo 27018, ES 19200 `--profile search`) skip when `DBSTUDIO_IT=0` or the port is
closed. Regenerate goldens/snapshots after a deliberate change with `GOLDEN_WRITE=1` (b-* goldens only when their
`sql` is empty).
