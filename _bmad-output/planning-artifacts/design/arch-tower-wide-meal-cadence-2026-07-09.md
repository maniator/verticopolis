---
title: "Technical Design: Tower-Wide Meal Cadence"
game: Verticopolis (browser SimTower clone)
author: Cloud Dragonborn (Game Architect, gds agent), with the meal-cadence party
date: 2026-07-09
status: Spec, approved for implementation
scope: The engine implementation of the four-window meal cadence: how the
  spawn-floor bins grow, how the trip options are weighted per window and per
  population, how staff on-shift eligibility is gated, how return trips lag the
  outbound peak, and the load-bearing invariants that keep the economy
  untouched and the crowd cap safe.
grounds:
  - gdd-tower-wide-meal-cadence-2026-07-09.md (the player-facing contract)
  - src/engine/Crowd.ts (spawnFloors, spawnTrips, MAX_PEOPLE = 140, isVenue predicate)
  - src/engine/facilities.ts (isOpenAt for venue open hours, residentCount)
  - src/engine/EconomySystem.ts (HK_SHIFT_START = 8, HK_SHIFT_END = 19)
  - src/engine/timePacing.ts (existing 12:00-12:30 lunch crawl, no dinner crawl yet)
  - src/engine/Clock.ts (hour, isWeekend, isLunch already exists as 11-14)
---

# Technical Design: Tower-Wide Meal Cadence

## 0. LOAD-BEARING INVARIANTS: read before touching this mechanic

> If you change anything here, re-run `crowd.test.ts` and the new
> `mealCadence.test.ts`; they are the guards that meal cadence keeps
> `collectTrafficIncome` byte-identical, does not exceed `MAX_PEOPLE`, and
> respects the weekend and shift gates.

1. **Economy is not touched.** `EconomySystem.collectTrafficIncome`,
   `trafficAppeal`, and every `dailyTrafficIncome[kind]` constant stay
   untouched. Meal cadence changes crowd density in the shafts, not the money
   ledger. If a test ever asserts an income delta as a side effect of a meal
   flow, the change is wrong; the flow is correct only when income is
   byte-identical.

2. **`MAX_PEOPLE` is the ceiling.** Meal trips are added to the same weighted
   `options` array `spawnTrips` already uses; `rng.pick` fires one option per
   call; `spawnTrips` returns early when `people.length >= MAX_PEOPLE`. The cap
   self-balances the pool. Do not raise `MAX_PEOPLE` to accommodate meals; if a
   healthy tower saturates the pool, tune the meal weights down.

3. **The meal-window definitions live in one place.** Meal window boundaries
   (breakfast 6-9, lunch 11-14, dinner 17-20, late-night 21-24) live as named
   constants at the top of `Crowd.ts`. Do not re-derive them from `clock.hour`
   comparisons scattered through the file. `clock.isLunch()` (11-14) already
   exists on `Clock` and the meal-cadence code MUST match that window
   byte-for-byte so the lunch clock-crawl in `timePacing.ts` and the crowd
   trips fire on identical hours.

4. **Staff on-shift eligibility is single-sourced.** Housekeeping is on-shift
   `[HK_SHIFT_START, HK_SHIFT_END)` (currently `[8, 19)`) and NO OTHER staff
   kind has a modeled shift window today. Security, medical, and recycling are
   always eligible while their facility exists and is operational. Do NOT
   introduce shift windows for staff kinds that do not have them in
   `EconomySystem`; a future shift addition adds the constant AND updates this
   gate together.

5. **Weekend correctness comes for free.** Office-origin meal trips already
   inherit weekend behavior because `staffedOffices` bin is fed from
   `u.occupants > 0`, and `updatePresence` zeros office occupants on weekends
   and after 18:00. Meal cadence reads `staffedOffices`; no explicit
   `clock.isWeekend` check is needed for offices. Do not add one; a redundant
   check drifts on weekend redefinition.

