---
title: Modern Rental Living (Studio & Apartment)
game: Verticopolis (browser SimTower homage)
game_type: Simulation-Management (construction & management sim)
author: Samus Shepard (Game Designer), with Winston (architect), Rae (player advocate), and Sally (UX)
platforms: Web (desktop + mobile browser, PWA)
created: 2026-07-23
updated: 2026-07-23
status: Ratified (party 2026-07-23; owner-approved). Ready for architecture.
scope: >
  A Modern-only residential feature. Two new rental facilities, Studio and
  Apartment, add the "landlord" axis to residential: recurring monthly rent plus
  a tenant-retention (churn) game, the counterpart to the condo's one-time sale.
  Cheap net-new depth because it composes two shipped Modern systems, the
  tenant-churn loop and the office's recurring-rent + vacancy + player-set pricing.
  Classic residential stays condo-only, lump-sum, no churn.
companions:
  - epics.md
  - ../../../project-context.md
---

# Modern Rental Living (Studio & Apartment)

> **Pillars this answers to:** *Modern = "what the original couldn't do"* and
> *every Modern build is a real decision, not a reskin.* The 1994 game had one
> way to house people you sell a condo once and forget it. Modern already lets a
> household move on ([[gdd-condo-household-departures]]); this turns residential
> into a business you run: rent that arrives every month only while you keep
> tenants happy. It is the first residential income you have to actively defend.

## Executive Summary

Residential today is a single option, the **condo**: a one-time lump-sum sale,
permanent occupant, no ongoing management. It is capital. Every one of the ten
Modern additions to date is a commercial or venue type; residential has never
grown. **Rental living** adds the missing axis. A **Studio** (early, forgiving)
and an **Apartment** (later, demanding) pay **recurring monthly rent** at a price
the player sets, and a tenant who is left unhappy gives notice and leaves,
turning the unit dark until the tower earns them back. Condo is cash now; rental
is cashflow you protect. Players graduate from flipping condos for capital early
to holding rentals for steady income late.

The feature is deliberately cheap: the **churn loop already ships** in Modern
(the `vacating` unit state with a recorded reason and a reversible departure
notice, `rollCondoRelocations`, `churnMultiplier`, satisfaction erosion), and the
**office already ships** recurring rent, vacancy, and player-set pricing. Rental
living composes those two onto a residential unit; the net-new work is a monthly
rent cadence, a re-lease path, art variants, and legibility.

## Target Platform

Unchanged from the base game: web, desktop and mobile browser, PWA. No new
platform or certification constraint. Renders through the existing Excalibur
canvas; no new rendering system.

## Target Audience

The existing Verticopolis player who has cleared the early game and wants deeper
economic decisions in a Modern tower. Specifically the player who finds the
condo "a vending machine I hit once" and wants residential to stay a live
concern the way offices and hotels already do.

## Goals and Context

- **Give residential a second income shape.** Three income rhythms exist (condo
  lump sum, office quarterly, hotel nightly); residential plays only one note.
  Rent is the missing recurring residential cadence.
- **Introduce retention as a decision.** The condo, once sold, never asks
  anything of the player again. A rental you can lose makes noise, cleanliness,
  and transport matter *monthly*, giving the mid-to-late game a management beat
  it lacks.
- **Stay cheap by composing shipped systems**, per the party's cost read: the
  churn loop and the office rent/vacancy/pricing already exist. This is a
  re-use feature, not a new-system feature.
- **Preserve the condo and Classic exactly.** The condo remains the capital
  play; Classic keeps its 1994-faithful, condo-only, sticky residential.

## Unique Selling Points

- The first residential income you have to **actively keep**, not just collect.
- A clean **capital-vs-cashflow** choice against the condo: sell for a windfall
  now, or hold and rent for a defended monthly drip.
- A **difficulty on-ramp built into the catalog**: the forgiving Studio teaches
  renting gently at 2 stars; the demanding Apartment turns on the real retention
  game at 3.

## Core Gameplay

### Pillars

1. **Landlord, not just seller.** Residential becomes a business with recurring
   rent and tenants who can leave. (New axis.)
