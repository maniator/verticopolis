---
title: "Technical Design: Per-Person Meal Round-Trips"
game: Verticopolis (browser SimTower clone)
author: Cloud Dragonborn (Game Architect, gds agent), with the person-tracking party
date: 2026-07-09
status: Spec, approved for implementation
scope: Engine implementation of the per-person meal round-trip: origin
  identity on Person, a new eating state, an outForMeal overlay counter on
  Unit, retirement of the aggregate return branch in pushMealOptions, and the
  render+cache updates that surface the visible dip. Ships PR A of the three-
  PR person-tracking + census + import-seed epic.
grounds:
  - gdd-person-meal-round-trips-2026-07-09.md (the player-facing contract)
  - src/engine/Crowd.ts (Person state machine, spawn/advance, pushMealOptions,
    CROWD_SECONDS_PER_MINUTE, MAX_PEOPLE)
  - src/engine/Simulation.ts (updatePresence hourly overwrite of u.occupants,
    tick loop that calls crowd.spawn + crowd.advance)
  - src/engine/types.ts (Unit interface, PersonState union)
  - src/render/pixelSprites.ts (u.occupants readers in office/condo/hotel draws)
  - src/render/excalibur/TowerEngine.ts (sprite cache signature line ~1442)
---

# Technical Design: Per-Person Meal Round-Trips

## 0. LOAD-BEARING INVARIANTS: read before touching this mechanic

> If you change anything here, re-run `crowd.test.ts`, `mealCadence.test.ts`,
> `personRoundTrip.test.ts` (new), plus the balance guards `parity.test.ts`
> and `phase2.test.ts`.

1. **`u.occupants` stays canonical.** `updatePresence` continues to overwrite
   `u.occupants` hourly with the expected staff count for the hour. This PR
   does NOT touch `updatePresence`. The `outForMeal` overlay lives ON TOP of
   `u.occupants` and does not fight it.
2. **`outForMeal` is transient.** Not serialized. On save/load reset to 0.
   `updatePresence` on the first tick after load overwrites `u.occupants` with
   the baseline; the visible dip resumes as new meal trips fire.
3. **Ghost-decrement guard.** A returning meal person MUST guard
   `--outForMeal` with (a) the origin unit still exists, and (b)
   `outForMeal > 0`. Mirrors the shipped `cleanUnitId` staff pattern.
4. **Renderer reads the derived helper.** `visibleOccupants(u) = max(0,
   u.occupants - u.outForMeal)`. Every existing `u.occupants` read in
   `pixelSprites.ts` inside a FIGURE-COUNT expression swaps to this helper.
   GATES that check "is anyone here at all" (lit-at-night, asleep-state
   detection) keep reading canonical `u.occupants`.
5. **Sprite cache signature includes `outForMeal`.** Otherwise the cache
   serves stale figure counts through the meal peak. Add `outForMeal` to the
   sig at TowerEngine.ts line ~1442.
6. **Aggregate return branch retired.** `pushMealOptions` no longer pushes
   `venue -> origin` return options. Real round-trippers handle both legs.
7. **Determinism.** Eat-timer randomization uses `this.rng.int(...)` (crowd
   RNG). No `Date.now()`/`Math.random()`. Save-reload is deterministic modulo
   the transient loss of mid-trip persons.

## 1. Person state machine extension

New state added to the existing union:

```
type PersonState = "toShaft" | "waiting" | "riding" | "climbing"
                 | "toDest" | "eating" | "done";
```

New Person fields:

```
interface Person {
  // ...existing fields...

  /** Unit id of the ORIGIN room for a round-trip meal person (office, condo,
   *  or hotel unit whose visible occupancy dropped by 1 when this person
   *  spawned outbound). Null for the shipped lobby-centric commuter flow
   *  and for staff dispatches. On return-arrival, the person decrements
   *  `unit.outForMeal` on this origin (guarded by "unit still exists AND
   *  outForMeal > 0"). */
  originUnitId?: number;

  /** Remaining crowd-seconds in the `eating` state (a stationary sit at the
   *  destination floor after the outbound trip's `toDest` completes). Only
   *  set for round-trip meal persons. */
  eatSecondsLeft?: number;

  /** True once `transitionToReturn` has mutated this round-tripper into the
   *  return leg. The `toDest` case uses `!returning` to distinguish the
   *  outbound arrival (transition to eating) from the return arrival (call
   *  finish); without this flag the two completions are indistinguishable and
   *  the return arrival would loop back into eating. Set by
   *  `transitionToReturn` in both the successful and route-fail branches. */
  returning?: boolean;
}
```

