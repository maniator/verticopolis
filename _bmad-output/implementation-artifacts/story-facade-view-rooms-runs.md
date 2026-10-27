# Story facade.view-rooms-runs: a room list and structure runs on the port's view

Status: review

Issue #1253, under the facade tracker #1207 (spine AD-9). It comes from the
independent review of slice 1 (PR #1245, shape recommendation R1) and lands
before slices 3 (#1210) and 4 (#1211) bind any room-only or structure reader.
Related: #1213 (6a, the Rust structural snapshot), #1217 (`RustSim`), #1237
(walk-every-unit reads), #1158 (the hot-path review), and spike 0's forward
requirement 1 (a units array of about 40,000 tile objects rebuilt per
revision is the case to avoid).

## Story

As the developer moving the renderer and the panels onto the port,
I want the view to offer the tower's rooms as their own list and the floor
and lobby tiles as runs,
so that a room-only reader never walks the 40,000 structure tiles, the
renderer can draw the structure from about a hundred runs, and a Rust adapter
never has to expand 6a's runs into one object per tile to serve them.

## Acceptance Criteria

1. **A room list.** `SimView.rooms` is every unit but the floor and lobby
   tiles, in `tower.units` order, typed `ReadonlyArray<UnitView>`. The same
   array comes back until `tower.revision` moves or the tower is replaced,
   and an adapter builds it at most once per revision. Its entries read as
   current as `tower.getUnit` gives them (a label or state change shows
   without a revision move). `TsSim` serves it from `roomUnits`
   (`src/engine/tower/rooms.ts`), the engine's own memoized list.
2. **Structure runs.** `SimView.structure` is the floor and lobby tiles as
   `StructureRunView` runs (`kind`, `floor`, `x`, `width`, `count`; tile i at
   `x + i * width`), ordered by floor and then x, each tile in exactly one run
   and each run maximal: a run ends at a gap, a change of kind or a change of
   width, and at nothing else. The fields are those of a run in 6a's
   structural snapshot (#1213), which carries no ids; 6a may split a run this
   joins, so a Rust adapter joins them. The view gives no tile ids. Kept and
   rebuilt like `rooms`. `TsSim` serves it from a new engine helper,
   `structureRuns` beside `roomUnits` in `rooms.ts`, memoized the same way.
3. **The contract.** A contract case runs on `TsSim` on both of today's hosts
   (the `unit` and `unitWasm` projects): it checks `rooms` against the units
   and `structure` against a `structureKindAt` scan of every cell, so neither
   depends on `units` listing the tiles; checks order and maximality; checks
   both arrays are kept while the revision holds (a tick and a label change)
   and that a kept entry shows the new label; checks `structure` follows a
   build that joins two runs and one tile that joins the runs on both its
   sides; and checks `rooms` follows a sale that drops a room.
4. **The types.** `view.types.test.ts` proves the engine's `StructureRun`
   equals `StructureRunView` and that `roomUnits` and `structureRuns` return
   what `SimView.rooms` and `SimView.structure` declare, and pins both
   members as read-only arrays.
5. **`RustSim`.** The matching cases are forwarded to #1217: `RustSim` runs
   the same contract, serves `rooms` from 6a's snapshot and `structure` from
   6a's runs (joined where 6a splits them), builds neither per read, keeps a
   kept `rooms` array's entries current from the frame and the metadata
   reads, and re-reads both on every new engine whatever the revision.
6. **Review.** A hot-path record on the PR; `/bmad-code-review` and
   `/gds-code-review` (the structure accessor).

## Tasks / Subtasks

- [x] `src/engine/tower/rooms.ts`: `structureRuns`, the run builder and its per-tower memo (AC 2)
- [x] `src/engine/tower/structureRuns.test.ts`: order, breaks, coverage on a real tower, the memo and its invalidation (AC 2)
- [x] `src/simport/view.ts`: `SimView.rooms`, `SimView.structure`, `StructureRunView`; `TowerView.units` points readers at them (AC 1, 2)
- [x] `src/simport/tsSim.ts`: the two getters (AC 1, 2)
- [x] `src/tests/frontendEngineImports.ratchet.txt`: one line for `tsSim.ts`'s runtime engine import
- [x] `src/simport/contract.fixture.ts`: the contract case (AC 3)
- [x] `src/simport/tsSim.test.ts`: identity with the engine's lists, frozen, a tower swap (AC 1, 2)
- [x] `src/simport/view.types.test.ts` (AC 4)
- [x] `src/wasmhost/merge.ts`: drop both memos when the revision or the units moved, with tests (review)
- [x] `docs/performance/hot-path-review.md`: the HP-8 inventory row (review)
- [ ] #1217 comment with the `RustSim` cases (AC 5)
- [ ] Hot-path record on the PR (AC 6)

## Dev Notes

### Sizes (the large tower)

43,358 units: 40,458 floor and lobby tiles and 2,900 rooms. The structure is
110 runs on large and 86 on medium, the counts 6a's structure reader reports
for the same towers (PR #1284).
Every large-tower tile has width 1, and its units are already in x order per
floor; the medium tower has 82 floors whose units are not in x order (tiles
laid right to left, or built in pieces).

### Where the members live

The issue puts the run accessor "next to `hasStructure` and `structureKindAt`"
on `TowerView`. `TowerView` is satisfied by the live `Tower`
(`view.types.test.ts`), so a member there must be a member of `Tower`, and
`Tower.ts` sits at the 500-line ceiling. Both members go on `SimView`
instead, beside `tower`, which keeps the live `Tower` a view and lets
`TsSim` serve them from engine helpers. A Rust adapter fills both from 6a
directly.

### Complexity

- `rooms` on `TsSim`: `roomUnits`, so a read is a `WeakMap` lookup and three
  comparisons. On the TypeScript host the engine's per-step scans (`spawn`,
  `demand`, `services`, `star`, routing and others) keep it warm. On the WASM
  hosts the instance does not step, so the first read after a revision move
  pays the filter over all 43,358 units (0.88 ms on large, cloud).
- `structure` on `TsSim`: a read is the same lookup. A rebuild is one pass
  over `tower.units` to bucket the tiles by floor, one sort of the floor keys,
  a sort by x only for a floor whose tiles are out of order (at most
  `LOT_WIDTH` = 375 tiles each), and one pass to form the runs. Cloud,
  exploratory only (not desktop evidence): large median 1.97 ms, p90 4.29 ms;
  medium median 1.37 ms; `roomUnits` rebuild 0.88 ms on large. That is per
  revision. The Hot-Path Auditor found every revision move in both engines
  to be a player command or a load (and, on the WASM hosts, the merge that
  adopts one), so it is the per-command tier. Nothing reads `structure` yet:
  slice 3 will, once per frame at most, a read between revisions costs the
  lookup, and the first frame after an edit pays both rebuilds.
- The WASM hosts' merge rewrites `tower.units` in place and sets the revision
  from the engine's own count, which starts over at each engine load, so it
  drops both memos (`forgetUnitLists`) when the
  revision moved or the units did (id, kind, floor, x or width at any
  position). An hourly merge that moved neither keeps both arrays, as the
  contract requires on every host. The units check is one pass over the
  unit array, only when the revision held, inside a merge that already
  deserializes and copies the whole tower.
- Both arrays and every run are frozen, so no reader can corrupt the shared
  memo.

### The ratchet line and the wasm-only build

`src/simport/` counts as frontend in the #1118 guard, so `tsSim.ts`'s runtime
import from `src/engine/tower/rooms.ts` needs a ratchet line. The adapter
retires with the TypeScript engine, so the line costs the retirement nothing,
and the alternative (copying the filter and the run builder into the adapter)
would add a second memo beside the engine's warm one.

Since slice 4a (#1313) the app builds its port with `createTsSim` in
`main.ts`, so the wasm-only build ships `TsSim` and whatever engine module it
imports. `structureRuns` lives in `rooms.ts`, which that build already ships
(the read model's population walks it), so the build gains no engine module
and `scripts/engine-bundle.allow.txt`, which only shrinks, needs no line. The
two lists are the two halves of one split of `tower.units`, and one forget
drops both.

## Dev Agent Record

### Completion Notes List

- Deviation: both members are on `SimView`, not `TowerView` (Dev Notes, "Where
  the members live").
- The contract case turns bridging off (`setAutoBridge`, a Modern tower) so
  the gap it builds across stays open until the case fills it.
- The contract compares `structure` with a `structureKindAt` scan of every
  cell from `lowestFloor` to `highestFloor` across the 375-cell lot, which is
  test-only work.
- Review (`/gds-code-review`, run from the skill's files with its four layers,
  since this session did not register the project's skills; it covers the
  plumbing surface `/bmad-code-review` would):
  - Both memos could return a stale list on the WASM hosts: the merge keeps
    the unit array's identity and sets the revision from the engine, whose
    count starts over at each load, so a later revision could repeat a
    memoized one over other units. The merge now drops both memos when the
    revision or the units moved; a merge test with a repeated revision over
    other units fails without the units check.
  - The confirming pass found the first form of that fix (a drop on every
    merge) broke the contract on `unitWasm`: an hourly merge dropped both
    arrays while the revision held. A second merge test pins that an hourly
    merge keeps both and a moved revision drops them.
  - It also found that importing a separate runs module into the merge
    shipped it in the wasm-only build, whose allow list only shrinks. After
    `main` brought slice 4a, `TsSim` itself ships there, so `structureRuns`
    moved into `rooms.ts` (already shipped) and `forgetUnitLists` drops both
    memos; the wasm-only build ships the same engine modules as `main`.
  - The other module-level memos keyed that way (`segments.ts`, `spawn.ts`,
    `services.ts`) are pre-existing and deferred to #1296 with a backlog row.
  - The contract now checks the revision did not move before checking the
    arrays are kept, that a kept `rooms` entry shows the new label, and that
    one tile joining runs on both sides gives one run (a Rust adapter that
    forwarded 6a's split runs would fail it).
  - Docs: 6a's runs are not the same encoding (they can split where these
    join, and carry no ids), `tower.unitAt` gives the room on a covered tile,
    and `roomUnits` is warm only on the TypeScript host.
  - A test pins `isStructural` to exactly the floor and lobby kinds, and the
    fixture-dependent expectations now come from the fixture.

### File List

- `src/engine/tower/structureRuns.test.ts` (new)
- `src/simport/view.ts`
- `src/simport/tsSim.ts`
- `src/simport/contract.fixture.ts`
- `src/simport/tsSim.test.ts`
- `src/simport/view.types.test.ts`
- `src/tests/frontendEngineImports.ratchet.txt`
- `src/engine/tower/rooms.ts` (`structureRuns`, `forgetUnitLists`)
- `src/wasmhost/merge.ts`, `src/wasmhost/merge.test.ts`
- `docs/performance/hot-path-review.md` (HP-8 inventory)
- `_bmad-output/implementation-artifacts/backlog.md` (the #1296 row)
- `_bmad-output/implementation-artifacts/story-facade-view-rooms-runs.md` (new)
