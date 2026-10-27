# QA round: feature coverage (cross-cutting)

Scope: make sure every feature in README "Features", `docs/release-notes/*.md` and the command registry works end to end,
independent of the database. Method: real engine (built from this worktree, `--dev`, data dir in scratch space) + Vite
dev server driven by headless Edge over CDP against the PostgreSQL sample (`shop`), mock mode (`vite --mode mock`) for
UI-only features, plus the vitest suites for anything that needs Electron or a second window.

Environment note: the machine was heavily overloaded for most of the round (commit charge at the limit, Docker/WSL
restarted and then hung). SQL Server (sample container) answered "Connection Timeout Expired (pre-login handshake)"
from the first connect attempt of the session, so SQL Server data features were **not** re-verified here; the other
agents' provider rounds cover them. Two harness artifacts, not app bugs: CDP `Ctrl+W` closes the whole Edge target, and a
foreign agent's script once navigated my browser to its own dev server (port collision on the debugging port).

Final checks: `npm run lint` (warnings only, pre-existing), `npm run typecheck` clean, `npm test` 229 files / 2809 tests
passed (2 skipped). Engine, desktop and `src/intel` were not touched, so their suites were not re-run.

## Findings

| # | Area | Severity | Finding | Status | File | Test |
|---|------|----------|---------|--------|------|------|
| 1 | Ctrl+P / palette | broken workflow | Overloaded routines (PostgreSQL, Oracle index them under one name) gave **duplicate React keys** in the Go-to-object list. React leaves stale rows behind when such a list changes, so after typing a filter (`q:`, `t:orders`) the list kept showing functions that do not match (and a `Warning: two children with the same key` per overload). Keys are now numbered per repeat. | fixed | `ui/src/components/CommandPalette/CommandPalette.tsx` (objectMode `items` memo) | `CommandPalette.overloads.test.tsx` (fails without the fix) |
| 2 | Confirmations vs modals | broken workflow | A confirmation raised from another modal opened **behind** it. All modal backdrops are `z-index: 900` and the confirm host is earlier in the DOM than the shortcut sheet, Settings, the connection switcher, Find, multi-run and execute dialogs. Concrete case: Keyboard shortcuts (F1) > *Reset all* showed only a dimmed screen; the "Reset all shortcuts?" dialog was invisible and Esc silently cancelled it, so a preset could never be reset from the sheet. `Dialog` gets an `overlayClassName`, the confirm dialog uses `overlay-above` (`z-index: 950`, below menus 1000 / toasts 1100). Verified in the browser. | fixed | `ui/src/components/common/Dialog.tsx`, `ConfirmDialog.tsx`, `ui/src/theme/app.css` | `components/layout/shell.test.tsx` ("stacks above other modals") |
| 3 | Command registry | n/a | New safety net: every registered command (300+) has a unique id, title, category and `run`, and every `when()` returns a boolean/undefined for no argument, junk and every target shape without throwing. | added | n/a | `ui/src/commands/commandSmoke.test.ts` |

No open defects were found in the verified areas. Open items are only the unverified ones listed in the checklist.

## Checklist

Legend: PASS = verified by driving the feature (real engine unless "mock"); TEST = covered by a passing automated test
only, not driven by hand; NOT RUN = could not be verified in this environment.

