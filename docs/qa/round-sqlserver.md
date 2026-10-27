# QA round: SQL Server

Scope: `DbStudio.Providers.SqlServer` and its UI paths (console, T-SQL IntelliSense, `USE`, schema switcher, describe,
logs/activity, designer scripts, connection test). Driven against the Docker `dbstudio-it-mssql-1` server (SQL Server
2022) with the real engine and the Vite UI. The server became very slow near the end of the session (machine load), so
some Logs and plan probes could not be repeated.

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Console results | broken workflow | A SQL Server console result was never editable ("Columns are not from a table"): a plain `SELECT` carries no base-table metadata. | Fixed: a single parameterless SELECT is described first with `sp_describe_first_result_set` (browse mode), which fills table / schema / key of the first result set. Columns of another database (three-part name) get no table. Nothing runs and no session state changes (`CommandBehavior.KeyInfo` was tried and rejected: its `SET NO_BROWSETABLE` wrapper leaks on cancel / trailing `--`, adds hidden columns, and rewrites syntax errors). XACT_ABORT sessions, temp-table queries and parameterised queries skip it. | `engine/src/DbStudio.Providers.SqlServer/SqlServerSession.cs` (`ExecuteReaderAsync`, `ReadBrowseInfoAsync`, `ApplyBrowseInfo`) | `SqlServerBrowseInfoTests` (join, computed column, other database, trailing comment, failing statement) |
| 2 | Describe (codegen, view designer) | wrong data | `POST /sessions/{sid}/describe` returned a phantom extra key column (the hidden browse column) and reported `editable: true` for a query that did not select the key. | Fixed: hidden columns are cut off. | `SqlServerSession.ApplyBrowseMetadata` | `Describe_DoesNotAddTheHiddenKeyColumn` |
| 3 | Describe | crash-like (silent empty results) | A describe of SQL ending in a `-- comment` swallowed the driver's `SET FMTONLY OFF` / `NO_BROWSETABLE OFF`; every later statement on that session then returned zero rows. | Fixed: the describe text ends with a line break. | `SqlServerSession.PrepareDescribeSql` | `Describe_WithTrailingLineComment_DoesNotPoisonTheSession` |
| 4 | `USE` / database | broken workflow | After running `USE other` as its own statement the next run silently switched the session back to the tab's database (and the toolbar / IntelliSense stayed on the old one). | Fixed: the console follows the session's database (`followSessionDatabase`, wired to `session.changed`; SQL Server only; clears the editor schema of the old database and preloads the new catalog). Verified in the UI. | `ui/src/app/actions.ts`, `ui/src/app/boot.ts` | `ui/src/app/followSessionDatabase.test.ts` |
| 5 | Logs | wrong data | A log / activity query that hit the 30 s limit was reported as success with zero entries (cancel returns no error), or as an opaque 500 "The operation was canceled". | Fixed: a clear 503 "The server did not answer within N s ..."; the timeout is now an instance setting. | `engine/src/DbStudio.Logs/Sql/SqlRunner.cs` (shared by all SQL log sources) | `A_query_that_outlives_the_timeout_is_an_error_not_an_empty_result` |
| 6 | Logs: SQL Agent log | UX | On SQL Server on Linux / stopped Agent the raw "A severe error occurred on the current command" was shown. | Fixed: explained as "SQL Agent log cannot be read ... SQL Agent may not be running". | `SqlServerLogSource.cs` | `Agent_log_that_cannot_be_read_is_explained_not_a_raw_server_error` |
| 7 | Connect dialog | UX | Test connection with a mistyped database took 11 s (driver connect retry). | Fixed for Test (`ConnectRetryCount=0`). Sessions / catalog connections keep the driver default. | `SqlServerProvider.TestAsync` | `TestConnection_WithMistypedDatabase_FailsAtOnce` |
| 8 | Connect dialog | UX | Empty server gave "Server is required. (Parameter 'profile')". | Fixed. | `SqlServerProvider.ToProviderError` | `TestConnection_WithoutServer_SaysSo_WithoutTheParameterName` |
| 9 | IntelliSense | UX | `SELECT TOP 10 |` offered operators / keywords instead of columns. | Fixed (new select marker after the TOP clause). | `ui/src/intel/parse/partial-parser.ts` | `ui/src/intel/__tests__/tsql-completion.test.ts` |
| 10 | IntelliSense | UX | `CAST(x AS |`, `TRY_CAST`, `PARSE`, first argument of `CONVERT(|` offered columns instead of data types. | Fixed. | `ui/src/intel/context/context.ts` | same |
| 11 | IntelliSense | UX | `FROM t WITH (|` offered join keywords; no table hints. | Fixed: NOLOCK, UPDLOCK, ROWLOCK, ... (FROM / JOIN / UPDATE / DELETE / INSERT targets, after `(` and `,`). | `ui/src/intel/complete/completer.ts` | same |

