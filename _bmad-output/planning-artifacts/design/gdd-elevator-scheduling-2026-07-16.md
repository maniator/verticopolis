# GDD: Elevator per-day-type scheduling (#305)

Status: draft for review. Spec-first; no engine code ships with this document.
Each phase in §9 lands later as its own PR under `/gds-code-review` (engine and
TDT round-trip are gameplay-parity concerns). This GDD expands the roadmap
`gdd-classic-modern-pricing-roadmap-2026-07-08.md` §4 and §7 (owner tiebreak:
FULL PARITY, behavior AND UI) and the backlog rows `elevator-scheduling` (#305,
the sim and TDT half) and `elevator-config-ui` (#352, the UI half). Its companion
is `arch-elevator-scheduling-2026-07-16.md`.

## 1. Problem

The 1994 game let a player script each elevator shaft: how many of its cars run
each hour, separately for weekdays and weekends, where idle cars wait, how close
a call has to be before an idle car answers (Waiting Car Response), and how long a
car holds at a floor before it departs (Standard Floor Departure). That per-shaft
schedule is real, shipped data: it lives in the 56-byte schedule block of every
elevator record in a `.TDT` save (`docs/canon/tdt-format.md` §8), plus 8 per-car
home floors later in the same record.

Verticopolis has none of it. Our elevators run a single automatic SCAN dispatch
with global timing and a derived idle floor; a player can add cars, set the served
span, and toggle stops, but cannot shape when or where the fleet runs. On import
we skip the schedule bytes (`tdtTail.ts` `r.skip(56)`); on export we write a fixed
default constant, so a scheduled 1994 tower loses its schedule on the round trip.
This is the last named Classic parity gap in the traffic system and the deepest
skill surface the optimization thread describes.

## 2. Current state (grounded)

- **Fleet model.** A shaft is a flat `Transport` struct (`src/engine/types.ts`):
  `cars` plus three parallel per-car arrays (`carPositions`, `carDir`, `carLoad`).
  A car is an index, not an object; it has position, direction, and load, and no
  other state. There is no per-shaft config object beyond the optional
  `skipFloors` express list.
- **Dispatch.** `ElevatorDispatch` is a simplified SCAN controller. It merges two
  demand channels per shaft: a decaying statistical `waiting` estimate and real
  routed `hall`/`cab` calls from the drawn crowd. Idle cars rest at `idleFloor`,
  derived every tick as the lowest lobby the shaft serves. Timing is two global
  constants (`CAR_FLOORS_PER_MINUTE`, `DWELL_MINUTES`); the second also feeds the
  rider patience budget. The dispatcher receives no clock or day-type today.
- **Shaft fairness (already shipped, #303/#446).** `route`/`staffRoute` spread
  each ride leg across the bank of equivalent same-kind shafts via a seeded draw.
  Scheduling layers on top of this; it does not reopen it.
- **TDT.** The 56-byte schedule block round-trips as a constant: import skips it,
  export writes `TDT_ELEVATOR_SCHEDULE_DEFAULT` (`0x01`x14, `0x05`x14, `0x00`x28,
  the one value observed in every sampled real save). The serviced-floors byte
  array already round-trips (as `skipFloors`); the 8 per-car home floors are read
  into `carPositions` on import but are not player-editable.
- **UI.** The transport editor card (`src/ui/templates/editor.ts`) offers add/
  remove car, configure stops, express/all-stops presets, extend, and sell. There
  is no schedule strip, no Waiting Car Response or Standard Floor Departure
  control, no home-floor setter, and no Simulate action. The whole surface is new.

## 3. Goals and non-goals

**Goals.**

1. A per-shaft schedule the player can author: how many cars run each hour, split
   weekday vs weekend, where idle cars wait, and the two response tunables
   (Waiting Car Response, Standard Floor Departure).
2. The scheduled fleet is what SCAN dispatches: the schedule decides how many cars
   are available and where they idle each hour; SCAN still routes the available
   cars to live calls. The schedule shapes supply, not moment-to-moment routing.
3. Round-trip the schedule through our own save and, as faithfully as our canon
   allows, through TDT import/export.
4. Classic exposes the full manual grid at 1994 semantics; Modern adds intent
   presets and optional auto-tune, with the raw grid behind an Advanced toggle.
5. Deterministic: the schedule is authored state, read the same way every tick; it
   adds no RNG draw and does not perturb the seeded crowd or economy streams.

**Non-goals.**

- Reproducing any 1994 pathfinding defect (e.g. the housekeeping "7+ floors breaks
  it" exploit). We model the intended behavior, not the bug.
- Making raw per-car micro-scheduling the primary Modern experience. The fun is a
  fleet pre-positioned for the rush, not a 40-slider ritual; Modern leads with
  intent presets and keeps the grid for fidelity (roadmap ruling).
- Byte-faithful reproduction of the 56-byte block's internal layout on the
  strength of recollection. Canon pins the block's size and one default value, not
  its per-hour decomposition (§10, open question O1); Phase 0 is a gated harness
  spike to establish the real layout before the exporter commits to one.

## 4. The model

### 4.1 The schedule object (per shaft)

Each elevator shaft gains one optional `schedule` describing its fleet policy:

- **`activeCars[dayType][hour]`**: the number of the shaft's cars that run in each
  of the 24 hours, authored separately for `weekday` and `weekend`. Range `0..cars`.
  An absent schedule (legacy, or a shaft the player never touched) means "all cars
  run every hour", which is exactly today's behavior, so nothing changes until the
  player authors a schedule.
- **`waitingCarResponse`**: how many floors closer to a call an idle car must be
  than the currently-assigned car before it will answer (a stepper; higher = idle
  cars stay put longer, lower = they jump on calls eagerly). Maps to SCAN's
  call-assignment threshold.
- **`standardFloorDeparture`**: how long a car holds at a served floor before it
  departs, in seconds (a stepper). Maps to a per-shaft dwell that overrides the
  global `DWELL_MINUTES` default when set.
- **`homeFloors[car]`**: the floor each idle car returns to and waits on (the TDT
  per-car home floors). Absent = today's derived lowest-lobby idle floor.

Serviced floors and the base/starting floor are the existing stops model; the UI
(§4.5) adds the per-floor Show toggle and the base-floor setter over it.

### 4.2 How the schedule interacts with SCAN

The schedule is a supply-and-positioning layer; SCAN is unchanged as the router.
Each hour, per shaft:

1. **Active count.** `activeCars[dayType][hour]` cars are "on shift"; the rest park
   at their home floor and are skipped by dispatch (they answer no calls, carry no
   statistical load). Which specific cars are on shift is deterministic (lowest car
   indices first) so the choice never draws RNG.
2. **Positioning.** On-shift idle cars rest at their `homeFloors` value (or the
   derived lowest lobby when unset), instead of all collapsing to the lowest lobby.
   This is what lets a player pre-stage cars up-tower for the down rush.
3. **Response.** `waitingCarResponse` tunes the existing call-assignment: an idle
   car takes a call only if it is at least that many floors closer than the car
   already assigned. `standardFloorDeparture` replaces the global dwell for this
   shaft.
4. **Routing is untouched.** The crowd still routes riders onto shafts via the
   two-ride BFS and the #303 bank balancer; SCAN still moves on-shift cars to the
   merged real+statistical calls. A schedule can starve a shaft (0 active cars an
   hour) but never reroutes riders, so reachability is unchanged: a floor served by
   a shaft stays "served" for routing even at 0 active cars (riders wait longer,
   they are not stranded). See invariants (§6).

### 4.3 Day type

`dayType` is `weekday | weekend`, resolved from the existing calendar
(`clock.isWeekend`), which both Classic (canon 3-day week) and Modern (real-world
week) already compute. The schedule stores two 24-hour rows; the live row is
chosen by the current day type. No new calendar concept is introduced.

### 4.4 Classic semantics vs Modern assistance

Both modes read the identical schedule object and the identical dispatch effect;
they differ only in how the schedule is authored and what advice is offered:

- **Classic**: the full manual grid, 1994 semantics, no advice. The player sets
  each hour's car count on the WD/WE strip, the two steppers, and the home floors.
  Classic withholds advice, never information: it still shows the true measured
  load, it just never tells the player what to set.
- **Modern**: three intent presets (Rush, Balanced, Feeder) that fill the grid to
  a sensible shape in one click, plus an optional per-shaft auto-tune that sets the
  active-car rows from the shaft's own measured hourly load. The raw grid stays
  available behind an Advanced toggle for players who want Classic-level control.

### 4.5 The per-shaft dialog (UI, #352)

A per-shaft modal dialog (DOM chrome, following the `uiBatchPricing` stateful
re-rendering pattern), opened from the transport editor card:

- A **WD/WE toggle** over a **24-hour strip**; each hour cell shows and sets the
  active-car count for the selected day type.
- A **Waiting Car Response** stepper and a **Standard Floor Departure** stepper.
- A scrollable **serviced-floors list** with a per-floor Show On/Off and a
  **base/starting-floor** setter (built over the existing stops model).
- A **Simulate** action that previews the schedule's effect (a live honest
  readout, e.g. projected coverage or worst-hour wait) without committing, then
  **OK** to apply. Modern adds the preset buttons and the auto-tune action; Classic
  shows the grid alone.
- Mobile adapts the clock strip and floor list to the phone layout, reusing the
  editor's mobile fold-in pattern and the shared title-bar close.

### 4.6 TDT round trip

- **Our save.** The `schedule` object serializes on the transport (optional-field
  seam alongside `skipFloors`), hardened on load, behind a `SAVE_VERSION` bump with
  a no-op backfill for older saves (absent = all cars every hour).
- **TDT import.** Read the 56-byte block and the 8 per-car home floors instead of
  skipping them, decode into the `schedule` object per the layout Phase 0
  establishes, and surface a `broughtOver`/`couldNotBring` line in the import
  report. Where the layout is not fully known, decode what is known and report the
  remainder honestly rather than guessing.
- **TDT export.** Encode the shaft's `schedule` back into the 56-byte block using
  the same layout, still guaranteeing the "cars actually run" safety property (a
  shaft with an all-zero hour must never export a block the 1994 game reads as
  "run no cars" for a shaft the player expects to work; the observed default block
  is the safety floor the export never writes below, matching invariant §6.5).
  Preserve the existing fixed-point guarantee: a second export/import is
  byte-identical.

## 5. Classic versus Modern

| Concern | Classic (fidelity) | Modern (opt-in assistance) |
| --- | --- | --- |
| Authoring | Full per-shift WD/WE grid, manual | Intent presets (Rush/Balanced/Feeder) + optional auto-tune; raw grid behind Advanced |
| Semantics | 1994 Waiting Car Response, Standard Floor Departure, home floors | Same underlying tunables and dispatch effect |
| Advice | None (true state shown, never what to do) | "This shaft is idle 9-11, understaffed at 17" style hints |
| Default | All cars every hour until authored | Same default; a preset is one click away |

The divergence (which authoring affordances and advice appear) rides a `GameRules`
seam, never a mode-string branch (arch §5). The dispatch effect of a given
schedule is identical in both modes: a schedule authored in Classic and imported
into a Modern tower behaves the same.

## 6. Invariants the build must preserve

1. **Absent schedule = today's behavior, byte-identical.** A tower with no authored
   schedule dispatches exactly as it does now; both golden-master hashes are
   unchanged. The schedule is purely additive.
2. **No new RNG.** The schedule is authored state read deterministically; on-shift
   car selection is index-ordered, home-floor idling is a lookup. No draw is added
   to the seeded crowd or economy streams.
3. **Scheduling changes supply, never routing or reachability.** A shaft at 0
   active cars still counts as serving its floors for the routing BFS and the
   income reachability gate; riders wait, they are not stranded, and no floor
   silently drops out of the two-ride graph because of a schedule.
4. **Caps are untouched.** `activeCars` is clamped to `[0, cars]`; the pool caps,
   car caps, and spans in `facilities.ts` are unchanged.
5. **TDT safety.** Export never writes a schedule block the 1994 game reads as a
   dead shaft for a shaft the player expects to run; the observed default is the
   safety floor, and a second round trip is byte-identical.

## 7. Player experience

A player who never opens the dialog notices nothing: elevators run as before. A
player who does can stage a bank up-tower for the evening down-rush, cut a shaft's
graveyard-shift cars to save nothing (there is no running cost in canon, so the
payoff is positioning and response, not economy), or import a hand-tuned 1994 tower
and keep its schedule intact. The skill ceiling the optimization thread prizes is
exactly this: shaping the fleet against the daily rush curve.

## 8. Success criteria

- A scheduled shaft measurably pre-positions cars: at the top of the down-rush
  hour, an up-tower-homed bank has cars waiting up-tower rather than all parked in
  the lobby, and the measured worst-floor wait improves versus the unscheduled
  baseline on the same tower.
- A 1994 save with a non-default schedule block imports with its schedule intact
  (to the fidelity Phase 0 establishes) and re-exports byte-identical.
- Golden master unchanged for any tower without an authored schedule.

## 9. Phasing (each phase is its own reviewable PR)

- **Phase 0 (research spike, gated):** reverse-engineer the 56-byte block's WD/WE
  per-hour layout via the Wine harness (author distinct schedules in the real game,
  diff the saved bytes). Output: a documented byte layout in `docs/canon/` or an
  honest "partially decoded" note. No engine code. This unblocks Phase 4's
  fidelity; Phases 1-3 do not depend on it.
- **Phase 1 (engine model + serialization):** add the optional `schedule` object
  to `Transport`, serialize and harden it, bump `SAVE_VERSION` with a backfill.
  No behavior change yet (absent everywhere). `/gds-code-review`.
- **Phase 2 (dispatch integration):** plumb the clock/day-type into
  `ElevatorDispatch`; apply active-car counts, home-floor idling, Waiting Car
  Response, and Standard Floor Departure. Golden master unchanged for unscheduled
  towers; new tests for a scheduled tower's positioning. `/gds-code-review`.
- **Phase 3 (UI, #352):** the per-shaft dialog: WD/WE strip, the two steppers, the
  serviced-floors list with Show toggles and base-floor setter, Simulate/OK, and
  the Classic/Modern split (presets + auto-tune behind the `GameRules` seam, raw
  grid behind Advanced). Mobile adaptation. `/gds-code-review` (game-facing UI).
- **Phase 4 (TDT round trip):** read/write the 56-byte block and per-car home
  floors per Phase 0, with the import-report line and the export safety and
  fixed-point guarantees. `/gds-code-review` (engine-data fidelity).

Phases 1-3 deliver a fully working in-game scheduler on our own save format; Phase
4 adds TDT fidelity and depends on Phase 0. The epic can ship in that order.

## 10. Risks and open questions

- **O1 (blocking Phase 4): the 56-byte layout is undocumented.** Canon pins the
  block's size and one default value, not its WD/WE per-hour decomposition, and the
  terms Waiting Car Response, Standard Floor Departure, and waiting/base floor do
  not appear at byte level (only the 8 per-car home floors do). Phase 0 must
  establish the layout before the exporter commits; until then TDT fidelity is
  best-effort with an honest report line. Owner input welcome on whether to run the
  spike now or ship Phases 1-3 first.
- **O2: default running-car count.** With no per-hour running cost in canon, a
  rational player would run all cars all the time, which makes the schedule a
  positioning tool more than an economy lever. Confirm we do not invent a running
  cost (that would be a Modern-only economy change, out of this epic's scope) and
  that positioning + response is the intended payoff.
- **O3: home floors vs the derived idle floor.** Making idle position configurable
  replaces a one-line derivation several tests pin; Phase 2 must migrate those
  tests deliberately, not incidentally.
- **O4: interaction with `lobby-distance-reachability` (#436).** That row re-keys
  the distance penalty on effective elevator reach (wait/transfer depth) and
  explicitly wants to sequence after or fold into this spec. Note the coupling;
  keep the schedule's "supply not reachability" invariant (§6.3) so #436 can layer
  cleanly.

## 11. Source links

- Roadmap: `gdd-classic-modern-pricing-roadmap-2026-07-08.md` §4, §7 (owner
  tiebreak, FULL PARITY).
- Modern treatment and priority: `gdd-simtower-optimization-gaps-2026-07-15.md`
  (intent presets, raw grid behind Advanced; priority item 5).
- Canon: `docs/canon/tdt-format.md` §8 (the 194-byte elevator record, the 56-byte
  schedule block @4, the 8 per-car home floors @186, the serviced-floors bytes).
- Backlog: `elevator-scheduling` (#305), `elevator-config-ui` (#352),
  `elevator-dispatch-balancing` (#303, shipped), `lobby-distance-reachability`
  (#436).
- Companion architecture: `arch-elevator-scheduling-2026-07-16.md`.
