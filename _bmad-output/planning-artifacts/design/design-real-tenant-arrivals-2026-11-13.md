---
title: Real tenant arrivals (a unit counts only the people who got there)
status: draft for owner review
created: 2026-11-13
related: "#2092 (real residents you can click), #2091 and PR #2104 (decorative walkers), #2116 (people look, 3.7.1), #2051 (car stops and the original's car timing)"
---

# Real tenant arrivals

## The problem

An office's head count follows the clock. `Simulation::update_presence`
(`engine-rs/src/presence.rs`) sets an office to its full 6 from 8 AM to 6 PM
on weekdays and to 0 otherwise. Condos, apartments, studios and hotel rooms
work the same way, each with its own clock rule. The people you see walking
are a separate crowd (`engine-rs/src/crowd/`, capped at `MAX_PEOPLE` = 140),
spawned at random from weighted trip options, and nothing they do moves that
head count. Venues are the one exception: since the venue people routing GDD
(2026-07-14), a party hall's, cinema's or wedding hall's attendance is the
people who actually arrived.

So on Naftali's split tower, the offices on floor 34 above the three-story sky
lobby on 30 went to 6 of 6 between 7 and 8 AM while nobody used the stairs or
the escalator to get there.

The clock-driven head count feeds more than the room art:

- `spawn_floors` (the "staffed offices" list that evening departures and lunch
  trips draw from),
