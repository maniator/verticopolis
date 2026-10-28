---
story: facade-13-load-memory-peak
status: review
issue: 1225
---

# Story: load a save without a whole-save Value tree (facade slice 13, A8)

**Snapshot.** Every figure in this story is a one-off reading and does not
refresh. Cloud readings: the native probe in Why and on the first review
round (2026-10-20); `perf:load-memory` runs 4 to 7 (2026-10-21); runs 8, 9,
11 and 12 and the restore-point benchmark beside runs 8, 11 and 12
(2026-10-27; run 10 was stopped before it measured, when the script
changed). The Result's tables are run 12. The owner's PC figures are from
2026-10-14 (the M6 estimate) and 2026-10-21 (#874's restore points). The
live figures come from `npm run perf:load-memory`
(`scripts/perf-load-memory.ts`; no test pins its arithmetic, the medians and
ranges of the repetitions it prints) and `npm run perf:restore` (whose
report `src/tests/perfRestore/report.test.ts` checks), the streamed load's
bound from `engine-rs/src/load_memory_tests.rs`, and M6 from the owner's
desktop under `docs/performance/benchmark-protocol.md`. Once the owner's PC
run (`pc-run-1225-load-memory.md` in the project folder) is done, its
figures supersede these.

## Why

The engine's WASM memory never shrinks, so its high-water mark is what a
player's tab holds for the session, and M6 (peak JS heaps plus WASM linear
memory, at most 1.25x TypeScript on the large tower) reads it. The facade
audit found that mark set by `Engine.fromSave`: 51 MiB on the medium perf
tower and 128 MiB on the large one, in Node, against about 22 MiB the loaded
large game keeps (the native count below). Slice 9's verdict run waits on
this (R4 in the facade architecture review), so that an M6 miss is not read
off a load-time peak both host designs share.

A native allocation count on the large tower (2.06 MiB of save text, 43,358
units) found where it goes. It was a one-off probe in the session (cloud,
2026-10-20) and is not committed; `load_memory_tests.rs` is the committed
check of the streamed load's peak.

| Step | Live | Peak |
| --- | --- | --- |
| `parse_save_json` (the whole save as a `serde_json::Value`) | 39.1 MiB | 39.1 MiB |
| `migrate_save` on a version 7 save: `data.clone()`, then the shaft widening's `with()` clones the whole map again | 76.6 MiB | 114.1 MiB |
| the rest of `deserialize` (the unit vector grown by doubling, copied by `drop_overlapping_units`, copied again by `unzip`) | 60.8 MiB | 128.9 MiB |
| the loaded game alone | 21.8 MiB | |

## Acceptance criteria

1. **AC1 Same game.** For every text, `fromSave` builds the same game, or
   fails with the same message, as `deserialize(&parse_save_json(text))`
   did, and `fromVctower` the same as `decode_vctower`, the mode override,
   `deserialize` and the founder mark did. Saves stay byte-identical;
   `SAVE_VERSION`, `loader-cases.json` and the conformance lock do not
   change. The crate's differential tests, `test:wasm` and the parity run
   hold the streamed reader to today's path; conformance and fuzz, which
   reach the split `deserialize` natively, give the same results.
2. **AC2 No whole-save tree on a current save.** A save the game writes
   (version 7 and a game mode, both before `units`; through `fromVctower`
   with a mode given, the mode given stands in for the save's own) loads
   without a `Value` for the whole save or for its `units` array. Its units
   go into vectors reserved once, which do not regrow on such a save, and
   the overlap filter works on those vectors in place.
3. **AC3 Every other save takes today's path.** An older or newer version, a
   missing or unknown mode (when no mode is given), a `version` or `mode`
   given after `units` or repeated there, a repeated `units`, too many units,
   or text that does not parse is read by today's path (`parse_save_json`
   and `deserialize`; for `fromVctower`, its parse, `override_mode`,
   `deserialize` and the founder mark), with the same game or message as
   before. Other keys may come in any order.
4. **AC4 Measured.** A script measures the WASM memory around `fromSave` on
   the perf scenarios, for this build and for another checkout's, and a test
   keeps the streamed load's peak near what it keeps. `fromVctower` has no
   shipped caller, so the script does not measure it.
