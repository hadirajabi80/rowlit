# QA round: Kafka (engine `DbStudio.Sources.Kafka`, UI `components/Kafka`)

Method: real broker (`apache/kafka:3.8.0`, Schema Registry 7.7.1 from `compose.yml --profile kafka`, seeded with
`seed-kafka.sh`), the real engine from this worktree driven over REST/WebSocket (`kf.mjs` style scripts) and the real UI
through `ui/scripts/shot.mjs`. Covered: connection test, cluster/topics/groups lists, topic detail and configs, create /
alter configs / add partitions / purge / delete, message browser (latest, oldest, offset, timestamp, partition filter, search
and case), live tail with pause/resume, produce (string/json/avro/protobuf, validation errors, tombstone), consumer groups
(lag, reset dry run and apply, GROUP_ACTIVE with a live consumer, delete), Schema Registry subjects/versions.

| # | Area | Severity | Finding | Status | Where | Test |
|---|------|----------|---------|--------|-------|------|
| 1 | Engine / topics | wrong data (side effect) | Any metadata lookup of a topic that does not exist **created it** (broker `auto.create.topics.enable=true` plus librdkafka's producer/admin default `allow.auto.create.topics=true`). `GET /topics/typo`, browse, purge, produce and a tab left open on a deleted topic answered 404 but left a new topic (default partitions) behind; deleting a topic could be undone by a stale view refreshing. | fixed (`allow.auto.create.topics=false` in the shared client config; verified live: typo lookups no longer appear in the topic list) | `KafkaSettings.cs` `ToClientConfig` | `Plaintext_defaults` (config key), `KafkaIntegrationTests.Looking_up_a_topic_that_does_not_exist_never_creates_it` (real broker; not run in this session, see below) |
| 2 | UI / message detail | wrong data | "Pretty" JSON view and "Produce similar" went through `JSON.parse`/`JSON.stringify`: `9007199254740993` showed as `...992`, `12345678901234567890` as `...567000`, `1.10` as `1.1`, `1E+2` as `100`. Kafka JSON and Avro `long` ids above 2^53 are common. | fixed: pretty printer re-indents the server's raw text (`reindentJson`), numbers stay byte for byte | `format.ts` `reindentJson`/`prettyText`, `MessageBrowser.tsx` produceSimilar | `kafka.unit.test.ts` "pretty-prints JSON without touching number tokens", "reindents nested JSON..." |
| 3 | UI / produce | broken workflow | No way to produce a null value (tombstone), so keys of compacted topics could not be deleted; "Produce similar" of a tombstone produced the literal text `null`. | fixed: "Null value (tombstone)" checkbox (sends `value:null`, skips JSON/schema checks); Produce similar keeps tombstones | `Produce.tsx`, `open.ts`, `MessageBrowser.tsx` | `kafka.unit.test.ts` tombstone request, `kafka.views.test.tsx` tombstone produce |
| 4 | UI / message list | UX (wrong order) | Newest-first sort broke ties by ascending offset, so a batch produced in one millisecond (Repeat N, tail bursts) read oldest-to-newest inside each timestamp. Timestamps were also compared as strings. | fixed: numeric timestamp compare, offset descending for newest | `format.ts` `sortMessages` | `kafka.unit.test.ts` two sort tests |
| 5 | Engine / Avro produce | UX | A non-integral number for `long`/`int`/date/time fields surfaced as "One of the identified items was in an invalid format." (raw `FormatException`, no field); `1e400` for `double` was encoded as Infinity. | fixed: errors name the field (`$.id: expected a long ...`), non-finite doubles refused; protobuf enum number likewise | `AvroCodec.cs`, `ProtobufCodec.cs` | `CodecTests.Avro_encode_names_the_field_of_a_number_that_does_not_fit` (3 cases) |
| 6 | UI / message browser | UX | The status line used the *current* search box text ("N messages matching ..."), not the search the shown result was fetched with. | fixed | `MessageBrowser.tsx` | covered by existing "search in value" view test |
| 7 | UI / message browser | UX | Live tail dropped-counter was updated inside a state updater (impure, double counted under StrictMode). | fixed | `MessageBrowser.tsx` | covered by tail view test |
| 8 | UI / message browser | UX | "Latest 100" + Limit 200 returned 200 messages with no hint (the count is per partition). Count was also unclamped (> 5000 = engine 400). | fixed: "per partition" label and tooltip, clamp to 5000 | `MessageBrowser.tsx` | manual |
| 9 | UI / message detail | wrong data | "Produce similar" on a message whose value was truncated (> 32 KB) produced only the first 32 KB. Load full was only offered for a truncated value. | fixed: disabled with a hint until "Load full" (also offered for a truncated key) | `MessageBrowser.tsx` | manual |
| 10 | UI / topic Consumers | UX | Lag colouring on the Consumers sub-tab ignored the user's lag thresholds (hard-coded 1,000 / 10,000). | fixed | `TopicView.tsx` | manual |
| 11 | UI / produce | UX | Ctrl+Enter in the value editor could submit twice while a produce was running. | fixed (`busy` guard) | `Produce.tsx` | manual |
| 12 | Engine / browse | UX | The 8 s browse timeout includes consumer creation and connection. On a loaded machine (or a slow remote cluster) the first fetch can end with `0 messages, stopped at the timeout`; a retry works. | open (needs a design decision: start the clock at the first record, or a larger first-fetch grace) | `MessageBrowser.cs` `ConsumeAsync` | n/a |
| 13 | Engine / cluster | UX | `version` of `GET /cluster` stays `null` when the one-time broker-version lookup (5 s budget) was slow while the client opened; the Version tile then shows a dash until reconnect. | open | `KafkaProvider.cs` `BrokerVersionAsync` | n/a |
| 14 | Engine / avro | UX | Unknown fields in an Avro produce value are silently dropped; Infinity/NaN handling above. | open (by design, consider a warning) | `AvroCodec.cs` | n/a |
| 15 | Store | UX | `loadTopics(force)` while a load is in flight returns the stale in-flight result (a topic created/deleted during the load can be missing until the next refresh). | open (shared store pattern) | `store.ts` `load` | n/a |

Checked and fine: validation messages for create topic / configs / partitions, GROUP_ACTIVE (409) with the member list for
reset and delete, dry-run reset kinds (earliest, shiftBy, timestamp, offset clamped), Avro/Protobuf encode errors with
paths, Schema Registry 404s, tail pause/resume (no drops), offset/oldest/latest/timestamp/search/case fetches, tombstone and
empty-string values decode as `null` vs empty.

## Not verified in this session
- Docker Desktop became unresponsive late in the session (machine out of memory; broker unreachable), so the new
  `KafkaIntegrationTests.Looking_up_a_topic_that_does_not_exist_never_creates_it` was not executed against the broker. Finding 1
  itself was verified live before that (typo lookups left no topics). Run with
  `DBSTUDIO_KAFKA_BOOTSTRAP=localhost:19092 dotnet test engine/tests/DbStudio.Sources.Kafka.Tests --filter Looking_up`.
- Topics created by hand during the round (`qa-s2`, `qa-scratch`) and extra messages in `orders` (seed ran 3x: 360 messages)
  / `payments-avro` / `events-proto` / `qa-s2` remain in the sample cluster; groups `billing` and `shipping` were reset by
  the seed commands.