6. **The return flow is aggregate, not per-person.** A person spawned on an
   outbound `origin -> venue` trip despawns at the venue; a separate,
   independently-spawned `venue -> origin` trip fires with a lagged weight.
   Over a full window the two flows aggregate approximately equal. Do not add
   any per-person tracking to enforce round-trip identity; that breaks the
   entire aggregate-flow abstraction the crowd model is built on.

## 1. The four-window model

Named constants at the top of `Crowd.ts`:

```
const MEAL_WINDOWS = {
  breakfast: { start: 6, end: 9,  venues: ["fastFood"] },
  lunch:     { start: 11, end: 14, venues: ["fastFood", "restaurant"] },
  dinner:    { start: 17, end: 20, venues: ["fastFood", "restaurant"] },
  lateNight: { start: 21, end: 24, venues: ["fastFood", "cinema"] },
} as const;
type MealWindow = keyof typeof MEAL_WINDOWS;

function mealWindowFor(hour: number): MealWindow | null { ... }
```

`mealWindowFor(hour)` returns the current window key or `null` (off-window).
`spawnTrips` calls it once per invocation and either short-circuits (no meal
options added) or picks the origin/venue set to expand.

**Lunch window matches `Clock.isLunch()` exactly** (`hour >= 11 && hour < 14`).
The two definitions are the same window; refactoring them to share a source
constant is a follow-up if it becomes worth the churn.

## 2. Eating-population bins

`spawnFloors` grows a new bin per eating population beyond the current three
(`leasedOffices`, `staffedOffices`, `homes`, `openVenues`):

- `officeFloors: number[]` (weekday-only, populated only when `staffedOffices`
  is non-empty; this is really an alias for `staffedOffices` in meal context).
- `condoFloors: number[]` (all floors with an occupied condo).
- `hotelFloors: number[]` (all floors with an occupied hotel unit, any kind).
- `staffFloors: { kind: StaffKind; floor: number }[]` (all floors with an
  operational staff facility, tagged so shift-eligibility is per-floor).

`homes` today lumps condos and hotels together; meal cadence needs them
separated because breakfast draws heavily from hotels and lightly from condos.
`homes` stays as-is for the existing morning/evening flow (so those flows do
not regress); `condoFloors` and `hotelFloors` are additional bins used only by
the meal path.

## 3. Meal-population weights

Named constants (on `ECON` for tunability and searchability):

```
mealPopulationWeights: {
  office: 1.0,
  condo:  0.3,       // most residents cook at home
  hotel:  1.0,
  staff:  1.0,
}
```

The condo 0.3 is the single new tuning number the party landed on: a real
fraction of residents eats out, most do not. Every other weight is a straight 1
so the code can be uniform.

## 4. Per-window origin+venue matrix (implemented as a table, not branches)

`spawnTrips` reads a static table keyed by meal window, listing which
population bins contribute and which venue kinds are open:

```
const MEAL_MIX: Record<MealWindow, {
  origins: {kind: "office"|"condo"|"hotel"|"staff"; weight: number}[];
  venueKinds: FacilityKind[];
}> = {
  breakfast: { origins: [
    {kind:"hotel",  weight: mealPopulationWeights.hotel},
    {kind:"condo",  weight: mealPopulationWeights.condo},
    {kind:"staff",  weight: mealPopulationWeights.staff},
  ], venueKinds: MEAL_WINDOWS.breakfast.venues },

  lunch:     { origins: [
    {kind:"office", weight: mealPopulationWeights.office},
    {kind:"condo",  weight: mealPopulationWeights.condo},
    {kind:"hotel",  weight: mealPopulationWeights.hotel},
    {kind:"staff",  weight: mealPopulationWeights.staff},
  ], venueKinds: MEAL_WINDOWS.lunch.venues },

  dinner:    { origins: [
    {kind:"office", weight: mealPopulationWeights.office},
    {kind:"condo",  weight: mealPopulationWeights.condo},
    {kind:"hotel",  weight: mealPopulationWeights.hotel},
    {kind:"staff",  weight: mealPopulationWeights.staff},
  ], venueKinds: MEAL_WINDOWS.dinner.venues },

  lateNight: { origins: [
    {kind:"hotel", weight: mealPopulationWeights.hotel},
    {kind:"condo", weight: mealPopulationWeights.condo},
  ], venueKinds: MEAL_WINDOWS.lateNight.venues },
};
```