5. **AC5 No interface change.** `engine.d.ts`, the save layout and the frame
   layout are unchanged, so the crate version stays (CONTRIBUTING,
   Versioning: an internal optimization needs no bump). The slice plan's
   row 13 lists "crate minor", written before the design was known; this
   slice changes no interface, so CONTRIBUTING's rule applies. The app
   version stays too: players load the same game, and only the opt-in Rust
   engine loads it faster and in less memory, which is internal work, as for
   the earlier Rust performance changes (#1276, #1281).
6. **AC6 Restore points: the loss bound holds; the steps that now grow the
   memory are slower until #1242 and #1259.** `serialize`, the save layout
   and when the host saves are untouched, so restore points still ride the
   saves the host already takes and the R6 bound (up to 30 s lost) holds.
   Loading one (undo, redo and every other `adoptSim`) goes through
   `fromSave`, which now streams: on large in the cloud (run 12, the
   Result) the first load is 195 ms faster and a load into the same module
   42 to 49 ms faster. The base grows the WASM memory to its high-water mark
   inside the first load; this branch grows it at the first step that needs
   it, so on large three steps are slower, once per module: the first save
   after a load (24 ms; 8 to 41 ms over eight runs), the first build after a
   load (10 ms) and the first save after a build (20 to 22 ms). The first
   reload's first build is slower too, with no growth (3.3 against 0.4 ms;
   about 5 against 0.5 ms in runs 8, 9 and 11); from the third engine on,
   both builds take the same time. A second save, a reloaded engine's first
   save, and a third engine's build and the save after it cost what the
   base's do. The save budget (no save task over 50 ms on the large PC tower
   at 1x and 4x, which slice 9 measures) regresses for those two saves.
   #1242 (P1) writes the save without the tree, which removes the saves'
   growth, and lands before slice 9's run; #1259 (P1) removes the build's
   growth and the list copy. The owner's PC run times the saves at 1x and
   4x before and after. `main` is already over 50 ms on large in the cloud,
   and at 4x on the PC (about 214 ms for one restore point in #874's run of
   2026-10-21).

## Design

- `engine-rs/src/load_stream.rs` (new): `load_save_text`, which
  `Engine::from_save` calls, and `load_vctower_text`, which
  `Engine::from_vctower` calls; it inflates the file
  (`load::inflate_vctower`, split out of `decode_vctower`), reads it with
  the mode given, then applies the founder mark. `parse_mode` and
  `override_mode` moved here from `wasm.rs` unchanged, so both entry points
  share them. The reader takes the top-level object with a serde visitor,
  one key at a time, on the same `serde_json` deserializer and the same
  lone-surrogate repair as `parse_save_json`. Every key but `units` is kept
  as its `Value` in a map (a repeated key keeps its last value, as the
  `Value` parse does). Each `units` entry is parsed as a `Value` on its own,
  converted by `unit_from_value` at once, and dropped. The units go into
  vectors reserved from a count of the array's objects made off the text
  (`units_hint`, taken only once the version and mode pass; it counts only
  objects with at least one key and is capped by what the text's length
  could hold, one unit per 24 bytes and `UNIT_CAP` in all, about 28 MiB in
  the WASM build), so on a save the game writes they never regrow. A
  hand-made save whose `units` lists objects that never become units can
  still reserve that much (#1243). Then the version 7 migration step (the
  shaft widening, on `transports` alone, at most 88 entries, so it stays a
  `Value`) and `assemble`.
- When the reader is unsure of a save, it stops: the visitor ends the read,
  and the text goes to today's path, so an error or an unusual save gets
  exactly today's result and message. The reader takes only version 7;
  `streamed_version_is_the_save_version` fails when `SAVE_VERSION` moves.
  `the_version_7_step_is_the_shaft_widening` checks, on every current
  loader case and engine save with and without a narrow shaft, that
  `migrate_save` does nothing but the widening; a step keyed on a field none
  of those saves carry would pass it, so `migrate_save`'s version 7 branch
  carries a comment pointing at this file. Its one step not keyed on the
  version, the condo price fill, runs only on a save with no game mode,
  which the reader never takes.
- `engine-rs/src/load.rs`: `deserialize` is split into `unit_from_value` (one
  unit, moved unchanged from the loop body), the unit count and cap (counted
  before any unit is built, as before, now also sizing the vectors exactly),
  and `assemble` (the rest; it never reads `data["units"]`, which a test
  pins). `widen_legacy_elevator_shafts` is split so its core runs on a
  transports list (`widen_shafts`). `drop_overlapping_units` filters the
  units and their ids in place on a dense tile grid per layer, where it kept
  a map of rows. The `unzip` copy is gone: the units and their saved ids
  travel as two vectors, and `repair_entity_ids` walks the unit and
  transport ids in place, units first, where it built a third vector of
  both.

