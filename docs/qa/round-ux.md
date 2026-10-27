# QA round: UX / usability

Scope: the daily DBA / developer task flows (first run, add connection, find a table and open its data, filter / sort /
edit / save, console + IntelliSense, save query (Ctrl+S), Find in database (Ctrl+Shift+F), import a CSV, export, run a
procedure, close / quit, update flow). Driven against a real engine (PostgreSQL / SQL Server / MySQL connections from
the Docker sample servers, SQLite) with headless Edge, plus code review of dialogs, focus, shortcuts and messages.

What already works well (checked live): first-run welcome and sample database, Enter / Esc / focus return in dialogs,
Ctrl+Shift+F (results stream, preview, Enter opens), Ctrl+S in a console opens "Save query to schema" with the name
selected, Ctrl+P, execute-routine dialog (Enter runs), grid edit with F2 + Ctrl+S, "Discard pending changes?" on
closing a data tab, quoted-path handling in the engine, connection test messages from the engine.

## Findings

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Ctrl+P / Explorer | broken workflow | Overloaded routines (PostgreSQL) come from the catalog once per overload. Their palette rows and tree nodes shared one React key: the palette showed ghost rows that did not match the query (and logged duplicate-key warnings); the tree showed 10 functions where the Objects tab shows 7. | fixed: one entry per routine name in the tree (full and filtered), the palette index; palette keys also made unique | `Explorer/tree.ts` (`ROUTINE_TYPES`, `groupObjects`, `buildFiltered`), `CommandPalette/objectIndex.ts`, `CommandPalette/CommandPalette.tsx` | `tree.test.ts`, `objectIndex.test.ts` |
| 2 | Messages pane | UX | A typo in a table or column on PostgreSQL, MySQL / MariaDB, ClickHouse or Snowflake got no "Did you mean ...?" (only SQLite, SQL Server, Oracle wording was recognised). PostgreSQL folds `Custmers` to `custmers`, so suggestions also failed on case. | fixed: wording of the four engines recognised, distance ignores case | `MessagesPane/errorHelp.ts`, `editor/markers-core.ts` | `errorHelp.test.ts` |
| 3 | Connection dialog | UX | A failed "Test connection" showed only the driver text (e.g. `Failed to connect to 127.0.0.1:15439`). Now one extra line says what to check: credentials, host / port / firewall, database name, certificate / SSL. Unknown messages get no hint. | fixed | `ConnectionDialog/connectionHints.ts`, `ConnectionDialog.tsx` | `connectionHints.test.ts` |
| 4 | Import wizard / Export | UX | A path pasted with Windows "Copy as path" (`"C:\x\a.csv"`) worked, but the file card and the review step showed `a.csv"`. Quotes around the whole path are now removed on paste in the import file field and the export "Save to" field. | fixed | `ImportWizard/files.ts` (`cleanPastedPath`), `SourceStep.tsx`, `Export/ExportDialog.tsx` | `files.test.ts` |
| 5 | Import wizard | UX | Esc in the wizard asks "Close the import?" but the destructive "Close" had the focus, so Esc, Enter threw the whole setup away. Now a danger confirmation: "Keep editing" has the focus. | fixed | `ImportWizardView.tsx` | `ImportWizard.test.tsx` |
| 6 | Data grid | UX / keyboard | Sorting was only possible by clicking the header (or selecting the column first). The cell menu (right click, Shift+F10) now has "Sort by this column" (ascending / descending / clear). | fixed | `Grid/DataGrid.tsx` | `dataGrid.test.tsx` |
| 7 | Update flow | data loss | "Restart to update" (status bar chip, notice, Settings) restarted without asking while a grid had unsaved edits or a transaction was open (both are lost). It now asks (danger confirmation, "Not now" focused) and names what would be lost; consoles are kept anyway (workspace file). | fixed | `app/unsavedWork.ts`, `app/updates.ts` | `unsavedWork.test.ts` |
| 8 | Copy | UX | "About Rowlit" and the explorer empty state listed only the first seven databases. | fixed | `commands/core.ts`, `Explorer/Explorer.tsx` | (copy only) |
| 9 | Quit / window close | data loss | Closing the window or quitting (Alt+F4, Cmd+Q) ends the engine without a word: unsaved grid edits are lost and open transactions roll back. Only per-tab closing asks. | open (proposal) | `desktop/src/main/main.ts`, `window.ts` | - |
| 10 | Engine / explorer | broken workflow | When the database server stops answering without closing the TCP connection (Docker restart, VPN drop, laptop sleep), the pooled connection hangs: `GET /catalog/databases` did not answer within 60 s, the explorer shows "Connecting..." and the data tab "Loading ..." for minutes, with no timeout, error or Cancel. Seen live after Docker Desktop restarted. | open (not reproduced in isolation, engine area) | engine catalog calls on a dead pooled connection; UI `Explorer` status rows | - |
| 11 | Links | UX | Two confirmations that throw work away are not danger confirmations (default focus on the destructive button): "Discard SQL edits" (`Links/builder/BuilderView.tsx`) and "Remove source" (`Links/editor/save.ts`). Left alone (Links area). | open (small) | see left | - |
| 12 | Find in database | UX | Enter pressed while the first results are still streaming in does nothing (the selection is only set when results arrive). Minor. | open | `Search/SearchPanel.tsx` | - |
| 13 | Data tab close | UX | "Discard pending changes?" offers only Cancel / Close and discard; a "Save and close" would save one click. | open (proposal) | `DataTab/commands.ts` `beforeClose` | - |

