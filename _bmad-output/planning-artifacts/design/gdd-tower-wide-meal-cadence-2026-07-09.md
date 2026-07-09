---
title: "Game Design: Tower-Wide Meal Cadence"
game: Verticopolis (browser SimTower clone)
author: Samus Aran (Game Design, gds agent), with the meal-cadence party
date: 2026-07-09
status: Spec, approved for implementation
scope: Turn every meal window (breakfast, lunch, dinner, late-night) into real
  transport pressure by sending every eating population (office workers, condo
  residents, hotel guests, on-shift staff) to open food venues and back. Purely
  a parity/pulse fix; no economy changes, no new venue kinds, no per-person
  tracking, no save fields, no mode gate.
grounds:
  - src/engine/Crowd.ts (spawnFloors, spawnTrips, MAX_PEOPLE, isVenue predicate)
  - src/engine/facilities.ts (isOpenAt, residentCount, HK_SHIFT_START/END proxies)
  - src/engine/EconomySystem.ts (HK_SHIFT_START, HK_SHIFT_END, trafficAppeal)
  - src/engine/timePacing.ts (existing lunch clock-crawl)
  - src/engine/Simulation.ts (spatialCongestionByFloor, updateSatisfaction erosion)
  - arch-tower-wide-meal-cadence-2026-07-09.md (the engine design)
---

# Game Design: Tower-Wide Meal Cadence

## 0. The one-paragraph pitch

Today the "Lunch rush" bulletin fires at noon, the clock crawls through the
half-hour, and food venues earn a 1.15x appeal bump. What does not happen:
**anyone actually goes to lunch.** The crowd model is lobby-centric and one-way,
so an office worker sitting at their desk at 12:00 never boards an elevator to
grab a sandwich. This change turns every meal window into real transport
pressure by sending the tower's live population (office workers, condo
residents, hotel guests, and on-shift staff) to open food venues, and releases
them back. The economic outputs do not move; the **shafts feel the crowd** now,
so a tower under-elevatored for a lunch peak actually loses satisfaction points
during the peak, exactly as the 1994 original intended.

## 1. Why this is a parity feature, not a cosmetic one

The 1994 game's biggest transport-planning pain point was not the morning
commute or the evening exodus, both of which our crowd model already runs. It
was the **lunch crunch**: office workers streaming out of every floor, filling
elevators to fast food and restaurants, coming back an hour later. A player who
built shafts sized only for the morning rush would watch their star rating
drop through lunch, then wonder why. The current bulletin says a rush is on,
but the shafts are quiet: our lunch is a lie.

The fix is broader than lunch. Hotels need breakfast service, condos and hotels
have late-night snackers, offices sometimes work through dinner, and every
staff kind on shift is a mouth in the tower. Four windows, uniform mechanic,
one crowd feature. It also composes for free with the machinery we already
have: `spatialCongestionByFloor` reads live crowd density, `updateSatisfaction`
already applies erosion when floors are crowded, so meal-time density is real
crowd density and the puzzle stress lands on the player without touching either
system.

## 2. The design pillar this serves

**"Transport is the puzzle."** Every gameplay decision that stresses shafts,
stairs, or the two-ride reachability rule reinforces the pillar that made
SimTower's tower-building a real design problem. Meal cadence is the pillar
made felt at midday, evening, breakfast, and late-night.

## 3. What the player experiences

### The four meal windows

| Window | Hours | Who eats there | Venues open |
|---|---|---|---|
| **Breakfast** | 6-9 | hotel guests (dominant), condo residents, on-shift staff | fastFood only |
| **Lunch** | 11-14 | office workers (weekday, dominant), condo residents, hotel guests, on-shift staff | fastFood + restaurant |
| **Dinner** | 17-20 | office workers (weekday, late), condo residents, hotel guests, on-shift staff | fastFood + restaurant |
| **Late-night** | 21-24 | hotel guests, condo residents | fastFood (until 22 close), cinema (until 24) |

Meal windows are calendar-independent: 12:00 is 12:00 in Classic and in Modern.
Weekday-only origins (offices) automatically drop on weekends because the
existing `clock.isWeekend` gate already zeros office occupancy.

### What each population contributes

- **Office workers** drive the biggest weekday lunch peak, plus a smaller
  weekday dinner tail. Meal-trip weight scales with `residentCount` of each
  occupied office floor.
- **Condo residents** contribute at a **0.3x weight**: most residents cook at
  home, but a real fraction eats out for every meal. A 200-unit condo tower
  produces recognizable midday and evening traffic without dominating the flow.
- **Hotel guests** eat all four meals. Breakfast is theirs. Meal-trip weight
  scales with occupied guest count on each hotel floor.
- **On-shift staff** eat too. Security is 24-hour, so security floors are
  always eligible. Housekeeping, medical, and recycling are shift-gated on the
  same constants their service dispatch already uses; off-shift, a staff floor
  contributes zero meal trips.

### Cinema is not a meal venue

Cinema is a nightlife destination, not a food destination. Movie patrons form
their own late-night flow (already in the crowd model as `venue -> lobby` at
night). Cinema stays out of the meal-venue set even though it stays open past
fastFood's close time.

### Return trips

