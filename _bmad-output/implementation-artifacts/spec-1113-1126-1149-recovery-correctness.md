---
title: WASM host recovery correctness before the flip (attach traps, older points, a failed swap)
type: bugfix
created: 2026-10-20
status: done
baseline_commit: f1777e1e
issues: [1113, 1126, 1149]
context:
  - CONTRIBUTING.md
  - _bmad-output/project-context.md
  - _bmad-output/implementation-artifacts/spec-874-runtime-fallback.md
---

# Intent

The owner put #1113, #1126 and #1149 in the pre-flip correctness set (20:16
and 20:29 UTC, 2026-10-20): "A stuck tower that continues emitting gameplay
events after failed recovery adoption is more than cosmetic." All three are
defers from the reviews of #874 (PR #1101), on the main-thread host
(`?engine=wasm`, and every tower in a wasm-only build). One PR fixes the three
together, since they share `startWasmHost.ts`, `hostFault.ts` and
`wasmHost.ts`; the "Rust-backed simulation facade" thread holds its slices on
those files until this merges (its reply of 21:32 UTC).

**#1113, a trap while a tower attaches.** A trap in `Engine.fromSave` or the
attach's first frame read is reported as `attach-refused` and the tower stays
on TypeScript, but hosting is not latched off: the next load or new game
builds an engine on the same WebAssembly instance, whose memory the trap may
have left corrupt, and the engine save writer keeps using it.

**#1126, a recovery from an older restore point.** When the newest point does
not load, the recovery goes back to the newest merge's save or the attach
save. Nothing records that, the player reads the same line as a recovery from
the newest point, and the TypeScript engine replays time whose events the
game already received.

**#1149, a recovery whose adopt throws.** The restore point loaded, but the
swap failed, and the player reads "the tower could not go back to a good
state". The adopt wrapper's release had already let the faulted host go,
which put the stuck tower's own event drain back, so edits on a tower that
runs no engine send real gameplay events.

# Boundaries

- **Always:** keep A1's closed analytics lists (`FALLBACK_REASONS`,
  `FALLBACK_STAGES`, `ENGINE_STATUS_FIELDS`); an attach trap stays
  `attach-refused`. Keep the save format, the engine crate's interface and the
  conformance lock. Keep every path that does not throw exactly as it is. No
  new work on a per-command, per-tick or per-frame path; two changes touch
  one, both recorded under "Hot path": the carried `merge.ts` copy (every
  merge, O(billed rooms)) and the attach's frame read, which gets cheaper.
- **Ask first (owner):** any new `engine_status` field or value, such as a
  code that tells an attach trap from a refusal, or a field for the point a
  recovery loaded. None is added here; see "Owner asks".
- **Never:** flip the default engine, roll out, publish 3.0.0, remove the
  TypeScript fallback, or touch #1068's files (`workerHost.ts`,
  `workerSaveSync.ts`, `src/tests/perfCompare/`, `src/tests/perfWorker/`).

# Behavior

