---
story: sim-step-unit-scans
status: review
issue: 846
---

# Story: skip structure tiles in the per-step unit scans

## Why

Trip spawning (`crowd.spawn`) and elevator demand (`elevators.accumulate`) walk
every unit in the tower once per sim step, and so does the population census
(`tower.totalPopulation`) they both call. On `sixseven_2.vctower` (78 floors,
about 3,400 population) that is about 12,000 units, about 11,000 of them bare
floor and lobby tiles that every one of those loops skips by kind. Headless,
the sim cost about 4.4 ms per normal step at the fastest speed, most of it in
these walks (backlog `sim-step-unit-scans`, #846).

## Acceptance criteria

1. **AC1 Same results.** For the same save and the same steps, the tower and
   the crowd are byte-identical to before. Classic golden masters and every
   existing test stay green. One stated exception: a save that carries an
   occupant count on a floor or lobby tile loads with that count at 0 (AC4).
2. **AC2 Faster per-step scans.** The per-step walks in trip-spawn binning,
   elevator waiting demand, and the population census skip structure tiles.
3. **AC3 Cache safety.** The rooms-only list is invalidated by any change to
   the unit list (placement, removal, load), and keeps `tower.units` order.
4. **AC4 Structure tiles load empty.** Load restores `occupants` to 0 on floor
   and lobby tiles, and leaves a room's saved count alone.

## Result

- New `src/engine/tower/rooms.ts`: `roomUnits(tower)`, the unit list minus floor
  and lobby tiles, memoized on the unit array, its length, and
  `tower.revision`.
- `spawnFloors`, `ElevatorDispatch.accumulateWaiting`, `totalPopulation` and
  `associatedPopulation` iterate it.
- Load restores `occupants` to 0 on floor and lobby tiles, as it already did for
  attendance venues. A structure tile never holds anyone (the hourly presence
  pass writes its catalog population, 0), so a legacy or hand-edited count on
  one was phantom elevator demand for up to an hour after load. This is the one
  case where results differ from before: AC1 holds for every save whose
  structure tiles carry no occupants, which includes all three fixtures (24,558
  structure tiles, none with occupants).
- Measured headless on `sixseven_2` at 2 game minutes per step: normal steps
  4.40 ms to 1.79 ms mean (6.49 to 3.86 ms p95); hour-boundary steps 20.9 ms to
  14.8 ms; day-boundary steps 29.1 ms to 20.0 ms.
- Byte-identity checked by hashing `serialize()` plus the full crowd every game
  hour for three game days on `sixseven_2`, `towerone_6` and `split-tower`, as
  saved and forced to Modern: all six hashes identical before and after.

## Out of scope

- The hourly passes (satisfaction, move-ins, traffic income, presence,
  congestion) still walk every unit and now dominate the hour-boundary spike.
  They cannot simply skip structure tiles: `sixseven_2` carries 48 legacy floor
  tiles in the `occupied` state, which the satisfaction sweep processes, so the
  skip would change saved values there. Backlog `sim-hourly-unit-scans` (#848).

## Review record

`/gds-code-review` (Blind Hunter, Edge Case Hunter, Acceptance Auditor) ran six
rounds, the last clean in all three layers. Patched along the way: the load
reset now covers lobby tiles and leaves a room's saved count alone (with a test
for both), AC1 states its one exception, the `spawnFloors` comment no longer
claims structure tiles never reached `unitsByFloor`, and the structure check
reuses `isStructural` from `towerTopology.ts` instead of a second copy.
Dismissed after tracing every path: every `unitsByFloor` reader filters by room
kind and treats a missing floor as empty; nothing at runtime writes a nonzero
occupant count on a floor or lobby tile; `outForMeal` and `customersIn` are
never saved; every change to the unit list bumps `tower.revision` or replaces
the array.
