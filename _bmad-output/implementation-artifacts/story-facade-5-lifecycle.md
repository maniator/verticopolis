# Story facade.5: The lifecycle through the port (load, saves, undo and redo, `.TDT`, the crash report)

Status: in-progress (story review: GO on ad20180c, both conditions met; 5a
written on the F2 amendment's recommended option and reviewed with
`/gds-code-review`; it merges only once the owner answers F2)

Slice 5 of the Rust-backed facade
(`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/slice-plan.md`),
under spine AD-9 (owner direction 2026-10-20 20:45 UTC, signed off 21:40 UTC).
Issue #1212, under the facade tracker #1207. Relates to #868 (S6) and #954
(S9) by reference only: no closing keyword on either.

Owner: the Runtime thread ("Runtime fallback and engine authority"), which
owns `startWasmHost.ts`, `hostFault.ts`, `wasmHost.ts` and `appHistory.ts`.
It lands after slice 2 (#1209) and slice 4 (#1211), before slice 3b, per the
slice plan's merge order (2, 4, 5, 3b).

## Story

As the developer moving the web game onto Rust authority,
I want new game, load, import, save, export, undo and redo, the `.TDT`
round trip and the crash report to go through `SimPort`, with undo's
signature read from the port,
so that no file in `src/game/` builds, deserializes or serializes a
TypeScript `Simulation` itself, slice 7's `RustSim` can serve every lifecycle
call with the engine's own saves, and the WASM host stops parsing and
re-stringifying the undo copies it hands out on every gesture (#1158 A31,
its undo half).

## Acceptance Criteria

1. **The port's lifecycle members.** `src/simport/port.ts` gains:
   - `load(source: TowerSource): Promise<void>`, where `TowerSource` is one of
     - `{ from: "history"; text: string }`: an undo or a redo step, the text
       `saveNow` returned. The undo history stays, the live camera stays
       where it is, and the tower takes the live auto-bridge setting.
     - `{ from: "stored"; saves: readonly SerializedGame[] }`: saves the game
       wrote and read back (the autosave and its legacy key, a slot, a
       `.vctower` file), tried in order; the first that loads becomes the
       tower, and when none loads the promise rejects with the first error.
       A save with no `appVersion` stamp predates 2.0, so its tower is a
       founder's (`markFounderFromLoadedFile`, as `SaveGame` applies it
       today).
     - `{ from: "legacy"; save: SerializedGame }`: a 1994 `.TDT` import,
       already read and checked. No founder rule, as today.
     - `{ from: "found"; seed; mode; calendar; unbridged }`: a new tower
       under the chosen rule set (`Simulation.newGame`'s arguments).

     Every source but `history` replaces the tower and clears the undo
     history. The tower is on `view` once the promise settles. A load that
     fails rejects; when the source does not load, the tower stays as it
     was.
   - `saveNow(opts?: SaveOptions): string`, the save taken now, for the
     callers that cannot wait (D2). Main-thread adapters only.
   - `save(opts?: SaveOptions)` keeps its promise and gains the options.
     `SaveOptions` is `{ view?: () => SerializedView | null; memory?:
     boolean }`. `view` is the live camera, read right before the tower is
     written; a null keeps the view the tower already carries (today's
     `stampView` rule). `memory` marks a copy that never leaves the page (an
     undo or a redo step): the adapter may hand over its engine's own text.
     Without it the text is in the form today's stored saves take (D9).
   - `undoSignature(): string`: a fingerprint of everything a player can
     change and undo, equal when none of it changed. Its coverage is
     `towerStateSig`'s: every unit, floor and lobby tiles included (kind,
     floor, x, label, rent, the No Rate flag, the film policy, the subtype),
     every transport (kind, x, span, cars, skipped floors, schedule), and
     money. Main-thread adapters only.
   - `readonly generation: number`: which tower the port holds. It moves on
     every load (undo and redo included) and on any swap the adapter sees,
     and stays across commands and ticks.

   The port's ordering note adds: `saveNow` and `undoSignature`, like `tick`
   and `drainEvents`, act after every command and load issued before them;
   loads run in issue order with commands, queries and saves. Both are
   synchronous, so only an adapter that runs the engine on the main thread
   can keep them (`TsSim`, slice 7's `RustSim`). A worker adapter needs an
   in-order primitive in their place, which slice 12 (#1224) owes (D2). The
   "Not on the port yet" paragraph goes.
2. **`TsSim`'s lifecycle.** A new module `src/simport/tsLifecycle.ts` holds
   the TypeScript side of these members; `createTsSim` takes an optional
   second argument, `{ adopt(sim: Simulation, keepHistory: boolean): void }`
   (a port without it rejects every load), which
   the app wires to `app.adoptSim` read at call time (so the WASM host's
   wrapper sees every swap).
   - `load` builds the `Simulation` (`deserialize` or `newGame`) and calls
     `adopt` before the promise is returned, so a synchronous reader sees the
     new tower at once, as with commands. A `history` load copies the live
     `autoBridge` onto the new tower before the adopt. A throw rejects the
     promise. One from building the tower leaves the tower as it was; one
     from `adopt` comes after the app began the swap (the WASM host codes
     its own faults there and falls back).
   - `saveNow` returns `JSON.stringify(sim.serialize())`, or, with
     `memory`, the WASM host's own text when the host offers it (AC 7). `save` waits as today when a
     step gate is registered (`settledSave`), then does the same. With
     `view`, the camera is read and assigned to `sim.view` right before the
     tower is written, through the field the mirror's relay watches.
   - `undoSignature` returns `towerStateSig(sim.tower, sim.money)`.
   - `generation` is a number per `Simulation` instance, assigned the first
     time the port sees it (a `WeakMap`), so a swap made outside the port
     (the WASM host's recovery) moves it too.

   `tsLifecycle.ts` imports the TypeScript engine at runtime (`Simulation`,
   `sim/founderStatus` and `towerStateSig` from `UndoHistory`), beside slice
   4's `tsPanels.ts`; `tsSim.ts` takes engine types only. Both guards get
   its line with that reason (AC 9).
3. **The lifecycle contract.** `src/simport/lifecycleContract.fixture.ts`
   exports `describeLifecycleContract(name, makePort)`, and
   `src/simport/tsSimLifecycle.test.ts` runs it over `TsSim`, so the
   `unitWasm` parity project runs it on the mirror host too. Its cases, on
   seeded founded games from `src/tests/fixtures/towerFixtures.ts`:
   - `saveNow()` and `save()` return the same text, and on `TsSim` it is
     `JSON.stringify(sim.serialize())` on both hosts; with `memory` on the
     WASM host it is the engine's text, which parses to the same value; a
     command issued before either is in it; `view` puts the camera in the
     text and a null keeps the tower's own.
   - a `history` load of an earlier `saveNow` text gives a tower whose
     `undoSignature` equals the one read when that text was taken, keeps the
     live auto-bridge setting, and moves `generation` before the load
     settles; a command issued after the load applies to the loaded tower.
   - `stored`: the first loadable save wins (an unloadable first falls back
     to the second), none rejects with the first save's error (the one a
     `legacy` load of that save alone gives; each adapter's own test shows
     its two unloadable saves fail apart) and leaves the tower and
     `generation` as they were, a failed `history` load keeps `generation`
     before it settles, and the founder rule holds both ways;
     `legacy` never applies it; `found` honors the mode, the calendar and
     the no-bridging option and starts an empty lot.
   - **Undo signature coverage, command by command.** Over a scripted
     session with a step per command (slice 2's command contract script
     once #1290 lands, the case's own until then), plus a tick, a camera
     change and a bulletin, each step applies or is refused as written and
     `undoSignature` changes on exactly the steps where a reference changes.
     A second case, on a 3-star Classic tower loaded through the port,
     covers a cinema's film policy and the No Rate flag. The cases take the
     reference as an argument: here `towerStateSig` on the live instance;
     slice 7 passes a `TsSim` twin fed the same script, which is how
     `RustSim`'s signature (slice 6a's `towerSignature()` with money beside
     it) is held to `towerStateSig`'s coverage.
4. **Undo and redo through the port.** `src/game/appHistory.ts` builds the
   history from `app.port` alone: the snapshot is
   `port.saveNow({ memory: true })`, the
   restore `port.load({ from: "history", text })`, the signature
   `port.undoSignature()`, the generation `port.generation`. It imports
   nothing from `src/engine/` at runtime but `UndoHistory`.
   - `UndoPorts.restore` returns a promise. `UndoHistory.undo()` and
     `redo()` return it: the commit, the pop, the redo or undo step's
     snapshot and the restore's start all happen before the call returns,
     as today, and the "Undid:" or "Redid:" notice follows the settled
     restore. A rejected restore gives no notice and rejects the returned
     promise. The step it could not load goes, since it would fail again
     and would block every older step. The opposite step it pushed stays
     only when the tower moved before the failure (`UndoPorts.generation`,
     the port's `generation` read synchronously around the restore), as
     the way back; otherwise it holds the tower as it still is and comes
     off. A snapshot that throws keeps the step. `GameApp.undo()` and
     `redo()` return the promise; their callers (`inputKeys.ts`,
     `uiCallbacks.ts`) pass it on or `void` it.
   - `UndoPorts.signatureOf` goes. `UndoHistory.dropUnchanged(sigOf)` takes
     the fingerprint function from its caller, and the WASM host passes
     `signatureOfSave` from `hostFault.ts`, which deserializes a snapshot
     and fingerprints it the way `undoSignature` does on `TsSim`. Temporary,
     with the fallback.
   - The capture and the commit across a drag need no queue of their own
     (D5): `saveNow` and `undoSignature` act after every command issued
     before them.
5. **Saves through the port (PR 5b).** Every write of the live tower takes
   its text from the port. The callers that can wait await
   `save({ view })`: the Quick Save, the flush before an update reload
   ("Update now", whose handler is already `async` with the tower held
   still behind the prompt), the flush before a 1994 import is adopted,
   `saveToSlot`, the autosave, the `.vctower` export and the `.TDT` export
   (which parses the text). Two cannot: the context-loss flush, which
   decides the crash screen in the same handler, uses `saveNow({ view })`,
   and the crash report reads the header and takes `saveNow()` in one task,
   so the summary and the save describe one state. On a faulted WASM host
   that save is the newest restore point (what any save of the frozen tower
   answers with, and what a recovery would load) while the header is the
   frozen tower's. `SaveGame`'s writers (`save`, `saveAsync`,
   `saveSlot`, `packSync`, `saveTo`, `saveToAsync`, `export`) take the save
   text, and `exportFilename` takes the tower's name. The stamp (`savedAt`,
   `appVersion`) is spliced into the text (D8). The stored bytes are the
   bytes written today on both engines.
6. **Loads through the port (PR 5c).** Mid-game loads, imports and new
   towers go through `port.load`: `SaveLoad.load`, `importGame`,
   `importLegacy`'s confirm, `newGame`; `appModals.ts` `loadFromSlot` and
   `loadFromSplash`; `legacyImportAdopt.ts`. `SaveGame`'s mid-game readers
   return decoded saves: `readAuto()` (the autosave key, then the legacy
   key, each decoded or skipped), `readSlotSave(n)` and `import(text)`
   (`Promise<SerializedGame>`, with today's container and shape checks).
   The `.TDT` check stays in storage: `SaveGame.readLegacy(buffer,
   filename)` parses and checks the save with `Simulation.deserialize` as
   `importLegacy` does today, and the confirm loads it through the port.
   Each flow keeps today's player-facing outcome on today's failures (Dev
   Notes, "Flows").
7. **The WASM host hands over its save text for in-memory copies (#1158
   A31, its undo half).** The host offers the engine's save text for its
   tower (a registry beside `setStepGate` in `src/wasmhost/`), and `TsSim`
   hands it over for a save with `memory`: the undo capture and the undo
   and redo steps. A save of a faulted host answers with the newest restore
   point's text (`RestorePoints.newestText`; `newestSave` parses it). Every
   save the host reads is still a restore point, and no save is added
   (#874's property: `perf:restore` counts the same engine saves). Stored
   writes (autosave, slots, `.vctower`, `.TDT`, the crash report) keep
   today's re-printed text, `JSON.stringify` of the parsed engine save,
   because the engine's own text writes integer-valued doubles as `2.0` and
   the transports' keys in Rust order, which is EX-2's class, and EX-2 waits
   on the owner (D9). A test pins that a `memory` snapshot parses to the
   value the re-printed text parses to and loads to the same tower on both
   engines, and that the host's stored bytes are today's.
8. **Lifecycle writes leave the frontend.** The six entries of slice 2's
   `LIFECYCLE` list in `src/tests/commandSites.guard.test.ts` go, and the
   list with them:
   - `main.ts autoBridge=`: a `history` load keeps the setting (AC 2), and
     the WASM host's recovery carries it in `carryLiveState`, which today
     relies on `adoptSim`'s copy;
   - `saveLoad.ts view=` and `appModals.ts view=`: the save options' `view`;
   - `appBoot.ts emit`, `legacyImportAdopt.ts emit` and `saveLoad.ts emit`:
     `port.command({ op: "emit", ... })`, the graphics-recovery bulletin
     gated on `port.generation` where it compares instances today.
9. **The guards shrink.** In `simulationReach.ratchet.txt` the lines for
   `src/game/appHistory.ts` and `src/game/saveLoad.ts` go and
   `src/simport/tsLifecycle.ts` is added with its reason (the adapter that
   hosts the TypeScript engine; slice 10 loads it lazily). In
   `frontendEngineImports.ratchet.txt` `appHistory.ts` loses `Simulation`,
   `saveLoad.ts`'s line goes, and `tsLifecycle.ts` is added (`Simulation`,
   `sim/founderStatus`, `UndoHistory`) with the same reason. `src/storage/SaveGame.ts` keeps its line (boot's `loadResult`,
   `listSlots`' population and the `.TDT` check, all slice 10's).
10. **No behavior change a player can see.** Toasts, bulletins, undo steps,
    the camera after an undo or a load, the founder badge and the stored
    bytes on both engines stay as they are. No version bump. The
    four gates, the coverage ratchet, `npm run test:wasm:parity` and the
    500-line ceiling hold (`main.ts` does not grow; `wasmHost.ts` (498) and
    `SaveGame.ts` (492) stay under it).
11. **Hot-path record.** Each PR carries the proportional HP-1 to HP-12
    record (Dev Notes, "Hot-path record plan").
12. **Review.** `/gds-code-review` on each PR (save fidelity and undo
    coverage decide gameplay data), with its Hot-Path Auditor layer; the
    independent review through the coordinator ("Facade and Rust perf
    reviews"). Every `patch` finding fixed, every `defer` recorded in the
    backlog with its issue. No auto-merge before the independent GO; the
    lane merges with a merge commit once the GO names the exact head and CI
    is green.

## Tasks / Subtasks

- [ ] PR 5a: the port's lifecycle members and undo through the port
  - [x] the slice plan's row 5 amended; D2's per-caller costs and the
        in-order primitive recorded on #1224
  - [x] `port.ts`: `TowerSource`, `SaveOptions`, the members, the ordering
        note (AC 1)
  - [x] `tsLifecycle.ts` and `createTsSim`'s `adopt` option (AC 2)
  - [x] the host's text registry, `RestorePoints.newestText`,
        `signatureOfSave`, the auto-bridge part of `carryLiveState` (AC 4,
        7, 8)
  - [x] `lifecycleContract.fixture.ts` and `tsSimLifecycle.test.ts`, on
        both hosts (AC 3)
  - [x] `UndoHistory` (async restore, `dropUnchanged(sigOf)`), `appHistory.ts`,
        `GameApp.undo`/`redo`/`dropEmptyUndo`, the auto-bridge carry out of
        `adoptSim`, the host's history wrappers passing the promise on (AC 4)
  - [x] the app's port wiring with `adopt` (one line in `main.ts`, through
        a helper if the line would wrap)
  - [x] guard lines for `appHistory.ts` and `tsLifecycle.ts`
  - [ ] `main.ts autoBridge=` out of `LIFECYCLE` (AC 8): the list arrives
        with slice 2 (#1290), so it goes when this branch takes main after
        #1290 merges
  - [ ] the coverage case on slice 2's command contract script, when this
        branch takes main after #1290 merges (AC 3)
  - [ ] the owner's F2 answer quoted in D2 before merge
- [ ] PR 5b: saves
  - [ ] the stamp splice (`src/storage/saveStamp.ts`) and its byte-equality
        tests (D8)
  - [ ] `SaveGame`'s writers on text; the test call sites through a fixture
        helper (`saveTextOf(sim)`)
  - [ ] `saveLoad.ts` saves, `appModals.ts` `saveToSlot`, `exportFlow.ts`,
        `crashReport.ts` and `crashScreen.ts`, the `.TDT` export (AC 5)
  - [ ] `view=` entries out of `LIFECYCLE`
  - [ ] the host's stored-text test (AC 7)
- [ ] PR 5c: loads
  - [ ] `SaveGame` readers return decoded saves; `readLegacy` (AC 6)
  - [ ] a `stored` load reports the candidates that did not load, so boot's
        unreadable-save warning and stash keep working (D11)
  - [ ] `saveLoad.ts` load, import, `.TDT` confirm, new game;
        `appModals.ts` loads; `legacyImportAdopt.ts`; the tower picker's
        `onLoad` takes a promise
  - [ ] the three `emit` entries out of `LIFECYCLE`; `saveLoad.ts`'s guard
        lines go (AC 8, 9)
- [ ] Each PR: the four gates, coverage, `test:wasm:parity`, the HP record,
      `/gds-code-review` and a confirming pass, the independent review

### Review Findings

`/gds-code-review` of 5a at 9ab25dbc (2026-10-27): 16 patch, 4 defer, 10
dismissed. The confirming pass on the fix commit (7eab3cbd) found the
first patch only partly fixed and the notes out of step in places; the
second round's items follow the first round's. A confirming pass on the
second round (dfad6548) found the logic sound and four small test and doc
gaps, fixed as round 3.

- [x] [Review][Patch] A failed undo or redo restore lost its step and left
      a step of the unchanged tower on the other trail [src/engine/UndoHistory.ts]
- [x] [Review][Patch] "A load that fails leaves the tower as it was" was not
      true for a throw from `adopt` [src/simport/port.ts, tsLifecycle.ts]
- [x] [Review][Patch] The generation check read the generation twice with
      no command between [src/simport/lifecycleContract.fixture.ts]
- [x] [Review][Patch] The coverage script never asserted a command applied,
      and never moved the film policy or No Rate [src/simport/lifecycleContract.fixture.ts]
- [x] [Review][Patch] `EVERY_OP`'s comment promised a compile error for a
      missing step [src/simport/lifecycleContract.fixture.ts]
- [x] [Review][Patch] No case pinned a camera stamp on a memory copy
      [src/simport/lifecycleContract.fixture.ts]
- [x] [Review][Patch] The history source's doc said the tower keeps the
      camera; the live camera stays where it is [src/simport/port.ts, src/game/appHistory.ts]
- [x] [Review][Patch] Nothing pinned that a load not yet settled is seen by
      the synchronous members [src/simport/lifecycleContract.fixture.ts]
- [x] [Review][Patch] `signatureOfSave` was bound to the port's signature by
      a comment only [src/simport/tsSimLifecycle.test.ts]
- [x] [Review][Patch] "Rejects with the first error" was not pinned
      [src/simport/tsSimLifecycle.test.ts]
- [x] [Review][Patch] AC 3's hosted save check ran on a tower never hosted
      [src/simport/tsSimLifecycle.test.ts]
- [x] [Review][Patch] The host's `serialize` override was rewritten for no
      change in cost, and the retire list disagreed with the module notes
      [src/wasmhost/wasmHost.ts, hostFault.ts, story-engine-retire-typescript.md]
- [x] [Review][Patch] A recovery comment still said `adoptSim` keeps the
      bridging toggle [src/wasmhost/startWasmHost.ts]
- [x] [Review][Patch] The "one runtime edge in `src/simport/`" claim is false
      since slice 4a [src/simport/tsLifecycle.ts, this story]
- [x] [Review][Patch] The completion notes allowed 5a before #1290, were
      stale after the merge of main, and nothing held the merge for F2 [this story]
- [x] [Review][Patch] The File List and the Tests notes named the wrong
      test files [this story]
- [x] [Review][Patch] Round 2: the put-back still lost a failed step under a
      second undo in the same task, kept a step of the unchanged tower, put
      a no-op step back after an `adopt` that threw post-swap, and lost the
      step when the snapshot threw [src/engine/UndoHistory.ts, src/game/appHistory.ts]
- [x] [Review][Patch] Round 2: the first-error pin ran on `TsSim` only
      [src/simport/lifecycleContract.fixture.ts, tsSimLifecycle.test.ts]
- [x] [Review][Patch] Round 2: the camera case used the default zoom, and the
      film and No Rate steps did not show they cost nothing
      [src/simport/lifecycleContract.fixture.ts]
- [x] [Review][Patch] Round 2: D9, the Tests notes, Constraints and the
      Completion Notes disagreed with the code; the retire list filed the
      text registry under the fallback; the review's inbox entries were not
      triaged [this story, story-engine-retire-typescript.md, backlog.md]
- [x] [Review][Patch] Round 3: the contract never required `generation` to
      move before `load` returns, which the undo history now reads; the
      port's ordering rule names it [src/simport/port.ts, lifecycleContract.fixture.ts]
- [x] [Review][Patch] Round 3: no test pinned the "way back already gone"
      guard, nor that a swapped failure drops its step
      [src/tests/integration/undoHistoryRestore.integration.test.ts]
- [x] [Review][Patch] Round 3: the shared first-error pin needs each
      adapter's own pair of saves that fail apart; AC 4's wording and the
      structure notes [lifecycleContract.fixture.ts, this story]
- [x] [Review][Defer] `saveNow` and `undoSignature` on a step-gated worker
      host can be stale [src/simport/tsLifecycle.ts]: deferred,
      pre-existing; #1224 (slice 12), D2
- [x] [Review][Defer] Hot path: a hosted save parsed and stringified again
      for stored writes [src/wasmhost/wasmHost.ts]: deferred, pre-existing;
      #1158 A31, waits on EX-2
- [x] [Review][Defer] Hot path: every undo, redo or load re-serializes the
      tower it loaded [src/dualrun/mirror.ts]: deferred, pre-existing;
      #1158 A32
- [x] [Review][Defer] Hot path: a forced full merge on the first sync after
      every attach [src/wasmhost/wasmHost.ts]: deferred, pre-existing;
      #1158 A34 (new)
- [x] [Review][Dismiss] Round 2's check that `unitWasm` hosts the tower:
      branching on the parity project needs a ratchet exception, and the
      parity setup hosts every ticked tower while `wasmHostPoints.test.ts`
      pins the attach's text registration.

Also from this review, open for 5c: a `stored` load must report the
candidates that did not load (D11).

## Dev Notes

### What exists today, and what this story must not break

- `GameApp.adoptSim(sim, preserveHistory)` (`src/main.ts`) is the one swap:
  it moves the events owed, clears the selection and inspector, follows
  onboarding, resets the frame loop's latches, points the renderer at the
  new tower (keeping the camera on an undo), rebases the log, refreshes the
  palette, and clears the undo trail unless `preserveHistory`. It also
  copies `autoBridge` on a `preserveHistory` swap, which today covers both
  the undo restore and the WASM host's recovery. `TsSim`'s `adopt` calls it
  and changes none of it.
- The WASM host (`startWasmHost.ts`) wraps `adoptSim`, `undo`, `redo` and
  `captureUndo` on the app. The undo wrappers count depth around the call so
  a fault in an undo's snapshot is coded `trap-undo` and one in a capture's
  save `trap-command`. That coding needs the snapshot and the restore's
  adopt to run inside the synchronous call, which `TsSim` keeps (AC 2, AC
  4). The wrappers return the promise they get.
- Every save the WASM host reads is a restore point (#874, #1101), and a
  save of a faulted host answers with the point the recovery goes back to
  (#1126, PR #1278). Slice 5 keeps both: the text registry calls the same
  `readPoint` and the same newest-point answer.
- Slice 2 (#1209) gives `GameApp` its `port` (`createTsSim(() => this.sim)`)
  and routes every command through it. Its story leaves this slice the
  lifecycle writes in its guard's `LIFECYCLE` list and "undo's capture and
  commit across a drag, which slice 5 queues on the port". Slice 4 (#1211)
  owns `queries.ts`; this slice adds no query.
- `UndoHistory` lives in `src/engine/` but imports types only; it stays.

### Decisions

- **D1. One `load` with a tagged source.** The review's sketch had
  `load(bytes, how)`. A tagged source carries what each path differs on:
  the founder rule (stored saves only), the kept history, camera and
  auto-bridge (undo and redo only), the candidates of the autosave's
  legacy-key fallback, and the founding arguments. A separate `found`
  member would be one more port member for one caller.
- **D2. `saveNow` and `undoSignature` are synchronous, for main-thread
  adapters.** The port's other members are asynchronous so a worker can
  host the engine; these two are not, because their callers read them in
  the task that needs them. `saveNow`'s callers: the undo capture (a
  gesture's first mutation follows in the same task), the undo and redo
  steps' own snapshots, the context-loss flush and the crash report's
  pairing. `undoSignature`'s: the capture and the commit (and the fallback's
  tidy). Every caller that can wait uses `save()` (AC 5), so no adapter can
  answer them with a stale save. `TsSim` and slice 7's `RustSim` answer both
  at once and current. A worker adapter cannot, and a stale answer costs,
  per caller:
  - the capture's snapshot: an undo that also takes back commands before
    the gesture (an older save), or leaves part of the gesture in place (a
    save that already holds some of it, which `port.ts` allows on a host
    that steps in the background);
  - an undo or a redo step's snapshot: the opposite step returns to that
    other state;
  - the signature at the capture or the commit: an edit judged unchanged,
    so it leaves no undo step and cannot be undone, or an unchanged gesture
    kept as a step that undoes nothing;
  - the context-loss flush: an autosave older than the tower, so the reload
    loses the play since;
  - the crash report: a summary and a save of different moments.

  So a worker needs an in-order primitive for the capture and the commit (a
  checkpoint command answered in issue order, or an undo queue on the
  port), and an awaited save for the flush. This story records both on
  #1224, with the costs above. Whether two synchronous members amend F2's
  "one interface, no pretend-sync" rule is the facade lead's call, and the
  owner's if it does. The facade lead judged that it does (2026-10-21), so
  the amendment is the owner's, pending; 5a is written on its recommended
  option (main-thread only, with these guardrails).
- **D3. `undoSignature`, a string.** Slice 6a's round 1 review replaced the
  change counter with `towerSignature()`, a pure fingerprint of
  `towerStateSig`'s tower half, with money compared beside it. A string
  member lets `TsSim` return `towerStateSig` unchanged and `RustSim` return
  the fingerprint and money joined, with no counter on either engine.
  The coverage case in AC 3 is the slice plan's "proven equal in coverage
  to `towerStateSig` command by command".
- **D4. Undo's restore is the port's load, awaited for the notice only.**
  The stacks change and the restore starts synchronously, so an undo
  pressed twice pops two steps in order, and the host's fault coding
  holds. The notice waits for the load, so it never claims an undo that
  failed.
- **D5. No undo queue on a main-thread adapter.** A drag's commands are fire-and-forget (slice 2),
  and its commit at pointer-up must compare the tower after all of them.
  The port's ordering rule already gives that: `undoSignature` and
  `saveNow` act after every command issued before them. `TsSim` applies
  commands at once, and an adapter that applies them later applies the
  earlier ones first. A queue in `UndoHistory` would defer the capture's
  snapshot out of the gesture's task, which breaks the host's fault coding.
  This holds only while `undoSignature` and `saveNow` are synchronous and
  current; a worker adapter brings its own primitive (D2).
- **D6. The fallback's fingerprint comes from the host.** `signatureOf`
  is the only reason `appHistory.ts` deserializes a snapshot. The host that
  needs it (the WASM host's recovery tidy) passes it in, so the app's
  history holds no `Simulation` and the function lives with the other
  temporary fallback code in `hostFault.ts`.
- **D7. The auto-bridge setting.** It is a setting, so an undo keeps the
  live one (today's comment in `adoptSim`). The `history` load does that on
  the port, and `carryLiveState` does it for the recovery, which reads the
  same faulted instance `adoptSim` reads today.
- **D8. Saves stay text from the port to storage.** The writers take text
  so no caller parses a save to stamp it. `stampText(text)` appends
  `,"savedAt":<now>,"appVersion":"<version>"` before the closing brace,
  which is what `JSON.stringify` writes for today's `stamp(serialize())`,
  since `serialize()` carries neither key and assignment appends them in
  that order. When the text holds `"savedAt":` or `"appVersion":` anywhere,
  or does not end in `}`, it falls back to parse, stamp and stringify,
  which is today's path. It returns the two values too, for `packVctower`.
  A test pins byte equality with today's path on every conformance save and
  on saves that carry the keys.
- **D9. The host's text, for copies that stay in memory (A31's undo
  half).** Today every save of a hosted tower is the engine's text, parsed
  by the host's `serialize` override and stringified again by the caller:
  one `JSON.parse` and one `JSON.stringify` of the whole save (2.27 million
  characters on large, per #874's PC run) per undo capture, undo and redo
  step, autosave, manual save and export. The registry lets `TsSim` take
  the text itself for the undo copies, which happen per gesture and never
  leave the page. The stored writes keep the re-print: the engine's own text
  differs from it in number forms and the transports' key order, EX-2
  (`release-3.0-exception-register.md`) is proposed and waits on the owner
  at the #945 sign-off, partly on the grounds that the written file already
  matches, and stage-1 WASM-arm players run this host. A31's stored half
  stays on #1158 until EX-2 is decided; slice 7, whose saves are
  engine-written, depends on the same decision. In `wasmHost.ts` the text
  function sits beside `serializeHosted`, which stays main's code, and
  reads the same restore point without the parse (the file grows by four
  lines).
- **D10. The camera rides the save options as a function.** The autosave
  and the export read the camera after the worker host's settle wait today,
  so the save carries where the camera is when it is written. A value taken
  at the call would be read before that wait.
- **D11. Loads take decoded saves.** `SaveGame` already decodes and parses
  (it needs `savedAt` and the shape checks); the port deserializes. The
  autosave's two keys travel as candidates, so the legacy-key fallback
  `loadResult` gives mid-game loads today needs no second deserialize.
  Slice 7 may switch the readers to hand over text for `fromSave`; that is
  its call, with its own HP record. Open for 5c (5a's review): `loadResult`
  also reports a candidate that decoded but did not deserialize
  (`corrupt`), so boot warns and stashes those bytes even when the legacy
  key rescues the tower. A `stored` load must tell its caller the same, for
  example by resolving with the number of candidates that did not load.
- **D12. The `.TDT` check stays in storage.** The fidelity report shows
  only for a save that deserializes, so the check runs before the report,
  and the confirm loads the same save through the port: one more
  `deserialize` per confirmed `.TDT` import (a click, never a hot path).
- **D13. `generation`.** The graphics-recovery bulletin goes to the tower
  that was live at the loss only, which today is an instance comparison.
  The autosave's and the export's own comparisons move into `save`
  (`settledSave` already re-checks the tower), so this is the one caller.
- **D14. Bulletins are commands.** The boot's unreadable-save line, the 1994
  import's welcome and the graphics-recovery line go through
  `port.command({ op: "emit" })`. The WASM host's recovery lines stay on
  the instance: that code is the fallback's own and slice 8 moves it.
- **D15. Left for later slices.** Boot (`SaveGame.loadResult`, the first
  `Simulation.newGame` in `main.ts`, `discardOnHandOff` in `appBoot.ts`) and
  `listSlots`' population: slice 10. The recovery's adopt and its emits:
  slice 8. The attach's re-serialization of a tower just loaded (#1158
  A32): the facade (#1207), since slice 7 loads the engine from the text.
  The crash analytics' header reads in `appBoot.ts` (`noteCrash`): slice
  3's header reads.

### Flows (PR 5b and 5c)

| Flow | Today | Through the port | Kept on failure |
| --- | --- | --- | --- |
| Quick Save | `stampView`, `SaveGame.save(sim)` | `SaveGame.save(await port.save({ view }))` | the failure toast (`saveFailureMessage`) |
| Update-now and 1994-import flushes | the same, `save(true)` | the same, awaited | the rejection to the caller: the update does not reload, and the import names the failed backup |
| Context-loss flush | the same, `save(true)` | `SaveGame.save(port.saveNow({ view }))` | the throw, worded on the crash screen |
| Autosave | settle, swap check, `stampView`, `saveAsync(sim)` | `saveAsync(await port.save({ view }))` | best effort, silent |
| Slot save | `sim.view =`, `saveSlot(n, sim)` | `saveSlot(n, await port.save({ view }))` | the failure toast |
| `.vctower` export | up to 3 settle rounds, `stampView`, `export(sim)` | `export(await port.save({ view }))`, the file named from `view.tower.towerName` | "Export failed: ..." and the watchdog |
| `.TDT` export | `stampView`, `buildTDT(sim.serialize())` | `buildTDT(JSON.parse(await port.save({ view })))` | the export error dialog |
| Crash report | `export(sim)`, else `stringify(serialize())` | header and `saveNow()` in one task, then `export(text)`, else the text | the screen's retry |
| Load (quick) | `SaveGame.load()`, `adoptSim` | `readAuto()`, `port.load({ from: "stored" })` | "No saved tower found." when none or none loads |
| Slot load | `loadSlot(n)` or `load()` | `readSlotSave(n)` or `readAuto()`, `port.load` | "That slot is empty or corrupt." |
| Title picker load | the same, a boolean | the same, a promise of one | the picker's inline reason |
| `.vctower` import | `SaveGame.import(text)`, `adoptSim` | `import(text)` data, `port.load({ from: "stored", saves: [data] })` | "Import failed: <message>" |
| `.TDT` import | `parseTDT`, `deserialize` check, report, adopt | `readLegacy`, report, `port.load({ from: "legacy" })` | the same messages |
| New tower | `adoptSim(Simulation.newGame(...))` | `port.load({ from: "found", ... })` | none today |

The export's three-round bound becomes `settledSave`'s loop, which ends
once no swap lands during a wait; the export watchdog still frees the
latch.

### Risks and how the slice meets them

| Risk | Where | How |
| --- | --- | --- |
| An awaited load reorders feedback | undo, redo, every load | `TsSim` adopts before returning the promise, so the tower, the renderer and the palette move in the same task; only the notice and the toast follow the settled promise, in the same task's microtasks |
| A host fault is coded wrong after the change | `startWasmHost.ts` wrappers | the snapshot and the adopt still run inside the wrapped call (D4, D5); a test keeps `trap-undo` and `trap-command` on a forced trap |
| Stored bytes change | every write | byte equality on both engines (D8, AC 7); the host's engine text only for `memory` copies, with deep equality and both-engine loads |
| A worker adapter cannot keep the synchronous members | slice 12 | scoped to main-thread adapters in `port.ts`; the per-caller costs and the in-order primitive recorded on #1224 (D2) |
| A synchronous save answers a caller that could have waited | every save | only the four D2 callers use `saveNow`; the rest await `save()` |
| A restore point is lost or added | the host's saves | the text function calls the same `readPoint`; `perf:restore -- --quick` in the cloud counts the same saves (indicative, counts only) |
| The founder badge moves | stored loads | the rule rides the `stored` source alone; tests both ways and on `legacy` |
| The legacy-key fallback stops working mid-game | quick load | candidates in order (D11); a test with an unloadable first key |
| A drag's commit compares too early | gestures | the ordering rule (D5); a contract case with commands issued before `undoSignature` |
| `main.ts` passes 500 lines | the port field | the field stays one line; the auto-bridge carry's two lines leave `adoptSim` |

### Tests

- `src/simport/tsSimLifecycle.test.ts` (AC 3), in the default and the
  `unitWasm` projects; its `TsSim` cases add that the two candidates'
  errors differ and that `signatureOfSave` of a memory copy equals
  `undoSignature`.
- `src/tests/integration/undoHistory.integration.test.ts`:
  `dropUnchanged(sigOf)` and the stack cases.
  `undoHistoryRestore.integration.test.ts` (new): undo and redo return the
  restore's promise; the notice follows it; two undos in one task pop two
  steps in order; a failed restore drops its step and the unchanged way
  back even under a later undo, keeps the way back when the tower moved,
  leaves the trail alone when that way back is already gone, and a
  snapshot or a restore that throws rejects.
- `startWasmHost.test.ts` and the recovery tests: the wrappers pass
  the promise on and keep their fault codes; `dropEmptyUndo` receives
  `signatureOfSave`.
- `hostFault.test.ts`: `newestText` and `newestSave` agree and record the
  answered point once; `carryLiveState` gives the recovery's tower the
  live auto-bridge setting; `signatureOfSave` reads a save as
  `towerStateSig` reads the tower.
- `wasmHostPoints.test.ts`: the host registers its text at attach, a
  healthy detach gives it back, and a faulted one keeps it (AC 7's undo
  half).
- `saveStamp.test.ts` (D8); the `SaveGame` writer and reader tests on text
  and decoded saves; the stored-text test on the host (AC 7).
- `saveLoad`, `appModals`, `legacyImportAdopt`, `exportFlow` and
  `crashReport` tests: each row of "Flows", success and failure.
- The integration suites that drive `GameApp` (undo, load, import, the
  tower picker) unchanged in what they assert.
- Every new test fails when the line it pins is reverted (checked in a
  scratch copy, as for #1278).

### Hot-path record plan

- Paths touched: the undo capture (per gesture), undo and redo (per
  command), the autosave (every 30 s), manual saves, exports and loads (per
  click). Nothing per tick or per frame, and no simulation code.
- Removed on the WASM host: one `JSON.parse` and one `JSON.stringify` of
  the whole save per undo capture and per undo or redo step (A31's undo
  half). Stored writes keep theirs until EX-2 is decided (A31's stored
  half, on #1158).
- Added: the stamp splice (two substring scans and one concatenation per
  stored write; the stringify it replaces moves into `saveNow`), one closure
  per save with `view`, one `WeakMap` entry per tower for `generation`, and
  one `deserialize` per confirmed `.TDT` import. The `.TDT` export parses the
  port's text where it read an object (a click).
- HP-10: no cache, RNG draw or event order changes; stored bytes are
  today's on the TypeScript engine and content-equal on the host.
- Measurements: none claimed. Cloud runs of `perf:restore -- --quick` are
  labeled indicative and count saves only; a PC row, if wanted, goes
  through the coordinator and the PC thread.

### What it removes (temporary TypeScript)

- `src/game/appHistory.ts` and `src/game/saveLoad.ts` stop importing the
  TypeScript `Simulation` (both ratchets).
- The six lifecycle writes in the command-site guard's `LIFECYCLE` list,
  and the list.
- `UndoPorts.signatureOf`: the fingerprint of a snapshot moves into
  `hostFault.ts` with the rest of the fallback.

It adds `src/simport/tsLifecycle.ts`, one of the adapter's runtime edges
into the TypeScript engine (beside slice 4's `tsPanels.ts`), which slice 10
loads lazily and which goes when the TypeScript engine retires.
`signatureOfSave`, the host's save text registry and the auto-bridge part
of `carryLiveState` are temporary with the fallback and are on
`story-engine-retire-typescript.md`'s list; `RestorePoints.newestText`
joins `newestSave` on that list's strict-build stay line.

### Constraints

- American English, no em-dashes, plain prose in comments, no "X, not Y".
- 500-line ceiling per file; `main.ts` must not grow.
- `src/simport/` imports engine values only in `tsLifecycle.ts` and slice
  4's `tsPanels.ts` and `headerClock.ts`, each with its ratchet line.
- #1068's files (`workerHost.ts`, `workerSaveSync.ts`, perfCompare,
  perfWorker) are not touched. The worker host keeps its step gate.
- Lands after #1278 (merged, `02a9129`) and after slices 2 and 4; 5a's app
  wiring builds on slice 4a's `port` field (on main since #1313).
- 5a merges only once the owner has answered the F2 amendment, with his
  answer quoted in D2. If he keeps F2 as signed, 5a is reworked around
  in-order asynchronous saves and an asynchronous signature before it
  merges.
- Slice 5 needs only `towerStateSig` on `TsSim`. The `RustSim` half of
  `undoSignature` depends on slice 6a's `towerSignature()` (#1284, a draft
  waiting on an owner decision) landing.
- The slice plan's row 5 is amended in this PR (`undoSignature` and
  `saveNow`, scoped to main-thread adapters). The spine's AD-8 line and row
  6a still name a change counter; that is 6a's amendment to make.

### Project Structure Notes

- New: `src/simport/tsLifecycle.ts`, `lifecycleContract.fixture.ts`,
  `tsSimLifecycle.test.ts`; `src/storage/saveStamp.ts` and its test; a
  small registry for the host's save text in `src/wasmhost/`.
- Changed: `src/simport/port.ts`, `tsSim.ts`; `src/engine/UndoHistory.ts`
  (its ports, and how a failed restore settles the trails); `src/game/appHistory.ts`, `saveLoad.ts`, `appModals.ts`,
  `legacyImportAdopt.ts`, `exportFlow.ts`, `crashReport.ts`, `appBoot.ts`,
  `inputKeys.ts`, `uiCallbacks.ts`; `src/ui/crashScreen.ts`,
  `uiTowerPicker.ts`, `templates/towerPicker.ts`; `src/main.ts`;
  `src/storage/SaveGame.ts`; `src/wasmhost/startWasmHost.ts`,
  `hostFault.ts`, `wasmHost.ts`; both ratchets and the command-site guard.

### References

- [Source: architecture-rust-facade-2026-10-20/slice-plan.md, slice 5 row, "Who touches which files"]
- [Source: architecture-rust-facade-2026-10-20/ARCHITECTURE-REVIEW.md#5.1 The port, #5.5 Saves, undo, redo, load, import, offline]
- [Source: architecture-rust-facade-2026-10-20/consumer-inventory.md, bucket 4]
- [Source: story-facade-1-port.md] (the port's ordering rules, the reach guard)
- [Source: story-facade-2-commands.md on #1209, "Lifecycle writes left for slice 5"]
- [Source: story-facade-6a-engine-view.md on #1213] (`towerSignature()`)
- [Source: src/main.ts#adoptSim], [Source: src/wasmhost/startWasmHost.ts] (the history wrappers), [Source: src/wasmhost/wasmHost.ts#serializeHosted]
- [Source: docs/performance/hot-path-review.md] (HP-1 to HP-12)
- [Source: docs/performance/results/2026-10-21-4fa8072-restore-points/report.md] (save sizes and counts)
- [Source: _bmad-output/project-context.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

5a (PR #1294), on main at d09aa64a (slice 4a, #1313, merged in) with
Copilot's two commits (a2c854ef, 429027a9) kept and their code replaced:

- `createTsSim`'s second argument is optional: a port without `adopt`
  rejects a load. The tests that build a port over a fixed tower need none.
- The host's text registry is `setSaveText`/`saveText` in
  `src/wasmhost/stepGate.ts`, beside `setStepGate`, so `wasmHost.ts` gains
  no import line. The host's `serialize` override is main's, unchanged; the
  registered text reads the same restore point without the parse. A
  faulted tower keeps its text after detach, as it keeps its `serialize`
  override; a healthy one gives it back.
- The undo signature's coverage case (AC 3) runs its own script until
  #1290 lands: one step per command and a tick, each pinned to apply or be
  refused and to move the signature or not. `satisfies` makes a new
  command fail to compile until `EVERY_OP` lists it, and the run fails
  until the script has its step. A second case loads a 3-star Classic tower
  through the port for a cinema's film policy and No Rate.
- `main.ts` takes slice 4a's `port` field and adds `adopt`; the auto-bridge
  copy left `adoptSim`, so the file is 498 lines. Merging main resolved
  `main.ts` (that field), `tsSim.ts` (the import lines and the module note,
  which now names both runtime edges) and `frontendEngineImports.ratchet.txt`
  (both sides' lines, sorted).
- 5a lands after #1290 per the slice plan's merge order, and only once the
  owner has answered F2 (Constraints). The `LIFECYCLE` and coverage-script
  follow-ups wait for #1290 (tasks).
- `contract.fixture.ts` exports `start`, `sender`, `lobbyCenter` and
  `mustFind`, the same four exports slice 2 makes.
- `UndoHistory.dropUnchanged` takes the fingerprint; the test that ran it
  without one went, since that path is gone. A failed undo or redo restore
  drops the step it could not load, and the opposite step it pushed unless
  the tower moved first (`UndoPorts.generation`); a snapshot that throws
  keeps the step. Those cases live in
  `undoHistoryRestore.integration.test.ts`.
- `towerStateSig`'s own cases moved unchanged into
  `towerStateSig.integration.test.ts`, keeping
  `undoHistory.integration.test.ts` under 500 lines.
- `/gds-code-review` ran on 9ab25dbc (Blind Hunter, Edge Case Hunter,
  Acceptance Auditor, Hot-Path Auditor), with a confirming pass after each
  of three fix rounds: see Review Findings. The hot-path record
  goes on the PR with the push.

### File List

- `src/simport/port.ts`, `tsSim.ts`, `tsLifecycle.ts` (new),
  `lifecycleContract.fixture.ts` (new), `tsSimLifecycle.test.ts` (new),
  `contract.fixture.ts`
- `src/engine/UndoHistory.ts`, `src/game/appHistory.ts`, `inputKeys.ts`,
  `uiCallbacks.ts`, `src/main.ts`
- `src/wasmhost/stepGate.ts`, `wasmHost.ts`, `hostFault.ts`,
  `startWasmHost.ts`, and their tests (`hostFault.test.ts`,
  `wasmHostPoints.test.ts`, `startWasmHost.test.ts`,
  `startWasmHostRecovery.test.ts`)
- `src/tests/integration/undoHistory.integration.test.ts`,
  `undoHistoryRestore.integration.test.ts` (new, the restore cases),
  `towerStateSig.integration.test.ts` (new, moved cases), `wasmRollback.ts`, `wasmHostRollback.integration.test.ts`,
  `wasmHostRollbackHistory.integration.test.ts`,
  `wasmHostFallback.integration.test.ts`
- `src/tests/simulationReach.ratchet.txt`,
  `frontendEngineImports.ratchet.txt`
- the slice plan's row 5 (pending the owner's F2 answer)
- `_bmad-output/implementation-artifacts/story-engine-retire-typescript.md`
  (the fallback's lists), `backlog.md` (the review's deferrals, #1158 A34)
