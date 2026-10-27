# Story facade.7: `RustSim` behind a flag, with restore points on the existing saves

Status: ready-for-dev (PR by PR, each when its inputs are on `main`; see
"Order and inputs")

Issue #1217, under the facade tracker #1207 (spine AD-9). Plan:
`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/`
(the slice plan's row 7, the architecture review's sections 5.1 to 5.7, F2,
F8, R1, R5 and R6). Forward requirements from earlier slices are in #1217's
comments and are gathered below as acceptance criteria. Written 2026-10-27
from `main` at `c0787c1f` and the open heads of slices 2 (#1290 at
`0ff4efc4`), 5 (#1294 at `4124c97d`) and 6a (#1284 at `43ed0bd2`).

## Story

As the developer moving the game onto the Rust engine,
I want a second adapter of the port, `RustSim`, that runs the engine on the
main thread with no TypeScript `Simulation` behind it,
so that slice 8 can fall back from its restore points, slice 9 can measure
the facade against TypeScript and today's host, and slice 10 can make it the
WASM host.

## Scope and what it is not

`RustSim` implements `SimPort` (`src/simport/port.ts`, with slice 5's
lifecycle members) over the binding's `Engine` and slice 6a's view exports.
It is reachable behind `?engine=wasm-facade` in tooling builds only (D1). It
does not replace today's WASM host (slice 10), does not adopt a TypeScript
tower after a fault (slice 8; here a trap freezes the facade, AC 14), and
does not run in a worker (slice 12). Nothing here changes the default
engine, a cohort, a gate or a production analytics field.

## Acceptance Criteria

### The adapter (PRs 7a to 7c)

1. **One adapter, every contract.** `createRustSim(engine, opts)` in
   `src/simport/rustSim.ts` returns a `SimPort`. Every port contract suite
   runs against it unchanged on the `unitWasm` project, beside `TsSim`:
   `describePortContract` (view, tick, events), `describePanelQueries`,
   slice 2's `describeCommandContract` and slice 5's
   `describeLifecycleContract`. A case that cannot pass on `RustSim` is a
   finding, never a skip.
2. **No TypeScript `Simulation`.** `rustSim.ts` and the modules it imports
   construct, step, deserialize or call no TypeScript `Simulation`, `Tower`
   or `Crowd`. A guard test walks `rustSim.ts`'s static and dynamic imports
   and fails on an edge into `src/engine/sim/` or `src/engine/Simulation`
   (type-only imports excepted). The `simulationReach` ratchet does not grow.
3. **Commands at issue, answers in the same task (F2).** `command()` runs
   the engine call before it returns, so the command's effect is on `view`
   when the call returns and its promise resolves in a microtask, as on
   `TsSim`. That keeps hazards 1 to 4 and 7 to 9 of #1273 out of reach on
   the main thread (they stay owed to the worker adapter, #1224); hazards 5
   (a swap mid-command) and 6 (a rejection from a trap) are real on
   `RustSim` and are covered by AC 14 and slice 8.
4. **The port's shape check first (#1290).** `command()` calls `wellFormed`
   (`src/simport/request.ts`) before the binding and answers a malformed
   command with `INVALID_COMMAND` and `delta: 0`, never calling the engine.
5. **The brush is one call sequence (#1290).** `paintBrush` runs the shared
   loop in `src/simport/brush.ts` over the engine, pass by pass in the same
   order, inside one `command()` call with no tick or other command between
   its tiles.
6. **`TsSim`'s answers, exactly (#1208's review).** `delta` on every command
   as the balance's change; `ok: false` for `resolveChoice` with nothing
   waiting, for a `toggleAutoBridge` that changes nothing, and for
   `setAutoBridge` turning bridging off in a Classic tower (the binding's
   `setAutoBridge` writes the value raw, so the refusal lives in `RustSim`);
   `setExpressStops` answers the binding's bool; every command's arguments
   reach the engine (stop on and off, the schedule, emit's kind, the removal
   method through `facility_removed`); `cached` answers dropped on a tower
   swap; `save()` holds everything issued before it;
   `drainEvents({ release: true })` hands over held command events.
7. **The view from slice 6a, read at the right tier.**
   - The layout (`viewLayout()`) is checked once per engine module: an
     unknown version or width refuses to start the facade, loudly.
   - `viewStructure()` is read on every new engine and whenever the frame
     header's tower revision moves, never otherwise. `TowerView.units`,
     `transports`, the id indexes, `highestFloor` and `lowestFloor` are
     built from it once per revision (#1245's R1 and R2; never the engine's
     `highest_floor()` walk per read).
   - `viewFrame(full)` is read once per rendered frame: the header, the
     people as a person pool reused by id, the cars, and the rooms whose
     frame fields changed, applied to the kept unit records by slot.
   - `unitMetaSince(rev)` is read when the header's meta revision moves, and
     updates only the units it lists.
   - `population` is a header field memoized per step, never summed per
     frame (#1210).
8. **`rooms` and `structure` (#1253).** `rooms` is every unit but the floor
   and lobby tiles, in `units` order, built at most once per revision, its
   entries kept current by the frame and metadata reads. `structure` is
   6a's tile runs joined into maximal runs (a run ends only at a gap, a
   change of kind or a change of width), ordered by floor then x, joined
   once per revision. Both arrays keep their identity until the revision
   moves or the engine changes, and both are re-read on every new engine
   whatever the revision. The contract case "lists the rooms, and the
   structure as runs" passes unchanged, including its tile that joins runs
   on both sides.
9. **The camera (facade lead, 2026-10-27).** A new binding getter,
   `view(): string | undefined`, returns the stored view as JSON. `RustSim`
   reads it once per new engine into `header.camera` and updates the kept
   value when it relays `setView`. Nothing reads the camera per frame. An
   appended `wasm.rs` block and `engine.d.ts`; a crate minor.
10. **Panels from the engine (6b, 6c).** `query()` answers from the 6b
    getters (`statsReport`, `unitDetail`, `transportDetail`, the overlays,
    `onboardingFacts`) and 6c's diagnostics facts, with `tsPanels`'
    TypeScript keeping only the wording. `cached` keeps `TsSim`'s bounds.
    No `towerStats` or `peakCongestionHotspot` caller per UI tick until
    #1237's floor-bounds memo (A11) and `functional_parking_set` seed are on
    `main`, or the owner accepts the deferral (#1228's gate).
11. **The lifecycle (slice 5).** `load(source)`: `history` and `stored`
    through `Engine.fromSave` on the save text, `legacy` through
    `importTdt`'s save, `found` through the engine's new game. `save()` and
    `saveNow()` return the engine's own `serialize()`, with the camera
    function read right before it (slice 5's D10). `undoSignature()` is
    `towerSignature()` and the money joined. `generation` moves before a
    load settles and stays when a load fails before its swap. The lifecycle
    contract's undo coverage case runs with a `TsSim` twin fed the same
    script as its reference, which holds `RustSim`'s signature to
    `towerStateSig`'s coverage command by command.
12. **Engine-written saves need EX-2.** The stored saves `RustSim` writes
    are the engine's text, which differs from today's re-print in number
    forms and the transports' key order. That is EX-2
    (`release-3.0-exception-register.md`), the owner's decision. Until he
    decides, `RustSim` runs only in tooling builds (D1), and its stored
    saves are tested to load on both engines, never compared byte for byte
    with a TypeScript save.

### The host (PR 7d)

13. **Boot behind the flag (#1254's boot requirements).** `?engine=wasm-facade`
    starts `RustSim` in a tooling build or a dev serve (D1):
    - the app shell and the renderer are created while the engine package
      loads; the port resolves once the engine holds its first tower, and
      the first tick and input wait on it behind the splash;
    - the first tower comes from a Rust new game or `fromSave`, never from
      a TypeScript serialize;
    - app creation builds no TypeScript `Simulation`: a runtime check in the
      facade's e2e run asserts that no `Simulation` was constructed,
      stepped or deserialized in the page life (the check slice 10 turns on
      for players);
    - catalogs are read once per build, and the identity read moves after
      the first frame (#1254's W2), with no change to when or what
      `engine_status` sends.
14. **A trap freezes the facade, for now.** A trap in an engine call goes
    through the host fault capture's strict path (`hostFault.ts`), the one
    a wasm-only build takes today: the call's promise rejects with the
    fault, the engine is frozen, a save answers with the newest
    engine-written save, and the existing engine-failure notice shows.
    Slice 8 replaces the freeze with the adopt from a restore point. No
    caller swallows the rejection (#1273 hazard 6): each `void` call site
    in #1273's list gets a `.catch` that reports through the fault path.
15. **The facade's e2e run.** The `chromium-wasm` Playwright project gains
    a facade run (`?engine=wasm-facade`): boot, new game, load, play at 1x
    and top speed, the build, transport and editor commands, undo and redo,
    a manual save, an autosave, and A5's audio cue-timing test (release
    plan assumption 6, written here if no earlier slice has), each cue
    within the bar the test pre-registers.

### Restore points and the sidecar (PR 7e)

16. **Points ride the saves the host already takes (F8, #1101).** The undo
    capture before a gesture's first command, the 30-second autosave and
    manual saves each record a restore point; nothing adds a save per
    command or tick, and #1101's tests pin that on `RustSim`.
17. **One record per point (R6, 5.7 item 1).** A point is one record built
    in one synchronous turn: a sequence number, the save text, the sidecar,
    the play-time reading and a digest of the save. The sidecar carries the
    save's digest and sequence, and a reader refuses a record whose digest
    does not match.
18. **A versioned sidecar.** The transient state the save does not carry
    (the boundary markers `fromSave` accepts, the open extend gesture,
    commute stress, elevator telemetry, the housekeeping report), as a
    schema with a version. A round-trip test on both engines (Rust writes,
    TypeScript reads; TypeScript writes, TypeScript reads) and a loud
    refusal on an unknown version or a schema mismatch. Memory only; no save
    version. Any engine export it needs is an appended `wasm.rs` block.
19. **The save budget, pre-registered.** The story's PR states the bar (no
    save task over 50 ms on the large PC tower at 1x and 4x) and the
    measurement slice 9 makes; cloud numbers in the PR are labeled
    exploratory.
20. **The cross-engine restore-point test (R5).** A CI test loads
    Rust-written points (save and sidecar) for the conformance corpus and
    the medium and large scenarios through the fallback's own adopt path and
    plays on. It runs on every change to the Rust save writer, the sidecar
    or the TypeScript load path (a path filter in the workflow, with a guard
    test that the filter names those paths).

### The cadence exclusions (PR 7f)

21. **R1's move.** The nine `atEngineFrameCadence` calls in
    `src/tests/parity/exclusions.ratchet.txt` (`rentalCrowd.test.ts` 3,
    `rooms.test.ts` 1, `fixedStep.integration.test.ts` 3,
    `fixtureHotelTower.test.ts` 2) move onto the port contract suite, where
    each engine runs natively with no merge, and leave the ratchet. Each
    gets a mapping row (old test, new contract case, what it checks) in this
    story's Dev Agent Record. A test that cannot be expressed through the
    port stays named and goes to the owner as a gate exception before slice
    11, never silently.

## Order and inputs

| PR | Content | Waits for |
| --- | --- | --- |
| 7a | `RustSim` view, tick and events (ACs 1 to 2, 7 to 9); the `view()` getter (crate minor) | 6a (#1284) on `main`; its open owner card (the per-frame room compare) |
| 7b | Commands and queries (ACs 3 to 6, 10) | slice 2 (#1290); 6c complete (all four families, #1255 is the first); #1237's A11 for AC 10's per-tick callers |
| 7c | The lifecycle (ACs 11, 12) | slice 5a (#1294), which waits on the owner's answer to the F2 amendment (`saveNow`, `undoSignature`) |
| 7d | Boot behind the flag, the e2e run, trap handling (ACs 13 to 15) | 7a to 7c; slices 3 and 4 (the renderer and panels read the port) |
| 7e | Restore points and the sidecar, the R5 test (ACs 16 to 20) | 7c |
| 7f | The cadence exclusions (AC 21) | 7a to 7c |

7a can start as soon as 6a merges. 7e and 7f can run beside 7d. Slice 8
needs 7e; slice 9 needs slice 8 (and #1242, slice 13, #1254's W1, #1270's
fixtures, the tolerance decision).

## Decisions

- **D1. A tooling-build flag.** `?engine=wasm-facade` exists only where
  `__TOOLING_BUILD__` is true (`VC_TOOLING=1`: the e2e, screenshot and perf
  builds) or in a dev serve. A production build compiles the choice away,
  so there it parses as unknown and falls back to the stored engine, and a
  build check confirms the production bundle carries no `wasm-facade`
  choice. No player can reach it, so no app version
  bump (the slice plan's "app minor if a player can reach the flag, else
  none"), no new `engine_requested` value in production analytics, and no
  stored engine-written save before EX-2. Slice 10 brings the facade to
  players with #1090's distinct `engine_requested` value and the owner's
  approval. The PC run (slice 9) uses a tooling build, as the perf harness
  already does.
- **D2. Commands apply at issue.** F2 says the main-thread host resolves in
  the same task. Applying at issue also keeps `RustSim`'s timing equal to
  `TsSim`'s, which is what the contract suites and slice 2's call sites
  were written against.
- **D3. The sidecar is slice 7's; the adopt is slice 8's.** Slice 7 writes
  the points and proves they load on TypeScript in CI (R5). Slice 8 adopts
  them at a fault, steps back on a refusal and reports it.
- **D4. Tests run on `unitWasm`.** `RustSim` needs the compiled engine, so
  its contract runs sit in `*.wasm.test.ts` files collected by the
  `unitWasm` project only; the plain `unit` project keeps `TsSim`'s runs.

## Dev Notes

### Sizes (the large tower)

43,358 units (40,458 floor and lobby tiles, 2,900 rooms), about 110 runs,
up to 88 transports, people in the low thousands. Per revision: one
structure read and one units build (O(U) once), one runs join (O(runs)).
Per frame: one frame read (O(people + cars + changed rooms)). Per step: one
`tick`. Per command: one binding call plus a structure read when the
revision moved.

### Complexity (for each PR's hot-path record)

- Per frame: `viewFrame` copy and apply; no walk over units or tiles; the
  person pool reused by id (no allocation per person per frame).
- Per step: `tick`; the population memo.
- Per revision: `viewStructure`, the units build, the runs join, the room
  list, the indexes. Measured on large in the PR (cloud, exploratory).
- Per command: the shape check, one binding call, the delta.
- Per save (undo capture, autosave, manual save): `serialize()` plus, from
  7e, the sidecar read. The budget in AC 19.
- HP-8: the per-revision view caches (units, indexes, rooms, runs, bounds)
  keyed on the engine and the frame header's tower revision; the meta cache
  on the meta revision; the camera on the engine plus `setView`. Each gets
  an inventory row.

### Files

New, in `src/simport/`, split by concern to stay under the 500-line ceiling:
`rustSim.ts` (the adapter and its queue), `rustView.ts` (the structure
build, the frame and metadata apply, rooms and runs), `rustCommands.ts`
(the shape check, the brush, each command's binding call and answer),
`rustLifecycle.ts` (load, save, `saveNow`, `undoSignature`, `generation`),
and from 7e `restorePoint.ts` and `sidecar.ts`. The contract runs go in
`rustSim*.wasm.test.ts`. Changed: `engine-rs/src/wasm.rs` and
`src/dualrun/engine.d.ts` (appended blocks), `engineChoice.ts` and
`bootstrap.ts` (7d), `playwright.config.ts` and an e2e spec (7d),
`exclusions.ratchet.txt` and the four test files (7f).

### What must not regress

- `TsSim` and the mirror host stay as they are: every existing project
  (`unit`, `integration`, `unitWasm`, `integrationWasm`, e2e) stays green.
- The wasm-only bundle check (`verify-engine-bundle`) ships no new engine
  module.
- `src/engine/` stays free of DOM and rendering; `rustSim.ts` lives in
  `src/simport/`.

### Testing

The port contract suites on both adapters (AC 1); a guard for AC 2;
`RustSim`-only cases for the layout refusal, the identity of kept arrays
across a new engine, the camera getter and `setView`, the Classic
auto-bridge refusal, and a trap's rejection; the e2e facade run; the
sidecar round trip; the R5 CI test.

### Review

Each PR: `/gds-code-review` (engine data, saves, restore points) and
`/bmad-code-review` (host plumbing) as their surfaces need, the hot-path
record, the independent review (the facade and Rust performance lane), no
auto-merge.

### Versioning

7a: crate minor (`view()`). 7e: a crate minor only if the sidecar needs a
new export. No app version change while the flag is tooling-only (D1).

## Dev Agent Record

### Completion Notes List

### File List
