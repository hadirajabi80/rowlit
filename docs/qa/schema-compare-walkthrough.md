# Schema compare & sync: QA walkthrough (WP-2, Rowlit 1.7)

The engine side is `engine/src/DbStudio.Core/SchemaCompare/*`. The UI side is `ui/src/components/SchemaCompare/*`, plus the shared picker `ui/src/components/common/ConnectionScopePicker.tsx` / `connectionScope.ts`.

## Setup

- Two schemas of the same kind of database. Docker samples (`engine/tests/docker/compose.yml`): build `cmp_src` / `cmp_dst` with the DDL in `engine/tests/DbStudio.SchemaCompare.Tests/{PostgreSql,SqlServer,MySql,Oracle}CompareTests.cs`. You can also use two SQLite files (`SqliteCompareTests.cs`).
- Without servers: `npm run dev:mock` serves a fixed comparison through `ui/src/mocks/m2/schemaCompare.ts`.

## Steps

1. **Entry points.** These should all open a **Compare: …** tab:
   - right-click a database or schema node, then **Compare schema…** (the source is filled in from the node);
   - right-click a connection, then **Compare schema…**;
   - **Database ▸ Compare schema…**;
   - the palette: "compare", "schema sync" or "migration".

   The item must not appear on Redis, Mongo or Kafka rows.
2. **Pickers.** The source shows connection › database › schema. MySQL/MariaDB/Oracle show one level, labelled Database/Schema. In the target list, connections of another kind and unsupported providers (ClickHouse, Snowflake, Cassandra, linked) are greyed out, and their tooltip gives the reason. Compare stays disabled, with a hint, until both sides are valid. The same schema on both sides is refused, also when one side is "(default: public)". The ⇄ button swaps the sides.
3. **Options.** In the popover, unchecking Views, then Compare, should list no views. Turning off Tables disables the table-part options. The button shows the number of changed options, and **Reset to defaults** clears them. The options survive a restart, because they are kept in the tab state.
4. **Compare.** Click Compare, or press Ctrl+Enter inside the tab. A progress line shows "object (n of m)". **Cancel** stops the job and shows "The comparison was cancelled."
5. **Result list.** Items are grouped as Types, Sequences, Tables, Views, Functions, Procedures, Packages, Triggers. Badges read Create, Alter, Drop or Identical.
   - Filter chips show counts. Identical items are hidden by default.
   - Search matches names, the trigger's table, and the change text.
   - Every differing item is ticked. Group checkboxes are tri-state. Identical items cannot be ticked.
   - Up, Down, Home and End move through the list.
   - A data-loss icon marks drops and narrowing.
6. **Detail tabs.**
   - **Diff** is a Monaco diff: left is the target now, right is the source. A missing side says "does not exist".
   - **Changes** lists the human-readable changes, with warnings: Data loss in red, then Warning, then Note.
   - **Script** shows that object's statements.
7. **Generate script (n selected)** opens **Migration script**. It shows a summary (objects, statements, whether DDL is transactional), then warnings with data loss first, then the full text with the dialect's separators: `GO` on SQL Server, `/` after PL/SQL blocks, `DELIMITER $$` for MySQL routines.
   - **Copy** puts the text on the clipboard.
   - **Open in console** opens a console on the target with the script. For MySQL/Oracle the console uses the target schema.
8. **Apply to target…**
   - If the script drops data, the dialog lists the losses, and Apply stays disabled until "I understand that this data is lost" is ticked.
   - "Stop at the first error" is on by default. On PostgreSQL, SQL Server and SQLite it means one transaction and a rollback on failure. Oracle and MySQL warn that earlier statements stay applied.
   - A failure lists the statement number, the object, the message and the code, with the SQL.
   - After a successful apply, **Compare again** should report no differences.
   - A read-only target blocks Apply and explains why. Copy and Open in console still work.
   - Changing the selection after generating also blocks Apply, with "generate it again".
9. **Per dialect.**
   - PostgreSQL: a view that loses or retypes a column is dropped and created again. A function whose return type changes is dropped and created again; otherwise it gets CREATE OR REPLACE. Enum types are created. Sequence changes become ALTER SEQUENCE.
   - SQL Server: CREATE OR ALTER on 2016 SP1 and later, DROP + CREATE on older servers. FKs on retyped key columns are dropped and re-added around the change. System constraint names (PK__…) are ignored.
   - SQLite: tables are rebuilt. Changed views are dropped before the rebuild and created after it. `PRAGMA foreign_keys` wraps the script.
   - MySQL/MariaDB: routines get DROP + CREATE with no DEFINER. DDL is not transactional.
   - Oracle: CREATE OR REPLACE for code, DROP TABLE … CASCADE CONSTRAINTS. DDL is not transactional.

## Automated coverage

- Engine: `engine/tests/DbStudio.SchemaCompare.Tests`.
  - `ScriptBuilderGoldenTests` runs without servers on all 5 dialects. It covers: alter column type, narrowing as data loss, NOT NULL with and without a default, dropped column or table, FK order, FK drop and re-add around a retyped key, view rebuild/replace, routine replace, batch separators, selection, ignore options, the CREATE OR ALTER version gate.
  - `SqliteCompareTests` runs live on two SQLite files: compare, script, apply, then compare again to get identical; options; support.
  - `PostgreSql`, `SqlServer`, `MySql` (MySQL and MariaDB) and `Oracle` CompareTests are live and skipped without Docker.
- UI: `ui/src/components/SchemaCompare/__tests__`.
  - `model`, `api` and `commands`.
  - `ItemDiff`, with a mocked Monaco.
  - `SchemaCompareView`: pickers and validation, job progress, grouping and filters, detail tabs, script warnings, Open in console and Copy, the apply data-loss gate and failures, read-only and stale blocks, Ctrl+Enter, persisted options.

## Release note (draft)

## Schema compare and sync

Compare two schemas of the same kind of database (PostgreSQL, SQL Server, MySQL, MariaDB, SQLite, Oracle) and bring the target in line with the source. Open it with **Compare schema…** on a database, schema or connection, or from the Database menu.

The result lists every table, view, routine, trigger, sequence and type as create, alter, drop or identical. Each object has a side-by-side diff, a plain-language list of what changed, and its own statements.

Tick the objects you want and **Generate script** builds an ordered migration script. Foreign keys are split off, and dependent views and keys are rebuilt where the server needs it. Data-loss warnings are shown in red: dropped tables and columns, narrowing type changes.

You can copy the script, open it in a console, or **apply it to the target**. Apply runs in one transaction where the server allows it, asks you to confirm any data loss, and lists each failed statement. Read-only connections can be compared but not changed. Options choose which objects and table parts are compared and what to ignore: whitespace, case, comments, collations, constraint names.
