# Reviewer Gate: adversarial lens

- **Spine:** `ARCHITECTURE-SPINE.md` (Rust/WASM web cutover, 2026-10-13)
- **Lens:** construct two units one level down that each obey every AD to the
  letter yet build incompatibly.
- **Grounding read:** `engine-rs/src/wasm.rs` (export list, lines 158-930),
  `src/wasmhost/wasmHost.ts`, `src/wasmhost/merge.ts`,
  `src/wasmhost/startWasmHost.ts`, `src/dualrun/mirror.ts`,
  `src/game/frameLoop.ts`, `src/engine/sim/fixedStep.ts`.

## Verdict

**Revise before build.** The paradigm and order are sound, but AD-1, AD-2,
AD-3 and AD-5 each leave a seam where two compliant units can disagree about
who owns an entity or what shape crosses the port. Seven holes; two critical,
three high, two medium. Each comes with the minimal tightening.

## Holes

### H1 (critical): AD-3's tier table is partial and names ops that do not exist

**Evidence.** `wasm.rs` exports about 45 instance methods. AD-3 tiers 13 of
them. Untiered: `sellAt`, `adjustRent`, `setNoRate`, `priceUnit`,
`applyRentBatch`, `setSchedule`, `setStop`, `setExpressStops`, `clearStops`,
`setLabel`, `setTowerName`, `setView`, `setAutoBridge`, `toggleAutoBridge`,
`setFilmPolicy`, `rerollSubtype`, `emit`, `startFire`, `bombThreat`,
`evaluateStar`, `callExterminator`, `resolveChoice`, `tick`, `advanceClock`,
`seedLoopMemos`, `seedElevatorTelemetry`. AD-3 lists `towerSetCars` and
`towerResizeTransport`, but the binding exports `setCars` and
`resizeTransport`; `setMoney`, `removeUnit` and `removeTransport` also lack
the `tower*` prefix the Consistency Conventions reserve for tier 3.