## Tests

- `load_stream_tests.rs`: the binding's `load_save_text` against today's
  path, comparing the written save, the state and crowd digests and the loop
  state, and again after an hour of play: engine saves in both modes; every
  case of `loader-cases.json`, with exactly the current ones streaming;
  every committed fixture tower, with a byte-identical save after a streamed
  load; key order, repeated keys (before and after `units`), versions (6, 7,
  7.0, 7e0, "7", 7.5, 8, none) and modes; unit and transport shapes, a
  narrow legacy shaft the version step widens under every spelling of 7,
  more transports than the pools hold; malformed text (empty, a byte order
  mark, trailing text, a cut-off save, `1e400`, a bad literal, nesting past
  the depth limit, inside and outside `units`), each declined; a top-level
  key spelled as one of serde_json's private ones, declined; the unit cap at
  and one past it, with skipped entries beside the units; the object count
  and its length bound; the version 7 migration step.
- `load_stream_edit_tests.rs`: 400 seeded byte edits of engine saves
  (dropped, inserted, changed or copied bytes, or a cut; exactly 151
  stream, and those of every tenth round are also played for an hour);
  numbers past `f64`'s exact integers and past `i64` and `u64`, signed zero,
  underflow and other spellings, in place of the real `money`, `minutes`,
  `nextId` and a unit's `rent`, `x`, `floor` and `id`; nesting at depths 120
  to 130 around the parser's limit, with the count that parses pinned; lone
  and paired surrogate escapes in an office's label, which the loaded game
  keeps, repaired or decoded the same way by both readers.
- `load_vctower_tests.rs`: `load_vctower_text` against today's import path,
  after load and after an hour of play, with no mode set and each mode set,
  an unknown mode, a set mode replacing a missing or unknown one, the
  founder mark (no `appVersion`, a build before 2.0, 2.0, and `founder`),
  a byte order mark before the save text (dropped, so the file streams),
  bad files (wrong magic, bad base64, empty, text that does not parse or is
  not a saved game); the reader's edge cases (a lone surrogate escape in a
  label, an escaped `units` key, entries that are not units, a bad literal
  in `units`, one unit past the cap) with no mode and with Modern set; and
  every fixture tower, streaming exactly when it is current: a current one
  with no mode, Classic and Modern set, an older one with one of them.
- `load_assemble_tests.rs`: the tile grid against the map of rows it
  replaced (copied line for line from `main`), on 300 rounds of random
  units of every kind packed into floors at the bottom, middle and top of
  the lot; `assemble` building the same game
  whether the save's `units` is missing, empty or not a list, on the raw and
  the migrated save; the id repair walking unit ids before transport ids, as
  the one list it replaced did, with a transport id equal to a unit id.
- `load_memory_tests.rs`: counts allocations per thread (every `realloc`
  counts both blocks) and holds `load_save_text` on a 41,460-unit tower to a
  peak at most 1.25 times what it keeps, and checks that the save streamed.
  Without the reservation it peaks at 1.9 times and fails. On the engine's
  saves and every committed tower, the object count equals the number of
  entries in `units`, and each entry takes at least 40 bytes of the text
  with its comma, over the 24 the length bound allows per unit, so the
  vectors are reserved once and never regrow (AC2).
