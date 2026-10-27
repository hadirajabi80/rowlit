# QA round: MySQL and MariaDB

Scope: provider `engine/src/DbStudio.Providers.MySql`, the MySQL dialect in the UI (DELIMITER scripts, backtick quoting,
generated keys, filters, designer, plans, logs). Servers: mysql:8.4 (13306) and mariadb:11 (13307, 11.8.9). Method: a real
engine from this worktree driven over HTTP/WebSocket (execute, params, catalog, designer, test-connection), the UI dev
server with the headless-Edge script, and xunit/vitest tests for every fix.

Environment note: from about 02:00 the Docker port forwarding on this machine stopped answering (TCP accepted, no MySQL
handshake; the host was out of virtual memory), so the live checks of the logs/activity/KILL views, the plan views and the
second-half UI screens could not be repeated after the fixes. Those areas were checked at the API level before that point
(see "Checked, no finding").

## Findings

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Console messages (MariaDB) | UX / wrong data | After a failed statement or a statement with warnings, every following statement that uses no table (`SELECT 1`, `SET`, `USE`, `BEGIN`, `SELECT @@x`) showed the old error/warning again as its own server message (MariaDB keeps the diagnostics area until a table-using statement runs; MySQL clears it). Fixed: the session notes when the last statement left diagnostics and clears them (`SELECT 1 FROM information_schema.ENGINES LIMIT 0`) before the next statement, except for `SHOW` / `GET DIAGNOSTICS`, which must see them. | fixed | `MySqlSession.cs` (`ClearStaleDiagnosticsAsync`, `ReadsDiagnostics`) | `Messages_OfAnEarlierStatement_AreNotRepeated` (both flavors), `Types_KindsAndBitStrings` |
| 2 | Result values | wrong data | TIME values of 24 h or more read `34.22:59:59` (838:59:59) and negative ones with 7 decimals (`-01:02:03.5000000`); MySQL TIME is a duration up to +-838:59:59. Now `[-]HH:MM:SS[.f]` like the server prints. | fixed | `MySqlTypes.FormatTime` | `Time_BeyondADay_AndNegative_ReadLikeTheServerPrintsThem`, `Types_KindsAndBitStrings` |
| 3 | Grid editing | failed operation | A BIT(n) column could not be saved (`Data too long for column`) and the optimistic-concurrency WHERE (`bit = '0101'`) never matched. The bits now go through `CAST(CONV(@p, 2, 10) AS UNSIGNED)` in SET and WHERE; the cell editor validates 0/1. Checked with BIT(1) and BIT(64) all ones on both servers. | fixed | `ui/src/data/sqlgen.ts` (`isMysqlBit`, `bindCell`), `Grid/editValue.ts` | `sqlgen.mysql.test.ts`, `grid.test.ts` |
| 4 | Grid editing | failed operation | TIME cells could only hold 00:00-23:59 (client check and the engine's `time` bind), so a TIME above 24 h or a negative one could not be edited, and its old value could not be used in the WHERE. MySQL TIME now binds as text and the editor accepts `[-]HHH:MM[:SS[.ffffff]]`. | fixed | `sqlgen.ts` (`kindToParam`), `editValue.ts` | `sqlgen.mysql.test.ts`, `grid.test.ts` |
| 5 | Connection dialog | UX | The CA certificate field showed the SQLite placeholder `C:\data\database.db`, and its file filter (`Certificates\|*.pem;...\|All files\|*.*`) was split on `;` only, so the Browse dialog offered garbage extensions (`Certificates\|*.pem`, `cer\|All files\|*.*`). The filter parser now reads both spellings, the placeholder follows the filter, MySQL declares `C:\certs\ca.pem`. Cassandra's CA field had the same filter text. | fixed | `ConnectionDialog.tsx`, `ui/src/lib/fileFilter.ts`, `MySqlConnectionStrings.cs` | `ConnectionDialog.test.tsx` (`fileFilterExtensions`) |
| 6 | Table designer | UX | Seed and Increment inputs were shown for an AUTO_INCREMENT column but have no effect in MySQL / MariaDB. Hidden for this dialect. | fixed | `TableDesigner.tsx` | (visual; covered by 7) |
| 7 | Table designer | broken workflow | The Identity checkbox read `identity`, but the engine reports an existing AUTO_INCREMENT column as `autoincrement`: such columns showed unchecked, and unchecking a column added in the designer could never remove AUTO_INCREMENT because the engine merges both flags. Both flags are now read and cleared together. Found by reading the code (the designer API output confirmed `autoincrement: true, identity: null`); not re-checked in the browser. | fixed | `designer/table/model.ts`, `ColumnGrid.tsx` | `designer.test.ts` |
| 8 | Test connection | UX | Host problems all read "Unable to connect to any of the specified MySQL hosts." with no reason. The driver's inner socket error (refused / unknown host / timeout) is appended. | fixed | `MySqlErrors.WithCause` | `Errors_ConnectFailureNamesTheSocketCause` |
| 9 | Params | wrong data / failed operation | A DECIMAL bind with more than 28 significant digits (DECIMAL(65,30) columns) is rejected by the shared parameter parser (`System.Decimal`): `'...' is not a decimal number`. Reading such values is exact; only writing/editing/old-value checks fail. | open | `engine/src/DbStudio.Core/Params/QueryParam.cs` (shared), `MySqlParamBinder.Create` | - |
| 10 | Designer | feature gap | Table options (ENGINE, charset, collation, ROW_FORMAT, AUTO_INCREMENT start) cannot be set or shown; tables are created with server defaults and `MODIFY COLUMN` keeps only the collation. | fixed: the designer shows and sets ENGINE, charset, collation, ROW_FORMAT and the AUTO_INCREMENT start value (an options row like ClickHouse's engine row, `TableOptions.extra`); CREATE appends the set ones, ALTER scripts only the changed ones with a warning each (engine / row format rebuild the table; charset and collation change the table default only; AUTO_INCREMENT below the stored maximum is ignored); values are validated as plain words / numbers. | `MySqlTableOptions.cs`, `MySqlDdlScripter.cs`, `MySqlDesignerDatabase.cs` (reads `information_schema.TABLES`), `ui/src/components/MySql/` | `MySqlTableOptionsTests` (engine), `components/MySql/tableOptions.test.tsx` (UI); not run against a live server (Docker unavailable) |
| 11 | Console messages | UX | `EXPLAIN SELECT ...` adds the server note 1003 (the rewritten query) as an info message on MySQL. | open | `MySqlSession.ReadWarningsAsync` | - |
| 12 | Filters | UX | The `ESCAPE '\\'` clause fails when the session runs with `NO_BACKSLASH_ESCAPES`; `lower(col) = lower(@p)` is not index friendly on case-insensitive collations. | open | `ui/src/filter/sql.ts` | - |
| 13 | Details panel | UX | A MariaDB sequence has no properties in the object details (DDL works). | open | `MySqlCatalogReader` | - |

## Checked, no finding

- Console on both flavors: DELIMITER scripts (`$$`), `\G`, comments (`#`, `--`, `/* */`), several statements and result sets per batch, CALL with two result sets and a SIGNAL warning, user variables, `:name` binds, error positions (1064 line/col, 1054 on the column name, 1146 on the table), CAST warning, temporary tables, SHOW / DESCRIBE / EXPLAIN.
- Value reading: BIGINT UNSIGNED max, DECIMAL(65,30), DATE/DATETIME(6)/TIMESTAMP extremes, zero dates (NULL plus warning), YEAR, SET/ENUM, JSON, BIT(64), spatial (WKB), BLOB, 70 000-char text (truncation marker), emoji.
- Writes through the same SQL the grid generates: DATETIME(6), SET, ENUM, JSON, YEAR, BIGINT UNSIGNED, DECIMAL, BLOB/WKB binds, `INSERT () VALUES ()` with `LAST_INSERT_ID()`.
- Catalog, DDL, dependencies, designer model of `orders` on both flavors; MariaDB sequence DDL.
- Test connection: wrong password, unknown user/db/host, bad port, SSL modes, bad SSL mode, missing CA file, session variables (valid, invalid name, unknown variable), compress, latin1. (A few MySQL attempts timed out while the machine was overloaded.)
- MariaDB `ANALYZE` / MySQL `EXPLAIN ANALYZE` of non-queries is confirmed in the UI before it runs (`explain.ts`).

## Not re-verified (machine/Docker problem, see above)

Logs/activity/KILL in the UI, plan views, Find in database, import, codegen and ER on MySQL after the changes; the BIT/TIME
edit round trip through the real grid (covered by the SQL-level checks and the unit tests above).

## Shared files touched

`ui/src/data/sqlgen.ts`, `ui/src/components/Grid/editValue.ts`, `ui/src/components/ConnectionDialog/ConnectionDialog.tsx`
(file-field placeholder/filter for all providers), `ui/src/designer/table/*`.