| Scenario | Today | After |
| --- | --- | --- |
| The catalog read, `fromSave` or the attach's frame read throws a `WebAssembly.RuntimeError` | `attach-refused`; the next tower builds an engine on the same module; the writer stays | `attach-refused`; hosting latched off for the page life (`status.latched`); the writer goes back to TypeScript; nothing calls the module again, and a built engine is taken off the finalizer |
| `fromSave` refuses a save (a clean `JsError`), or the tower has a crowd | `attach-refused`; the next tower is hosted | unchanged |
| A non-trap throw after the engine was built (a frame the host cannot decode) | the built engine leaks | the engine is freed, then the refusal as today; a trap in that free latches |
| The catalog check behind a clean refusal traps | `attach-refused`; the trap is swallowed | latched as an attach trap, with the refusal's message kept in `errors` |
| The free of a healthy tower let go before an attach traps | logged; the next tower is hosted on the module | logged; the next tower latches as an attach trap |
| That free traps after a clean throw from an earlier step of the let-go | the clean throw answers, so the next tower is hosted on the module | the trap answers, its message naming the clean throw too (follow-up), and the next tower latches |
| A relay already on the tower (the dual run's mirror) refuses the attach, and the free behind it traps | the trap is swallowed; the next tower is hosted | latched as an attach trap, with the refusal's message kept (follow-up); the tower keeps its own events either way |
| A faulted tower is let go | its engine freed, a throw ignored | its engine taken off the finalizer without a call into the module |
| A strict (wasm-only) build's attach trap | `onFatal` | unchanged, and the writer is off |
| The newest point loads | `RESTORED` or `UNDONE` | unchanged, and `status.restorePoint` names it with `skipped: 0` |
| The newest point fails, an older one loads | the newest point's line | `status.restorePoint` names the older point with `skipped` > 0, the player reads `OLDER`, and the undo trail is cleared |
| An undo's or a redo's own snapshot faults the host and answers with an older point, and the swap comes before the recovery | `LOST` or `REPLACED`; the trail is tidied, and the step the snapshot made holds the older tower | `status.restorePoint` names the point, the trail is cleared, and the player reads `CLEARED`, since the tower is the undo's or the redo's target (follow-up) |
| A save of the faulted host answered with a point, and the recovery restores | the recovery walks the points again, and can load a newer one than the save holds | the recovery goes back to the point the save answered with (follow-up) |
| The adopt throws after the release, the app still on the faulted tower | `STUCK` ("could not go back to a good state"); the stuck tower's edits send events | `SWAP_FAILED`; events the frozen tower emits after it is let go are dropped, and the events the host handed back still reach the game; `status.restorePoint` still names the point that loaded |
| No point loads | `STUCK` | unchanged |

The lines (temporary, with the re-adoption on TypeScript):

- `OLDER`: "The WASM engine stopped, so the tower went back to an earlier
  good state and anything since then was undone. The undo history was
  cleared, and the tower runs on the TypeScript engine now." It says
  "anything", since the play since an older point is undone even when the
  player made no change in it (the follow-up's rewording).
- `CLEARED` (follow-up): "The WASM engine stopped, so the undo history was
  cleared. The game runs on the TypeScript engine now." For an undo or a
  redo whose own snapshot went past the newest point: the tower is the one
  the player asked for, and only the trail is lost.
- `SWAP_FAILED`: "The WASM engine stopped, and the tower could not switch to
  the TypeScript engine, so it is frozen and changes to it are not saved.
  Load a save or start a new tower to keep playing." (The frozen tower's
  clock does not run and its saves answer with the newest point.)

# Design

## Telling an attach trap from a refusal (#1113)

`isEngineTrap(error)` in `hostFault.ts` (permanent: a Rust-only build latches
on the same signal):

- a `WebAssembly.RuntimeError` (a Rust panic or abort, `unreachable`), by
  `instanceof` or by `name` (another realm's class);
- wasm-bindgen's borrow error, "recursive use of an object detected which
  would lead to unsafe aliasing in rust", which every call on an object a
  trap left borrowed throws;
- a stack overflow (`RangeError: Maximum call stack size exceeded`, Firefox's
  `InternalError: too much recursion`): it unwinds through the module and
  leaves its stack pointer where the trap left it. One in the host's own
  TypeScript looks the same and latches too: it cannot be told apart, and
  latching is the safe side.

The test reads `name` and `message` by duck typing, so another realm's
errors count, and follows `cause` a few levels: `readCatalog` wraps the
catalog call's throw in a named `Error` and keeps the throw as its `cause`.

A clean refusal is everything else: the engine's `Result::Err` (a `JsError`,
a plain `Error`), the host's own TypeScript checks (a crowd, a relay already
attached, a foreign catalog). The test is narrow on purpose: a refusal the
classifier misses only stays a refusal, as today, and #1114 owns telling the
runtime's traps from its clean errors.

