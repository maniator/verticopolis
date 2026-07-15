---
title: Venue People Routing (Party Hall, Cinema, Wedding Hall)
game_type: simulation
platforms: browser
created: 2026-07-14
updated: 2026-07-14
---

# Verticopolis Venue People Routing - Game Design Document

**Author:** BMad
**Game Type:** Simulation
**Target Platform(s):** Browser

---

## Executive Summary

### Core Concept

Three venues earn or matter without anyone ever traveling to them. The party
hall collects statistical traffic income while no drawn person ever routes to
it and its two-story room always renders an empty house. The cinema does
receive routed late-night meal customers, but its population-0 catalog entry
pins `occupants` (and the customer tally) to 0, so its auditorium also renders
empty. The wedding hall exists purely as the TOWER win check; canon says
weddings happen there on weekends, yet no guest ever arrives.

This feature routes real people to all three: round-trip attendance visits
whose arrivals and departures drive a live per-venue attendance tally, which
in turn fills the already-shipped interior art honestly. Economy, census, and
the star ladder are untouched; the change makes the shafts feel the demand and
the rooms read true, exactly the philosophy the meal-cadence feature
established.

### Target Audience

Players who build entertainment venues and the floor-100 wedding hall and
expect to see them come alive, and players reading the tower for honest
signals (a busy hall means people actually traveled there).

### Unique Selling Points (USPs)

- The party hall fills with real guests every evening, arriving through real
  elevators.
- The cinema's audience is the set of people who actually rode up for a
  showing, doubled crowds included when a blockbuster is booked.
- Weekend weddings visibly happen at the top of the tower, a canon nod that
  costs nothing mechanically.

### Explicitly Out of Scope (owned elsewhere or deferred)

- **Metro routing: OUT.** Another agent owns metro people routing; nothing in
  this feature touches metro units, metro congestion relief, or metro art.
- Income model changes of any kind (party hall and cinema keep their existing
  statistical traffic income; the wedding hall stays income-free).
- Parking, which is statistical congestion relief by design.
- Advisories or UI for unreachable venues (existing behavior: unreachable
  venues earn nothing and simply receive nobody).

---

## Goals and Context

### Project Goals

- Close the "entertainment honest-attendance" backlog item without a ghost
  crowd: attendance is derived from real routed people, never seeded scatter.
- Give the party hall and wedding hall the routed foot traffic the other
  venues already have, on the existing crowd machinery.
- Keep the rating census, star gates, spatial congestion, and economy
  byte-identical for towers that build none of these venues, and
  census-identical for towers that do.

### Background and Rationale

The crowd system already has everything needed: BFS routing over transports,
a weighted spawn-option pool, and a proven round-trip lifecycle (meal
round-trips: spawn, arrive, dwell, return, with balanced accounting on every
despawn path including give-ups and bulldozes). The gap is coverage: the
venue destination set in `spawnFloors` names only shop, restaurant, fast
food, and cinema, and the arrival-side customer tally is gated on
`population > 0`, which excludes exactly the venues whose art needs it.

Canon (FAQ summary, `faq-canon.md`): the party hall is a 3-star venue where
"hotel guests mingle"; the cathedral (our wedding hall) hosts weddings on
weekends only; a blockbuster film draws a bigger cinema crowd.

---

## Core Gameplay

### Game Pillars

- **Honest rooms:** interior art shows the people who actually traveled
  there. No population-independent ghost crowds, ever (frozen spec rule).
- **Shafts feel demand:** every attendee is a real routed trip placing real
  hall and cab calls; entertainment venues create genuine evening transport
  pressure.
- **Canon parity, zero economy drift:** open hours, weekend weddings, hotel
  guests mingling, and blockbuster crowds match the 1994 read; money, census,
  and stars are unchanged.

### Core Gameplay Loop (delta)

The player builds an entertainment venue, watches guests ride up during its
open hours, sees the house fill and empty, and feels the added elevator load
in the evening. Underserved placement (no route within two rides) yields no
guests and an honest empty house, the same feedback the economy already
gives.

---

## Game Mechanics

### M1: Attendance ledger for population-0 venues

