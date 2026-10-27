# QA round: linked databases

Area: `engine/src/DbStudio.Federation` and `ui/src/components/Links` (link editor, Add to link, query builder, federated
execution, push-down, caps, cancel, read-only, linked views, materialize, native link scripts, DuckDB IntelliSense).
Method: `docs/qa/links-walkthrough.md` end to end against the docker sample servers (SQL Server, PostgreSQL, MySQL,
MariaDB, Oracle, ClickHouse, MongoDB) with the real engine (throw-away `DBSTUDIO_DATA_DIR`), a link `QA All` mounting every
table of six servers, driven through the REST/WebSocket API and the real UI (Vite dev server + headless Edge). Shop data
checks: order 1 total 120.50 on all six servers; per-customer totals Alice 2 / 138.80, Bob 1 / 199.00, Chie 1 / 55.15,
Dora 1 / 199.00 across SQL Server x PostgreSQL x MySQL; three-server join on `ms.Orders`, `ora.ORDERS`, `ch.orders` returns 6 matching rows.

## Findings

| # | Area | Severity | Finding | Status | Where | Test |
|---|---|---|---|---|---|---|
| L-1 | Federated execution | failed operation | `select count(*) from mg.sessions` (an empty MongoDB collection) and `select ... from ch.orders_since` (ClickHouse parametrised view) ended with DuckDB's "Catalog Error: Table ... does not exist": the mounted table has no columns, so the engine never created it (silently skipped in the plan). | fixed: an empty collection mounts with `_id` (count is 0); any other zero-column table fails up front with "ch.orders_since has no columns the link can read ..." | `Fetchers/MongoFetcher.cs` (Infer), `Runtime/LinkRuntime.cs` (BuildFetches) | `FetcherTests.Mongo_empty_collection_still_has_an_id_column`, Docker `DockerFederationTests.A_clickhouse_parametrised_view_says_why_it_cannot_be_queried` |
| L-2 | Materialize | failed operation | Append on Oracle with the table name typed in lower case (`qa_mat_x`, created as `QA_MAT_X` by Create): the job failed with "Table 'qa_mat_x' was not found" and the dialog's preview said the table does not exist (Append disabled). | fixed: append resolves the name as typed, then its folded form (preview and job) | `Materialize/MaterializeService.cs` (AppendTargetAsync) | Docker `DockerMaterializeTests.Append_finds_the_table_whose_name_create_folded` |
| L-3 | Results / materialize | wrong data (fidelity) | DECIMAL results lost their scale: order 1 total shown as `120.5`, a sum of 140.00 as `140`; Materialize built `NUMERIC(38,10)` for every decimal column (PostgreSQL stored `120.5000000000`) because the engine's result columns carried no precision/scale. | fixed: precision/scale read from the reader's schema table; the grid keeps the scale (`120.50`) and the target column is `numeric(p,s)` | `Runtime/ResultValues.cs` | `FederatedSessionTests.Decimal_results_keep_their_scale` |
| L-4 | Query builder | wrong data | The filter operator "matches regex" was silently dropped from the builder's SQL (warning "applied in the grid after the server filter" is untrue there): the query returned unfiltered rows. In an OR group the whole group vanished. | fixed: compiles to `regexp_matches(col, $fp, 'i')` (case-sensitive: no flag), in the TypeScript and the C# compiler; Advanced -> Back to builder reads it back | `ui/src/filter/sql.ts`, `Builder/FilterSql.cs`, `Builder/BuilderParser.cs`, golden `b-009` | `sql.test.ts` (DuckDB regex), shared goldens (`goldens.test.ts`, `BuilderGoldenTests` incl. parse round trip) |
| L-5 | Native links | wrong script | The PostgreSQL FDW script for a SQL Server / PostgreSQL / MySQL member wrote `LIMIT TO (Customers)` and `SELECT * FROM ms.Customers`: PostgreSQL folds unquoted names, so the foreign tables (kept in the remote case) were not found. | fixed: mixed-case names are quoted (oracle_fdw lower-cases the imported names and stays unquoted) | `Native/NativeLinkScripter.cs` | `NativeLinkScripterTests.Fdw_quotes_mixed_case_remote_tables_but_not_oracle_ones` |
| L-6 | Native links | UX | Pairs the engine cannot script said "A tsql server cannot link to a mongodb member natively." | fixed: provider names ("sqlserver") | `Native/NativeLinkScripter.cs` | `NativeLinkScripterTests.Impossible_pair_message_names_the_providers` |

## Checked and found correct

