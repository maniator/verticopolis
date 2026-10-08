---
story: sim-hourly-unit-scans
status: review
issue: 848
---

# Story: skip structure tiles in the hourly passes

## Why

After `sim-step-unit-scans` (#846) a normal sim step on `sixseven_2.vctower`
costs about 2 ms, but every game-hour step still cost about 17 ms (p95 about
26) and every game-day step about 22.6 ms (re-measured on this branch's base;
the backlog row's earlier figures of 15 and 20 ms came from a quieter run): a
visible hitch at the fastest speed, where an hour passes every half second.
The hourly passes (satisfaction, demand, move-ins, traffic income, presence,
congestion, parking, the star census) each walked every unit, about 11,000 of
them bare floor and lobby tiles.

They could not skip those tiles, because some floor tiles loaded `occupied`
and the satisfaction sweep processed them. The cause: two save migrations
paved new floor tiles with `state: "occupied"`, where normal placement creates
structure tiles `empty`. The v5-to-v6 migration (`migrations/v5tov6.ts`) does it
under an expanded or relocated party hall, which is where the 48 tiles in
`sixseven_2` come from; the v1-to-v2 reflow (`migrations/v1tov2.ts`) does it
where a widened room needs a supported gap paved. Every older save that passed
through either carries such tiles, and the game wrote them back on every save.

## Acceptance criteria

1. **AC1 Structure tiles are always empty.** Both migrations pave new floor
   tiles `empty`, and load restores any saved structure tile to `empty` at
   satisfaction 1 (what placement creates), so an already migrated save is
   repaired too. A room's saved state is untouched.
2. **AC2 Rooms unchanged.** For the same save and steps, every room, the crowd,
   and everything else except the floor and lobby tiles' own fields is
   byte-identical to before. Classic golden masters and every existing test
   stay green.
3. **AC3 Skips are exact.** With AC1 in place, switching the hourly loops to
   `roomUnits(tower)` changes nothing at all: the full `serialize()` plus crowd
   hash matches the AC1-only build.
4. **AC4 Faster hour boundary.** The hourly loops that only touch rooms walk
   `roomUnits(tower)`.

## Result

- `v1tov2.ts` and `v5tov6.ts` pave `empty`. `serialization.ts` loads every
  floor and lobby tile `empty` at satisfaction 1. Each migration has a test that
  fails on the old paving, and a load test covers a forged `occupied` tile.
- The satisfaction sweep and its amenity context, `computeDemandMap`'s venue and
  origin loops, move-ins, traffic income, presence, spatial congestion,
  `parkingDemand`, and `occupantPopulation` iterate `roomUnits(tower)`. Each
  loop body already skipped structure tiles, by kind or because they are dormant
  or not present. The occupancy heat map keeps walking `tower.units`, since it
  reads floor extents from the structure tiles.
- Proof, hashing `serialize()` plus the crowd every game hour for three game
  days on `sixseven_2`, `towerone_6` and `split-tower`, as saved and forced to
  Modern:
  - Load fix alone against before, with floor and lobby tiles left out of the
    hash: all six identical (AC2). With them in, `sixseven_2` and `towerone_6`
    differ, as expected: their migrated floor tiles now save `empty`.
  - Load fix plus the skips against the load fix alone, full hash: all six
    identical (AC3).
- Measured headless on `sixseven_2` at 2 game minutes per step: hour-boundary
  steps 17.0 ms to 9.3 ms mean (p95 26.5 to 18.3), day-boundary steps 22.6 to
  15.8 ms, normal steps unchanged at about 2 ms.

## Out of scope

- What remains at the hour boundary is per-room work: route searches for each
  room's reachability in the satisfaction step and the demand map, and a second
  population census inside `towerDemandBonus`. Backlog
  `sim-hourly-reachability` (#849).

## Review record

`/gds-code-review` (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Round 1
found the second migration (`v1tov2.ts`) paving `occupied` tiles and the stale
satisfaction those tiles kept; both are fixed, with tests that fail on the old
code. Round 2 asked for a test of the satisfaction reset (added) and two wording
fixes. Dismissed after tracing every path: no runtime path gives a floor or lobby
tile any state but `empty` (fire and the bomb exclude them, their build time is
0, move-ins skip population-0 kinds), so forcing `empty` on load drops no real
state; `isStructural` is exactly floor and lobby; no switched loop adds or
removes units, so iterating the cached list cannot skip or revisit one; other
room-only fields on a hand-edited structure tile are never read for a structure
kind. The repair runs at load because saves already written at the current
version carry the bad tiles too, so a versioned migration would miss them.
