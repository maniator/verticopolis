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

`engine-rs/src/bin/crowd_scale.rs` loads three towers, keeps the crowd
topped up to a fixed size with lobby and tenant-floor trips, and times
`Simulation::tick(0.25)` (one 60 Hz frame at 15 game minutes per second) and
`frame::frame_view` (built once, with the crowd full). Run it with
`cargo run --release --features conformance --bin crowd_scale`. Native
release build, one core of a 2.1 GHz Xeon, 240 steps per row, 2026-11-13:


| Tower (population) | Crowd size | Moving (mean) | Step mean | Step worst | Frame build | Frame size | Route each |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sixseven_2 (3219) | 0 | 23 | 0.054 ms | 2.615 ms | 0.250 ms | 576 KB | none |
| sixseven_2 (3219) | 140 | 140 | 0.099 ms | 4.069 ms | 0.269 ms | 592 KB | 23.3 us |
| sixseven_2 (3219) | 1000 | 1000 | 0.431 ms | 5.378 ms | 0.314 ms | 746 KB | 11.1 us |
| sixseven_2 (3219) | 5000 | 5000 | 2.062 ms | 7.511 ms | 0.443 ms | 1454 KB | 9.4 us |
| sixseven_2 (3219) | 15000 | 15000 | 5.916 ms | 10.894 ms | 2.294 ms | 3223 KB | 7.5 us |
| split-tower (495) | 0 | 0 | 0.008 ms | 0.403 ms | 0.031 ms | 91 KB | none |
| split-tower (495) | 140 | 125 | 0.027 ms | 0.326 ms | 0.080 ms | 125 KB | 3.4 us |
| split-tower (495) | 1000 | 894 | 0.223 ms | 0.606 ms | 0.136 ms | 327 KB | 4.2 us |
| split-tower (495) | 5000 | 4471 | 0.801 ms | 1.455 ms | 0.350 ms | 1269 KB | 3.3 us |
| split-tower (495) | 15000 | 13414 | 2.589 ms | 5.948 ms | 1.456 ms | 3634 KB | 2.8 us |
| large (17314) | 0 | 127 | 0.106 ms | 9.853 ms | 0.964 ms | 2057 KB | none |
| large (17314) | 140 | 140 | 0.082 ms | 8.060 ms | 0.778 ms | 2057 KB | 38.1 us |
| large (17314) | 1000 | 1000 | 0.242 ms | 8.626 ms | 0.925 ms | 2210 KB | 12.3 us |
| large (17314) | 5000 | 5000 | 1.552 ms | 12.713 ms | 2.486 ms | 2921 KB | 9.0 us |
| large (17314) | 15000 | 15000 | 4.565 ms | 13.997 ms | 3.063 ms | 4698 KB | 7.7 us |

What that says:

- **The step grows linearly**, about 0.3 to 0.4 microseconds per moving
  person per step. There is no quadratic cliff to fix first.
- **The frame grows with every person.** `frame_view` writes every person
  every frame (about 23 numbers each, about 0.18 KB), so 15,000 people add
  about 2.6 MB and 2 to 3 ms to every frame before the renderer touches it,
  and the renderer then reads all of it.
- The worst steps (8 to 14 ms on the large tower even with no crowd) are the
  hourly and daily work, not the crowd. They are worth their own look.
- Routing a new trip costs 3 to 12 microseconds, so 15,000 tenants making
  two trips a day is about 0.3 s spread over a game day. Not a concern.
- These are native numbers. WASM in a browser and the low-end laptop profile
  are slower, and fast speeds run up to 4 steps a frame
  (`MAX_STEPS_PER_FRAME`), so the browser budget is tighter than the table.

How many move at once matters more than population. A tenant at work or at
home is not moving and must cost nothing. A normal rush moves a few hundred
to a couple of thousand people in a big tower; a transport jam, where most
office workers are queued at once, is the worst case (5,000 to 9,000 in a
15,000 tower).

## Drawing a big crowd the way the original does

The owner asked to follow the original here (2026-11-13). What is known:

- The original draws every person as a small silhouette: walking on a floor,
  standing in a queue beside a shaft (those going up wait on one side, those
  going down on the other, per player guides), riding in a car, and inside
  venues (the owner's TOWER7 screenshot, `PK8-T7-screenshot-stage0.png` in
  the project files, shows shoppers and escalator riders drawn one by one).
  Stress shows as color: black, then pink, then red (player guides and FAQs).
- It draws what is in its scrolling tower window. No source or screenshot we
  have shows a separate cap on people, so the plan reads the window as the
  limit. This is inferred, and the PC look below checks the one place it
  matters (a full queue).
- A hall queue holds up to 40 people per direction per floor and a car up to
  42 riders (`docs/canon/tdt-byte-map.md`, the queue and car records).
- Not known: whether every one of 40 queued people is drawn, or the line is
  cut at the floor's width, and what happens to a 41st person. That is one
  observation on the owner's PC (a full lobby queue at the morning rush,
  counting figures against the Elevator Window's red number), added to the
  PC list below.

So the plan follows it: **no global people cap.** The frame carries every
person inside the host's view rectangle, the way the original's window does,
and queues draw as the original lines them up. To keep a zoomed-out view of
a 15,000-person tower affordable, the frame record per person shrinks to
what drawing needs (floor, position, look, state, stress), and the route
details (floors and shafts) leave the frame and are read on demand, by the
#2092 inspector. The target is a few numbers per person instead of about
23, so a zoomed-out view of the whole tower stays affordable; `crowd_scale`
measures it before and after.

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
  give up at all is an open question for a later PC look; until then Classic
  keeps today's patience.
- The tenants freeze during the bomb search, like the crowd (#2113).
- The room card says how many are here and how many are on the way, in words.
- No car speed, stop length or SCAN rule changes. Those wait for the
  original's car timing measurement (#2051).
- The times stay: offices fill from 8 AM and empty from 6 PM on weekdays, as
  today (owner, 2026-11-13). What changes is that the head count only rises
  as people get there, so a slow tower fills late and an unreachable office
  never fills.

### Performance work that comes first

1. **A scale benchmark.** `crowd_scale` (the table above), so every later
   PR can show its before and after. WASM numbers in the browser build come
   next, with the same towers and sizes.
2. **A view-sized, slimmer frame for people.** As the original does: the
   frame carries the people inside the host's view rectangle, with no
   separate cap, and each person's record shrinks to what drawing needs;
   route details are read on demand. This is the frame layout and the
   renderer's input, so it is planned with the "Make NPCs look more human"
   thread and starts after #2116 ships. It is also what #2092's inspector
   reads.
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
inspector plus the on-demand person read, built on the slimmer frame from
step 2. Decorative walkers (#2091, PR #2104) stay off by default and absent
in Classic; whether they stay once commuters are real is a later call.

## PR sequence

1. **The scale benchmark** (this PR). No behavior change.
2. **One PC look at the original** (with the owner's go): a full lobby queue
   at the morning rush, counting the figures drawn against the Elevator
   Window's red number, and what a 41st person does. No code. It settles how
   queues are drawn in step 3.
3. **The view-sized, slimmer people frame.** After #2116, with the people
   look thread. Moves the frame layout and the crate version.
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

## Owner answers (2026-11-13)

1. Keep the times: 8 AM to 6 PM on weekdays.
2. Draw big crowds the way the original does (above): no global cap, the
   view is the limit.
3. Build the scale benchmark now (this PR).