`startWasmHost`'s `follow` latches (its `latch` helper) on a trap from the
attach, from the catalog check behind a clean refusal (`foreignPackage()`
rethrows a trap; the refusal's message stays in `errors`), or from the free
of the tower `release` let go before it (a trap there is kept for the next
`follow`). The latch:

- sets `faulted` (hosting latched off for the page life, the flag a runtime
  fault sets) and `status.latched`;
- records the fallback as `attach-refused` with the message "not hosting this
  tower or any later one, since the WASM engine trapped: ...";
- does not ask `foreignPackage()` after an attach trap, since it reads the
  module's catalogs;
- calls `onFallback(fallback, true)`. The second argument, `latched`, is new
  and true for every fallback that latches hosting off (a runtime fault too).

`attachWasmHost` reads the attach's two header fields from one frame view,
checked whole as the decoder checks it (`decodeHeader` and `checkRecords`).
When a step after the engine was built throws, a relay's refusal included,
`letEngineGo` frees the engine on a clean refusal and answers the refusal,
or a trap in that free, which the caller latches on; that trap's message
keeps the refusal's. After
a trap it lets the engine go with `ShadowEngine.abandon()`: wasm-bindgen's
JavaScript-only half of `free` (`__destroy_into_raw`) zeroes the handle and
takes it off the `FinalizationRegistry`, so the garbage collector never
frees it into the module either. A faulted host's detach lets its engine go the same way, for
every fault: no tower is hosted on the module again, so its memory has no
other use.

`bootstrap.ts` turns the engine save writer off on `latched` (it read
`isHostFault(reason)` before, which it keeps as a second check), records the boot state for a later tower's
latch as it does for a fault, and does not install the writer after start
when the first tower's attach latched. A first tower's latch is recorded on
the boot state once `startWasmHost` returns, with its message, as a refused
first tower is today.

A healthy detach runs every step even when one throws (`runEach`, now in
`hostFault.ts`). A lone error is thrown as it is. Several are thrown as one
new error whose message names them all, the first trap's first (or else the
first error's), with the trap itself as its cause, found through up to three
wrappers, as deep as `isEngineTrap` reads. So `release` latches on a trap in
the free behind a clean throw, and the log keeps both (follow-up).

The worker host needs none of this: a failure terminates its worker, and the
next tower starts a fresh one with its own instance (`workerController.ts`).

## The point a recovery loaded (#1126)

`RestorePoints.restore()` answers `{ sim, point, skipped }`, where `skipped`
counts the newer points that failed to load. `WasmHost.restore()` answers the
same shape (it was the bare `Simulation`), after `carryLiveState`. The
recovery stores `{ point, skipped }` on `status.restorePoint` as soon as a
point loads, before the adopt (so a swap that then fails still shows the
point; the failure is in `lastError`), and picks `OLDER` when `skipped` > 0.
After an older point it clears the undo trail (`app.clearUndo`, the
history's `clear`) instead of tidying it: the newest steps were taken after
the point it went back to, so an undo would move the tower forward again,
and one of them may be the save that did not load.

A save asked of the faulted host answers with the same point
(`RestorePoints.newestSave`), and an undo's or a redo's own snapshot is such
a save. When the undo or the redo then swaps the tower before the recovery
runs, the recovery has nothing to restore, so it reads the point that save
answered with (`WasmHost.answered`). When the swap kept the history, it
records the point on `status.restorePoint`, and when the snapshot went past
the newest point it clears the trail and says `CLEARED`: the redo or undo
step the snapshot made holds the older tower, while the tower in play is the
target the player asked for (follow-up to the independent review of #1230,
its item 1). The whole trail goes, as after an older-point recovery, rather
than the one step: the app's history has no call to drop one step, and the
steps around the gap would be labeled for states the trail no longer
reaches. It takes two failures at once. A load or a new game clears the
trail itself (the app's adopt), so the tidy after it finds nothing in the
game; it keeps its line and records no point, since no point became the
tower or a step.

`RestorePoints.restore` starts its walk at the point a save already answered
with, when there is one, so the recovery and every save of the faulted host
agree even when a newer point's load would succeed the second time (out of
memory the first). If that point fails to load the second time, the walk
goes on to older points only, never back to a newer one, and records the
point it loads with its place in the list, so the trail is cleared and the
player reads `OLDER`. When none of those loads, the recovery is `STUCK`, as
when no point loads, even if a newer point would load by then. That takes a
point that loaded once failing to load again, which only a page short of
memory does, and a newer point would put the tower ahead of a save the
player already holds.

A `STUCK` recovery in which no point ever loaded leaves no point chosen, so
a later undo's own snapshot (a save of the frozen tower) throws "no point
loads" after the undo has taken its step off the trail: that step is lost,
and the error reaches the page's error handler. It stays as it is (#1278's
independent review, F2, which predates this follow-up): it takes the attach
save or a merge's save failing to load, though TypeScript wrote the one and
loaded the other, and the tower is already frozen, with the `STUCK` line
telling the player to load a save or start a new tower. A `STUCK` reached
after the answered point fails again keeps that point chosen, so its saves
still answer with it.

The events stay as they are: the events up to the newest point left the
host once, so an edit the recovery took away still has its event in the
game (the real-engine test counts it), and the TypeScript replay from the
older point emits that time's events again (the test does not tick the
restored tower, so it counts none of those). Suppressing the replay's events would
drop the ones the replay makes differently (it runs without the commands
between the two points); an analytics field that marks such a recovery is an
owner decision (see "Owner asks").

