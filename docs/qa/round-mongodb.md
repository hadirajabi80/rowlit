# QA round: MongoDB

Area: `engine/src/DbStudio.Sources.Mongo` and `ui/src/components/Mongo`, `ui/src/mongo` (documents list / JSON / table, Extended
JSON round trips, query bar, aggregation builder, schema, indexes, validation, explain, import / export, change streams).

Method: real engine (Debug build of the worktree) against the sample MongoDB (`localhost:27018`), UI dev server in the
built-in browser, plus a differential probe of the UI shell-JSON parser against the engine's `ShellJson` over ~170 value
forms (parse, store, read back, re-print through the UI, store again). Midway the Docker engine stopped answering
(machine out of memory), so the import / export and explorer flows could not be re-verified against the real server after
the fixes; those are covered by unit tests only (see "Not verified live").

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Extended JSON round trip | wrong data | Fields with integer-like names (`"2024"`, `"10"`, `"1"`) were reordered by `JSON.parse` (JS objects list integer keys first). Opening a document and pressing Replace (or saving the JSON view) rewrote it with those fields in front of `_id`. Field order is significant in MongoDB (sub-document equality). Reproduced live: `{_id, name, "2024", "10", "2"}` came back `{_id, "2", "10", "2024", name}`. Same for the Copy-document EJSON text, and a `__proto__` field was lost there. | fixed | `ui/src/mongo/bson.ts` (`parseJsonOrdered`, `OrderedObject`, `toEjsonText`, `toEjsonJson`) | `bson.test.ts` "field order" |
| 2 | Shell parser / EJSON | wrong data | `{ $timestamp: { t: 1, i: 2 } }` typed by hand parsed to `Timestamp(NaN, NaN)` in the UI (the inner ints were re-wrapped as `$numberInt`); `{ $date: 0 }` (small number) became a plain sub-document. | fixed | `bson.ts` `plainNumber`, `fromEjson` | `bson.test.ts` "wrappers typed by hand" |
| 3 | Regex round trip | wrong data (equivalent pattern, different text) | A stored pattern `a/b` was printed as `/a\/b/` and stored back as `a\/b`; the UI tokenizer also dropped the backslash of `\/` while the engine (like mongosh) keeps it. Editing an unrelated field rewrote every regex containing `/`. | fixed: patterns that cannot be written exactly as a literal are printed as `RegExp("a/b", "i")`; literals keep their text | `bson.ts` `scalarShell`, `shellJson.ts` tokenizer | `bson.test.ts` "regex text", `shellJson.test.ts` |
| 4 | Export to code (Node.js) | broken workflow | Regex with an already escaped slash became `\\/` (ends the literal early, invalid code); empty pattern wrote `//` (a comment); Mongo's `x` flag is not a JS flag. | fixed (`regexLiteralBody`, `new RegExp('', …)`, `BSONRegExp` import) | `exportCode.ts` | `exportCode.test.ts` |
| 5 | Query bar | UX | Skip / Limit / Max time fields clamped an empty field to the minimum: clearing "20" and typing "5" gave "15". Max time accepted values the engine rejects. | fixed (`NumInput`) | `QueryBar.tsx` | `documents.test.tsx` |
| 6 | Query bar layout | broken workflow | At the minimum window width (800 px) the filter row did not wrap and the Find button was pushed out of the pane; the options grid overflowed. | fixed (wrap + narrower grids) | `mongo.css` | live check (no unit test: layout) |
| 7 | Documents paging | UX | Applying a new filter while on page 3 kept `skip`, showing an empty page and "0–40 of 3"; an explicit skip past the end gave no hint. | fixed: new filter / sort / collation starts on page 1; empty past-the-end page says so and offers "Back to the first page"; range text no longer shows `0–N` | `DocumentsView.tsx` | `documents.test.tsx` |
| 8 | Insert array | broken workflow | Inserting `[a, b, c]` where `c` fails inserted `a`, `b`, showed only the error and did not refresh; a retry duplicated them. | fixed: refreshes, reports "2 of 4 inserted; document 3 failed", keeps the dialog on the missing documents | `DocumentEditor.tsx` | `documents.test.tsx` |
| 9 | Rename collection | broken workflow | An open workspace of the renamed collection kept the old name and queried a missing namespace. | fixed: the tab follows the new name (title, key, state) | `commands.ts` `retargetTab` | `explorer.test.tsx` |
| 10 | New view dialog | broken workflow | `splitPipeline` cut the pipeline text at commas / braces and tracked quotes by hand: a regex such as `/[}],'/` or a comment containing braces broke view creation. | fixed: uses the shell-JSON parser | `CollectionDialogs.tsx` | `explorer.test.tsx` |
| 11 | CSV import | wrong data | Type detection turned `00123` (zip codes), `+15551234` (phone numbers) and integers beyond Int64 into numbers (leading zeros lost, precision lost). | fixed: detection is stricter; choosing "number" by hand still converts | `ImportExportService.cs` `IsPlainInteger` / `IsPlainNumber` | `ImportExportTests.cs` `Inference_keeps_identifiers_as_text` |
| 12 | Indexes | UX | The `_id_` index was listed without the "unique" pill (its spec has no `unique`). | fixed | `IndexesService.cs` | `SchemaIndexValidationTests.cs` |
| 13 | Export dialog | UX | Unticking every CSV column exported every column (the engine treats an empty list as "all"). | fixed: Export is disabled until a column is picked | `ExportDialog.tsx` | none (trivial) |

## Test results

- Engine: `DBSTUDIO_IT=0 dotnet test engine/tests/DbStudio.Sources.Mongo.Tests -c Release`: 201 passed, 4 skipped (live backend tests).
- UI: `npm run typecheck` clean; `npm run lint` shows warnings only (no new errors). Mongo area vitest (`src/mongo`,
  `src/components/Mongo`, `src/mocks/m2/mongo.test.ts`): all pass when run on their own (120 + workspace 21).
- The full `npm test` run on the loaded host failed with 15 s timeouts in many unrelated files (ER diagram, Redis, Links,
  Search, Explorer, ...) and in two Mongo files that pass alone; not a regression of this round.

## Open / not fixed

- UI shell parser accepts a few things the engine rejects (duplicate field names `{ a: 1, a: 2 }`, `ISODate("2024-05")`,
  regex flag `g`). The engine error is shown with its position, so nothing is lost; the Find button is just not disabled early.
- Engine parses `-0.0` as `0.0` (sign of negative zero lost on insert).
- Wildcard indexes (`$**`) cannot be created from the dialog (`Field paths cannot start with '$'`); they are listed correctly.
- Schema example chips show strings cut at 100 characters; "use as filter" on such a chip does not match.
- Node.js code export of an object with integer-like keys cannot keep the order (JavaScript object semantics).
- JSON import reads the whole file into memory; CSV export does not neutralise leading `=`/`+`/`-`/`@` cells.
- Import / export failing midway leaves a partial file at the chosen path.

## Not verified live

Docker stopped answering after the fixes (out of memory on the host). Import / export / preview endpoints, schema job,
validation and explain were probed live before that (find / aggregate / explain / fields / indexes / validation / error mapping
behaved correctly); the fixes in #10 to #13 are covered by unit tests only. Re-run steps 4 (EJSON), 5 (aggregations) and 6
of `docs/qa/mongo-walkthrough.md` plus Import of a CSV with `00123` against the real server when Docker is healthy.

## Shared files touched

None outside the Mongo area (`ui/src/mongo/*` and `ui/src/components/Mongo/*`, `engine/src/DbStudio.Sources.Mongo/*`).
