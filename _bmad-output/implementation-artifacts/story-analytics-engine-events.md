---
story: analytics-engine-events
status: review
issue: 873
phase: 1 of 5 (migration step 1)
design: _bmad-output/party-mode/analytics-engine-events-party-findings-2026-10-09.md
---

# Story: gameplay events from the engine, phase 1 (catalog, buffer, events hash)

## Why

The owner asked for the engine to be the one place that detects
gameplay-level analytics events (#873). The party design settled the shape:
the engine keeps a drain buffer of provider-agnostic events outside the save
and the hashed views, a catalog file beside the engine is the contract, and
the conformance lock gains an `events` hash so both engines are held to the
same stream while both run. This story is migration step 1 only: the
catalog, the buffer and its emission points in both engines, the drain on
the WASM binding and on `Simulation`, and the lock's events hash. Nothing
reads the stream yet; the analytics bridge is phase 2.

Sequenced after #878 (test parity) and before the 3.0.0 default flip, per
the party addendum: the instrument lands first and gets a release to settle
on the TypeScript default before the flip it is meant to measure.

## Acceptance criteria (from the design, step 1)

1. **AC1 The catalog.** `conformance/events/catalog.json` defines every event
   in the design's table (`tower_founded`, `facility_placed`,
   `facility_removed`, `pricing_changed`, `capacity_changed`, `star_reached`,
   `fire_started`, `fire_gutted`, `bomb_detonated`, `emergency_resolved`,
   `milestone_reached`) with name, schema version, payload fields of closed
   types, semantics, cardinality and a history note. Names as designed.
2. **AC2 The payload rule.** Closed enums and small integers only: no free
   text, no tower names, no money amounts. Both sides refuse a catalog with a
   string field that is not a catalog enum, in a test.
3. **AC3 Rust.** A `GameplayEvent` type, a bounded ring buffer on the
   simulation with a dropped counter, emission at the transition points, and
   `drainGameplayEvents()` on the WASM binding returning and clearing the
   batch as JSON. A unit test checks `GameplayEvent` against the catalog.
4. **AC4 Isolation.** Emission reads state after a transition and writes
   only to the buffer: never the rng, the save, the clock or the views. A
   unit test on each side shows `serialize()` and the state view byte-identical
   with the buffer full and with it empty.
5. **AC5 TypeScript mirror.** The same emission points and buffer semantics
   on `Simulation`, a `drainGameplayEvents()` method, and a generated
   `src/engine/gameplayEvents.d.ts` with a test that fails when it is stale.
6. **AC6 The lock.** An `events` hash per checkpoint (the canonical hash of the
   events drained since the previous checkpoint), written by the TypeScript
   lock writer and checked by the Rust referee and the WASM conformance test.
   One relock; no `state` or `crowd` hash moves.
7. **AC7 No duplicates under the WASM host.** The host drains only the
   authority engine and discards the read model's buffer, with a test that
   counts.
8. **AC8 Scope.** No analytics code changes, no new wire events, no change to
   `frameLoop.ts` detection. No version bump (nothing changes for a player).

## What landed

- **Catalog** `conformance/events/catalog.json`: eleven events, named enum
  sets (`facilityKind`, `milestoneId`, `mode`, `removalMethod`,
  `emergencyKind`, `emergencyDecision`, `emergencySource`) and bounded
  integers (`floor` -9 to 100, `star` 2 to 6, `rooms`, `count`).
- **Rust** `engine-rs/src/gameplay.rs`: `GameplayEvent`, the
  `GameplayEvents` ring (1024 events, `dropped`), `check_catalog` and
  `check_event`, and the tests. `Simulation.gameplay` holds the buffer.
  Emission sites: `new_game_with` (`tower_founded`), `build` and
  `build_transport` (`facility_placed`), `sell_at` (`facility_removed`,
  method `sell`), `price_unit`, `set_no_rate`, `apply_rent_batch`
  (`pricing_changed`), the new `Simulation::set_cars` and
  `Simulation::resize_transport` wrappers (`capacity_changed`),
  `evaluate_star` and `check_vip` (`star_reached`, one per rung crossed),
  `check_milestones` (`milestone_reached`), and in `events.rs` `start_fire`,
  the daily fire pass and the paid rescue (`fire_started`, `fire_gutted`),
  `bomb_threat` (`bomb_detonated`) and `resolve_choice_from`
  (`emergency_resolved`, source `player` or `timeout`). The binding gains
  `drainGameplayEvents()` and `gameplayEventsDropped()`, and its `setCars` and
  `resizeTransport` route through the wrappers.
