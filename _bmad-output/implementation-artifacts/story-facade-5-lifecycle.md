# Story facade.5: The lifecycle through the port (load, saves, undo and redo, `.TDT`, the crash report)

Status: ready-for-dev (story review requested before the first code commit)

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
re-stringifying every save it hands out (#1158 A31).

## Acceptance Criteria

1. **The port's lifecycle members.** `src/simport/port.ts` gains:
   - `load(source: TowerSource): Promise<void>`, where `TowerSource` is one of
     - `{ from: "history"; text: string }`: an undo or a redo step, the text
       `saveNow` returned. The tower keeps the undo history, the camera and
       the live auto-bridge setting.
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
     history. The tower is on `view` once the promise settles.
   - `saveNow(opts?: SaveOptions): string`, the save taken now, for the
     callers that cannot wait (D2).
   - `save(opts?: SaveOptions)` keeps its promise and gains the options.
     `SaveOptions` is `{ view?: () => SerializedView | null }`: the live
     camera, read right before the tower is written; a null keeps the view
     the tower already carries (today's `stampView` rule).
   - `undoSignature(): string`: a fingerprint of what a player can change
     and undo (rooms, transports and their settings, labels, rents, the No
     Rate flag, the film policy, the retail subtype, and money), equal when
     nothing undoable changed.
   - `readonly generation: number`: which tower the port holds. It moves on
     every load (undo and redo included) and on any swap the adapter sees,
     and stays across commands and ticks.

   The port's ordering note adds: `saveNow` and `undoSignature`, like `tick`
   and `drainEvents`, act after every command and load issued before them;
   loads run in issue order with commands, queries and saves. The "Not on
   the port yet" paragraph goes.
2. **`TsSim`'s lifecycle.** A new module `src/simport/tsLifecycle.ts` holds
   the TypeScript side of these members; `createTsSim` takes a second
   argument, `{ adopt(sim: Simulation, keepHistory: boolean): void }`, which
   the app wires to `app.adoptSim` read at call time (so the WASM host's
   wrapper sees every swap).
   - `load` builds the `Simulation` (`deserialize` or `newGame`) and calls
     `adopt` before the promise is returned, so a synchronous reader sees the
     new tower at once, as with commands. A `history` load copies the live
     `autoBridge` onto the new tower before the adopt. A throw rejects the
     promise and leaves the tower as it was.
   - `saveNow` returns `JSON.stringify(sim.serialize())`, or the WASM host's
     own text when the host offers it (AC 7). `save` waits as today when a
     step gate is registered (`settledSave`), then does the same. With
     `view`, the camera is read and assigned to `sim.view` right before the
     tower is written, through the field the mirror's relay watches.
   - `undoSignature` returns `towerStateSig(sim.tower, sim.money)`.
   - `generation` is a number per `Simulation` instance, assigned the first
     time the port sees it (a `WeakMap`), so a swap made outside the port
     (the WASM host's recovery) moves it too.

   `tsLifecycle.ts` is the one module in `src/simport/` that imports the
   TypeScript engine at runtime (`Simulation`, `sim/founderStatus` and
   `towerStateSig` from `UndoHistory`); `tsSim.ts` stays type-only. Both
   guards get its line with that reason (AC 9).
3. **The lifecycle contract.** `src/simport/lifecycleContract.fixture.ts`
   exports `describeLifecycleContract(name, makePort)`, and
   `src/simport/tsSimLifecycle.test.ts` runs it over `TsSim`, so the
   `unitWasm` parity project runs it on the mirror host too. Its cases, on
   seeded founded games from `src/tests/fixtures/towerFixtures.ts`:
   - `saveNow()` and `save()` return the same text, and on `TsSim` without a
     host it is `JSON.stringify(sim.serialize())`; a command issued before
     either is in it; `view` puts the camera in the text and a null keeps
     the tower's own.
   - a `history` load of an earlier `saveNow` text gives a tower whose
     `undoSignature` equals the one read when that text was taken, keeps the
     live auto-bridge setting, and moves `generation`; a command issued after
     the load applies to the loaded tower.
   - `stored`: the first loadable save wins (an unloadable first falls back
     to the second), none rejects with the first error and leaves the tower
     and `generation` as they were, and the founder rule holds both ways;
     `legacy` never applies it; `found` honors the mode, the calendar and
     the no-bridging option and starts an empty lot.
   - **Undo signature coverage, command by command.** Over the scripted
     session of slice 2's command contract (`commandContract.fixture.ts`),
     plus a tick, a camera change and a bulletin, `undoSignature` changes on
     exactly the steps where a reference changes. The case takes the
     reference as an argument: here `towerStateSig` on the live instance;
     slice 7 passes a `TsSim` twin fed the same script, which is how
     `RustSim`'s signature (slice 6a's `towerSignature()` with money beside
     it) is held to `towerStateSig`'s coverage.
4. **Undo and redo through the port.** `src/game/appHistory.ts` builds the
   history from `app.port` alone: the snapshot is `port.saveNow()`, the
   restore `port.load({ from: "history", text })`, the signature
   `port.undoSignature()`. It imports nothing from `src/engine/` at runtime
   but `UndoHistory`.
   - `UndoPorts.restore` returns a promise. `UndoHistory.undo()` and
     `redo()` return it: the commit, the pop, the redo or undo step's
     snapshot and the restore's start all happen before the call returns, as
     today, and the "Undid:" or "Redid:" notice follows the settled restore.
     A rejected restore gives no notice and rejects the returned promise.
     `GameApp.undo()` and `redo()` return it; their callers (`inputKeys.ts`,
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
   its text from the port: the Quick Save and the silent flushes
   (`saveBeforeUpdate`, the context-loss flush, the flush before a 1994
   import) and `saveToSlot` use `saveNow({ view })`; the autosave and the
   `.vctower` export use `await save({ view })`; the `.TDT` export parses
   `saveNow({ view })`; the crash report reads the header and takes
   `saveNow()` in the same task, so the summary and the save describe one
   state. `SaveGame`'s writers (`save`, `saveAsync`, `saveSlot`, `packSync`,
   `saveTo`, `saveToAsync`, `export`) take the save text, and
   `exportFilename` takes the tower's name. The stamp (`savedAt`,
   `appVersion`) is spliced into the text (D8); the stored bytes on the
   TypeScript engine are the bytes written today.
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
7. **The WASM host hands over its save text (#1158 A31).** The host offers
   the engine's save text for its tower (a registry beside `setStepGate` in
   `src/wasmhost/`), and `TsSim` uses it in `saveNow` and `save`. A save of
   a faulted host answers with the newest restore point's text
   (`RestorePoints.newestText`; `newestSave` parses it). Every save the host
   reads is still a restore point, and no save is added (#874's property:
   `perf:restore` counts the same engine saves). On the host the stored text
   is the engine's, so it differs from today's only where
   `JSON.stringify(JSON.parse(text))` would rewrite it (number forms such as
   `2.0`, the EX-2 class); a test pins that the two parse to deep-equal
   values and load to the same tower on both engines.
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
    bytes on the TypeScript engine stay as they are. No version bump. The
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
  - [ ] `port.ts`: `TowerSource`, `SaveOptions`, the members, the ordering
        note (AC 1)
  - [ ] `tsLifecycle.ts` and `createTsSim`'s `adopt` option (AC 2)
  - [ ] the host's text registry, `RestorePoints.newestText`,
        `signatureOfSave`, the auto-bridge part of `carryLiveState` (AC 4,
        7, 8)
  - [ ] `lifecycleContract.fixture.ts` and `tsSimLifecycle.test.ts`, on
        both hosts (AC 3)
  - [ ] `UndoHistory` (async restore, `dropUnchanged(sigOf)`), `appHistory.ts`,
        `GameApp.undo`/`redo`/`dropEmptyUndo`, the auto-bridge carry out of
        `adoptSim`, the host's history wrappers passing the promise on (AC 4)
  - [ ] the app's port wiring with `adopt` (one line in `main.ts`, through
        a helper if the line would wrap)
  - [ ] guard lines for `appHistory.ts` and `tsLifecycle.ts`; `main.ts
        autoBridge=` out of `LIFECYCLE` (AC 8, 9)
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
  - [ ] `saveLoad.ts` load, import, `.TDT` confirm, new game;
        `appModals.ts` loads; `legacyImportAdopt.ts`; the tower picker's
        `onLoad` takes a promise
  - [ ] the three `emit` entries out of `LIFECYCLE`; `saveLoad.ts`'s guard
        lines go (AC 8, 9)
