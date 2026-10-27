# QA round: Cassandra (provider, CQL dialect, UI views)

Branch `worktree-agent-a1be18589676e02ab`. Environment: cassandra:5 from the compose profile (MV/UDF enabled), engine from this
worktree (dev mode), driven through its REST/WebSocket API with a small script, plus vitest / xunit. The host was
short of memory for the whole session (pagefile exhausted, Docker Desktop answering 500, the Cassandra node wedged and
restarted once), so **the UI was not driven in a browser**: the Vite dev server was killed twice by out-of-memory
errors. UI findings were found by reading the code against live engine behaviour and are proven by vitest only.

## Findings

| # | Area | Severity | Finding | Status | Where | Test |
|---|---|---|---|---|---|---|
| 1 | Data grid / editor | wrong data / failed operation | Generated SQL did not quote CQL identifiers that CQL folds or rejects: a column created as `"UserId"` was written `UserId` (`Undefined column name userid` on filter, sort, UPDATE, DELETE, refetch) and reserved words (`use`, `token`, `schema`, `replace`, `batch`...) were a syntax error. The engine's `CqlText.Quote` was right; the UI helper had no CQL rule. Completions had the same gap. | fixed | `ui/src/lib/sql.ts` `needsQuoting` / `CQL_RESERVED`; `ui/src/intel/complete/format.ts` | `ui/src/lib/sql.cql.test.ts`, `ui/src/intel/__tests__/cql.test.ts` |
| 2 | Data tab filter | failed operation | The server filter pushed T-SQL-style predicates that CQL rejects: `lower(col) = lower(?)` (the default case-insensitive text "equals"), `<>`, `IS [NOT] NULL`, `NOT IN`, `BETWEEN`, `LIKE ... ESCAPE`, `col = 1` for booleans, and the quick search as OR of LIKEs. Now only CQL-valid conditions are pushed (comparisons, BETWEEN as two bounds, `= TRUE/FALSE`, `= ''`, date ranges); the rest stays in the grid on the loaded rows, with a warning. Text equality is pushed case-sensitively (warning). | fixed (see open #A for what was not run live) | `ui/src/filter/sql.ts` (`CQL_SERVER_OPS`, `serverOp`, `splitForServer(..., dialect)`), `ui/src/components/DataTab/DataTabView.tsx` (export context) | `ui/src/filter/__tests__/sql.cql.test.ts` |
| 3 | Export | failed operation | "Current filter & sort" and "All records" exports of a Cassandra table ran `SELECT ... WHERE ... ORDER BY key` as a plain statement: ORDER BY on a non-clustering column is an error and a WHERE on a non-key column needs ALLOW FILTERING; the engine only adapts `data`/`filter` labelled statements and exports use `statement`. CQL export SQL now has no ORDER BY and ends with ALLOW FILTERING after a WHERE. The filtered scope is disabled (with a Cassandra specific reason) when part of the filter or the quick search cannot run on the server, instead of silently exporting too many rows. | fixed | `ui/src/data/sqlgen.ts` `exportSelectSql`; `ui/src/components/Export/sources.ts` | `ui/src/components/Export/__tests__/exportSql.test.ts` |
| 4 | Results pane | failed operation | "Apply on server" wraps the statement in a subquery (`SELECT * FROM (...) q WHERE`), which CQL does not have. Now reported as unavailable with the reason. | fixed | `ui/src/components/ResultsPane/serverFilter.ts` | covered by the existing ResultsPane suites (no new test) |
| 5 | Engine, data grid | failed operation | `INSERT ... USING TTL n` sent with the data label got `IF NOT EXISTS` appended after `USING` (syntax error). The condition now goes before `USING`. | fixed | `CqlSession.DataInsertAsync` | `CassandraIntegrationTests.DataGrid_Insert_WithExplicitUsingTtl_PutsIfNotExistsBeforeUsing` (written; needs a healthy node, see open #B) |
| 6 | Engine, cqlsh | UX | `PAGING OFF` then `PAGING ON` stayed at the 10000-row "off" size. `ON` now returns to the profile's page size. | fixed | `CqlSession`, `CqlSessionSettings.DefaultPageSize` | `Paging_Off_ThenOn_GoesBackToTheProfilePageSize` (passed live), unit test `Paging_DefaultPageSize_IsTheProfilePageSize` |
| 7 | Connection | UX | A user with an empty password failed with the driver's `Value cannot be null. (Parameter 'password')`. Now "A password is required for the user 'x'...". | fixed | `CqlClusterPool.Build` | `Build_UserWithoutPassword_IsExplained_...` |
| 8 | Connection | UX | `NoHostAvailable` without detail (unresolvable host / DC with no node) said only "No Cassandra node could be reached." Now names the likely causes. | fixed | `CqlErrors.ToError` | `Errors_NoHostWithoutDetail_...` |
| 9 | Engine host | broken workflow | Cassandra driver exceptions that escaped the provider (session open on a missing keyspace or an unreachable node, catalog reads timing out) became `500 ENGINE_ERROR` and an error log entry. Mapped like the Oracle / SQL Server exceptions: `422 PROVIDER_ERROR` (`503` for NoHostAvailable). Shared file, one switch arm. | fixed (the live 503 for the mid-life "All hosts tried for query failed" case was seen before the fix; the fix itself was compiled, not re-run live) | `engine/src/DbStudio.Host/Infrastructure/Middleware.cs` | none (no Host test project) |
| 10 | Console | UX | `COPY` answered "use Export ... or Import", but importing into Cassandra is not supported. Message corrected. | fixed | `CqlSession` | existing `ShellCommands_...` (code only) |

## Checked and working (live, no change needed)

cqlsh commands (`CONSISTENCY` get/set/invalid, `SERIAL CONSISTENCY`, `PAGING n|OFF|ON`, `TRACING`, `SHOW VERSION|HOST`, `DESCRIBE`
KEYSPACES/TABLES/TABLE/KEYSPACE and unknown object, `COPY`, `BEGIN TRANSACTION`), syntax and invalid-query errors with line and
column, tracing (extra result set, message, events), grid paging by `LIMIT n OFFSET m` through cached paging states (cold and
cached pages return identical rows, last page and past-the-end), filter by non-key column, ORDER BY dropped, distinct values,
OR-ed key refetch, INSERT conflict (`AlreadyExists`), optimistic UPDATE/DELETE through LWT (stale value reports 0 rows, `IS NULL`
checks, missing row not resurrected), parameter binding for every scalar type (bigint, smallint, tinyint, decimal, varint,
double, float, boolean, uuid, timeuuid, timestamp with milliseconds, date, time, inet, duration, blob) and for list/set/map
columns, connection test (bad port, bad DC, bad host, missing keyspace, `host:port`, SSL on a plain port).

## Open

| # | Finding | Why not fixed |
|---|---|---|
| A | Findings 2-4 were derived from the CQL grammar and the engine code, and proven with vitest; the filter predicates (`lower()`, `<>`, `IS NULL`...) and the export statement were **not run against the node** because it wedged before that script ran. | environment |
| B | The two new integration tests (5, 6): 6 passed live; 5 failed once because the node stopped answering (30 s driver timeouts) and was not re-run after the restart. The unit tests pass (51 passed, 29 integration skipped with `DBSTUDIO_IT=0`). | environment |
| C | Edits of a `varint` / `decimal` value with more than 28 digits are rejected with "is not a decimal number": the shared `ParamValues`/`QueryParam.ToClr` parses `decimal` as `System.Decimal`. Reading such values works. | shared Core code, affects every provider; rare |
| D | `bigint` above 2^53 loses precision in the browser JSON number (all providers). | shared design |
| E | A map literal written without a space after the colon next to a letter (`{'k':true}`) is lexed as a named parameter `:true` when the request also carries parameters. | needs a lexer rule for map context; rare |
| F | LWT edits time out (`WriteTimeout`, write type CAS) when the node is starved of CPU; the update is applied but reported as an error. | environment (node overloaded) |
| G | The UI was not exercised in a browser (out of memory), so the Cassandra tabs (settings, trace, cluster, table info), explorer and designer were reviewed from code and their existing vitest suites only; they pass. The `PAGING ON` / trace / cluster endpoints answered correctly through the API. | environment |

## Test results

`oxlint` exit 0, `tsc -b` clean, `test:intel` green except the known 5,000-line / perf timing tests, full `vitest` under load
failed only unrelated timing-sensitive files (format and ER perf, Snippets, Logs activity; Snippets and Search re-run alone
mostly pass), Cassandra provider xunit with `DBSTUDIO_IT=0`: 51 passed, 29 integration skipped; Host builds in Release.
The solution-wide `dotnet test` was not run (machine out of memory); only the Cassandra test project and the Host build were.

## Shared files touched

`ui/src/lib/sql.ts`, `ui/src/filter/sql.ts`, `ui/src/data/sqlgen.ts`, `ui/src/components/DataTab/DataTabView.tsx` (one line),
`ui/src/components/Export/sources.ts`, `ui/src/components/ResultsPane/serverFilter.ts`, `ui/src/intel/complete/format.ts`,
`engine/src/DbStudio.Host/Infrastructure/Middleware.cs` (one arm).
