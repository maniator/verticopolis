---
story: save-without-tree
status: done
issue: 1242
---

# Story: write a save without a whole-save Value tree (#1242)

**Snapshot.** Every figure here is a one-off reading and does not refresh.
The cloud tables are from 2026-10-28, on the tree replayed onto `main` at
`36947153` (engine sources `f14bdb633dab8b14`). That tree already wrote the
blockbuster cinemas and the milestones from the borrow (round 4's first
fixes), and still built the tower's name and the events whole: rounds 4 and
5 of the review wrote those from the borrow after the run. The perf towers
carry short names ("Tower One", "SixSeven") and no pending choice at the
save (a probe found none, and the game sets one only on a new day, which no
timed save crosses), so those changes likely move no figure (inference). The
branch now sits on `b11b22f4`. From `36947153` to there, `main` changed the
Rust engine only to add the recycling card's capacity getter and raise the
crate to 0.21.0, and changed no save or load path,
`scripts/perf-load-memory.ts` or perf scenario. The native counts are from
2026-10-28 on the final tree. So are the figures for the events held whole
and for each value built whole; those for the cinemas, the milestones and
the name held whole are from the same day on round 4's final tree (2.49 MiB
of text), and the other held-whole figures from 2026-10-27 on `511dadf6`.
The day-before comparison names its runs. The cloud figures are estimates
from `npm run perf:load-memory` (`scripts/perf-load-memory.ts`; no test pins
its arithmetic), except the second table in Result (`serialize`,
`encodeVctower` and the memory around them), which comes from a probe whose
source is on #1338 until #1338 adds that step to the script. The native
figures in Tests are allocation counts on the synthetic tower of
`engine-rs/src/load_memory_tests.rs`, which asserts bounds on them and
prints them under `cargo test --features wasm --lib memory:: --
--nocapture`; the figures for a value held or built whole come from runs of
that test with the code changed to hold or build it, which the committed
tree does not reproduce. The owner's desktop run of `perf:load-memory` is
owed and supersedes the cloud figures (the owner's comment on #1242,
2026-10-23: desktop acceptance, no gate PASS from cloud figures, and no
automatic merge). Its run guide, `pc-run-1242-save-memory.md`, is in the
project's shared files, outside the repository.

## Why

