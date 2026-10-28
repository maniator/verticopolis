---
title: Hand-edited saves load the same in both engines, and RNG state 0 reloads as 0 (B6)
type: bugfix
created: 2026-10-20
status: review
baseline_commit: 511dadf6
context:
  - CONTRIBUTING.md
  - _bmad-output/project-context.md
  - _bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md
---

## Intent

**Problem.** B6 of the 3.0 plan (the Saves row of #945) asks for S12, issues
#858 and #856, to be fixed before the candidate freeze or entered in the
exception register. #856: a save taken when the main random stream sits at
state 0 reloads at state 1, so the reloaded game draws a different stream
from an uninterrupted run. #858: a hand-edited or forged save still loads
differently in the Rust engine and the TypeScript engine. The audit half of
B6 (every fixture and loader case byte for byte through WASM, the 32 MiB and
Unicode edges) is #1236, PR #1238 (merged 2026-10-21), owned by the "Evidence and
differential testing" lane; this spec covers the fixes only.

**Probe (2026-10-20, `main` at d06e2a6).** 61 hand-edited inputs, run through
both loaders as loader-table cases (state digest, native Rust) and through
`Engine.fromSave` in WASM against `Simulation.deserialize` (canonical saves).
14 field families still differ, and a 15th turned up while writing the
cases (row 15: huge `minutes` match on their own, but not beside a field
read against the day). Review added rows 16 to 18 (the v1 to v5 checks and
the reflow at their edges, a fractional v1 `nextId` well above every id, and
a pending message that is an array or a number past 1e21). Everything else
#858 and its backlog row list (fractional `blockbusters`, `lastSantaYear`,
`vipVisitDay`, `skipFloors`; string `completeAt`; string widths; the log-text
cut; a numeric pending message under 1e21; a fractional `nextId` just above
the highest id; a lone surrogate, see D4) already matches.

| # | Input | TypeScript today | Rust today |
| --- | --- | --- | --- |
| 1 | `occupants` fractional or past 2^63 | kept as a double | truncated, saturates at `i64::MAX` |
| 2 | `carDir` fractional or huge | kept as a double (0.5 reads as moving) | truncated (0.5 reads as parked), saturates |
| 3 | transport `load` fractional, huge, non-number, null or absent | kept verbatim, absent stays absent | truncated integer, 0 otherwise |
| 4 | unknown transport keys | re-saved by the object spread | dropped |
| 5 | `builtWeddingHall` not a boolean | kept verbatim | `false` |
| 6 | `towerName` not a string | kept verbatim | `""` |
| 7 | `vipFavorable` not a boolean | kept verbatim (1 is truthy) | `false` |
| 8 | `evaluatedTower` not a boolean | kept verbatim (1 is truthy) | `false` |
| 9 | `vipVisitDay` a string or boolean | kept verbatim | `-1` |
| 10 | a pre-mode condo whose `state` is not a string | stamps the legacy sold price | skips it |
| 11 | `lastVipNagDay` far below zero | kept | saturates at `i64::MIN` |
| 12 | a v1 save with string `floor` or `x` | `migrationLooksValid` concatenates strings and refuses the reflow | reads numbers, reflows |
| 13 | a top-level `null` save | throws | loads an empty tower |
| 14 | a number literal past the double range (`1e400`) | loads it as Infinity | refuses the whole file at the JSON level |
| 15 | `minutes` past about 1.3e22 with a day-relative field (`exterminationDueDay`) | the day is a double | the day saturates at `i64::MAX`, so day-relative fields read differently |
| 16 | the v1 to v5 checks and the reflow (found in review): a string structure `x`, `floor` or `width`; a room at a NaN column sorted between an overlapping pair; a two-story room at 2^53 floors; a structure tile far wider than the lot; a room column or width past 2^52; a room that keeps a saved footprint far off the lot | concatenates strings into tile keys and coerces a string width; misses the overlap; loops forever; throws at the `Set` size limit; reflows the room in doubles; paves every column of the footprint (forever at x = 2^53) | reads numbers, a string width as 1; misses it with another order; loops forever; builds a set of that size; reflows it in saturated `i64`s; paves every column of the footprint |
| 17 | a v1 save whose `nextId` is fractional and well above every id, with floor tiles the reflow pads | pads at fractional ids, which the load then renumbers from the highest id | pads at the truncated `nextId` |
| 18 | `events.pending.message` an array or a number past 1e21 | `String()`: `"1,2"`, `"1e+21"` | the JSON text: `"[1,2]"`, `"1e21"` |

