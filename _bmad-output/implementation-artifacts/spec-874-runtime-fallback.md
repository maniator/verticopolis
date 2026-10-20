---
title: 'Fall back to TypeScript when the hosted WASM engine throws or traps'
type: bugfix
created: '2026-10-20'
status: in-review
baseline_commit: f508db44 (main, after #1100 (#1059) and #1039 merged)
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
(the frame view carries positions, not legs), which is unsafe to continue.

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
and its refusals arrive as answers, never as throws (`build` returns
`{ ok, reason }`, for example). A throw in the host's own TypeScript sync
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
  held events go too, so a page that closes keeps them. A fault after that
  flush and before a point can count those events twice; this is an
  analytics count, never a gameplay effect, and needs a hide in that gap.
- An edit that an undo takes back while the undo's snapshot traps loses its
  own events with it: an undercount, never a duplicate.
- Events still in the engine at the fault are emitted again by the
  TypeScript engine from the point.

Each event is delivered once when the recovery loads the newest point. When
it falls back to an older point, the TypeScript engine can emit events the
game already has (#1126).

**Cost.** #874 adds no engine save per command or per tick. The undo
capture's save is main's: on main the hosted tower's `serialize` reads
`engine.serialize()` too. #874 adds an event read before each hosted save
and keeps a reference to the text, up to three texts in all (the newest
save, the newest merge's and, until the first merge, the attach save).
Holding a command's events costs an array push. The restore-point benchmark
measures the cost on the owner's PC.

> **Container figures: a snapshot of 2026-10-20, not refreshing.** Indicative
> only, from a cloud container, not the owner's PC. The live figures come
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
- two edits when the edit before had not merged yet (paused) and the next
  edit's own capture save is what traps;
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
  now), and the log gains one line of kind `bad`, which the UI shows as an
  alert toast: "The WASM engine stopped, so the tower went back to its last
  good state and your recent changes were undone. It runs on the TypeScript
  engine now." That line needs both a command relayed since the newest point
  (`lostEdits`, which counts neither log lines nor the camera) and a
  player-visible difference between the frozen tower and the point (rooms,
  transports and money, the tower's name, a pending choice). Otherwise, as
  when only the clock moved on, the line is "The WASM engine stopped, so the
  tower went back to its last good state and runs on the TypeScript
  engine." If comparing the two throws, the command count alone decides.
  Nothing of the lost edit stays: no event, no undo step, no charge. A refusal answer for the trapped command
  instead would need a refusal value of each command's own shape (about 45
  commands and the setters), new decision logic in temporary code; after
  #954 the engine answers first, so a trap is a failed answer by
  construction.
- **Skipped** when the app no longer holds the faulted tower (a load, a new
  game, an undo or a redo replaced it, and that tower is not hosted) or the
  host has stopped. The player still gets a line: "The WASM engine stopped,
  so the game runs on the TypeScript engine now." After an undo or a redo
  whose own snapshot trapped, the snapshot is the state before an edit no
  point covered, so the undo and redo steps that would now change nothing
  are dropped too. An adopt that throws after the faulted host was let go,
  with the app still on the faulted tower, still restores.
- **`app.adoptSim(fresh, true)`**, the undo path: it keeps the camera, the
  undo history and the bridging toggle, and a title screen that is still up
  (`Onboarding.adoptSim(sim, keepSplash)`). The adopt wrapper's release
  detaches the faulted host, which hands back the events it holds with the
  drop count, and GameApp's adopt passes them to the fresh tower. Then
  `app.dropEmptyUndo()` (`UndoHistory.dropUnchanged`) pops the undo and redo
  steps that would change nothing now.
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
| `FaultLatch`, the guarded paths in `wasmHost.ts`, the fault record and report in `startWasmHost.ts`, the strict `onFatal` stop, `RestorePoints.newestSave` without its TypeScript load check (the strict build's save after a fault), the trap codes, the save writer turned off, `createAppHistory`, `Onboarding.adoptSim`'s `keepSplash` | Permanent host and app infrastructure | Stays: a Rust-only build still freezes and stops cleanly on a trap |
| The rest of `RestorePoints`, `carryLiveState`, the point and event bookkeeping (`readPoint`, `pullTicks`, `HostEvents` with the held events and `lostEdits`), `recover`, `playerState`, `tidyHistory`, the frozen tower's own tick, the TypeScript re-adoption, `UndoHistory.dropUnchanged` and the `signatureOf` port, `dropEmptyUndo` (`GameApp`, `WasmHostApp`), the analytics bridge's `release` option, the restore-point benchmark (`perf:restore`) and the fallback-only tests | Temporary fallback code | Removed with the TypeScript simulation (listed in `story-engine-retire-typescript.md`) |
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
  after the fallback: that test lands with #1092, which rebases onto this,
  and #874 stays open until it does.
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
  `main.ts`, `dropUnchanged`, `dropEmptyUndo`, and the title screen kept
  through an undo or a fallback.
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
- [x] `package.json` minor bump with a changelog line (2.39.0 against main
  at f508db44; set again at merge time if main moves).
- [x] e2e: a forced tick and command trap on `chromium-wasm`
  (`e2e/wasmFallback.spec.ts`), and a trap on the wasm-only build that
  stops the game (`e2e/wasmOnly.spec.ts`).
- [x] The restore-point benchmark for the owner's PC (`npm run perf:restore`).

## Acceptance

- A command that throws after the engine changed part of its state: the
  caller gets the instance's answer, the status records `trap-command` once,
  and before the next frame the tower is the newest point's (the edit's
  undo capture): its money, rooms, undo and redo trails, log and events
  show nothing of the lost edit, and the log's last line says the recent
  changes were undone.
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
  and unmerged (the redo goes); a redo whose snapshot traps; no redo trail
  left after a trapped edit. `wasmRollback.ts` is their shared setting.
- The fake engine covers the host's bookkeeping and the point rule in the
  unit project (`hostFault.test.ts`, `wasmHostPoints.test.ts`,
  `startWasmHost.test.ts`, `startWasmHostRecovery.test.ts`).
- The e2e specs force the same trap through `window.__vcEngine` on the
  `chromium-wasm` project (asserting the alert toast) and on the wasm-only
  build.

Five existing tests pinned the pre-#874 behavior and changed with it: the
load markers carry the commute rows (`mirror.test.ts`); a trap while
letting a tower go now freezes it and hands back every event that left the
engine, where it used to throw and count a trap's events from the read
model's copies (`wasmHost.integration.test.ts`, two tests); the analytics
bridge's drain failure is a fault that re-adopts the tower
(`wasmHostAnalyticsBridge.integration.test.ts`); a host swapped away from a
trapped engine is a fault, with no read-model copy count
(`startWasmHost.test.ts`); and malformed commute rows at detach fault and
freeze the tower (`wasmHostFrame.test.ts`).

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

**Round 3:** the independent re-review of the new head.