- `npm run perf:load-memory` (`scripts/perf-load-memory.ts`): two fresh
  Node processes per repetition. One records the WASM memory before the
  load, after it, after an hour of play and after one `serialize` (each a
  high-water mark that includes the steps before it), with the wall times
  of the load, that `serialize` and a second one. Then it loads a second
  engine from the same save into the same module (as an undo, a redo or a
  load does), plays the hour, times its first `serialize`, searches for a
  place a floor tile can go alone, builds it and saves, timing the build
  and that save, with the memory after the first save, the search, the
  build and the last save. A third engine repeats the second's steps, so a
  cost that comes back on every load shows. The other process loads,
  searches, builds the tile and saves, with the memory after each step,
  the build's and the save's times and the place. A tile's price is the
  lowest price `canBuild` gives anywhere on the lot, and each build must
  cost exactly that. The script names the engine by the source hash
  `npm run wasm:build` stamps into the `.wasm` (`BUILD.json`'s `sources`)
  and stops when the stamp is missing. `--engine <checkout>` measures
  another checkout's build on the same scenarios. The script is outside
  the lint and type-check gates (`npm run lint` covers `src` and `api`); a
  strict `tsc` run on it alone is clean.
- Unchanged and green on this branch: the conformance lock, `cargo fmt`,
  `cargo clippy` and `cargo test` (default, `conformance` and `wasm`
  features, and the `wasm32` build), `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`, `npm run test:wasm` and
  `npm run test:wasm:parity`. Fuzz: 20 seeds (1225001 to 1225020) of the
  `fuzz` binary, each replayed by `scripts/fuzz-compare.ts`, all agreeing.
  The fuzz binary reaches the split `deserialize` and `assemble` through the
  scenario runner's save and reload; the streamed reader is covered by the
  differential tests above.

## Result

Cloud estimates (see the snapshot note at the top), run 12 on 2026-10-27:
Node v22.22.0, `npm run perf:load-memory -- --reps 10`, each repetition in
two fresh processes; memory is the same in every repetition. Before: `main`
at `8594e3b`, engine sources `7b7209885106ac40`. After: this branch on
`8594e3b`, engine sources `57b9080cda396ac5`, the engine of the final
commit. Times are medians, with the range in the script's output. The
container's speed varies between runs (the base's large load took 370 ms in
run 7, 442 ms in run 8, 500 ms in run 11 and 341 ms here), so compare times
within a run.

WASM memory in MiB. On the base, the script reads the load's figure in
every column (8.38, 51.13 and 128.31 MiB), which hid the later marks; the
columns after the second are this branch's. Runs 8 to 12 read the same
memory.

| Scenario | After load, base | this branch | after an hour | after one `serialize` | after a second engine's load, hour and save | after a build on it | after a save | after a third engine's load, hour, save, build and save |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| small (version 7) | 8.38 | 2.44 | 2.44 | 4.06 | 4.06 | 4.06 | 4.69 | 4.69 |
| medium (`sixseven_2`, a version 4 save) | 51.13 | 51.13 | 51.13 | 51.13 | 51.13 | 51.13 | 51.13 | 51.13 |
| large (version 7) | 128.31 | 24.56 | 24.56 | 58.19 | 58.19 | 58.19 | 72.00 | 72.00 |