The current crowd model is one-way: a person walks to their destination floor
and despawns. Meal cadence keeps that abstraction and treats each meal window
as **two symmetric flows**: an outbound `origin -> venue` flow that peaks near
the middle of the window, and a lagged `venue -> origin` flow that peaks near
the tail. Over the full window the aggregate outbound approximately equals the
aggregate return, so the crowd density in the shafts reflects a real round
trip without tracking any individual.

### Player-facing chrome

- **Info-log bulletins** for breakfast, dinner, and (existing) lunch: one line
  per meal per day, silent below a tenant-count floor so a 1-star tower does
  not spam. No toasts, no new UI channels.
- **timePacing** already has a lunch clock-crawl. Add a dinner clock-crawl if
  the file does not have one, so the dinner peak reads as visibly slow like
  lunch. Breakfast and late-night stay uncrawled.

## 4. The economy contract (unchanged)

`collectTrafficIncome` already models demand volume through per-kind appeal
factors: lunch appeal is 1.15, rain drops appeal, etc. The meal cadence does
not touch any of those. Its whole mechanical value is **transport stress**, not
income: the elevator load during a meal peak becomes real, and an
under-elevatored tower sees `spatialCongestionByFloor` spike, which triggers
the existing satisfaction erosion. Money-per-in-game-day does not move.

Explicit rules:
- `dailyTrafficIncome[kind]` constants are unchanged.
- `trafficAppeal` returns unchanged.
- No new economy ledger category, no new income line, no new expense line.
- No new venue kinds.

This is a re-timing of transport pressure, not a new economic system.

## 5. Explicitly out of scope

- **No new venue kinds.** Fast food, restaurant, cinema, party hall are all we
  have; that is what meals draw against.
- **No per-person tracking.** Meal trips are aggregate flow, same abstraction
  as the existing morning and evening commutes.
- **No new save fields.** Meal state is derived from `clock.hour`; a save
  reloaded mid-lunch resumes at the correct meal-window mix on the next tick.
- **No new toast tiers or bulletin channels.** Info-log only, following the
  existing lunch pattern.
- **No mode gate.** Both Classic and Modern get the meal cadence; the pulse is
  the 1994 pulse.
- **No new economy constants beyond the meal-population weights.** The
  condo-eats-out fraction (0.3) is the one new value; it lives on `ECON` as a
  named constant so it is tunable and searchable.

## 6. Risks the design accepts

1. **Crowd saturation.** Meal trips could crowd out existing morning/evening
   patterns and starve them. Guarded by `Crowd.spawnTrips`'s weighted-option
   model plus the `MAX_PEOPLE` cap; the arch doc pins the weight math so peak
   minute crowd stays under the cap.
2. **Congestion-erosion overshoot.** With meal peaks stressing shafts, the
   existing satisfaction-erosion loop could over-punish under-elevatored
   towers. Guarded by not touching `NOISE_EROSION` or `updateSatisfaction`;
   the shipped curves absorb the new pressure. Playtest and re-tune only if a
   healthy tower starts bleeding through the peaks.
3. **Staff shift drift.** If a future shift-constant change is not propagated
   to the meal-eligibility gate, staff meals silently orphan. Guarded by
   reading the shift constants from a single source; the arch doc documents
   the coupling.
4. **Weekend correctness.** Office lunch and dinner must fire zero trips on
   weekends. Guarded by the existing `clock.isWeekend` gate that already zeros
   office occupancy; the meal flow inherits it.
5. **Two-ride cap edge.** A floor 3+ rides from any open venue draws no meal
   trips. This is correct behavior (the same rule that governs commercial
   income today) but might surprise a player who built a tall isolated floor.
   The existing "no visitors will come" advisory already covers the case.

## 7. Acceptance (player-facing)

1. During a meal window, crowd stats show a measurable rise in `origin -> venue`
   trips for every eligible population type, and in `venue -> origin` return
   trips lagging behind them.
2. Outside every meal window (hours not in [6-9, 11-14, 17-20, 21-24]) zero
   meal-typed trips are spawned.
3. A peak-lunch simulation on a large mixed tower stays under `MAX_PEOPLE`; no
   backlog, no stall.
4. A weekend lunch on the same tower shows zero office-origin trips (condo,
   hotel, and weekend staff still eat).
5. A housekeeping-only fixture at 18:00 (past shift end) fires zero
   staff-origin meal trips.
6. `collectTrafficIncome` returns exactly the same values on a fixed-clock
   fixture before and after the change (income invariance).
7. Breakfast, lunch, and dinner bulletins fire once per meal per day and stay
   silent below the tenant-count floor.
8. An under-elevatored tower's satisfaction visibly dips through a lunch peak
   and recovers after; the same tower with adequate shafts stays flat. This is
   the mechanical proof that the pulse is felt.

## 8. Development note on the crowd abstraction

**"The lie is only visible if we claim otherwise; we will not."** Persons are
one-way and despawn on arrival; a meal outbound and its lagged return are two
independent spawns, not the same person round-tripping. That is the same
aggregate-flow abstraction the morning commute has always used. The player
sees correct crowd density in the shafts over the window; nothing in the UI or
docs will claim we simulate the individual.
