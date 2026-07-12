---
title: 'Stranded-floor move-ins: gate tenancy on the two-ride rule'
type: 'bugfix'
created: '2026-07-12'
status: 'in-review'
baseline_commit: '3afeb401aed443cb655a0d26f11d2acd2a985863'
context:
  - '{project-root}/_bmad-output/specs/spec-stranded-floor-move-ins/SPEC.md'
  - '{project-root}/_bmad-output/project-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `attemptMoveIns` gates tenant move-ins on `Tower.isFloorServed` (unbounded transfer connectivity) instead of `Simulation.floorReachable` (the canon two-elevator-ride rule), so condos sell, offices lease, and hotel rooms fill on floors no commuter can ever reach. Player save SixSeven: floors 31-44 are 3 rides out, yet 56 condos sold for $10.84M with 168 phantom residents in the star census.

**Approach:** Add a `floorReachable` gate for all tenant kinds at one shared point in `attemptMoveIns`, memoized per floor per pass. Widen the daily `nudgeStranded` advisory to also cover floors whose rentable units are all still empty, so the player is told why nothing moves in. Demand-side only: existing sold/occupied units are untouched.

## Boundaries & Constraints

**Always:** Mode-agnostic (identical Classic/Modern). Engine stays DOM-free. The stats-modal stranded count and the inspector access line keep their current semantics. The nudge stays log-only ("info"), daily, edge-triggered by the existing latch. Reachability BFS runs at most once per distinct floor per `attemptMoveIns` pass, and only for floors already passing `isFloorServed`. Patch version bump.

**Ask First:** Any change to `Crowd.MAX_RIDES`, route semantics, or the served-floor model. Any retroactive treatment of already-sold condos.

**Never:** No eviction, buy-back, or census correction for existing occupied units on stranded floors. No save-format change, migration, or `SAVE_VERSION` bump. No new revision-keyed cache. No editor-panel "third access state" (backlogged). No express-elevator suggestions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stranded condo | Empty condo on served floor 3+ rides out | Never sells, any number of hourly ticks | N/A |
| Stranded office / hotel | Empty office / clean hotel room, same floor | Never leases / never fills | N/A |
| Shortcut added | Express (or 15-45 shaft) makes the floor 2 rides | Move-ins resume on the next hourly pass | N/A |
| Loaded save with sold condos on stranded floors | SixSeven-shaped save | Sold condos stay occupied and everOccupied; no money movement | N/A |
| Empty-condo floor, no leased units | Floor stranded, all units empty | Daily nudge fires once (latched), copy no longer says "leased" | N/A |
| Gutted/burning/under-construction units only | Stranded floor, no operational rentable unit | No nudge (nothing rentable) | N/A |
| Ground floor / basement | floor 1 or below | Unaffected (floor 1 short-circuits true; no basement tenant kinds) | N/A |

</frozen-after-approval>

## Code Map

- `src/engine/Simulation.ts` -- `attemptMoveIns` (~1674): the gate + per-pass memo; `nudgeStranded` (~915): widened candidates + copy; `strandedFloors` (~1980): gains a scope parameter (default keeps current leased-only behavior for stats/tests)
- `src/engine/milestones.ts` -- `isTenantFloorUnit`: leased predicate, shared with the 5-star milestone; do NOT change it
- `src/engine/Crowd.ts` -- `MAX_RIDES = 2` and `route()`: consumed via `floorReachable`, untouched
- `src/engine/facilities.ts` -- `FACILITIES[kind].population > 0` identifies tenant-capable kinds; `isOperational` filters gutted/fire/construction
- `src/ui/statsHtml.ts` -- calls `sim.strandedFloors()` for the stats row; must keep leased-only meaning (default arg, no call-site change)
- `src/tests/legibility.test.ts` -- existing `threeRideTower` fixture + stranded-nudge latch test (counts "3+ elevator rides" substring; keep that phrase in the new copy)
- `package.json` -- version 1.18.1 -> 1.18.2

## Tasks & Acceptance

**Execution:**
- [x] `src/engine/Simulation.ts` -- In `attemptMoveIns`, add a per-pass `Map<number, boolean>` reachability memo and gate all tenant kinds with it immediately after the `isFloorServed` check -- one shared gate, BFS deduped per floor
- [x] `src/engine/Simulation.ts` -- Parameterize `strandedFloors(scope: "leased" | "rentable" = "leased")`: `leased` keeps `isTenantFloorUnit`; `rentable` also includes floors carrying an operational unit of a tenant-capable kind (`FACILITIES[kind].population > 0`, floor >= 2, `isOperational`), empty included
- [x] `src/engine/Simulation.ts` -- `nudgeStranded` uses the `rentable` scope and reworded copy that keeps the "3+ elevator rides" phrase but drops "leased" (e.g. "A floor with rentable space is 3+ elevator rides from the lobby. Nobody will move in or visit. Check it in the inspector.")
- [x] `src/tests/legibility.test.ts` -- New tests per the matrix: stranded condo/office/hotel never move in across a simulated week; shortcut restores move-ins; empty-condo floor triggers the nudge once and latches; loaded save keeps sold condos
- [x] `package.json` -- bump version to 1.18.2

**Acceptance Criteria:**
- Given the `threeRideTower` fixture with an empty condo, office, and clean hotel room on a 3+-ride floor, when a week of hours ticks, then none of them becomes occupied/asleep while units on <=2-ride floors still move in
- Given the same tower after adding a shaft that puts the floor within 2 rides, when hours tick, then move-ins on that floor resume
- Given a serialized tower with `everOccupied` condos on stranded floors, when deserialized and ticked, then those condos remain occupied and no buy-back or eviction fires
- Given a stranded floor whose only tenant-capable units are empty, when the daily nudge check runs, then the advisory fires once ("info", not toast) and does not repeat while the condition persists
- Given the stats modal, when it renders, then its stranded count still reflects leased floors only

## Verification

**Commands:**
- `npm run typecheck` -- expected: clean
- `npm run lint` -- expected: clean
- `npm test` -- expected: all green, including the new legibility tests
- `npm run build` -- expected: clean
