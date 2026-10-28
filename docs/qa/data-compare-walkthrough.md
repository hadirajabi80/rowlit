# Data compare & sync: QA walkthrough (WP-10, Rowlit 1.8)

The engine side is `engine/src/DbStudio.Core/DataCompare/*` (endpoints under `/data-compare`). The UI side is `ui/src/components/DataCompare/*`, reusing the shared picker `ui/src/components/common/ConnectionScopePicker.tsx`. Literals and multi-row INSERTs come from Data Transfer (`Core/Transfer/TransferSql.cs`, `TypeMapper.cs`).

## Setup

- Docker samples (`engine/tests/docker/compose.yml`). In two schemas (or a PostgreSQL schema and a SQL Server schema), create the `items` table and data that `Scratch.SeedItemsAsync` builds in `engine/tests/DbStudio.DataCompare.Tests/TestEnv.cs`, then run the `MutateAsync` statements on the target. That gives 5 changed rows, 3 rows only in the source and 4 only in the target.
- Without servers: two SQLite files with the same table, as in `SqliteDataCompareTests.cs`.

## Steps

1. **Entry points.** These should all open a **Compare data…** tab:
   - right-click a table or a view, then **Compare data…** (the source table is filled in);
   - right-click a schema or database, then **Compare data…** (the table is empty);
   - **Database ▸ Compare data…**;
   - the palette: "compare data", "sync rows";
   - in Data Transfer, after a run to a connection, the **Compare** button of a copied table (both sides are filled in).

   The item must not appear on Redis, Mongo or Kafka rows.
2. **Pickers.** Each side is connection › database › schema › table. Choosing the target connection pre-selects the table with the source's name, once; a table you clear stays cleared. **Query** switches a side to a SQL query (its rows are compared but never written). A table side has an optional filter (a condition without WHERE, no `;` or comments). The ⇄ button swaps the sides. The same table with the same filter on both sides is refused.
3. **Columns.** After both tables are picked, **Columns (key: id)** lists the columns both sides have, with a Key and a Compare checkbox and both types. Columns only on one side are listed below the table and in the notes. Computed and rowversion columns are not compared by default. Without a primary key on either side, Compare stays disabled with "choose the key columns". Ticking a key column enables it.
4. **Options.** Ignore leading/trailing spaces, ignore case, empty text = NULL, number tolerance, time tolerance (ms), differences to keep (1 to 200,000), row order (Automatic / Servers sort / Engine sorts). The button shows how many options are changed. The options are kept in the tab state.
5. **Compare.** Click Compare, or press Ctrl+Enter inside the tab. The progress line shows the rows read per side and the differences so far. **Cancel** stops the job.
6. **Result.**
   - Cards show Equal, Changed, Only in source, Only in target, and Duplicate key when there are any. Clicking a card filters the grid, and clicking it again shows all.
   - Below the cards: both labels with their row counts, the key, whether the servers or the engine sorted, and the time.
   - In the grid, changed cells show the target value struck through over the source value, rows only in the source are green, and rows only in the target are red. The key columns have a key icon. Columns that are not compared have an italic header.
   - **Load more** pages through the kept differences. "n of m shown" counts the kept rows.
   - With the limit reached, a note says only the first n were kept. The counts stay exact.
7. **Collations.** Compare a PostgreSQL table with a SQL Server table keyed on text in mixed case (the `Text_keys_sort_the_same…` test data). The servers sort by binary collations, so the result says "sorted by the servers". With keys of different kinds (an integer key against a varchar key), the notes say "Rows were sorted by the engine".
8. **Synchronize…**
   - **Direction.** "Make the target like the source" is the default. "Make the source like the target" is the alternative. A query side, or a provider that cannot be written (ClickHouse, Snowflake, Cassandra), greys out that direction with the reason.
   - **Classes.** Insert n rows missing / Update n rows that differ / Delete n rows only in the side that changes. Rows with a duplicate key are never synchronized.
   - **Generate script** shows the counts and the script: deletes, then updates (only the changed columns, matched on the key), then multi-row inserts. SQL Server adds `IDENTITY_INSERT` around inserts of identity values and `GO` separators. PostgreSQL moves the identity sequence afterwards.
   - **Copy** and **Open in console** work. The console opens on the side that changes, in its database.
   - **Apply…** asks for confirmation, listing the inserts, updates and deletes; deletes are shown in red. "Run in one transaction" is on by default: a failure rolls everything back and shows the statement. Afterwards, **Compare again** should report no differences.
   - On a read-only connection, Apply is disabled, but the script and Open in console still work.

## Automated coverage

- Engine: `dotnet test engine/tests/DbStudio.DataCompare.Tests`. It covers comparers, the merge join (composite and NULL keys, duplicates, order violations), golden sync scripts per dialect, and SQLite end to end (always runs). It also has Docker suites for PG↔PG, PG↔SQL Server, MySQL↔SQLite and collation ordering, which are skipped when the servers are unreachable.
- UI: `npx vitest run src/components/DataCompare`.
