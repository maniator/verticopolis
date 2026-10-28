---
story: facade-6a-engine-view
status: review
issue: '#1213'
tracking: '#1207'
gate: '#945'
depends_on: facade sign-off (F1 to F9, 2026-10-20 21:40 UTC)
---

# Story 6a: the engine's renderer-facing view (#1213)

Status: review (written before the first commit, 2026-10-20; brought up to date
with the implementation and review rounds 1 and 2, 2026-10-21, and with the
write-site frame marks of round 3, review rounds 3 to 5 and the merge of
#1068, 2026-10-27).

## Story

As the Rust-backed facade (AD-9),
I want the engine to export a versioned view of itself (a structural snapshot,
a per-frame dynamic frame that carries only the rooms that changed, unit
metadata under its own revision, the header facts the HUD needs, the layout's
widths and version, and a tower signature for undo),
so that the renderer, the HUD and undo can read Rust directly, with no
TypeScript `Simulation` kept in step beside it.

## Why

Today the WASM host keeps a TypeScript `Simulation` current from the engine:
every frame decodes every unit record into TypeScript objects, every structural
edit pays a full merge, and undo fingerprints the instance with
`towerStateSig`. Under B (the facade) none of that exists on the healthy path,
so the engine has to answer the reads itself. The architecture review
(`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/ARCHITECTURE-REVIEW.md`,
sections 5.2, 5.5, 5.8, 7 and 9) and the slice plan (row 6a) define what the
view is; this story is the engine half. Slice 7 (`RustSim`) is the TypeScript
consumer and is out of scope here.

## Acceptance criteria

1. **Structural snapshot** (`view::structure_view`, binding `viewStructure()`),
   rebuilt by a reader whenever `tower.revision` moves (and on a new engine,
   since a load starts the revision over). Its header carries the
   revision, the record counts, the highest and lowest floor any unit stands
   on, the game mode and Modern calendar (fixed at founding, read once at
   load or adopt) and the scene seed (`rng.initial_seed`, which slice 3's
   `HeaderView.sceneSeed` reads; fixed for a tower's life). Then every room
   (non-floor, non-lobby unit) as a fixed record (id, kind code, floor, x,
   width) in rooms-index order, which is the slot order the dynamic frame
   uses; then floor and lobby tiles as runs (one
   record per run of same-kind, same-width tiles side by side on one floor
   with identical frame fields, ordered by floor and then x and maximal
   whatever order the tiles were built in, with no ids: a host that needs a
   tile's id asks `unitAt`); then every transport with its
   geometry, car count and skipped floors. It is lossless: a test rebuilds
   every room's id, kind, floor, x and width and every tile's kind, floor, x,
   width and frame fields from it, and checks the floor bounds against the
   tower's.
2. **Dynamic frame** (`view::ViewReader::frame`, binding `viewFrame(full)`):
   the header, the drawn people as fixed 8-slot records (id, seed, staff,
   state, floor, x, fy, wait), the room records whose frame fields changed
   since the last read, addressed by slot, and every transport's cars. The
   reader finds changed rooms in the tower's frame mark log (AC 11) and
   visits only those; it never walks floor or lobby tiles. From half the
   rooms' worth of marks, or when the log dropped marks the reader never
   read, it compares every room once instead, which sends the same rooms.
   A revision change, a unit-count change, another tower (each tower's log
   has its own id) or `full = true` sends every room and sets the header's
   `FULL` flag. There is one reader per engine, so one caller; the header
   numbers its frames (`FRAME_SEQ`, 1 for the first), so a caller can tell
   when something else read a frame in between. The frame is one allocation
   at its exact size.
3. **Structural tiles change only with the revision.** The freshness oracle
   (AC 6) fails if a floor or lobby tile's frame fields change while
   `tower.revision` stays put. If a seeded session ever finds one, this story
   carries a list of changed structural ids instead (none found: see the Dev
   Agent Record).
4. **Unit metadata under its own revision.** Labels and subtypes are written
   through one setter each (`Tower::set_unit_label_at`,
   `Tower::set_unit_subtype`), which bump `tower.meta_revision` and log the
   unit's id only when the value changes. Every engine write site (the
   editor's rename, a move-in's company, gym and clinic names, a vacate, a
   fire, a build's subtype, a churn re-theme) goes through them. `view::meta_since(tower, since)` (binding
   `unitMetaSince(since)`) answers the units changed after `since`, or a full
   listing (every unit whose label differs from its catalog name or that has a
   subtype) when `since` is not a whole number in `1..=meta_revision` or the
   log no longer reaches back that far. Every tower starts at meta revision 1
   with an empty log, so a host that has read nothing (0) gets a full
   listing, the labels and subtypes a save carried included. A source check
   keeps label and subtype writes inside the setters (a new unit's struct
   literal aside, which the loaders build with too).
5. **Header additions.** The frame header carries the meta revision, the meal
   overlay revision, the unlocked kinds as a bitmask by kind code
   (`Simulation::is_unlocked`), the population (`Simulation::population`,
   kept as a running total that each visited room corrects by
   `Unit::census_share`, the rule `Tower::total_population` sums, which a
   test ties to it, so a host reads it at HUD cadence with no walk of its
   own), the room count the slots index, the `FULL` flag and the frame
   number, beside today's clock, money, star, weather, effects, event
   counts, pending choice and hour runs.
6. **View freshness oracle.** Seeded sessions on several towers (a fixture, a
   new game grown by commands, scenario states with fires, guests and
   housekeeping) apply builds, sales, renames, rerolls, transport edits, rent
   edits, fires and ticks of several sizes. After every step, a view kept
   current only by structure-on-revision, incremental frames and incremental
   metadata equals a view rebuilt from scratch (a fresh structure, a full
   frame from a fresh reader and a full metadata listing).
7. **Layout widths and version.** `view::layout` names every slot and width,
   one name per header slot (an effect's floor and x included);
   `VIEW_LAYOUT_VERSION` starts at 1 with a pin table (one hash per version)
   and a completeness test, like the frame layout's in `identity_tests.rs`.
   The binding exports `viewLayout()`: the version, every slot and width by
   name, and the kind keys, catalog names, unit states, person states,
   weather, mode and calendar codes by code, and the fields of a metadata
   record (`metaRecord`). The compat record pins `viewLayoutVersion`, so the
   crate version moves with it.
8. **Tower signature** (`Simulation::tower_signature`, binding
   `towerSignature()`, a `bigint`): a pure fingerprint of the fields the
   tower half of `towerStateSig` reads (each unit's kind, floor, x, label,
   rent, No Rate flag, film policy and subtype; each transport's kind, x,
   span, cars, skipped floors and schedule). Two reads are equal when those
   fields are, whatever was read in between, and differ when they differ but
   for a 64-bit collision. Money stays a value compare beside it, since
   income moves it every tick (an `Object.is` compare, so a NaN equals a
   NaN). A test drives a command corpus (no-op edits and ticks included) and
   checks, step by step, that the signature equals an earlier one exactly
   when a Rust port of `towerStateSig`'s tower half equals that one's string;
   the integration test checks the same against the real `towerStateSig`.
9. **Boundary.** The new binding reads take raw JS values where an argument is
   optional or untrusted: `viewFrame(full)` sends a full frame only for a real
   `true`, and `unitMetaSince(since)` answers a full listing for anything that
   is not a whole number in range (a string, `null`, `NaN`, a fraction, a
   negative or a future revision). An integration test calls the real WASM
   package raw and checks the structure, frame, metadata and signature
   against the TypeScript engine on the same tower, in play.
10. **Nothing else moves.** Conformance, the frame layout, the save format, the
    state view and every hash are unchanged; `frameView` keeps its layout and
    output byte for byte. The crate takes a minor bump with
    `npm run engine:compat`; no app version bump (no player-facing change).
11. **Write-site frame marks** (round 3, #1285 item 1; the owner asked on the
    PR on 2026-10-22 and 2026-10-23 for this, or for a measured decision put
    to him). The engine's own writes of a room's frame fields (state,
    occupants, customersIn, hotelCustomersIn, outForMeal) and of its
    residents, which the census counts, go through one setter per field
    (`view/marks.rs`). A setter logs the unit's index in the tower's mark log
    only when it changes the value. A reader reads the log from where its
    last frame stopped and visits only the rooms it names, so a frame with
    nothing marked visits no room, and it keeps the population current from
    a per-slot census. When the marks it reads reach half the rooms, or it
    fell more than the log's 16,384 entries behind (the log drops its oldest
    entry for each new one past that), it compares every room once instead.
    Each tower's log has its own id, which the reader keys on, so a reader
    handed another tower sends a full frame. The fields stay `pub`, so a
    source scan (`only_the_setters_write_the_frame_fields`, on the code with
    comments removed and whitespace cut to one space between two words, so
    a split statement reads as one) keeps the engine's writes inside the
    setters, a new unit's struct literal and `load.rs`'s fill of a new
    tower's list aside; the oracle (AC 6) checks the kept rooms and the kept
    population after every step; and tests show that a field written past
    the setters is not sent until a full frame or a frame that compares
    every room, which proves a frame below half the rooms reads only the
    log. A native host that writes a unit's fields itself passes
    `full` on its next frame (API.md).

## Tasks

- [x] Story file (this file) before the first commit.
- [x] `frame.rs`: the state, weather and transport encoders as
      `pub(crate)` helpers after `frame_view`, for the view; `frame_view`
      keeps its own body (round 1 put it back to its base text) and no
      `pub const` is added (the frame layout table stays as it is).
- [x] `engine-rs/src/view/`: `mod.rs` (state hung on `Tower`), `layout.rs`,
      `structure.rs`, `reader.rs`, `meta.rs` (setters, log, listing),
      `signature.rs`, and `*_tests.rs` beside them (the seeded sessions in
      `session_tests.rs`, the oracle in `oracle_tests.rs`).
- [x] `tower.rs`: two fields (`meta_revision`, the view state); `set_label`
      moves into `view/meta.rs` beside the setter it now calls.
- [x] Route the label and subtype writes in `churn.rs`, `events.rs` and
      `build.rs` through the setters (one line each).
- [x] One `#[wasm_bindgen]` block in `wasm.rs` after the other bindings
      (the facade lane asked for it there) and just before 6b's block
      (#1321, merged first, with its place left after this one):
      `viewLayout`, `viewStructure`, `viewFrame`, `unitMetaSince`,
      `towerSignature`.
- [x] `src/dualrun/engine.d.ts` (regenerated: lines added only, at the
      places wasm-bindgen sorts them; the exports' notes are plain comments
      in `wasm.rs`, so it gains signatures only), `binding.ts`,
      `exportTiers.ts`.
- [x] Compat record: `viewLayoutVersion` in `src/build/engineCompat.ts` and the
      Rust record test; the crate takes the next free minor in `Cargo.toml`
      and both lock files, 0.10.0 since the merge of #1068 (6d took 0.4.0,
      #1231 0.4.1, #1233 0.5.0, #1256 0.7.0, 6b and #1321 0.8.0, and #1068
      0.9.0, each merged first);
      `npm run engine:compat`.
- [x] `src/tests/integration/engineView.integration.test.ts` on the real WASM
      package, listed in `npm run test:wasm`. It starts its own engine, so
      the `integrationWasm` project leaves it to the TypeScript side
      (`vite.config.ts`), as it does the panel getter suites.
- [x] Consumer crate: `read_view` in `engine-rs/consumer/src/lib.rs`, run by
      its smoke test; `engine-rs/tests/api.rs` names the view items.
- [x] Docs: `engine-rs/API.md` row, CONTRIBUTING's version list.
- [x] Gates: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`
      (all features), `npm run typecheck`, `lint`, `test`, `build`,
      `npm run wasm:build` (`RUSTUP_TOOLCHAIN=1.97.0`) and `npm run test:wasm`.
- [x] `/gds-code-review` round 1 with the Hot-Path Auditor; its patch
      findings fixed (see the review section below).
- [x] Round 2 on the fixed diff; every defer in the backlog with an issue
      (see the round 2 section below). Its HP-1 to HP-12 record on the PR
      covered chunk C; the round 3 record carries chunks A and B's items
      (A2-1, A2-2, B6).
- [x] Write-site frame marks (AC 11): `view/marks.rs` (the setters and the
      log), the reader on the log, the setter calls at the write sites (51
      in 14 files at round 4, `sync_attendance_occupants` among them), the
      source check and tests (`view/marks_tests.rs`,
      `view/marks_guard_tests.rs`), and the oracle's kept population.
- [x] Round 3 review on the marks; its patch findings fixed and its
      defers filed (see the round 3 review section below).
- [x] Round 4, the confirming pass; its patch findings fixed and its
      defers filed (see the round 4 review section below).
- [x] Round 5 on round 4's fixes; its patch findings fixed and its defers
      filed (see the round 5 review section below); main merged again
      (#1298, #1325, then #1332).
- [ ] The round 3 to 5 HP-1 to HP-12 records on the PR; a confirming pass
      on round 5's fixes and the merge; the independent review; the owner's
      human review and his call on the deferrals of B6 and H5-2 (no
      automatic merge).

## Dev notes

### Files and owners (parallel map, 2026-10-20 22:50 UTC)

6a owns the new `engine-rs/src/view/`, `frame.rs` and the label and subtype
setters. `wasm.rs` and `engine.d.ts` are append-only: 6a adds one block at the
end of the bindings in `wasm.rs` (6b's block follows it) and does not
change the `Engine` struct or its constructors
(slice 13 edits `from_save` and `from_vctower`). That is why the reader's
state hangs on `Tower` (initialized in `Tower::new`, which every load goes
through) instead of on `Engine`. Not touched: `tower_index.rs`, `sim.rs`
reachability, the load path (slice 13's), `src/simport/` (the facade
thread's), `src/wasmhost/` (Runtime's). Round 1 added one-line setter calls in `churn.rs`, `events.rs` and `build.rs`; round 3's
frame marks route the frame field writes through setters in `build.rs`,
`churn.rs`, `economy.rs`, `events.rs`, `housekeeping.rs`, `presence.rs`,
`satisfaction.rs`, `services.rs`, `sim_loop.rs` and `crowd/` (`motion.rs`,
`routines.rs`, `spawn.rs`, `visits.rs`), one or two lines a site, several
of them in the step-hotspot lanes' files, so a conflict there is a line or
two. `syncAttendanceOccupants` moves to `view/marks.rs` beside its setter
(round 4); #1298 had moved main's unmarked copy from `tower_query.rs` to
`tower_query_state.rs`, and the merge of main in round 5 drops that copy.

6b's getters (#1228) merged first, and its `wasm.rs` wrappers (#1321) after
them, in their own block after this one's place. Its getters read
labels and subtypes live, so they need no key on `tower.meta_revision`.

### Current state of what changes

- `frame_view` (`frame.rs`) writes the header, every person with its route,
  every unit's six slots and every transport's cars. The view writes the
  same codes with its own copies of those encoders, which
  `view/frame_tests.rs` holds to `frame_view`'s on every unit state, person
  state and weather and after every oracle step; `frame_view`'s body and
  output do not change (`frame_tests.rs` and the frame layout pin hold it).
- `Tower::set_label` (the editor's rename) returns `false` only for an unknown
  id, and `true` even when the name is unchanged. It keeps that contract.
- Label writes today: `tower.rs` `set_label`, `churn.rs` (vacate and the
  office, gym and clinic move-ins), `events.rs` `gut`; `place` initializes a
  new unit with its catalog name, and the loader reads the save's. Subtype
  writes: `build.rs` (a new unit's draw) and `churn.rs` `reroll_subtype`
  (which also bumps the meal overlay revision, kept).
- `room_index()` (`tower_index.rs`) is keyed on `(revision, units.len())`; the
  reader keys its cache the same way, so its slots are the index's positions.

### Layout v1

Dynamic frame: a 32-slot header, one name per slot (minutes, tower revision,
meta revision, meal overlay revision, log sequence, money, star, unlocked
mask, population, weather, the Santa, explosion, thief, treasure and VIP
effects slot by slot, event counts, pending choice, hour runs, room count,
full flag, frame number, then the people, unit and transport counts), then
`people` records of 8, then `units` records of 6 (slot, state, occupants,
customersIn, hotelCustomersIn, outForMeal; -1 for an absent counter), then
`transports` records of `2 + 3 * cars` as in `frameView`. Codes are
`frameView`'s.

Structure: a 9-slot header (revision, rooms, runs, shafts, highest floor,
lowest floor, mode, calendar, scene seed), rooms of 5 (id, kind, floor, x, width), runs
of 10 (kind, floor, x, width, count, then the five frame fields every tile in
the run shares; no ids), shafts of `8 + skips` (id, kind, x, width, bottom,
top, cars, skip count, then the skipped floors). Runs are ordered by floor and
then x and are maximal: two runs that touch with the same kind, width and
fields are one. A host that needs a tile's id asks `unitAt(floor, x)`.

Metadata: JSON `{ "revision", "full", "units": [[id, label, subtype or
null], ...] }`, the record's fields named by `metaRecord`. A unit absent
from a full listing has its catalog name and no subtype; an incremental
answer lists every unit changed since `since` that still exists, with its
current values.

### Hot paths (HP record goes on the PR)

- `viewFrame`: per frame. It visits the rooms the mark log names since the
  reader's last frame (k marks: a sort and dedup of k indices and a binary
  search of the rooms index for each, so O(k log k + k log R)), and no other
  room; people and cars as `frameView` sends them; one allocation at the
  exact size. No walk over floor and lobby tiles. When the marks reach half
  the rooms (an hour can mark nearly every room), or the log dropped marks
  the reader had not read, the frame compares every room once instead
  (O(R), which from about half the rooms costs less than the marks). A full
  frame (a revision move, a unit-count change, another tower's reader,
  `full = true`) is one pass over rooms
  (R = 2,900 on large), at most one per frame. That pass is a
  revision-keyed cache rebuild, the per-command tier of section 2: the
  rooms index and the structure each rebuild in O(U) on the same frame, and
  U is 15 times R on large.
- `viewStructure`: per revision change, and on a new engine. One pass over
  units for the runs (with an open run per floor, so a tile extends its
  floor's run whatever was built between) and one over rooms; a stable sort
  of the runs when they come out of order, and always a join of the runs
  that continue each other. Both are over the runs, about one per drag, and
  leave the tiles alone. A unit list scattered into more raw runs than two
  fifths of its units (4,096 at the least) is read off a floor-by-x grid
  instead, in one more pass over the units, so the sort stays bounded; no
  reference save comes near it (1,132 raw runs at most). The floor bounds
  come from the tower's per-revision cache (`Tower::floor_bounds`, #1237),
  which the panel getters share. One allocation at the exact size.
- `unitMetaSince`: per frame only when the meta revision moved; answers from
  the log by binary search. A full listing is one pass over units (load, or a
  reader that fell behind the log's cap).
- `towerSignature`: per command (undo's capture and commit), one pass over
  units and transports with a word-at-a-time hash, too slow to read each
  frame.
- Setters: O(1) plus the log push; the metadata log is capped and trimmed
  by halves. The frame field setters compare the old value first and push
  only on a change; their log holds at most 16,384 indices (64 KiB) in a
  ring and drops its oldest index for each new one past that, so a push is
  O(1) every time, and a reader the drop left behind compares every room
  once.

### Out of scope

The TypeScript view, `RustSim`, the port's undo wiring (slices 1, 5 and 7),
panel getters (6b), diagnostics facts (6c), command gaps (6d), the worker
adapter (12).

### Project context rules

American English, no em-dashes, no AI marketing words; the 500-line ceiling on
new files (`fileSize.guard.test.ts`); `rustProse.guard.test.ts`; the engine
stays free of host access (`independence.rs`) and `wasm_bindgen` stays in
`wasm.rs`; merge commits only; no automatic merge (the owner asked for a
human review on the PR); no closing keyword before #868 or #954.

### References

- Architecture review sections 5.2 (the view), 5.5 (undo's signature), 5.8 (Rust
  independence), 7 (the freshness test), 9 (design HP record).
- Slice plan row 6a; parallel map (`/mnt/project-files/release-3.0/rust-facade/parallel-map.md`).
- Spike 0 (#1196, `9be319b`): `frameDynamicProto`, measurement only.
- `docs/performance/hot-path-review.md`; CONTRIBUTING, "The engine crate version".

## Dev Agent Record

### Agent Model Used

Opus 5.5, extra high effort.

### Completion Notes List

- AC 3: no structural tile's frame fields changed with the revision still in
  any seeded session, so the structure carries the tiles' fields and the
  frame never walks them. The loader normalizes floor and lobby tiles (state
  empty, no occupants, no counters), which is why.
- AC 6: one oracle test (`oracle_tests.rs`) runs seven starts (a new Modern
  game the session grows by its own commands, the medium fixture, the
  owner's split tower, two Modern fixtures with a hotel and a pending VIP, a
  four-star fixture, and the events scenario at its fire) through seeded
  sessions of 24 kinds of step (`session_tests.rs`), checking after every
  step. Floor and lobby drags go rightward and leftward. The last run, on
  1,110 checks, saw the revision move on 76, the signature on 121 and the
  meta revision on 50, with 175 incremental frames that sent rooms; the test
  asserts floors on those counts so a session that stops exercising a path
  fails. It also checks that every structure's runs are maximal and that a
  full frame's people, rooms and transports are `frameView`'s, and a
  separate test reverses the unit list, orders it by column, and lays one
  floor as two drags that meet, and gets the same runs.
- AC 8: the signature is checked against `ts_sig`, a Rust port of
  `towerStateSig`'s tower half (`signature_tests.rs`), on every oracle step:
  equal strings give equal signatures and a new string a new signature. The
  corpus's labels hold none of the string's `:` or `;` separators; with
  them the string can run two states together that the signature keeps
  apart, so there the signature can see a change the string would not. The
  integration test checks it against the real `towerStateSig` over renames,
  a name put back, rent, No Rate, cars, play and a sale.
- The facade lane asked (2026-10-21) for the mode and calendar in the view,
  for rooms and runs to stay separately addressable (#1253), for the floor
  bounds to come from the structure, and for the population to need no walk
  of its own. All four are in the structure header or the frame header, and
  slice 3's scene seed (round 4) is in the structure header too.
- Debug-build cost: `fromSave` of a 13k-unit fixture is about 3 s in a debug
  test, so the unit tests use the small scenario tower and the oracle loads
  fixtures once per start.
- Native release timings on this container after the first review round
  (indicative only; the PC is the source of record): `viewStructure` 0.30 ms
  medium, 0.88 ms large; `viewFrame` 14 to 15 us medium and 35 to 47 us large,
  against `frameView`'s 209 us and 921 us; `towerSignature` 0.29 ms medium,
  1.19 ms large (the TypeScript `towerStateSig` it stands in for took 12.4 ms
  on large in the review's measurement).
- After the marks (round 3, same container, paired against the round 2
  commit; indicative only): `viewFrame` with nothing changed went from
  17.9 us to 0.5 us on medium and from 35.3 us to 0.6 us on large, and the
  frame after one 2-minute step (19 changed rooms on average on large) from
  36.8 us to 1.7 us. A full frame is 9.5 us medium and 25.5 us large. The
  step itself is unchanged: under callgrind, 750 steps took 1,290.5M
  instructions before and 1,289.5M after on medium, and 1,633.2M and
  1,634.5M on large (within 0.1%); the setters skip a write that changes
  nothing.
- After the round 3 review's fixes (callgrind on the frames alone, a game
  day of 2-minute frames on large): 6.2M instructions against 182.6M for
  the round 2 reader, and the frame after an hour that marks 2,886 of the
  2,900 rooms 489K against 457K (the compare it takes from half the rooms;
  875K before the threshold). Wall, best of 5: that frame 58 to 62 us
  against 83 to 91 us before the threshold. Every frame of the day hashes
  the same as the round 2 reader's (an FNV hash over every slot but the
  clock).
- Conformance, the frame layout pin, the save format, the state view and the
  digests are unchanged: the conformance runner passes, the frame layout pin
  in `identity_tests.rs` holds, and `engine-rs/src/frame_tests.rs` (which
  checks `frameView`'s output) passes untouched.

### Review round 1 (2026-10-21)

`/gds-code-review` ran with the Blind Hunter, the Edge Case Hunter, the
Acceptance Auditor and the Hot-Path Auditor. Its patch findings, all fixed in
this PR:

- The runs depended on the unit list's order: a floor built in pieces gave a
  run per piece. The walk now keeps an open run per floor, then sorts the
  runs when they come out of order and joins the ones that continue each
  other (round 2 found the join skipped when the runs came out in order; it
  now always runs).
- The frame was built in two allocations with a copy between; it is now one
  allocation at its exact size, with the population summed in the room pass.
- `frameView`'s body had been rewritten to call the shared encoders; it is
  back to its base text, and tests check that the encoders agree with it.
- The change counter compared each read with the previous read, so a reader
  between undo's capture and commit could hide a change, and two hosts
  reading it would disagree. It is now the tower signature, a pure function
  of the tower.
- A load started the meta revision at 0, the value a host sends when it has
  read nothing, so a host could miss the save's labels; every tower now
  starts at 1.
- The frame had no way to say a frame was skipped; the header now numbers
  them.
- Some header slots were named by group (an effect's seq, floor and x under
  one name); every slot now has its own name, and `metaRecord` names the
  metadata record's fields.
- The integration test now reads a tower in play (people, cars, a changed
  room, metadata moved by play) and checks the signature against the real
  `towerStateSig`.

Its defer findings are filed: #1285 (backlog row `facade-view-followups`)
held the write-site dirty marks (round 3 did them in this PR, AC 11), the coalesced structure refresh for slices 2 and 7,
and the fire and bomb walks beside #1158 A16; #1170 item T1 holds the
TypeScript per-frame population sum; #1257 item 3 already held the buy-back
rebuild in `vacate`. The HP-8 table gains rows for the reader's last-sent
room fields and the meta revision and log.

After the rebase on #1237, which added a per-revision floor bounds cache
(`Tower::floor_bounds`), the structure reads its bounds from that cache
instead of folding them in its own walk (HP-8).

### Review round 2 (2026-10-21)

The second `/gds-code-review` pass, on the round 1 fixes, found these patch
findings, all fixed in this PR:

- The join of runs that continue each other ran only when the runs came out
  of order, so a run grown left up to the run before it (or tiles on a floor
  off the grid) stayed split. The join now always runs; the sort runs only
  when the runs are out of order.
- A unit list scattered badly enough could give tens of thousands of raw
  runs to sort (Hot-Path Auditor A2-1). Past 4,096 raw runs the walk now
  reads the runs off a dense floor-by-x grid of the tiles instead, in one
  more pass over the units.
- The oracle now checks the mode and calendar slots by name, the run order
  strictly, and the view's encoders against `frameView` after every step and
  on every unit state, person state and weather. The corpus gained a new
  Modern game grown by its own commands, and drags in both directions.
- The metadata source check now catches compound writes and mutable borrows
  of a label or subtype.
- The integration test checks the structure in play.
- The signature, `meta_since`, API and story docs said more than the code
  guarantees; they were corrected.

Its defer findings: A2-2 (a cold structure read makes three passes over the
units, since the rooms index and the floor bounds each miss their cache on a
revision's first read) is #1285 item 4. B6 (every revision move resends every
room) stays a full frame, one pass over rooms per revision move and at most
one per frame; a rooms-only revision that would spare a tile drag the resend
is noted in #1285. B1, the per-frame compare over every room, waited on the
owner's decision; round 3 removed it.

### Round 3: write-site frame marks (2026-10-27)

On 2026-10-22 and 2026-10-23 the owner asked on the PR for the write-site
dirty marks, or for a measured decision with its tradeoffs, instead of an
unbounded per-frame room compare. This round does the marks (AC 11), so a
frame visits only the rooms that changed. One pass over the rooms remains
outside that: the full frame after a revision move (B6), which a floor or
lobby drag makes once per frame while it moves. The checklist counts it per
command, beside the O(U) rooms index and structure rebuilds on the same
frame; #1285 item 2 holds the rooms-only revision that would drop it, and
the PR puts it to the owner's review with its numbers.

- `view/marks.rs` holds one setter per frame field and for the residents.
  Each takes a `Mark` (the tower's mark log and the unit's index) and logs the
  index only when it changes the value. `Tower::marked`,
  `Tower::marked_units` and `Tower::marked_by_id` hand out a unit with its
  mark, so a write site never pairs them by hand.
- The log holds unit indices, which move only with `tower.revision` (a
  removal shifts the list and `reindex` rebuilds it), and a moved revision
  makes a reader's next frame full, so no index logged before a move is read
  against the list after it.
- The reader keeps its place in the log, a per-slot census and the running
  population. A frame sorts and dedups the indices it reads, finds each in the
  rooms index by binary search, and compares and sends only those rooms. A
  repeat change after a read is logged again (an earlier draft skipped an
  entry equal to the newest one, which a reader could already have passed;
  the oracle caught it, and `a_change_after_a_read_is_sent` holds it).
- Every engine write of those fields (51 setter calls in 14 files) goes
  through the setters, and `only_the_setters_write_the_frame_fields` fails
  on a direct write anywhere else outside tests (the loaders included).
- The oracle also checks the kept frame's population against the tower
  after every step.

### Review round 3 (2026-10-27)

`/gds-code-review` ran on the marks at `c383cf30` with the Blind Hunter,
the Edge Case Hunter, the Acceptance Auditor and the Hot-Path Auditor. Its
patch findings, all fixed in this PR:

- A reader handed another tower's log, or a position past the log's end,
  read "nothing changed". Each log now has its own id, which the reader
  keys on beside the revision and the unit count, and a position the log
  cannot answer makes the frame compare every room.
- No test proved that a frame reads the log: the round 2 compare passed
  every test. `a_frame_visits_only_the_marked_rooms` now writes a room past
  the setters and checks it stays unsent until a full frame, and the
  fallen-behind test uses a third room whose only mark the log dropped.
  Each fails on the change it guards (a compare on every frame; a read from
  the log's oldest entry). The readers test compares the whole kept table
  with a fresh read, and all six setters are tested, residents and
  hotelCustomersIn end to end.
- The source check read one line at a time, missed split statements,
  `ref mut` bindings, compound operators, mutating methods, destructuring
  and whole-unit writes, and exempted every person `state` write, `rng.rs`
  and the loaders wholesale. A shared scanner (`source_scan_tests.rs`) now
  reads the code with comments and whitespace removed and finds all of
  these, for the frame fields (`marks_guard_tests.rs`) and for labels and
  subtypes (`meta_tests.rs`). Its exemptions are a person's `state` (by
  receiver or a `PState` value), the RNG's own `state` and the satisfaction
  pass's local copy, and the loaders are scanned. A test destructures every
  `Unit` field, so a new field fails to compile until it is sorted into
  what the frame and the census read or not.
- The census rule was copied from `total_population`; both now call
  `Unit::census_share` (round 4 gave `total_population` back its body on
  main, and round 5 ties the two with a test), and the attendance rule is
  `Unit::attendance_occupants`. Write sites paired a mark with a unit by
  hand; `Tower::marked` and `Tower::marked_units` hand them out together.
- A frame after an hour that marks nearly every room cost more on the marks
  than the compare it replaced (Hot-Path Auditor H3-1: 875K instructions
  against 457K for 2,886 marks on 2,900 rooms). From half the rooms' worth
  of marks the frame now compares every room (`compare_all`), 489K on that
  frame, and `marks_from_half_the_rooms_compare_every_room` pins the
  threshold from both sides.
- The log trimmed its older half when full, so a reader could fall back
  after about 8,192 marks, half what the docs said. It is now a ring that
  drops its oldest index for each new one past 16,384, an O(1) push every
  time.
- `RUN_LIMIT` sent a large tower to the grid well before the sort would
  cost more (H3-2: on large the grid wins only past about 29,000 raw runs).
  The limit is now half the units, 4,096 at the least, and its doc carries
  the measured crossovers. `a_tile_off_the_grid_falls_back_to_the_walk`
  covers the walk with no limit.
- A `continue` in a `match` arm in `presence.rs` would skip a statement
  added after it; the match now yields the new count.
- Docs: the engine's own writes go through the setters (the fields stay
  `pub`); the cap; k counts marks; the signature's collision caveat; the
  structure's stacked-tile notes; AC 5, the files-and-owners notes and the
  project context rules.

Its defer findings, each with an issue: H3-3 (the hotel and condo passes
walk every unit where the rooms index answers) is #1158 A35; H3-5 (`by_id`
hashes with SipHash under the per-person multiplier) is #1158 A36; H3-4 is
#1173 F1; H3-7 is the #1158 items it names; H3-8 leaves B6 and A2-2 in
#1285 items 2 and 4 and B3 in #1170 T1; the Blind Hunter's frames that
compare every room with nothing to count them are #1285 item 5. Not
deferred: H3-6 (two copies of the rooms index per hour, about 5,800 visits)
is inside the hourly budget. B6, the full frame on a revision move, is left
for the owner's review (see the round 3 notes above): it is one pass
over the rooms per revision move, a revision-keyed rebuild of the
per-command tier, on the same frame as the rooms index and structure
rebuilds that each cost O(U).

The native API changed: `Unit::sync_attendance_occupants` is crate-private
and takes a mark, `Unit::census_share` and `Unit::attendance_occupants` are
new public reads, and `FrameMarks` and `Mark` are crate-private. The
JavaScript binding is unchanged.

Parity: the conformance runner passes every scenario on the fix commit
(`b42a222b`) and its merge with main (`5f9bec1b`), and the frame layout pin
holds. The Hot-Path Auditor found every frame of a game day byte-identical
between the round 2 and round 3 readers at `c383cf30` on medium, large and
the owner's save at 2-minute, 6-minute and 4 x 20-minute steps, with money
and population identical after 780 steps; the large game day hashed the
same again after the fixes, and round 4 found all three saves
byte-identical again at `3ec56f8b`; round 5 found the frames
byte-identical again at `2ea5c05d` (round 4's fixes) and the structure
identical apart from the new seed slot, on all three saves.

Coordination: slice 3 (#1210, PR #1317) reads the person's discrete floor,
which the frame's person record already carries (`person::FLOOR`, slot 4),
so the layout did not change for that; its `HeaderView.sceneSeed` added the
structure header's seed slot in round 4. Spike #1196 was not cherry-picked: the
view is written from AD-9 in this PR, and the spike stays measurement-only.

### Review round 4 (2026-10-27)

The confirming pass ran `/gds-code-review` on `3ec56f8b` (round 3's fixes,
the merge of main and the backlog) with the same four layers. Its patch
findings, fixed in this PR:

- The source scan read `let Unit {` as no pattern (the squeeze joins it to
  `letUnit{`), keyed the crowd's person `state` exemption on the receiver's
  name, so a room's state written through a unit named `p` passed, cut lines
  at `//` inside strings, dropped everything after the first inline test
  module, and missed tuple destructuring assignments, `clone_from`, a
  reorder of the list or an assignment to it, a new unit written through a
  reference (`*u = Unit::..`, a match arm), `let`-`else`, casts, `&raw mut`
  and the `as_mut_slice` and `get_mut` methods. The scan now lexes comments
  and string, raw string and character literals, cuts an inline test module
  by its braces, keeps its whole-unit half in `unit_scan_tests.rs`, and
  exempts a person's `state` by the value assigned (a `PState` variant, or an
  `if` whose every branch is one). The metadata guard counts whole-unit
  writes too. Its one new exemption is the loader's assignment of a new
  tower's list (`load.rs` fills a tower it has just made, with its own log).
- The read test of the frame fields named every field but did not make a new
  one sorted: each unmarked field is now bound by name and changed through
  its binding (an unused binding fails clippy), and the test checks that the
  fields it leaves alone are exactly the six marked ones and the kind. The
  kind has its own guard: no engine code writes it in place.
- No test showed that a frame moves the reader's place in the log, after the
  marks or after a compare of every room
  (`a_frame_moves_the_reader_past_what_it_read`). The readers test now checks
  that the late reader read the log. The other-tower test parted the logs
  with a tick that could also move the revision; a setter call does it now.
  Nothing read a wrapped log incrementally
  (`a_wrapped_log_still_answers_a_reader_in_step`) or a position past its
  end (`a_position_past_the_end_reads_nothing`), and the grid's shared-cell
  fallback had no test (`stacked_tiles_fall_back_to_the_walk`). The
  threshold test told `>=` from `>` only on an even room count;
  `compare_all` is now checked at both parities.
- A frame past the threshold copied every unread mark before it chose to
  compare every room. `FrameMarks::unread` gives the count first (the
  Blind Hunter's finding 14, the Hot-Path Auditor's H4-1 option).
- `run_limit` at half the units missed medium's measured crossover. It is
  two fifths: 4,824 on medium, inside that crossover, and 17,343 on large, a
  compromise its doc states.
- Slice 3 (#1210) reads `HeaderView.sceneSeed`, which its story says 6a's
  structure header carries. The header gains `SCENE_SEED`
  (`rng.initial_seed`). Layout version 1 has not merged, so its pin is
  replaced in place and the version stays 1.
- `tower_query.rs`, which sits on the size ratchet, no longer grows:
  `census_share`, `attendance_occupants` and `sync_attendance_occupants` sit
  in `view/marks.rs` beside the setters, and `total_population` keeps the
  body it has on main.
- Docs: the stale test-file names, the loader described as building units
  from struct literals, `tower_query.rs` out of the "Not touched" list, the
  setter-call count, H3-6 listed apart from the deferrals, the
  `unitMetaSince` doc's "no argument", AC 1 and 2, the API row, the place
  of the `wasm.rs` block.

Dismissed: what H4-1 leaves just below the threshold (a sort and a binary
search per mark, up to 1.2 times the compare's cost on two frames a game
day), since the frame scales with what changed as HP-2 asks; and the `u32`
narrowing in `note` (a unit index stays far below 2^32).

Deferred, each with an issue: a whole unit written through a `&mut Unit`
binding from another value (the Edge Case Hunter's finding 3) is #1285
item 6, which would make the frame fields private to their setters; H4-3
(the walk before the grid's pass) is #1285 item 4 with round 4's figures;
H4-2 (`total_population` twice per step, 7.26% of the large bare step) is
#1158 A10 with its measurement, and #1298 merged its dispatch half. This PR
leaves that function and its per-step callers unchanged. H4-4's inherited
costs are by reference as in round 3. B6 stays for the owner's review.

### Review round 5 (2026-10-27)

The pass ran `/gds-code-review` on `2ea5c05d` (round 4's fixes) with the same
four layers. `main` then moved to `035231a6` (#1298), whose new
`tower_query_state.rs` carries `sync_attendance_occupants`; this PR keeps that
method in `view/marks.rs` behind a mark, so the merge drops the copy in
`tower_query_state.rs`. A second merge, at `c0787c1f`, brought #1332's
streamed loader: the loader's one list assignment now sits in `assemble`,
which both readers end with, and the exemption's test follows it. Its patch
findings, fixed in this PR:

- The source scan still missed spellings of the writes it guards, each layer
  with its own list. The rules changed shape instead of growing a case at a
  time:
  - The lexer keeps one space between two identifier characters, so
    keywords stay words (`let Unit {`, `ref mut n`, `&raw mut x`), reads C
    raw strings, and joins the code around a removed inline test module
    without gluing two words together. It moved to `lexer_tests.rs`, with a
    test of each.
  - A method call on a guarded field is a write unless the method is on a
    read list (`READS` for the frame fields, `META_READS` for the label and
    subtype), so a `&mut self` method nobody listed fails the test instead
    of passing it. The kind is written by `clone_from` and the `*_assign`
    operators only, and a test checks that `impl Kind` has no `&mut self`
    method.
  - A borrow is `&mut`, `&raw mut` or `addr_of_mut!` of a place that may
    hold parentheses, indexing or `?`; `write!` and `writeln!` write their
    first argument; an index after a field (`u.label[..1]`) is read past;
    array and struct destructuring assignments count as tuple ones did.
  - The whole-unit half: a struct pattern whose fields end in `..` is a
    pattern wherever it stands (nested, after a match guard, in a
    parameter); `Self` counts inside `impl Unit`; a new unit assigned
    through any dereferenced place
    (`*self.units.get_mut(i).unwrap() = Unit::default()`) is caught, as are
    a reorder of a slice of the list, a mutable borrow of the list or a range
    of it, and a `swap`, `replace` or `take` of a unit in it. A field pattern
    binds when it is a bare name or holds a binding anywhere in it
    (`state: s @ UnitState::Fire`).
- The exemptions went by name. The loader's covers only
  `sim.tower.units = units;` (`the_loader_fills_only_a_new_tower`),
  satisfaction's needs the local copy it probes
  (`let mut probe = ... .clone();`), and the crowd's person state takes a
  `PState` value on any path, or an `if` (with a final `else`) or `match`
  whose every branch is one. A case under a `crowd/` path pins that a room's
  state written there still counts.
- Table cases that could not fail on the branch they were added for now bind
  renamed fields, and the tables moved to `write_cases_tests.rs`. Each new
  rule was then removed or weakened in turn, 44 mutations in all, and each
  fails a test. The first run left three alive: two rules gained cases (a
  nested destructure, the loader's receiver), and the third, a skip of
  `impl Unit {` in the pattern half, was dropped: the engine passes without
  it, and a misread there could only fail the test, never pass a write.
- The census test's check of its own source accepted `..` and `name: _x`. It
  now takes a bare name or `name: _` only, checks that every named field is
  written, and its probes derive from the old values.
- `read_since` is built on `unread`, so the two cannot disagree on a dropped
  log. The wrapped-log test records its start before it writes and asserts
  the refusal one past the cap; the readers test bumps its marks through
  setters.
- New tests: the header's scene seed (`the_header_carries_the_scene_seed`),
  the census share summing to the population
  (`the_census_share_sums_to_the_population`), and the grid's in-order
  check (`grid_reads`) in the stacked-tiles test.
- Docs: `run_limit` states the crossovers it relies on, `compare_all` gives
  both measured frames, the layout pin notes that version 1 was pinned again
  before it merged, the `unitMetaSince` doc names the raw `since` values that
  get a full listing, `structure_view` lists the scene seed, and the story's
  status, layout, hot paths, census note, parity and file list are current.

Dismissed: a read-only destructure (`let Unit { occupants, .. } = &u`)
counts as a write, since the scan cannot see the scrutinee's type; the scan's
doc says so and asks for the field by name. The two-fifths ratio has no test
of its own: it is a tuning value, and its doc carries the measurements.

Deferred: `*u = other` stays #1285 item 6, which now names a newtype or
setters inside the tower module, kind included. H5-1 (`total_population`
twice per step) is #1158 A10: #1298 merged the dispatch half, and the spawn
step's pass remains. H5-3's inherited costs are by reference as before.
H5-2 is code this PR rewrites: past `run_limit` a structure read walks up to
U and then the grid, about 128,000 visits on large against the per-command
allowance of 50,000, though the rewrite lowers the worst read on all three
saves. With B6 (a revision move resends every room) it waits on the owner's
acceptance of the deferral to #1285 items 4 and 2.

### Merge of main with #1068 (2026-10-27)

For the owner's PR stack, the branch took `main` with #1068's save delta.
`save_delta.rs` lends the unit list out of the tower to serialize the rest of
a save and puts it straight back (`let units = std::mem::take(&mut
sim.tower.units);`, then `sim.tower.units = units;`), which three guards read
as list writes. The list half sets that pair aside (`lent`): the binding is
not `mut`, its name is not used in between, the place is a plain path and the
same in both statements, and both sit in one function, so the units that go
back are the ones taken and the count is unchanged. A case covers each
condition. `src/dualrun/engine.d.ts` would have reached 505 lines, over the
500-line ceiling, with slices 6c and 2 still to add theirs; the six exports'
notes are plain comments in `wasm.rs` now, which wasm-bindgen does not copy,
so the file gains the signatures and one blank line (470 lines). The crate
takes 0.10.0. CI's `integrationWasm` job had run the engine view suite with
its TypeScript `Simulation` on the engine's mirror, whose tower revision
counts differently, so that project now leaves the suite to the TypeScript
side. Review round 6's fixes wait until after the PC run, by the owner's
order.

### Departures from the architecture

- People go as interleaved 8-slot records, the shape `frameView` already
  uses, where the review sketched one array per field. The host decodes one
  record per person either way, and the layout names every slot.
- Undo's signature is a pure fingerprint where the review named a change
  counter: a counter has to remember its last read, which breaks when two
  callers read it. It still covers exactly the tower half of
  `towerStateSig`, and money stays beside it.
- `wasm.rs` was not split into `src/wasm/` first: the parallel map has every
  lane appending blocks to it this week, and a split would conflict with all
  of them. The view's block is one-line wrappers.

### File List

New:

- `_bmad-output/implementation-artifacts/story-facade-6a-engine-view.md`
- `engine-rs/src/view/mod.rs`, `layout.rs`, `structure.rs`, `reader.rs`,
  `meta.rs`, `marks.rs`, `signature.rs`
- `engine-rs/src/view/layout_tests.rs`, `frame_tests.rs`,
  `lexer_tests.rs`, `marks_tests.rs`, `marks_guard_tests.rs`,
  `meta_tests.rs`, `signature_tests.rs`, `oracle_tests.rs`,
  `session_tests.rs`, `source_scan_tests.rs`, `structure_tests.rs`,
  `unit_scan_tests.rs`, `write_cases_tests.rs`
- `src/tests/integration/engineView.integration.test.ts`

Changed:

- `engine-rs/src/frame.rs` (the view's copies of the frame's encoders), `tower.rs` (view state, meta
  revision), `build.rs`, `churn.rs`, `events.rs` (setter calls), the frame
  field write sites in `economy.rs`, `housekeeping.rs`, `presence.rs`,
  `satisfaction.rs`, `services.rs`, `sim_loop.rs` and `crowd/`
  (`motion.rs`, `routines.rs`, `spawn.rs`, `visits.rs`),
  `tower_query.rs` and `tower_query_state.rs` (the attendance rule moved to
  `view/marks.rs`), `lib.rs` (the module), `wasm.rs` (the binding block), `identity_tests.rs`,
  `compat-record.json`
- `engine-rs/Cargo.toml`, `engine-rs/Cargo.lock`,
  `engine-rs/consumer/Cargo.lock` (0.10.0), `engine-rs/consumer/src/lib.rs`,
  `engine-rs/tests/api.rs`, `engine-rs/API.md`
- `src/dualrun/engine.d.ts`, `src/dualrun/binding.ts`,
  `src/dualrun/exportTiers.ts`, `src/build/engineCompat.ts`
- `package.json` (`test:wasm` list), `vite.config.ts` (the suite on the
  TypeScript side of `integrationWasm`), `CONTRIBUTING.md` (version list),
  `.github/workflows/engine-rs.yml` (the integration test in the engine
  job's file lists)
- `docs/performance/hot-path-review.md` (three HP-8 rows),
  `_bmad-output/implementation-artifacts/backlog.md` (the
  `facade-view-followups` row, and notes on the
  `ts-render-ui-hotpath-sweep` and `engine-rs-hotpath-audit` rows)