## A failed swap (#1149)

`recover` says `SWAP_FAILED` when the adopt leaves the app on the faulted
tower (the point loaded; only the swap failed), and keeps `STUCK` for no point
loading. The frozen tower's clock does not run and its saves answer with the
newest point, which the line says as "frozen and changes to it are not
saved".

A faulted host's `detach` closes the frozen instance's gameplay event buffer
once it has handed the held events back: the buffer's `pushEvent` becomes a
no-op on that instance. The handed-back events (every one up to the newest
point) stay in the buffer for the tower that replaces it (`GameApp.adoptSim`
inherits them) or for its own drain; what a frozen tower's edits would emit
is dropped, since no engine runs it and its save answers with the newest
point. The close sits beside the frozen tower's no-op tick, in the steps the
detach runs when it is faulted, so it covers every way a faulted host is let go: the
recovery's release, a load or a new game, and `stop`.

# Lifetimes

| Part | Class |
| --- | --- |
| `isEngineTrap`, `letEngineGo`, `runEach` (its trap first), `ShadowEngine.abandon`, the latch in `follow` (attach, catalog check, release), `status.latched`, `onFallback`'s `latched`, the boot's writer off on `latched`, the engine freed on a non-trap attach failure, the faulted detach's let-go, the catalog error's `cause`, the attach's single frame read | Permanent host infrastructure |
| `RestorePoints.restore`'s `skipped`, `RestorePoints.answered` and `WasmHost.answered`, `status.restorePoint`, `OLDER`, `CLEARED`, `SWAP_FAILED`, the frozen tower's closed event buffer, `clearUndo` | Temporary fallback code, removed with the TypeScript simulation (listed in `story-engine-retire-typescript.md`) |

# Owner asks (not in this PR)

- An `engine_status` value for an attach trap (for example `attach-trap`),
  so the Reliability row counts it apart from a save the engine refused.
- A field or value for a recovery from an older point.

