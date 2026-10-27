# Story facade.2: Player commands go through the port

Status: in-progress

Slice 2 of the Rust-backed facade
(`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/slice-plan.md`),
under spine AD-9 (owner direction 2026-10-20 20:45 UTC, signed off 21:40 UTC).
Issue #1209, under the facade tracker #1207. Stacked on slice 1 (#1245).
Carries part of S9 (#954) by reference only: no closing keyword.

## Story

As the developer moving the web game onto Rust authority,
I want every player command the game issues to go through `app.port.command()`
and to read only the answer the port returns,
so that slice 7 can put the Rust engine behind the same port and every command
is then accepted or refused by Rust alone, with no call site that applies a
command to a TypeScript instance or decides a refusal itself.

## Planning, risk and testing review (before any code)

**Scope check.** The consumer inventory lists 31 command entry points in 9
files. This slice moves the ones in the game's command paths:
`buildActions.ts`, `editorActions.ts`, `keyboardPlay.ts`, `appModals.ts`
(the exterminator and its bulletins), `uiCallbacks.ts` (auto-bridge),
`frameLoop.ts` (the emergency answer and the meal-rush bulletins) and
`main.ts` (`renameTower`, which moved to `EditorActions` so a refused name
toasts like a refused label). The command paths reach two more files through
`BuildActions`: `placeSimpleBuild` in `buildPreview.ts` and the gesture
handlers in `engineWiring.ts`. The lifecycle writes in the same inventory row
(the camera stamped before a save in `saveLoad.ts` and `appModals.ts`
`saveToSlot`; the bulletins in `appBoot.ts` (an unreadable save at boot),
`legacyImportAdopt.ts` (an imported 1994 tower) and `saveLoad.ts` (a
recovered graphics reset); the bridging preference `main.ts` `adoptSim`
keeps on an undo or redo restore; and the host's own in `startWasmHost.ts`)
belong to slice 5 (#1212), agreed with the Runtime thread on 2026-10-21.

**Ownership agreed before editing (2026-10-21, 01:59 to 02:00 UTC).**
- Facade lane: `paintBrush` as one port command; the drift check's exclusion
  line in `view.types.test.ts`; a separate `commandContract.fixture.ts` with
  `describePortContract`'s options; a follow-up PR (2b) after #1244 with the
  engine's answer conversion (`src/simport/engineCommands.ts`) and a
  differential against the WASM `Engine`; `GameApp.port` as the one creation
  point. In `tsSim.ts` the `COMMANDS` table and `command` are this slice's.
- Slice 4 (#1211): every query moves in slice 4, including the latest-wins
  build-preview quotes (#1209 lists them; they live in `updateBuildPreview`'s
  query path, which #1211 also names). This slice leaves the query reads in
  its files as they are (Dev Notes list them) and uses only the two queries
  slice 1 defined.
- Runtime (slice 5): this slice edits `main.ts`, `frameLoop.ts` and
  `appBoot.ts`'s `wireControllers` only as listed in the tasks.

**Risks and how the slice meets them.**

| Risk | Where | Mitigation |
| --- | --- | --- |
| An awaited command reorders feedback or undo | every call site | `TsSim` applies a command at once and resolves in a microtask of the same task, so sound, toast and undo land in the same task as today. Each handler that brackets its own command with undo awaits the command before `commitUndo`. Tests await every controller method |
| A drag issues commands faster than an async adapter answers | `onActionMove` paint and bulldoze steps | Drag steps are fire-and-forget (`void`); the port runs them in issue order (port contract). The paint anchor is set before the command is issued, so the next step never reads a stale anchor |
| A command's result is read before it settles | after-command reads | Audit (Dev Notes): every read of the command's effect comes after `await`, and reads of the effect use `port.view` |
| The brush changes order or charges | `paintBrush` | One port command over the brush's tile list, run as one engine call in each engine (`src/engine/sim/brush.ts`, `engine-rs/src/brush.rs`): the builds of today's loop, pass by pass in the same order. The mirror relays the brush as one `paintBrush` command, and tests pin each engine's brush to the same builds issued one by one (save, unit order, events). No tick can fall between its tiles |
| A TypeScript pre-check decides a refusal the engine owns | the stops dialog | The endpoint and express-lobby pre-checks go; the engine's answer decides, and an unchanged tower leaves no undo step (`UndoHistory.commit` compares signatures) |
| A thrown command becomes a rejection | engine faults | The port rejects with the error; floating promises reach `analyticsErrors.ts`'s `unhandledrejection` listener, which reports them as it reports `error`. The fault-in-a-command path is #1218 (slice 8) |
| Test churn hides a lost assertion | 230 test call sites | Each test awaits the controller method or flushes the queue; no assertion is removed or weakened. The coverage ratchet holds |

**Hot path.** Commands run per user action, never per frame, except
`emitMealRushes` (per frame, issuing a command only on the frame a bulletin
fires) and drag steps (per pointer move). Each command costs the port's shape
check (constant work: one check per tile for a brush of at most 32, and at
most 256 values for a schedule or camera), one result object and one
promise; the kind check is one closure per port over the per-catalog index.
The brush is one command per stamp instead of one build call per tile at the
call site (same engine work). The one query this slice touches is
`transportReason`'s `isUnlocked`, which slice 1 had put on `port.query` and
which now runs only for a refused transport; build-preview cost is unchanged
(slice 4 owns it). The review's Hot-Path
Auditor patched two inherited costs on the touched paths: the meal-rush
census now runs only on a frame where a rush is due, and a placed transport
is no longer diagnosed. The rest are deferred with issues (Completion Notes).

## Acceptance Criteria

1. **One port.** `GameApp.port` is `createTsSim(() => this.sim)`, created
   once; `GameAppPorts` carries it. `BuildActions`, `EditorActions` and
   `KeyboardPlay` take `port: SimPort` in their deps (wired in
   `appBoot.ts` `wireControllers`).
2. **Every command through the port.** In the files above, no call site
   applies a player command to the instance: `build`, `buildTransport`,
   `removeFacility`, `beginExtend`, `extendTransport`, `endExtend`, `addCar`,
   `removeCar`, `setStop`, `setExpressStops`, `clearStops`, `setSchedule`,
   `setLabel`, `adjustRent`, `setNoRate`, `priceUnit`, `applyRentBatch`,
   `setFilmPolicy`, `rerollSubtype`, `callExterminator`, `resolveChoice`,
   `toggleAutoBridge`, `setTowerName` and `emit` go through
   `port.command()`, and the caller reads only the result. A source guard
   (`src/tests/commandSites.guard.test.ts`) fails if a frontend file calls a
   command method on a simulation or tower, or writes a setting a command
   owns, again; slice 5's lifecycle writes are pinned there and only shrink.
3. **The paint brush is one command.** `{ op: "paintBrush"; kind; floor;
   tiles }` answers `{ ok, reason?, delta, placed }`: `placed` tiles laid,
   `ok` when at least one was, `reason` the last refusal the engine gave, and
   `delta` the balance's change over the whole brush. `kind` is `"floor"` or
   `"lobby"` (`BrushKind`). The loop is the engine's `paintBrush`
   (`src/engine/sim/brush.ts`, Rust twin `engine-rs/src/brush.rs`), today's
   loop moved (skip a tile already of this kind, let a lobby brush upgrade
   plain floor, repeat while a pass laid something), so the brush lays what
   its passes' builds, issued one by one, lay. The mirror relays it as one
   `paintBrush` command and the binding refuses a malformed brush as
   TypeScript does (F2).
4. **Results replace re-reads.** `placeSimpleBuild` reports a room's `ok`
   from the build's answer (it compared `units.length` before and after); the
   brush's "already built here" check reads `port.view` after the command
   settles. Every read of a command's effect follows its `await` (Dev Notes,
   "After-command reads").
5. **Refusals come from the engine.** The stops dialog drops its endpoint and
   express-lobby pre-checks and lets the engine refuse; the extend, car, rent,
   reroll, film policy and exterminator paths read the result's `ok`,
   `reason` and named fields as before.
6. **Async contract held at the UI seams.** `onToggleAutoBridge` resolves to
   the preference in force (the settings checkbox sets itself when it
   settles, and falls back to the live preference if the command fails); the
   batch pricing dialog's `apply` is awaited before its summary, runs once
   per open and closes without a summary on a refusal; the schedule dialog
   closes once `setSchedule` has answered, takes one OK, says so when the
   engine refuses, and a stop toggle that answers after the dialog closed
   repaints nothing; the emergency dialog clears `shownChoice` once
   `resolveChoice` settles, whether it answered or failed.
7. **The command contract.** `src/simport/commandContract.fixture.ts` exports
   `describeCommandContract(name, makePort, opts)`, with
   `describePortContract`'s `restarts` option. Per command: the accepted path
   (result shape, `delta` equals the balance's change, the effect on `view`);
   each refusal path (no state change, `delta` 0, the engine's `reason`, no
   gameplay event and no log line); malformed input (a non-integer or NaN
   number, a number outside the 32-bit range the Rust binding takes, an
   unknown op or kind (`constructor` and `__proto__` included), a bad
   direction, end, method, policy or flag, a brush with a hole or more than
   32 tiles, a non-string label, name or bulletin, text over 4,096
   characters) refused without a throw,
   with the engine's own "That request is not valid.", by the port's shape
   check (`src/simport/request.ts`) before the engine sees it; a schedule
   or camera accepted only as plain data the host can copy to the Rust
   engine as JSON (at most 256 values and 4,096 characters, no BigInt,
   function, class instance, getter, cycle or lone surrogate), and a schedule
   that is plain data stays the engine's to harden (a non-object clears it,
   and both engines read the same JSON copy); a
   tower name or bulletin with half a surrogate pair kept with U+FFFD, as the
   Rust engine reads it (`engine/wellFormed.ts`); a stop on an endpoint
   answered and changing nothing; a camera kept as a JSON copy with every
   field, as the Rust binding keeps it;
   issue order across back-to-back commands; the brush atomic against steps,
   equal to its passes' builds issued one by one (a lobby brush with bridging
   off takes three passes), and a repeated column laid once.
   `src/simport/tsSimCommands.test.ts` runs it over `TsSim`, with the paths a
   founded tower cannot reach (Classic, a cinema, an express shaft's stops)
   ticked so the parity host sees them;
   `npm run test:wasm:parity` runs it on the WASM mirror host, where a
   divergence between the two engines fails the case. Slice 7 runs it over
   `RustSim`.
8. **No behavior change for a player.** Under both of today's hosts every
   flow behaves as before (sounds, toasts, announcements, undo steps). No
   version bump (internal only). `npm run typecheck`, `npm run lint`,
   `npm test`, `npm run build` and `npm run test:wasm:parity` are green; the
   coverage ratchet holds; no touched production file passes 500 lines, and
   the oversized integration suites stay on the file-size ratchet.
9. **Forward requirements recorded.** On #1217 and #1224: the brush is one
   synchronous engine call sequence on `RustSim` and one message on the
   worker, with no step between its tiles; `RustSim` runs the port's shape
   check before the binding; and the UI hazards of a port that answers later
   (#1273) are settled before either ships.
10. **Review.** `/gds-code-review` with the Hot-Path Auditor layer, every
    `patch` fixed, every `defer` in the backlog with an issue; the HP record
    posted on the PR each round and linked from its body; the independent
    review through the coordinator. No
    auto-merge before the GO.

## Tasks / Subtasks

- [x] Port wiring (AC 1): `GameApp.port`, `GameAppPorts.port`, controller deps
- [x] `paintBrush` (AC 3): `commands.ts` member, `TsSim` handler; the
      brush in both engines with its binding and relay (F2)
- [x] Port shape check (AC 7): `src/simport/request.ts`, run by `TsSim`
- [x] Call sites (AC 2, 4, 5, 6)
  - [x] `buildActions.ts`, `buildPreview.ts` `placeSimpleBuild`
  - [x] `engineWiring.ts` command handlers
  - [x] `keyboardPlay.ts`, `inputKeys.ts`
  - [x] `editorActions.ts`, `uiBatchPricing.ts` `apply`, `uiElevatorSchedule.ts`
  - [x] `appModals.ts` exterminator
  - [x] `uiCallbacks.ts`, `UI.ts`, `uiSettings.ts` auto-bridge
  - [x] `frameLoop.ts` emergency answer and meal rush
  - [x] `main.ts` `renameTower` (now `EditorActions.renameTower`)
- [x] Guard (AC 2): `src/tests/commandSites.guard.test.ts`
- [x] Command contract (AC 7) and its `TsSim` test; `contract.fixture.ts`
      exports its helpers
- [x] Existing tests and e2e specs await the controllers
- [x] Gates, parity, file sizes (AC 8)
- [x] Forward requirements on #1217 and #1224 (AC 9)
- [ ] `/gds-code-review`, fixes, HP record (AC 10)

## Dev Notes

### After-command reads (the audit)

| Call site | Reads after the command | Under the port |
| --- | --- | --- |
| `BuildActions.tryBuild` | `res.ok`, `res.reason` | after `await` |
| `BuildActions.tryBuildTransport` | `res.ok`, `res.reason`; `transportReason` asks `isUnlocked` and `validateTransport` on a refusal | after `await`; `isUnlocked` through `port.query`, `validateTransport` a direct read until slice 4 |
| `BuildActions.paintBrush` | `structureKindAt` per tile in the loop; `structureKindAt` over the brush for "already built here" | the loop runs inside the command; the final check reads `port.view` after `await` |
| `placeSimpleBuild` (room) | `tower.units.length` before and after | the build's `ok` |
| `BuildActions.tryRemoveUnit`, `removeTransportWithRefund`, `bulldozePicked` | `res.ok`, `res.reason`; then `selectedId()` | after `await` |
| `KeyboardPlay.commitCursor` | the placement outcome, the shaft build's result; `refreshCursorPreview` reads the tower | after `await`, then `commitUndo` |
| `EditorActions.extendSelectedTo` | `res.ok`, `res.bottom`, `res.top`, `res.added`; `refreshEditor` | after `await` |
| `EditorActions.handleEditAction` | each result; `refreshEditor` re-renders from the tower | after `await`, then `commitUndo` |
| Schedule dialog stops and `apply` | `refreshEditor`, the dialog's `read` | after `await` |
| Batch pricing `apply` | the batch tally for the summary | the dialog awaits it |
| `confirmExterminate` | `res.ok`, `res.reason`, `res.cost`; `showStats` re-renders | after `await` |
| Emergency dialog | `pendingChoice` on the next frame (`shownChoice` latch) | `shownChoice` clears after `await` |
| `onToggleAutoBridge` | the preference | the result's `value` |

Not reads of a command's effect, so unchanged: catalog lookups
(`towerCatalog`), the selection, DOM input values read before the command.

### Queries left in this slice's files (slice 4 moves them)

`transportReason`'s `isUnlocked` (moved to `port.query`, which slice 1
defines) and `validateTransport`; `refreshCursorPreview`'s
`placeTransportDryRun` and `isUnlocked`; `openBatchPricing`'s
`previewRentBatch`; `openSchedule`'s `elevatorHourlyLoad`,
`elevatorOriginLoad`, `lobbyFloors`, `stopsAt`; `confirmExterminate`'s
`housekeepingCoverage` and its quote (the confirm prompt prices the call
from the catalog's fees; the engine's quote is a slice 4 query).

### Lifecycle writes left for slice 5

`view =` in `saveLoad.ts` and `appModals.ts` `saveToSlot`; `emit` after a
recovered graphics reset in `saveLoad.ts`, and after a load in
`legacyImportAdopt.ts`, `appBoot.ts`,
`startWasmHost.ts`; `adoptSim`'s auto-bridge carry; undo's capture and
commit across a drag (down, move, up), which slice 5 queues on the port.

### Constraints

- American English, no em-dashes, plain prose in comments, no "X, not Y".
- 500-line ceiling (`main.ts` sits at 495 after `renameTower` moved out).
- Engine values in `src/simport/` only where the adapter needs them: `TsSim`
  reads the catalog handle (`towerCatalog`, `findCatalogFacility`) for the
  shape check's kind test and `engine/wellFormed.ts` to repair text as the
  Rust engine reads it; `request.ts` imports types only.
- No closing keyword on #868 or #954.

### What it removes (temporary TypeScript)

The direct command calls on `Simulation` and `Tower` in the command paths,
the stops dialog's TypeScript refusal pre-checks, and `placeSimpleBuild`'s
unit-count comparison.

### References

- [Source: architecture-rust-facade-2026-10-20/ARCHITECTURE-REVIEW.md#5.3 Commands], #6, #7
- [Source: architecture-rust-facade-2026-10-20/slice-plan.md, slice 2 row]
- [Source: architecture-rust-facade-2026-10-20/consumer-inventory.md, 1C]
- [Source: architecture-rust-facade-2026-10-20/plan-updates.md#4 (#954)]
- [Source: story-facade-1-port.md], issue #1209 and its forward requirements
- [Source: docs/performance/hot-path-review.md]

## Dev Agent Record

### Agent Model Used

Claude Code (the "Facade commands" thread), 2026-10-21.

### Debug Log References

### Completion Notes List

- Malformed commands are refused at the port (`wellFormed` in
  `request.ts`), because the two engines read them differently: the Rust
  binding's glue turns NaN into 0 for a whole-number parameter and throws on a
  kind it does not know, where the TypeScript engine built at a NaN floor.
- `/gds-code-review` round 1 (Blind Hunter, Edge Case Hunter, Acceptance
  Auditor, Hot-Path Auditor) on 007703e. Patched: the batch and schedule
  dialogs' refusals, double applies and close order; the emergency latch on a
  failed command; transport diagnosis only on a refusal; the shape check's
  32-bit range, holes, tile cap and exhaustive value lists; `BrushKind`; text
  repaired as the Rust engine reads it; the camera copied; the settings
  switch on a failed toggle; `paintFloorRun` settling on its steps; the guard
  on the syntax tree; contract cases for multi-pass and repeated-column
  brushes, endpoint stops, unreadable schedules and the camera; the adapter
  tests ticked on the parity host; the meal-rush census only when a rush is
  due; one kind-check closure per port.
- Deferred, each with an issue: the UI hazards of a port that answers later
  (#1273, row `facade-async-command-hazards`); the keyboard bulldoze
  announcement after a refusal (#1274, pre-existing, since fixed on main by
  #1299); the TypeScript `removeUnit` scan under the bulldoze drag (#1170
  item, Rust half #1158 A17, callers added there; round 2 found the lobby
  brush half always-patch, and round 3 widened that to every caller, so the
  whole item went to the owner, who chose to fix it here: F2 below);
  `bridgeFillPlan` three times per build (#347, notes updated); the cap
  checks' unit walks (#1239, #1158 A24); the undo capture's JSON round trip on
  the WASM host (an item on #1170's row, fixed with #1212).
- `/gds-code-review` round 2 on 2bceee3. Patched: the batch dialogs close on
  a failed apply and drop an answer that lands after the player closed them;
  the bridging switch passes a fault on to the error report; the port checks
  that a schedule or camera is plain data the host can copy to the Rust
  engine (a BigInt, a cycle or a huge sparse array trapped the host), caps
  stored text at 4,096 characters and reads a null zoom as absent; `TsSim`
  stores the camera as a JSON copy, every field kept, as the Rust binding
  does; the guard follows locals declared from a simulation or tower, every
  assignment operator, destructuring and `delete`; the emergency answer and
  the exterminator run on the parity host, and the refusal cases check events
  and log lines; a test pins that a placed transport is not diagnosed.
  Deferred: `resizeTransport`'s scan of every shaft per added floor on an
  extend drag (#1158 note, TypeScript twin on #1170's row); call sites that
  compare an answer with state read before the await (#1273 item 7).
  Dismissed: `setLabel` text (the engine repairs it, `Tower.setLabel`), a
  price target's range (the binding takes it as a float), `removeTransport`'s
  id scan (at most 88 shafts, under the small-collection bound).
- The TypeScript `removeUnit` scan (F2). Section 7 counts `runBrush` as a
  rewrite, and round 3 reads the in-place edits of `tryBuild`,
  `paintFloorRun`, `tryRemoveUnit` and `bulldozePicked` (their calls now go
  to the port) the same way, which makes it an always-`patch` item on every
  slice 2 command that reaches `Tower.removeUnit`: the lobby brush press over
  plain floor (about 8 × 43k element visits per press on the large tower),
  the lobby drag run and the bulldoze drag (about 43k per removal, per
  pointer move), the editor's Sell and the keyboard bulldoze (one per
  action), and the rollbacks after a refusal (`ensureFloorUnder` and the
  bridge rollback in `sim/build.ts` under a build, `layShaftFloors` under an
  extend drag). On 2026-10-27 Naftali chose "Fix it in this PR" on the
  decision card ("I add a batched removal to both engines with a crate bump
  and a conformance run"), so it is fixed here, in both engines:
  - `src/engine/tower/removal.ts` and its Rust twin
    `engine-rs/src/tower_removal.rs`: a removal finds its unit by id
    (TypeScript's `byId`, Rust's `by_id` index), closes the gap in the list
    and, in Rust, rewrites only the indexes after it; `removeUnits` takes a
    command's several removals out in one pass, with the same list, indexes,
    express stops, wedding hall flag and revision as removing them one by
    one. The three rollbacks call it.
  - The brush moved into both engines as one call (`paintBrush`,
    `src/engine/sim/brush.ts` and `engine-rs/src/brush.rs`, with a
    `paintBrush` binding that refuses malformed input as TypeScript does),
    and the mirror relays it as one command. Inside it a lobby laid over one
    plain floor tile takes that tile's place in the list, and at the end
    what the brush placed moves to the end in one pass, so the list ends as
    laying the tiles one by one would leave it, and the revision goes up
    once more. A lobby brush press is one pass instead of one per tile.
  - What stays: the id scan is gone, several removals in one command take
    one pass, and a lobby brush's upgrades share one pass. A single removal
    (bulldoze drag step, Sell, keyboard bulldoze, one lobby of a drag run)
    is still one pass over the list per command: TypeScript's `indexOf` and
    `splice`, Rust's shift and the rewrite of the `by_id` entries after it
    (up to about 43k on the large tower). HP-6 and the per-command tier
    allow that; a drag run's per-tile commands as one is #1273 item 8.
    Crate 0.9.0 for the binding.
  - Review round 1 on the fix (2026-10-27, Blind Hunter, Edge Case Hunter,
    Acceptance Auditor): a stale position or index never takes another unit
    (TypeScript checks the slot, Rust checks the id at the index); the unit
    is made before its slot is taken, so nothing runs between the two; Rust
    scopes the batch with `Simulation::with_lobby_upgrades`, as TypeScript
    does; the binding reads the tiles raw, so a non-string is refused
    instead of throwing in the glue; the mirror hands the engine the copy it
    relays; tests add a wedding hall and two sky lobbies removed
    interleaved, exact counts, a nested brush, raw binding refusals against
    TypeScript, and a sky-lobby upgrade in the command contract. Deferred:
    a `paintBrush` op in the conformance suite, which has none, so its run
    only shows the lock unchanged (#1351).
  - The wasm-only build ships the two new modules (`sim/brush.ts`,
    `tower/removal.ts`): code moved out of `src/simport/brush.ts` and
    `Tower.ts`, listed in `scripts/engine-bundle.allow.txt` with the reason.
- 2026-10-22 to 10-23, at the owner's request on the PR, Copilot merged
  `main` into the branch (5049e5d, 54dc072, d8fddba; the merge kept #1299,
  `main`'s fix for #1274) and, in 54dc072, changed two things for the two Codex P2
  findings. Both were reverted on 2026-10-27, with the reasons on the PR:
  floor and lobby drag runs sent as 32-tile `paintBrush` commands (the brush
  retries a refused tile until nothing more lands, so a drag from an
  unsupported anchor filled back toward it, only inside each 32-tile chunk,
  and the anchor moved only after every answer, so a port that answers later
  would resend tiles; carrying a run's builds as one worker message is #1273
  item 8); and `place` removing a lobby's floor tile through an id-to-index
  map of every unit (a lobby is one tile wide, so the map replaced one
  `findIndex` with more work per placement, left F2 as it was, and changed
  `src/engine/` without its Rust twin). A 240 s timeout added to a
  hotel-tower fixture test went too; `main` no longer needs it. Copilot's
  53bb3bd ("Changes before error encountered") carried 45 files of other
  work that `main` merged on its own; it left no net change, and the branch
  was reshaped (same tree) before the independent re-review, so it is not in
  the history.
- The independent review of d8fddba (NO-GO) asked for the two reverts, the
  drag contract pinned by a test with a port that holds its answers, the
  #1274 row marked done, the PR body and the hot-path record refreshed. All
  done; the drag run stays per tile (see above) rather than the reviewer's
  suggested chunked brush, since the brush's retry changes what a drag lays.
- `main` merged with slice 4a (#1313): `confirmExterminate` keeps 4a's
  coverage query, in-flight guard, toast and both tower checks (the one in
  the confirm runs before `callExterminator`), with this slice's `emit` and
  `callExterminator` commands, as the slice 4 lane prepared it.
- `/gds-code-review` round 3 (four layers and the Hot-Path Auditor) on
  e99d5f8. Patched: the port refuses plain data with a lone surrogate (the
  Rust engine's JSON parser refuses it, which trapped the host), a getter, or
  more than 4,096 characters of strings and keys in all (a camera keeps every
  field, so a long one reached every save); `TsSim` hands `setSchedule` a
  JSON copy, as the host hands the Rust engine;
  `runBrush` walks the tiles by index, as the check read them; a refused
  rename toasts the engine's reason (a label over 4,096 characters used to be
  stored; now it is refused with "That request is not valid."); AC 7's
  wording; the F2 records. Deferred: a drag run's per-tile commands as one
  composite command and one worker message (#1273 item 8, F4); the batch
  pricing dialogs say nothing of a batch applied after the player closed
  them, and the schedule dialog stays editable while its OK is in flight
  (#1273 item 9); the WASM hosts' full-save merge after each edit, which a
  drag reaches every move (R3-1, by reference to #1158 A23: #1045, #1050,
  #1068; the host runs it from its frame sync when the revision changed, at
  most once per frame and outside the calls this slice changed, and a drag
  on `main` changes the revision every move too, so neither the scan nor its
  tier is new here). Dismissed: the e2e and script callers of the now async methods
  (all await them); the per-controller ports in the integration tests
  (`TsSim` keeps no command state between ports); a stop click that changes
  nothing pays an undo capture (the #1170 undo-capture item, fixed with
  #1212, covers it).
- `/gds-code-review` round 4 (four layers and the Hot-Path Auditor, a
  confirming pass on 784e1b3, round 3's fixes and the slice 4a merge).
  Patched: the lone-surrogate check used a regex lookbehind, a parse-time
  SyntaxError on Safari below 16.4 that would have stopped the game loading
  there (the build targets `esnext`), so it now takes out the pairs and looks
  for a survivor, as `towerFileCodec.ts` does, and a guard test
  (`regexLookbehind.guard.test.ts`) keeps lookbehind out of shipped code; the
  port refuses an array subclass or an array with its own `toJSON` (the JSON
  copy ran the caller's code) and a getter among a brush's tiles; the
  schedule contract case that could not fail (NaN and null coerce alike) is
  now a field JSON leaves out, which `main`'s TypeScript engine stored and
  the Rust engine never saw, plus an `undefined` schedule; new refusal cases
  for the character budget across several strings, the key count, an array
  element getter, an array subclass and an own `toJSON`; `plain()`'s doc
  names the costs outside its budget (an object's keys listed first, a
  Proxy's traps, and a getter on the command itself, which the handler reads
  again: page code only, so documented rather than copied) and no longer
  says a worker message is spared the key listing; the F2 records name
  every caller. Deferred: the exterminator confirm drops a command that rejects
  (no toast, no reopened stats), joining #1273 item 9; the exterminator
  path's unit walks per click (R4-1, `main`'s code reached through the
  merged confirm: #1262, #1173 F2, #539 item 2, #905, #1237). Dismissed: a
  generic toast for a rename over 4,096 characters (below); a refusal's
  extra fields for ops it does not list (every op the port can refuse as
  malformed is listed; `toggleAutoBridge` takes no fields, so it never is).
- A confirming pass on round 4's fixes (round 5). Patched: an own `toJSON`
  that no key lists (not enumerable) passed the check on a plain object, and
  the JSON copy then called it, so the port now refuses any own `toJSON`;
  #1273's body lists items 7 to 9. Dismissed: `tileList` accepts an array
  subclass (the brush reads only its own indices and never copies it);
  `view()` reads `tile` and `floor` by property access (no production
  caller, both engines agree, and load drops a bad camera).
- The independent re-review of 8129b82 gave a CONDITIONAL GO with one
  test-only condition: a contract case that nests a schedule past the depth
  cap, since no case failed when the cap was removed. Added.
- The editor's fallback refusal lines ("Those prices could not be set.",
  "That schedule could not be saved.", "That name could not be saved.") show
  only for a refusal today's editor cannot cause on `TsSim`: it opens the
  dialogs on a priceable kind or a live elevator, and renames a unit that is
  selected. A refused rename shows only for a label over 4,096 characters,
  which only a paste of that length reaches; on `main` it was stored, and now
  it is refused with "That request is not valid." and the error sound, the
  name box keeping the text. The tower name took the same path late: Copilot
  found `renameTower` dropped the port's answer, so a refused name showed
  nothing; it now lives on `EditorActions` and toasts like a refused label. A player notices only by pasting a name that
  long, so no version bump is due; the change is recorded here.

### File List

- `src/simport/request.ts` (new), `commands.ts`, `tsSim.ts`
- F2, both engines: `src/engine/tower/removal.ts` (new, with
  `removal.test.ts`), `src/engine/sim/brush.ts` (new), `Simulation.ts`,
  `Tower.ts`, `tower/placement.ts`, `tower/transport.ts`, `sim/build.ts`;
  `engine-rs/src/tower_removal.rs` (new, with `tower_removal_tests.rs`),
  `brush.rs` (new), `tower.rs`, `build.rs`, `lib.rs`, `wasm.rs`,
  `wasm_facade_commands.rs`, crate 0.9.0 and its pins; the relay
  (`src/dualrun/commands.ts`, `mirror.ts`, `shadow.ts`, `binding.ts`,
  `exportTiers.ts`, `engine.d.ts`); `dualRunBrush.integration.test.ts`
  (new); `scripts/engine-bundle.allow.txt`
- `src/simport/commandContract.fixture.ts` (new), `tsSimCommands.test.ts`
  (new), `contract.fixture.ts`, `view.types.test.ts`
- `src/tests/commandSites.guard.test.ts` (new),
  `regexLookbehind.guard.test.ts` (new),
  `frontendEngineImports.ratchet.txt` (one line: `tsSim.ts` imports
  `engine/wellFormed`, and retires with `src/engine/`)
- `src/main.ts`, `src/game/appBoot.ts`, `appModals.ts`, `buildActions.ts`,
  `buildPreview.ts`, `editorActions.ts`, `engineWiring.ts`, `frameLoop.ts`,
  `inputKeys.ts`, `keyboardPlay.ts`, `uiCallbacks.ts`
- `src/ui/UI.ts`, `uiBatchPricing.ts`, `uiElevatorSchedule.ts`,
  `uiSettings.ts`
- Tests: `src/game/appModals.fixture.ts` (the fake port's `command` runs
  `TsSim`), `appModalsStats.test.ts` (awaits the confirm), `buildPreview.test.ts`,
  `engineWiring.test.ts`, `frameLoop.test.ts`, `uiCallbacks.test.ts`;
  `src/tests/uiFixture.ts`; `src/tests/integration/gameControllers`,
  `gameControllersCoverage`, `towerCongratsDialogs` and `uiDialogs`
  integration tests
- e2e: `auto-floor.spec.ts`, `offlineHelpers.ts`, `wasmEngine.spec.ts`
- `_bmad-output/implementation-artifacts/backlog.md` (rows
  `facade-async-command-hazards`, `keyboard-bulldoze-refusal-announce`; notes
  on `auto-floor-bridge-distance`, `ts-render-ui-hotpath-sweep` and
  `engine-rs-hotpath-audit`)