- New catalog field `attendance` on `cinema` (30), `partyHall` (20), and
  `weddingHall` (12): the venue's visible seat capacity for routed
  attendees. Single source of truth in `facilitiesData.ts`, mirroring how
  catalog `population` works.
- `customersIn` becomes the live attendance tally for these kinds too.
  Arrival increments it (rejected once the attendance cap is reached: the
  over-cap arrival attends uncounted, mirroring the existing over-capacity
  meal arrival rule); every despawn path decrements it through the existing
  guarded `venueUnitId` machinery.
- **Census neutrality is an invariant, not an accident.** `censusCount`'s
  gate (`isCommercialKind && population > 0`) is unchanged: cinema keeps
  population 0, party hall and wedding hall are not commercial kinds, so
  attendance never enters `totalPopulation`, the star census, or spatial
  congestion. A regression test pins this.
- `occupants` on these three kinds mirrors the live tally at every tally
  change (and is zeroed alongside it on load, where `customersIn` is already
  stripped as transient). The room bake signature already includes
  `occupants`, so the shipped occupancy-gated art (cinema audience, party
  hall dancers/DJ/banquet, wedding guests) fills with no render changes.
  Hourly presence/traffic passes must not stamp catalog population (0) over
  the mirror while the venue is open; closed or unreachable venues still
  clear to 0 (attendees inside a venue that closes finish their dwell and
  leave; the tally drains through their departures).

### M2: Entertainment attendance visits (cinema + party hall)

- A new spawn-option contributor (same additive pattern as the meal overlay)
  pushes round-trip visit options whenever an operational, tenanted,
  reachable entertainment venue is open (`isOpenAt`: cinema 12:00-24:00,
  party hall 17:00-24:00).