The table is authoritative; no per-window if/else in `spawnTrips`. Adding a
future meal window means one row.

## 5. Staff on-shift gate

A tiny helper, single-sourced against `EconomySystem`:

```
function staffOnShift(kind: StaffKind, hour: number): boolean {
  if (kind === "housekeeping") return hour >= HK_SHIFT_START && hour < HK_SHIFT_END;
  return true; // security, medical, recycling: always eligible while operational
}
```

`spawnFloors` filters `staffFloors` through `staffOnShift` before the meal
window reads them. When (if) a future kind gains a shift window, add the case
here alongside the new constants; there is exactly one gate in the code.

## 6. Outbound vs return trip lag

Each meal window contributes TWO option builders per origin bin:

- Outbound `origin -> openVenue`, weighted by the origin's mealPopulationWeight
  times the number of eligible floors in that bin.
- Return `openVenue -> origin`, weighted the same but with a **phase profile**
  that peaks after the outbound.

The phase profile is a piecewise-linear function of `(hour - windowStart) /
(windowEnd - windowStart)`:

```
outboundWeight(t) = clamp(2 * (0.6 - t), 0, 1)   // heavier in first ~60% of window
returnWeight(t)   = clamp(2 * (t - 0.4), 0, 1)   // heavier in last ~60% of window
```

The two profiles overlap in the middle third of the window (both nonzero),
which reads as a natural crossover: some late arrivals overlap with early
returns. Over the full window the integrals of the two profiles are equal, so
aggregate outbound and aggregate return are the same in expectation.

## 7. Bulletins (info-log)

New emit points at the START of each meal window (mirroring the existing lunch
bulletin at the top of hour 12):

```
if (h === 6  && this.dayTagsRunOnce("breakfastRush"))
    this.sim.emit("🌅 Breakfast rush! Guests head down for the buffet.", "info");
if (h === 17 && this.dayTagsRunOnce("dinnerRush"))
    this.sim.emit("🍽 Dinner rush! Elevators fill for the evening service.", "info");
```

The `dayTagsRunOnce` idiom is the same one the lunch bulletin uses to fire
once per day. Bulletins are gated by a tenant-count floor (min 30 occupied
tenants, tuned in the code) so a 1-star tower does not spam.

## 8. Dinner clock-crawl

`timePacing.ts` currently has a lunch crawl (12:00-12:30, frames 400-800 spent
on 30 minutes). It has NO dinner crawl; the 17:00-21:00 slot runs at normal
rate (frames 1600-2000 = 400 frames for 240 minutes = 0.6 min/frame).

Add a dinner crawl by splitting the 17:00-21:00 slot into three, preserving
the block's ORIGINAL 400-frame budget (not the 1000-frame figure an earlier
draft of this section listed by mistake, which would have blown the day's
2600-frame total by 600 frames):

- 17:00-18:00: 120 frames for 60 min (0.50 min/frame, dinner lead-in)
- 18:00-18:30: 160 frames for 30 min (0.19 min/frame, the dinner crawl)
- 18:30-21:00: 120 frames for 150 min (1.25 min/frame, post-dinner)

Total for the four-hour block: 120 + 160 + 120 = 400 frames for 240 min,
matching the shipped block exactly. The day's 2600-frame total is preserved.
The dinner crawl reads visibly slower than surrounding periods (about 2.6x
slower than the lead-in) but is not as extreme as the noon crawl (13.3x slower
than the surrounding rate) because the 400-frame budget cannot support both a
noon-strength crawl and a full 3-hour post-crawl period at neutral rate.