- **TypeScript** `src/engine/gameplayEventBuffer.ts` (the ring),
  `src/engine/gameplayCatalog.ts` (catalog checks and the `.d.ts` renderer),
  `src/engine/gameplayEvents.d.ts` (generated: `npm run gen:events`, and
  `npm run wasm:build` refreshes it beside `engine.d.ts`; CI's staleness
  check covers both), `src/engine/tower/capacityEdits.ts` (the tower's
  `setCars` and `resizeTransport` report through the owning simulation's
  buffer). The same sites as Rust in `build.ts`, `rent.ts`, `star.ts`,
  `events.ts`, `EventSystem.ts` and `serialization.ts`. `Milestone.id` is now
  typed by the catalog's set.
- **Lock** `Checkpoint.events` on both runners; a `reload` drains the engine
  it replaces first. `conformance/expected.json` relocked once: all 535
  checkpoints keep their `state` and `crowd` hashes.
- **WASM host** `attachWasmHost` overrides the instance's
  `drainGameplayEvents` (and `gameplayEventsDropped`) to answer with the
  engine's batch and discard the instance's. Events from before the attach
  (the founding) come out at the first drain; events the engine holds at
  detach go back to the instance. A detach whose engine traps counts the read
  model's copies of the commands' events since the last drain as dropped: an
  estimate, since the engine's tick events have no copy there, a command
  only the instance accepted (#874) has no twin in the engine, and a
  command the engine's full ring already dropped counts twice. The host
  keeps the instance's buffer object across merges (`mergeSimulation` copies
  the fresh, empty one; the host puts the instance's back), so the copies,
  the drop count and the backdrop mark survive a merge. Until something
  drains, the read model's copies fill its ring and then overflow it, so
  the estimate tops out at the ring's cap. The hosted drop count is the
  instance's count at attach plus the engine's; the read model's own
  overflow is left out of it.
- **Tower swaps** every undo, load, import and new game goes through
  `adoptSim` in `main.ts` (the constructor and `adoptSim` are the only
  places `GameApp.sim` is assigned), which hands the replaced tower's
  undrained events and drop count to the adopted tower, ahead of its own
  (`GameplayEventBuffer.inherit`). `startWasmHost` lets the old tower go
  before the swap and hosts whichever tower the app holds afterwards, so the
  hand-off reads only the TypeScript buffer. A trapped detach is reported on
  the status and the log, and a load or a new game goes through. (An undo on
  a trapped engine still fails earlier, at its snapshot through the engine's
  save; that is the failure fallback in #874.) Past the ring's cap the
  oldest (the inherited ones first) drop and are counted.
- **Boot backdrop** with no readable save the boot tower is only the title
  screen's backdrop and New Tower founds the player's own, so `runBootFlow`
  marks the backdrop's buffer (`discardOnHandOff`) and the tower that
  replaces it inherits none of its events or drops. The mark never reaches
  a tower the player builds in: with no save the splash cannot be dismissed
  (`safeDismiss` returns early), so it closes only through New Tower or
  Load, and both replace the backdrop through `adoptSim`. Together with the
  `adoptSim` hand-off this is shell code deciding what the stream holds in
  phase 1. Nothing drains it yet, and the phase 1 review had left both to
  the bridge; the party review moved them here because a swap lost events
  before any bridge existed.
- **Dual run (Node day gate)** the harness drains both engines at every hour
  and fails on any difference, so every edit the mirror relays is compared
  as an event stream too. The browser dual run (`?dualrun=1`) is unchanged
  on purpose: comparing there would mean draining the live game's buffer
  every hour, which takes the events away from the phase 2 bridge that
  owns that drain. It keeps comparing the hashed views, and the Node day
  gate holds the event streams over the same frame-loop cadence.

Known boundary, by design for phase 1: the editor's Sell and the bulldozer
remove through `tower.removeUnit` and `tower.removeTransport`, which carry no
method, so `facility_removed` is emitted only by the engine's sell command
until phase 2 routes those removals through an engine command with the
method. The catalog's semantics say so.

## Test record

Gates on the reshaped branch (rebased onto `main` with the disc-rs merge),
all green, and run again on the final tree after the party review's swap
hand-off (rounds 8 to 13); the verbatim results are in the PR body.

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`,
  `npm run wasm:build` (package and `BUILD.json` committed), `npm run test:wasm`.
- `engine-rs`: `cargo fmt --check`, the three clippy runs with `-D warnings`,
  `cargo test --locked`, `cargo test --features wasm`, and
  `cargo run --release --bin conformance` (every scenario ok).
- Relock: all 535 checkpoints in 21 scenarios keep their `state` and `crowd`
  hashes against the base; every row gains `events`. The scenario library
  emits all eleven event kinds (largest batch between two checkpoints: 244).

New tests:
- Rust (`engine-rs/src/gameplay.rs`): the catalog passes its own rules; the
  variants match the catalog in order, with the enum sets tied to the
  engine's tables, the floor bounds to the grid and the ring size to the
  TypeScript ring; the catalog refuses a string field, an unknown set, a
  number field, an unbounded integer, unusable names, a reserved set name,
  prose that closes a doc comment and an unsafe whole number; the ring
  drops the oldest and counts it; the save and both hashed views are
  byte-identical full and empty; a new game founds once and a load (a real
  four-star save included) emits nothing; and one test per emission group
  (placements, sell, price and capacity no-ops, stars, milestones, fires,
  bombs, both resolution sources).
- TypeScript: `src/engine/gameplayCatalog.test.ts` (the same catalog rules,
  the compile-time identity of the kind, mode and milestone unions, the
  generated declaration's staleness) and `src/engine/gameplayEmission.test.ts`
  (the ring, isolation and every emission group, mirroring the Rust tests).
- Both scenario runners check every drained event against the catalog and
  fail on a dropped event, so payload drift fails by name.
- `src/tests/integration/wasmHost.integration.test.ts`: a hosted run drains
  the same events as an unhosted one, once each, across attach and detach; a
  trapped engine still lets go of the instance and counts what it lost; a
  prior own drain is put back; a refused attach leaves the instance's events;
  a paused undo through `startWasmHost` hands the restored tower the events
  the engine still owed, ahead of its own, once; a merge keeps the
  instance's buffer object, its mark and the read model's copy.
- `src/wasmhost/startWasmHost.test.ts`: the replaced tower's owed events
  reach the adopted tower; a trapped engine (at the drain or at the drop
  count) still lets the swap through, hosts the new tower and carries the
  counted loss to it; the engine's drop count moves with a healthy swap;
  adopting the held tower keeps its host; a stop inside an adopt stays
  stopped; a stop on a trapped engine reports and lets go; an adopt that
  throws re-hosts the old tower.
- `src/tests/towerSwapHandOff.guard.test.ts`: `GameApp.adoptSim` inherits
  the replaced tower's buffer as a plain statement before its swap, and no
  other module assigns the app's tower.
- `src/engine/gameplayEmission.test.ts`: `inherit` puts a replaced tower's
  events first, carries its drop count, empties it, ignores itself, drops
  the inherited events first on overflow, and leaves a backdrop's behind.
- `src/game/appBootBackdrop.test.ts`: with no save, New Tower's swap holds
  only the player's founding, even after the backdrop emits again; a saved
  tower hands its events on.
- The Node dual run compares both engines' drained events every hour; the
  edits case pins 14.

## Review record

`/gds-code-review` on the full branch diff, six rounds (Blind Hunter, Edge
Case Hunter, Acceptance Auditor in parallel, then triage). Copilot is
requested on the PR; Codex is out of quota.

- **Round 1:** 15 patches, 1 defer, 9 dismissed. Patched: detach stranding
  the overrides when the engine throws; the drop count across attach, merge
  and detach; price writes that change nothing emitted; Rust catalog check
  weaker than the TypeScript one; no catalog check in the runners; a free
  string for `emergencyKind`; names and prose that broke the generated
  declaration; `in` on a payload; `one_of_each` able to miss a variant; floor
  bounds and ring size unchecked across engines; drops invisible to the
  hash; two "rather than" comments; a duplicated payment test; the per-tower
  wording; no Rust tests at the emission points. Deferred:
  `analytics-removal-command` (#901), the editor's Sell and the bulldozer
  bypass `facility_removed` until phase 2.
- **Round 2:** 9 patches (reserved set names, safe-integer parity and
  `unsigned_abs`, the buffer's read path documented, `DualRun.follow`
  ordering, the ordinal check, `EmergencyKind::parse` in use, the host's
  state hoisted and handed back on a refused attach, a real save loading
  silently in both engines, the exact dual-run count). Two bridge handoffs
  recorded on the #873 row for phase 2: drain before an instance swap, and
  drop the boot placeholder's `tower_founded` (both since fixed in phase 1,
  see the party review).
- **Round 3:** 5 patches (detach restores prior own properties, reads the
  drop count first and guards every step; `setNoRate` emits after its write;
  each engine's capacity emission point named in the catalog; the browser
  dual run's scope explained; the backlog row's lead word).
- **Round 4:** 5 patches (a drain reference kept past detach; the Rust
  reload check order; the Rust non-object catalog message; the TypeScript
  resize re-reading the shaft; the `fire_gutted` wording and the engine
  freed in its own `finally`).
- **Round 5:** 2 patches (a refused attach hands the events back even when
  the free throws; the harness comment). A review probe file swept into a
  commit was removed (gone in the reshape).
- **Round 6 (confirming):** no patch findings on any layer.
- **Round 7 (confirming, on the reshaped branch after merging `main`):** no
  patch findings on any layer. Two clean passes in a row; the loop converged.

Dismissed across rounds, with the reason checked in the repository: no
engine-internal caller of `setCars` or `resizeTransport` on either side and
no tower reassignment or clone; both loaders close the pending emergency
kind; merges keep the simulation's and the tower's buffers paired;
`resizeTransport` mutates the shaft in place; reversed spans are refused
before placement; the browser dual run compares views by design.

## Party review (fan-out, 2026-10-10)

The owner asked for a fan-out party review of PR #903 after the loop
converged. Five voices reviewed independently as their own agents, then
cross-talked: Vex (adversarial, analytics egress), Grumbal (game systems and
release sequencing), Boundary (public/private and platform seams), Yui
(engine and test parity), Dana (release and product).

- **Fixed in this PR:** the swap hand-off. `startWasmHost` adopted the new
  tower before the host detached, so the engine's owed batch went back to the
  orphaned instance; and the plain TypeScript path dropped whatever the
  replaced tower still held. The host now lets go first and `adoptSim` hands
  the events and drop count over. A detach whose engine traps now counts the
  read model's copies as dropped. The boot backdrop's founding is discarded.
- **Filed:** `simulation-capacity-commands` (#906, the two engines emit
  `capacity_changed` from different layers) and `gameplay-events-glue` (#907,
  consolidate the drain glue).
- **Recorded on the #873 row as phase 2 gates:** fail-closed `checkEvent` at
  egress, forward only the folds under a rate limit, freeze the catalog for
  the release before the 3.0.0 flip, and fold actions (an undone build still
  counted as a build).

`/gds-code-review` round 8 on the fix (all three layers): the first shape
handed over in `adoptSim` through the hosted drain, so a trapped engine made
undo, load and new game throw; the drop count stayed on the abandoned tower;
the two hand-off paths overlapped and the real order was untested; the boot
backdrop's founding leaked into the next tower; and comments used the
emphatic pattern. All patched by the redesign above. Dismissed: the backlog
rows sit with the analytics rows (the table groups by topic); a `prepend`
that throws mid-way (`pushEvent` cannot throw).

Round 9 on the redesign (all three layers): 13 patches. A single drain at
the splash let later backdrop events through (now the `discardOnHandOff`
mark, which also removes a hosted drain at boot); a trap fallback that read
a buffer merges replace (the host now keeps the instance's buffer across
merges, and the count is worded as the lower bound it is); a
same-sim adopt restarting its engine; a stop inside an adopt re-hosting;
the trap test planting a tick event; the overflow and self-inherit tests
unable to fail; no test of a trap at the drop count; `stop()` reporting
instead of throwing, undocumented; the severity column; story wording.
Round 10 (all three layers): 9 patches. A merge replaced the instance's
buffer and with it the backdrop mark (the host now keeps the buffer
object); no test pinned the real `adoptSim` hand-off (a guard test now
checks it runs before the swap and that `adoptSim` and the constructor are
the only assignments); the self-inherit test could not fail; no test of
`stop()` on a trapped engine; the trap count worded as a lower bound (now
an estimate); the bridge must skip a marked backdrop when it drains (a
phase 2 gate); story wording and a stale round 2 pointer; the undo trap
path and a refused re-host noted on #874. Dismissed at the time: double
counting between the engine's drops and the read model's copies (round 11
found the engine's tick events can push commands out while their copies
stay, and the estimate's wording now says so); a backdrop the player keeps (the
no-save splash closes only through New Tower or Load, both swaps).

Round 11 (all three layers): 8 patches, all hardening. The merge's buffer
restore runs in a `finally`; the trap estimate's comment names its double
count and its ring cap; the guard test matches the hand-off as a plain
statement and scans every shell module for an `app.sim` assignment; a test
carries a non-zero engine drop count across a swap; the `stop()` test
asserts the host is down; the #873 row's "lower bound" and the #874 row's
wording. Dismissed: `stop()` removing a wrapper installed after it (the
dual run and the host already refuse each other at attach); a drain of the
marked backdrop (no drain exists in phase 1; recorded as a phase 2 gate).

Round 12 (confirming, all three layers): no patch findings; two wording
notes applied (the hosted drop count's makeup, the test inventory). Round
13 (confirming, all three layers): no patch findings; one backlog sentence
split. Two clean passes in a row; the loop converged.

Recorded on #873 for phase 2: the catalog's `tower_founded` notes the
backdrop rule, and a drained batch can span two towers. Dismissed: the
two `release` calls on a swap (the second finds no host); a re-entrant
adopt starting twice (no ticks between, nothing lost); the integration
test's identical batches (its count tells one hand-off from two); the
`main.ts` comment reflow (it keeps the file at its 500-line cap); a module
reused after a trap (the failure fallback, #874).