New `Unit` field:

```
interface Unit {
  // ...existing fields...

  /** Transient count of workers/residents currently out on a meal round-trip
   *  originating from THIS unit. Not persisted. Renderer and (PR B) census
   *  read `visibleOccupants(u) = max(0, u.occupants - u.outForMeal)`.
   *  Incremented at outbound spawn; decremented at return arrival (guarded).
   *  Reset to 0 by deserialize. */
  outForMeal?: number;
}
```

## 2. Round-trip lifecycle

**Outbound spawn** (in `pushMealOptions`):
- When a meal-origin option fires and its origin resolves to a specific `Unit`
  (walk the floor's units, pick a random matching-kind occupied unit whose
  `outForMeal < u.occupants`), the person is created with:
  - `originUnitId = u.id`
  - normal outbound route (origin floor -> venue floor)
- `u.outForMeal += 1` at spawn time.
- The route walks its usual `toShaft -> waiting -> riding -> climbing -> toDest`.

**Arrival at venue** (in `advance`, when `toDest` reports arrival):
- If `originUnitId !== undefined`: transition to `eating` with
  `eatSecondsLeft = this.rng.int(EAT_SECONDS_MIN, EAT_SECONDS_MAX)`.
- Otherwise: transition to `done` (existing behavior).

**Eating** (new advance branch):
- Person stands still at their destination-x on the venue floor.
- `eatSecondsLeft -= dtSec` each `advance` call.
- When `eatSecondsLeft <= 0`, transition to the return trip.

**Return trip build** (on `eating` expiry):
- Look up `originUnitId` in `tower.units`. If it no longer exists, transition
  straight to `done` (ghost). No `outForMeal` decrement.
- Otherwise, compute a route from the venue floor to the origin unit's floor.
  If route fails (transport degraded while eating), also transition to `done`
  after decrementing `outForMeal` (the person "went home a different way";
  the accounting must balance).
- Otherwise, mutate the person's `floors`, `shafts`, `leg`, `state = "toShaft"`,
  reset `wait = 0`, `age = 0`, keep `originUnitId` set so the final arrival
  decrements the counter.

**Any despawn of a meal round-tripper** (return arrival, give-up mid-outbound,
give-up mid-eating, unreachable return, shaft-vanishes-mid-ride, etc.) funnels
through `finish(p, tower)`. `finish` decrements `outForMeal` on the origin if
`originUnitId !== undefined && origin exists && origin.outForMeal > 0`. This
is stronger than "only on return arrival": every increment at spawn time must
pair with exactly one decrement at despawn, regardless of which leg the person
was on when they despawned, so the accounting can never leak. The ghost-origin
case pre-emptively clears `p.originUnitId` in `transitionToReturn`, so finish
skips the decrement branch entirely for that person.

**`tower` is a REQUIRED parameter on `finish`.** Making it optional would let
a future call site silently drop the decrement and leak `outForMeal`; the
compiler enforces the balance.

**Constants:**

```
const EAT_MINUTES_MIN = 30;
const EAT_MINUTES_MAX = 60;
// Converted to crowd-seconds via CROWD_SECONDS_PER_MINUTE (2).
const EAT_SECONDS_MIN = EAT_MINUTES_MIN * CROWD_SECONDS_PER_MINUTE; // 60
const EAT_SECONDS_MAX = EAT_MINUTES_MAX * CROWD_SECONDS_PER_MINUTE; // 120
```

## 3. `pushMealOptions` changes

Retire the return-trip option builders. Only outbound options are pushed;
their return legs are the round-tripper's second half.

```
// BEFORE (aggregate return, this PR RETIRES):
if (pool.weight >= 1 || this.rng.chance(pool.weight)) {
  options.push(() => trip(this.rng.pick(venueFloors), this.rng.pick(pool.floors)));
}

// AFTER: no separate return options; outbound persons round-trip themselves.
```

The outbound option builder mutates to attribute the trip to a specific
origin UNIT (not just a floor), so `originUnitId` can be set:

```
options.push(() => this.spawnMealOutbound(tower, pool.originKind, pool.floors, venueFloors));
```

Where `spawnMealOutbound`:
1. Picks a random floor from `pool.floors`.
2. Finds candidate origin units on that floor of the pool's kind whose
   `(u.occupants - (u.outForMeal ?? 0)) > 0`. For the `staff` bucket the filter
   ALSO gates on `staffOnShift(u.kind, hour)` because the pool-floor bin only
   guarantees at least one on-shift kind exists on that floor; another kind on
   the same floor may be off shift.