- Cross-engine joins over all six servers and MongoDB, order 1 total 120.50 everywhere, three-way aggregate join, subqueries, CTEs, QUALIFY, set operations, DESCRIBE.
- Push-down plan: predicates and projections go to the source (`SELECT TOP (2000001) [Id], [Name] ...`, `WHERE "email" IS NOT NULL`, Mongo `$project/$limit`).
- Caps (`maxRowsPerSource` 3 on every source type with the "only the first 3 rows" warning), session cache messages, cancel of a 4-way cross join (cancelled in about 120 ms, session reusable), read-only (INSERT/DELETE/CREATE/ATTACH/COPY/INSTALL/CALL refused with READ_ONLY, `read_csv`/`glob` refused, config locked).
- Parameters (`$min` dialog in the console), unicode text through the engine (Persian, Arabic, Hebrew notes), uncommon types (jsonb, uuid, inet, bytea, BIGINT UNSIGNED, YEAR, SET, BIT) with conversion warnings.
- Linked views: save, duplicate name refused, empty name/sql refused, update, delete, 404s; materialize from a view.
- Materialize create / create again (refused) / append / replace into PostgreSQL, SQL Server, MySQL, MariaDB, Oracle and ClickHouse with Persian text, bool, null, timestamptz (UTC warning), duplicate and odd column names, SQL-injection-looking table name (quoted).
- Native scripts for all 36 target x member pairs: passwords never appear, placeholders listed.
- Builder: eight models (3-way join with aggregates and sort, nested filters with BETWEEN/IN/contains/isNull, calculated + DISTINCT + HAVING, quoted aliases `my "id"` / `select`, join with trim + ignore case, `count(*)` on Mongo, date filters) compile to the expected SQL, plan, run correctly and round-trip through `/parse`. UI: link editor (alias duplicate check), IntelliSense (aliases, tables, kinds), Parameters dialog, builder auto-join across servers, Run, Materialize dialog.

## Open / not fixed

| # | Area | Severity | Note |
|---|---|---|---|
| O-1 | Console | UX | **Fixed.** `EXPLAIN select ...` on a link printed the raw analyzer message "Only SELECT statements can be serialized to json!" and read the whole tables. Now the EXPLAIN prefix is split off and the inner query is analysed (projection and predicates push down, `/plan` too); a plain EXPLAIN reads at most 1,000 rows per source (EXPLAIN ANALYZE reads normally) and says so in one Info message; the fallback warning no longer quotes DuckDB ("it is not a plain SELECT"). Still: the plan is DuckDB's over local copies, not the source servers' plan. `Pushdown/ExplainSql.cs`, `Runtime/LinkRuntime.cs`, `Runtime/FederationContext.cs`; tests `FederatedSessionTests.Explain_*`. |
| O-2 | Query builder | UX | **Fixed.** Advanced (SQL) mode now opens the Parameters dialog for `$name` / `?` values on Run and on Materialize (Cancel runs nothing). Root cause of the first attempt not showing: `resolveParams` ran before DuckDB's lexer was loaded (a builder tab has no editor to load it), so `$min` was not recognised; `resolveParams` now awaits `ensureDialect`. `Links/builder/actions.ts`, `BuilderView.tsx`, `ParamsDialog/ParamsDialog.tsx`; test `builder.view.test.tsx` (Advanced SQL asks for the $name values). |
| O-3 | Add to link | UX | **Fixed.** A member saved with database `null` and an explorer table that reports the connection's default database are now one scope: `addTableToDefinition` takes the connection's default database (from the catalog store) and compares `null` as that default, case-insensitively. `Links/materialize/addToLink.ts`, `AddToLinkDialog.tsx`; test `materialize/model.test.ts`. |
| O-4 | Environment | note | First query of a session takes 3-20 s on the loaded machine (member connections opened in parallel); during the run Docker Desktop stopped answering (HTTP 500 on the engine pipe) under memory exhaustion, which also timed out the SQL Server/Oracle/ClickHouse handshakes. Once the engine host crashed at start-up with a stack overflow inside Serilog's exception formatting (memory exhaustion); not reproducible on the next start. |
| O-5 | Sample data | note | MySQL `shop` has a leftover table `imp_d5af5423` (another QA area's import test); it shows up in links that mount all tables. |

## Shared files touched

`ui/src/filter/sql.ts` (shared filter compiler: the DuckDB dialect now builds `regexp_matches`; other dialects unchanged, `splitForServer` got an optional third argument) and its test `ui/src/filter/__tests__/sql.test.ts`.

## Test results

- `engine/tests/DbStudio.Federation.Tests` (Debug, `DBSTUDIO_IT=0`): 287 passed, 12 skipped (Docker), 0 failed. The Docker tests for L-1 and L-2 passed against the compose servers.
- Added `FederatedSessionTests.Builder_regex_filter_runs_in_duckdb` (the compiled `regexp_matches(..., 'i')` runs on the real DuckDB engine); the Federation project was re-run after it (FederatedSessionTests + BuilderGoldenTests: 58 passed).
- `ui`: `oxlint` exit 0 (existing warnings only), `tsc -b` clean, vitest green for `src/components/Links` (129), `src/filter`, `FilterBar`, `DataTab` (219).
- Not run / not clean: the full `npm test` timed out after 1700 s on the overloaded machine (Redis browser, Search dialog, Cassandra views, settings snippets suites hit 40-2900 s timeouts, none in this area); the full `dotnet test engine/DbStudio.slnx` was not run (only Federation was touched; Docker Desktop stopped answering at the end, so the final build could not be replayed live: the fixes were verified by the unit tests and, for L-1 and L-2, by the Docker tests before it went down).
