# QA round: Redis

Scope: the Redis source (`engine/src/DbStudio.Sources.Redis`) and its views (`ui/src/components/Redis`): key browser, value
editors, Workbench, CLI, Pub/Sub, Slowlog, Info, Analysis, delete by pattern, read-only connections.

Method: code read of the engine services and every view, then a live pass against `redis/redis-stack:7.4.0-v1`
(`localhost:16379`, compose service `redis`) through the real engine (REST and WebSocket scripts) and the real UI
(`ui/scripts/shot.mjs`, dev server on the real engine). Scratch keys `qa:*` were created and removed again.

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Jobs (delete by pattern, Analysis) | broken workflow | A job that finishes before the 202 reaches the UI (small data, loaded machine) emits `job.done` before the view subscribes; the view then waits forever ("Starting…", spinner). This is the root cause of the flaky `browser.test.tsx` "delete by pattern requires the typed count and reports progress" (mock job takes 15 ms). `EngineSocket.onJob` now remembers the last 50 `job.done` events and replays one to a late subscriber (asynchronously, so the caller has stored its unsubscribe function). Shared fix: every `onJob` caller benefits. | fixed | `ui/src/api/ws.ts:37`, `onJob`, `dispatch` | `ws.m2.test.ts` "replays job.done…"; `qa.test.tsx` "reports the result of a job that finished before the 202" (fails without the fix, verified) |
| 2 | Hash / sorted-set editor | wrong data | Editing a value and then deleting the same row kept the edit: Save sent `HDEL f` then `HSET f v` (ZREM then ZADD), so the "deleted" row came back with the edited value. The pending count also counted the row twice. An edit of a deleted row is now ignored on save (and kept if the row is restored). | fixed | `ui/src/components/Redis/editors.tsx:316` (`usePairs`) | `qa.test.tsx` hash and zset "edited and then deleted", "restoring a deleted field…" |
| 3 | List editor + engine | wrong data | The trash icon sent `LREM key 1 <value>`, which removes the first equal value, not the clicked element: with duplicates the wrong position was removed. New engine operation `remove: { index, value, count }`: `LSET` a unique tombstone and `LREM` it in one MULTI/EXEC, guarded by `LINDEX == value`; a changed list answers 400 "changed since it was loaded: refresh". | fixed | `ValueService.cs:360` (`RemoveAtAsync`), `RedisWire.cs` (`RedisListRemove.Index`), `editors.tsx` (`ListEditor`), mock `mocks/m2/redis.ts` | `ValueServiceTests` "List_remove_by_index…" (2 tests); verified live (`x y x z x`, remove index 2 gives `x y z x`) |
| 4 | List editor | UX | Every edit (LSET, push, remove) reloaded the key and threw the view back to items 0-199 even when editing item 450. The editor now stays on its page (clamped to the new length). | fixed | `editors.tsx:482` (`ListEditor`) | `qa.test.tsx` "stays on the page being edited" |
| 5 | Binary key names | wrong data | A key whose name is not valid UTF-8 is listed as `k:\xff\xfe`, but TYPE/TTL/GET/DEL/RENAME/EXPIRE/MEMORY were issued for the literal text, so the key was silently missing from the browser (TYPE "none" is filtered), the count said otherwise, and it could not be opened, edited, renamed or deleted. The engine now maps `\xHH` escapes back to bytes (a key that literally contains that text still wins when it exists), also for Analysis and memory badges. Rename keeps the typed new name literal. | fixed | `Resp.cs:44` (`HasEscapes`, `KeyBytes`, `ResolveKeyAsync`), `KeyBrowser.cs:80-110`, `ValueService.cs` (all `rk`) | `ValueServiceTests` "Keys_with_escapes_resolve…"; `LiveRedisTests` "Binary_key_names_are_listed_and_addressable" (real server, `DBSTUDIO_IT=1`); verified in the UI |
| 6 | Connect / Test | wrong result | With an ACL user and a wrong password, StackExchange.Redis carries on as the default user when that user needs no password, so Test said OK and showed the user you typed. The engine now asks `ACL WHOAMI` (Redis 6+) and fails with "Authentication failed: WRONGPASS… (the server treats this connection as 'default')". | fixed | `RedisProvider.cs:120` | `ConnectionTests` "Rejected_acl_credentials_fail_the_test…"; verified live |
| 7 | Info view | performance | The 2 s poll ran `CLIENT LIST` (O(clients), blocks the server while it renders; 100 ms on this machine) only to count clients. A single node now answers from `INFO` `connected_clients`; only a cluster sums over its primaries. | fixed | `InfoService.cs:36-50` | existing `Info_is_parsed_into_sections` |
| 8 | Pub/Sub, active channels | UX | The list showed the driver's own `__Booksleeve_MasterChanged` subscription as a channel (one click added it to the subscriptions). Filtered. | fixed | `InfoService.cs:164` | `JobAndInfoTests` "Pubsub_channels_hide_the_drivers_own_subscription" |
| 9 | Workbench | broken workflow | The toolbar Run button and the palette "Run line" replayed the *last Ctrl+Enter selection* forever (and before the first Ctrl+Enter ran the whole editor although the button says "line or selection"). They now ask the editor for the current selection or line (Monaco and the jsdom textarea). A comment/blank line shows "Nothing to run" instead of doing nothing. | fixed | `WorkbenchView.tsx:146`, `CodeEditor.tsx` (`CodeEditorApi`), `monacoEditor.tsx` | `qa.test.tsx` "runs the line under the caret now…", "tells the user when the line is a comment"; verified with real Monaco |
| 10 | Copy as JSON | wrong data | The detail pane copied only the loaded page (200 hash fields, 200 list items…) and the explorer/palette copy only 1,000 entries, both claiming "Value copied as JSON". The detail button now uses the same fetch and the toast says "Copied the first N of M entries" when the value is bigger. | fixed | `actions.ts:126` (`partialOf`, `copyValueJson`), `BrowserView.tsx` | `qa.test.tsx` "says so when a big value was only partly copied" |
| 11 | Pub/Sub message list | UX | The expanded message was tracked by row index; messages arrive at the top, so the open row jumped to another message, and scrolling back through history jumped on every batch. Tracked by identity; the scroll position is anchored to the same messages. | fixed | `PubSubView.tsx:26` | `qa.test.tsx` "keeps the expanded message open when newer messages arrive" |
| 12 | Sorted-set editor | wrong data | Editing a score to blank saved score 0 (`Number('')`). A blank score now fails the "every score must be a number" check. | fixed | `editors.tsx:422` | `qa.test.tsx` "a blank score is refused" |
| 13 | Delete by pattern | UX | Cancelling the job kept the already deleted keys in the explorer and in open browsers until a manual rescan. Cancel now announces the change like a finished job. | fixed | `dialogs.tsx:249`, `actions.ts` (`onCancelled`) | `qa.test.tsx` "refreshes the lists when the job is cancelled" |
| 14 | Slowlog | UX | Threshold `-1` (disabled) read "-1 µs" and "Log commands slower than -1 µs". | fixed | `SlowlogView.tsx:81` | `qa.test.tsx` "-1 reads as logging disabled" |
| 15 | Key browser (type filter) | UX | With the server-side `SCAN TYPE` filter, a key that expired between SCAN and TTL was listed with TTL -2. Filtered like the unfiltered path. | fixed | `KeyBrowser.cs:72` | none (needs a key expiring between two calls) |
| 16 | Values with invalid UTF-8 (hash fields/values, list items, set/zset members) | wrong data | Shown with `\xHH` escapes; editing and saving writes the escape text, not the bytes. Needs a byte-exact wire format (base64 next to the text) through every editor. | not fixed | `Resp.Text`, `RedisArgs.ToDisplay` | |
| 17 | String editor | UX | Saving a string after the key was deleted or changed type re-creates it / overwrites the other type (`SET … KEEPTTL` without `XX`). | not fixed | `ValueService.SetStringAsync` | |
| 18 | RedisJSON | UX | A document whose root is JSON `null` cannot be saved ("value is required"): `JsonElement?` turns `null` into "missing". | not fixed | `ValueService.SetJsonAsync` | |
| 19 | Explorer | UX | While the root scan is truncated at 1,000 keys the folder counts are partial (`user 340` of 2,002) and look authoritative; only the hint line below the tree says so. | not fixed | `tree.tsx:146` | |
| 20 | Test connection | UX | An unreachable host takes about twice the connect timeout (connect wait, then the PING wait). | not fixed | `RedisProvider.cs:82-90` | |
| 21 | Empty key name | UX | Redis allows the key `""`; it cannot be addressed by the key routes (creating it is refused with "key is required"). | not fixed (by design) | `RedisEndpoints.cs` | |