## Proposals (bigger)

* **Quit guard (finding 9).** In the renderer, a `beforeunload` handler that blocks only when `unsavedWork()` (added in
  `app/unsavedWork.ts`) reports something; in the main process, `webContents.on('will-prevent-unload')` showing a
  "Quit anyway / Cancel" box and calling `event.preventDefault()` to proceed. It cannot be done by those two pieces
  alone: on Windows `before-quit` already calls `cleanup()` (kills the engine) before the windows close, so a cancelled
  quit would leave a running window without an engine. The quit sequence has to move the engine shutdown after the
  windows have agreed to close (`will-quit` / `window-all-closed`), and the detached windows' `closeAll()` must be
  covered too. Needs a manual Electron test on Windows and macOS, so it was not done blind.
* **Dead-connection timeouts (finding 10).** Give catalog and metadata requests a deadline (and the connect row a
  Cancel / Retry), and verify pooled connections with a short ping after idle or sleep before use.
* **Overload names (finding 1).** Overloads of a routine are now one node; if per-overload opening is wanted, the
  catalog objects need a signature in their identity (engine `catalog/object` takes only a name today).

## Test results

`npm run lint` (0 errors, pre-existing warnings), `npm run typecheck` clean, `npm test`: 2808 passed, 11 failed under
load in one full run. Re-run alone: SearchDialog, ActivityView and the Snippets settings tests pass. Still failing
alone, in files and code this round did not touch: Redis `views.test.tsx` "can be cancelled" and `browser.test.tsx`
"list: pages, pushes and sets an element" (Redis), and the ER `layout.test.ts` 500-table timing test. The 5,000-line
format timing test and `tokens.test.ts` are the known load-flaky ones. No engine or desktop code was changed, so the
.NET and desktop suites were not run.

## Environment notes

* Docker Desktop became unavailable (HTTP 500 from the daemon pipe) during the round, so the Oracle / MySQL / ClickHouse
  walkthroughs were limited to what ran before that; the sample containers were not touched by this round.
* Parallel agents share `ui/node_modules/.vite`; the dev servers used here ran with a private `cacheDir`
  (an uncommitted local `vite.ux.config.ts`) to avoid corrupting each other's dependency optimizer.