## Which engine is the source, per field

The rule (coordinator, 23:40 UTC): the engine whose current behavior matches
the documented save format is the source, and the other one changes. A
TypeScript change must not alter the outcome for any save the game itself
wrote. "Documented format" is `SerializedGame` (`src/engine/serializedGame.ts`)
and the `Unit`/`Transport` types in `src/engine/types.ts`; "the game's
writers" were checked over the full history (`git log -G`, 3,526 commits back
to the first, dd80d6fa on 2026-06-29), including the `.TDT` importer.

Only a hand edit puts the inputs of rows 1 to 18 in a save. A 2.x build that
loads such a save writes the mistyped value back unchanged, so it can
persist across saves, but no play produces it.

| # | Field | Documented format | What the game's writers produce (evidence) | Source | Fix | Outcome change for a game-written save |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `occupants` | `occupants: number`, a head count | Integers only: presence (`population`, `residentCount`, `1`, `0`), census (`customersIn`), `.TDT` import (status bits), `0` at placement | Rust (integer) | TypeScript truncates; both clamp at 2^53 - 1, where Rust saturates today | None |
| 2 | `carDir` | `-1 down, 0 idle, 1 up` (types.ts) | `0` at creation, `1` when a car is added, `0`/`dir` in dispatch where `dir` is `1` or `-1` | Rust for the truncation (0.5 reads as 0, as today); neither for the range | TypeScript truncates; both clamp to -1..1 | None |
| 3 | transport `load` | `load: number` | `load: 0` at creation since the first commit; nothing ever assigns or reads it | Rust (integer, 0 when missing) | TypeScript coerces; both clamp at ±(2^53 - 1) | None |
| 4 | unknown transport keys | the `Transport` interface | Fields were only added over the 78 versions of `types.ts` (`skipFloors`, `carLoad`, `schedule`), none removed or renamed, and the writer spreads the typed object, which no code extends; no fixture holds another key | Rust (fixed keys) | TypeScript builds the transport from its known keys, a list the type checks | None |
| 5 | `builtWeddingHall` | `boolean` | `false` default, `true` at placement, `units.some(...)` on demolish | Rust | TypeScript | None |
| 6 | `towerName` | `string` | `"Tower One"` default, the rename input's `.value`, the `.TDT` file name | Rust | TypeScript | None |
| 7 | `vipFavorable` | `boolean` (optional) | `false`, `true`, and `star >= 4` or `>= 6` from `.TDT` | Rust | TypeScript | None |
| 8 | `evaluatedTower` | `boolean` | `false`, `true`, `star >= 6` from `.TDT` | Rust | TypeScript | None |
| 9 | `vipVisitDay` | `number` (optional) | `-1`, `day + 3`, `day + 5`, `.TDT`'s `floor(minutes / 1440) + 3` | Rust | TypeScript | None |
| 10 | condo `state` in the pre-mode price backfill | a `UnitState` string | Always a state string; the v3 sparse writer omits `"empty"` | Rust (a non-string reads as the loader's `"empty"`) | TypeScript (`saveMigration.ts`) | None |
| 11 | `lastVipNagDay` | `number` (optional) | `-100` default, `clock.day` (never negative) | Both today (TypeScript keeps it, Rust saturates) | Both clamp at -(2^53 - 1) | None |
| 12 | v1 `floor`, `x`, `width` in `migrationLooksValid` | numbers | v1 units always carried numbers | Rust, which reads `x` and `floor` as numbers like the TypeScript reflow itself (`Math.round(Number(...))`) and a width that is not a number as the catalog's | TypeScript's check reads them the same way. `deserialize` then reads a string `floor` as 1 in both engines, as before | None |
| 13 | a `null` save | an object | `serialize` always returns an object | TypeScript (refuses) | Rust refuses | None |
| 14 | `1e400` | JSON numbers | `JSON.stringify` writes `null` for Infinity | n/a | EX-3, proposed | None |
| 15 | `minutes` | `number`, minutes since the start | The clock's own count; 1.3e22 minutes is about 2.5e16 years of play | Neither (no type mismatch, a range edge) | Both cap `minutes` at 2^53 - 1, where the Rust day still fits an `i64` | None |
| 16 | structure geometry, room columns, floors and widths in the v1 to v5 checks and the reflow | numbers; floors -9 to 100; columns on the 375-wide lot; structure tiles 1 wide | Numbers in range, tiles 1 wide | Rust for the geometry reads; neither for the loop edges, where both engines hang or fail | The checks and the paving read structure geometry as Rust does (the reflow's original-structure pass reads a width as a number in both engines, as before); both skip a room at a NaN column or a floor at or past 2^52 (`FAR_COORD`) in the checks, leave a room with a floor, column or width there out of the reflow, cap a tile's width at the lot's width, and pave only lot columns | None: a footprint off the lot fails the check after the reflow, so only discarded reflows change |
| 17 | v1 `nextId` in the reflow | `nextId: number`, the next unused id | Whole numbers only | Rust (whole ids), and the v5 to v6 migration already floors it in both engines | Both floor it, as v5 to v6 does | None |
| 18 | `events.pending.message` | `string` | The event's own message text | Neither (both coerce, differently) | Both read anything but a string as none (`""`), as they already read null or absent | None |
| #856 | `seed`, `events.rngState` | the live stream state | `seed: rng.seed` (the live state) since the first commit; `.TDT` seeds are never 0 (`hashSeed` maps 0 to 1) | Neither (both reload state 0 as 1) | Both engines restore it | The one intended change: a save taken at state 0 (1 in 2^32 per save) now continues the stream the uninterrupted run draws, in both engines |

## Decisions

- **D1, direction.** The table decides it. Rows 1 to 10, 12 and the
  geometry reads of 16 have a documented type the Rust engine already keeps
  and the TypeScript engine does not, and no game-written save holds a
  mistyped value, so the TypeScript loader narrows and no game-written save
  loads differently. Rust changes where its narrowing saturates at the edge
  of `i64` (1, 2, 3, 11, 15): both engines clamp to a range a double holds
  exactly, so they agree on every JSON number. Row 17 floors a fractional v1
  `nextId` in both engines, as the v5 to v6 step already does. Rust also
  refuses a `null` save (13) as the TypeScript does, where it now builds an
  empty tower the player never saved. Where
  neither engine was the source (the loop edges of 16, and 18), both change
  to the same rule. As a tiebreaker only: widening Rust instead would turn
  `Unit.occupants` and `Transport.car_dir` into doubles across about 16
  engine files, most of them hot paths owned by other 3.0 lanes.
- **D2, #856.** On load, a `seed` that is a finite number restores the main
  stream at `seed >>> 0` with no zero guard. A missing or non-number `seed`
  loads as today (the constructor default, then the guard). The event
  system's `rngState` has the same guard on load and gets the same restore.
  A new game seeded 0 still starts at state 1, and a new game still seeds
  the crowd and the event stream through the constructor.
- **D3, 1e400.** Left unfixed and proposed as EX-3 in the exception
  register. No writer produces such a literal (`JSON.stringify` writes
  `null` for Infinity), and the Rust refusal loses nothing while the
  TypeScript engine ships (the file is untouched and opens there); once the
  TypeScript engine retires, such a file opens in neither engine, which the
  register entry records. A faithful fix needs Infinity semantics per field
  in a `serde_json::Value` tree, which cannot hold Infinity. Reading the
  literal as `null` first would not match either: TypeScript treats Infinity
  and null differently in some fields (a v1 room at column Infinity loads at
  column 0, one at null at column 170), so it would need a per-field audit
  for a value no writer makes. A Rust test pins the refusal so a change flips it.
- **D4, lone surrogates.** Already matched, so neither fixed nor an
  exception: both engines read save text through the same repair, each lone
  surrogate escape to U+FFFD (`parseSaveJson` in `saveCompression.ts`, which
  every web read path uses, and `parse_save_json`; #936, #941, #944), pinned
  by `conformanceWasmVctower.integration.test.ts`. Only `deserialize` on a
  bare `JSON.parse` keeps the half character, and no read path does that.
  EX-2 (#1238) is about the raw text form, a separate question.
- **D5, one PR.** This lane has one branch, so #856 and #858 ship as one PR
  with one crate patch bump (the loader-case lock moves). The fixes share
  `serialization.ts`, `load.rs`, the loader table and its lock, so they are
  one commit; the spec, EX-3 and the backlog rows are a second.
- **D6, deferred.** Three forged shapes outside #858's list make the
  TypeScript loader throw or stall where the Rust loader loads (an object
  with its own `toString` in a coerced field, more than 2^24 distinct tile
  keys in the v1 to v5 sets, a multi-megabyte top-level string or array):
  backlog row `forged-save-loader-edges`, #1282. The independent review
  also found the reverse: JSON nested 128 or more containers deep, which the
  Rust parser refuses and TypeScript loads (on `main` too). That is #1318
  (found inside unit and transport entries by #1292's review), and its fix
  is an owner call, like EX-3's.

## Boundaries and constraints

**Always:** every save the game writes loads exactly as before in both
engines, apart from #856's save at random state 0 (1 in 2^32), which now
continues the uninterrupted stream (every existing loader case keeps its
hash, apart from the two former `known-858-*` cases; no existing scenario
hash moves); the same rule
in both engines; tests exercise the real Rust engine,
natively and through WASM.

**Coordinate first:** `engine-rs/src/load.rs` belongs to the "Rust save-load
memory peak" lane (A8, #1225). It agreed (23:30 UTC) that this lands first or
second, whoever merges second merges `main` and re-runs. #1225 merged first
(#1332), splitting `deserialize` into `unit_from_value`, the unit count and
`assemble`, which its streamed reader (`load_stream.rs`, the path
`Engine.fromSave` takes for a current save) shares; this branch merged `main`
and moved its hunks there. The Rust edits stay
small: inside `deserialize`, `unit_from_value`, `assemble` and the three v1
migration helpers, plus four
module-level items (`MAX_SAFE_INTEGER`, `FAR_COORD`, `is_far`, `tile_width`)
and one comment in `mod loader_cases`. Outside `load.rs` and A8's files:
`Rng::restore` in `rng.rs`, a test module line in `lib.rs`, the new
`load_fidelity_tests.rs`, and `number_to_string` in `jsmath.rs`, which now
spells NaN and the infinities as JavaScript does. In A8's `load_stream.rs`,
one word: `read_save` becomes `pub(crate)` so the new tests can check which
reader took a save. The exact list goes to A8 with the PR.

**Never:** change `SAVE_VERSION`, the save format, the writers, a facade
slice's logic, or the test logic of
`conformanceWasmSaves.integration.test.ts` (#1238's). Two agreed edits that
change no behavior: the `read_save` visibility above (`load_stream.rs` is
facade slice 13's), and that test's header comment, which pointed at #858's
`knownDivergence` cases and goes stale once this fix removes both markers.

## I/O and edge-case matrix (after)

| Input | Both engines load |
| --- | --- |
| `seed: 0`, `seed: 4294967296` | main stream at state 0; the next draw equals the uninterrupted run's |
| `events.rngState: 0` | event stream at state 0 |
| `seed: null`, `"0x10"`, absent, `12345.75` | unchanged from today |
| `occupants: 2.5`, `-0.5`, `1e300` | 2, 0, 9007199254740991 |
| `carDir: [0.5, -0.5, 2.5]`, `[1e300]` | `[0, 0, 1]`, `[1]` |
| `load: 2.5`, `"x"`, `null`, absent, `1e300` | 2, 0, 0, 0, 9007199254740991 |
| a transport with `foo: 1` | `foo` dropped |
| `builtWeddingHall` / `evaluatedTower`: `1`, `"yes"`, `null`, `0` | `false`; absent stays absent |
| `towerName`: `5`, `null`, `{}` | `""`; absent stays absent |
| `vipFavorable`: `1`, `"yes"`, `0` | `false` |
| `vipVisitDay`: `"3"`, `true` | `-1` |
| pre-mode condo with `state: 5` or `{}` | no legacy price stamp |
| `lastVipNagDay: -1e300`, `-3.5` | -9007199254740991, -4 (floored, as both already read it) |
| `minutes: 1e23` | 9007199254740991, with every day-relative field read against that day |
| v1 save with `floor: "2"`, `x: "172"` | read as numbers by the check, reflowed; the office then loads on floor 1, as before |
| v1 save with a structure tile at `x: "172"`, `floor: "2"`, or `width: "4"` | read as numbers, the width as 1 |
| v1 save with a room at `x: "abc"` sorted between an overlapping pair | the overlap is found; the NaN room is not compared |
| v1 save with a two-story room at floor 2^53 | loads (the room is left out of the checks and the reflow) |
| v1 save with an office added at floor 2^52 | the office is left out of the reflow's checks, so the reflow is kept (`nextId` 901) |
| v1 save with a lobby 1000 wide from `x: -100` and floor-2 tiles and an office at columns 300 to 302 | the support envelope counts the lobby as 375 wide, as the floating count does, so the reflow is kept (`nextId` 913) |
| v1 save with a lobby tile 1e8 wide | loads; the checks count the tile as the lot's width, and the loaded tile is 1 wide |
| v1 save with a room at `x: 2^53`, or at `x: 400` and 1e9 wide | loads unreflowed; `deserialize`'s geometry clamp keeps the room, 1 wide at column 374 |
| v1 save with a room at `x: -2^53`, or 2^53 wide | the room is left out of the reflow; loads unreflowed, as the geometry clamp places the room |
| v1 save with a room at `x: -2^51` and 2^51 + 9 wide | the reflow paves only lot columns 0 to 8; loads unreflowed, as the geometry clamp places the room |
| v1 save with `nextId` fractional and well above every id | pads at the floored `nextId` |
| `events.pending.message`: `[1, 2]`, `1e21`, `5` | `""` |
| `null` | refused |
| `1e400` anywhere | TypeScript loads, Rust refuses (EX-3, proposed) |

## Acceptance

1. **#856.** A TypeScript and a Rust test each take a stream one draw before
   state 0, save after the draw, reload, and show the next draws equal the
   uninterrupted stream's, for the main stream and the event stream. A new
   game seeded 0 still starts at state 1. Loader cases `seed-zero`,
   `seed-two-pow-32` and `events-rngstate-zero` pin both engines.
2. **#858.** Each row of the matrix above has at least one loader-table
   case (its other values are in both engines' unit tests), the Rust loader
   test passes with no `knownDivergence` marker left, and each TypeScript
   coercion has a unit test. The two `known-858-*` cases lose their marker
   and their `known-` id. Two rows are the exception: `null`, since a
   refused save in the table would make every loop over it (the Rust test,
   #1238's WASM test) special-case it, so unit tests in both engines and the
   WASM test pin it; and `1e400`, which the JSON table cannot hold (EX-3's
   tests pin it). Every new case hashes differently under the old TypeScript
   loader, so each tests a change, except `legacy-v1-structure-geometry-string`
   and `legacy-v1-x-nan`, which pin the new check reads where the old result
   happened to agree, and `last-vip-nag-day-negative-fraction`, which pins
   the floor both loaders already used (truncation would give -3);
   `legacy-v1-floor-far` and `legacy-v1-x-far`, which the
   old TypeScript loader never finished (the old Rust loader also hangs on
   the first, and loads `legacy-v1-x-far` to the same result as now);
   `legacy-v1-room-off-lot-wide` and `legacy-v1-room-off-lot-left`, which the
   old TypeScript loader loads to the same result only after its paving loop
   reaches the 2^24 `Set` limit and falls back (tens of seconds, or out of
   memory at Node's default heap), and which pin the two edges of the lot
   clamp on the paving (the old Rust loader hangs on both); and the two
   `pending-message-*` cases, whose message the state digest leaves out as
   prose, so the WASM test's canonical saves and the unit tests pin them.
   The paving reads are pinned by `legacy-v1-structure-x-string-paved` and
   `legacy-v1-structure-width-string-paved`, and two reflow rules (a room at
   2^52 floors left out, the support envelope capped at the lot's width) by
   `legacy-v1-room-floor-far-reflowed` and
   `legacy-v1-lobby-wider-than-lot-reflowed`; the old loader hashes all four
   differently, and each reflow case fails with its rule removed in either
   engine.
3. **Real WASM.** The new cases load through `Engine.fromSave` and
   serialize to the TypeScript engine's canonical save (#1238's loop over
   the whole table in `conformanceWasmSaves.integration.test.ts`). A save at
   state 0 reloads at state 0 through WASM and runs on identically in both
   engines for two days (`conformanceWasmLoadFidelity.integration.test.ts`,
   which also pins `null`, the other top-level values and EX-3). Since
   #1332, `Engine.fromSave` reads a current save through the streamed
   reader, so that loop covers it; natively, `loader_cases_load_the_same`
   (`load_stream_tests.rs`) loads all 104 cases through `load_save_text`
   (the streamed reader for the current ones, `deserialize` for the rest)
   and through `deserialize`, with an hour of play, and the Rust unit tests
   check each current save they edit against the streamed reader.
4. **Nothing the game writes moves.** Every existing loader case keeps its
   expected hash, apart from the two former `known-858-*` cases, and
   `conformance/expected.json` keeps every existing scenario's hashes.
5. **EX-3** is in the exception register as proposed, with its size, and a
   Rust test pins the refusal.
6. **Gates.** `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`, `npm run test:wasm`; `cargo fmt --check`,
   `cargo clippy -D warnings`, `cargo test`; the crate patch bump and
   `npm run engine:compat`.
7. **Review.** `/gds-code-review` with the hot-path record; every `patch`
   finding fixed, every `defer` in the backlog with an issue; independent
   review through the coordinator; no auto-merge before it.
8. **Bookkeeping.** Backlog rows `rng-zero-state-reload` and
   `engine-rs-hand-edited-save-fidelity` updated; #856 closes on merge; #858
   closes on merge with EX-3 named as its residue.

## Code map

- `src/engine/rng.ts`, `engine-rs/src/rng.rs`: a restore entry point that
  keeps state 0.
- `src/engine/sim/serialization.ts`, `src/engine/sim/coerce.ts`,
  `src/engine/EventSystem.ts`: the seed and `rngState` restores; rows 1 to
  9, 11, 15 and 18.
- `src/engine/saveMigration.ts`, `src/engine/migrations/v1tov2.ts`: rows 10,
  12, 16 and 17.
- `engine-rs/src/load.rs`: the seed and `rngState` restores, the clamps of
  rows 2, 3, 11 and 15 and row 18 in `assemble`, which both Rust readers end
  with; row 1's clamp in `unit_from_value`, which both use per unit; the
  `null` refusal of row 13 in `deserialize`, where the streamed reader sends
  any text that is not a current save; rows 16 and 17 in
  `migration_looks_valid`, `floating_structure_count` and `reflow_v1_to_v2`,
  which only legacy saves reach, so only through `deserialize`.
- `engine-rs/src/jsmath.rs`: `number_to_string` spells NaN and the
  infinities as JavaScript does, so the tile keys of a NaN or infinite
  coordinate no longer rest on output ryu leaves unspecified.
- Tests: `src/engine/rng.test.ts`, `src/engine/sim/loaderFidelity.test.ts`,
  `engine-rs/src/load_fidelity_tests.rs` (EX-3's Rust pin included; each
  current save also loads through the streamed reader, `read_save` in
  `load_stream.rs`, now visible to the crate's tests, and must match),
  `src/tests/integration/conformanceWasmLoadFidelity.integration.test.ts`
  (listed in `vite.config.ts` and `engine-rs.yml` beside the other
  `conformanceWasm*` tests).
- `src/tests/integration/loaderCases.integration.test.ts`,
  `conformance/loader-cases.json`: the cases.
- `_bmad-output/planning-artifacts/release-3.0-exception-register.md`: EX-3.
- `_bmad-output/implementation-artifacts/backlog.md`: both rows done; the
  deferred row `forged-save-loader-edges` (#1282).
- `engine-rs/Cargo.toml`, both `Cargo.lock` files,
  `engine-rs/src/compat-record.json`: the patch bump.

## Risks

- **A8 conflict.** About twenty small edits in `load.rs`. Mitigation: agreed
  order, exact edit list sent to A8 with the PR.
- **Replay window key.** `engine-rs/` and `src/engine` are in the key, so this
  lands before the freeze, as the plan requires.
- **The TypeScript engine changes for hand-edited saves.** A player who
  hand-edits a save could see a mistyped field read as `false`, `""` or a
  whole number where 2.x kept it. No save the game writes changes, apart
  from #856's save at random state 0. A player can notice both, so the app
  takes a patch bump (2.47.1) with a What's new line for each.