- Origins (the visit-origin matrix; staff kinds are deliberately excluded,
  they are on shift and their sanctioned break is the meal system's job):
  - Outside: street visitors, every venue. Today "outside" resolves to the
    ground lobby (floor 1), the tower's only street door; when the metro
    platform lands as a second street door, the entry point is picked at
    spawn time (recorded as a TODO at the resolution site). These persons
    have no origin unit; their return leg routes back to their spawn floor
    and they despawn there.
  - Condo residents: cinema and party hall. Reuses the meal round-trip
    origin accounting (`originUnitId` + `outForMeal`), so the home visibly
    thins while they are out.
  - Office workers: cinema only, while the office is staffed (presence
    self-gates: weekday working hours), a matinee crowd.
  - Hotel guests: cinema and party hall (canon: "hotel guests mingle" at the
    party hall). Same room accounting as condos.
  - Wedding hall: outside only (invited guests arrive from the street).
- Lifecycle: spawn, route (two-ride rule applies; null route means nobody
  comes), walk to a tile inside the venue footprint, register attendance,
  dwell, return, deregister. Give-ups and mid-dwell bulldozes balance the
  tally through the existing `finish` path.
- Dwell times (in-game minutes, uniform draw, converted through
  `CROWD_SECONDS_PER_MINUTE` like meals): cinema 90-120 (a showing), party
  hall 60-120 (an event).
- Blockbuster crowd: while a cinema is showing a blockbuster, its visit
  option is pushed twice per spawn round instead of once (bigger crowd,
  canon), still bounded by `MAX_PEOPLE` and the attendance cap.
- Cinema leaves the one-way ambient venue pool (`openVenues`) and moves to
  this round-trip flow; shop, restaurant, and fast food keep their existing
  one-way ambient trips plus meal round-trips. The late-night meal window
  keeps cinema as a venue: those meal round-trippers now register attendance
  on arrival like any other visitor (the arrival gate splits: census venues
  keep the catalog-population clamp, attendance venues use the attendance
  cap).

### M3: Weekend wedding (wedding hall)

- On weekend days, between 11:00 and 14:00, an operational and reachable
  wedding hall receives wedding-guest visit options from the ground lobby
  (arrivals stagger naturally through the spawn pool). Attendance cap 12.
- Dwell 120-180 in-game minutes, so the party overlaps into a visible
  congregation and the shipped altar/guest art fills.
- Strictly cosmetic plus transport demand: no income, no census effect, no
  change to the VIP/TOWER win flow. Weekday hours: nobody comes (canon:
  weddings are weekends only).

### Controls and Input

No new input. Existing inspector and stats surfaces are unchanged.

---

## Simulation Specific Design

### Determinism and performance

- All randomness flows through the existing seeded crowd RNG; headless tests
  stay deterministic.
- Spawn-side work rides the existing once-per-outer-step `spawnFloors`
  binning (entertainment floors bin alongside the meal bins); arrival and
  departure tally updates are O(1) per person via `Tower.getUnit`. No new
  per-tick scans, no `.find` inside person loops.
- `MAX_PEOPLE` (140) remains the global bound; attendance caps (30/20/12 per
  venue) self-limit each house well below it.

### Save compatibility

- `customersIn` stays transient (stripped on load, rebuilt by the live
  crowd), unchanged. On load, the `occupants` mirror for the three
  attendance kinds resets to 0 with it, so a save taken mid-party cannot
  reload with a phantom crowd. No save-version bump needed.

---

## Progression and Balance

- No star, income, or unlock changes. The feature's balance surface is
  transport load: evening entertainment trips add elevator calls in exactly
  the hours the venues are open, which is the intended pressure.
- Party hall (16 max per tower) at 20 attendees each cannot flood the crowd:
  the shared spawn pool and `MAX_PEOPLE` bound concurrent trips regardless of
  venue count.

## Level Design Framework

Not applicable (single persistent tower; venue placement rules unchanged).

## Art and Audio Direction (delta)

None. The occupancy-gated interiors shipped in the pixel-art overhaul are the
consumers of this feature; they draw exactly what the attendance mirror
reports. No new sprites, no audio changes.

## Technical Specifications (GDD-level)

- Engine work only, in `src/engine/` (DOM-free): `facilitiesData.ts`,
  `crowd/spawn.ts`, `crowd/motion.ts`, `crowd/person.ts`,
  `EconomySystem.ts` presence seam, load-time coercion.
- Render: zero expected changes (bake signature already keys on
  `occupants`); verify cinema, party hall, and wedding hall interiors gate on
  `occupants` and fill in seed order.
- Tests: Vitest unit + integration, headless, per the shift-left rule; every
  invariant above gets a cheap-tier guard.

## Development Epics

One epic, four stories. Summary here; detail in `epics.md`.

| Story | Scope |
|---|---|
| E1-S1 | Attendance ledger: catalog caps, arrival/departure tally split, occupants mirror, load reset, census-neutrality guards |
| E1-S2 | Entertainment visit flow: lobby-origin round-trips (no-origin return leg), cinema + party hall options, dwell times, blockbuster weighting, cinema out of the one-way pool |
| E1-S3 | Party hall hotel-guest mingling (hotel-origin visits on the meal round-trip accounting) |
| E1-S4 | Weekend wedding visits |

## Success Metrics

- A reachable party hall on a real evening shows nonzero attendance and its
  art draws dancers/banquet guests; the same hall unreachable or closed shows
  zero.
- A cinema during late night shows attendance from meal round-trippers; a
  blockbuster month draws visibly more.
- A weekend midday wedding hall shows guests; weekdays show none.
- `ratingPopulation` and `totalPopulation` for a tower with attendees present
  equal the same tower with attendance forced to zero (census neutrality).

## Assumptions and Dependencies

- [ASSUMPTION] Attendance caps (30/20/12) and dwell windows are design
  numbers chosen for readable houses within `MAX_PEOPLE`; they are not canon
  figures and may be retuned freely.
- [ASSUMPTION] "One wedding per weekend day" is modeled as a weekend midday
  visit window rather than a discrete scheduled event object; the visible
  result (a congregation that gathers and disperses) is the design goal.
- Depends on the shipped occupancy-gated venue interiors (pixel-art overhaul
  E3/E6) and the meal round-trip machinery (PR A).
- Metro routing lands independently; no coordination needed beyond both
  changes touching `crowd/spawn.ts` option pools additively.