3. If none (all workers already out), no spawn.
4. Picks a random candidate. Calls `this.add(tower, originFloor, venueFloor)`
   FIRST.
5. If `add` returns `null` (route unreachable in 2 rides), returns without
   incrementing `outForMeal`. Otherwise stamps `originUnitId = candidate.id`
   on the returned person AND increments `origin.outForMeal`. This order (add
   first, mutation second) avoids the case where an increment leaks because
   the route failed.

## 4. `advance` changes

The `advance` loop dispatches on `person.state`. New `eating` branch:

```
case "eating": {
  p.eatSecondsLeft = (p.eatSecondsLeft ?? 0) - dtSec;
  if (p.eatSecondsLeft <= 0) {
    this.transitionToReturn(tower, p);
  }
  break;
}
```

Where `transitionToReturn(tower, p)`:
- Look up `originUnitId` in `tower.units`.
- If missing: set `p.state = "done"`, do NOT decrement anything.
- Else compute return route; on failure decrement `outForMeal` and set
  `state = "done"`; on success replace `p.floors`/`p.shafts`, reset leg
  cursor, `p.state = "toShaft"`.

Final arrival on the RETURN leg (in the existing `toDest` completion path)
adds the ghost-guarded decrement.

## 5. Renderer changes

New pure helper in Crowd.ts (or a small `visibleOccupancy.ts` if we want it
render-adjacent):

```
export function visibleOccupants(u: { occupants: number; outForMeal?: number }): number {
  return Math.max(0, u.occupants - (u.outForMeal ?? 0));
}
```

Swap in `pixelSprites.ts` for figure-count reads only:
- `office` line 242 `filled = min(count, u.occupants)` -> `min(count,
  visibleOccupants(u))`.
- `condo` line 266 `home = u.occupants > 0 && !lateNight` ->
  `home = visibleOccupants(u) > 0 && !lateNight`.

Gate reads that ask "is anyone here at all" for lighting/asleep detection
KEEP canonical `u.occupants`. Those are:
- `emptyAtNight` (line 157) - canonical.
- `asleepHome` (line 158) - canonical (the sleep state gate matters, not the
  visible dip).
- Shell color at line 236 - canonical.
- Hotel `lit` gate at line 307 - canonical.
- fastFood/restaurant patron count reads at 374/398 - canonical (those are
  patron figures, not office/condo/hotel occupancy).
- Shop clerk gate at 429 - canonical.

## 6. Sprite cache signature

`TowerEngine.ts` sig line (~1442):

```
// BEFORE:
const sig = `${u.state}:${lit?1:0}:${u.width}:${u.occupants}:${open}${lateNight}${dead}${liveBits}`;

// AFTER:
const sig = `${u.state}:${lit?1:0}:${u.width}:${u.occupants}:${u.outForMeal ?? 0}:${open}${lateNight}${dead}${liveBits}`;
```

Bucket `outForMeal` if the sig churn is too high (`Math.min(u.outForMeal ?? 0,
9)`), but at MAX_PEOPLE 140 across the whole tower this is bounded and
integers reach the small ranges anyway.

## 7. Persistence & determinism

- `outForMeal` is transient. NOT written by `serialize()`. On `deserialize`
  it defaults to `undefined` (which the reader coerces to 0).
- `originUnitId` and `eatSecondsLeft` on Person are transient (the whole
  Person array is not serialized today; a save-reload always starts with an
  empty crowd, which is why `updatePresence` reconciles occupancy on the
  first tick).
- `Math.random()` / `Date.now()` are NOT introduced. The eat-timer uses
  `this.rng.int(...)`. Save-reload determinism holds.
- No `SAVE_VERSION` bump. Additive-optional Unit field; no new save data.

## 8. Test plan

`src/tests/personRoundTrip.test.ts` (new):

1. **Outbound spawn decrements visible occupancy.** A staffed office with
   occupants=6, spawn a lunch trip from it, assert `visibleOccupants(u) === 5`
   and `u.outForMeal === 1`.
2. **`eating` transition on arrival.** Force a person through their route to
   the venue floor; assert state becomes `eating` and `eatSecondsLeft` is in
   [EAT_SECONDS_MIN, EAT_SECONDS_MAX].