## Checked and fine

Key routing for `/ ? # % + \ [ ] *`, unicode, spaces and keys named `scan` / `memory`; paging of hash (HSCAN), zset (ZRANGE by
rank and ZSCAN), list (negative ranges, bad indices), stream (`(id` exclusive paging, bad ids, groups, BUSYGROUP/NOGROUP
messages); TTL set/persist/validation; rename self/missing/overwrite; RedisJSON round trip; read-only refusals on every write
route (edit, create, delete, delete-pattern, publish, CONFIG SET, CLIENT KILL, SLOWLOG RESET, workbench writes incl. EVAL);
delete-by-pattern job with 2,500 keys (progress events, exact count, 0 left); Pub/Sub with channels and patterns (unicode
payloads), MONITOR, MULTI/EXEC on a dedicated connection, BLPOP timeout, SELECT tracking inside a batch (out-of-range
SELECT); Info, Analysis (7 s for 6,000 keys), Slowlog screenshots; Connect/Test error paths (port closed, bad db, TLS against
plain, unknown host, missing host, bad port, cluster/sentinel against a standalone server).

## Shared files touched

- `ui/src/api/ws.ts` (finding 1): `onJob` replays a `job.done` that arrived before the subscription. Harmless for callers that
  already guard (Mongo `waitForJob` etc.); fixes the same race wherever `onJob` is used.

## Tests

- UI: `ui/src/components/Redis/__tests__/qa.test.tsx` (new, 13 tests), `ui/src/api/ws.m2.test.ts` (+1).
- Engine: `ValueServiceTests` (+3), `ConnectionTests` (+1), `JobAndInfoTests` (+1), `LiveRedisTests` (+1, real server);
  the fake server gained `LINDEX` and `ACL WHOAMI`.
- Results on a heavily loaded machine: `npm run lint` (warnings only) and `npm run typecheck` clean; Redis, api and commands vitest
  folders pass except `browser.test.tsx` "list: pages, pushes and sets an element" (renders two pages of 200 editable rows,
  exceeds its 30 s timeout under load; it fails identically on the commit before this round, so it is a load flake, not a
  regression) and "analysis can be cancelled" (passes alone). The full `npm test` could not complete: the vitest process ran out
  of memory with other agents running. Engine: Redis project 139 pass / 2 skipped (`DBSTUDIO_IT=0`, Release), 141 pass with
  `DBSTUDIO_IT=1`; the full `engine/DbStudio.slnx` run was not done (only the Redis engine project changed).
- Run the live Redis tests with `DBSTUDIO_IT=1 dotnet test engine/tests/DbStudio.Sources.Redis.Tests` (141 pass).