#1225 (PR #1332, merged as `511dadf6`) loads a save without holding it as
one `serde_json::Value` tree, so the load no longer sets the engine's WASM
high-water mark. The next step that does is the save: `Engine.serialize`
called `Simulation::serialize`, which builds the whole save as a tree, and
wrote that as text. On the large perf tower the first save after a load took
the memory from 24.56 to 58.13 MiB on `main` at `36947153`, and a WASM
memory never shrinks. The undo trail and the stored saves ride these saves,
and slice 9's M6 reading would read this mark if the host saves within its
30 steps, so the slice plan (#1339) made this a prerequisite of slice 9's
run beside slice 13. Since #1445 the game also autosaves right after every
tower swap (a slot load, an import or a new tower), so on a Rust session
that first save now follows every load. Since PR #1423, and until #1422's
fallback lets an ordinary visit boot it again, only a `?engine=wasm` visit,
a wasm-only build or a tooling build boots the Rust engine, so those are the
sessions this change reaches today.

On that `main` the saves that grow the memory are also slower than before
#1225, by 32.7 to 34.1 ms in the Result's run, and the saves that leave the
memory where it was by 11.1 to 16.7 ms. The other 16 to 23 ms is likely
the growth itself, since the load before #1225 had already grown that memory
(inference: the run shows the times and the memory, and no allocator trace).

## Acceptance criteria

1. **AC1 No tree.** `Engine.serialize` writes the save text as it goes: each
   unit, transport, log line and ledger day becomes its own `Value` that is
   written and dropped before the next, and the tower's name, the pending
   choice's message, the view and each excavated tile, extermination room
   id, blockbuster cinema and milestone are written from their own values.
   The ledger's and the events' objects are written key by key around their
   parts. The other top-level values are scalars, built as `Value`s as
   before and held until the save is written, and the events' numbers are
   built as they are written.
2. **AC2 Byte for byte.** The text is today's text. Tests compare
   `save_text()` and the tree `serialize()` still returns with a verbatim
   copy of today's `serialize`, on new, played and reloaded games in both
   modes, games edited to carry values a writer can spell differently, every
   optional field, a pending choice, a ledger past its window, excavated
   tiles, room ids, blockbuster cinemas and milestones, every loader case
   that loads and every fixture tower; reordering two fields or dropping a
   log line fails all four. Since the bytes do not change, the undo
   snapshots and the stored saves read what they read today, and so does the
   reload after a Rust engine crash (#1433, part of #1422). That reload
   loads the last good save on Rust, and after a second crash on TypeScript;
   on a wasm-only build the second crash stops the game, and where storage
   cannot keep the crash count the first one does. The restore points (R6)
   left the game with the mirror host in PR #1423; `RestorePoints` stays as
   test infrastructure.
3. **AC3 Memory.** On large, the first save after a load stays within a few
   MiB of the load's 24.56 MiB, and a build then a save grows only by the
   build's own growth (#1259). Natively, on a tower whose transport pools,
   log and ledger are at their caps and whose other lists and strings are
   large, the save peaks at its text's buffer plus the half that buffer last
   grew from plus 16 KiB (under three times the text), where the tree peaked
   at over four times the text; written into a buffer reserved to its
   length, the save builds no more than 16 KiB beside it at any point.
4. **AC4 Time.** `Engine.serialize`'s time on large is at or under `main`'s,
   before #1225 and today, for the first save after a load, a later save and
   the save after a build (`perf:load-memory`, medians of 10).
5. **AC5 Unchanged.** `SAVE_VERSION`, `loader-cases.json`, the conformance
   lock, `engine.d.ts` (its `serialize` doc line included), the frame
   layout and the crate version are unchanged, and so is the app version:
   players save the same bytes. The one addition to the Rust API,
   `Simulation::save_text`, is tier 3 (internal though `pub`, per the
   Stability section of `engine-rs/API.md`), which moves no version.
   `Simulation::serialize` still returns the tree for the readers that
   edit, hash or walk it: the state view and its digest (the dual run's
   shadow and the tooling digest), the native host's save
   (`load::encode_simulation_vctower`, tier 1, which the web game does not
   call), the scenario runner, the TDT referee and the `.TDT` export
   (#1431). The port's `exportVctower` and the sync paths
   `serializeForSync` and `saveDelta` (`save_delta.rs`) read it too; no
   game code calls the first, and nothing calls the other two since PR
   #1423 deleted the worker host (only a test fixture fakes them).

AC3 and AC4 are read here on the cloud run; the owner's desktop run of
`perf:load-memory` is their acceptance.

## Design

- `engine-rs/src/sim_save.rs` (new) holds the save's field list
  (`save_fields`), moved out of `Simulation::serialize` with the keys in
  the same order. Each field is an owned scalar `Value`, the borrowed `view`
  or tower name, the borrowed events or ledger, or a borrowed list: units,
  transports, excavated tiles, extermination room ids, blockbuster cinemas,
  milestones and the log's last `LOG_SAVE_CAP` lines.
- `serialize()` collects the list into a `Map`, building each `Value` as
  before. `save_text()` writes the list through `serde_json::to_string`: the
  top level as a map; each unit, transport, log line and ledger day as its
  own `Value` built in turn; the view as the `Value` the game keeps; the
  tower's name, the excavated tiles and the milestones as strings, the room
  ids as integers and the blockbuster cinemas as floats; and the ledger and
  the events as the same objects `Ledger::serialize` and
  `EventSystem::save_state` build, written by `sim_save.rs` itself, with the
  pending choice's message as a string. The one list fixes the keys and
  their order, since the crate builds `serde_json` with `preserve_order`.
  Each value's bytes rest on `serde_json` writing a borrowed value as it
  writes that value's `Value`, which the tests pin: `Value::Object`,
  `Value::Array` and `Value::String` go through the same serializer calls
  with the same lengths; a room id goes through `serialize_i64`, and its
  `Value::Number` through `serialize_u64` (`serialize_i64` when negative),
  which write the same digits; a cinema goes through `serialize_f64`, as its
  `Value::Number` does, and one that is not finite writes `null`, as the
  `Value::Null` the tree holds for it does. The ledger's and the events'
  objects are the two shapes written twice, once to build the tree and once
  in `sim_save.rs`, and the tests hold each pair to the same text.
- Each element still goes through `Unit::serialize`, `Transport::serialize`,
  the ledger's `totals_json` or the log line's `json!`, so its shape has
  one definition. Building a `Value` per element is a narrower reading of
  the issue's "write the save text straight from the game": a `Serialize`
  for `Unit` and `Transport` would also drop the element's map (about
  43,000 of them per large save, each written and dropped at once) and the
  copy it holds of a unit's label, a `completeAt` that is not a number and
  a transport's skipped floors, which the loader keeps at any length, at
  the cost of a second definition of each element's shape. The Hot-Path
  Auditor rated it optional (N2), and the copy is #1243 item 6.
- The values still built whole are scalars. Rounds 2 and 3 of the review
  found the ledger, the excavated list and the room ids held whole through
  the write; held whole on the synthetic tower (3,960 room ids, where a
  loaded save can carry up to 82,500, `UNIT_CAP`) they put the save 88, 289
  and 283 KiB above the buffer and its half, so they stream too. Round 4
  found the same of the blockbuster cinemas, the milestones and the tower's
  name, and round 5 of the events, whose pending choice keeps its message:
  the loader keeps every distinct cinema and milestone a save carries,
  known or not, and a name or message of any length. Held whole they put
  the save 145, 234, 82 and 83 KiB above, so they stream as well.
- `Engine.serialize` (`wasm.rs`) calls `save_text()`. Its doc line stays
  as the binding's, so `engine.d.ts` does not change.
- The text's buffer doubles as it grows (`to_string` starts at 128 bytes),
  so the save holds up to about three times its text for a moment. A buffer
  reserved from an estimate of the list lengths, written with `to_writer`,
  would lower the high-water mark on large by at most the 4.06 MiB the save
  adds less the 2.06 MiB its text needs, about 2 MiB (an estimate). That
  matters only once #1259 and #1338 bring the session's peak down to the
  save's; it is item 5 of #1243.
- `main` gained other saves that build the tree after `511dadf6`: the
  `.TDT` export (`Engine::port_tdt_export`, which `exportLegacy` in
  `src/game/saveLoad.ts` reaches), now #1431; the port's `exportVctower`
  (`wasm_port_files.rs`, PR #1390), which no game code calls and which
  hands its stamped tree to #1338's `encode_vctower`; and the sync paths
  `serializeForSync` and `saveDelta` (`save_delta.rs`, #1045): a test
  fixture fakes them, and nothing calls them since PR #1423 deleted the
  worker host.
- The state view still builds the tree in two places, neither in a player
  build. The dual run's shadow builds it once per game hour: a developer
  switch that starts only where the tooling handle does, in its own worker,
  and only when TypeScript is the game's engine (`dualRunRequested` in
  `src/bootstrap.ts`, `src/dualrun/shadow.ts`). The tooling digest
  (`stampOf` in `src/game/toolingSim.ts`, through `stateDigest`) builds it
  on DEV and tooling builds of the Rust engine.

## Tests

- `sim_save_tests.rs`: the four differential tests in AC2, each against
  `reference`, today's `serialize` kept verbatim. The reloaded game loads
  both through `deserialize` and through the streamed reader hosts use,
  which the test asserts took the text. The edited game carries every
  optional field (31 distinct keys, asserted), a due day without room ids,
  room ids without a due day and an empty list of them, events with a
  Santa year (`1e21`) and a random state (4,000,000,000, above the
  largest signed 32-bit number) no new game carries and a pending choice
  whose message carries escapes, a ledger two days past its window with
  numbers a writer can spell differently, excavated tiles with escapes,
  room ids from a negative one up to the largest the loader keeps,
  blockbuster cinemas whose floats are whole, fractional, subnormal, huge,
  negative zero, not a number and infinite either way, 20 milestones none
  of the game's own, and a log past the save's cap. Mutation-checked:
  two fields swapped, the ledger's two keys swapped, the events' first two
  keys swapped, the events' Santa year written as an integer, and one log
  line skipped in the streamed list each fail all four tests. One excavated
  tile skipped fails the edited and fixture tests, and one room id skipped
  the edited and loader-case tests. One blockbuster cinema or one milestone
  skipped, or the events' random state written as a signed 32-bit number,
  fails the edited, loader-case and fixture tests. The pending choice
  dropped, or its first two keys swapped, fails the edited and loader-case
  tests. The ledger trimmed to its window, the save's log cap moved by one,
  and the room ids lifted out of the due day's branch each fail the edited
  test.
- `load_memory_tests.rs`: the file's synthetic tower is a modern game of
  41,460 units. Three lists are at their caps: the 88 transports of both
  pools, a 300-line log and a ledger of every category over 90 days plus
  today. The other lists and strings are large: ten excavated floors (the
  loader keeps any distinct tile), an exterminator booked for its 3,960
  offices (room ids are capped at `UNIT_CAP`, 82,500, far above that),
  2,000 blockbuster cinemas, 2,000 milestones, and an 80,000-byte tower
  name and pending choice's message.
  The test asserts each loads whole, with each count derived from the
  constants the tower is built from. `a_large_save_peaks_near_its_text`
  writes it through `save_text`, and `the_binding_saves_without_the_tree`
  through `Engine.serialize` (the wasm feature's tests, which CI runs),
  which must also write the same text. The text's buffer stays under twice
  the text, the text sits more than 16 KiB above the buffer's last doubling,
  and the save peaks at most at that buffer plus half of it plus 16 KiB. The
  same write into a buffer reserved to the text's length (`write_save`, a
  test-only twin of `save_text` over the same fields) builds at most 16 KiB
  beside it, which catches a value built whole as it is written, even after
  the buffer's last doubling. The counts: 2.57 MiB of text in a 4.00 MiB
  buffer and a peak of 6.00 MiB, 4 KiB above the buffer and its half, about
  2.3 times the text; about 5 KiB built beside a reserved buffer; and a tree
  that peaks at 46.49 MiB, about 18 times. Held whole from the start, the
  ledger, the room ids, the excavated list, the log and the transports each
  put the save 88 to 289 KiB above the buffer and its half, and fail, and so
  do the cinemas, the milestones, the name and the events (145, 234, 82 and
  83 KiB). Built whole as they are written, the strings, the room ids, the
  cinemas, the name, the message, the log and the transports each build 80
  to 286 KiB beside the reserved buffer, and fail. So do a save that returns
  a copy of its text and a binding that writes through the tree or writes
  other text.

## Result

Cloud run, 2026-10-28, Node v22.22.0, `npm run perf:load-memory -- --reps
10`, medians, large perf tower (43,358 units, a 2.06 MiB save), in one
session, in this order: `main`, #1242, the probe below, then the build
before #1225. "Before #1225" is `main` at `8594e3b`; "`main`" is `main` at
`36947153`, which has #1225; #1242 is this change on `36947153` as of round
4's first fixes (the Snapshot's tree). WASM memory in MiB, times in ms.

| Large tower | Before #1225 | `main` | #1242 |
| --- | --- | --- | --- |
| Memory after load | 128.31 | 24.56 | 24.56 |
| after the first save | 128.31 | 58.13 | 28.63 |
| after a second engine's load, hour and save | 128.31 | 58.13 | 28.63 |
| after a build on it, then a save | 128.31 | 58.13, then 72.13 | 56.44, then 56.44 |
| after a third engine's load, hour, save, build and save | 128.31 | 72.13 | 56.44 |
| own process: one build after the load, then a save | 128.31 | 52.38, then 69.44 | 52.38, then 52.38 |
| First save after a load | 52.3 | 85.0 | 40.7 |
| Second save | 52.3 | 64.5 | 38.0 |
| Second engine's first save | 46.3 | 63.0 | 38.6 |
| Save after a build on the second engine | 48.6 | 81.5 | 36.2 |
| Third engine's save after its build | 50.4 | 61.5 | 36.8 |
| Own process: the save after one build | 48.7 | 82.8 | 37.9 |
| Load | 337.3 | 172.7 | 155.6 |
| Own process: the first build after the load | 0.5 | 9.9 | 9.9 |
| Second engine's build | 0.4 | 3.3 | 8.6 |
| Third engine's build | 2.3 | 2.8 | 3.0 |

Every save on the medium tower (a version 4 save, which loads through the
tree, since only version 7 saves stream, and holds 51.13 MiB on all three)
is at or under the other two columns'; the first after a load takes 13.9 ms
against 19.1 before #1225 and 22.1 on `main`. On the small tower the first
save after a load takes 4.2 ms against 4.9 and 6.7, and leaves 2.56 MiB
against 8.38 and 4.06. Every small save is at or under the other two but
one: the save after one build in its own process takes 3.6 ms against 3.2
before #1225 and 4.5 on `main`, with overlapping ranges (3.5 to 4.9 against
2.9 to 5.5 before #1225). On 2026-10-27 the same row read 3.3 ms on #1242's
final tree before the replay, in that tree's confirmation run, and in the
run beside it 3.3 before #1225 and 3.0 on #1242's round 1 tree. That save
grows no memory on #1242 or before #1225.

The runs of 2026-10-27, on `511dadf6`, read the same WASM memory, but for
`main`'s 58.19 and 72.00 MiB in place of 58.13 and 72.13. Their saves on
large were faster. Today's #1242 saves read 7.1 to 10.0 ms slower, and its
load 16.8 ms slower, than that day's confirmation run of #1242's final tree
before the replay. Between the two runs the writer changed too (round 4
began writing the cinemas and the milestones from the borrow, which builds
less, so it likely does not explain a slower save; inference), and so did
`main`'s engine around it. Against that day's other run, which carried
`main`, the build before #1225 and #1242's round 1 tree, today's `main`
saves read 3.9 to 18.5 ms slower and its load 35.6 ms slower, and the build
before #1225 read about the same on its first save (52.3 today against 51.0)
and loaded 15.3 ms faster today. In the probes, the build before #1225 read
slower today (`serialize` 63.8 against 51.15 and 51.95 ms). #1242's load
reads 17.1 ms under `main`'s today on the same load code, likely this run's
noise. So machine variance between the two days likely explains the gap at
least as well as anything `main` added between `511dadf6` and `36947153`
(inference from two runs on two days, with no trace); within each run the
columns compare.

- **AC1, AC2 and AC5** hold by the tests above; `engine.d.ts`,
  `SAVE_VERSION`, `loader-cases.json`, the conformance lock and the crate
  version are unchanged. The bytes are pinned natively, with the wasm
  feature's binding test among them, and `npm run test:wasm` checks the
  wasm32 build by round trip.
- **AC3 met on the cloud run.** The first save adds 4.06 MiB (65 WASM pages
  of 64 KiB; the table's rounded figures give 4.07) to the load's 24.56,
  and a build then a save ends where the build did (52.38 MiB). Natively
  the save peaks at 2.3 times its text, and builds about 5 KiB beside a
  reserved buffer. The desktop run is owed.
- **AC4 met on the cloud run.** Every `Engine.serialize` on large is at or
  under both other columns: the first after a load 11.6 ms under the figure
  before #1225 and 44.3 under `main`'s. The desktop run is owed.
- **Slice 9's save budget** is no save task over 50 ms on the large PC tower
  at 1x and 4x. `Engine.serialize` alone takes 36.2 to 40.7 ms here, but a
  save task also stamps and stores the text, and Quick Save also runs
  `encodeVctower` (#1338), so slice 9's PC run decides.
- **A reloaded engine's first build now grows the memory, and is slower.**
  A build on the second engine takes 28.63 to 56.44 MiB and 8.6 ms, against
  3.3 ms on `main`, where the memory stayed at 58.13 MiB; likely the save's
  tree had left that much free on `main`, and nothing does now (inference:
  the run shows only the growth). It is once per module, and the third
  engine's build is back at 3.0 ms. On that second engine the trade is 5.3
  ms more on the build against 24.4 ms less on its first save and 45.3 ms
  less on the save after the build. #1259's row records the cost from the
  run of 2026-10-27 (10.2 ms there).
- **The `.vctower` writer grows the memory now** (#1338). A probe of the
  game's Quick Save path (10 fresh processes, interleaved, medians, the
  same session), `serialize` then `encodeVctower` after a load and an hour:

  | Large tower | Before #1225 | `main` | #1242 |
  | --- | --- | --- | --- |
  | `serialize` | 63.8 | 95.4 | 41.2 |
  | first `encodeVctower` | 150.6 | 156.3 | 182.1 |
  | the two, per run | 215.1 | 252.8 | 223.2 |
  | memory after them | 128.31 | 62.38 | 63.44 |
  | a later `encodeVctower` | 130.9 (128.9 to 156.8) | 138.3 (135.0 to 143.2) | 139.0 (135.1 to 208.9) |
  | memory after it | 128.31 | 64.44 | 63.44 |

  "The two, per run" is the median of each run's total. The first
  `encodeVctower` now grows the memory itself, from 28.63 MiB, and takes
  25.8 ms more than on `main`. Taken together (the median of each run's
  total), the two engine calls of the first Quick Save in a module take 8.1
  ms more than before #1225 and 29.6 ms less than on `main`, whose
  `serialize` takes 54.2 ms longer. The probe hands `encodeVctower` the
  engine's text directly, so what a Quick Save does in JavaScript around the
  two calls is outside it: today the stamp, and before #1225 also a JSON
  round trip of the text (#1346). #1242's later call grows nothing (`main`'s
  grows 2.06 MiB), and the three ranges overlap. The probe and the script
  time the same save differently (95.4 against 85.0 ms on `main`), so each
  table compares only within itself. The session's peak on this path stays
  within `main`'s range (63.44 against 62.38 to 64.44 MiB): 1.06 MiB above
  `main` after the first Quick Save and 1.00 under it after the second. The
  probes of 2026-10-27 on `511dadf6` read the same memory but for `main`'s
  62.44 and 64.50 MiB, with #1242's first `encodeVctower` 27.6 ms (round 1
  tree) and 40.5 ms (final pre-replay tree) over `main`'s; it is handed the
  same text on both trees, so that spread is likely run noise.

## Out of scope, found here

- **The `.vctower` writer parses the save into a tree** (#1338, P1, backlog
  row `engine-vctower-writer-memory-peak`). The `encodeVctower` binding
  parses the save text back into a `Value` (`parse_save_json`) and stamps
  it, and `load::encode_vctower` writes that tree as JavaScript's JSON. The
  game's engine writer (`setEngineWriter` in `src/bootstrap.ts`, set on any
  Rust boot) calls it for Quick Save, slot saves, the flush before a
  reload, export and the crash report, and for the autosave where the
  browser lacks `CompressionStream("deflate-raw")`. Why not now:
  `encode_vctower` is a second writer with its own byte contract (the stamp
  rules and JavaScript's number spelling) and needs its own differential
  suite and review; this change leaves that path's peak within `main`'s
  range (1.06 MiB above it after one Quick Save, 1.00 under after two).
- **The `.TDT` export builds the whole save as a tree** (#1431, P3, row
  `engine-tdt-export-tree`). `exportLegacy` reaches
  `Engine::port_tdt_export`, which hands `build_tdt` the tree, and
  `build_tdt` refuses a Modern tower only after reading the finished tree,
  so every export attempt on a Rust session builds it. Not measured on this
  path; the same tree in `main`'s save took 24.56 to 58.13 MiB, and since
  this change the first export in a session can set the high-water mark.
  Why not now: the export's bytes are the TDT lane's contract (the referee
  and the export suite) and need that lane's review; checking the mode
  before `serialize()` is the cheap first step there.
- **The stamp's parse fallback** (#1443, P3, row
  `save-stamp-parse-fallback`). `stampText` parses and prints the whole
  save when the text contains a stamp key with its quotes, which a string
  value that is the word, or ends in a double quote and the word, puts
  there; every save of such a tower then pays it (unmeasured; likely 10 to
  30 ms on large). Why not now: storage code outside this diff, with its
  own review.
- **The text buffer's doubling** (#1243 item 5, P3). The save's buffer
  starts at 128 bytes and doubles, so the save holds up to about three times
  its text for a moment. Why not now: a buffer reserved from an estimate of
  the list lengths would lower the high-water mark on large by at most about
  2 MiB (an estimate), which matters only once #1259 and #1338 bring a
  session's peak down to the save's (Design).
- **An element's own copy** (#1243 item 6, P3). Each unit's and transport's
  `Value` copies the unit's label, a `completeAt` that is not a number and
  the transport's skipped floors, which the loader keeps at any length, so a
  hand-made save can make one element's copy large (a log line's text, which
  its `Value` copies too, is capped at 400 UTF-16 units when it is loaded
  from a save; lines written in play are the game's and the host's own
  text); the save holds one at a time beside its text, where `main` held
  every element at once. Why not now: the remedy is a `Serialize` for `Unit`
  and `Transport`, a second definition of each element's shape and its bytes
  (N2 in Design).
- **The unit list's doubling** (#1259, P1). Why not now: the fix changes how
  `tower.rs` stores units under every index that reads them and is to be
  measured first; this change does not touch the unit store.
- **The hosted save's JSON round trip** (#1346), which the Hot-Path Auditor
  found in round 1 on the host of the time, is gone from `main`:
  since PR #1415 the game's saves, slots, undo snapshots and crash report
  take the engine port's text, and the stamp is spliced into it as text
  (`stampText`, `src/storage/saveStamp.ts`), and since PR #1423 the Rust
  `Engine` is the port itself (`src/wasmhost/rustEngine.ts`). Its row was
  dropped when this change moved onto that `main`, and #1346 is closed. A
  narrower cost in the stamp's guard is #1443.

## Review record

`/gds-code-review` ran eight rounds on this change. Each ran the Blind
Hunter, the Edge Case Hunter, the Acceptance Auditor and the Hot-Path
Auditor, then triage, unless its bullet names fewer. Codex's run on this
pull request failed at its usage limit (2026-10-28), and Copilot reviewed
the head with round 3's fixes once, with no finding, then errored on the
next push; neither saw rounds 4 onward. So the skill looped in their place,
as CLAUDE.md asks. The independent reviewer's GO on the final commit is owed
before the merge, and the owner asked for no automatic merge.

- **Round 1** (on `511dadf6`): the log test never passed the save's cap, the
  memory bound depended on where the text sat against the buffer's
  doublings, nothing pinned distinct keys or every optional field, and the
  binding's own save went unmeasured. Fixed, with the Quick Save figures and
  the probe's source on #1338. The hosted save's JSON round trip went to
  #1346.
- **Round 2**: the binding test checked memory only, a second copy of the
  text fit the bound near a doubling, and the ledger and the excavated tiles
  were held whole. Fixed: the binding test also checks its text, the bound
  needs the text above the buffer's half plus the slack, and both lists
  stream. The owner's terms on #1242 (undo and fallback, desktop acceptance,
  no gate PASS from cloud figures) went into the story, and the pull request
  became "Part of #1242".
