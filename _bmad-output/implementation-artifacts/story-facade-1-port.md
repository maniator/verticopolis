# Story facade.1: The port and its contract (`SimPort`, `TsSim`, the Simulation reach guard)

Status: review

Slice 1 of the Rust-backed facade
(`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/slice-plan.md`),
under spine AD-9 (owner direction 2026-10-20 20:45 UTC, signed off 21:40 UTC).
Issue #1208, under the facade tracker #1207. Relates to #868 (S6, the read side)
by reference only: no closing keyword.

## Story

As the developer moving the web game onto Rust authority,
I want one `SimPort` interface with a `TsSim` adapter over today's live
`Simulation`, the read-only view interfaces, the command and query types, a
port contract suite, and a guard that pins every path from production code to
`src/engine/Simulation.ts`,
so that slices 2 to 5 can move consumers behind the port while both of today's
hosts keep working, and no new dependency on the TypeScript `Simulation` slips
in while they do.

## Acceptance Criteria

1. **The port.** `src/simport/port.ts` exports `SimPort`:
   - `readonly view: SimView`, read synchronously;
   - `tick(dtMinutes: number): void`, the frame loop's step (the shape
     `advanceOwedMinutes` in `src/game/frameLoop.ts` already takes);
   - `command<C extends Command>(c: C): Promise<CommandResult<C>>`;
   - `query<Q extends Query>(q: Q): Promise<QueryResult<Q>>` and
     `cached<Q extends Query>(q: Q): QueryResult<Q> | undefined` (the last
     answer to an equal query, `undefined` before the first);
   - `save(): Promise<string>`, the engine-format save JSON the instance
     serializes today;
   - `drainEvents()`, delegating to the instance's gameplay-event drain.

   `load` and the change counter are not in this slice. Both port members
   arrive with slice 5 (the counter as undo's signature, backed by slice
   6a's engine counter), and `TsSim` could not give them today's behavior
   exactly. The doc comment names that, so slice 5 adds them.
2. **The view.** `src/simport/view.ts` exports `SimView` (`header`, `tower`,
   `crowd`), `HeaderView`, `TowerView`, `UnitView`, `TransportView`,
   `CrowdView` and `PersonView`, `readonly` all the way down
   (`ReadonlyArray`, readonly fields, methods that return readonly views).
   Their members are what the renderer and HUD read today, from the consumer
   inventory's buckets 2S and 2F (Dev Notes list them). A type test proves the
   live TypeScript `Tower`, `Crowd`, `Unit`, `Transport` and `Person` are
   assignable to them, so `TsSim` hands out the live objects with no copy.
3. **Commands.** `src/simport/commands.ts` exports `Command`, a union
   discriminated on `kind` with one member per player command the consumer
   inventory's 1C table lists (26, Dev Notes), and `CommandResult<C>`:
   `{ ok: boolean; reason?: string; delta?: number }` plus the named fields
   each command's call sites read today (an extension's `bottom`, `top` and
   `added`; a rent change's new `rent`; a reroll's `subtype`; a batch's
   result; the exterminator's `cost` and `rooms`; the auto-bridge's `value`;
   a film policy's `policy`). Nothing a call site reads today is dropped. A
   type test pins that every player op in `ShadowCommand`
   (`src/dualrun/commands.ts`) that the inventory lists has a `Command`
   member, so the two lists cannot drift.
4. **Queries.** `src/simport/queries.ts` exports `Query` with `canBuild`
   (`{ kind, floor, x }`, answering `{ ok, reason?, cost }`) and `isUnlocked`
   (`{ kind }`, answering a boolean), and the stable key `cached` uses. Later
   slices add members here.
5. **`TsSim`.** `src/simport/tsSim.ts` exports
   `createTsSim(getSim: () => Simulation): SimPort`:
   - it re-reads `getSim()` on every call, so an `adoptSim` swap is seen
     without rebuilding the port (the pattern `src/main.ts`'s friend modules
     use);
   - `view` returns the live `sim.tower` and `sim.crowd` and a header read
     from the live instance, with no copy and no allocation per read beyond
     the header object;
   - `command` runs the command synchronously by calling the instance's own
     method (`sim.build(...)`, `sim.tower.setStop(...)`, `sim.view = ...`)
     rather than an inner module function, so the mirror host's relay
     (`relayCommands` in `src/dualrun/mirror.ts`) sees it exactly as it sees
     today's direct calls; the effect is on the view before the promise
     settles, the promise resolves with the converted result, and a throw
     from the instance rejects it with the same error;
   - commands, queries and saves run in issue order (they are synchronous,
     so issue order is execution order); the contract suite pins it;
   - `src/simport/` imports from `src/engine/` with `import type` only, so it
     adds no line to `src/tests/frontendEngineImports.ratchet.txt` and no
     edge to the guard in AC 7.
6. **The contract suite.** `src/simport/contract.ts` exports
   `describePortContract(name, makePort)`, which a test runs over any
   adapter. Its cases, on a seeded founded game built with the fixtures in
   `src/tests/fixtures/towerFixtures.ts` (each construction step asserted):
   - a scripted session (lobby, floors, an office, an elevator, ticks, a rent
     change, an extension, an exterminator call where the mode allows it)
     returns results in the documented shapes;
   - after each command the view shows its effect (a structural command moves
     `header.revision`; a charged command moves `header.money` by `delta`,
     the signed change to the balance, negative for a charge, as today's
     `ChargeResult` reports it);
   - two commands issued back to back apply in issue order;
   - `canBuild` and `isUnlocked` answer as the instance does, and `cached`
     returns the last answer;
   - `save()` returns what `JSON.stringify(sim.serialize())` gives.

   `src/simport/tsSim.test.ts` runs it over `TsSim`. In the `unitWasm`
   parity project (`npm run test:wasm:parity`) every `Simulation` is hosted
   on the engine through the mirror, so the same file checks `TsSim` on both
   of today's hosts. Slice 7 runs the suite over `RustSim`.
7. **The Simulation reach guard.** `src/tests/simulationReach.guard.test.ts`
   with `src/tests/simulationReach.ratchet.txt`:
   - it reads every non-test file under `src/`, `src/engine/`,
     `src/storage/`, `src/wasmhost/` and `src/dualrun/` included, with the
     same counting rules as #1118's guard (type-only imports do not count; a
     bare import, a re-export, `import()`, `new URL(..., import.meta.url)`
     and `import.meta.glob` do);
   - it finds the engine modules whose static runtime closure reaches
     `src/engine/Simulation.ts` (today `Simulation.ts`, `sim/loop.ts`,
     `sim/serialization.ts`);
   - it pins every edge from a file outside `src/engine/` into that set, and
     every dynamic `import()` edge into it from anywhere outside
     `src/engine/`, one ratchet line per file naming its targets;
   - it starts with today's 9 edges (Dev Notes) and fails on a new edge, a
     stale line and an unreadable dynamic import;
   - its only permanent exceptions are the dual run files in
     `src/build/engineBundle.ts`'s `DUAL_RUN` (imported from there rather
     than copied) and, from the slice that creates it, the adapter module that
     hosts the TypeScript engine; dynamic `import()` into the set is allowed
     only from that adapter;
   - a self-test on a synthetic graph covers: a chain through a non-engine
     helper counts at its crossing edge; a type-only import does not count;
     a dynamic import counts; an engine module that newly imports
     `Simulation` turns its importers' edges into new ratchet lines.

   The import reading shared with `frontendEngineImports.guard.test.ts` moves
   into one helper (`src/tests/importScan.ts`) that both guards use; #1118's
   guard keeps its own sample test green unchanged.
