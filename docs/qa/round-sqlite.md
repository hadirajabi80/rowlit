# QA round: SQLite

Area: `engine/src/DbStudio.Providers.Sqlite` plus the SQLite parts of the UI (file connections, create-if-missing,
read-only, attach, the built-in "Sample: Shop" database, designer rebuilds, view/trigger edits, import, data editing).
Method: a real engine (`DBSTUDIO_DATA_DIR` in a scratch folder) driven through its REST/WebSocket API with throwaway
scratch databases (copies of the sample file, never a user file), plus the engine and UI test suites.

Severity: crash / wrong data / failed operation > broken workflow > UX.

| # | Area | Sev | Finding | Status | Where | Test |
|---|------|-----|---------|--------|-------|------|
| 1 | Designer: view edit | wrong data | Editing a view (view designer or F4 "Edit" script) runs `DROP VIEW` + `CREATE VIEW`; SQLite drops the view's `INSTEAD OF` triggers with it and nothing recreated them. The apply "succeeded" and the view silently lost its write behaviour. | fixed | `SqliteDdlScripter.ScriptView` (recreates the triggers, renamed views get them on the new name), `DesignerService.ScriptViewAsync` (passes the edited view so the SQLite context lists its triggers), `SqliteCatalogReader.GetDdlAsync` (a view's DDL now includes its triggers, so F4 keeps them) | `EditingAView_KeepsItsInsteadOfTriggers`, `Ddl_ViewIncludesItsInsteadOfTriggers` |
| 2 | Designer: rebuild | failed op | A table rebuild failed with `error in view v_top: no such table: main.v_parent` when a view read another view that depends on the table (a view over a view): SQLite's `RENAME` re-checks every view/trigger, and only views that name the table were dropped. | fixed | `SqliteDesignerDatabase.ReadDependentsAsync` now collects dependents transitively | `Rebuild_WithAViewOverADependentView_Succeeds` |
| 3 | Designer: rebuild + rename | failed op | Renaming a table and changing a column in one go left the `REFERENCES` of other tables pointing at the dropped table; the final `foreign_key_check` then failed the whole apply (`child row 1 -> parent ...`). | fixed | `SqliteDdlScripter.ScriptRebuild`: the rebuild keeps the original name, the rename is a native `ALTER TABLE ... RENAME TO` at the end (SQLite repoints other tables' FKs, views, triggers) | `Rebuild_WithRename_RepointsForeignKeysOfOtherTables` |
| 4 | Designer: rebuild | failed op | `PRAGMA foreign_key_check` reports every violation of the database, so one orphan row in an unrelated table (data loaded with foreign keys off) blocked every rebuild with a confusing message. | fixed | `SqliteDesignerDatabase.ApplyAsync`: baseline of violations before the apply, only new ones fail it | `Rebuild_IgnoresViolationsThatWereThereBefore_ButNotNewOnes` |
| 5 | Designer: rename | failed op | Renaming a table only in case (`orders` -> `Orders`) failed natively: `there is already another table or index with this name`. | fixed | `SqliteDdlScripter.ScriptNative` goes through a temporary name | `RenameOnlyTheCaseOfATable_Works` |
| 6 | Import | failed op | Importing into a table of an attached database failed (`unknown database "arch"`): the import connection did not attach the profile's `attach` databases. | fixed | `SqliteProvider.OpenImportConnectionAsync`, used by `ImportConnections` | `SqliteImportTests.Imports_into_an_attached_database` |
| 7 | Connection | UX | A folder as path said "Database file not found"; create-if-missing in a missing folder said the driver's `unable to open database file`; a missing attached file with create-if-missing off said `unable to open database` (only read-only connections were checked); a malformed `attach` entry (no `name=path`) was skipped silently, the schema just never appeared. | fixed | `SqliteConnections.OpenAsync` / `Attachments` (clear messages, malformed entries are a validation error) | `TestConnection_PathProblems_AreExplained` |
| 8 | Data tab | broken workflow | A SQLite table without a primary key (every table the import wizard creates, any scratch table) was read-only in the Data tab and in console results. | fixed | Row identity is now the hidden `rowid`, like Oracle's ROWID: `data/sqlgen.ts` (`rowidColumnFor`, `isRowidColumn`, select list), `components/Grid/editability.ts`, `components/DataTab/DataTabView.tsx` (a table with its own column named `rowid`, and WITHOUT ROWID tables, stay read-only) | `sqlgen.sqlite.test.ts`, `dataTabSqliteRowid.test.tsx` |
| 9 | Connection dialog | UX | "Create the file if it does not exist" ticked, the Browse button still used an open dialog that cannot name a new file. | fixed | `ConnectionDialog.tsx` passes `createIfMissing` to the native dialog (`promptToCreate`); `*.db3` added to the file filter | `ConnectionDialog.test.tsx` |
| 10 | Sample database | UX | The first query of "Try the sample database" showed `68187.54000000001` (float noise of `SUM` over REAL). | fixed | `app/actions.ts` (`ROUND(SUM(o.Total), 2)`) | (text only) |

## Open / not fixed

| # | Area | Sev | Finding | Why open |
|---|------|-----|---------|----------|
| O1 | Console | cosmetic | An unnamed `?` placeholder is rewritten to `@__p1`, so `SELECT ?` shows a column called `@__p1`. | Needs an alias injection in the binder; no data impact. |
| O2 | Designer | UX | A view created with a column list (`CREATE VIEW v (a, b) AS ...`) loses the list when edited in the view designer (the body is the SELECT only). | Rare; needs a CTE wrapper or a model field. F4 (script edit) keeps the text as is. |
| O3 | Connection | UX | "Test connection" on a profile with create-if-missing creates the (empty) file. | By design: the file is created on connect anyway; documented. |
| O4 | Console | cosmetic | `SELECT NULL AS x` (and `PRAGMA table_info` `dflt_value` of a NULL first row) is typed `binary` because SQLite gives no declared type. | Type is inferred from the first row; harmless. |
| O5 | Explorer | UX | Temp tables/views of a console session are not shown in the explorer (the `temp` schema is excluded). | Intentional; they die with the session. |

## Verified without findings

File connections (create-if-missing, read-only via the profile flag and the `readOnly` prop, `:memory:`, quoted paths,
`%ENV%` paths, empty file, not-a-database file), the query-only guard and its confirmed-write override, attach (create,
query across schemas, catalog, DDL, details), transactions (auto/manual, rollback, lock between two sessions with the
30 s busy timeout and a readable message), error positions, parameters (`:x`, `@x`, `$x`, `?`, `?N`, JSON operators),
multi-result scripts, triggers inside scripts, `PRAGMA`, `VACUUM`, `EXPLAIN QUERY PLAN`, temp-object tracking, the
sample database (counts, view, triggers), import types and values (CSV with quotes, newlines, BOM, unicode, 64-bit
integers, booleans, dates), AUTOINCREMENT counter kept over a rebuild, generated/STRICT/WITHOUT ROWID round trips.

## Shared files touched

`engine/src/DbStudio.Core/Designer/DesignerService.cs` (one argument), `ui/src/data/sqlgen.ts`,
`ui/src/components/Grid/editability.ts`, `ui/src/components/DataTab/DataTabView.tsx`, `ui/src/app/actions.ts` (one
string), `engine/src/DbStudio.Import/Run/ImportConnection.cs` (SQLite branch only).
