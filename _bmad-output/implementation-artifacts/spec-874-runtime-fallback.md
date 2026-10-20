---
title: 'Fall back to TypeScript when the hosted WASM engine throws or traps'
type: bugfix
created: '2026-10-20'
status: in-review
baseline_commit: c12bc1be (main, after #1137, #1140, #1144, #1125 and #1142 merged)
context:
  - CONTRIBUTING.md
  - _bmad-output/project-context.md
  - _bmad-output/planning-artifacts/rust-wasm-web-cutover-plan-2026-10.md (S4)
  - _bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md (section 9.1, A3; draft PR #1080)
---

# Intent

**Problem.** While a tower is hosted (`?engine=wasm`, and every tower in a
wasm-only build), the host's command sink calls the engine synchronously and
the tick override calls `engine.tick` and syncs the frame directly. A binding
throw reaches the command's caller after the instance has already changed.
A trap (a Rust panic, `RuntimeError: unreachable`) leaves the engine
poisoned: every later call into it throws, the frame loop logs a frame error
every two seconds, and nothing moves again. "The switch never takes the game
down" holds only at package load and attach. Detaching the poisoned host
today would hand the TypeScript tick a read model whose crowd has no routes
(the frame view carries where each person is but none of their route legs),
which is unsafe to continue.

**Approach** (owner's handoff on #874, 2026-10-16; cutover plan S4):

1. Catch every throw on the host's paths into the engine: commands,
   ticks, frame syncs, drains and saves.
2. Freeze the faulted instance at once: later ticks and commands no longer
   reach the engine, and nothing on it throws again.
3. Re-adopt a validated, engine-written restore point on a fresh TypeScript
   `Simulation`, with the gameplay events and the log handed over, and
   never resume the TypeScript tick on the partially synchronized read
   model.
4. Record the fallback on `WasmHostStatus` (`fallbacks`, `lastFallback`,
   `lastError`) and report it through `onFallback` (the `engine_status`
   `fallback` row A1 already sends).
5. In a wasm-only build, call `onFatal` and stop. There is no silent
   fallback to TypeScript there.

TypeScript stays the default engine. The default flip stays gated by #945.

## Boundaries

- **Always:** keep the closed analytics codes (`FALLBACK_REASONS`,
  `FALLBACK_STAGES`) as A1 shipped them; send no new `engine_status` field
  or value. Keep the save format. Keep every existing host behavior on
  paths that do not throw.
- **Ask first:** a new analytics field or value; a save version change.
- **Never:** flip the default engine, publish 3.0.0, edit #1068's
  performance files (`src/tests/perfCompare/`, `src/tests/perfWorker/`),
  edit the offline package integrity lane's files (service worker, PWA
  config, package manifest and integrity checks: #1047, #985), or change
  #1092's implementation.

## Fault paths

| Path | Throws from | Reason code | After the fault |
| --- | --- | --- | --- |
| A command | the relay sink (`shadow.apply`) | `trap-command` | the caller gets the instance's answer; the recovery, before the next frame, undoes the command and says so (see Recovery) |
| The undo capture before an edit | the hosted `serialize` the capture reads | `trap-command` | the capture gets the newest point, the edit runs on the frozen tower, and the recovery takes it away |
| A tick | the tick override (`engine.tick`, then the frame sync) | `trap-tick` | the tick returns; later ticks do nothing |
| A frame sync outside a tick | `flush`, `settle`, `syncStructure` | `trap-tick` | returns |
| The event drain | `drainGameplayEvents`, the drop count | `trap-tick` | returns the events the host still holds |
| A save or snapshot | `serialize` | `other` | returns the newest restore point's save |
| Letting a tower go | the detach's last reads (a frame sync, the commute rows, the events) | `other` | the detach finishes, frees nothing it cannot, and never throws |
| Any of the above during an undo or redo | | `trap-undo` | as above |

The stage is how the faulted tower was hosted (`start`, `adopt` or `undo`),
so a trap code plus a stage says which path faulted on which kind of tower,
and A1's closed lists need no new value. `engineBoot.ts`'s note that "#874
adds its runtime stages here" changes to say this.

A binding throw that is no trap (a parse error, an unknown kind) is treated
the same way: the engine may have changed part of its state before it threw,
and a refusal comes back as an answer (`build` returns `{ ok, reason }`, for
example), so a throw is no refusal. A throw in the host's own TypeScript sync
code is coded the same way too; telling the two apart needs a new reason
value, which is an owner decision (deferred, see the Review record).

## Restore points

A point is an engine save text that is known to load, so the fresh tower
starts from state the engine wrote. Every engine save the host already
reads is a point, so the points cost no save on any path a player drives:

- **every merge's save.** The engine's hour pass merges every game hour,
  and a structural command merges at the next sync.
- **every hosted save.** The tower's `serialize` answers with the engine's
  save, as it does on main. The undo capture before every edit reads one,
  so the newest point is never older than the edit under way; an autosave
  and an export read one too.
- **the attach save**, the one the engine was built from (`loadCommand`),
  until the first merge.

One more save is taken only when a tick's events would leave the engine (at
a drain or before a command) with no point behind them. The engine's tick
events come with the hour pass, whose merge reads them first, so this is
rare: the restore-point benchmark counts it, and its report lists any such
save as a problem.

Validation happens at recovery: `Simulation.deserialize(JSON.parse(text))`.
When the newest point fails, the merge's and then the attach save are tried
in that order (a recovery from an older point does not say so yet, #1126). A save asked of the frozen tower answers with the
same point the recovery uses (`RestorePoints.newestSave`), and throws only
when no point loads, which cannot happen while a merge's save or the attach
save is kept, since TypeScript loaded both.

**Events.** A fallback goes back to its point and runs on from there on the
TypeScript engine, which emits the events of that time again. So an event
leaves the host only once a point covers it:

- A hosted save reads the engine's pending events with it, both or
  neither: when the save throws, the events read with it are dropped.
- A relayed command pulls the tick events still in the engine first (with a
  point when there are any), then runs, and its own events are **held**.
  They go to the game when the next point covers them: a merge, a hosted
  save (the next edit's undo capture, an autosave), the tick pull's own
  point, or a healthy detach. A fault drops them, since the recovery goes
  back to a point before them. So no event of an edit a fallback takes away
  reaches the game: a paused drag, a completed edit no merge covered yet,
  and an action that takes no undo capture (an emergency answer, an
  exterminator call, a rename) included.
- The analytics session's own flush (a hide, or a window closing) lets the
  held events go too, after a drain that did not fault, so a page that
  closes keeps them. A fault after that flush and before a point then takes
  away an edit whose events analytics already has: an event with no edit
  behind it, counted again if the player makes the same edit again. It
  needs a hide in that gap and changes nothing in the game.
- An edit that an undo takes back while the undo's snapshot traps loses its
  own events with it, so analytics undercounts that edit and counts nothing
  twice.
- Events still in the engine at the fault are emitted again by the
  TypeScript engine from the point.

Each event is delivered once when the recovery loads the newest point. When
it falls back to an older point, the TypeScript engine can emit events the
game already has (#1126).

**Cost.** #874 adds no engine save per command or per tick. The undo
capture's save is main's: on main the hosted tower's `serialize` reads
`engine.serialize()` too. #874 adds event reads: every relayed command,
`emit` and `setView` included, reads the engine's pending events before
`shadow.apply` (`pullTicks`) and after it (`readEvents`), and every merge
and every hosted save reads them once more. It keeps a reference to each
point's text, up to three texts in all (the newest save, the newest
merge's and, until the first merge, the attach save). Holding a command's
events costs an array push, and the redo hold keeps at most one cleared
redo trail, only for a hosted tower in a build that falls back (see
Recovery). The restore-point benchmark measures every
engine event read as `pullMs` (the frame loop's own drain included) with
its share of the step, beside the saves, on the owner's PC.

> **Container figures: a snapshot of 2026-10-20, not refreshing.** Indicative
> only, from a cloud container; the owner's PC run is the evidence. The live
> figures come
> from `npm run perf:restore` (`scripts/perf-restore-points.ts`, its report
> pinned by `src/tests/perfRestore/report.test.ts`) on the owner's PC, under
> `docs/performance/benchmark-protocol.md`.
>
> `engine.serialize` took 57.84 ms on the largest perf tower (43,358 units,
> a 2.39 MB save). Two `--quick` runs of the benchmark (2 reps) showed 0
> extra saves in every workload, the frame loop's per-frame drain included.

**Lost progress, bounded.** A fallback goes back to the newest point, so it
loses everything since the newest merge or hosted save:

- the edit under way (from its undo capture, or from the newest merge
  inside a drag);
- two edits when the edit before had not merged yet (paused, or a
  non-structural command inside the hour) and the next edit's own capture
  save is what traps;
- any action taken since that point without an undo capture (an emergency
  answer, an exterminator call, a rename);
- the game time since that point, up to an in-game hour while the clock
  runs, since the hour pass merges.

The speed and the bridging toggle are not tower state and are kept.

An earlier draft took a point before every command after a tick and at every
tick after a command, which read up to two extra saves per drag step on top
of the merge. A second draft took points only at merges, which lost every
edit made while paused. Both were dropped.

## Recovery

- **Deferred to a microtask.** The frame or the handler that faulted
  finishes on the frozen instance; nothing swaps the tower under a caller
  that still holds it (the fixed step keeps ticking `host.sim` up to four
  times a frame). A command runs in an input handler, outside the frame
  callback, so the recovery runs before the next frame is drawn and the
  player never sees the lost edit. A trap in a tick or a frame sync happens
  inside the frame callback, which draws the frozen tower once before the
  recovery.
- **What the player sees (the owner's review of #1101).** The trapped
  command answers its caller with the TypeScript instance's result, so the
  tool's own feedback for that click (a placement sound, a success toast)
  can still play. The rollback is not silent: before the next frame, the
  money, the rooms and the transports come from the restored tower, the
  undo trail drops the step the lost edit left (it would change nothing
  now) and gets back the redo steps that edit cleared, and the log gains
  one line of kind `bad`, which the UI shows as an
  alert toast: "The WASM engine stopped, so the tower went back to its last
  good state and your recent changes were undone. It runs on the TypeScript
  engine now." That line needs both a command relayed since the newest point
  (`lostEdits`, which counts neither log lines nor the camera) and a
  player-visible difference between the frozen tower and the point (rooms,
  transports and money, the tower's name, a pending choice). Otherwise, as
  when only the clock moved on, the line is "The WASM engine stopped, so the
  tower went back to its last good state and runs on the TypeScript
  engine." If comparing the two throws, the command count alone decides.
  Nothing of the lost edit stays: no event, no undo step, no cleared redo
  trail, no charge. A refusal answer for the trapped command
  instead would need a refusal value of each command's own shape (about 45
  commands and the setters), new decision logic in temporary code; after
  #954 the engine answers first, so a trap is a failed answer by
  construction.
- **Skipped** when the host has stopped, with no line. **Skipped too** when
  the app no longer holds the faulted tower (a load, a new game, an undo or
  a redo replaced it, and that tower is not hosted), and the player still
  gets a line. After an undo or a redo whose own snapshot trapped, that
  snapshot is the newest point, from before any edit no point covered, so
  the undo and redo steps that would now change nothing are dropped too.
  When an undo or a redo replaced the tower and a command was relayed since
  the newest point (`lostEdits`), or that tidy dropped a step, changes were
  lost and the line says so: "The WASM engine stopped, so some of your
  recent changes were lost. The game runs on the TypeScript engine now."
  Otherwise it is "The WASM engine stopped, so the game runs on the
  TypeScript engine now." A load or a new game (the swap that drops the
  undo trail) gets that plain line whatever ran before it: the player's
  own load let the old tower's changes go, and the line would otherwise
  read as damage to the tower just opened. An adopt that throws after the
  faulted host was let go, with the app still on the faulted tower, still
  restores.
- **`app.adoptSim(fresh, true)`**, the undo path: it keeps the camera, the
  undo history and the bridging toggle, and a title screen that is still up
  (`Onboarding.adoptSim(sim, keepSplash)`). The adopt wrapper's release
  detaches the faulted host, which hands back the events it holds with the
  drop count, and GameApp's adopt passes them to the fresh tower. Then
  `app.dropEmptyUndo()` (`UndoHistory.dropUnchanged`) pops the undo and redo
  steps that would change nothing now.
- **The redo trail.** A new edit clears the redo trail. While a hosted
  tower can fall back (in a switchable build, from each attach until the
  host stops, a tower is left on TypeScript, or a fault's recovery ends),
  `UndoHistory.commit` keeps the steps it cleared on the edit's own undo
  step (`holdClearedRedo`, set through `app.holdClearedRedo`), and
  `dropUnchanged` puts them back when it drops that step. One step holds a
  trail at a time: a later commit that clears a trail lets the older one
  go, since the undo that made that trail read a point after the older
  step, so no fallback can drop it; and turning the hold off lets it go
  too. An undo of the holding step forgets its trail, as main does. A
  wasm-only build, which stops instead of falling back, a tower the host
  refused and a TypeScript-only game never hold.
- **A gesture under way at the fault.** Its undo capture stays pending, and
  `dropUnchanged` fingerprints it again from its own snapshot. A capture
  whose save trapped took the newest point, which is where the recovery
  went, so a release after the recovery with nothing done since leaves no
  step (and no redo trail is cleared); a drag that goes on over the
  restored tower leaves one step, which undoes what it did there. A capture
  that read the tower itself keeps its fingerprint.
- **No point loads, or the adopt throws:** the error is recorded, the frozen
  tower stays (its tick does nothing, its save is the newest point), and the
  player reads "The WASM engine stopped, and the tower could not go back to a
  good state. Load a save or start a new tower to keep playing."
- **Live state no save carries** goes from the frozen read model to the
  fresh tower (`carryLiveState`, each part on its own, best effort): the
  elevator telemetry for the fresh tower's shafts, yesterday's housekeeping
  report, the commute-stress averages and the analytics hand-off flag.
- **No tower is hosted again in this page life.** A trapped module may be
  corrupt, so a later load or new game stays on TypeScript, and `hosted`
  stays false. The boot turns the engine save writer off too, since it runs
  in the same module, and records the fault in the boot state.
- **Strict (wasm-only) builds:** `onFatal(message, reason)` once, no
  recovery; the boot's existing stop shows the failure and sets the speed to
  0. The frozen instance answers a save with the newest point.

## Commute averages (#1083)

The per-origin commute-stress averages are live state no save carries. The
load command's markers carry the instance's rows, and the engine seeds its
accumulator from them, so an attach keeps the averages instead of adopting
the engine's empty map at the first sync. This covers the main-thread
host, the worker host and the dual run, which all start their engines from
`loadCommand`. Malformed rows refuse the load, and rows read back from the
engine need a whole floor and a finite wait.

## Lifetimes (TypeScript retirement)

Per the owner's direction of 2026-10-20 (one authoritative Rust engine; the
TypeScript simulation is a temporary fallback until an approved
retirement):

| Part | Class | At retirement |
| --- | --- | --- |
| `FaultLatch`, the guarded paths in `wasmHost.ts`, the fault record and report in `startWasmHost.ts`, the strict `onFatal` stop, `RestorePoints.newestSave` without its TypeScript load check (the strict build's save after a fault), the trap codes, the save writer turned off, `createAppHistory`, `Onboarding.adoptSim`'s `keepSplash`; in tests, the trap helper `wasmTraps.ts` and `wasmHostFallback`'s latch, strict-stop and trap-coding cases (each without its recovery assertions) | Permanent host and app infrastructure | Stays: a Rust-only build still freezes and stops cleanly on a trap |
| The rest of `RestorePoints`, `carryLiveState`, the point and event bookkeeping (`readPoint`, `pullTicks`, `HostEvents` with the held events and `lostEdits`), `recover`, `playerState`, `keptHistory`, `tidyHistory`, `holdRedo`, the player lines (`REPLACED`, `LOST`, `RESTORED`, `UNDONE`, `STUCK`), the frozen tower's own tick, the TypeScript re-adoption, `UndoHistory.dropUnchanged`, `holdClearedRedo` and the `signatureOf` port, `dropEmptyUndo` and `holdClearedRedo` (`GameApp`, `WasmHostApp`), the analytics bridge's `release` option, the restore-point benchmark (`perf:restore`), the fallback-only tests and the assertions of temporary behavior in changed tests | Temporary fallback code | Removed with the TypeScript simulation (each listed in `story-engine-retire-typescript.md`) |
| The commute rows in the load markers and `Crowd::seed_commute_stress` | Rust-authoritative gameplay state | Stays: a load or re-host keeps the averages |

## Out of scope, flagged

- **The worker host** (`?engine=wasm-worker`, experimental) has the same
  unsafe step: a worker crash or a fatal reply detaches and leaves the read
  model, crowd included, on the TypeScript tick. Its saves arrive
  asynchronously, and #1068 (held) rewrites `workerHost.ts` and adds
  `workerSaveSync.ts`, so its restore is #1105, after #1068 or the RUN-0b
  sync decision (OD-9).
- **Reporting an engine refusal of a command the instance accepted** (S4's
  third clause, and the issue's last sentence). The binding's command
  answers differ per command (JSON results, booleans, numbers, nothing), so
  telling a refusal apart needs the per-command adapter #954 builds, and
  #954 replaces the instance-first relay that makes such a disagreement
  possible. Recorded on #954's row; `divergence_reports` moved there, and
  the release plan's A3 row and the cutover plan's S4 row say so.
- **#1020's host edge** stays on its row (P3): #874 does not change the
  step host's pending-choice read. Its other edge, an adopt that throws
  before its swap, is handled by the recovery now (the tower still
  restores).
- **An exterminator booking pending at the trap** keeps its billed rooms
  after the fallback: #1092 merges this in and pins it in
  `wasmHostExtermination.integration.test.ts` (a trap in a tick and in a
  command); #874 stays open until it lands.
- **A rollout, the default flip, a gate exception:** owner decisions (#945).

## Code map

- [x] `src/wasmhost/hostFault.ts` (new): the fault latch and its coding,
  the restore points, `carryLiveState`.
- [x] `src/wasmhost/wasmHost.ts`: catch on every path above, freeze after a
  fault, a detach that never throws, the frozen tower's own tick, the points
  and the event bookkeeping, the `onFault` and `context` options. The frame
  writers, the catalog check and the event bookkeeping moved to
  `frameSync.ts`, `catalogCheck.ts` and `hostEvents.ts` to stay under the
  file ceiling.
- [x] `src/wasmhost/startWasmHost.ts`: record, report, latch, strict fatal,
  the deferred recovery and its player lines, the undo, redo and capture
  context.
- [x] `src/game/appHistory.ts` (new), `src/engine/UndoHistory.ts`,
  `src/main.ts`, `src/ui/Onboarding.ts`: the app's undo history moved out of
  `main.ts` (its import moves with it, so the frontend import ratchet gains
  the `src/game/appHistory.ts` line and `src/main.ts` loses `UndoHistory`),
  `dropUnchanged`, the redo hold, `dropEmptyUndo`, `holdClearedRedo`, and
  the title screen kept through an undo or a fallback.
- [x] `src/bootstrap.ts`: turn the engine save writer off on a runtime
  fault, and record it in the boot state (`bootstrapEngine.test.ts` pins the
  switchable build's path: no stop message, the writer off, the boot state).
- [x] `src/analyticsEngineBridge.ts`: the session's flush lets held command
  events go (`drainGameplayEvents({ release: true })`).
- [x] `src/dualrun/mirror.ts`, `src/dualrun/commands.ts`,
  `engine-rs/src/wasm.rs`, `engine-rs/src/crowd/mod.rs`: commute rows in
  the load markers (#1083).
- [x] `src/wasmhost/engineBoot.ts`, `src/analyticsEngineStatus.ts`,
  `docs/analytics-data-map.md`, `scripts/engine-reliability.mjs`
  (comments only): the codes and stages.
- [x] `vite.config.ts`: the real-engine rollback test files start their own
  host, so the parity projects leave them out.
- [x] Backlog: #874's row stays open at P1 until #1092; #1083's row done;
  #954's row takes the refusal report; #1105's row for the worker; the
  defers from both review rounds, each with an issue.
- [x] `package.json` minor bump with a changelog line (2.40.0 against main
  at c12bc1be, where #1137 took 2.39.0; set again at merge time if main
  moves).
- [x] e2e: a forced tick and command trap on `chromium-wasm`
  (`e2e/wasmFallback.spec.ts`), and a trap on the wasm-only build that
  stops the game (`e2e/wasmOnly.spec.ts`).
- [x] The restore-point benchmark for the owner's PC (`npm run perf:restore`).

## Acceptance

- A command that throws after the engine changed part of its state: the
  caller gets the instance's answer, the status records `trap-command` once,
  and before the next frame the tower is the newest point's (the edit's
  undo capture): its money, rooms, undo and redo trails (the redo steps the
  edit cleared included), log and events show nothing of the lost edit,
  and the log's last line says the recent changes were undone.
- A trapped undo or redo snapshot that loses a change no point covered (a
  relayed command, or a step the tidy drops) says the recent changes were
  lost. A load or a new game whose letting go traps says only that the
  engine stopped.
- A press whose undo capture's save traps, released after the recovery:
  no undo step that changes nothing, and the redo trail the lost edit held
  stays.
- A tick that traps with a live crowd: the rest of the frame does nothing,
  then a fresh TypeScript tower from the restore point replaces the read
  model. Its crowd is the save's (empty until it respawns), and no person
  from the read model survives into it.
- Repeated traps, and re-entry (a trap while handling one, a drain or save
  on the frozen instance, a second tick in the same frame, the owner's
  callbacks calling back in): one fallback, one recovery, and nothing throws
  to the caller, but for a save when no point loads (which cannot happen
  while a merge's save or the attach save is kept).
- Save and event integrity: a save taken between the fault and the recovery
  is the restore point; the restored tower's save round-trips with its
  identity (version, seed, mode, calendar); a command's events wait for a
  point, and a fault drops them; every event a point covered is delivered
  once, and the TypeScript engine, running on from the newest point, emits
  none of them again.
- Cost: ticks and commands, a drag and rapid edits included, read no save
  beyond the merges' and the hosted saves main already reads.
- Strict mode: `onFatal` with the trap's code, once; no TypeScript tower is
  adopted.
- A trap in a command, an undo capture, a tick, an undo and a redo each
  sends its code through `onFallback`.
- The attach seeds the engine's commute averages from the instance's.
- e2e: a forced trap in the browser falls back, the player gets the alert
  toast, and the game keeps running.

## Tests

Every path runs against the real WASM engine (`npm run test:wasm`). A trap
is injected at the binding boundary on the real engine
(`src/tests/integration/wasmTraps.ts`): the real method runs (so the
engine's state has changed), then the call throws
`WebAssembly.RuntimeError("unreachable")`, and every later call on that
engine throws wasm-bindgen's "recursive use of an object" error, as a
poisoned engine does.

- `wasmHostFallback.integration.test.ts`: the tick, command, drain, save,
  undo and redo traps, re-entry, the strict stop, and event integrity.
- `wasmHostRollback.integration.test.ts` (the owner's review): a build, a
  bulldoze, a sell, a car bought, a rent change and an elevator resize,
  each trapped after the engine ran it, with the real undo history: the
  reported answer, the money, the rooms, the undo trail, the log line, the
  events and the restored save, checked against a last good state read
  from the read model (no hosted save of the test's own); a running drag
  that keeps its merged tiles and stays one undo step; a paused drag undone
  whole with none of its events delivered; an emergency started with no
  undo capture and taken back by a tick trap.
- `wasmHostRollbackHistory.integration.test.ts`: a trap in the undo
  capture's own save, after a merge and after an unmerged edit (both edits
  lost); an undo whose snapshot traps, with the edit merged (the redo stays)
  and unmerged (the redo goes, and the line says changes were lost); a
  rename no point covers, lost with an undo's trapped snapshot (the line
  says so, and the redo still works); a redo whose snapshot traps; the redo
  trail a trapped edit cleared, back after the recovery; a press whose
  capture's save traps and whose release comes after the recovery (no
  empty step, with and without a held redo trail, and a drag that goes on
  over the restored tower); a load whose letting go traps (the plain line).
  `wasmRollback.ts` is their shared setting.
- `undoHistory.integration.test.ts`: `dropUnchanged`, and the redo hold
  (the cleared trail comes back under one or two dropped steps, an undo
  forgets it, one step holds a trail at a time, turning the hold off lets
  it go, and with the hold off the trail clears as on main; the number of
  held trails is counted on both stacks), and the pending capture's
  fingerprint after the tidy.
- The fake engine covers the host's bookkeeping and the point rule in the
  unit project (`hostFault.test.ts`, `wasmHostPoints.test.ts`, the flush
  whose own drain faults included, `startWasmHost.test.ts`,
  `startWasmHostRecovery.test.ts`, the `LOST` line, the plain line after a
  load, and the hold's on and off included, with none in a wasm-only build
  or for a refused tower). `wasmHostRollback.integration.test.ts` pins the same flush
  on the real engine.
- `src/tests/perfRestore/report.test.ts` pins the benchmark's problem list:
  an extra save, saves counted above the engine's, and an `edits` run with
  fewer hosted saves than edits.
- The e2e specs force the same trap through `window.__vcEngine` on the
  `chromium-wasm` project (asserting the alert toast) and on the wasm-only
  build.

Existing tests that pinned the pre-#874 behavior and changed with it, each
listed (a title in brackets is the old one):

- `mirror.test.ts`, "stamps checkpoints with the generation and loads the
  boundary markers": the markers carry the commute rows (#1083).
- `wasmHost.integration.test.ts`:
  - "lets go of the instance when the engine can no longer answer at
    detach": the detach faults and freezes the tower instead of throwing,
    and the held placements go with their commands (`host.restore()`).
  - "counts a batch it cannot read as dropped, while hosted and at detach":
    the garbled drain is set before the builds, and a hosted save covers
    the one that reads.
  - "keeps an unreadable batch's loss when the engine traps at detach, and
    drops the held events no point covered" ["keeps an unreadable batch's
    loss when the engine traps at detach"]: no throw; the two placements no
    point covered are dropped, and the drop count leaves them out (#1147).
  - "freezes on a drain that traps and hands back every event a point
    covers" ["counts what a trap took while hosted once the host lets go"]:
    the drain faults, hands back what the merge covered, and the restored
    tower has the merged rooms only (`host.restore()`).
  - "keeps the instance's own buffer across a merge": the merge moves the
    placement behind the host instead of leaving the read model's copy.
- `capacityEventMatrix.integration.test.ts`, "`${what}: ${expected} event on
  the hosted engine`" and "reports once across the host's hour merge into
  the instance": they read the events after a hosted save covers them.
- `wasmHostAnalyticsBridge.integration.test.ts`:
  - "reports a `${what}` as `${action}` on both engines": the hosted engine
    sends nothing before a point ("before a point" assertions), then the
    same event.
  - "reports each removal as demolish with its method, and a refused one as
    nothing, on both engines": drains after a point.
  - "loses and repeats nothing when the engine fails a drain and the host
    falls back" ["loses and repeats nothing when the engine fails one
    drain"]: the failed drain is a fault that re-adopts the tower.
- `startWasmHost.test.ts`:
  - "latches hosting off when %s traps while a load lets the tower go"
    (`it.each` over the drain and the drop count) ["swaps away from a
    trapped engine and carries the loss to the new tower", and "counts a
    trap at the drop count from the read model", deleted and folded in]:
    the trap is a fault that latches hosting off, with no read-model copy
    count, and the player gets the `REPLACED` line.
  - "stops cleanly on a trapped engine": the stopped tower is frozen on its
    newest point, and a stopped handle recovers nothing.
- `wasmHostFrame.test.ts`, "faults, frees the engine and freezes the tower
  when the commute rows at detach are malformed (#874)" ["still frees the
  engine and gives the tower back when the commute rows at detach are
  malformed"].
- `frameApply.test.ts`: its import moved with the frame writers
  (`frameSync.ts`); no assertion changed.

The ones that assert temporary behavior (the restore, the held events, the
`REPLACED` line, the bridge's fallback and "before a point" assertions) are
listed for removal in `story-engine-retire-typescript.md`, with
`bootstrapEngine.test.ts`'s switchable fault path.

## Restore-point benchmark

`npm run perf:restore` (`scripts/perf-restore-points.ts`,
`src/tests/perfRestore/`) times the hosted tower on the three perf
scenarios (small, medium, large) at 1x and 4x CPU throttle, 10 repetitions
in a fresh browser process each, with four workloads, every step ending
with the frame loop's event drain: plain frames, a drag (one floor tile
before every frame, a structural command), a click-paced plain command (a
rent change every 20 frames), and rapid edits (every step a whole gesture:
the undo capture, one floor tile and the commit). The points have no off
switch to compare against, so it counts and times the work directly: the
engine saves beyond the merges' and the hosted saves (the design expects
none), every engine save per command and its time (what serialization
costs each edit), the time in the event pulls and its share of the step,
what one point costs and how large it is, and what a fallback pays once
(parsing the point and loading it on TypeScript). It writes `results.json`
(after every run) and `report.md` under `docs/performance/results/`, with
the snapshot header first, and names faulted runs, refused or missing
commands, an extra save, a changed package and a dirty tree as problems.
Container numbers are indicative only; the owner's PC run under
`docs/performance/benchmark-protocol.md` is the evidence. The `edits`
workload is the owner's rapid-edit check.

## Merge

#1059 (PR #1100) merged first; this branch merges main. #1092 merges this
after it lands and adds the trap mid-booking test, and #874 closes then.

## Review record

**Round 1 (2026-10-20), `/gds-code-review` (host and engine paths) and
`/bmad-code-review` (boot, app and tooling plumbing), each with the Blind
Hunter, Edge Case Hunter and Acceptance Auditor layers, on the diff from
#1059's branch.** Patch findings, all fixed:

- A trap while letting a tower go threw out of the swap and left the next
  tower unhosted: the detach's reads are guarded and latch the fault, the
  release detaches before it lets go, and a fault from a host already let
  go is ignored.
- The frozen tower could still be ticked on its partial read model by a
  caller holding it (a stop before the recovery, an async settle): its tick
  now does nothing, and its save stays the restore point.
- The recovery could throw out of the microtask (an adopt that throws) or
  say nothing when no point loads: both are recorded and the player gets a
  line.
- `carryLiveState` could fail the recovery on one bad part: each part is
  best effort.
- `newestSave` handed out a save it had not loaded; it now answers with the
  point the recovery uses. The attach save is dropped after the first merge.
- Non-finite commute rows from the engine reached the crowd: filtered.
- The undo wrapper dropped `undo`'s return value: kept.
- An event read whose save then threw kept its events, so the replay could
  emit them twice: a point's events and its save are kept both or neither.
- **The Acceptance Auditor's main finding:** the frame loop drains events
  every frame, but the benchmark never drained, so its zero extra saves was
  true by construction. The benchmark now drains every step, as the frame
  loop does, and still shows zero.
- Points only at merges lost every edit made while paused. Hosted saves
  (the undo capture before each edit) are points now, at no added cost.
- Benchmark tooling: faulted runs leave the medians, a measurement that
  throws is recorded as a fault, results are written after every run,
  every page call has a time limit, the package is checked again after the
  run, repeated rates and scenarios are dropped, the workload order rotates,
  `gc()` runs before each timed run, the clock's isolation is recorded, and
  the header names `report.test.ts`.
- Docs: `trap-tick` includes the drain, `other` covers saves and the
  teardown reads, the capture's save is coded `trap-command`, the
  `writer_latched` note, and the changelog's bound.

Defers, recorded in the backlog with issues: a throw in the host's own
TypeScript sync code is coded as an engine trap (telling them apart needs a
new reason value, an owner decision), and a trap while attaching is coded
`attach-refused` and the module is used again for the next tower.
Dismissed: undo steps that hold newer states (they are valid engine saves);
analytics counting a completed command's events after a later fault takes
it away (delivered once, by design, as an undone edit's); a fallback not
carrying the load markers (it behaves as a load); synchronous clock loops
(the game's loops are capped).

**The owner's review on #1101 (2026-10-20).** A command can report success
before a Rust trap rolls it back: answered in Recovery ("What the player
sees"), with `wasmHostRollback.integration.test.ts` covering money,
placement, undo history, feedback, events, log and the save on the real
engine, and the rapid-edits workload in the benchmark.

**Round 2 (2026-10-20): the independent review of f53d763, NO-GO** (review
5587730161 on #1101; Copilot and Codex were unavailable, so the owner's rule
of 2026-10-20 applies). What held: no added saves, the latch, both or
neither, the strict stop, the analytics codes, #1083's Rust side. Fixed:

- Events of an edit a fallback took away were already delivered, so their
  effects could repeat (a paused drag, a completed edit no merge covered, an
  action with no undo capture). A command's events are now held until a
  point covers them, and a fault drops them, with no added save.
- The lost-progress bound was wrong: stated now as everything since the
  newest merge or hosted save, with the two-edit case, and pinned by a test.
- An undo snapshot that trapped left a redo step that redid nothing:
  `dropUnchanged` checks the redo trail too.
- Real-engine trap tests for an elevator resize, an undo and a redo; the
  rollback tests read the last good state without a hosted save, check each
  answer and trail, run the full check in the drag and capture cases, and
  add a redo trail case.
- The e2e asserts the alert toast; the wasm-only spec's console filter no
  longer hides a failed stop or report.
- The undone line compares money too and is worded for a tick-only change.
- `perf:restore` lists an extra save as a problem, and the PC run notes name
  the rapid-edit workload.
- Lifetimes: the undo trail's tidy is temporary, `newestSave` stays for the
  strict path, and the fallback-only tests are listed for removal.
- Docs: the version, this file's baseline, the changelog line (which now
  names `?engine=wasm`, since the worker has no fallback yet, #1105), a
  dated window above the container figures, and the narrowed "nothing
  throws" and "never sees a frame" claims.
- The recovery's state check and its log lines cannot throw out of it; a
  boot test pins the switchable build's fault path.
- The release plan's A3 row and the cutover plan's S4 row give the refusal
  report to #954; #1083's ask to measure the commute rows' re-fetch cost
  moved to its own row (#1131) before #1083 closes.
- An adopt that throws before its swap now restores (the review offered it
  as a defer).

Defers, recorded in the backlog with issues: a recovery from an older point
does not say so, and can emit events the game already has (#1126); log
lines are written again after a fallback, so a toast can repeat, and a trap
between a merge and the log sync loses that hour's toasts (#1127); an open
elevator extend gesture is not carried to the fresh tower (#1128); the title
screen's version line still says "WASM engine" after a fault (#1129); and
`engineBridgeStats().drainFailures` no longer counts a main-thread drain
failure (#1130). Every binding throw counting as a trap, a JsError
included, is folded into #1114. The commute rows' re-fetch cost is #1131.

**Round 3 (2026-10-20): the independent re-review of 81a71018, CONDITIONAL
GO** (review 5589164278 on #1101). What held: the held events (probe R7: a
ransom answer's `emergency_resolved` is sent once), no added saves (probe
R8: none over a game day on four fixtures), the latch, the "undone" line's
state check, no deleted or skipped test, the moved files byte-identical, and
the deferrals' rows and issues. Fixed:

- The analytics flush released the held events before its own drain, so a
  drain that trapped still sent them (probe R1): the flush releases only
  after a drain that did not fault, with a fake-engine and a real-engine
  test.
- A rolled-back edit cleared the redo trail (probe R2): the redo hold keeps
  the cleared steps on the edit's undo step while the host can fall back,
  the tidy puts them back, and the test that pinned the cleared trail now
  pins it kept. Writing this record found that the hold could keep more
  than one trail; one step holds a trail at a time now, and turning the
  hold off lets it go, each with a test.
- A trapped undo or redo snapshot could lose changes with no word (probe
  R3, a rename): the `LOST` line, tested with that rename.
- `perf:restore` flags saves counted above the engine's and an `edits` run
  with fewer hosted saves than edits, each with a test.
- The fault messages read "while letting a tower go", "during a save" and
  so on, as their tests assert.
- Docs: the base commit; the two-edit bound's wording (paused, or a non-structural command
  inside the hour) here, in the backlog row and in the PR body; the
  changelog names the undone edits; the cost of the per-command event
  reads; every changed test, listed above; the flush trade-off as an event
  with no edit behind it; the lifetimes of the hold, the `LOST` line,
  `playerState` and the trap helper, and `wasmHostFallback`'s permanent
  cases; the refusal report given to #954 in the release plan, the #1064
  row and the roadmap's inventory; exact-line assertions;
  the "X, never Y" lines; stale e2e comments; the #1114 and #1131 rows.
- Version 2.40.0, since #1137 merged as 2.39.0 first. The longer changelog
  line ran past the update prompt's 200-character cap, which cuts a note
  mid-sentence; it fits now, and `changelog.test.ts` reads this build's
  notes whole.

Defers, recorded in the backlog with issues: a trapped detach during a load
drops the held events uncounted (#1147); refused commands count as edits for
the recovery's line (#1148, probe R5b); the `STUCK` line after an adopt that
throws though the point loaded (#1149); the boot state's engine at fault
time and `stopForEngine` on a switchable path (#1150); and a real-engine
trap test for an emergency answer, `resolveChoice` (#1151). The first
wasm-binding attempt's stall in `conformanceWasm.integration.test.ts` did
not reproduce in five local runs and is #1152.

**Round 3 fix check (2026-10-20): CONDITIONAL GO at 50ecb8e5** (review
5590072293 on #1101). All 11 items held, probes R1 to R3 passed on the
real engine, and a full `test:wasm` ran with no stall. Fixed:

- N1: a press whose undo capture's save trapped, with the edit before it
  unmerged, and whose release came after the recovery left an undo step
  that changed nothing and cleared the redo trail the tidy had put back.
  The pending capture kept the frozen tower's fingerprint; `dropUnchanged`
  now fingerprints it again from its own snapshot. Real-engine tests
  release after the recovery, with and without a held redo trail, and a
  drag that goes on over the restored tower keeps one step.
- A load or a new game whose letting go trapped showed the `LOST` line on
  the tower just opened. The line is `LOST` only when an undo or a redo
  replaced the tower (`keptHistory`), with a fake-engine and a real-engine
  test.
- The redo hold ran in wasm-only builds and for a refused tower, where no
  recovery can use it (up to 40 snapshots on the largest tower). The host
  now holds only for a hosted tower in a build that falls back, with tests.
- A test counts the held trails, so an undo that kept the trail on its
  redo step would fail; the spec's and the changelog's wording.
