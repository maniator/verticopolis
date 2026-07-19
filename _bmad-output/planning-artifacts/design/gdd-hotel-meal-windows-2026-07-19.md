# GDD: Hotel meal-window origins (#304)

Story: `per-person-meal-round-trips` remainder (the hotel meal-window gate).
Author: session of 2026-07-19 (Architect + Designer + Dev party).
Status: spec drafted. Classic needs no engine change (it is already faithful);
Modern adds one bounded, mode-gated feature.

This planning doc (Phase 0) lands under `/bmad-code-review`. The engine build
(Phase 1) lands as its own PR under `/gds-code-review` with the four quality
gates and a version bump when player-facing.

## 1. Why this exists (and the parity finding that reframed it)

Issue #304 reads: hotels contribute zero lunch trips and few dinner trips even
though `MEAL_MIX` declares them for those windows, so "broaden the gate so
mealtime hotel origins exist." Taken literally, that is a request to make hotels
generate lunch traffic.

Researching the 1994 original (the project's single source of truth) shows that
literal reading is a **parity break**, not a fix:

- Hotel guests **sign in from 5 PM to midnight** and **check out through the
  morning**; housekeeping cleans rooms **noon to 5 PM**. So a guest is present
  in the tower **evening through morning** and **absent at midday**.
- Restaurants in 1994 **open at 5 PM** (Verticopolis already diverges by opening
  them for lunch too, via `isOpenAt` in `src/engine/facilityPredicates.ts`, a
  pre-existing intentional choice for office-worker lunch trade).

So in the original a hotel guest **is not in the tower at lunch**. Manufacturing
a lunch hotel diner would invent a Sim who does not exist in canon. The current
"zero hotel lunch trips" is therefore **canon-correct for Classic**, not a bug.

Sources: [GameFAQs SimTower FAQ](https://gamefaqs.gamespot.com/pc/565191-simtower/faqs/6905),
[SimTower Wiki "Hotel"](https://simtower.fandom.com/wiki/Hotel),
[Relentless Optimizer SimTower Reference](https://relentlessoptimizer.com/gaming/2021/03/13/simtower-reference/).

## 2. Current mechanics (as built on main)

- **Hotel occupancy cycle** (three files): evening move-in is in
  `src/engine/sim/churn.ts`, where a clean, reachable hotel room fills only in the
  evening (`clock.isEvening()`, `[17, 21)` per `Clock.isEvening`) with a
  `0.5 * demand` chance per hour, and on fill sets `state = "asleep"` and
  `everOccupied = true`. Morning checkout (`asleep` to `dirty`) is in
  `EconomySystem.hotelCheckout()` (driven from `sim/loop.ts`); the cleaning
  turnover that clears `dirty` back toward `empty` through the day shift is in
  `src/engine/economy/housekeeping.ts`.
- **Meal-origin binning** (`src/engine/crowd/spawn.ts`): `spawnFloors` walks the
  units behind the gate `isTenanted(u) || u.state === "asleep"`. A hotel room is
  never `isTenanted` (that is the leased/occupied state for offices and condos),
  so it enters the `hotelFloors` bin **only while `asleep`**.
- **Meal windows** (`src/engine/crowd/meals.ts`): breakfast `[6, 9)` (fast
  food), lunch `[11, 14)` (fast food, restaurant), dinner `[17, 20)` (fast food,
  restaurant), plus a late-night window. Ranges are end-exclusive throughout this
  doc (matching the code's `hour >= start && hour < end`), so `[6, 9)` covers
  hours 6, 7, and 8. `MEAL_MIX` lists `hotel` as a declared origin for breakfast,
  lunch, dinner, and late-night.
- **Outbound clustering** (`meals.ts` outbound weight): meal-trip departures
  cluster in the first ~60% of each window and hit zero at `t = 0.6`.

The net effect, per window:

| Window | Room state at that hour | Hotel origin today |
| --- | --- | --- |
| Breakfast `[6, 9)` | still `asleep` (checkout is gradual through the morning) | contributes, correct |
| Lunch `[11, 14)` | `dirty` or `empty` (guest checked out, being cleaned) | **zero**, canon-correct |
| Dinner `[17, 20)` | filling to `asleep` through the evening | contributes, ramps up |
| Late night | `asleep` | contributes |

## 3. The Classic decision (faithful to 1994)

Classic keeps the current behavior, which is already faithful:

- **Lunch stays exactly zero.** Guests are gone at midday in the original.
- **Breakfast and dinner keep drawing `asleep` (present) guests.** A guest who
  checks in becomes `asleep` immediately (`churn.ts`), and the evening window
  `[17, 21)` overlaps the dinner window, so arriving guests are counted as they
  fill. The mild "outbound clusters early, occupancy fills late" interaction is a
  realistic characteristic of guests arriving through the evening, and changing it
  would move the golden master, so Classic leaves it untouched in this work.
- **`MEAL_MIX` keeps `hotel` under lunch.** It is a no-op in Classic (the lunch
  `hotelFloors` bin is empty because no room is `asleep` at midday, and the
  origin push already requires a non-empty floor list AND a positive weight), and
  Modern needs the declaration for the day-use feature below. Removing it would
  have to be re-added for Modern, so it stays.

**Guardrail:** the Classic path is byte-identical at lunch (zero hotel trips),
and a Classic reference tower's golden-master income hash must not move.

## 4. The Modern decision (party's call, "what the original couldn't do")

Modern adds a small, bounded daytime hotel presence: some rooms occupied last
night hold a late-checkout or day-use guest who is still around at lunch and
takes a meal trip. This is the genuine new value: a big hotel tower gets a lunch
murmur a pure office tower does not, which rewards a mixed-use placement.

- **New rule seam:** `GameRules.hotelDaytimePresence(): number` returns the
  fraction of last-night-occupied hotel rooms still present during the daytime
  meal windows. **Classic returns 0** (hard zero, short-circuits before any work,
  so the Classic stream is byte-identical). Modern returns a small bounded
  fraction, provisional **0.2**, pending a calibration pass.
- **Meal-traffic only, never a second census.** A day-use guest generates a lunch
  meal trip; it must not add to `population`, the rating census, or star math
  (`u.occupants` and the census fields are untouched, exactly as the shipped
  per-person-meal model keeps the visible-occupancy dip off the census).
- **Deterministic, no RNG.** The daytime-present count is
  `Math.round(hotelDaytimePresence() * roomsOccupiedLastNight)` (JavaScript
  `Math.round`, ties toward positive infinity), seeded into the lunch hotel origin
  with no draw against the seeded economy or spawn stream, matching how
  `computeDemandMap` stays pure.

### Model, and a finding from a first implementation pass

Let `p = GameRules.hotelDaytimePresence()`.

The first cut tried the obvious thing: at the lunch window, seed the `hotel`
meal origin from last-night rooms (state `dirty` or `asleep`, `everOccupied`),
weighted `ECON.mealPopulationWeights.hotel * p`. Building that against the code
surfaced a flaw the design missed:

> **A meal round-trip only spawns from a unit with `visibleOccupants > 0`**
> (`spawnMealOutbound`, confirmed by `mealCadence.integration.test.ts`:
> "round-trippers only spawn from units with `visibleOccupants > 0`"). A `dirty`
> checked-out room has **zero** occupants, so seeding the origin from dirty rooms
> spawns nothing. The lunch guest has to actually be present to send them out.

So the daytime lunch trip needs a real occupant at lunch, which forces a choice
the party's "meal traffic only, never a census count" guardrail does not resolve
on its own. Two models, to decide before Phase 1 builds:

- **Model A, late checkout (recommended).** In Modern, defer checkout for a
  fraction `p` of last-night rooms: they stay `asleep` (occupied, present)
  through the lunch window, then check out in the early afternoon. Lunch trips
  then spawn through the **existing** `hotelFloors` path with no `spawn.ts`
  change. This is realistic (the guest is genuinely still there) and is **not a
  double count**: it is the same one guest counted for a slightly longer, real
  stay, not an extra body. It does raise a Modern hotel tower's midday population
  and housekeeping timing a little (rooms are cleaned later). Classic `p = 0`,
  all rooms check out in the morning as today, byte-identical. The change lives
  at the checkout stage (the morning `asleep` to `dirty` transition), not in the
  spawn bins.
- **Model B, phantom day-use.** Keep the census untouched by spawning a lunch
  hotel meal-goer through a dedicated path that does not dip a persistent room's
  occupancy. Honors the guardrail literally, but needs new spawn machinery (a
  day-use origin that emits and returns without a backing occupied room), which
  is more surface and a second, parallel spawn concept.

Recommendation: **Model A**. It reuses the shipped path, reads as the real
mechanic (a late-checkout guest who is actually in the building at noon), and its
only cost is a modest, defensible Modern midday population lift, which is arguably
the feature, not a leak. Model A does bend the party's original "never touch the
census" line, so it needs an explicit owner or party sign-off before Phase 1.

In both models: Classic is `p = 0` and byte-identical, the Classic golden master
is the tripwire, and the effect is bounded above by the real last-night room
count (an empty hotel contributes nothing).

## 5. Phasing

- **Phase 0 (this doc):** GDD plus the backlog row update. Docs only,
  `/bmad-code-review` lane.
- **Design gate (blocks Phase 1):** pick Model A (late checkout, recommended) or
  Model B (phantom day-use). Model A needs an owner/party sign-off on the modest
  Modern midday-population lift, because it bends the "never touch the census"
  guardrail (for the same guest, not a double count).
- **Phase 1 (Modern feature):** implement the chosen model behind
  `GameRules.hotelDaytimePresence()` (0 Classic, provisional 0.2 Modern), with the
  Classic golden master as the tripwire; version bump (Modern player-facing).
  `/gds-code-review`.

There is no Classic engine change: Classic is already faithful. The only Classic
artifact is this document recording why the issue's literal ask was declined. A
first Phase 1 implementation pass was written and reverted once it surfaced the
`visibleOccupants > 0` finding above, so Phase 1 restarts from the chosen model.

## 6. Tests

- **Classic lunch is exactly zero.** A Classic tower with a full, reachable hotel
  and an open lunch restaurant produces zero hotel-origin lunch trips (the guest
  is gone). Assert the meal-origin pool has no hotel entry at a lunch hour.
- **Classic golden master unmoved.** The Classic reference-tower income hash does
  not change (Phase 1 touches only a mode-gated seam that returns 0 in Classic).
- **Classic dinner still draws arriving guests.** A Classic hotel filled through
  the evening contributes hotel-origin dinner trips (regression guard that the
  existing faithful behavior is preserved).
- **Modern lunch draws a bounded fraction.** A Modern tower with N rooms occupied
  last night seeds a lunch hotel origin sized to `Math.round(0.2 * N)`, and never
  more than N; an empty-hotel Modern tower contributes zero.
- **No census leak.** The Modern day-use trip does not change `population`, the
  rating census, or the star gate (the room's `occupants` and census fields are
  untouched by the lunch seeding).

## 7. Risks and non-goals

- **Golden-master drift (risk):** the whole design hinges on Classic staying at 0.
  The `hotelDaytimePresence() <= 0` short-circuit runs before any bin is built, so
  no Classic RNG or income path changes. The Classic golden hash is the tripwire.
- **Not cloning restaurant hours to 1994 (non-goal):** Verticopolis already serves
  lunch at restaurants by prior choice; this work does not revisit that.
- **Not a second population (non-goal):** a day-use guest is meal traffic only, it
  never counts twice toward population or stars.
- **Not touching breakfast or dinner (non-goal):** those windows are already
  faithful; this work is limited to the Modern lunch day-use origin.
