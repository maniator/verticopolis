---
title: Verticopolis — A Browser SimTower Clone
created: 2026-06-30
updated: 2026-07-02
version: 0.2 (Draft)
status: Draft
source_of_truth: SimTower (1994, Maxis / OPeNBooK)
---

# PRD: Verticopolis — A Browser SimTower Clone
*Working title — "Verticopolis" is the in-repo name; confirm if a different public title is wanted.*

## 0. Document Purpose

This PRD is for the maintainers and downstream BMAD workflow owners (UX,
architecture, epics/stories, QA) of **Verticopolis**, a from-scratch,
browser-native clone of the 1994 game **SimTower**. It is a *brownfield* PRD: a
working implementation already exists, so this document formalizes the
requirements the build must satisfy rather than proposing something new. The
**single source of truth is SimTower (1994)** — every functional requirement
traces to an original-game mechanic, and deliberate divergences from the
original are called out explicitly (§4.10, and in depth in Addendum §A) rather
than left implicit.

Structure: vocabulary is anchored in §3 Glossary and used exactly thereafter;
features are grouped in §4 with Functional Requirements (FR-N) nested and
numbered globally for stable downstream references; user journeys are numbered
UJ-N; inferences are tagged `[ASSUMPTION]` inline and indexed in §9. Existing
grounding inputs — `PARITY.md` (the parity checklist), `README.md`, and the
engine config (`src/engine/econConfig.ts`, `src/engine/facilities.ts`) — are
referenced here, not duplicated. Concrete tuning numbers are quoted from those
sources and are the canonical balance values for this build.

## 1. Vision

Verticopolis recreates the quiet, absorbing loop that made SimTower a classic:
you start with an empty lot and two million dollars, lay floors, drop in offices
and shops and hotel rooms, thread elevators up the spine of a growing high-rise,
and watch tiny people stream through the building you designed. When the
elevators are well planned the tower hums; when they are not, crowds back up,
turn red with frustration, and tenants move out. Success is measured in **star
ratings** earned by population and the right facilities, culminating in the
coveted **TOWER** rank.

It matters because SimTower is a 32-year-old DOS/Windows/Mac artifact that is
hard to run on modern machines, and no faithful, zero-install, browser-native
version exists that respects the original's mechanics rather than reskinning a
generic builder. Verticopolis is that version: it runs in any modern browser
with no download, draws every sprite in code (no ripped art assets — it is a
clean-room homage, not a ROM), and can even be exported as a single
self-contained HTML file you open from `file://`.

The bar is **gameplay parity**: a player who knew the 1994 game should
recognize the building rules, the elevator micromanagement, the economy rhythm,
the rating gates, and the disasters — modernized only where the browser and
touch devices demand it, never redesigned for its own sake.

## 2. Target User

### 2.1 Primary Persona

**The nostalgic systems-tinkerer.** A player (often 30–50) who played SimTower
or its descendants (SimCity, Yoot Tower, Project Highrise) and wants that
specific itch scratched without dredging up an emulator or abandonware
installer. They value *faithfulness* — they will notice if sky lobbies aren't
every 15 floors, if express elevators stop on the wrong floors, or if the rating
thresholds are wrong. They play in short sessions on whatever device is at hand:
a laptop at lunch, a phone on a couch. `[ASSUMPTION: demographic and motivation
profile is inferred from the genre and the clone's stated goals, not from user
research.]`

### 2.2 Jobs To Be Done

- **Relive the SimTower loop** — build, optimize transport, grow population,
  chase stars — without installing anything.
- **Tinker with a vertical city** as a low-stakes, pausable sandbox; stop and
  resume anytime.
- **Prove the design works** — for the builder/maintainer, "this is for me: a
  faithful, fully-playable SimTower I can run and share from a single file."
- **Share a playable build** with a friend via a single HTML file or URL.

### 2.3 Non-Users (v1)

- Players wanting a *modern reimagining* with new mechanics, multiplayer, or
  monetization — this is a faithful clone, not a sequel.
- Players expecting ripped original art/audio — all assets are code-drawn
  originals for clean-room reasons.
- Competitive/leaderboard players — there is no online metagame.

### 2.4 Key User Journeys

- **UJ-1 — First tower.** A new player lands on an empty lot, opens help, lays
  a ground lobby and floors, places a first office and a standard elevator, and
  sees a person ride to work.
- **UJ-2 — Fix a congestion crisis.** Crowds tint red and tenants threaten to
  leave; the player inspects the elevator, adds cars / adjusts served floors /
  builds a second shaft, and watches frustration drain.
- **UJ-3 — Climb a star.** The player grows population to a threshold, builds
  the gating facility (e.g. Security for 3★), and receives the promotion.
- **UJ-4 — Reach the sky.** Past floor 15 the player builds sky lobbies and
  express elevators to keep tall-tower transit viable, restructuring vertical
  flow as the building grows.
- **UJ-5 — Win the TOWER.** At 5★ with a Metro Station, the player builds the
  Wedding Hall on floor 100 and passes the VIP inspection to earn the TOWER
  rank (the end state).
