---
title: "Game Design: Per-Person Meal Round-Trips (the real visible dip)"
game: Verticopolis (browser SimTower clone)
author: Samus Aran (Game Design, gds agent), with the person-tracking party
date: 2026-07-09
status: Spec, approved for implementation
scope: Turn the aggregate meal-cadence flow into real per-person round-trips.
  When an office worker leaves for lunch, THAT worker's seat is empty until
  they walk back. Offices, condos, and hotels visibly thin out during their
  meal peak and refill on return. First of three stacked PRs that together
  deliver population-census parity with the 1994 game and improve TDT
  round-trip fidelity.
grounds:
  - src/engine/Crowd.ts (Person state machine, spawn/advance, pushMealOptions)
  - src/engine/Simulation.ts (updatePresence, u.occupants derivation)
  - src/engine/types.ts (Unit, PersonState, isPresent)
  - src/render/pixelSprites.ts (u.occupants readers in draw functions)
  - src/render/excalibur/TowerEngine.ts (sprite cache signature)
  - arch-person-meal-round-trips-2026-07-09.md (the engine design)
---

# Game Design: Per-Person Meal Round-Trips

## 0. The one-paragraph pitch

The tower-wide meal cadence PR (v1.16.0) delivered the transport rhythm but not
the felt effect: elevators fill at noon, but the offices they empty from still
look full because meal trips are aggregate flow (one-way spawn + despawn on
arrival). This change makes the round trip real. When a worker leaves floor 32
at 12:10 for a fastFood on floor 5, that specific worker's seat empties. She
sits at fastFood for 45 minutes, then walks back up. Floor 32's office visibly
thins from six workers to two through the peak and refills through the tail.
Same for condos on their way to breakfast, hotel guests on late-night snacks,
and staff on lunch. The mechanic that was previously invisible is now the
thing the player watches at noon.

## 1. Why this matters as a parity feature