- the elevator demand estimate (`dispatch.rs`, `accumulate_waiting`, which
  grows each served floor's waiting count from `occupants`),
- the room card, telemetry and the TDT export.

It does not feed the rating census: `Unit::census_count` reads
`resident_count`, the unit's tenants, so population and stars are untouched by
anything in this note.

## How the original does it

The 1994 game simulates every tenant as a person. A `.TDT` carries a people
block of 16-byte records (`docs/canon/tdt-byte-map.md`, section 4): each has
its home floor, unit and slot (an office has 6 slots, a condo 3), a current
floor (negative means outside the tower), walking, waiting and goal state, and
a stress value. Elevator queues hold up to 40 person indices per direction per
floor, and a car holds up to 42 passenger indices. An office is occupied
because its 6 people are on its floor, having walked in and ridden there.

What we do not know yet, and must measure before Classic changes:

1. When workers leave "outside" and when the office fills (the spread of
   arrival times, and whether it moves with transport load).
2. What a worker does when the wait is long: wait forever and get stressed,
   or give up and go home.
3. Whether a worker who cannot reach the office at all (a route removed after
   move-in) ever appears in it.
4. When they leave in the evening, and whether lunch takes them out of the
   office (our meal trips already do this through `out_for_meal`).

These go into a new PC batch (see "Measurement first" below), in the same
style as `docs/canon/classic-parity-pc-test-spec.md`.

## The options

**A. Every tenant is a full crowd person.** Lift the 140 cap and route every
tenant through the existing crowd (walk, wait, ride, per-frame motion). This
is closest to the original, but it multiplies the crowd's per-step cost by up
to a hundred at 15,000 population, and every person goes into the frame the
renderer reads. It is the most expensive path on the hot path and the frame
layout.

**B. A tenant roster that travels for real, with the crowd as its view
(recommended).** The engine keeps one small record per tenant slot: home
unit, slot, where they are (away, on a leg of a trip, or in the unit) and
stress. A trip is the same route the crowd uses today (at most two rides,
`routing.rs`). Walking legs take their real walking time; waiting is a real
place in the hall queue of the shaft on the route; riding is a real seat in
a real car, so car capacity and the dispatch decide when they get there.
The roster moves on events (leg ends, a car opening at a stop), not on a
per-step scan, so its cost follows the number of trips. A unit's head count
is a counter the roster keeps, and `update_presence` reads it for the kinds
that move over. The drawn crowd then shows roster members who are on the
move, up to the renderer's budget, so the people you see are the people who
fill the room.

**C. Keep the clock, add reachability and a delay.** The office fills at the
clock time plus an estimated travel time, and only if a route exists. It is
cheap, but nobody is still seen arriving, so it does not answer the ask.

## The plan (option B)

### Rules

- A tenant is counted in a unit only while their record says they are there.
  Nothing else sets the head count for a kind that has moved to the roster.
- A trip starts from the tower's entrances: the ground lobby, a Metro
  platform, or (Modern) a parking space for homes with parking. The share
  between them follows today's spawn weights, not a new tuning.
- A tenant with no route does not arrive. The room card says why (the
  existing unreachable copy, no new gripe).
- Riders count against car capacity and create the hall and cab calls the
  dispatch already answers. A unit on the roster stops contributing to the
  statistical estimate in `accumulate_waiting`, which works per unit, so a
  floor that mixes roster and non-roster units is never counted twice. A test
  that fails on double counting guards it.
- The roster freezes during the bomb search, like the crowd (#2113).
- The room card says how many are here and how many are on the way, in words,
  so the state does not depend on watching people walk.
- No car speed, stop length or SCAN rule changes here. Those wait for the
  original's car timing measurement (#2051).
- Classic follows the measured original once the PC batch is in. Until then
  Classic keeps today's departure window (arrive from 8 AM, leave from 6 PM).
  That window is today's behavior, not sourced canon, and is labeled so in
  the code until batch R replaces it.
- Modern may add its own rules later (staggered shifts, give-ups), each
  behind a named rule in `rules.rs`.

### Saves

The original rebuilds its crowd on load, and today our crowd is never saved
either. The roster drives the head count, though, so dropping it on load would
teleport people. The plan saves it: one compact location per tenant slot,
added as a new field. Loading a save without it places everyone where the
clock rule puts them at that hour (the one place the old rule survives), so
every existing save opens. The groundwork PR settles whether the field needs
a `SAVE_VERSION` bump, and ships a test that saves at 7:45 AM with people mid
commute, loads, steps two game hours and matches the run that never saved,
plus a fixture proving a 3.7.0 save opens.

### Performance

- No per-step scan over the roster. Events sit in a time-ordered queue; a
  unit's head count is a counter. `update_presence` reads counters for roster
  kinds.
- Budget: the 5,000-population and 15,000-population towers keep today's step
  time within the hot-path tier (`docs/performance/hot-path-review.md`), and
  the first PR carries the section 6 record with a before and after
  measurement on the fixed-step benchmark.
- The roster has its own random stream, so the crowd's existing draws do not
  shift for towers the change does not touch.
- Events order by (tick, roster id), never by insertion order, so native and
  WASM builds hash the same.
- PR 3 states step time at 5,000 and 15,000 population on the low-end profile.

### Conformance and versions

Every tower with offices moves its step hashes, so the conformance lock, the
crate version and the engine guides move with the PR that flips offices.
Change notes declare `app: minor` (players see people actually arriving) and
the crate tier.

### Relation to #2092

#2092 wants real residents you can click, with home, destination, stress and
wait. The roster is that data. This work builds the engine half (who a person
is, where they live or work, where they are going); #2092 keeps the person
inspector and the renderer's people budget, and starts after the roster ships.
The two share one roster, so #2092's step 1 shrinks to exposing roster fields
in the frame.

Decorative walkers (#2091, PR #2104) stay as they are: off by default, none in
Classic. Once commuters are real, the decorative setting has less to do, and
whether it stays is a later call.

## PR sequence

1. **Measurement first (PC batch R).** Office arrivals, give-ups, unreachable
   offices, evening departures and what happens to the 41st person in a full
   hall queue (the original holds 40 per direction per floor), on the owner's
   PC, with his go. No code.
2. **Roster groundwork.** The record, the event queue, save and load, the
   clock-rule placement for old saves. No behavior change: the roster mirrors
   the clock rule and nothing reads it yet. Tests: round trip, old-save load,
   determinism.
3. **Offices arrive for real.** Office head counts come from the roster;
   office riders make real calls; lunch trips (`out_for_meal`) move onto the
   roster. The room card's "here and on the way" line. Conformance lock and
   crate version move. Hot-path record, and a headless economy
   before-and-after (lunch traffic follows staffed offices).
   Removal cases each get a test: bulldoze, transport deleted mid-ride,
   eviction mid-commute, mode switch.
4. **The crowd shows roster commuters.** The renderer feed changes from random
   commute spawns to roster members in transit. This touches what the people
   look thread owns, so it waits until #2116 has shipped and is planned with
   that thread.
5. **Homes and hotels.** Condos, apartments, studios, then hotel guests
   (check-in and check-out trips), one PR each.
6. **#2092** builds the inspector on the roster.

## Party review

The Engine Room and the Player Panel reviewed this note on 2026-11-13
(`_bmad-output/party-mode/real-tenant-arrivals-party-findings-2026-11-13.md`).
Their changes are folded in above.

## Open questions for the owner

1. Option B, or one of the others?
2. Run the PC measurement batch before Classic changes beyond "must actually
   get there", or accept today's 8 AM to 6 PM window as Classic for now?
3. Start PR 2 while the PC batch is pending? It changes no behavior, so it
   does not depend on the measurement.