8. **No behavior change.** No production file outside `src/simport/`
   changes; `src/main.ts` is untouched (slice 2 wires `app.port`). No version
   bump (internal only). `npm run typecheck`, `npm run lint`, `npm test` and
   `npm run build` are green, the coverage ratchet holds, every new file is
   under the 500-line ceiling, and `npm run test:wasm:parity` passes the new
   test on the WASM host.
9. **Hot-path record.** The PR carries a proportional HP-1 to HP-12 record:
   `TsSim` is on no runtime path yet (nothing constructs it in production),
   its view hands out live objects with no copy (HP-3), the header read is
   one small object per read, and the guard runs at test time only.
10. **Review.** `/bmad-code-review` (port plumbing), with its Hot-Path
    Auditor layer, and the independent review through the coordinator.
    Every `patch` finding fixed, every `defer` recorded in the backlog with
    its issue. Auto-merge stays off.

## Tasks / Subtasks

- [x] Types (AC 1 to 4)
  - [x] `view.ts`: the interfaces, from the member lists in Dev Notes
  - [x] `commands.ts`: the `Command` union and `CommandResult<C>` via a
        result map keyed by `op` (see Completion Notes)
  - [x] `queries.ts`: `Query`, `QueryResult<Q>`, the cache key
  - [x] `port.ts`: `SimPort`
  - [x] `view.types.test.ts`: assignability of the live types; the
        `ShadowCommand` drift check