- **UJ-6 — Survive a disaster.** A fire (or bomb threat / thief) strikes; the
  player's Security/Medical coverage determines whether it is contained, and the
  economy absorbs repairs or fines.
- **UJ-7 — Save, leave, return.** The player's tower autosaves; they close the
  tab and later resume from a slot, or export the tower to JSON to move it.

## 3. Glossary

*Downstream workflows and readers must use these terms exactly. No synonyms elsewhere.*

- **Tower** — the entire building the player constructs; also the name of the
  final win-state rank (see **TOWER rank**). Disambiguated by context/casing.
- **Lot** — the fixed buildable region: 100 floors above ground, 10 basement
  levels below (B1…B10), 340 tiles wide.
- **Two-layer grid** — the building model: a structural floor/corridor layer with
  a room layer placed on top of it. A Room cannot exist without a Floor beneath.
- **Floor (structure)** — a single structural floor tile; must exist before a
  room can sit on it. The cheap base layer of the **two-layer grid**.
- **Tile** — the unit of horizontal width on the grid (lot is 340 tiles wide).
- **Floor number** — continuous numbering: floor 1 = ground, floor 0 = B1,
  −1 = B2 … −9 = B10 (no gap at 0); top is floor 100. The basement therefore has
  10 levels (B1…B10).
- **Lobby** — a transit-only concourse floor where people pass to reach
  transport. **Sky lobby** = a lobby above ground, placed on the ground floor and
  every 15th floor (15, 30, 45 …) as the tower's transit hubs (where express
  elevators stop and passengers transfer). Rooms cannot be placed on a lobby
  (enforced); the every-15-floors placement is a structural/transit convention,
  not a rating gate (see FR-6).
- **Facility** — any placeable thing: structure (floor/lobby), a **Room** (a
  tenant/commercial/service unit), or **Transport**.
- **Room** — a non-structural, non-transport facility occupied by tenants or
  visitors (office, condo, hotel room, food, retail, entertainment, service).
- **Tenant** — an occupant of a room who pays the player and can become
  dissatisfied and **move out**.
- **Transport** — vertical movement facility: **Stairs**, **Escalator**, or an
  **Elevator** (Standard / Service / Express). An elevator shaft holds one or
  more **Cars**.
- **Car** — a single elevator cab within a shaft; has a capacity and a route.
- **Served floor** — a floor reachable from the ground lobby via the connected
  transport network; tenants on unserved floors become dissatisfied.
- **Population** — the count of people who **occupy** the tower: office workers,
  condo/apartment residents, and hotel guests. Per the 1994 original, transient
  **commercial/visitor traffic** (shoppers, diners, cinema-goers) generates income
  but does **not** count toward population. Drives the star thresholds and the
  TOWER goal (see the DECISION note on FR-46).
- **Stress / satisfaction** — a tenant's contentment, driven mainly by
  transport waits and reachability; low satisfaction causes move-out.
- **Aggregate congestion model** — a lightweight, render-independent model of
  tower-wide transport load that runs alongside individual commuter routing as a
  deterministic backstop and the basis for automated testing.
- **Star rating** — the tower's rank, 1★–5★, gated by population thresholds and
  required facilities.
- **TOWER rank** — the final rank above 5★, earned via the VIP inspection; the
  win state.
- **VIP inspection** — the scripted evaluation event that, if passed, awards the
  TOWER rank.
- **Game clock** — the single global simulation clock driving all time-based
  behavior; supports pause and multiple speeds. No per-room timers exist.
- **Tool** — the active editing mode in the UI (build a specific facility,
  Inspect, or Bulldoze).

## 4. Features

*Each subsection is a coherent feature: behavioral description first, FRs nested
and globally numbered. FRs describe capabilities, not implementation. Numbers in
brackets are canonical balance values from the engine config and are the source
of truth for tuning.*

### 4.1 Tower Construction & Structure

**Description:** The player builds on a fixed **Lot** using a **two-layer
grid**: a structural floor/corridor layer and a room layer on top. A **Room**
requires a **Floor** beneath it; in this build, placing a room auto-creates the
floor under it (no separate pre-laying of bare floor is required, though floors
can also be painted directly). Rooms cannot float — each must sit on the floor
directly below (or the ground). The same physical-consistency rule applies to
structure itself: floors above the ground story need the story below built
beneath them, in both directions — you can neither place a hanging floor nor
pull a supporting one out from under the story above. **Lobbies** are
transit-only and required at the ground floor and every 15th floor. Multi-story facilities (cinema = 2 floors,
recycling = 2, metro = a whole basement floor) occupy their full height/width.
Building takes in-game construction time; bulldozing returns a partial refund.
Realizes **UJ-1**, **UJ-4**.

**Functional Requirements:**
- **FR-1** — The player can build within a lot of **100 floors above ground**,
  **10 basement levels below** (B1…B10, i.e. floor 0 down to floor −9), and
  **340 tiles wide** [`GRID`: `maxFloor` 100, `minFloor` −9, `width` 340]. `[UPDATED 2026-06-30: widened 200→340 so the canonical 15,000 TOWER target is reachable — see FR-46/FR-67.]`
  Placement outside these bounds is rejected.
