# Story facade.3: The renderer and HUD read the view (3a types, 3b frame data)

Status: in progress (3a-1 merged as #1291; 3a-2a is the RenderSim PR; clockView, view.fx and view.camera next; 3b waits for gates)

Slice 3 of the Rust-backed facade
(`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/slice-plan.md`),
under spine AD-9. Issue #1210, under the facade tracker #1207. Fixes #1234 when
its PR lands (the per-frame `population` read in `towerCrowd.ts`). Relates to
#868 and #954 by reference only: no closing keyword on either.

Owner: the Rendering lane (`src/render/**`). The view side
(`src/simport/view.ts`, `tsSim.ts`) is the facade thread's; this story names the
members it needs and the facade thread decides their shape.

## Story

As the developer moving the web game onto Rust authority,
I want the renderer and the HUD to read the facade's read-only view instead of
the TypeScript `Simulation`,
so that a Rust-backed adapter can feed them from the engine's structural
snapshot and frame with no TypeScript instance behind it, while today's
TypeScript arm keeps drawing exactly what it draws now.

## What is gated, and by what

| Part | Gate | Why |
| --- | --- | --- |
| 3a-1: the structure consumers take `UnitView`, `TransportView`, `PersonView` | slice 1 (#1245, branch `claude/facade-slice-1-port`) | types only; the view interfaces must exist |
| 3a-2: the renderer's sim handle becomes a narrow read interface, and every `engine.sim.*` read maps to a view member | slice 1, plus the view additions in the table below | behavior-preserving on `TsSim` |
| 3b: the per-frame computations (`congestion`, `queueView`, `floorHeatmap`, `peakCongestion`) read view slices | 3a-2, and the slice owner for overlays (6b's overlay slices on the Rust side) | the TypeScript arm answers from the live instance |
| Binding the room and structure loops to the view | spike 0's go (#1196) and #1253's room list and structure runs | `TowerView.units` includes every structure tile (about 40,000 of the large tower's 43,358 units); no per-frame or per-step walk over it is added |
| `main.ts` and `frameLoop.ts` edits (the engine handle, the port) | slices 2 and 4 and 5 merge first (merge order 2, 4, 5, 3b last) | shared files, per `parallel-map.md` |

If spike 0 misses its pre-registered thresholds, the facade pauses before the
gated rows and the owner decides. Everything above the gate stays valid either
way, because it changes types and narrows reads while what is drawn stays the same.

## Acceptance criteria

1. **3a-1, structure consumers read the view types.** Every non-test file under
   `src/render/**` that took a `Unit`, `Transport` or `Person` from
   `src/engine/` for a field read takes `UnitView`, `TransportView` or
   `PersonView` from `src/simport/view` instead. The compiler is the proof:
   a painter that read a field the view lacks fails `tsc`. Synthetic units and
   transports the atlas and the scene bake (`unitOf`, `structUnit`,
   `fakeStruct`, `struct`, `shaftOf`) no longer carry fields no consumer reads
   (`satisfaction`, `everOccupied`, `pendingIncome`, `load`). Pixels do not
   change: the render tests, the atlas verify and the visual baselines pass
   unchanged.
2. **3a-2, one narrow handle.** `TowerEngine.sim` is typed as a read interface
   (`RenderSim`, in `src/render/`) that extends what `SimView` offers with the
   members in the mapping table; `bindSceneWorld`, `setSim` and the scene
   modules take it. No render module imports `Simulation` as a value or a type
   after this step. `TsSim` (or a thin render-side adapter over the live
   instance) implements it, so `main.ts` passes the same instance it does today.
3. **Header cadence.** `population` is read at most once per step or HUD tick,
   never per frame: the renderer takes it from the step's header (or a value the
   adapter memoizes per step). `towerCrowd.ts`'s per-frame `sim.population`
   becomes that read, which fixes #1234. A test pins the number of
   `population` reads per rendered frame on `TsSim` at zero after the first
   frame of a step.
4. **3b, computations behind view slices.** `congestion()`, `queueView`,
   `floorHeatmap(mode)` and `peakCongestion()` are read through view slice
   members, cached per revision, hour or step as they are today
   (`towerOverlay.ts` already keys the heatmap on revision, hour and mode). On
   `TsSim` each slice calls the live instance's function, so results are equal
   by construction; a differential test over the conformance corpus pins that
   the slice answers equal the direct calls.
5. **No new per-frame or per-step walk over the structure.** The room and
   structure loops that walk `tower.units` today (`towerCrowd.ts` seven
   places, `towerWalkerBuild.ts`, `towerInputCamera.ts`, `towerScenery.ts`,
   `towerReconcile.ts`) keep their current cost on `TsSim` and bind to the
   room list and structure runs once #1253 provides them. This story adds no
   scan; the hot-path record lists the remaining ones with their tiers.
6. **Visual regression stays green.** The `chromium` and `chromium-wasm`
   projects, the visual baselines and the screenshot drift gate pass on every
   slice 3 PR. Baselines are minted only by the pinned image.
7. **Reach ratchet.** `src/tests/simulationReach.ratchet.txt` is not touched by
   3a. If 3a-2 removes a `Simulation` import edge, the line goes.

## The `engine.sim` reads in `src/render/**` and where each goes

Counted by a grep for `sim.` on the engine handle, test files excluded.

| Read | Where | Source in the view | Status |
| --- | --- | --- | --- |
| `tower.units`, `transports`, `getUnit`, `getTransport`, `unitAt`, `highestFloor`, `lowestFloor`, `revision`, `mealOverlayRevision` | `towerReconcile`, `towerCrowd`, `towerInputCamera`, `towerRegions`, `towerWalkerBuild`, `towerScenery`, `towerSyncSchedule`, `towerOverlay` | `view.tower` | exists |
| `crowd.people` | `towerCrowd`, `towerInputCamera` | `view.crowd` | exists |
| `weather` | `towerScene`, `towerOverlay`, `towerInputCamera` | `header.weather` | exists |
| `clock.minuteOfDay`, `hour`, `minute`, `isNight()`, `isEvening()`, `isMorning()` | `towerCrowd`, `TowerEngine`, `towerScene`, `towerOverlay`, `towerSyncSchedule`, `towerScenery`, `towerInputCamera` | `header.minuteOfDay`, `header.minutes`; hour, minute, night and evening are pure functions of it | derive in `src/render/clockView.ts`, pinned against `Clock` by a test |
| `population` | `towerCrowd` | `header.population` | exists, at most once per step |
| `santaFxSeq`, `vipFxSeq`, `explosionFx{seq,x,floor}`, `thiefFx{seq,caught,floor}`, `treasureFx{seq,x,floor}` | `towerOverlay`, `towerScene` | none | **needs a view member** (`view.fx`) |
| `rng.initialSeed` | `towerScenery` | none | **needs** `view.sceneSeed` (a number that does not change for a tower) |
| `towerCatalog(sim)` (mode catalog) | `towerRegions`, `towerInputCamera`, `towerCrowd`, `towerOverlay`, `towerReconcile`, `towerWalkerBuild`, `towerScene` (`bindSceneWorld`) | none | **needs** `view.catalog` (the tower's catalog) |
| `functionalParkingSet()` (a `Tower` method), `parkingUsage(n)`, `recyclingFill()` | `towerReconcile` (hourly) | none | **needs** a facility-usage slice, hourly (the set belongs on `view.tower` or the slice, not the sim handle) |
| `tower.transports` | `towerShaftNumbers` | `view.tower.transports` | exists |
| `positionReachable(floor, tileX)` | `towerCrowd` (a spawn probe, memoized per revision) | none | **needs** a reachability query, or the walker probe moves onto the frame |
| `congestion()`, `crowd.queueView(tower)` | `TowerEngine` (per frame) | none | 3b slice members |
| `floorHeatmap(mode)`, `peakCongestion()` | `towerOverlay` (only while an overlay is on) | none | 3b slice members |
| `view` (the camera) | `TowerEngine`, `towerScene` (read when a tower is adopted) | none | **needs** a camera preference on the view; writes are slice 2's `setView` command |

The "needs" rows go to the facade thread as a proposal (`view.fx`,
`view.sceneSeed`, `view.catalog`, a usage slice, slices for the four
computations, a camera member). `src/simport/view.ts` is theirs, so I do not
edit it; I send the exact member list and keep the render side behind
`RenderSim` until they land it.

## Tasks

- 3a-1: change the imports and annotations (35 files), remove the unread
  fabricated fields, run `tsc`, the render tests and the atlas verify. Done; PR
  #1291.
- 3a-2: write `RenderSim`, `clockView.ts` with its `Clock` parity test, move
  `bindSceneWorld`, `setSim` and the scene modules onto it, have the adapter
  implement it. Needs the facade thread's view members; until then `RenderSim`
  declares them and the TypeScript adapter fills them from the live instance.
- Header cadence: memoize or step-key the `population` read, fix #1234, add the
  read-count test.
- 3b: the four slices, with the differential test against the direct calls on
  the conformance corpus.
- Loop binding (gated): once #1253 and spike 0's go are in, move the loops
  listed in AC 5 to the room list and structure runs, with the HP record and
  the visual baselines.

## Tests

- 3a-1: `tsc` is the test. Plus the existing render unit and integration tests,
  the atlas verify (`src/render/atlas/verify*.ts`) and the visual baselines.
- 3a-2: a parity test for `clockView.ts` against `Clock` for all 1440 minutes
  and a negative minute; a test that `RenderSim` as implemented by `TsSim`
  answers each member as the live instance does; an import guard so no module
  under `src/render/` names `Simulation`.
- Header cadence: `population` is read once per step and zero times between
  steps on `TsSim` (a counting wrapper around the header).
- 3b: slice answers equal the direct calls on the conformance corpus; the
  heatmap stays keyed on revision, hour and mode (the existing overlay tests).
- Every test that exercises the real engine runs on the real WASM package
  under `npm run test:wasm:parity` as well; no hidden TypeScript or Rust
  difference is excused.
- E2E: the `chromium` and `chromium-wasm` projects, unchanged.

## Risks and how they are caught

| Risk | Catch |
| --- | --- |
| A painter reads a field the view lacks and the type change hides it behind `any` or a cast | `tsc` fails on a missing member; grep the 35 files for `as Unit`, `as any` and bracket access; none are added |
| An atlas bake or a scene fixture depended on a field the literal set (`satisfaction`, `everOccupied`, `pendingIncome`, `load`) | those fields are not on the view, so no consumer can read them; the atlas verify and the visual baselines compare pixels before and after |
| The view hands out the live objects, so a renderer could still mutate them | the view types are `readonly`; the type test from slice 1 pins assignability; no render file writes a field (a grep for assignments to `u.`, `t.` fields) |
| `population` walks every room (about 330 µs on the large tower, cloud estimate) and a per-frame header read multiplies it | AC 3 and its test; the header object stays one per step |
| `TowerView.units` includes about 40,000 structure tiles on the large tower, and a per-frame loop over it costs | AC 5; the loops wait for #1253's room list and runs, and no new loop is added |
| Spike 0 misses its thresholds | The gated rows pause; the owner decides; 3a-1 and 3a-2 still stand |
| Shared files (`main.ts`, `frameLoop.ts`) collide with slices 2, 4 and 5 | this story edits neither; the engine handle change that touches `main.ts` merges last |
| A visual regression from a changed draw order or a lost field | the baselines and the drift gate on every PR; a failing drift goes to the pinned-image job, never a host browser |

## Hot-path record plan (HP-1 to HP-12, proportional)

3a-1 is types only, no code path changes (HP clear by inspection, listed once
with the compiler as evidence). 3a-2 and the header cadence touch the per-frame
renderer read, so they get a full record: the tiers (per frame: `towerCrowd`
people loop, `TowerEngine.tick`; per step: `syncMotion`; per hour:
`towerReconcile`; per revision: `syncScene`), sizes on the large tower
(U 43,358, R 2,900, people P), the remaining scans each with its frequency,
and the TypeScript caches compared (`roomUnits`, `byId`, `structure`, the
heatmap's revision key). 3b adds the slice cache keys and invalidation tests.
`/gds-code-review` with its Hot-Path Auditor runs on each PR that changes a
code path; the independent review comes through the coordinator
("Facade and Rust perf reviews").

## What it removes (temporary TypeScript)

- `Simulation` as the renderer's handle type (`TowerEngine.sim`,
  `bindSceneWorld`, `setSim`, `towerScenery`), replaced by `RenderSim`.
- The per-frame `sim.congestion()` and `crowd.queueView(tower)` calls on the
  mirror, replaced by view slices (3b).
- The renderer's direct `floorHeatmap` and `peakCongestion` calls (3b).
- Nothing in `src/wasmhost/` or `src/dualrun/`: those are slices 5, 7 and 11.

## Version

None. No player-visible change.

## Facade lane decisions (2026-10-21)

| Proposal | Decision |
| --- | --- |
| `view.fx` | Yes, in 3a. Fields also go in the dynamic frame (ask 6a). |
| `sceneSeed` | Yes, a founding constant on `HeaderView` beside slice 4's `mode` and `modernCalendar`. Agree the `readHeader` merge order with Facade panels. 6a puts it in the snapshot header. |
| catalog | No view member. Use the catalog handle plus `header.mode`. `towerCatalog` reads only `tower.mode`; its per-tower cache is a `WeakMap` keyed by the tower object. |
| usage | Yes, `view.usage`, valid per sim hour and keyed by it. Rust getter from 6b or 6c (ask both). |
| reachability | Yes, a per-revision view (for example the unreachable room ids). Rust side is 6c's facts. |
| 3b slices | Yes, each with a differential test and a hot-path row showing O(visible) per frame or a per-step cache. |
| camera | Yes, `view.camera { tile, floor, zoom }`, read only; `setView` is the command. |

Slice 3 adds the `view.ts` lines, the `TsSim` fills and assertions in its own fixture. `contract.fixture.ts` stays with the facade lane.

## Review notes (3a-1)

- `TowerEngine.ts` sits at the 500-line ceiling (one blank line was dropped
  to stay under it). 3a-2 retypes `sim` there and splits the file first.
- The deep review (blind, edge case, acceptance, hot-path layers) found one
  missed file (`towerReconcile.ts`), a mangled section banner in
  `sprites/transport.ts`, a stale doc comment and the mapping-table gaps
  above. All are fixed in this PR.

## 3a-2a notes (RenderSim)

- `src/render/renderSim.ts` lists every read the renderer makes of the
  simulation, grouped by call frequency. `TowerEngine.sim`, `setSim`,
  `bindSceneWorld` and the scenery record are typed by it; the live
  `Simulation` satisfies it (`renderSim.types.test.ts`), so `main.ts` is
  unchanged. `renderSim.guard.test.ts` keeps `Simulation` out of every
  production source under `src/render`.
- Typing the sim as `RenderSim` made the compiler report one read the views
  lacked: `towerInputCamera` filters people by their discrete `floor`.
  `PersonView` gains `floor` (the live `Person` already has it). The Rust
  frame must carry the discrete floor beside `fy`; this goes to the facade
  lane for the 6a frame.
- `TowerEngine.ts` was at the 500-line ceiling, so the frame prelude
  (decorative clock, event visuals, lighting, sky) moved to `towerFrame.ts`
  with the same step order.
- The `RenderSim` members for effects, usage, reachability and the frame
  slices are the live engine's own today. Each moves behind a view member as
  the facade lane adds it.
