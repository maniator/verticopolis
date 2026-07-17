---
title: Housekeeping & Cockroach Overhaul
game: Verticopolis
game_type: simulation
platforms: browser
created: 2026-07-17
updated: 2026-07-17
builds_on: ../../design/gdd-cockroach-infestation-2026-07-16.md
state: draft
---

# Housekeeping & Cockroach Overhaul

## Executive Summary

Verticopolis already models hotel-room cleanliness, a 3-day dirty-to-infested
lifecycle, and a Classic/Modern recovery split (shipped v1.53.0). Live playtesting
on a real 91-floor tower exposed that the housekeeping engine underneath it
diverges from the 1994 original and, worse, hides its own failure from the player:
the tower drowned in cockroaches while every readout said "enough housekeeping."

This overhaul makes housekeeping (a) faithful to SimTower canon, (b) a
time-simulated system the player can watch and reason about, and (c) honest about
when it is losing. It replaces an abstract per-unit capacity counter with real
maids who walk the staff network and spend time cleaning, so throughput emerges
from placement and transport rather than a hidden cap. It corrects the cockroach
spread rule to canon (only infested rooms spread), and it keeps the Classic/Modern
split clean: Classic restores 1994 fidelity, Modern layers deterministic "smart
management" tools on top.

## Target Platform

Web (existing Verticopolis build; TypeScript + Excalibur.js). No new platform work.

## Target Audience

Existing Verticopolis players; SimTower veterans who expect 1994 parity in Classic
and quality-of-life management tools in Modern.

## Goals and Context

- **Restore canon fidelity** in Classic so the mechanic behaves like the original
  players remember.
- **Make throughput emergent and visible** so "why isn't this room clean?" is
  answerable by watching the tower, not by reading source.
- **Stop the readouts from lying** so a player is warned while a wing is savable,
  not after it is terminal.
- **Preserve determinism** (golden-master save hashes) and the Classic/Modern
  rule-set isolation (no mode branching in the engine body).

Non-goals: reworking non-hotel cleaning (offices/condos never need housekeeping),
elevator/transport redesign, or any machine-learning dispatch (explicitly
rejected; see Out of Scope).

## Unique Selling Points

- Housekeepers you can **watch work** the floors, at a normal pace, cleaning rooms
  over real time instead of teleporting them clean.
- **Canon-faithful Classic** housekeeping (6 maids per unit, one per floor, service
  elevator or stairs, 12:00-17:00 shift) versus a **Modern "smart management"** upgrade
  that triages the rooms about to be lost.

## Core Gameplay

### Pillars

1. **Legible consequence.** Every housekeeping outcome (clean, falling behind,
   terminal) is visible on the tower and named in the UI. The player can always
   locate the problem and knows the fix.
2. **Emergent throughput.** How many rooms get cleaned is a *result* of crew
   count, crew placement, and staff transport, simulated in time, not a hidden
   constant. Good logistics is the skill.
3. **Faithful-Classic, empowered-Modern.** Classic is the 1994 mechanic, warts
   and pressure intact. Modern keeps the same world but hands the player better
   tools, never a different physics.

### Core Loop (housekeeping slice)

Guests check out in the morning -> rooms go `dirty` -> maids walk the staff
network during the shift and spend time cleaning each room -> cleaned rooms re-let
-> rooms left dirty 3 straight days turn `infested` -> infested rooms spread to
neighbors and can only be removed (Classic bulldoze / Modern exterminator). The
player closes the loop by placing enough crews with fast enough staff transport,
and (Modern) by triaging and exterminating.

### Win / Loss (local)

There is no global win/loss here; the local failure state is an infested wing that
can no longer be recovered by cleaning, forcing bulldoze/exterminate and lost
revenue. The design goal is that this failure is always *foreseen*, never a
surprise.

## Game Mechanics

All numbers below are the design targets. Items tagged `[NOTE FOR DESIGNER]` are
balance constants to tune during implementation so the emergent rate matches the
canon anchor (~19 rooms per maid on a compact, well-connected hotel).

### 1. Time-simulated maids (both modes)

- A **Housekeeping unit fields 6 maids** (canon), each an individual staff actor
  on the crowd/motion layer. Replaces the abstract `HK_ROOMS_PER_CREW = 20`
  per-unit capacity counter.
- Maids **each work a separate floor** at a time (canon: 6 maids -> up to 6
  floors), so broad coverage needs multiple units plus staff transport.
- A maid **walks at normal pedestrian pace** and travels **only** by service
  elevator or stairs. Not passenger elevators. **Not escalators** (canon
  correction: drop `escalator` from the staff transport set).
- Cleaning is **not instant on arrival**. A maid **dwells** in the room for a
  per-room cleaning time, then the room becomes clean, then she picks her next
  room. `[NOTE FOR DESIGNER]` dwell target: choose so travel + dwell yields ~19
  rooms/maid across the Classic ~4.5h working window on a compact hotel (implies
  ~14-16 min/room including travel; pure dwell likely ~6-10 min, the remainder
  travel). Pin and test the constant.