- **FR-2** — Floor numbering is continuous with no gap at zero: floor 1 =
  ground, floor 0 = B1, down to −9 = B10; top = floor 100.
- **FR-3** — The player can place a **Room** only where a structural floor
  exists or will be auto-created beneath it; rooms may not overhang empty space.
- **FR-3a** — Structure must be **supported** `[ADDED 2026-07-02]`: a floor
  segment above the ground story can be placed only where the story directly
  below is fully built beneath its whole width (no hanging floors in midair),
  and the system must refuse to bulldoze structure whose removal would leave
  the story above unsupported. `[NOTE: this narrows the earlier
  "canon-non-removable structures kept removable (QoL)" divergence — removal
  stays a QoL freedom, but never at the cost of physical consistency.]`
- **FR-4** — The player can paint **Floor** and **Lobby** structure by
  click-drag along a floor.
- **FR-5** — **Lobby** concourses are transit-only: the system must reject any
  attempt to place a Room on a lobby tile.
- **FR-6** — Lobbies are the tower's **vertical transit hubs**: a **ground
  lobby** sits on floor 1, and **sky lobbies** may be placed on multiples of
  **15 floors** (15, 30, 45 …) [`GRID.lobbyInterval`] — the floors where express
  elevators stop and passengers transfer between elevator banks. Sky lobbies are
  valid only on those multiples of 15. `[NOTE FOR PM: this is a structural /
  transit convention, NOT an enforced rating or win gate — promotion (FR-43/44)
  and the TOWER win (FR-46) are decided by population and required facilities
  only; the shipped build performs no lobby check in star/VIP evaluation.]`
- **FR-7** — Multi-story facilities occupy their declared height: cinema **2
  floors**, recycling **2 floors**, metro **1 full basement floor** spanning the
  whole lot width [`FACILITIES`].
- **FR-8** — Building a facility takes **construction time** scaled by size/cost,
  driven by the **game clock** (structure is instant; rooms take longer)
  [`buildMinutes`]; the facility is non-operational until construction completes.
- **FR-9** — The player can **bulldoze** any facility (single click or drag),
  receiving a **partial refund** of its cost.
- **FR-10** — Basement-only facilities (parking, recycling, metro) may be placed
  only below ground; the system rejects above-ground placement.

### 4.2 Facilities & Tenants

**Description:** The full original facility catalog is available, each with a
cost, footprint width, minimum star gate, and behavior. Tenant rooms pay the
player on different cadences; service rooms cost upkeep but unlock ratings and
mitigate problems. Each facility type unlocks at a minimum star rating
[`FACILITIES.minStar`]. Realizes **UJ-1**, **UJ-3**.

**Functional Requirements:**
- **FR-11** — The player can place **Office** rooms (width 9, $40,000, 1★) that
  rent to a company, are staffed on weekday business hours, and pay **quarterly
  rent of $10,000** [`ECON.officeRentQuarterly`].
- **FR-12** — The player can place **Condominium** rooms (width 16, $80,000, 1★)
  that **sell once** for a lump sum of **$120,000** [`ECON.condoSalePrice`] and
  thereafter house permanent residents who count toward population.
- **FR-13** — The player can place **Hotel** rooms — **Single** (width 4,
  $20,000, 2★), **Double** (width 6, $50,000, 3★), **Suite** (width 12,
  $100,000, 3★) — that earn **nightly revenue** ($90 / $180 / $500 respectively)
  [`ECON.hotel`] when occupied, with guests checking in at night and out in the
  morning. (Double/Suite unlock at 3★ per the original; Suite houses 3.)
- **FR-14** — Hotel rooms become dirty after checkout and must be cleaned by
  **Housekeeping** before they can be re-rented (a daily cycle). Cleaning is
  **physical, not instant** `[UPDATED 2026-07-02]`: a room stays visibly dirty
  (distinct room art) until a housekeeper actually **travels to it** over the
  staff transport network (FR-25a) and arrives, as in the original; rooms no
  housekeeper can reach stay dirty and, left that way, attract cockroach
  infestations.
