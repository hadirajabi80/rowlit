# QA round: visual design

Scope: consistency of spacing, type, icons and colour tokens across the app, all nine app themes (Light, Paper,
Solarized Light, IntelliJ Light, Dark, Midnight, Nord, Violet, Darcula), at 1440x900, 1280x720 (partly) and 900x600.
Run against `npm run dev:mock`, driven with `ui/scripts/shot.mjs`. Screenshots (before/after) are in
`C:\Users\Hadi\AppData\Local\Temp\claude\E--DbStudio\54e64b54-96a5-48b2-bf35-f890692b32ca\scratchpad\qa-design\{before,after}`.

## Method

Beside eyeballing about 400 screenshots, every screen was measured in the page with injected DOM audits:

- **Contrast audit**: every visible text node against its effective (alpha-blended) background, flagging < 4.5:1.
- **Layout audit**: document/body horizontal overflow, clipped text without ellipsis, accidental micro scrollbars
  (scrollHeight/Width exceeding the box by 1-12 px), elements past the viewport, controls under 20 px.
- **Focus tour**: Tab through the shell and report controls with no outline/shadow.

Screens covered per theme: Welcome, explorer, Objects tab and details panel, console with results docked bottom and right,
data tab, Settings (all eight sections), Find in database, command palette, empty states (explorer filter, History,
Connections, Find, palette). Light 1440 additionally: ER diagram, Import wizard, Execute dialog, keymap/shortcuts,
Resources popover, connection dialog, table designer, context menus, Logs, Redis, Mongo, Kafka, Elasticsearch,
linked-database query builder. Narrow (900x600) light and dark: the main set; light: the source views and the builder.