2. **Forgiveness scales with stakes.** The cheap Studio tolerates a scrappy
   tower; the premium Apartment demands a good one. Volatility rises with
   ambition, never punishing the early game.
3. **Every departure has a visible cause.** A vacancy always shows *why*
   ("left: too loud"), never a mystery income drain. (Owner philosophy, carried
   from [[tenant-churn-party-findings]]: "inform before you hurt.")

### Core Loop (rental slice)

Place a rental -> set its rent (player-tuned band) -> a tenant leases in (speed
gated by desirability at that price) -> rent arrives monthly while occupied ->
tower conditions erode the tenant's satisfaction (noise, dirt, unmet local
demand, and for Apartments, bad transport) -> at a threshold the tenant gives
**notice** with a recorded reason -> the player has a grace window to fix the
cause and **cancel** the departure -> unfixed, the tenant leaves, the unit goes
dark (income pauses, population drops), and it re-leases only once conditions and
price make it desirable again.

### Win / Loss (local)

There is no new global win/loss. Local success: a floor of rentals that stays
near-full and pays every month. Local failure: a floor that goes dark after a
mistake (a nightclub dropped next to Apartments) and drags both income and, if
ignored, the star rating down until the player fixes the cause.

## Game Mechanics

Numbers below are the ratified design targets; the economy-tuning values carry
`[ASSUMPTION]` and are the architecture/balance phase's to finalize (see Open
Items).

### 1. Two rental facilities, staggered like hotels

Modern-only, unlocking on the hotel cadence (single at 2 stars, double at 3):

- **Studio** kind, `category: residential`, `minStar: 2`. Width `6`
  `[ASSUMPTION]`, `population: 1`, cost `$22,000` `[ASSUMPTION]`. Meant to be
  strip-placed along a low floor.
- **Apartment** kind, `category: residential`, `minStar: 3`. Width `11`
  `[ASSUMPTION]`, `population: 2-3` (varied per unit, see mechanic 6), cost
  `$60,000` `[ASSUMPTION]`.

Both are Modern-only; both are absent from the Classic catalog. Per-tower build
caps, if any, live in `facilities.ts` (`BUILD_CAPS`) with the other kinds.

### 2. Recurring monthly rent, player-set

Rental income is **monthly**, distinct from the condo's one-time sale and the
office's quarterly rent. The player sets each type's rent through the existing
office-style price band (`priceOptions` / `MODERN_PRICE_OPTIONS`), the same
control and the same `price_tune` economy action already tracked. Higher rent
raises income per occupied unit but slows lease-up and raises churn pressure;
lower rent fills fast and stays stickier for less. **Income pauses entirely while
a unit is vacant** (like an unleased office earning nothing).

- Studio rent band `~$1,500-$3,000/mo` `[ASSUMPTION]`.
- Apartment rent band `~$4,000-$8,000/mo` `[ASSUMPTION]`.

### 3. The churn loop (reused, not rebuilt)

The satisfaction -> `vacating` -> departure machinery already exists in Modern
(`types.ts` `vacating` state + `vacateReason` + departure minute;
`Simulation.rollCondoRelocations`; the reversible-notice branch). Rental tenants
run through the **same loop** with the same reversibility: a tenant whose
satisfaction crosses the leave threshold gives **notice** (reason recorded), and
a **timely fix cancels** the departure. The one net-new behavior is what happens
*after* a rental tenant leaves: unlike a sold condo, the unit **re-leases** at
the player's set rent, gated by current desirability (mirroring how an office
re-leases after a tenant leaves), rather than reselling.

### 4. Studio is forgiving; Apartment is demanding

The two types differ in **churn sensitivity**, which is what makes them a
difficulty on-ramp rather than two sizes of the same thing:

- **Studio** tenants have low expectations. They erode (and eventually leave)
  only when the tower is *genuinely bad*: real noise adjacency, real dirt/neglect,
  or genuinely unreachable. They tolerate a scrappy 2-star tower. This keeps
  early-game stars from being fragile.
- **Apartment** tenants are demanding. They erode over **noise, dirt, unmet
  local demand, and transport quality** (see mechanic 5). They are the tier where
  keeping tenants becomes the game.