- **FR-14a** — Housekeeping has **finite daily capacity** `[ADDED 2026-07-02]`:
  each Housekeeping unit cleans roughly **20 rooms per day**
  [`HK_ROOMS_PER_CREW`] with a bounded number of housekeepers in transit at
  once [`HK_MAX_IN_FLIGHT`], working a checkout-to-evening shift. When dirty
  rooms exceed capacity, or none of the crews can reach a dirty room, the
  system tells the player **which problem they have** (an "at capacity — build
  another" advisory vs. a "can't reach" advisory) instead of leaving the
  cockroach symptom to speak for itself.
- **FR-15** — The player can place food/retail/entertainment rooms that earn
  **daily traffic income** scaled by foot traffic and open hours: **Fast Food**
  ($2,000/day, 1★), **Restaurant** ($4,000/day, 3★), **Retail Shop**
  ($2,500/day, 3★), **Cinema** ($8,000/day, 3★, 2 floors), **Party Hall**
  ($3,000/day, 3★) [`ECON.dailyTrafficIncome`]. (Restaurant/Shop unlock at 3★
  per the original.)
- **FR-16** — Food/retail/entertainment facilities keep **business hours** and
  display as **CLOSED** outside them; income accrues only while open
  [`isOpenAt`, `hasBusinessHours`].
- **FR-16a** — Each **Cinema** books a film every month (canon): an **average
  film** (~$150,000) or, some months, a **blockbuster** (~$300,000) that costs
  more to book but draws a bigger crowd — a genuine upside in a busy tower and a
  gamble in a quiet one [`cinemaBookingMonthly`, `cinemaBookingBlockbuster`].
- **FR-17** — The player can place **Service** facilities — **Parking** (3★,
  basement), **Security** (2★), **Medical Center** (3★), **Housekeeping** (2★),
  **Recycling Center** (3★, basement, 2 floors) — which generate no income and
  provide rating/mitigation effects. Security, Medical, Housekeeping, and
  Recycling each charge monthly maintenance [`ECON.serviceMaintenanceMonthly`];
  Parking carries only its build cost (no monthly service maintenance) and
  reduces stress for tenants who drive. Parking has two parts (canon): a
  **Parking Ramp** and **Parking Spaces**, and a space only functions when it
  chains — through contiguous spaces — back to a ramp; unconnected spaces are
  dead ("red X") and provide no relief. `[NOTE: Security unlocks at 2★ — it is
  the facility that GATES 3★ (FR-44), so it must be buildable while the tower is
  still 2★, otherwise the rating deadlocks. Medical (the 4★ gate) unlocks at 3★
  for the same reason.]`
- **FR-18** — The player can place a **Metro Station** (4★, $1,000,000,
  whole-floor deep basement) that brings large numbers of visitors to the tower.
- **FR-19** — The player can place a **Wedding Hall** (5★, $3,000,000, floor
  100), the religion-agnostic stand-in for the original's **Cathedral**, which
  enables the final TOWER evaluation. `[ASSUMPTION: floor-100 placement is a
  hard requirement, mirroring the original Cathedral.]`
- **FR-20** — Each facility is gated by its **minimum star rating**: the system
  must prevent placing a facility before its `minStar` is reached [`FACILITIES`].
- **FR-21** — Each tenant **Room** contributes a fixed amount to **population**
  (office 6, condo 3, hotel single 1 / double 2 / suite 2) [`FACILITIES`];
  service/commercial rooms add 0.

### 4.3 Vertical Transport

**Description:** People reach upper floors only via connected **Transport**.
**Stairs** and **Escalators** are fixed two-floor flights placed with a single
tap and stackable into continuous columns; **Elevators** (Standard / Service /
Express) carry passengers across many floors with configurable **cars** and
per-floor stop settings. Express elevators stop only at lobbies/sky lobbies,
the key to tall-tower viability. **Service elevators are staff-only** (as in
the original): tenants never ride them, and together with stairs/escalators
they form the staff network housekeepers travel on. Dispatch is demand-driven
and answers the **real crowd**: cars serve the actual people seen waiting and
riding, and idle at the lobby when empty. A floor counts as **served** only if
it is reachable through the transport network. Realizes **UJ-2**, **UJ-4**.

**Functional Requirements:**
- **FR-22** — The player can build **Stairs** (capacity 8) and **Escalators**
  (capacity 30) as **fixed two-floor flights** [`maxSpanFor`,
  `TRANSPORT_CAPACITY`]. `[UPDATED 2026-07-02]` Placement is **one tap/click**
  on the bottom floor (no drag-to-size, matching the original); the preview
  shows the true two-floor footprint, and a placed flight renders as a
  **single flight** between its two floors. The fixed span is enforced
  everywhere — placement, and any post-placement resize path — so a flight can
  never be stretched taller.
- **FR-22a** — Flights **stack into columns** `[ADDED 2026-07-02]`: a new
  flight may share exactly its landing floor with an existing flight of the
  same footprint (same horizontal position and width) directly above or below,
  forming a continuous multi-floor stair/escalator run as in the original;
  partially-offset overlaps and duplicate flights are still rejected.
- **FR-23** — The player can build **Standard** (1★, ≤30 floors, ≤8 cars, cap
  21/car), **Service** (2★, ≤30 floors, ≤4 cars, cap 16/car), and **Express**
  (3★, **no effective length limit** — may span the full tower height, ≤8 cars,
  cap 33/car) elevators by dragging vertically to set
  the served span [`maxSpanFor`, `MAX_CARS`, `TRANSPORT_CAPACITY`].
- **FR-24** — The player can edit a placed elevator in-game: adjust its **car
  count** and its **per-floor stop configuration** (which floors a car serves /
  skips). `[UPDATED 2026-07-02]` Adding a car **costs money** and is refused
  when unaffordable; removing a car pays back a **partial resale refund**
  (consistent with bulldoze economics, FR-9).
- **FR-25** — **Express** elevators skip intermediate non-lobby floors, stopping
  only at lobby/sky-lobby floors — **except their own shaft endpoints (bottom and
  top), which always remain stops** so the shaft stays connected even when an
  endpoint is not a lobby [`Tower.setExpressStops()`]. Express service to a sky
  lobby holds **regardless of build order** (a sky lobby added after the shaft
  still becomes a stop).
- **FR-25a** — **Service elevators are staff-only** `[ADDED 2026-07-02, per
  canon]`: tenants and visitors never route through or board them, and they do
  not count toward a floor's **served** status (FR-28). Service elevators plus
  stairs and escalators form the **staff transport network** that housekeepers
  (FR-14) travel on; when a staff route could equally use stairs or a service
  elevator, the service elevator wins, so a built service shaft actually
  carries the staff traffic it exists for.
- **FR-26** — Elevator cars are dispatched **on demand**: a car travels to serve
  waiting passengers, boards riders up to capacity, lets them alight at their
  floor, and idles at the ground lobby when there is no demand.
  `[UPDATED 2026-07-02]` Dispatch serves the **visible crowd, not just a
  statistical estimate**: a person seen waiting at a shaft is a live hall call
  a car must answer, and a rider's destination is a cab call their own car
  must stop at — so no one the player can see is ever stranded by the
  aggregate model rounding to zero. **Staff-only shafts answer only real staff
  calls** (no phantom tenant demand moves a service car). *(Dispatch algorithm
  detail in Addendum §B.)*
- **FR-27** — A car's displayed load reflects its real passenger count, and
  each car shows the original's status cues `[UPDATED 2026-07-02]`: a
  **direction lantern** while traveling and a **FULL indicator** at capacity.
- **FR-28** — A floor is **served** if and only if it is reachable from the
  ground lobby through the connected transport network (including transfers at
  sky lobbies); the system computes reachability and exposes "served" status.
- **FR-29** — Each elevator car charges **monthly maintenance of $600**
  [`ECON.maintenancePerCarMonthly`].

### 4.4 Population, Routing & Stress

**Description:** People are **individually routed**: a commuter walks to a shaft,
waits, boards a real car, transfers at sky lobbies, and arrives — individually
pathfound over the transport network. Real waiting drives **stress**; frustrated crowds
tint red (the original's visual cue) and chronically dissatisfied tenants
**move out**. A lightweight **aggregate congestion model** runs underneath as a
deterministic, DOM-free backbone (and as the testable backstop). Population
follows weekday/weekend and rush-hour rhythms. Realizes **UJ-2**.

**Functional Requirements:**
- **FR-30** — The system routes commuters individually: each person walks to a
  shaft, waits, boards an actual car, transfers at sky lobbies, and arrives,
  following a path computed over the connected transport network. *(Pathfinding
  detail in Addendum §B.)*
- **FR-31** — Tenant **stress** rises from real elevator wait times and from
  being on an **unserved** floor; sustained low satisfaction causes the tenant
  to **move out** (vacating the room / reducing population).
- **FR-32** — Crowds render with a **red tint** when they have waited too long or
  transport is overwhelmed.
- **FR-33** — Population follows **weekday/weekend** patterns and **morning /
  lunch / evening rush** cycles driven by the game clock.
- **FR-34** — An **aggregate congestion model** runs alongside individual routing
  as a deterministic, render-independent backstop, and is the basis for
  automated verification of congestion/stress behavior. `[NOTE FOR PM: this dual
  model is a deliberate divergence from the original's single model — see §4.10.]`
- **FR-35** — The on-screen crowd is **capped** (~140 visible) for performance
  while the simulation continues to model the full population.

### 4.5 Economy & Time

**Description:** The player starts with **$2,000,000** and manages cash against
construction costs, maintenance, and varied income cadences (quarterly office
rent, one-time condo sales, nightly hotel revenue, daily commercial traffic).
A single **game clock** drives weekday/weekend rhythms, business hours,
quarterly/monthly/nightly/daily accounting, and supports pause and multiple
speeds. Realizes **UJ-3**, **UJ-7**.

**Functional Requirements:**
- **FR-36** — The player starts with **$2,000,000** [`ECON.startingMoney`].
- **FR-37** — Income accrues on its correct cadence: office rent **quarterly**,
  condo sale **once**, hotel revenue **nightly**, food/retail/cinema/party-hall
  **daily** by traffic and open hours.
- **FR-38** — Maintenance is charged **monthly**: $600/elevator car, and per
  service — Security $2,000, Medical $5,000, Housekeeping $1,000, Recycling
  $4,000, Metro $8,000 [`ECON.serviceMaintenanceMonthly`].
- **FR-39** — Excavating basement rooms can yield **buried treasure** (a one-time
  cash find). `[ASSUMPTION: treasure is tied to basement excavation as in the
  original, surfaced as an event headline.]`
- **FR-40** — A single **game clock** drives all time-based behavior; the player
  can **pause** and select among **multiple simulation speeds** via on-screen
  controls (and keyboard shortcuts). *(Exact control bindings are a UX concern,
  detailed downstream; current bindings noted in README.)*
- **FR-41** — The system tracks calendar time (day-of-week, hour, quarter,
  month) and surfaces it to the player.
- **FR-42** — There are no per-room timers; all timing derives from the single
  global clock. *(Architectural invariant — kept here because it constrains every
  time-based requirement above.)*

### 4.6 Star Ratings & the TOWER Win

**Description:** The tower earns **star ratings** by reaching population
thresholds *and* having required facilities. The endgame is the **TOWER rank**:
at 5★ with a Metro Station, the player builds the Wedding Hall on floor 100 and
passes a **VIP inspection**. Realizes **UJ-3**, **UJ-5**.

**Functional Requirements:**
- **FR-43** — Star thresholds by population: **2★ = 300**, **3★ = 1,000**,
  **4★ = 5,000**, **5★ = 10,000** [`STAR_THRESHOLDS`].
- **FR-44** — Facility gates apply on top of population: **Security required for
  3★**, **Medical Center required for 4★**.
- **FR-45** — On crossing a threshold (with gates satisfied) the tower is
  **promoted**, unlocking higher-`minStar` facilities and signaling the player
  (jingle / headline).
- **FR-46** — The **TOWER rank** requires: **5★** + a built **Wedding Hall**
  (floor 100) + a **Metro Station** + passing the **VIP inspection** at a
  population target of **15,000** [`TOWER_POPULATION`]. `[RESOLVED 2026-06-30:
  restored to the canonical 15,000 (from the interim 8,000) by widening the
  buildable lot to 340 tiles so a well-zoned tower can actually reach it
  (~15,066 occupants measured); population scale is no longer a divergence —
  see §4.10 / FR-67.]`
  `[DECISION 2026-06-30 (owner): "TOWER" measures OCCUPANT POPULATION (residents +
  office workers + hotel guests) exactly as the 1994 original did — NOT total
  served/commercial traffic. The BMAD party had recommended counting commercial
  visitor traffic to guarantee winnability, but the owner chose canon fidelity:
  the original game's rating was a population census, and commercial venues add
  income, not population. Winnability is therefore restored in Phase 2 by making
  congestion SPATIAL (so a well-zoned tall tower can actually hold the target,
  like the original), with a tolerance-band fallback on the number — not by
  changing what is counted.]`
- **FR-47** — Passing the VIP inspection awards the **TOWER rank** (win state)
  and is surfaced to the player; failing it leaves the tower at 5★ and is
  retryable.

### 4.7 Events & Disasters

**Description:** The tower faces the original's events. **Fire** spreads to
neighbors unless contained by Security/Medical and costs repairs. **Bomb
threats** (4★+) are defused by Security or cause damage and a fine. **Thieves**
are caught by Security or steal cash. The **VIP inspection** gates the win. There
are flavorful one-offs: **treasure** discovery and a seasonal **Santa** cameo.
Realizes **UJ-6**.

**Functional Requirements:**
- **FR-48** — **Fire** can break out and **spread to a neighboring facility**
  unless **Security/Medical** coverage contains it; it inflicts repair costs.
- **FR-49** — **Bomb threats** can occur at **4★+**; **Security** defuses them,
  otherwise the tower takes damage plus a **fine**.
- **FR-50** — **Thieves** can appear; **Security** catches them, otherwise they
  steal a portion of cash.
- **FR-51** — The **VIP inspection** event drives the TOWER win/lose evaluation
  (see FR-46/FR-47).
- **FR-52** — A seasonal **Santa** cameo visits a **3★+** tower once over the
  holidays, granting a cash gift.
- **FR-53** — Events surface to the player as **headlines / notifications** with
  appropriate flavor text.
- **FR-54** — Disaster outcomes are **deterministic** given game state and a
  fixed random seed, so a given tower state produces repeatable, verifiable
  results. `[ASSUMPTION: event randomness is seeded and separated from cosmetic
  randomness like weather.]` *(Determinism mechanism in Addendum §B.)*

### 4.8 Presentation, Atmosphere & Audio

**Description:** The tower is a living scene: people walk lobbies and corridors,
elevator cars carry visible passengers, window lights turn on/off, the cinema
screen plays, and the metro train pulls in and departs. A **day/night** sky
arcs the sun and moon; interiors light at night and go dark when empty/asleep;
shops show CLOSED off-hours. Cosmetic **weather** (clear/cloudy/rain) drifts by.
A **location-aware procedural soundtrack** crossfades musical scenes based on
what the camera is centered on. All art is **drawn in code** (no external
assets). Realizes the feel underlying every journey.

**Functional Requirements:**
- **FR-55** — The renderer animates living detail: lobby/corridor walkers,
  stair/escalator climbers, in-car elevator riders, and the metro train.
  Decorative floor pedestrians reflect **live occupancy** (an empty floor shows
  no one pacing), and elevator shafts label only the floors the shaft actually
  stops at.
- **FR-56** — A **day/night cycle** arcs both sun and moon across the sky;
  interiors light at night, go dark when empty/asleep, and commercial rooms show
  **CLOSED** off-hours.
- **FR-57** — **Weather** is deterministic per in-game day (clear / cloudy /
  rain) and purely cosmetic — it does **not** affect gameplay and runs off a
  separate RNG from gameplay events.
- **FR-58** — The **soundtrack** is **procedurally generated** and
  **location-aware**: it crossfades between scenes (lobby muzak, office hum, hotel
  calm, food-court bustle, cinema score, subway rumble …) based on the camera's
  focus, plus build/sell/promotion jingles and SFX. *(Audio engine detail in
  Addendum §B.)*
- **FR-59** — The player can **pan** (drag with Inspect, middle/right mouse, or
  hold Space), **zoom** (mouse wheel), and on touch **pinch**, with
  collision-based picking for selecting facilities.
- **FR-60** — **All visual assets are generated in code**; the build ships no
  ripped or external art/audio assets. *(Clean-room constraint — load-bearing for
  the project's legitimacy.)*

### 4.9 Save / Load & Platform

**Description:** Towers **autosave** to browser `localStorage` with multiple
named **slots**, plus JSON **export/import** to move a tower between
devices/browsers. The game targets desktop browsers with a modernized,
touch-friendly **mobile layout**. A best-effort importer reads the original
**`.TWR`** save format (documented stub). Realizes **UJ-7**.

**Functional Requirements:**
- **FR-61** — The game **autosaves locally in the browser** and supports
  **multiple save slots** the player can name, load, and delete; saves persist
  across sessions with no account or server. *(Storage mechanism in Addendum §B.)*
- **FR-62** — The player can **export** a tower to a JSON file and **import** one
  back, round-tripping the full game state.
- **FR-63** — The game runs in current evergreen browsers with **no install**,
  and can be packaged as a **single self-contained HTML file** playable directly
  from the local filesystem (`file://`) with no server. *(Build command in
  Addendum §B.)*
- **FR-64** — On small/touch screens the UI adapts to a **responsive layout**
  with touch pan/pinch and **drawer panels** for the build palette and edit
  panels.
- **FR-65** — A best-effort importer for the original **`.TWR`** save format is
  provided as a **documented stub** (v2 decoder), with graceful failure on
  unsupported files. `[NON-GOAL for MVP: full, lossless `.TWR` import.]`

### 4.10 Deliberate Divergences from SimTower (1994)

**Description:** Because the source of truth is the original game, every place
this build *intentionally* differs is enumerated here so downstream readers do
not mistake a divergence for a defect. These are design decisions, not parity
gaps. Full rationale and the complete source-of-truth mapping live in
**Addendum §A**.

**Functional Requirements:**
- **FR-66** — The floor-100 capstone is a **Wedding Hall**, a religion-agnostic
  stand-in for the original's **Cathedral**; it fills the identical role of
  triggering the TOWER evaluation (see FR-19, FR-46).
- **FR-67** — The TOWER goal is a **population census** as in the 1994 original
  (office workers + condo residents; hotel guests count only while the tower is
  climbing to 3★, then drop out of the rating per canon; commercial visitors are
  always excluded — `ratingPopulation()`), at the canonical target of **15,000**. The interim scaled-down number (8,000) was
  restored to 15,000 on 2026-06-30 by widening the lot to 340 tiles so the target
  is genuinely reachable under the spatial model — both the metric *and* the
  number are now canonical (see the RESOLVED note on FR-46).
- **FR-68** — Tower transport stress is driven by an **individually-routed
  crowd** (FR-30) layered over an **aggregate congestion model** (FR-34),
  whereas the original used a single aggregate model; the on-screen crowd is
  **capped** for performance (FR-35) while the full population is still
  simulated. Routing honors the original's **two-ride rule**: a trip uses at
  most **two transport rides** (one sky-lobby transfer), so floors reachable only
  via 3+ rides draw no commuters — the player must provide sky-lobby transfers.
- **FR-69** — All art and audio are **generated in code** (FR-60), and saves use
  a **JSON format** with only a best-effort `.TWR` importer (FR-65), rather than
  the original's bundled assets and native `.TWR` save format.

## 5. Non-Goals (Explicit)

- **Not a redesign or sequel.** No new mechanics, no "modern improvements" to
  gameplay beyond what the browser/touch platform requires. Faithfulness wins
  over novelty.
- **Not using original assets.** No ripped SimTower sprites, sounds, music, or
  the Cathedral by name — clean-room only. This is a **permanent** exclusion, not
  a deferral.
- **No online/multiplayer/leaderboards/accounts.** Single-player, local-only.
- **No monetization** — no ads, IAP, or paywalls.
- **No backend/server.** The game is fully client-side; saves live in the
  browser or in exported files.
- **Not a 1:1 population-scale simulation.** The TOWER target now matches the
  canonical **15,000** (the lot was widened to 340 so it's reachable), but the
  underlying density model is still a game-scale abstraction, not a tile-exact
  recreation of the original's simulation.
- **Not a full `.TWR` import tool.** Only a documented best-effort stub.

## 6. MVP Scope

### 6.1 In Scope

- The complete building model: two-layer grid, lot bounds, lobbies/sky lobbies,
  multi-story facilities, construction time, partial-refund bulldoze (§4.1).
- The full original facility catalog with correct gates and income/upkeep (§4.2).
- Stairs, escalators, and Standard/Service/Express elevators with editable cars
  and per-floor stops, demand-driven dispatch, and reachability-based "served" status
  (§4.3).
- Individually-routed crowd with stress/move-out and the aggregate backstop
  (§4.4).
- Full economy and the single-clock time model with pause/speeds (§4.5).
- Star ratings, facility gates, and the TOWER win via VIP inspection (§4.6).
- Fire, bomb threat, thief, VIP inspection, treasure, and Santa events (§4.7).
- Living presentation: animation, day/night, cosmetic weather, location-aware
  procedural audio, pan/zoom/pinch (§4.8).
- Autosave + slots + JSON export/import; responsive mobile layout; single-file
  build (§4.9).

*(This reflects the current shipped build — `PARITY.md` marks all of the above
as implemented and test-covered.)*

### 6.2 Out of Scope for MVP

- **Lossless `.TWR` import** — stub only (FR-65). `[NOTE FOR PM: faithful fans
  may want their old towers back; revisit if a robust decoder becomes feasible.]`
- **Original assets / Cathedral naming** — permanent non-goal, not a deferral.
- **Population at full original scale (15,000 TOWER)** — **DELIVERED 2026-06-30**
  (no longer deferred): the lot was widened to 340 tiles so the canonical 15,000
  is reachable, rather than building a new population model.
- **Online features, accounts, leaderboards, mod support** — not planned.
- **Additional disaster types beyond the original set** — none planned.

## 7. Success Metrics

**Primary**
- **Parity completeness** — % of `PARITY.md` mechanics marked ✅ and backed by a
  passing test or captured screenshot. Target: **100% of the parity checklist**
  green (current suite: 282 tests incl. an end-to-end run to TOWER victory).
- **Winnability** — an automated end-to-end run reaches the **TOWER** rank
  without manual intervention. Target: the `parity.test.ts` victory path stays
  green on every commit.

**Secondary**
- **Zero-install playability** — the single-file build opens and plays from
  `file://` with no server. Target: `build:single` produces a working artifact.
- **Cross-device usability** — the game is playable on a phone (touch pan/pinch,
  drawer UI) and a desktop. Target: no blocking layout/interaction defects on
  a mid-range phone.
- **Faithful "feel" (playtest rubric)** — in a structured playtest with ≥3
  SimTower veterans, each completes a fixed checklist (place a room, fix a
  congestion crisis, earn a star, reach an end state) and rates recognizability
  of building rules, elevator micromanagement, rating gates, and disasters on a
  fixed scale. Target: median "recognizable without explanation" on every item.
  `[ASSUMPTION: a veteran playtest can be arranged; if not, this demotes to a
  Vision-level aspiration.]`

**Counter-metrics (do not optimize)**
- **Do not optimize raw realism/scale** at the cost of the original's *feel* or
  of browser/mobile performance — the ~140 on-screen crowd cap and aggregate
  backstop exist on purpose.
- **Do not optimize for novelty** — features the original lacked are not wins
  here; they are scope creep against the faithfulness goal.
- **Do not chase 60fps on huge towers** by dropping the individually-routed
  crowd that creates the core stress signal.

## 8. Open Questions

1. Public title — keep "Verticopolis", or pick a different name? (Repo/README
   use "Verticopolis".)
2. Is floor-100-only the intended hard constraint for the Wedding Hall, or
   should any top-most floor qualify? (FR-19)
3. *(Resolved 2026-06-30)* Express auto-restriction is confirmed in
   `Tower.setExpressStops()`: express skips intermediate non-lobby floors but
   always keeps its shaft endpoints as stops. FR-25 updated accordingly.
4. *(Resolved 2026-06-30)* The TOWER target is the canonical **15,000**. It was
   briefly re-derived down to 8,000 because a 100×200 lot topped out near ~8,900
   occupants under the v2 spatial model, but the owner chose to restore the
   original number by **widening the lot to 340 tiles** — a well-zoned tower now
   reaches ~15,066 occupants at healthy congestion, so both the metric (a
   population census) and the number are canonical. (FR-46 / FR-67)
5. What is the precise trigger/odds model for buried treasure, and is it strictly
   basement-excavation-tied? (FR-39)
6. Accessibility targets (keyboard-only play, color-blind-safe red congestion
   cue, reduced-motion) — in or out for v1? `[NOTE FOR PM]`

## 9. Assumptions Index

- **§2.1** — Primary persona demographic/motivation is inferred from genre and
  project goals, not user research.
- **§4.2 (FR-19)** — Wedding Hall placement is hard-required on floor 100,
  mirroring the original Cathedral.
- **§4.5 (FR-39)** — Buried treasure is tied to basement excavation and surfaced
  as an event headline.
- **§4.7 (FR-54)** — Event randomness is seeded and separated from cosmetic
  randomness (e.g. weather).
- **§7** — A structured veteran playtest can be arranged to measure faithful
  "feel"; if not, that metric demotes to a Vision-level aspiration.