- **Throughput is emergent:** a maid on a tightly-served floor approaches ~19/day;
  a maid on a far, stair-only floor does far fewer. There is no per-unit hard cap.

### 2. Shift window

- **Classic:** maids work **12:00-17:00**, and **start no new room after 16:30**
  (canon). Rooms not cleaned by 17:00 stay dirty until tomorrow.
- **Modern:** longer **08:00-19:00** working day, framed as the payoff of modern
  staffing management. Same 30-minute "no new room" tail before end of shift.
- Mode-specific windows resolve through `GameRules`, not an engine-body branch.

### 3. Dirty -> infested lifecycle (unchanged from shipped feature)

- A hotel room `dirty` for **3 consecutive in-game days** (`INFEST_DAYS = 3`)
  becomes `infested` at the daily checkout boundary. Per-room `dirtyDays` counter,
  serialized. (Carried from `gdd-cockroach-infestation-2026-07-16.md`.)

### 4. Cockroach spread (corrected to canon; one rule, both modes)

- **Spread source = `infested` only.** Merely `dirty` rooms **do not spread**
  (canon: "cockroach-infested rooms spread"). This removes the non-canon
  dirty-room spread that fired "cockroaches spread" alarms on towers with zero
  infested rooms.
- An infested room spreads horizontally to **adjacent hotel rooms regardless of
  clean or dirty state** (canon: spreads even into clean rooms, can cross a whole
  floor if unchecked).
- **Spread never evicts a live guest.** A spread that reaches an occupied
  (`asleep`) room **marks** the room but leaves the guest to finish the stay; the
  room goes `dirty` at checkout like any other. (Party ratification: keeps the
  challenge, removes the mid-stay rug-pull that read as a bug.) `[NOTE FOR
  DESIGNER]` decide whether a spread-marked occupied room shows an early roach cue
  before checkout, or only after.
- Spread stays **horizontal** (same floor); vertical spread is out of scope here
  (fire already climbs; roaches do not, matching canon).
- **Supersedes the prior doc's spread line.** The doc this builds on,
  `gdd-cockroach-infestation-2026-07-16.md`, described the spread source as a
  "dirty-or-infested" room; canon research (see the decision log) corrected that
  to infested-only. This GDD is the source of truth for the spread rule, and the
  prior doc's Spread line is superseded (the canon fix that ships this change adds
  a matching SUPERSEDED note there).

### 5. Recovery (unchanged; mode-gated via GameRules)

- **Classic:** infested is terminal; bulldoze and rebuild only.
- **Modern:** paid exterminator ($5,000 call-out + $2,000 per infested room,
  resolves next day), or bulldoze. (Carried from the shipped feature.)
- **Housekeeping never cleans an infested room** in either mode (dispatch targets
  `dirty` only). This is the single most important fact to surface (see
  Legibility).

### 6. Dispatch order

- **Classic:** opportunistic, one maid per floor, no priority engine. A light
  "dirtiest-first" tiebreak is acceptable (canon leaves the algorithm
  undocumented). Faithful to the original's automatic, unglamorous behavior.
- **Modern:** **smart triage.** Choose the next room by a **priority score that
  combines `dirtyDays` (urgency) with travel cost (reachability)**, so the
  dispatcher rescues rooms about to infest without commuting the whole shift to a
  distant room. `[NOTE FOR DESIGNER]` pin the urgency-vs-travel weight and test
  it; determinism requires a fixed, ordered tiebreak. Resolves through
  `GameRules` like the exterminator. **Not** a neural net (see Out of Scope).

## Simulation-Management Specific Design

### Agent model

Maids are first-class staff actors with states: `idle-at-unit`, `traveling`
(over the staff graph), `cleaning` (dwelling in a room), `returning`. A maid holds
at most one room assignment at a time; assignment is released on completion or
give-up. Determinism: all selection and tiebreaks are ordered and seed-free; no
`Math.random`/`Date.now` on the path.

### Economy coupling

- Cleaned rooms re-let and earn; dirty/infested rooms earn nothing (existing).
- Emergent throughput changes how many rooms are rentable per day, so this system
  affects hotel income. The golden-master hashes must be re-pinned when the model
  changes; a single spread engine keeps that to one re-pin, not two.

### Balance anchor

Compact, well-connected hotel: ~19 rooms/maid/day (canon). Spread-out, stair-only
hotel: materially fewer, and the UI must show it (see Legibility). `[NOTE FOR
DESIGNER]` full balance pass belongs in `gds-create-epics-and-stories` /
implementation; capture the resulting constants back here.

## Progression and Balance

No new progression tier. This overhaul re-tunes an existing mechanic toward canon
and adds a Modern management upgrade. The difficulty delta (stronger per-unit
throughput, but tighter Classic shift and no escalators, and spread only from
infested) should net to "fair and legible," verified in playtest.

## Legibility Layer (first-class scope, not polish)

The throughput failure is currently invisible; these make it visible and honest.