### 5. Transport quality feeds Apartment churn (the #502 track, Apartment-only)

The deferred **#502** transport-satisfaction track (a long stair climb or a
many-transfer commute erodes a tenant's satisfaction rather than hard-refusing
placement, per the `MODERN_RULES.walkwayWillingnessApplies` comment) is **folded
in for the Apartment only**. A demanding Apartment tenant left with a brutal
commute erodes toward notice like any other cause. The **Studio does not use
#502** (cheap tenants do not expect a good elevator), which keeps #502's scope
to a single tier instead of the whole curve at once.

### 6. Variants like office and condo (visual + household)

Explicit owner requirement, matching how office and condo already vary:

- **Visual variety** per placed unit through the existing
  `geoVariant(u, salt, count)` system, exactly as `residential.ts` varies office
  and condo walls/decor via `OFFICE_WALLS` / `CONDO_WALLS` / `CONDO_PICTURES`.
  Each of Studio and Apartment gets its own wall-palette set and decor/picture
  set so a strip of the same kind never looks identical.
- **Occupant/household variety** in the condo style (`rollHousehold` /
  `HOUSEHOLD_SIZES`), so an Apartment houses a varied household (e.g. 2-4
  people) rather than a fixed count, feeding population and the flavor of who
  lives there. The Studio is a fixed single-occupant unit.

### 7. Labor-free

Rentals need **no maids or staff**. Housekeeping labor stays the hotel's
distinguishing burden. Residents keep their own homes; the rental's only ongoing
demand on the player is *conditions*, not *labor*.

## Simulation-Management Specific Design

### Agent / occupant model

A rental unit's occupant is a **lease**, not a per-person agent: it occupies,
pays monthly rent, accrues satisfaction from its floor's conditions, and can give
notice and leave. This is the office lease model with a residential occupant and
the residential satisfaction inputs, not a new agent type.

### Economy coupling

- **Income:** monthly rent per occupied unit, at the player-set price; zero while
  vacant. Sits alongside office quarterly rent and hotel nightly income in the
  existing ledger.
- **Population & stars:** occupied rentals **add population**; a vacancy
  **subtracts it**, so a churning tower's population (and therefore its star
  rating) can wobble. Because the Studio is forgiving, only the demanding
  Apartments put a rating at real risk. Vacancy's magnitude on star rating is a
  tuning value (Open Items).
- **No new currency, no lump-sum on rental.** Rental never pays a sale windfall;
  that stays the condo's identity.

### Balance anchor

The **condo is untouched** and remains the capital counterpart: sell for a
lump sum now, and on the existing household-relocation turnover it resells for
another windfall ([[gdd-condo-household-departures]]). Rental is the cashflow
counterpart: smaller, steady, and defended. The intended arc is *sell condos
early for capital to expand, hold rentals late for steady income.*

## Progression and Balance

- **Studio unlocks at 2 stars** as the gentle on-ramp to renting; **Apartment at
  3 stars** turns on the retention game. Mirrors hotel single(2) -> double(3).
- **Placement tension:** low floors trend Studio (cheap, dense, forgiving); high
  floors trend Apartment (premium, demanding), where they compete with the Sky
  Bar and other high-value uses for prime real estate.
- **Difficulty curve is in the catalog:** the forgiving Studio teaches the loop
  safely; the demanding Apartment escalates it. A player is never handed
  fragile-star churn before they have the money to manage it.

## Legibility Layer (first-class scope, not polish)

Because rental income can *drop on its own*, the cause must always be readable,
or a player feels cheated. First-class scope, not a nice-to-have:

- **Every vacancy shows its reason.** A `vacating` or vacant rental surfaces the
  cause using the existing `VacateReason` / `VACATE_REASON_TEXT` vocabulary,
  extended as needed: "left: too loud", "left: too dirty", "left: hard to reach"
  (Apartment/#502), "left: rent too high". A player watching income or star
  rating dip can look at the tower and see the dark floor and its reason.
- **Notice is telegraphed before it hurts.** The grace window between notice and
  departure is visible, so the player gets the chance to fix the cause (drop the
  rent, clean up, add transport, move the nightclub) and cancel the leave.
- **Occupied vs vacant reads at a glance**, as offices already do, so a floor's
  health is scannable without opening a panel.

## Technical Specifications (GDD-level)

- No new rendering system, no new agent system, no new labor system, no new
  currency. Composes shipped machinery.
- No perf regression to the frame loop or `ui.update`: churn evaluation reuses
  the existing satisfaction/relocation cadence (per-day / throttled), not a new
  per-frame cost.
- Engine stays DOM/render-free (`src/engine/`), per project law.
- Save/compat: two new facility kinds plus a residential-rent field and a
  re-lease state. A **save round-trip must preserve** occupancy, per-unit rent,
  vacancy + reason, and the notice/departure timer. Treat as a save-shape change
  (see epics).
- Player-facing: minor version bump + one CHANGELOG line. American English, no
  em-dashes in new copy, copy is player outcomes.

## Development Epics (summary)

Detailed breakdown in `epics.md`. Sequence:

1. **Catalog & placement** - Studio + Apartment facility defs (kinds, sizes,
   costs, minStar, Modern-only gating, caps).
2. **Rental income** - monthly rent cadence, player-set price band (reuse
   office pricing), income-pauses-when-vacant, ledger wiring.
3. **Churn & re-lease** - route rentals through the `vacating` loop; add the
   post-departure **re-lease** path; wire studio-forgiving vs apartment-demanding
   sensitivities.
4. **#502 for Apartment** - transport-quality satisfaction erosion, Apartment-only.
5. **Variants** - `geoVariant` visual sets for both kinds + `rollHousehold`
   occupants for the Apartment; sprite art.
6. **Legibility** - vacancy reasons + notice telegraph + occupied/vacant read.
7. **Population/stars** - occupied adds, vacant subtracts; tune star impact.
8. **Save round-trip + tests + screenshots + CHANGELOG/version.**

## Success Metrics

- A Modern player at 2 stars strips a low floor with Studios that stay near-full
  and pay monthly through a scrappy tower without denting stars.
- At 3 stars, an Apartment floor pays well but a dropped nightclub or clogged
  elevators visibly turns units dark with a readable reason, and ignoring it
  dents the star rating.
- Both kinds show per-unit visual and household variety like offices/condos.
- Condo behavior and all Classic behavior are unchanged (regression-guarded).

## Out of Scope

- **Penthouse** (rooftop view-premium) and **Capsule hotel** (maid-logistics):
  considered by the party, **deferred**; this ships the residential-rental pair
  alone.
- **Duplex:** rejected by the party as a bigger-number reskin of the condo.
- **Any change to the condo** (stays capital/lump-sum) or to **Classic**.
- **#502 for the Studio** or the full transport-churn curve beyond the Apartment.
- New labor, new currency, new agent system.

## Assumptions and Dependencies

- `[ASSUMPTION]` widths (Studio 6, Apartment 11), costs ($22k / $60k),
  populations (Studio 1, Apartment 2-3), rent bands, and the exact star-rating
  impact of a vacancy are design targets pending economy tuning.
- Depends on the shipped churn loop (`vacating`, `rollCondoRelocations`,
  `churnMultiplier`), the office rent/vacancy/pricing path, `geoVariant`,
  `rollHousehold`, and the satisfaction/noise/unmet-demand inputs remaining
  intact.
- Builds on, and must stay consistent with, [[gdd-condo-household-departures]]
  and [[gdd-economy-depth]]; reuses the "inform before you hurt" principle from
  [[tenant-churn-party-findings]].

## Open Items

- Economy tuning: final widths, costs, monthly rent bands, populations, unlock
  stars (proposed 2 / 3), churn thresholds, and how strongly a vacancy moves the
  star rating (owner approved that it CAN; magnitude open).
- Art: how many wall/decor variants per kind, and whether the Apartment gets a
  distinct "loft" sub-look.
- Whether "rent too high" is modeled as its own vacate reason or folded into the
  desirability/lease-up gate.