The tower-wide meal cadence PR closed the transport-pulse gap. This PR closes
the visible-occupancy gap that we deliberately pulled from that PR (the "fake
render dip" the party rejected as a shell game). It also unlocks a chain of
canon parity work: real per-person round-trips give the population census a
correct hourly view of who is where, which lets PR B (population-census parity)
count venue customers toward pop per canon, which lets PR C (TDT import seed)
match the retail game's reported population on import.

Standalone value: even without PRs B and C, the visible dip is what makes
"lunch rush" a felt mechanic the player can watch play out floor by floor.

## 2. The design pillar this serves

**"Transport is the puzzle."** The prior meal-cadence PR made shafts feel the
demand; this PR makes the rooms show it. Together they turn meal times into a
first-class design constraint: shafts must be sized for the peaks, and the
player can see WHO is out and where.

## 3. What the player experiences

### The visible dip

- **Offices** thin out during lunch (11-14) and dinner (17-20). A weekday office
  that shows six workers at 11:00 shows two or three at 12:30 and refills by
  14:00. Same for dinner if the tower has late workers.
- **Condos** thin out during their meal windows. A condo whose family is home
  at 09:00 shows one figure during a breakfast trip and refills as they return.
- **Hotels** thin out during breakfast and late-night meal windows (the two
  windows where the hotel state model has guests in-room today).
- The dip is *continuous*: as one worker leaves, the room drops by one; when
  they get back, the room ticks up by one. It is not a global "12:00 -> empty"
  flip.

### The eating pause

- After a person arrives at a food venue, they sit for a randomized 30-60
  minutes before walking back. This is the visible "someone at a table" that
  makes fastFood and restaurant floors look busy at lunch.
- Existing patron figures at those venues stay; the new round-tripper is on
  top of the existing visual (they render like any other person figure at
  their destination).

### Nothing invisible

- No economy change. `collectTrafficIncome` still runs off appeal factors; the
  per-person tracking does not add or remove any income.
- No new venue kinds, no new save fields, no mode gate (Classic + Modern both
  get the visible dip).
- The census number the HUD shows (`Pop`) does not change in this PR (PR B
  handles the census work).

## 4. The mechanic details (contract)

- **Origin identity.** A meal trip is tied to a specific origin unit (office,
  condo, or hotel room). When that person spawns, the origin unit's visible
  occupancy drops by 1. When they get back, it ticks up by 1.
- **Ghost guard.** If the player bulldozes the origin unit while its worker is
  out to lunch, the returning person just despawns silently at the (now empty)
  floor. The room that replaces the old one, if any, does not inherit a ghost
  decrement.
- **Eat time.** Randomized 30-60 minutes at the venue. Fast enough that lunch
  fits in the 3-hour window (average 45 min there and back leaves an hour of
  eating).
- **Return route.** Recomputed at return time, not baked at outbound spawn: a
  new elevator built while the person eats can service the return trip.
- **No new persistence.** The out-for-meal count on each unit is transient
  (like the shipped `linger` timer). A save reloaded mid-meal loses the state;
  `updatePresence` reconciles occupancy on the next hour tick.

## 5. Explicitly out of scope for this PR

- **Venue customer census** (fastFood, restaurant, shop populations per canon).
  That is PR B, alongside a SAVE_VERSION bump.
- **TDT import population seed.** PR C, close after PR B.
- **Hotel daytime gate expansion** (making hotels contribute lunch/dinner meal
  trips even when guests are not `asleep`). Follow-up; needs its own decision
  on how to model "guest is in-tower".
- **Commercial venue inspector** (patronage tracking UI, weather modifier).
  Separate feature.
- **No new economy path.** Same rule as PR meal-cadence: appeal factors and
  daily income constants stay put.

## 6. Risks the design accepts

1. **Crowd density doubles at meal peaks.** Every meal trip is now two persons
   in the crowd (outbound + return) instead of one aggregate half. If
   `MAX_PEOPLE = 140` starts blocking regular flow, retune
   `mealPopulationWeights` down.
2. **RNG determinism.** Eat-timer randomization uses the crowd RNG
   (`this.rng`), not `Math.random`. Save-reload determinism holds because
   `outForMeal` is transient (any mid-trip person is lost and reconciled by
   `updatePresence`), and the crowd RNG advances deterministically.
3. **Sprite cache correctness.** The renderer reads `u.occupants -
   u.outForMeal`; the sprite cache signature must include `outForMeal` or the
   cache serves stale figures. Update the signature.
4. **Ghost decrements.** Person carrying a stale `originUnitId` after the
   origin is bulldozed: guard on `--outForMeal` (unit must exist AND
   `outForMeal > 0` before decrementing).
5. **Save-load: `outForMeal` reset to zero.** Mid-lunch save reload silently
   resets. Same trade the shipped crowd already makes for every non-staff
   trip; `updatePresence` on the first tick makes it right.

## 7. Acceptance (player-facing)

1. During lunch (12:00-13:30 on a weekday), a fully-staffed office visibly
   loses figures over the peak and regains them through the tail.
2. During breakfast (07:00-08:30), a condo whose family is home visibly loses
   its figure for the duration of the round-trip and regains it.
3. A worker who leaves for lunch at 12:10 despawns *at the venue*, sits (still
   visible) for 30-60 minutes, then walks back.
4. A player who bulldozes an office while its workers are out to lunch does
   not see any ghost effect on the tower's Pop or on rooms built on that
   floor next.
5. The tower's `Pop` HUD number is unchanged relative to the shipped
   behavior. (PR B changes this number.)
6. `collectTrafficIncome` returns exactly the same values before and after.
7. On a heavy weekday-lunch sim, `Crowd.people.length` never exceeds
   `MAX_PEOPLE = 140`.

## 8. Development note on the abstraction

**"u.occupants stays canonical; outForMeal is the overlay. Two fields; one
truth per view."** The renderer, the sprite cache, and the (future PR B)
`livePopulation` census all read the derived
`visibleOccupants(u) = max(0, u.occupants - u.outForMeal)`. `updatePresence`
continues to overwrite `u.occupants` hourly with the expected staff count;
this PR does not touch that logic. The two fields cohabit cleanly because
`u.occupants` is the *baseline* (what should be here at this hour) and
`outForMeal` is the *dip* (who is currently out to lunch).