- [ ] Each PR: the four gates, coverage, `test:wasm:parity`, the HP record,
      `/gds-code-review` and a confirming pass, the independent review

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
- **D2. `saveNow` is synchronous.** Five callers cannot wait: the undo
  capture (a gesture's first mutation follows in the same task), the flush
  before an update reload, the context-loss flush, the flush before a 1994
  import is adopted, and the crash report's pairing of the header with the
  save. `TsSim` and slice 7's main-thread `RustSim` can both answer at once.
  A worker adapter cannot; slice 12 (#1224) decides what its `saveNow`
  returns (the newest restore point is the candidate), and this story adds
  that to #1224's forward requirements.
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
- **D5. No undo queue.** A drag's commands are fire-and-forget (slice 2),
  and its commit at pointer-up must compare the tower after all of them.
  The port's ordering rule already gives that: `undoSignature` and
  `saveNow` act after every command issued before them. `TsSim` applies
  commands at once, and an adapter that applies them later applies the
  earlier ones first. A queue in `UndoHistory` would defer the capture's
  snapshot out of the gesture's task, which breaks the host's fault coding.
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
- **D9. The host's text (A31).** Today every save of a hosted tower is the
  engine's text, parsed by the host's `serialize` override and stringified
  again by the caller: one `JSON.parse` and one `JSON.stringify` of the
  whole save (2.27 million characters on large, per #874's PC run) per undo
  capture, autosave, manual save and export. The registry lets `TsSim` take
  the text itself. In `wasmHost.ts` the text function replaces the parse in
  `serializeHosted`, which becomes `JSON.parse(text())` for the callers
  that still want an object (the merge, tooling), so the file does not
  grow.
- **D10. The camera rides the save options as a function.** The autosave
  and the export read the camera after the worker host's settle wait today,
  so the save carries where the camera is when it is written. A value taken
  at the call would be read before that wait.
- **D11. Loads take decoded saves.** `SaveGame` already decodes and parses
  (it needs `savedAt` and the shape checks); the port deserializes. The
  autosave's two keys travel as candidates, so the legacy-key fallback
  `loadResult` gives mid-game loads today needs no second deserialize.
  Slice 7 may switch the readers to hand over text for `fromSave`; that is
  its call, with its own HP record.
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
| Quick Save | `stampView`, `SaveGame.save(sim)` | `SaveGame.save(port.saveNow({ view }))` | the failure toast (`saveFailureMessage`) |
| Silent flushes | the same, `save(true)` | the same | the throw to the caller |
| Autosave | settle, swap check, `stampView`, `saveAsync(sim)` | `saveAsync(await port.save({ view }))` | best effort, silent |
| Slot save | `sim.view =`, `saveSlot(n, sim)` | `saveSlot(n, port.saveNow({ view }))` | the failure toast |
| `.vctower` export | up to 3 settle rounds, `stampView`, `export(sim)` | `export(await port.save({ view }))`, the file named from `view.tower.towerName` | "Export failed: ..." and the watchdog |
| `.TDT` export | `stampView`, `buildTDT(sim.serialize())` | `buildTDT(JSON.parse(port.saveNow({ view })))` | the export error dialog |
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
| Stored bytes change | every write | byte equality on the TypeScript engine (D8); deep equality and both-engine loads on the host (AC 7); stored sizes compared on the large conformance save in the HP record |
| A restore point is lost or added | the host's saves | the text function calls the same `readPoint`; `perf:restore -- --quick` in the cloud counts the same saves (indicative, counts only) |
| The founder badge moves | stored loads | the rule rides the `stored` source alone; tests both ways and on `legacy` |
| The legacy-key fallback stops working mid-game | quick load | candidates in order (D11); a test with an unloadable first key |
| A drag's commit compares too early | gestures | the ordering rule (D5); a contract case with commands issued before `undoSignature` |
| `main.ts` passes 500 lines | the port field | the field stays one line; the auto-bridge carry's two lines leave `adoptSim` |

### Tests

- `src/simport/tsSimLifecycle.test.ts` (AC 3), in the default and the
  `unitWasm` projects.
- `UndoHistory.test.ts`: undo and redo return the restore's promise; the
  notice follows it and a rejection gives none; two undos in one task pop
  two steps in order; `dropUnchanged(sigOf)`.
- `startWasmHostFallback.test.ts` and the recovery tests: the wrappers pass
  the promise on and keep their fault codes; `dropEmptyUndo` receives
  `signatureOfSave`; the recovery's tower keeps the live auto-bridge
  setting (`carryLiveState`).
- `hostFault.test.ts`: `newestText` and `newestSave` agree and record the
  answered point once.
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
  the whole save per hosted save (A31).
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

It adds `src/simport/tsLifecycle.ts`, the adapter's one runtime edge into
the TypeScript engine, which slice 10 loads lazily and which goes when the
TypeScript engine retires. `RestorePoints.newestText`, `signatureOfSave`
and the auto-bridge part of `carryLiveState` are temporary with the
fallback and join `story-engine-retire-typescript.md`'s list.

### Constraints

- American English, no em-dashes, plain prose in comments, no "X, not Y".
- 500-line ceiling per file; `main.ts` must not grow.
- `src/simport/` imports engine values only in `tsLifecycle.ts`.
- #1068's files (`workerHost.ts`, `workerSaveSync.ts`, perfCompare,
  perfWorker) are not touched. The worker host keeps its step gate.
- Lands after #1278 (the recovery follow-up, same files) and after slices 2
  and 4; 5a's app wiring rebases on slice 2's `port` field.

### Project Structure Notes

- New: `src/simport/tsLifecycle.ts`, `lifecycleContract.fixture.ts`,
  `tsSimLifecycle.test.ts`; `src/storage/saveStamp.ts` and its test; a
  small registry for the host's save text in `src/wasmhost/`.
- Changed: `src/simport/port.ts`, `tsSim.ts`; `src/engine/UndoHistory.ts`
  (ports only); `src/game/appHistory.ts`, `saveLoad.ts`, `appModals.ts`,
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

### File List