## Findings

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Find in database | UX (a11y) | Muted result text (`.sx-kind`, line numbers, icons) on the selected row used `--fg-muted`: 3.78:1 in Dark (needs `--fg-muted-on-selected`). | fixed | `components/Search/search.css` `.sx-row.active` | `designQa.test.ts` |
| 2 | Find in database | UX (a11y) | Coloured "N columns / N in code / N in data" badges used the plain kind colours on `--bg-sunken`: 4.35:1 in Solarized Light (4.40 in Light for `--obj-package`). Badge text is now `color-mix(kind 65%, --fg)`; the contrast matrix gained the matching `mix:` pairs for all nine themes. | fixed | `search.css` `.sx-badge.*`, `theme/contrastMatrix.ts` | `themes.test.ts`, `tokens.test.ts`, `designQa.test.ts` |
| 3 | Nord theme | UX (a11y) | Search highlight (`--mark-bg`, 28 % yellow) left `--fg` at 4.31:1 on the selected Find/palette row. Nord now uses 20 %; matrix pair added (mark on `--bg-selected`). | fixed | `theme/themes.ts` NORD, `contrastMatrix.ts` | `themes.test.ts` |
| 4 | Import wizard, Mongo | UX (a11y) | Muted pills/tags/counts on `--bg-active` (`.iw-pill`, `.iw-tag`, `.mg-subtab-count`, `.mg-stage.disabled .mg-stage-n`, `.mg-ixkey b`) used `--fg-muted`: 4.19:1 in Dark. Now `--fg-muted-on-selected` (the matrix pair meant for exactly this). A static test fails any new `--fg-muted` text on `--bg-active`. | fixed | `ImportWizard/importWizard.css`, `Mongo/mongo.css` | `designQa.test.ts` |
| 5 | Objects tab | broken layout | At 900 px wide (explorer open) the toolbar did not fit: "Details" was pushed past the window edge and the whole document scrolled sideways (958 > 900); the list header (min column widths 738 px) also overflowed the document. Toolbar now wraps to a second row (`flex-wrap`, filter box + layout buttons stay right), the name/comment minimum widths are 150/100 px and `.ol-main` clips its header. Unchanged at 1280+ (one row). | fixed | `ObjectList/objectList.css`, `ObjectListView.tsx` (columns) | `designQa.test.ts`; DOM audit PAGE-H-OVERFLOW gone |
| 6 | Linked query builder | broken layout | At 900 px the grid (220 px list + 240 px stage + 340 px SQL panel) exceeded the pane, so the SQL panel was cut off at the right edge and the document scrolled (1003 > 900). List and SQL columns are now `minmax(0, N px)` (saved sizes are still the maximum), the stage keeps `minmax(200px, 1fr)`. | fixed | `Links/builder/BuilderView.tsx:509` | DOM audit |
| 7 | Messages pane | UX | The error hint ("None of the tables ... has a column named ...") inherited `white-space: pre-wrap` and wrapped as a flex row: in a right-docked (narrow) results pane the bulb sat alone and the sentence dropped below it, or ran off the pane. Bulb, sentence and action now stay on one row; the sentence shrinks and wraps. | fixed | `components/layout/layout.css` `.message-help` | `designQa.test.ts` |
| 8 | Mongo collection view | UX | The sub-tab strip (`.mg-subtabs`, overflow-x: auto) showed a stray vertical scrollbar thumb (content 1 px over its 34 px box). `overflow-y: hidden`. | fixed | `Mongo/mongo.css:11` | DOM audit MICRO-SCROLL gone |
| 9 | Darcula | UX (a11y) | Search highlight on elevated surfaces (palette, dialogs): `--fg` 3.72:1 (3.81 in the Find list, 3.55 for snippet tab-stop pills in Settings > Snippets). The theme's text is only ~5:1 on `#3c3f41`, so any visible tint costs it; reaching 4.5 means a 6 % tint that is hardly visible. | not fixed (judgement) | `themesExtra.ts` DARCULA_APP `--mark-bg` | - |
| 10 | Nord | UX (a11y) | Snippet tab-stop pills (`.snip-ph`, syntax colours on `--accent-soft`) 4.3:1 in Settings > Snippets. | not fixed (marginal) | `SnippetsSettings.css:67` | - |
| 11 | Focus indicators | UX | Not a bug: a programmatic focus sweep of every visible control (shell, console + results, data tab: 64-84 controls each) found an outline or ring on all of them; only the explorer tree (roving rows, the selected row is the indicator) and the borderless filter input (ring on its wrapper) show focus differently. Dialogs and other sources were not swept (machine load). | no action | - | - |

Final checks: `npm run lint` (0 errors, existing warnings), `npm run typecheck` clean, `npm test`: 2805 passed; the four
failures of the full run (tokens.test.ts Monaco hook, ER 500-table layout timing, Redis browser list test,
settingsSnippets) are the known load-sensitive tests and pass when rerun alone.

Everything else measured clean: no text under 4.5:1 on any of the nine themes on the core screens, no clipped text
without ellipsis, no sideways document scroll at 1440 / 1280 or on the other 900 px screens, consistent dialogs
(Settings, Find, Execute, Import, connection, shortcuts), consistent empty states, and the Redis / Mongo / Kafka /
Elasticsearch / Logs / ER / designer views at 1440 and 900.

## Shared files touched

`theme/contrastMatrix.ts` (new pairs; `mix:` pseudo tokens), `theme/themes.ts` (Nord), `ObjectListView.tsx` (two
column minimums), `layout/layout.css`, `Search/search.css`, `ObjectList/objectList.css`, `ImportWizard/importWizard.css`,
`Mongo/mongo.css`, `Links/builder/BuilderView.tsx`. No engine, store, command or ResultsPane changes.

## Open / notes

- #9 and #10 above (marginal contrast in Darcula and Nord snippet pills).
- Tiny targets reported by the audit and left alone on purpose: inline text links (`.link-btn`, 17 px tall), the Find
  dialog tree chevron (18 px), Mongo twisties (16x20): all are secondary affordances with a larger row hit area.
- IntelliJ Light, Midnight, Violet and Paper audited clean on every captured screen.
- The tools used (capture harness, DOM audits) live in the scratchpad, not in the repo.
