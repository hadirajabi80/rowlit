# Data transfer + SQL dump: QA walkthrough

Feature: WP-3 of the 1.7 plan. Engine `engine/src/DbStudio.Core/Transfer/*` (module `TransferModule`), UI `ui/src/components/Transfer/*` (lazy tab `transfer`).

## Entry points
- Explorer right-click on a table / view (multi-selection = pre-ticked), a schema / database, a connection: **Transfer data…**, **Dump to SQL file…**.
- Menu **Database › Transfer data…**; palette `transfer.open`, `transfer.dump`.

## Walkthrough
1. Sample Shop (SQLite) › Transfer data…: Source lists the 5 tables; "Include views" adds `v_*`; the filter narrows the list; Next stays disabled until a table is ticked.
2. Target › Connection: pick an empty SQLite file connection (or a Docker server). A Snowflake / Cassandra connection shows "can be a source only"; a read-only connection shows "read-only".
3. Mapping: tables appear parents first (Countries, Customers, Orders, Products, OrderLines). Open a card: change a target type (the list comes from the target's types), untick a column, rename the target table, type a filter. `1=1; drop` blocks Next. Notes of lossy conversions are listed.
4. Options: create mode (fail / keep / drop and re-create / none), rows (append / replace / upsert / structure only), keys, indexes, identity, name case, batch size, continue on error.
5. Run: Start transfer. Progress shows the overall bar, the table being copied and rows/s; Escape or Cancel transfer asks first. The result lists rows per table, errors with the refused statement, and Open for each target table. The target's explorer refreshes.
6. New transfer › Target › SQL file: the dialect defaults to the source's own; pick PostgreSQL, paste a path wrapped in quotes ("Copy as path"). Run: "Wrote shop-pg.sql (… KB)". The file holds CREATE SCHEMA/TABLE, multi-row INSERTs, indexes and foreign keys after the data, and `setval` for identities.
7. Run the dump of a SQLite source in SQLite dialect on an empty SQLite database: the rows and the foreign keys are back.

## Cross-engine matrix (Docker)
`DBSTUDIO_IT` unset, `docker compose -f engine/tests/docker/compose.yml -p dbstudio-it up -d`, then `dotnet test engine/tests/DbStudio.Transfer.Tests`: `MatrixTests` copies the library sample between every pair of SQL Server, PostgreSQL, MySQL and SQLite; `ShopTransferTests` copies the SQL Server shop to PostgreSQL.

## Verified (2026-10-28)
- Live in the dev UI against a dev engine: SQLite sample → SQLite file (6,407 rows, 5 tables) and SQLite → PostgreSQL .sql dump (281 KB).
- Docker Desktop did not answer (`docker ps` timed out, server ports accepted TCP but sessions timed out), so the matrix was not re-run on this main; covered instead by unit tests: type mapping and SQL text per dialect, SQLite copies (overrides, upsert, truncate, drop and re-create, cancel mid-table, progress), dumps in all 7 dialects, dump round trip.
