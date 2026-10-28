# Local history of editors: QA walkthrough

Feature (WP-6, competitor plan): every console keeps a private timeline of its text. Engine: `engine/src/DbStudio.Core/LocalHistory/*`
(`local-history.db`, REST under `/local-history`). UI: `ui/src/components/LocalHistory/*` (capture in the initial bundle at about
0.2 KB gzipped, the view is a lazy chunk). Setting keys (free-form `settings.ui`): `localHistory` (default on), `localHistoryDays` (default 30).

## Snapshot triggers (no editor code involved)

| Trigger | Reason shown | Check |
|---|---|---|
| A console opens with text (file opened, workspace restored, new console with text) | Autosave | Open a .sql file, open history: one snapshot with the file's text |
| Run / Run script in a console (any new execution) | Run | Type, Ctrl+Enter, Ctrl+Alt+H: a Run row with the typed text |
| Save, Save as, Save query, Save of an "Edit:" console to the database | Save | Ctrl+S on a file console |
| Console closed | Closed | Type, Ctrl+W, reopen history from "Reopen closed tab" |
| Text changed and 2 minutes passed | Autosave | Type, wait 2 min, no Run: an Autosave row appears; typing continuously gives one row per 2 minutes |
| Restore | Before restore | Text replaced by a restore is itself kept |

Identical text is never stored twice in a row for the same editor. Blank text and texts over 5 million characters are skipped.

## Identity (survives restarts)

- Console bound to a saved query: `q:<id>`; "Edit:" console: object (`o:conn|db|schema|type|name`); console saved to a file: `f:<path>`;
  any other console: its persisted tab id `t:<id>`. The view lists the union of the keys a tab can have had, so a console that was saved to a file
  keeps its earlier snapshots.
- Restart the app: the workspace restores the console with the same id, the history is still there.

## The view (Ctrl+Alt+H, Edit menu, tab context menu, editor context menu, palette "Local history…")

1. Left: snapshots newest first, grouped by day, with reason icon, time, label, size change. Arrow keys move the selection; "Load older snapshots" pages by 100.
2. Right: Monaco diff of the selected snapshot against the editor's current text; Restore is disabled when they are identical.
3. Restore replaces the editor text (undoable with Ctrl+Z) and stores the replaced text first.
4. Copy copies the snapshot; Label names it (a labelled snapshot is never trimmed or pruned); Delete removes one; Clear history asks first and removes all keys of the editor, labelled ones too.
5. Editor closed while the tab is open: banner, Restore disabled, Copy still works. History switched off: banner, older snapshots stay readable.

## Limits and retention

- 200 unlabelled snapshots per editor, 30 days (Settings, Editor, "Keep snapshots for (days)", 1 to 365), 20 MB of compressed text in total. Labelled snapshots are exempt.
- Pruning runs once per engine start (defaults), and once per UI session after the first stored snapshot with the configured days.
- Text is gzip-compressed in SQLite; `local-history.db` sits next to `history.db` in the data directory.

## Automated coverage

- Engine: `engine/tests/DbStudio.Core.Tests/LocalHistory/LocalHistoryServiceTests.cs` (19 tests with the endpoint tests: snapshot, dedupe, per-key cap, labels, prune by age and size, validation, Unicode, persistence across instances) and `LocalHistoryEndpointTests.cs` (HTTP shapes and 400/404 envelopes).
- UI: `ui/src/components/LocalHistory/__tests__/capture.test.ts` (every trigger, fake-timer autosave, settings gate, retry), `model.test.ts` (keys, deltas, grouping, settings), `LocalHistoryView.test.tsx` (command, list, diff selection, keyboard, restore, label, delete, clear, banners).
- Mock mode (`npm run dev:mock`) serves `/local-history` from `ui/src/mocks/localHistory.ts`; screenshots via `ui/scripts/shot.mjs`.

## Known limits

- Snapshots of a detached window's consoles are taken by that window; a tab moved between windows records one "Closed" snapshot (deduped).
- The Monaco diff switches to the inline layout when the pane is narrower than about 900 px (Monaco behaviour).
- In the Vite mock dev server the codicon font reports a load error, so diff gutter signs showed as boxes in the screenshot; not checked in the built app.