- [x] `TsSim` (AC 5)
  - [x] the per-kind dispatch, each through the instance's own method
  - [x] the result conversion, lossless against today's return values
  - [x] the header read and the live tower and crowd
- [x] Contract suite (AC 6)
  - [x] `contract.fixture.ts` with the cases above
  - [x] `tsSim.test.ts`; run it under `npm run test:wasm:parity` too
- [x] Guard (AC 7)
  - [x] extract `importScan.ts` from `frontendEngineImports.guard.test.ts`
  - [x] `simulationReach.guard.test.ts` and its ratchet, seeded with the 9
        edges and a reason on each line
  - [x] the synthetic-graph self-test
- [x] Gates and records (AC 8 to 10)
  - [x] the four gates, coverage, `test:wasm:parity`
  - [x] the HP record on the PR (a section 6 comment) and the complexity
        note in the PR body
  - [x] `/bmad-code-review` (all four layers), fixes, backlog rows for defers
  - [x] a confirming review pass on the fixed diff (round 3)

## Dev Notes

### What exists today, and what this story must not break

- `src/main.ts` holds `sim: Simulation` on `GameApp` and swaps it in
  `adoptSim`. Its friend modules in `src/game/` re-read `app.sim` per call.
  This story does not touch it.
- On the WASM mirror host, `relayCommands` (`src/dualrun/mirror.ts`, from line
  82) wraps the instance's command methods and watches `money`, `view`,
  `autoBridge` and `tower.towerName`, forwarding each to the engine. That is
  why `TsSim` must call the instance's methods and assign the watched fields
  rather than reaching into `src/engine/sim/*` helpers: a helper call would
  skip the relay and the engine would diverge. `priceUnit` takes a `Unit`
  object; `TsSim` resolves the id with `tower.getUnit` and, for an unknown id,
  answers `{ ok: false }` with no reason (no caller can name one today, since
  the editor holds the unit; slice 2 aligns the refusal with the engine's).
- `ShadowCommand` (`src/dualrun/commands.ts`) is the relay's list of ops.
  Import it with `import type`.
- The build-time bundle guard is `checkEngineBundle` in
  `src/build/engineBundle.ts`, run by `scripts/verify-engine-bundle.ts`. Its
  `DUAL_RUN` list is the tooling-only exception this story imports. The
  chunk-level player-bundle check belongs to slice 10.

### Commands (the consumer inventory's 1C table)

`build`, `buildTransport`, `removeFacility`, `beginExtend`,
`extendTransport`, `endExtend`, `addCar`, `removeCar`, `setStop`,
`setExpressStops`, `clearStops`, `setSchedule`, `setLabel`, `adjustRent`,
`setNoRate`, `priceUnit`, `applyRentBatch`, `setFilmPolicy`,
`rerollSubtype`, `callExterminator`, `resolveChoice` (`accept: boolean`,
mapped to `"accept"` or `"decline"`), `toggleAutoBridge`, `setAutoBridge`,
`setTowerName`, `setView`, `emit`. Not included: `sellAt`, `setCars`,
`resizeTransport` and the tower-level resize and car setters (no production
caller), `startFire`, `bombThreat`, `evaluateStar` and `setMoney` (tests and
tooling only).

Today's return values to convert: `{ ok, reason? }` (build), `ChargeResult`
and `ExtendResult` (`src/engine/sim/charges.ts`), `ExterminatorResult`
(`src/engine/sim/services.ts`), `BatchRentResult | null` (rent), `number |
null` (adjustRent, priceUnit), `string | undefined` (rerollSubtype), the film
policy or `null`, and booleans.

### View members (buckets 2S and 2F)

- `TowerView`: `units`, `transports`, `revision`, `mealOverlayRevision`,
  `towerName`, `getUnit`, `getTransport`, `unitAt`, `hasStructure`,
  `structureKindAt`, `highestFloor`, `lowestFloor`.
- `UnitView`: `id`, `kind`, `floor`, `x`, `width`, `state`, `subtype`,
  `label`, `occupants`, `outForMeal`, `customersIn`, `hotelCustomersIn`.
- `TransportView`: `id`, `kind`, `x`, `width`, `bottom`, `top`, `cars`,
  `skipFloors`, `carPositions`, `carLoad`, `carDir`.
- `CrowdView`: `people` (`id`, `staff`, `seed`, `state`, `x`, `fy`, `wait`).
- `HeaderView`: `money`, `star`, `population`, `weather`, `logSeq`,
  `pendingChoice`, the clock (`minutes`, `minuteOfDay`), `revision`,
  `mealOverlayRevision`. The unlocked kinds and the metadata revision arrive
  with slices 3 and 6a.

Check each name against the live types before writing it; the type test is
the arbiter. Slice 3 may add members, never remove them silently.

### The guard's starting ratchet (main at c94df14)

`src/game/appHistory.ts`, `src/game/facilityDiagnostics.ts` (constants only;
slice 4 moves them), `src/game/saveLoad.ts`, `src/main.ts`,
`src/storage/SaveGame.ts`, `src/wasmhost/hostFault.ts`,
`src/wasmhost/wasmHost.ts`, `src/wasmhost/workerApply.ts`,
`src/wasmhost/workerHost.ts`, each into `Simulation.ts`. Recompute before
seeding; a different count means the tree moved, and the PR says so.

### Constraints

- American English, no em-dashes, plain prose in comments, no "X, not Y".
- 500-line ceiling per file (`src/tests/fileSize.guard.test.ts`).
- Tests sit beside their code (`src/simport/*.test.ts`); type tests use
  Vitest's `expectTypeOf`.
- Engine types through `import type` only.

### What it removes (temporary TypeScript)

Nothing yet. It adds `TsSim`, which stays as the TypeScript arm's adapter and
the fallback's until the TypeScript engine retires. The guard's 9 edges are
the temporary TypeScript dependencies the later slices remove; by slice 10
only the permanent exceptions and the mirror hosts awaiting slices 11 and 12
remain.

### Project Structure Notes

- New: `src/simport/` (this lane's folder in the slice plan's file table),
  `src/tests/simulationReach.guard.test.ts`, its ratchet,
  `src/tests/importScan.ts`.
- Changed: `src/tests/frontendEngineImports.guard.test.ts` (uses the shared
  helper, so it now also reads Vite's query imports, root-absolute
  specifiers and URLs written without `./` the way Vite loads them, and
  fails a non-literal URL or glob; its ratchet is unchanged).
- `src/simport/` is scanned by #1118's guard as frontend code, which is
  intended.

### References

- [Source: architecture-rust-facade-2026-10-20/ARCHITECTURE-REVIEW.md#5.1 The port], #5.2, #5.3, #7 Tests
- [Source: architecture-rust-facade-2026-10-20/slice-plan.md, slice 1 row, "Who touches which files", "Stories"]
- [Source: architecture-rust-facade-2026-10-20/consumer-inventory.md, buckets 1C, 1Q, 2S, 2F]
- [Source: architecture-rust-wasm-cutover-2026-10-13/ARCHITECTURE-SPINE.md, AD-9]
- [Source: src/tests/frontendEngineImports.guard.test.ts] (#1118's counting rules)
- [Source: src/dualrun/mirror.ts#relayCommands], [Source: src/dualrun/commands.ts#ShadowCommand]
- [Source: src/build/engineBundle.ts#DUAL_RUN]
- [Source: docs/performance/hot-path-review.md] (HP-1 to HP-12, the record table)
- [Source: _bmad-output/project-context.md]

## Dev Agent Record

### Agent Model Used

Claude Code (the facade lane's thread), 2026-10-20.

### Debug Log References

- `npm run wasm:build` before the parity run (exit 0).
- The parity run caught the spy test recording `callExterminator` twice: the
  `unitWasm` setup attaches the host inside the first `callExterminator` and
  re-dispatches it, which went through the test's spy a second time. The
  test now ticks once before the spies go on; `TsSim` calls each method once.
- `npm run typecheck` caught `Array.prototype.at` in a test (the lib target
  predates it).

### Completion Notes List

- Deviations from the story, each deliberate:
  - The command and query unions are discriminated on `op`, as
    `ShadowCommand` is, since `kind` is already a field name in today's calls
    (`sim.build(kind, floor, x)`) and would collide.
  - The contract suite is `src/simport/contract.fixture.ts`, so the shipped
    code scan and the coverage ratchet treat it as test code.
  - `src/build/engineBundle.ts` exports `DUAL_RUN` (an `export` and a
    `readonly string[]` annotation, no behavior change) so the reach guard
    imports the build guard's own list.
  - A file whose `import()` loads the engine package's glue by URL
    (`src/wasmhost/engineLoad.ts`) is named in the reach guard as a package
    loader rather than failing as unreadable; the guard checks it still is.
- Changes from the review (`/bmad-code-review`, four layers), each recorded
  here because it refines an AC:
  - `delta` is on every command result, measured as the balance's change
    around the command, so a build's excavation find, a booked exterminator
    and a paid emergency all report it; AC 3's `delta?` is now required.
  - Refusals the engine makes silently are reported: `resolveChoice` with no
    emergency waiting, `toggleAutoBridge` when the value did not change, and
    `setAutoBridge` turning bridging off in a Classic tower (which always
    bridges) all answer `ok: false`. `endExtend` always succeeds, documented.
  - `cached` keeps one map per query: placement answers in a 256-entry
    least-recently-used map (a `cached` read counts as use) and unlock
    answers without a cap, kept per tower in a `WeakMap`, so another tower
    from `getSim()` starts with none and a replaced tower is not kept alive.
  - `save()` waits for a host that steps in the background (the step gate's
    `settle`, as `saveLoad.ts`'s autosave does) and saves the tower held once
    it has caught up, which may then hold steps and commands issued after the
    call; without a gate it saves at once, so issue order holds.
  - `drainEvents({ release: true })` forwards the WASM host's release flag,
    which the analytics flush on page close needs.
  - The header's `population` is computed on its first read and kept for
    that header object, so reading another field walks no rooms.
  - The contract ticks before and after each case so the parity host sees
    every command, and on the parity project fails a case in which the setup
    restarted the engine (`parityRestarts`, a counter `wasmHostSetup.ts` now
    publishes), since before a tower has people the setup restarts the
    engine on a divergence instead of failing. It also asserts `delta`
    against the balance for each command in the session and a revision move
    for `addCar`, `extendTransport` and `removeCar`, pins command, query and
    save order without awaits between them (the save holds both offices),
    and checks the drained `facility_placed` events and their order (floors
    2 then 3).
  - The reach guard counts glob, URL, root-absolute and Vite-query imports
    the way Vite loads them (a `?worker&url` import counts; a glob's `!`
    patterns apply to its own call; a pattern with no base is unreadable),
    fails a static edge into an engine module that loads `Simulation`
    lazily, keeps a dual-run file in the reach set only when it reaches
    `Simulation` through engine modules, and holds each file that loads the
    engine package's glue by URL (`engineLoad.ts`, the dual-run worker) to
    one unreadable import; any other unreadable import fails, the dual run's
    included.
- The reach set on `main` at this branch's base is `Simulation.ts`,
  `sim/loop.ts` and `sim/serialization.ts`, and the crossings are the 9
  files the Dev Notes list, each into `Simulation`, each with a reason and
  the slice that removes it.
- `Simulation.population` is a scan over the rooms
  (`routing.totalPopulation`). The header reads it only when its
  `population` is read, once per header object; slice 3 reads `view.header`
  once per frame and keeps it, and the PR's hot-path record says so.

### File List

- `src/simport/port.ts` (new)
- `src/simport/view.ts` (new)
- `src/simport/commands.ts` (new)
- `src/simport/queries.ts` (new)
- `src/simport/tsSim.ts` (new)
- `src/simport/contract.fixture.ts` (new)
- `src/simport/tsSim.test.ts` (new)
- `src/simport/view.types.test.ts` (new)
- `src/tests/importScan.ts` (new)
- `src/tests/simulationReach.guard.test.ts` (new)
- `src/tests/simulationReach.ratchet.txt` (new)
- `src/tests/frontendEngineImports.guard.test.ts` (reads imports through `importScan.ts`)
- `src/tests/parity/typescriptOnly.ts`, `src/tests/parity/wasmHostSetup.ts` (publish the re-host counter as `parityRestarts`)
- `src/build/engineBundle.ts` (exports `DUAL_RUN`)