Both need the owner's production OK (A1's boundary); this PR ships neither,
and the status and the console carry the facts meanwhile. Tracked as backlog
row `wasm-fallback-analytics-asks` (#1204).

# Deferred

- A trap in the engine save writer (`encodeVctower`) latches only the writer:
  backlog row `wasm-writer-trap-latch` (#1205).
- The merge's walk over every unit for fires (#1158 A23) and the Rust load's
  linear `excavated` dedupe (#1173 F3): pre-existing, on paths this PR calls
  but does not change; deferred by reference (hot-path review section 7).

# Carried from #1092's review

The independent reviewer's optional items on #1092 (GO at `77796df`), held
for this PR:

- The 2.41.0 changelog line covers undo too: "Saving, or undoing an edit,
  while an exterminator is booked now keeps the booked rooms, so the
  treatment covers only the rooms you paid for."
- `extermination_tests.rs`: an integral float id (`json!(5.0)`) is kept, so a
  switch of the loader to `as_i64()` fails a test.
- `loaderCases.integration.test.ts`: the orphan list's output equals the
  plain Modern round trip, the Classic list's equals the Classic round trip,
  and the invalid, null and empty lists agree.
- `merge.ts`: the merge copies the billed list (`[...ids]`), as the
  TypeScript writer does, instead of sharing the fresh instance's array.

# Code map

- `src/wasmhost/hostFault.ts`: `isEngineTrap`, `letEngineGo`, `runEach`
  (moved from `wasmHost.ts` in the follow-up); `RestorePoints.restore` with
  `skipped` and its reuse of the chosen point, `RestorePoints.answered`; the
  `RestoredPoint` type.
- `src/dualrun/shadow.ts`: `abandon()`; `free()` clears its field first.
- `src/dualrun/catalog.ts`: the catalog error keeps its `cause`.
- `src/wasmhost/wasmHost.ts`: `restore()`'s new shape, `answered`; the
  attach's single frame read and `letEngineGo`, behind a relay's refusal
  too; the frozen instance's event buffer closed and
  its engine let go at a faulted detach.
- `src/wasmhost/startWasmHost.ts`: `status.latched`, `status.restorePoint`;
  the latch (attach, catalog check, release); `onFallback`'s `latched`;
  `OLDER` with the trail cleared, `SWAP_FAILED`; `WasmHostApp.clearUndo`;
  `recover`'s replaced branch reading `answered`, with `CLEARED`.
- `src/main.ts`: `clearUndo`.
- `src/bootstrap.ts`: the writer and the boot state on `latched`.
- `src/wasmhost/merge.ts`: the copied list.
- Tests: `hostFault.test.ts`, `startWasmHostFallback.test.ts`,
  `startWasmHostRecovery.test.ts`, `startWasmHost.test.ts`,
  `wasmHostFrame.test.ts`, `wasmHostPoints.test.ts`,
  `bootstrapEngine.test.ts`, the fake engine fixture; on the real engine a new
  `src/tests/integration/wasmHostAttachTrap.integration.test.ts` (#1113,
  permanent), `wasmHostFallback.integration.test.ts` (#1126, #1149),
  `wasmHostRollbackHistory.integration.test.ts` and `wasmRollback.ts`
  (#1126), `wasmHost.integration.test.ts`, `wasmTraps.ts`,
  `engine-rs/src/extermination_tests.rs`,
  `loaderCases.integration.test.ts`.
- Docs: this spec, `spec-874-runtime-fallback.md` (the three "not yet"
  notes), the backlog rows, `story-engine-retire-typescript.md`, the
  changelog.

# Tests

- **#1113, real engine.** Host a tower, then load one whose `fromSave` throws
  a `WebAssembly.RuntimeError` before it runs: that tower stays on
  TypeScript, the fallback is `attach-refused` at `adopt` with `latched`, and
  `status.latched` is true. A third tower stays on TypeScript, and no call
  reaches the module after the trap (every module function and the engines'
  methods are counted). A trap in the first catalog read latches at the
  start through `readCatalog`'s wrapper, with one call made.
- **#1113, fake engine.** A first tower's trap latches at the start and calls
  no catalog; the borrow error, a stack overflow and another realm's error
  latch too; a clean refusal does not (it asks the catalogs again), and the
  next tower is hosted; a plain error from the attach's frame read frees the
  engine, and a trap there lets it go untouched; a trap in the catalog read,
  in the catalog check behind a refusal, in the free behind a refusal and in
  a healthy tower's free as it is let go each latch (the healthy tower's also
  ends the redo hold, and the one behind a refusal keeps the refusal's
  message); a clean throw from either free does not latch. A runtime fault calls
  `onFallback(..., true)` and sets `status.latched`. The attach reads the
  frame view once.
- **#1113, boot.** A later tower's latch turns the writer off and records the
  boot state at `host`; a first tower's latch keeps the writer off after
  start and records the boot state at `start` with its message.
- **#1126.** A newest point that fails to load and a merge that loads: the
  status names the merge with `skipped: 1`, the player reads `OLDER`, an edit
  after the merge is gone, the undo trail is cleared and not tidied, and on
  the real engine the lost edit's event, which left the host with the newest
  point, is counted; with the game's real undo history, undo then has
  nothing to undo. A newest point that loads records `skipped: 0` and keeps
  its line.
- **Follow-up (the independent review of #1230).** An undo's own snapshot
  that went past the newest point clears the trail and says `CLEARED`, with
  the point on `status.restorePoint`, on the fake engine and with the real
  undo history (redo then has nothing to redo), and a redo's does the same
  (undo then has nothing to undo); a load after such a save keeps
  `REPLACED` and records no point, and a snapshot of the newest point
  records `skipped: 0` and tidies. The recovery goes back to the point an
  undo capture's save answered with, on the real engine, though the newest
  would load the second time, and `RestorePoints.restore` never walks back
  to a newer point, and walks on to an older one, recording it, when the
  point a save answered with does not load again. A trap in the free behind a relay's refusal latches and
  keeps the refusal's message. A trap in a healthy tower's free behind a
  clean throw from an earlier step latches the next tower, and the log names
  both; with several errors, the trap is the cause even when it sat three
  wrappers deep. Each of these fails without its fix. Regression guards,
  which pin what the base already did and fail when the line they pin is
  removed: a
  clean throw in the free behind a relay's refusal does not latch and the
  next tower is hosted; the tower keeps its own events; `runEach` throws a
  lone error as it is; an attach whose frame overruns its record count is
  refused and its engine freed; a healthy detach leaves the event buffer
  open.
- **#1149.** An adopt that throws after its release shows `SWAP_FAILED`; an
  edit on the stuck tower sends no event, while the events the host handed
  back still reach the game; a later load inherits none of the stuck tower's
  own events. No point loading still shows `STUCK`.

# Hot path

The proportional HP-1 to HP-12 record (`docs/performance/hot-path-review.md`)
is in the PR. Two changes sit on a hot path:

- `mergeSimulation`'s copy of the billed list, from `merge` (`syncFrame`) and
  `mergeSave` (the worker reply): every merge, so per game hour and per
  structural edit on both hosts. O(k), k at most the billed rooms, and only
  during a one-day booking: at most about 2,900 numbers on the large fixture,
  beside the merge's own deserialize of every unit.
- The attach's frame read, from `follow` on every attach (start, load, new
  game, every undo and redo): one `frameView` and a header decode with the
  records checked, where it was two `frameView` calls and a full decode
  (#1158 A25). One Rust walk, one boundary copy (about 2 MiB on large) and
  every per-unit object fewer per attach.

Everything else runs per attach failure, per fault (at most once per page
life) or per faulted detach. Measurements: none (no timed path got slower;
the attach change removes work).

Restore points under the owner's R6 decision (2026-10-20 22:07 UTC): a
fallback may lose up to 30 seconds of play. On today's host the newest point
is at most the play since the last 30-second autosave while its timer fires
on time, or less after an undo capture, a merge or an export; this PR does
not measure or enforce that bound, which the facade's restore points prove
(slice 8). A recovery from an older point loses more, and says so (`OLDER`).

# Versioning

The two lines are player-visible on the opt-in WASM engine, so the app takes
a minor bump: 2.44.0. The engine crate does not move: no save, frame, catalog,
identity or interface change, and the Rust change is a test.

The follow-up adds a line a player can see (`CLEARED`) and changes when the
history is cleared, a visible fix, so it takes the next free minor too:
2.46.0, after #1183's 2.45.0. Whichever of it and another bump merges second
takes the next free minor.

# Review

`/gds-code-review` (the host's recovery is gameplay-parity work, as #874's
was), then the independent review thread's GO before merge. No auto-merge
before that review completes. The follow-up PR (items 1 to 5 of that
review; item 6 was information) runs the same review and goes back to the
same reviewer, and closes #1126.