- **Staff read as staff.** Maids render with the distinct staff sprite on floors
  and in cars (the sim already bakes one; tenants are already hidden while
  riding). No colorful figure in a service car is ever mistaken for a tenant.
- **Watchable cleaning.** Because maids are time-simulated, the player sees them
  walk in, dwell, and leave a room clean. This falls out of the agent model.
- **Infested = terminal, stated plainly.** The infested-room inspector says
  housekeeping can no longer clean it and names the only fix (bulldoze in Classic;
  exterminate or bulldoze in Modern). No more "there is a service elevator right
  there" confusion.
- **The "enough housekeeping" verdict stops lying.** The stats readout must not
  show green while `infested > 0`; an active infestation is a red/at-risk state,
  not "adequate." It must not compute adequacy by subtracting the infested rooms
  out of the workload.
- **Infested gets its own overlay color.** The Housekeeping overlay must render
  infested distinctly from "unreached" (today both sit on the same red ramp), so
  "reached but terminal" never reads as "no coverage."
- **Infested alerts carry location.** The bulletin/alert names where (floors), or
  offers a locate/jump, instead of a bare count.
- **Non-hotel rooms read as not-applicable.** Condos (and other non-hotel rooms
  with beds) get a neutral "n/a" treatment in the Housekeeping overlay so a blank
  never reads as an uncovered hotel room.

## Technical Specifications (GDD-level)

- **Determinism preserved:** no `Math.random`/`Date.now` on the dispatch/motion
  path; all ordering seed-free and stable. Golden-master save hashes re-pinned
  once when the model lands.
- **Rule-set isolation:** every Classic/Modern divergence (shift window, dispatch
  objective, recovery) resolves through `GameRules`; the engine body never
  branches on the mode string.
- **Save compatibility:** the maid model is runtime/transient; persisted room
  state (`state`, `dirtyDays`, `exterminationDueDay`) is unchanged, so no save
  break is expected. Confirm during architecture.
- **Performance:** 6 maids per housekeeping unit are individual actors; a large
  tower may field many. Target no regression to the existing crowd/motion frame
  budget; reuse the existing staff-trip crowd path.
- American English; no em-dashes in new prose.

## Development Epics (summary)

Detailed breakdown in `epics.md` (to be authored via
`gds-create-epics-and-stories`). Proposed sequence:

1. **Canon spread fix (small, high-value):** spread source = infested only; never
   evict a live guest. Kills the false-alarm spam and the eviction feel-bad first.
2. **Time-simulated maids (Classic core):** 6 maids/unit, one-per-floor, walk
   service/stairs (drop escalators), per-room dwell, clean-after-dwell; remove the
   `HK_ROOMS_PER_CREW` cap; Classic 12:00-17:00 window + 16:30 cutoff.
3. **Legibility layer:** staff-read-as-staff, infested terminal copy, "enough"
   verdict fix, infested overlay color, infested alert location, condo n/a shade.
4. **Modern smart dispatch:** days-dirty-weighted-by-travel triage via GameRules;
   Modern 08-19 window.

Each implementation PR runs `/gds-code-review` (adversarial layers) per project
non-negotiables. Balance constants tuned in-epic and recorded back here.

## Success Metrics

- On a compact, well-connected hotel, a maid cleans ~19 rooms/day (canon anchor).
- A tower that is under-served shows the shortfall in the UI *before* rooms turn
  terminal (no "enough housekeeping" green during an active infestation).
- Zero player reports of "guests booked/evicted from dirty rooms" (spread no
  longer evicts) and zero "cockroaches spread" alarms on towers with no infested
  rooms (spread source = infested only).
- Determinism: golden-master hashes stable after the one intended re-pin.

## Out of Scope

- **Neural-net / learned dispatch.** Rejected: breaks determinism (golden-master
  hashes) and legibility (black-box "why isn't this cleaned?"); the problem is a
  solved scheduling/assignment task better served by deterministic heuristics. If
  learning were ever wanted, it would be offline parameter tuning baked to
  constants, never live inference.
- Vertical cockroach spread (roaches stay horizontal, per canon).
- Housekeeping for non-hotel rooms (offices/condos never need it).
- Elevator/transport redesign beyond removing escalators from the staff set.
- Modern re-writing the spread physics (spread is one rule both modes).

## Assumptions and Dependencies

- `[ASSUMPTION]` the existing staff-trip crowd/motion path can carry 6
  time-simulated maids per unit within the current frame budget; confirm in
  `gds-game-architecture`.
- `[ASSUMPTION]` per-room dwell + emergent throughput will not require a save
  schema change (maid state is transient); confirm in architecture.
- Depends on the shipped cockroach-infestation feature
  (`gdd-cockroach-infestation-2026-07-16.md`) and the `GameRules` rule-set seam.

## Open Items

- `[NOTE FOR DESIGNER]` exact per-room dwell constant (tune to ~19/maid on a
  compact hotel).
- `[NOTE FOR DESIGNER]` Modern dispatch urgency-vs-travel weight (pin + test).
- `[NOTE FOR DESIGNER]` whether a spread-marked occupied room shows an early roach
  cue before checkout.