- **Round 3** (the Blind Hunter, the Edge Case Hunter and the Hot-Path
  Auditor; the Acceptance Auditor's next pass came in round 4): the room ids
  were held whole, the synthetic tower lacked a log and the transport pools,
  and the slack was loose. Fixed: the room ids stream, the tower carries
  both pools and a full log, the edited test carries a ledger past its
  window, and `SLACK` is 16 KiB.
- **Round 4** (replayed onto `main` at `36947153`): the blockbuster cinemas,
  the milestones and the tower's name were held whole, since the loader
  keeps any number and length. Fixed: all three stream (the cloud run
  measured the tree after the first two). `main`'s new tree readers are
  named; the `.TDT` export's tree went to #1431 and the stamp's parse
  fallback to #1443, and #1346 closed, gone from `main`.
- **Round 5** (rebased onto `ce66ba04`): a value built whole during the
  write after the buffer's last doubling escaped the bound, and the events
  held the pending choice's message whole. Fixed: a write into a reserved
  buffer is bounded too, and the events stream.
- **Round 6**: no patch finding in shipped code. The Edge Case Hunter found
  that each unit's and transport's `Value` copies its label, a `completeAt`
  that is not a number and its skipped floors at any length; that went to
  #1243 item 6. Fixed in prose and tests: the wording that called each
  element's `Value` small, the crash wording, the capped and large groups,
  the events' Santa year and random state, and the run guide's S7.
- **Round 7** (the Blind Hunter and the Acceptance Auditor): no finding in
  shipped code. Fixed in prose and docs, among others: which tree the cloud
  run measured, the capped and large groups (in the story and the test's
  docs), the log line's cap, a #1243 item 5 bullet, AC5's and Design's
  wording, the #1259 row's and issue's run, this record, the run guide's S6
  comparison and Quick Save wording, the order of figure pairs, the
  `preserve_order` premise in the `sim_save.rs` module doc, the `SLACK` doc
  and the wrapping.
- **Round 8** (the Blind Hunter, the Acceptance Auditor and the Hot-Path
  Auditor, whose section 6 record covers the final commit): no finding in
  shipped code. Fixed in prose: which round 4 tree each figure comes from,
  the perf script's name, the #1259 row's 8.6 ms, the estimate in the item 5
  bullet, the log line's cap scoped to lines loaded from a save, this record
  and the wrapping. The Hot-Path Auditor lists #1243 item 6 as a
  pre-existing finding (E6). Rounds 6 to 8 found nothing to fix in shipped
  code, and round 8's last findings were about this record's own wording, so
  the loop stopped there. The branch was then rebased onto `b11b22f4` with
  no conflict and the same patch under `engine-rs/`; of `main`'s changes,
  two reach the save's callers (#1445's autosave after a swap, and the
  legacy import's slot copy through `saveText`), and the section 6 record
  names them.

Deferred, each with a backlog row and an issue: #1338 (P1, the `.vctower`
writer's tree), #1259 (P1, the unit list's doubling), #1431 (P3, the `.TDT`
export's tree), #1443 (P3, the stamp's parse fallback) and #1243 items 5 and
6 (P3, the text buffer's doubling and an element's own copy). The Hot-Path
Auditor found no new hot-path cost after round 4, and its section 6 record
for the final commit, on the pull request, lists each of these.