**Incompatible pair.**
- Unit A (binding hardening, #923) follows the convention and renames tier 3
  to `towerSetCars`, `towerSetMoney`, `towerRemoveUnit`, and treats
  `startFire`/`bombThreat`/`emit`/`advanceClock` as tier 1 because nothing
  says otherwise.
- Unit B (the source guard test) follows AD-3's literal list, guards
  `setCars` and `resizeTransport` by their current names, and lets
  `src/ui` call `startFire` (a debug cheat) as a "player command".
- Result: the guard passes on a binding it no longer matches, and debug or
  seeding ops ship as player commands.

**Fix (tighten AD-3).** Replace the prose list with an exhaustive table of
every `#[wasm_bindgen]` export and its tier (1 player, 2 restore, 3
relay/test, R read-model), decide the rename once (either all tier 3 gets
`tower*` or the convention row is dropped), and add a test that parses
`wasm.rs` exports and fails on any export missing from the table. Debug
events (`startFire`, `bombThreat`, `evaluateStar`, `emit`) and seeding ops
(`advanceClock`, `seed*`) are tier 3.

### H2 (critical): tier 3 is reachable from `src/ui` through the instance

**Evidence.** `mirror.ts` turns writes to `sim.money`, `sim.view`,
`sim.autoBridge` and `tower.towerName` into `setMoney`/`setView`/... commands,
and wraps `tower.setCars`, `tower.resizeTransport`, `tower.removeUnit`,
`tower.removeTransport` as relayed ops. `wasmHost.ts` feeds that relay
straight into `shadow.apply`.

**Incompatible pair.**
- Unit A (a UI feature) obeys "nothing in `src/ui` calls the binding
  directly" and "only tier 1": it calls `sim.tower.resizeTransport(...)` or
  writes `sim.money -= cost` on the TypeScript instance, which it holds.
- Unit B (the host) obeys AD-3 and only relays what the instance did.
- Result: the engine receives tier-3 `resizeTransport` (no charge, no
  refusal rules) and `setMoney`, exactly what AD-3 is meant to prevent, and
  no binding-level guard sees it.

**Fix (tighten AD-3).** State that the tiers apply to the instance surface
as well as the binding: `src/ui`, `src/game` and `src/render` may not call
the TypeScript methods that relay to tier 3 or write the watched fields.
The source guard covers both surfaces, and while hosted the relay throws on
a tier-3 op that does not originate in `src/dualrun/` or a test.

### H3 (high): AD-1 leaves the result shape and the refusal path open

**Evidence.** Tier-1 returns today are mixed: `build` and `addCar` return
JSON strings, `sellAt`/`setNoRate`/`setStop` return `bool`, `adjustRent` and
`priceUnit` return `Option<f64>`, `setFilmPolicy` returns `Option<String>`.
The Consistency Conventions demand `{ ok, reason?, delta? }`; AD-1 also says
"and the shape the UI reads", which is the TypeScript return shape. The
host's log de-duplication (`slice(ownSinceSync)` in `syncFrame`) and the
event de-duplication assume the instance ran the same command and logged the
same lines as the engine.

**Incompatible pair.**
- Unit A (host, AD-1) calls the engine first and, on `ok: false`, still lets
  the instance run (AD-1 only says the instance "mirrors") so the UI keeps
  getting the TypeScript return shape.
- Unit B (binding, conventions) moves `sellAt` to the JSON envelope.
- Result: the UI receives an object where it tested a boolean (always
  truthy), and on a refusal the instance logs a line the engine did not, so
  `slice(ownSinceSync)` drops a real engine line. AD-1's "never resolved in
  the instance's favor" is satisfied and the log is still wrong.

**Fix (tighten AD-1 and the conventions).** (a) Every tier-1 export returns
the envelope, with a per-command typed `delta`; (b) the host owns one
adapter table mapping envelope to the TypeScript return the UI reads, and
nothing else converts; (c) on `ok: false` the instance does not run the
command; (d) while hosted, the log and gameplay events come only from the
engine (instance logging suppressed), so de-duplication keys on engine
sequence numbers instead of counting the instance's own lines.

### H4 (high): two save writers on every restore

**Evidence.** Undo, load and new game go through `app.adoptSim` with a
TypeScript `Simulation` built by `Simulation.deserialize`. `startWasmHost`
re-attaches, and `attachWasmHost` calls `loadCommand(sim, 0)`, which sends
`JSON.stringify(sim.serialize())` from the fresh, not-yet-hosted instance
(TypeScript's writer) plus `lastHour/lastDay/lastQuarter/lastMonth` markers
read from the instance.

**Incompatible pair.**
- Unit A (storage, AD-5) writes every save with the engine encoder and
  proves byte-exactness (#949).
- Unit B (host, AD-3 tier 2 "restores go through a full save") restores by
  handing the engine the TypeScript re-serialization of that save.
- Result: the engine boots from bytes the TypeScript writer produced, so a
  field TypeScript drops, rounds or migrates differently is lost on every
  undo and load; both units obey AD-5 and AD-3.

**Fix (tighten AD-5 and AD-3 tier 2).** A restore hands the engine the
original engine-written bytes (`fromSave`/`fromVctower`), and the TypeScript
read model is built from `engine.serialize()`, never the reverse. Boundary
markers come from the save or the engine, not the instance.

### H5 (high): AD-2 splits the step driver between crate and host

**Evidence.** AD-2 moves "quantum, day pace curve, steps per frame, debt and
its reset" into the crate. `frameLoop.ts` also owns `accMinutes`,
`MAX_CATCHUP_MINUTES` (30), the non-finite guard, pause handling and
`paceFactor` (applied in `advanceOwedMinutes` before `drainFixedSteps`).
`fixedStep.ts` documents that bounding the debt "is the host's catch-up
cap".

**Incompatible pair.**
- Unit A (crate driver) takes real elapsed time and applies the day pace
  curve and its own debt.
- Unit B (frame loop) keeps its catch-up cap and its pace factor, since AD-2
  does not list them, and passes paced, capped minutes.
- Result: pace applied twice and the cap applied to the wrong quantity; two
  hosts cut time differently, which AD-2 exists to prevent.
  Also unstated: whether the debt lives in `Simulation` (and so could enter
  the save or hash) or on the handle, and whether a tier-2 restore resets it.

**Fix (tighten AD-2).** Enumerate the driver's whole surface: catch-up cap,
pace factor, non-finite guard, pause clearing, mode-change reset, all in the
crate. The host passes raw real milliseconds, speed, steady flag and paused,
and keeps no `accMinutes`. Debt lives on the engine handle, never in the save
or the hash, and resets on every tier-2 restore.

### H6 (medium): the full-merge read model is unversioned and dies at retirement

**Evidence.** AD-4 versions the frame view only. The other read-model path,
`merge()` in `wasmHost.ts`, runs `Simulation.deserialize(engine.serialize())`
and `mergeSimulation` with a hand-kept `KEEP` set, so its schema is the
TypeScript class layout. `src/ui` and `src/render` hold `sim.tower.units`
and other `src/engine` objects.

**Incompatible pair.**
- Unit A (retirement, row 7) deletes `src/engine`, as the scope says.
- Unit B (any UI story before it) keeps importing `src/engine` types and
  reading the merged instance, as AD-4 allows (it only forbids recomputing
  decisions).
- Result: retirement cannot land without rewriting the UI's data access, and
  an engine save field added under the lock silently fails to reach the UI
  because `mergeSimulation` copies only keys the TypeScript class has.

**Fix (tighten AD-4).** Name the UI's read-model module (for example
`src/wasmhost/readModel`) as the only type surface `src/ui`/`src/render` may
import for engine state, and put the merge payload under the same version
rule as the frame (the save version plus a merge-shape version checked by
the host).

### H7 (medium): two owners of reference data until retirement

**Evidence.** The project `CLAUDE.md` names `src/engine/facilities.ts`
(`BUILD_CAPS`, `POOLED_CAPS`, `MAX_CARS`, `maxSpanFor`) as the single source
of truth; AD-4 says every engine-decided value the UI shows comes from the
engine catalog.

**Incompatible pair.**
- Unit A (build palette) reads caps and prices from `facilities.ts`, per
  `CLAUDE.md`.
- Unit B (catalog consumer, `src/dualrun/catalog.ts`) reads them from the
  engine catalog, per AD-4.
- Result: two owners; they agree only while the lock holds, and a
  TypeScript-only edit (allowed before the flip on the TypeScript default)
  shows one price in the palette and charges another.

**Fix (tighten AD-4).** State that `src/ui` reads reference data only from
the catalog once hosted, that `facilities.ts` is the TypeScript reference's
copy checked against the catalog digest by the lock, and amend the
`CLAUDE.md` canon line in the same change so the two documents agree.

## Not holes (checked)

- AD-6 event single-drain: the relay refuses a second attach, and the host
  override drains once; the double-count case reduces to H3(d).
- AD-7 rollout order: no compliant pair found that stacks the worker and the
  flip.
