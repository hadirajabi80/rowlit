# Generate data walkthrough (WP-9)

Real engine needed (the preview and the run are engine endpoints; mock mode has no generator). Connect "Shop (SQLite)" or any Docker sample.

1. Right-click a table in the explorer, **Generate data...** (also the **Generate...** button in the table's Data tab toolbar and the palette entry "Generate data..." while a table tab is active). A tab "Generate: <table>" opens; one tab per table.
2. The table is read and every column gets a generator from its **type, name and constraints**: `email` gives email addresses, `first_name` first names, `age` 18-80, `price` decimals, `created_at` dates of the last two years, a boolean `is_active` is true 85% of the time, a CHECK `IN (...)` list or an enum becomes "Pick from a list", a CHECK range narrows the numbers, key columns get sequences that continue after the table's highest value. Identity and computed columns are skipped (left to the database). Foreign key columns say "Parent table value": they pick existing values of the parent table (the whole tuple for composite keys).
3. Change any generator in the picker (grouped, only generators that fit the column type). Its options appear next to it (min/max, date range, pattern, list values, phone format...). Wrong options are named in red and disable **Generate**.
4. **NULL %** applies to nullable columns; **Unique** keeps the values distinct (ticked for single-column unique indexes and primary keys). A unique column whose generator cannot supply enough values (a 1-10 range for 50 rows) is refused before anything is written, with the numbers.
5. **Preview** shows the first 20 rows with the seed; it refreshes about half a second after any change. Same seed, same rows: the run writes exactly what the preview shows. The dice button picks another seed.
6. Options: number of rows (default 1,000, up to 5,000,000), **Delete the existing rows first** (asks before running), **All rows in one transaction** (a failure or Cancel leaves the table untouched; off commits every batch), **When the server rejects a row**: stop and name the row, or skip it and report it (check constraints, triggers).
7. **Generate N rows** (Ctrl/Cmd+Enter): progress with rows/s, **Cancel** (confirms; rolled back with one transaction). The result shows rows written and rejected; **Open data** opens the table, **Download error report** saves the rejected rows as CSV, **Generate more** starts again with a new seed.
8. Parent first: generate the parent table, then the child; with an empty required parent the preview says so ("Generate the parent table first"); a nullable foreign key gets NULLs and a warning.
9. Read-only connections, Cassandra, linked databases and views do not offer the command.

Server load path: the Import wizard's writers (SqlBulkCopy, COPY, ClickHouse native insert, Oracle array binding, batched multi-row INSERT). Cassandra is not supported by those loaders (same as the Import wizard).

Tests: engine `engine/tests/DbStudio.Import.Tests/Generate/*` (generators, inference, constraint parsing, row factory, SQLite end-to-end with FK/unique/seed/truncate/cancel/rejected rows, HTTP endpoints, Docker parent/child run on SQL Server, PostgreSQL, MySQL, MariaDB, Oracle and ClickHouse) and UI `ui/src/components/GenerateData/__tests__/*` (commands, model, jobs, the tab).
Bundle: the tab is the lazy `GenerateDataView` chunk (+ its CSS); the commands are in the lazy command modules, so the initial load does not grow.