3. **Return trip fires after eat expiry.** Advance the eat-timer to zero;
   assert state becomes `toShaft` and floors[0] == venue floor, floors[last]
   == origin floor.
4. **Return arrival decrements visible occupancy.** Complete the return leg;
   assert `visibleOccupants(u) === 6` and `u.outForMeal === 0`.
5. **Ghost guard: bulldoze origin during eating.** Remove the origin unit
   while the person is `eating`. Advance to expiry. Assert person goes to
   `done` with NO exception; no decrement on any unit.
6. **Ghost guard: bulldoze after return-route computed.** Remove origin
   during the return trip. Assert `outForMeal` on the (deleted) unit is not
   touched; no crash.
7. **Save/load resets `outForMeal`.** Serialize a sim with a live meal
   round-tripper (outForMeal=3 on an office). Deserialize; assert `outForMeal`
   is `0` (or undefined coerced to 0).
8. **`MAX_PEOPLE` cap holds through a lunch peak with round-trippers.**
   Larger crowd density than the shipped meal cadence; assert
   `people.length <= 140` throughout.
9. **`collectTrafficIncome` byte-identical.** Two fresh identical fixtures at
   12:00, run collectTrafficIncome; equal amounts.
10. **Renderer swap: visibleOccupants is used only for figure counts.** A
    lit-at-night office (u.occupants > 0 but outForMeal = u.occupants) keeps
    its `lit` gate reading canonical occupants, not visible. Structural test
    on the helpers.

Existing tests must still pass:
- `crowd.test.ts` unchanged.
- `mealCadence.test.ts`: the return-trip lag test now measures a DIFFERENT
  shape (round-trippers land the return themselves, not aggregate). Adjust
  or delete the asymmetry test if it becomes tautological (round-trippers by
  definition return after eating, so first-half outbound > return is trivially
  true).
- `subsystems.test.ts` collectTrafficIncome tests must still pass.
- `parity.test.ts` (TOWER run) and `phase2.test.ts`: a healthy tower does not
  bleed through meal peaks.

## 9. File-touch summary

- `src/engine/types.ts`: add `outForMeal?: number` to `Unit`.
- `src/engine/Crowd.ts`:
  - PersonState union gains `eating`.
  - Person interface gains `originUnitId?`, `eatSecondsLeft?`, `returning?`.
  - New constants `EAT_MINUTES_MIN/MAX`, `EAT_SECONDS_MIN/MAX`.
  - New `visibleOccupants(u)` exported helper.
  - New `spawnMealOutbound(tower, pool, venueFloors, hour)` method.
  - `pushMealOptions` retires the return-trip option builder; outbound
    options call `spawnMealOutbound` instead of the aggregate `trip()`.
  - `advance` gains an `eating` case; the give-up patience valve at the top
    of the advance loop EXCLUDES `state !== "eating"` so a long-tail eater
    is not culled mid-eat. Entering `eating` also resets `p.age = 0` so the
    outbound trip's accumulated give-up seconds do not eat into the return
    leg's patience budget.
  - `finish(p, tower)` (REQUIRED `tower`, not optional) contains the ghost-
    guarded `outForMeal` decrement, firing on ANY meal round-tripper despawn.
  - New `transitionToReturn(tower, p)` method.
- `src/engine/Simulation.ts`:
  - `serialize`'s Unit destructure adds `outForMeal: _outForMeal, ...unhandled`
    so the exhaustive `Record<string, never>` check still catches new Unit
    fields. `outForMeal` is deliberately dropped from the saved shape.
  - `deserialize`: no change; the missing field coerces to 0 via the read
    sites' `?? 0` idiom.
- `src/render/pixelSprites.ts`:
  - Import `visibleOccupants` from Crowd.
  - Swap the two figure-count reads (office line 242, condo line 266) to the
    helper.
- `src/render/excalibur/TowerEngine.ts`:
  - Sprite cache signature includes `u.outForMeal ?? 0`.
- `src/tests/personRoundTrip.test.ts`: new, 13 tests covering visibleOccupants
  pure semantics, visible-dip on spawn, full-window drain, ghost-guard when
  origin is bulldozed mid-eating AND during return transit, save/load reset,
  MAX_PEOPLE cap through peak lunch, two-ride reachability, eating-timer
  in-range, return-leg fires after eat expiry.
- `PARITY.md`: one-line addition under Time/Population noting the visible
  dip.

## 10. Version bump

Player-facing new capability (visible office/condo/hotel dip during meals).
Minor bump: `1.16.0 -> 1.17.0`.
