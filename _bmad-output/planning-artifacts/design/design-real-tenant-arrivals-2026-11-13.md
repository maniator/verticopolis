---
title: Real tenant arrivals (a unit counts only the people who got there)
status: owner chose option A (every tenant a full walker), 2026-11-13
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

## The options, and the owner's choice

Three options went to the owner on 2026-11-13:

- **A. Every tenant is a full crowd person**: walks, waits, rides and moves
  frame by frame like today's crowd, as in the original.
- **B.** A lighter tenant roster that rides real cars but moves on events,
  with the drawn crowd as its view.
- **C.** Keep the clock, add a route check and a travel delay.

**Naftali chose A** (2026-11-13, 23:33 UTC). The rest of this note is the
plan for A. B's bookkeeping ideas (per-unit head-count counters, a saved
location per tenant, a separate random stream) carry over, because A needs
them too.

## What A costs today (measured)

A scratch probe (kept at the project files, `real-arrivals/`) loaded three
towers, filled the crowd to a fixed size with lobby and tenant-floor trips,
and timed `Simulation::tick(0.25)` (one 60 Hz frame at 15 game minutes per
second) and `frame::frame_view`. Native release build, one core of a 2.1 GHz
Xeon, 240 steps per row:

| Tower (population) | People moving | Step, mean | Step, worst | Frame build | Frame size |
| --- | --- | --- | --- | --- | --- |
| sixseven_2 (3,219) | 140 (today's cap) | 0.09 ms | 3.2 ms | not captured | not captured |
| sixseven_2 | 1,000 | 0.35 ms | 3.8 ms | not captured | not captured |
| sixseven_2 | 5,000 | 2.0 ms | 6.4 ms | not captured | not captured |
| sixseven_2 | 15,000 | 6.2 ms | 25.2 ms | not captured | not captured |
| split-tower (495) | 140 | 0.04 ms | 0.3 ms | 0.13 ms | 346 KB |
| split-tower | 1,000 | 0.16 ms | 0.5 ms | 0.39 ms | 1.4 MB |
| split-tower | 5,000 | 1.0 ms | 2.5 ms | 2.5 ms | 3.9 MB |
| large (17,314) | 140 | 0.11 ms | 13.8 ms | 0.91 ms | 2.2 MB |
| large | 5,000 | 1.4 ms | 10.7 ms | 3.7 ms | 4.7 MB |
| large | 15,000 | 5.2 ms | 15.3 ms | not captured | not captured |

What that says:

- **The step grows linearly**, about 0.35 to 0.4 microseconds per moving
  person per step. There is no quadratic cliff to fix first.
- **The frame is the real problem.** `frame_view` writes every person every
  frame (about 20 numbers each), so 5,000 movers add about 2.5 MB and 2.5 ms
  to every frame before the renderer touches it.
- Routing a new trip costs 7 to 13 microseconds, so 15,000 tenants making
  two trips a day is about 0.3 s spread over a game day. Not a concern.
- These are native numbers. WASM in a browser and the low-end laptop profile
  are slower, and fast speeds run up to 4 steps a frame
  (`MAX_STEPS_PER_FRAME`), so the browser budget is tighter than the table.

How many move at once matters more than population. A tenant at work or at
home is not moving and must cost nothing. A normal rush moves a few hundred
to a couple of thousand people in a big tower; a transport jam, where most
office workers are queued at once, is the worst case (5,000 to 9,000 in a
15,000 tower).

## The plan (option A)

### Rules

- Every tenant slot is one person, created when the unit is rented and
  removed when it empties: an office has 6, a condo 3, and so on from the
  catalog's population. They are saved with the tower.
- A person is in one of three places: inside their unit, outside the tower,
  or on a trip. Only people on a trip are in the moving list. The others
  are parked and cost nothing per step.
- A unit's head count is the number of its people inside it, kept as a
  counter. `update_presence` reads that counter for every kind that has
  moved over; nothing else sets it.
- Tenant trips (commute, lunch, school runs, sales calls, and later hotel
  check-in and check-out) are made by those people, replacing today's random
  commute spawns. Visitors who are not tenants (shoppers, diners from
  outside, cinema and hall audiences, Metro visitors) stay as today's spawned
  crowd, like the original's visitors.
- A trip starts from the tower's entrances: the ground lobby, a Metro
  platform, or (Modern) a parking space for homes with parking. The share
  between them follows today's spawn weights, not a new tuning.
- A tenant with no route does not arrive. The room card says why (the
  existing unreachable copy).
- Riders already use real cars and real calls. A unit whose people travel
  stops contributing to the statistical estimate in `accumulate_waiting`
  (which works per unit), so no floor is counted twice. A test that fails on
  double counting guards it.
- Giving up changes meaning: today a crowd person who waits too long
  vanishes. A tenant cannot vanish, so a give-up sends them back where they
  came from and counts against the unit's evaluation. Whether Classic tenants
  give up at all is a measurement question (batch R).
- The tenants freeze during the bomb search, like the crowd (#2113).
- The room card says how many are here and how many are on the way, in words.
- No car speed, stop length or SCAN rule changes. Those wait for the
  original's car timing measurement (#2051).
- Classic follows the measured original once batch R is in. Until then
  Classic keeps today's window (arrive from 8 AM, leave from 6 PM), labeled
  in the code as today's behavior pending batch R, not as canon.

### Performance work that comes first

1. **A scale benchmark.** The probe becomes a committed, ignored test (or a
   `conformance` bin mode) that prints the table above, so every later PR can
   show its before and after. It also runs in the browser build for WASM
   numbers.
2. **A people budget in the frame.** The frame carries at most a fixed number
   of people (proposed 2,000), chosen by the host's view rectangle so the
   people you can see are the ones sent, plus per-floor queue counts so a
   jam still reads as a crowd. This is the frame layout and the renderer's
   input, so it is planned with the "Make NPCs look more human" thread and
   starts after #2116 ships. It is also #2092's renderer budget.
3. **Parked tenants.** People inside a unit or outside the tower live outside
   the moving list, so the step costs what the movers cost.
4. **Per-mover trims where the measurement points.** `elevator_calls`,
   `landing_slots` and `advance` each walk the movers every chunk; the
   benchmark says which of them is worth an index or a counter. No trim
   without a measured before and after.

Budget to hold (proposed, to be confirmed against WASM numbers in step 1): at
15,000 population with a full morning rush, the engine's share of a 60 Hz
frame stays under 4 ms in the browser on the low-end profile, and a jam of
9,000 movers stays under 8 ms. Every PR on this path carries the section 6
hot-path record.

### Saves

The tenants are saved: per person, the place (inside, outside, on a trip)
and, for a trip, enough to resume it (origin, destination, leg, and position
on the leg). Loading a save without them creates each unit's people and
places them where today's clock rule puts them at that hour, the one place
the old rule survives, so every existing save opens. The groundwork PR
settles the `SAVE_VERSION` question and ships a test that saves at 7:45 AM
with people mid trip, loads, steps two game hours and matches the run that
never saved, plus a fixture proving a 3.7.0 save opens.

### Determinism

Tenant people take their trip decisions from their own random stream, so the
visitor crowd's draws do not move for towers the change does not touch. Their
order in the moving list is by person id, so native and WASM builds hash the
same.

### Conformance and versions

Every tower with offices moves its step hashes, so the conformance lock, the
crate version and the engine guides move with the PR that flips offices.
Change notes declare `app: minor` (players see people actually arriving) and
the crate tier.

### Relation to #2092 and the walkers

#2092 wants real residents you can click. Under A, every tenant is already a
real person with a home, a destination and stress, so #2092 becomes the
inspector plus the frame fields it reads, built on the people budget from
step 2. Decorative walkers (#2091, PR #2104) stay off by default and absent
in Classic; whether they stay once commuters are real is a later call.

## PR sequence

1. **Measurement first (PC batch R).** Office arrivals, give-ups, unreachable
   offices, evening departures and what happens to the 41st person in a full
   hall queue (the original holds 40 per direction per floor), on the owner's
   PC, with his go. No code.
2. **The scale benchmark.** No behavior change.
3. **The frame's people budget.** After #2116, with the people look thread.
   Moves the frame layout and the crate version.
4. **Tenant groundwork.** Persistent tenant people, parked, saved, placed by
   the clock rule on old saves. They mirror the clock: no behavior change,
   nothing reads them yet. Tests: round trip, old-save load, determinism,
   and the step cost unchanged with everyone parked.
5. **Offices arrive for real.** Office head counts come from their people;
   commute and lunch trips are theirs; the room card line; conformance lock
   and crate version move; hot-path record; a headless economy
   before-and-after (lunch traffic follows staffed offices); a test for each
   removal case (bulldoze, transport deleted mid-ride, eviction mid-trip,
   mode switch).
6. **Homes, then hotels**, one PR each.
7. **#2092**, the inspector.

## Party review

The Engine Room and the Player Panel reviewed the first draft on 2026-11-13
(`_bmad-output/party-mode/real-tenant-arrivals-party-findings-2026-11-13.md`).
Their changes (one demand source per unit, deterministic order, the bomb
search freeze, the removal tests, the saved round-trip test, the room card
line, labeling the Classic window, measured step times) all carry into
option A above.

## Open questions for the owner

1. Run PC batch R before Classic timing changes, or accept today's 8 AM to
   6 PM window as Classic for now?
2. Is a 2,000-person frame budget, chosen by what is on screen, acceptable?
   More people can be drawn later once WASM numbers are in.
3. Start the scale benchmark now? It changes no behavior.