The other process builds straight after the load (this branch; on the
base every cell reads the load's figure):

| Scenario | After load | after the search | after one build | after a save |
| --- | --- | --- | --- | --- |
| small | 2.44 | 2.44 | 3.88 | 4.56 |
| medium | 51.13 | 51.13 | 51.13 | 51.13 |
| large | 24.56 | 24.56 | 52.38 | 69.44 |

Each search for a lone floor tile leaves the memory where it found it, on
every scenario and both builds; both place the tile at the same spot
(floor 16, x 120 on small; 2, 112 on medium; 2, 3 on large), and each build
cost exactly one tile's price.

| Step, ms | small, base | this branch | medium, base | this branch | large, base | this branch |
| --- | --- | --- | --- | --- | --- | --- |
| Load | 30.9 | 19.8 | 224.6 | 206.9 | 340.7 | 145.7 |
| First `serialize`, after the load and an hour | 5.4 | 6.3 | 19.1 | 18.2 | 52.8 | 76.6 |
| Second `serialize` | 3.4 | 3.5 | 13.3 | 13.3 | 49.1 | 50.8 |
| Second engine: load | 11.6 | 8.1 | 140.0 | 135.1 | 145.2 | 96.6 |
| Second engine: first `serialize` | 3.3 | 2.8 | 15.6 | 13.3 | 48.5 | 46.9 |
| Second engine: a build | 0.6 | 0.7 | 1.3 | 1.3 | 0.4 | 3.3 |
| Second engine: the `serialize` after it | 2.9 | 2.8 | 14.1 | 13.8 | 45.6 | 65.4 |
| Third engine: load | 7.2 | 4.7 | 134.0 | 143.1 | 136.3 | 94.3 |
| Third engine: a build | 0.2 | 0.2 | 0.9 | 0.8 | 2.7 | 2.7 |
| Third engine: the `serialize` after it | 2.5 | 2.8 | 13.3 | 13.2 | 49.6 | 48.6 |
| Other process: a build straight after the load | 0.5 | 1.2 | 1.3 | 1.4 | 0.4 | 10.0 |
| Other process: the `serialize` after it | 3.9 | 4.2 | 14.9 | 14.5 | 46.1 | 68.1 |

On large the first load is 195 ms faster, and a load into a module that
already holds the memory, as an undo or a redo is, 42 to 49 ms faster (the
second and third engines' loads). Three steps are slower, each the first in
its module to need memory the base grew inside its first load:

- the first save after a load (52.8 to 76.6 ms), which grows the memory
  from 24.6 to 58.2 MiB, likely for the save's tree (#1242);
- the first build after a load (0.4 to 10.0 ms), which grows it from 24.6
  to 52.4 MiB, likely as the unit list moves to a block twice its size
  (#1259);
- the first save after a build: 46.1 to 68.1 ms straight after that build
  (52.4 to 69.4 MiB), and 45.6 to 65.4 ms on the second engine, whose build
  grew no memory and whose save then did (58.2 to 72.0 MiB).

The first reload's build is slower too, with no growth: 3.3 against 0.4 ms
here, and about 5 against 0.5 ms in runs 8, 9 and 11. It reads as a copy of
the exact-size unit list that the base's list avoided there, apparently by
growing in place; from the third engine on, both builds take the same time
(2.7 ms here, 4.9 against 4.6 in run 11). Where a list can grow in place
depends on what the allocator put after it, which the script does not read.

After those the memory holds: a second save, the second engine's first
save, and the third engine's build and the save after it cost what the
base's do, and the third engine leaves the memory at 72.0 MiB. Per process
on large, the play process saves 285.6 ms on its three loads and spends
46.5 ms more on its first save, the second engine's build and the save
after it; the build process spends 31.6 ms more on its build and save,
after a load 195 ms faster.

The base's first save varies from run to run, and so does the gap, 8 to 41
ms over eight runs: in runs 4 to 7 (2026-10-21) 56.9, 54.5, 69.3 and 52.4
ms on the base against 78.2, 77.6, 77.4 and 80.1 on this branch, and on
2026-10-27 88.5 against 104.8 (run 8), 81.9 against 122.4 (run 9), 81.2
against 112.1 (run 11) and 52.8 against 76.6 (run 12).

Small streams too: its load is 11 ms faster (30.9 to 19.8 ms) and its
reloads 3.5 and 2.5 ms faster, and its first save and its first build
after a load are each under 1 ms slower, the same growth on 2,240 units
(its save after a build grows the memory too, 4.06 to 4.69 MiB, with no
measurable time). The medium scenario takes the same path on both builds
(a version 4 save goes to today's path, now through the split
`deserialize`), and on every step the two builds' ranges overlap.

The restore-point benchmark (`npm run perf:restore -- --reps 3 --scenarios
large --throttles 1`, run beside load-memory runs 8, 11 and 12 in the same
container on 2026-10-27, indicative only; each after run measured this
branch's staged tree, which its report flags as a dirty tree) runs the
hosted tower in Chromium, in a fresh browser per repetition. Each
repetition loads the large tower into the hosted engine before each of its
four workloads, after the page's own first game, and times neither the 30
warm-up steps nor the point saves before each workload's timed steps, so
the first save that grows the memory may fall outside the timed window. In
run 12, on large, the save time per command was 99.7 ms on the base and
96.1 on this branch for 40 edit gestures (an undo capture, one floor tile
and the commit, two saves each) and 51.0 and 46.0 for 40 drags; one
restore point cost 42.5 to 52.8 ms on the base and 40.0 to 60.3 on this
branch, and the edit gestures' step median was 389.5 and 360.1 ms. The
edits and drags show that the slower steps do not repeat on every edit.
The rent clicks (36 commands, 24 merges) read 31.9 ms per command on the
base and 34.6 on this branch, and their repetitions overlap (31.3 to 32.4
against 31.5 to 36.8). Run 11 had shown a gap there (46.1 against 57.2,
with repetitions of 44.9 to 49.6 against 49.9 to 58.7) and run 8 none
(49.7 against 49.6), so it reads as container noise; the owner's PC run,
with 10 repetitions at 1x and 4x, settles it.

The medium row reads the raw version 4 scenario save. The facade starts the
engine from TypeScript's re-save, which is version 7 and streams.

Native, on the large tower, the same one-off probe on this branch's first
review round: peak 24.1 MiB for 21.8 MiB kept (from 128.9).

**M6, a cloud estimate.** On the owner's PC (2026-10-14,
`docs/performance/wasm-worker-host.md`) the large tower read 75.8 MiB of JS
heaps plus WASM on TypeScript, so the 1.25 ceiling is about 94.8 MiB. The
main-thread WASM host read 204.0 MiB; less this script's 128.3 MiB load peak
for the same tower, its JS heaps were about 75.7 MiB, and the facade drops
the mirror's 21 MiB of them, which leaves about 54.7 MiB of JS heap and
about 40 MiB for the engine's WASM memory. After load the engine now holds
24.6 MiB, inside it. `perf:worker` reads memory after 30 steps on a freshly
loaded page and builds nothing, so a `serialize` within those steps
(#1242, 58.2 MiB) would cross the ceiling. A player's session builds too:
one build after a load reaches 52.4 MiB (#1259), a build and a save 69.4
MiB, and the play process ends at 72.0 MiB, which a third load, build and
save do not raise. Each of those crosses the ceiling, by less than the
base's load alone (128.3 MiB) did.

## Out of scope, found here

- **`serialize` now sets the high-water mark** (#1242, P1, backlog row
  `engine-serialize-memory-peak`). `Engine.serialize` builds the whole save
  as a `Value` before writing it, so the first autosave after a load on
  the large tower takes WASM memory from 24.6 to 58.2 MiB, and the first
  save after a build to 69.4 or 72.0 MiB; those are the slower saves in the
  Result. Restore points ride the saves (R6), so this is on the facade's
  path too.
- **The first build after a load doubles the unit list** (#1259, P1, backlog
  row `engine-unit-list-growth-peak`). The loaded `tower.units` is exactly
  its length, so the first placement moves it to a block twice the size
  while the old one is held: 24.6 to 52.4 MiB on large. The memory cost
  predates this slice (`main`'s load peak hid it). Its time in a fresh
  module is new here (0.4 to 10.0 ms on large in run 12). The first
  reload's build is slower too (3.3 against 0.4 ms), with no growth, likely
  the list's copy, which the base meets from the third engine on.
- **Older saves, the unit record size and the per-unit maps** (#1243, P3,
  backlog row `engine-load-memory-remainders`). A save before version 7
  migrates through today's path (whole-save copies) the first time it
  loads; the game then saves it as version 7. A `Unit` is 400 bytes native
  (336 in the WASM build), most of the loaded game. A hand-made save whose
  `units` lists objects that never become units reserves the unit vectors
  all the same (up to about 28 MiB), and so does a text that turns out
  malformed inside `units`, before the reader declines it.
- **Repeated scans on the load and day passes** (#1252, P3, backlog row
  `engine-load-repeated-scans`), mostly in lines this slice does not change
  but for the id set's capacity, including a quadratic dedupe of
  `blockbusters` and `milestones` on a forged save. Four are in the new
  reader or the rewritten overlap filter and cost only on a forged or
  declined save: a decline after `units` (an over-cap list, a late
  `version` or `mode`, a second `units`, a malformed byte later in the
  text) throws away the converted entries (H2a, H19), a declined save is
  scanned for lone surrogates twice, and the filter probes a dropped
  unit's footprint each time (H20).

## Review record

`/gds-code-review` ran in the authoring session with all four layers (Blind
Hunter, Edge Case Hunter, Acceptance Auditor, Hot-Path Auditor) on every
round. Round 6's Edge Case Hunter output was lost, so round 7 ran that
layer again over the whole diff.

- **Round 1.** Patched: `fromVctower` on the same reader, the unit cap
  counted before any unit is built (H2), the overlap filter's hashed rows
  replaced by a tile grid (H3), the version 7 step guard, AC3's wording, the
  script's `--engine` before and after, dated figures. Deferred: #1242,
  #1243, #1252.
- **Round 2.** Patched: the forced mode read off the binding's string, the
  object count's length bound, the "after one build" sample, comment fixes.
  Filed #1259 for the first build's unit list copy.
- **Round 3.** Patched: empty objects left out of the count, the id repair
  over the two id lists in place (H16), the repaired text freed before the
  game is built (H18), test gaps (the raw save in `assemble`, numbers
  landing at the top level or in a unit, invalid UTF-8 and a narrow shaft
  through `fromVctower`, the ids' order), the script's option checks, and
  AC6 restating the 50 ms save budget with timed saves. Deferred: H2a and
  the declined save's second surrogate scan (#1252 items 7 and 8).
- **Round 4** (this branch's content on top of `ee5ae06`). No input gives a
  different game or message. Patched: a decline on serde_json's private key
  spellings; a comment tying the unit clamps to the tile grid; tests (the
  reader's edge cases through `fromVctower` with a mode set, fixtures
  streaming exactly when current, the depth count pinned, the old filter
  copied line for line from `main`, the memory test checking that the save
  streamed); the script (the single tile's price taken from a placement
  refusal, the search measured apart from the build, a second engine's first
  save, option errors); the story (AC6 retitled with the measured
  once-per-module cost, slice 9 at 1x and 4x, AC1 and AC4 narrowed to what
  the evidence covers). Deferred: the malformed text's reservation (#1243
  item 4) and the `FastSet` caveat on H14's fix (#1252 item 5). Dismissed:
  the memory test's synthetic tower (the script measures the real large
  save); the declined texts' message comparison (by design; the binding's
  message is checked on its own); the script's lot constants (a drift
  narrows or widens the search, which throws when it finds nothing);
  `load.rs` growing (the size guard passes, and its ratchet lists files);
  H13's remainder (one pass per command, which HP-2 allows); H18b (no
  shipped caller, noted in #1252 item 8).
- **Round 5** (confirming). No input gives a different game or message,
  and the Edge Case Hunter found nothing. Patched: tests (on the engine's
  saves and every fixture, the object count equals the unit count and each
  entry is at least 40 bytes, AC2's direct check; surrogate escapes in a
  label the loaded game keeps; the seeded edits' count pinned at 151;
  each mode streaming a current fixture); the script (the single tile's price
  taken as the lowest price seen, with no message text read, each build
  checked to cost that price, the package's `.wasm` checked against
  `BUILD.json`, a build and a save on the second engine, and the first
  build's time); docs (the reader's rule for a mode after `units`, the
  count's reach on a hand-made save, the memory test's tower); the story
  (the snapshot pointer, AC5's app version, AC6 and the Result narrowed to
  what the runs show). Deferred: a hand-made save of objects that never
  become units still reserves the vectors (#1243 item 4, broadened), and
  H19, the decline after `units` for a late key (#1252 item 7, with H2a).
  The fixed per-load cost of the tile grid (two grids of 110 floors by 375
  tiles, 41,250 bytes each) is in the hot-path record.
- **Round 6** (confirming; applied after clean rebases onto `d09aa64` and
  `0da4d02`). No input gives a different game or message. Patched: the
  script (the memory after the search and the build on the second engine, a
  save after the first build in its own process, a third engine, the engine
  named by the build stamp in its `.wasm`, scenarios picked through the perf
  scenarios' own lookup); the count test reading each entry's length off the
  text; AC6 and the Result on run 11 (each slower step named once per module
  with the process it was measured in, the third engine back at the base's
  cost, the reloaded build's copy on both builds, small's load gain, causes
  measured where the script now reads them); docs (the overlap filter's
  copy, the snapshot, the Tests bullets, wraps). Deferred: H20, the overlap
  filter probing a dropped unit's footprint on a forged save (#1252 item 9).
  Updated: H5's estimate after #1237 (#1252 item 1). Dropped: H9, fixed on
  `main` before this branch's first base.
- **Round 7** (confirming; on `0da4d02`, then rebased onto `8594e3b`,
  whose panel getters in `wasm.rs` sit beside this change). The Edge Case
  Hunter, run again over the whole diff, found no unhandled path, and no
  input gives a different game or message. Patched: the script times the
  second and third loads (run 12: a reload is 42 to 49 ms faster, where
  round 6's text had given every load the first load's gain); the Result
  gives per-process totals, labels the list copy and the save's tree as
  likely causes and states the first reload's build gap as repeatable; the
  restore benchmark's description (it loads the tower before every
  workload and leaves its warm-up untimed) and run 11's click gap, which
  run 12 did not repeat; the
  snapshot's dates; Design's note on `migrate_save`'s one step not keyed on
  the version; the PC run's memory check allows one 64 KiB page. Deferred:
  the count's length bound uses the whole text (#1243 item 4). Dismissed:
  the fixture test's streaming half (the `.vctower` fixture test requires
  each mode to stream a current fixture) and `inflate_vctower`'s move past
  a byte order mark (one pass, no shipped caller).

The section 6 record of `docs/performance/hot-path-review.md` for the final
commit is posted on the pull request.