| Feature / command ids | Result | How verified |
|---|---|---|
| Command palette Ctrl+Shift+P (`view.commandPalette`, command search, `when` gating) | PASS | typed filters, runs commands; "Explain plan (actual)" correctly hidden outside an editor tab |
| Go to object Ctrl+P (`view.goToObject`), prefixes `t: f: q:` | PASS (after fix 1) | PG catalog, saved query found with `q:`, "Load catalog of X" rows for unloaded connections |
| Saved queries (`queries.save`, `queries.saveToSchema`, Ctrl+S in place, `q:` in Ctrl+P, Queries folder count) | PASS | save dialog, rename of tab, in-place Ctrl+S, appears in Objects tab and Ctrl+P |
| Snippets Ctrl+J (`snippet.insert`), Settings > Snippets list (238 query snippets shown) | PASS | inserted the `cte` snippet; Settings list renders built-ins and "New snippet" |
| Format SQL (`format.document`, `format.selection`) | PASS | one-line join/where/order query reformatted |
| IntelliSense / hover / diagnostics in console | PASS | suggest widget, hover shows `public.orders.total numeric(12,2) NOT NULL` |
| Console: run statement/script (`run.statement`, `run.script`), multiple results, Messages with line number, error, history entry | PASS | 3-statement script: 2 result sets + `[22012] division by zero, line 3` |
| Results dock: bottom/right/left/own tab, dock back (`results.dockBottom/Right/Left`, `results.openInTab`) | PASS | all four positions |
| Query history (list, tags, search, `history.*`) | PASS | explain entries tagged, full-text filter works |
| Explain estimated / actual / raw (`explain.estimated`, `explain.actual`) | PASS | PG tree with cost bars, node details, actual rows/time, raw JSON |
| Objects tab + details panel (`objects.open`, `objects.toggleDetails`, uses / used by) | PASS | PG `orders`: FKs, views, routine, trigger |
| Dependencies (object tab Dependencies, details panel) | PASS | details panel lists uses and used-by (3 FKs, 2 views, routine, trigger) |
| Find in database Ctrl+Shift+F (`search.findInDatabase`) | PASS | names, columns, code matches, preview, Enter opens procedure |
| Execute routine (`routine.execute`) + run page | PASS | procedure with IN/OUT params and NULL toggles (error shown on run page with line); function overload chips, return-value card (`fn_tax(100)` = 19.00) |
| ER diagram (`er.open`, layout menu, PNG/SVG export) | PASS | rendered 8 tables / 4 relationships; PNG 283 KB and SVG 10 KB produced. Layout menu lists layered L-R, T-B, grid, reset (grid not applied, see environment note) |
| Table designer (`dataTab.design`, DDL preview, discard prompt) | PASS | PG `orders`: added a column, `ALTER TABLE ... ADD COLUMN` preview, discard confirmation (not applied) |
| Codegen (`codegen.open`) C#, Go, Java, Python, TypeScript | PASS | PG `orders`; Prisma is the TypeScript flavor for PG; SQL/JSON/CQL covered by `ui/src/codegen/__tests__` |
| Settings (all 8 sections: General, Appearance, Editor, Results & grid, SQL formatting, Connections, Snippets, Updates) | PASS | every section renders its controls |
| App themes (Light, Paper, Solarized Light, IntelliJ Light, Midnight, Nord, Violet, Darcula) and mode switch | PASS | `data-theme`, background and accent change per theme; code themes list with previews; theme unit tests |
| Keymap editor F1 (`view.shortcuts`): search, record chord, conflict warning (keep both / replace / cancel), presets, reset all | PASS (after fix 2) | SSMS preset applied ("Edited 6"), Reset all confirmation now visible and works |
| Split editor groups (`view.splitRight`, `view.joinGroups`, move/focus group) | PASS | mock mode |
| Detached windows (`view.openInNewWindow`, `view.reattachTab`) | TEST | Electron-only; `src/components/EditorGroups` and desktop window tests pass |
| Schema / database colours (`scope.setColor`) | TEST | ScopeColor tests; colour dots visible on connection stripes in explorer |
| Export (`grid.export.*`, "Export data…" scopes, copy as) | PASS (mock) | menu lists CSV/Excel/JSON/SQL INSERT + 5 copy formats; dialog offers loaded rows / re-run all rows; CSV download produced (108 KB) |
| Import wizard (`import.open`, `import.openFile`), drop a file on the window | PASS (UI, mock) | dropping `people.csv` opens the 6-step wizard; in a browser the path cannot be read, so the wizard asks for the path (desktop passes it). Import execution is covered by the engine/ImportWizard tests of the import round |
| Multi-run (`run.multi`) | PASS (mock) | 2 connections, per-connection result tabs with row counts and times, Run again / Cancel |
| Logs and activity (`view.logs`, `logs.*`) | PASS (mock) | engine log with level filters, time range, tail, export; Activity shows a clear message for SQLite |
| Resources popover, Close connection, Free memory now, Disconnect all (`resources.show`, `connections.disconnect`) | PASS (mock) | memory state, engine/windows/cache split, per-connection session list, actions |
| Idle release / LRU / background result release | TEST | `src/app/resources.test.tsx` |
| Auto-update UI: status chip, check, stop/resume download (`help.checkForUpdates`) | TEST | `components/layout/updates.test.tsx`, `StatusBar/UpdateChip.test.tsx` (fake updater state). In the browser build Settings > Updates shows only the releases links, as designed |
| Workspace restore after reload | PASS | tabs, active tab, unsaved console text and results dock restored; connections reconnect |
| Drag and drop: data files open the Import wizard (verified); .sql opens a console (not driven by hand) | PASS (CSV) / TEST (.sql) | see import row; `components/DropOverlay` tests |
| Command smoke: every command registered and `when()` safe | PASS | `commandSmoke.test.ts` |
| SQL Server data features (tabs, console, designer, ER on `shop`) | NOT RUN | container unreachable (pre-login timeout) for the whole session |
| Oracle, MySQL, MariaDB, ClickHouse, Redis, Mongo, Kafka, Elasticsearch, Cassandra data features | not in scope | covered by the per-database rounds |

## Observations (not defects)

- Headless runs were 5-10x slower than normal under the memory pressure; several dialogs take >1 s to appear.
- The Design tab header briefly reads "New table" while the table loads, then "Design table".
- The shortcut sheet opens scrolled to the Help section (the row of the command that opened it is selected) rather than at the top.
- The Keyboard shortcuts sheet and the confirm dialog use `.overlay` without a stacking contract; other store-driven dialogs
  that may need to appear over modals should pass `overlayClassName="overlay-above"` too.