## 9. Ledger + save/load

Meal state is entirely a function of `clock.hour` (plus `clock.isWeekend` for
office origins). Nothing meal-related is persisted. A save reloaded mid-lunch
resumes at the correct meal-window mix on the next tick because
`mealWindowFor(this.clock.hour)` is a pure function of the restored clock.

No `SAVE_VERSION` bump. No new save fields.

## 10. Test plan

`src/tests/mealCadence.test.ts` (new):

1. **Windows are respected.** For each hour in `[0..23]`, `mealWindowFor(hour)`
   returns the expected key or `null`. Table-driven.
2. **Off-window fires zero meal trips.** Set clock to hour 3, tick, assert
   crowd count of meal-origin trips is 0.
3. **Lunch window fires office-origin trips on weekdays.** Set clock to
   weekday 12:00, tick many times, assert a measurable count of
   office-to-fastFood-or-restaurant trips.
4. **Weekend lunch fires zero office trips.** Same fixture but weekend day;
   office trips count = 0; condo/hotel trips still fire.
5. **Housekeeping shift gate.** Force a housekeeping-only staff floor. At
   hour 12 (in shift), it contributes staff trips; at hour 21 (past shift),
   it contributes zero.
6. **Security is 24-hour.** Force a security-only staff floor. At hour 3, at
   hour 12, at hour 21, all contribute staff trips (security is always
   eligible).
7. **Cap safety.** Populate a saturating tower and simulate a full lunch
   window; assert `crowd.people.length` never exceeds `MAX_PEOPLE`.
8. **Return trips lag outbound.** Over a full lunch window, count trips
   spawned in the first half vs the second half; outbound is heavier in the
   first half, return is heavier in the second (within RNG noise on a
   deterministic seed).
9. **Income invariance.** Fixed-clock fixture with an office and a fastFood;
   `collectTrafficIncome` returns the exact same amount before and after the
   change. This is the load-bearing economy guard.
10. **Bulletin cadence.** Breakfast/dinner bulletins fire once per meal per
    day; silent when tenant count is below the floor; do not fire during
    other windows.

Existing tests:
- `crowd.test.ts` must still pass unchanged (existing morning/evening/night
  flow is not touched).
- `subsystems.test.ts` `collectTrafficIncome` tests must still pass byte-
  identically (economy invariant).
- `parity.test.ts` (the TOWER run) and `phase2.test.ts` (the well-zoned
  endgame): a healthy tower does not bleed through the meal peaks.

## 11. File-touch summary

- `src/engine/Crowd.ts`: `MEAL_WINDOWS` + `MEAL_MIX` constants,
  `mealWindowFor(hour)` helper, `staffOnShift(kind, hour)` helper, expanded
  `spawnFloors` with `condoFloors`/`hotelFloors`/`staffFloors`, expanded
  `spawnTrips` with the meal-option builders reading `MEAL_MIX`.
- `src/engine/econConfig.ts`: `mealPopulationWeights` table on `ECON`.
- `src/engine/timePacing.ts`: split the 17:00-21:00 period into three to add
  the dinner crawl at 18:00-18:30.
- `src/main.ts`: extend the existing `emitLunchRush` sibling to `emitBreakfastRush`
  and `emitDinnerRush` following the same `lastLunchDay`/day-boundary idiom,
  OR fold all three into one `emitMealRush(kind)` function; either keeps the
  bulletin logic in one place. Prefer the folded version.
- `src/tests/mealCadence.test.ts`: the ten tests above.
- `PARITY.md`: add a bullet under Population/Time: "**Meal cadence.** All four
  daily meal windows drive real elevator load from every eating population
  (offices, condos, hotels, on-shift staff)."
