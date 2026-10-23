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
with the implementation and the first review round, 2026-10-21).

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
   on, and the game mode and Modern calendar (fixed at founding, read once at
   load or adopt). Then every room (non-floor, non-lobby unit) as a fixed
   record (id, kind code, floor, x, width) in rooms-index order, which is the
   slot order the dynamic frame uses; then floor and lobby tiles as runs (one
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
   reader finds changed rooms by comparing the five frame fields over the
   rooms index and never walks floor or lobby tiles. A revision change, a
   unit-count change or `full = true` sends every room and sets the header's
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
   unit's id only when the value changes. Every engine write site (the editor's rename, a move-in's company,
   gym and clinic names, a vacate, a fire, a build's subtype, a churn re-theme)
   goes through them. `view::meta_since(tower, since)` (binding
   `unitMetaSince(since)`) answers the units changed after `since`, or a full
   listing (every unit whose label differs from its catalog name or that has a
   subtype) when `since` is not a whole number in `1..=meta_revision` or the
   log no longer reaches back that far. Every tower starts at meta revision 1
   with an empty log, so a host that has read nothing (no argument, or 0)
   gets a full listing, the labels and subtypes a save carried included. A
   source check keeps label and subtype
   writes inside the setters (the save loader and new-unit construction
   excepted).
5. **Header additions.** The frame header carries the meta revision, the meal
   overlay revision, the unlocked kinds as a bitmask by kind code
   (`Simulation::is_unlocked`), the population (`Simulation::population`,
   summed in the same room pass, so a host reads it at HUD cadence with no
   walk of its own), the room count the slots index, the `FULL` flag and the
   frame number, beside today's clock, money, star, weather, effects, event
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

## Tasks

- [x] Story file (this file) before the first commit.
- [x] `frame.rs`: lift the state, weather and transport encoders into
      `pub(crate)` helpers that `frame_view` and the view share; no `pub const`
      added (the frame layout table stays as it is).
- [x] `engine-rs/src/view/`: `mod.rs` (state hung on `Tower`), `layout.rs`,
      `structure.rs`, `reader.rs`, `meta.rs` (setters, log, listing),
      `signature.rs`, and `*_tests.rs` beside them (the seeded sessions in
      `session_tests.rs`, the oracle in `oracle_tests.rs`).
- [x] `tower.rs`: two fields (`meta_revision`, the view state); `set_label`
      moves into `view/meta.rs` beside the setter it now calls.
- [x] Route the label and subtype writes in `churn.rs`, `events.rs` and
      `build.rs` through the setters (one line each).
- [x] One `#[wasm_bindgen]` block in `wasm.rs`, placed just before the
      `#[cfg(test)] mod tests` module (the end of the bindings; the facade
      lane asked for it there): `viewLayout`, `viewStructure`, `viewFrame`,
      `unitMetaSince`, `towerSignature`.
- [x] `src/dualrun/engine.d.ts` (regenerated: lines added only, at the
      places wasm-bindgen sorts them), `binding.ts`, `exportTiers.ts`.
- [x] Compat record: `viewLayoutVersion` in `src/build/engineCompat.ts` and the
      Rust record test; crate 0.5.0 to 0.6.0 in `Cargo.toml` and both lock
      files (6d took 0.4.0, #1231 0.4.1 and #1233 0.5.0, each merged first);
      `npm run engine:compat`.
- [x] `src/tests/integration/engineView.integration.test.ts` on the real WASM
      package, listed in `npm run test:wasm`.
- [x] Consumer crate: `read_view` in `engine-rs/consumer/src/lib.rs`, run by
      its smoke test; `engine-rs/tests/api.rs` names the view items.
- [x] Docs: `engine-rs/API.md` row, CONTRIBUTING's version list.
- [x] Gates: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`
      (all features), `npm run typecheck`, `lint`, `test`, `build`,
      `npm run wasm:build` (`RUSTUP_TOOLCHAIN=1.97.0`) and `npm run test:wasm`.
- [x] `/gds-code-review` round 1 with the Hot-Path Auditor; its patch
      findings fixed (see the review section below).
- [ ] Round 2 on the fixed diff; HP-1 to HP-12 record on the PR; every
      defer in the backlog with an issue.

## Dev notes

### Files and owners (parallel map, 2026-10-20 22:50 UTC)

6a owns the new `engine-rs/src/view/`, `frame.rs` and the label and subtype
setters. `wasm.rs` and `engine.d.ts` are append-only: 6a adds one block at the
end of the bindings in `wasm.rs` (just before its test module) and does not
change the `Engine` struct or its constructors
(slice 13 edits `from_save` and `from_vctower`). That is why the reader's
state hangs on `Tower` (initialized in `Tower::new`, which every load goes
through) instead of on `Engine`. Not touched: `tower_query.rs`,
`tower_index.rs`, `sim.rs` reachability, `housekeeping.rs` (the step-hotspot
lane's), the load path (slice 13's), `src/simport/` (the facade thread's),
`src/wasmhost/` (Runtime's). The one-line setter calls in `churn.rs`,
`events.rs` and `build.rs` are the only edits outside 6a's files; 6d's command
modules may touch the same files, and a conflict there is one line.

6b (panel getters) keys its caches on `tower.revision`,
`tower.meal_overlay_revision`, `tower.meta_revision` and the clock hour, and
appends its own `wasm.rs` block after this one.

### Current state of what changes

- `frame_view` (`frame.rs`) writes the header, every person with its route,
  every unit's six slots and every transport's cars. The view reuses its
  encoders; its own output does not change (`frame_tests.rs` and the frame
  layout pin hold it).
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
full flag, frame number, then the people, unit and transport counts), then `people` records of 8, then `units` records of 6
(slot, state, occupants, customersIn, hotelCustomersIn, outForMeal; -1 for an
absent counter), then `transports` records of `2 + 3 * cars` as in
`frameView`. Codes are `frameView`'s.

Structure: an 8-slot header (revision, rooms, runs, shafts, highest floor,
lowest floor, mode, calendar), rooms of 5 (id, kind, floor, x, width), runs
of 10 (kind, floor, x, width, count, then the five frame fields every tile in
the run shares; no ids), shafts of `8 + skips` (id, kind, x, width, bottom,
top, cars, skip count, then the skipped floors). Runs are ordered by floor and
then x and are maximal: two runs that touch with the same kind, width and
fields are one. A host that needs a tile's id asks `unitAt(floor, x)`.

Metadata: JSON `{ "revision", "full", "units": [[id, label, subtype or
null], ...] }`, the record's fields named by `metaRecord`. A unit absent from a full listing has its catalog name and no
subtype; an incremental answer lists every unit changed since `since` that
still exists, with its current values.

### Hot paths (HP record goes on the PR)

- `viewFrame`: per frame. One pass over rooms (R = 2,900 on large), five
  compares each, summing the population as it goes; people and cars as
  `frameView` sends them; one allocation at the exact size. No walk over
  floor and lobby tiles.
- `viewStructure`: per revision change, never per frame. One pass over units
  for the runs (with an open run per floor, so a tile extends its floor's
  run whatever was built between) and one over rooms; when the runs come out
  of order, a stable sort and a join of the runs, which are a few hundred,
  never of the tiles. The floor bounds come from the tower's per-revision
  cache (`Tower::floor_bounds`, #1237), which the panel getters share. One
  allocation at the exact size.
- `unitMetaSince`: per frame only when the meta revision moved; answers from
  the log by binary search. A full listing is one pass over units (load, or a
  reader that fell behind the log's cap).
- `towerSignature`: per command (undo's capture and commit), one pass over
  units and transports with a word-at-a-time hash. Never per frame.
- Setters: O(1) plus the log push; the log is capped and trimmed by halves.

### Out of scope

The TypeScript view, `RustSim`, the port's undo wiring (slices 1, 5 and 7),
panel getters (6b), diagnostics facts (6c), command gaps (6d), write-site dirty
marks (only if the PC asks), the worker adapter (12).

### Project context rules

American English, no em-dashes, no AI marketing words; the 500-line ceiling on
new files (`fileSize.guard.test.ts`); `rustProse.guard.test.ts`; the engine
stays free of host access (`independence.rs`) and `wasm_bindgen` stays in
`wasm.rs`; merge commits only; no Copilot; no closing keyword before #868 or
#954.

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
- AC 6: one oracle test (`oracle_tests.rs`) runs six starts (a fixture, a
  split tower, two Modern fixtures with a pending VIP and a 4-star tower, and
  the events scenario at its fire) through seeded sessions of 24 kinds of
  step (`session_tests.rs`), checking after every step. The last run, on 826
  steps, saw the revision move on 62, the signature on 96 and the meta
  revision on 36, with 113 incremental frames that sent rooms; the test
  asserts floors on those counts so a session that stops exercising a path
  fails. It also checks that every structure's runs are maximal, and a
  separate test reverses the unit list and orders it by column, and gets the
  same runs.
- AC 8: the signature is checked against `ts_sig`, a Rust port of
  `towerStateSig`'s tower half (`signature_tests.rs`), on every oracle step:
  equal strings give equal signatures and a new string a new signature. The
  integration test checks it against the real `towerStateSig` over renames,
  a name put back, rent, No Rate, cars, play and a sale.
- The facade lane asked (2026-10-21) for the mode and calendar in the view,
  for rooms and runs to stay separately addressable (#1253), for the floor
  bounds to come from the structure, and for the population to need no walk
  of its own. All four are in the structure header or the frame header.
- Debug-build cost: `fromSave` of a 13k-unit fixture is about 3 s in a debug
  test, so the unit tests use the small scenario tower and the oracle loads
  fixtures once per start.
- Native release timings on this container after the first review round
  (indicative only; the PC is the source of record): `viewStructure` 0.30 ms
  medium, 0.88 ms large; `viewFrame` 14 to 15 us medium and 35 to 47 us large,
  against `frameView`'s 209 us and 921 us; `towerSignature` 0.29 ms medium,
  1.19 ms large (the TypeScript `towerStateSig` it stands in for took 12.4 ms
  on large in the review's measurement).
- Conformance, the frame layout pin, the save format, the state view and the
  digests are unchanged: the conformance runner passes, the frame layout pin
  in `identity_tests.rs` holds, and `engine-rs/src/frame_tests.rs` (which
  checks `frameView`'s output) passes untouched.

### Review round 1 (2026-10-21)

`/gds-code-review` ran with the Blind Hunter, the Edge Case Hunter, the
Acceptance Auditor and the Hot-Path Auditor. Its patch findings, all fixed in
this PR:

- The runs depended on the unit list's order: a floor built in pieces gave a
  run per piece. The walk now keeps an open run per floor, then sorts and
  joins the runs only when they come out of order.
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
holds the write-site dirty marks, which stay a patch finding until the owner
accepts deferring them, the coalesced structure refresh for slices 2 and 7,
and the fire and bomb walks beside #1158 A16; #1170 item T1 holds the
TypeScript per-frame population sum; #1257 item 3 already held the buy-back
rebuild in `vacate`. The HP-8 table gains rows for the reader's last-sent
room fields and the meta revision and log.

After the rebase on #1237, which added a per-revision floor bounds cache
(`Tower::floor_bounds`), the structure reads its bounds from that cache
instead of folding them in its own walk (HP-8).

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
  `meta.rs`, `signature.rs`
- `engine-rs/src/view/layout_tests.rs`, `frame_tests.rs`, `meta_tests.rs`,
  `signature_tests.rs`, `oracle_tests.rs`, `session_tests.rs`
- `src/tests/integration/engineView.integration.test.ts`

Changed:

- `engine-rs/src/frame.rs` (shared encoders), `tower.rs` (view state, meta
  revision), `build.rs`, `churn.rs`, `events.rs` (setter calls), `lib.rs`
  (the module), `wasm.rs` (the binding block), `identity_tests.rs`,
  `compat-record.json`
- `engine-rs/Cargo.toml`, `engine-rs/Cargo.lock`,
  `engine-rs/consumer/Cargo.lock` (0.6.0), `engine-rs/consumer/src/lib.rs`,
  `engine-rs/tests/api.rs`, `engine-rs/API.md`
- `src/dualrun/engine.d.ts`, `src/dualrun/binding.ts`,
  `src/dualrun/exportTiers.ts`, `src/build/engineCompat.ts`
- `package.json` (`test:wasm` list), `CONTRIBUTING.md` (version list),
  `.github/workflows/engine-rs.yml` (the integration test in the engine
  job's file lists)
- `docs/performance/hot-path-review.md` (two HP-8 rows),
  `_bmad-output/implementation-artifacts/backlog.md` (the
  `facade-view-followups` row and the `ts-render-ui-hotpath-sweep` notes)