Checked and fine: cross-database completion (`qa_wh.`, `qa_wh.dbo.`, loading row), editor-schema picker, three-part-name
queries, connection errors (wrong password, unreachable host, strict TLS, Windows auth), designer ALTER scripts
(rename, retype, drop column with default + index, defaults, PK change, add column), error log filters / archives,
activity snapshot, linked-server native script text.

## Open (not fixed)

- FIXED: `OUTPUT inserted.|` / `deleted.|` offers the columns of the INSERT / UPDATE / DELETE / MERGE target
  (`ui/src/intel/catalog/binder.ts` `resolveQualifier`; test `tsql-completion.test.ts` "OUTPUT inserted. / deleted.").
- FIXED: columns of a table-valued function after `CROSS APPLY ... o.|`. Catalog functions already completed (the engine
  sends their columns; test "CROSS APPLY table-valued functions"); the gap was the built-in ones: `STRING_SPLIT`,
  `OPENJSON`, `GENERATE_SERIES`, `CONTAINSTABLE`, `FREETEXTTABLE` now have output columns (`tsql-functions.json`, binder).
  `OPENJSON ... WITH (...)` still shows the default key / value / type.
- FIXED: designer `ALTER COLUMN` on a column used by an index, key, foreign key, check or computed column now drops those
  objects first and recreates them after the alter (a warning lists them); a varchar / nvarchar / varbinary widening under
  an index, unique or check stays a bare ALTER. Foreign keys of OTHER tables that reference a changed PK / unique key are
  not scripted (the warning says so); user statistics are not modelled. `SqlServerDdlScripter.FindBlockedDependents`;
  tests `SqlServerBlockedAlterTests` (7). Not run against a live server (Docker was unavailable); the scripts parse with ScriptDom.
- FIXED: session / catalog connections to a mistyped database fail after about 1 s instead of 11 s: the driver's single
  connect retry stays but waits 1 s (`ConnectRetryInterval`) instead of 10 s; Test keeps `ConnectRetryCount=0`
  (`SqlServerConnectionStrings.Build`; test `ConnectRetry_StaysOnce_ButWaitsOneSecond...`). Not timed against a server.
- Snowflake and other providers with a typed `USE DATABASE` may have the same "run reverts the database" behaviour as #4
  (the fix is limited to SQL Server).
- Left: `system_health` log query on this loaded server did not return within the limit (not investigated, per brief).
- Not re-verified because the server stalled: EXPLAIN / plan views, ER diagram, import wizard, Find in database.

## Test status

- `DBSTUDIO_IT=0 dotnet test engine/DbStudio.slnx -c Release`: all projects pass (integration tests skipped).
- Live SQL Server: the 8 browse / describe tests passed against the Docker server before it stalled; the later
  `TestConnection_WithMistypedDatabase_FailsAtOnce` (fix #7) could not be run live (server stopped answering the pre-login
  handshake) and is unverified. The `ConnectRetryCount=0` change was not timed against a real server.
- UI: lint (existing warnings only), typecheck clean, new vitest files pass. Full `npm test` under load shows timeouts in
  unrelated suites (Mongo, Links, snippet editor, pending-edit filter, activateObject); the ones re-run alone pass.
  `test:intel`: only the known timing tests (5,000-line format, P42 perf) fail under load.

## Shared files touched

`ui/src/app/actions.ts`, `ui/src/app/boot.ts` (USE follow-up), `engine/src/DbStudio.Logs/Sql/SqlRunner.cs` (shared log runner).
