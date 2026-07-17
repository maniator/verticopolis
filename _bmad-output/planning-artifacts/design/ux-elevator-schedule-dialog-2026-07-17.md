---
title: "UX spec: the per-shaft elevator schedule dialog (elevator-scheduling Phase 3)"
game: Verticopolis (browser SimTower clone)
author: Sally (UX designer)
date: 2026-07-17
status: "Draft for owner review. This is the Phase 3 (UI, #352) design the
  elevator-scheduling epic is gated on before any dialog code lands. Phases 1 and 2
  (the schedule model, its save round-trip, and the dispatch read) are merged; the
  engine already honors an authored schedule, so this spec designs the surface that
  finally lets a player author one."
scope: "Dialog and editor-card UX only. The engine model, the dispatch effect, and
  the GameRules split are ratified inputs (Phases 1-2, gdd/arch), cited and never
  re-argued. Closes the Phase 1 stepper-range defer by ratifying concrete ranges.
  Owner calls of 2026-07-17 fold in the stops dialog (Q1) and put the schedule
  dialog on express in both modes (Q4, Classic by 1994 research, Modern by party)."
inputs:
  - _bmad-output/planning-artifacts/design/gdd-elevator-scheduling-2026-07-16.md (§4 the model, §4.5 the dialog, §5 Classic vs Modern)
  - _bmad-output/planning-artifacts/design/arch-elevator-scheduling-2026-07-16.md (§2 module boundaries, §5 the GameRules seam, §8 UI/inspector, §11 A4 Simulate)
  - docs/design-system.md (the dialog grammar this spec composes from)
  - _bmad-output/planning-artifacts/design/ux-pricing-split-editor-2026-07-15.md (the sibling editor-dialog spec whose grammar this mirrors)
  - src/ui/templates/editor.ts (transportEditorTemplate, the elevator card), src/ui/uiBatchPricing.ts (the stateful-modal pattern), src/engine/elevatorSchedule.ts (the model + read accessors), src/engine/gameRules.ts (the seam)
  - _bmad-output/implementation-artifacts/backlog.md rows `elevator-scheduling` (#305) and `elevator-config-ui` (#352)
---

# UX spec: the per-shaft elevator schedule dialog

## 0. Ratified ground (cited, never re-argued)

Everything below designs a surface for the model and dispatch already merged in
Phases 1 and 2:

- **The schedule object** (gdd §4.1, `elevatorSchedule.ts`). An optional per-shaft
  `schedule`: `activeCars[weekday|weekend][0..23]` (cars on shift each hour, range
  `0..cars`), `waitingCarResponse` (floors), `standardFloorDeparture` (game-seconds),
  and `homeFloors[car]` (per-car idle floor). Absent means today's automatic dispatch.
- **What the dispatcher does with it** (gdd §4.2, `ElevatorDispatch.moveCars`). The
  lowest-indexed `activeCars` cars run each hour; the rest park at their home floor and
  answer nothing. On-shift idle cars rest at their home floor. `standardFloorDeparture`
  is the per-shaft dwell; `waitingCarResponse` holds a parked car for a call farther than
  its reach allows. Scheduling shapes SUPPLY and POSITIONING, never routing: a 0-active
  shaft still serves its floors for the graph (riders wait, never stranded).
- **The Classic/Modern split rides one GameRules accessor** (arch §5),
  `elevatorScheduleUX()` returning `{ presets, autoTune, rawGridDefault, advice }`.
  Classic returns all-false except `rawGridDefault: true`; Modern returns
  `presets/autoTune/advice: true` with `rawGridDefault: false`. The dialog switches on
  the SHAPE of this return, never on the mode string; the schedule object and its
  dispatch effect are identical in both modes.
- **Determinism** (gdd §6.2). Authoring writes a schedule at author time; nothing here
  runs on the sim tick or draws RNG. Auto-tune reads the shaft's own measured hourly
  load (existing statistical state) and writes rows, also at author time.
- **Dialog grammar** (docs/design-system.md, mirrored from the pricing editor spec §0).
  Gray face, `--bevel-out`, navy full-bleed `.win-title`, Win-style `.btn` press-only
  feedback, one primary per dialog, `.field` wells, 36px touch targets under
  `pointer: coarse`, visible focus always.

Engine notes this spec relies on but does not design: the four read accessors
(`activeCarCount`, `homeFloorFor`, `dwellMinutesFor`, `waitingResponseFor`) and the
load-boundary `coerceSchedule` (all merged). What does not exist yet: the editor entry
point, the dialog, the `Tower.setSchedule` mutator (arch §3, bumps `revision`), the
preset generators, the auto-tune reader, the analytic Simulate projection, the
`elevatorScheduleUX()` accessor, and every string below.

## 1. Where it lives: the editor entry point

The transport editor card (`transportEditorTemplate`, `src/ui/templates/editor.ts`)
today offers, for a standard/service shaft: `– Car` / `+ Car`, `Configure stops…`,
`Express (lobbies)` / `All stops`, `▼ Extend down` / `▲ Extend up`, and
`Sell / Bulldoze`. Phase 3 adds ONE action row, a `Schedule…` button, opening the modal
below. Nothing else on the card moves.

```
+--------------------------------------------+
| Standard Elevator                       [x]|   navy .win-title
+--------------------------------------------+
|  Capacity           21 riders/trip         |   .kv stat grid (unchanged)
|  Stops              all floors             |
|  Cars               [ – Car ] [ + Car ]    |
|  [ Configure stops…                    ]   |
|  [ Schedule…                           ]   |   THE NEW ACTION (data-edit="schedule")
|  [ ▼ Extend down ] [ ▲ Extend up ]         |
|  [ Sell / Bulldoze                     ]   |
+--------------------------------------------+
```

- **Availability (decided: all elevator kinds, both modes).** The row appears for every
  elevator kind that carries cars (`isElevatorKind`): standard, service, AND express.
  Stairs and escalators have no cars and no schedule (`coerceSchedule` drops a schedule on
  a car-less transport), so they never show the row. A service (staff-only) shaft shows it:
  canon schedules service elevators too, and the dispatch effect is identical.
- **Express gets the dialog in BOTH modes.** This was open question Q4; it is now settled
  two ways that agree (owner call 2026-07-17):
  - *Classic (fidelity, researched):* the 1994 Express Elevator carried the SAME scheduling
    dialog as the standard elevator (WD/WE time frames, Waiting Car Response, Standard Floor
    Departure, plus the Express-to-top/bottom clock settings). Period guides even give
    express-specific advice ("Waiting Car Response can be left at default because express
    only stops every 15 levels"). Withholding it in Classic would be a fidelity regression.
    Sources in §13.
  - *Modern (assistance, party-decided):* a game/systems/UX roundtable was unanimous that
    express should show the dialog, not hide it. The decisive point (systems seat): the
    engine already honors an express `schedule` from a TDT import or save, so hiding the
    authoring UI would manufacture invisible, uneditable live state (an express shaft
    behaves differently and the player has no surface to see or reset it). Express is also
    the marquee staging case: a whole-tower trunk idling at the wrong lobby is a long
    dead-head before the down-rush, so WHERE its cars wait is a sharper choice than on a
    short local.
- **Express shape adaptations** (§4.1, §4.3, §5.4): its serviced floors render as a static
  caption, not an editable list (it stops at lobbies/sky lobbies by construction); its
  home-floor picker is limited to that lobby/sky-lobby stop set (the meaningful express
  control, staging cars at the ground lobby vs a mid sky lobby to feed transfers); and its
  Modern presets resolve their staging to those lobby stops. Everything else (the strip, the
  Weekday/Weekend toggle, both steppers) is identical to a standard shaft.

## 2. The dialog: anatomy and pattern

A modal opened through `ui.openModalTemplate`, stateful in the `uiBatchPricing` mold: a
single `state` object, a `recompute()` that derives the Simulate readout and the
OK-disabled flag, and a `rerender()` that lit-patches the whole body from `state` into the
modal box. Every control mutates `state` and re-renders; OK writes once through
`Tower.setSchedule`, Cancel discards the working copy.

Desktop, Modern, a standard shaft with 6 cars (raw grid folded behind Advanced):

```
+------------------------------------------------------------+
| Schedule: Standard Elevator (floors 1-30)              [x] |
+------------------------------------------------------------+
|  ( Weekday )  ( Weekend )                                  |  day-type toggle
|                                                            |
|  Cars on shift by hour                          6 of 6     |  strip heading + fleet size
|   6 |            ███      ███                              |
|   4 |         ██ ███ ██   ███ ██                           |  the 24-hour bar strip
|   2 |  ██ ██ ███ ███ ███ ███ ███ ██ ██                     |  (height = active cars)
|   0 +--------------------------------------------          |
|      0   3   6   9  12  15  18  21                         |  hour axis
|                                                            |
|  [ Rush ]  [ Balanced ]  [ Feeder ]        [ Auto-tune ]   |  Modern presets (§5)
|                                                            |
|  Waiting Car Response   [ – ]  4 floors   [ + ]           |  stepper (§3)
|  Standard Floor Departure [ – ]  48 sec   [ + ]           |  stepper (§3)
|                                                            |
|  ▸ Home floors and serviced floors (Advanced)             |  disclosure (§4)
|                                                            |
|  Busiest weekday hour 17:00: 6 of 6 cars, homed lobby+22   |  Simulate readout (§6)
|                                                            |
|                          [ OK ]  [ Cancel ]                |  one primary
+------------------------------------------------------------+
```

Classic renders the same body with the strip and both steppers always visible, the
serviced-floors and home-floors section expanded by default (`rawGridDefault: true`), and
no preset row, no Auto-tune, no advice line (§5).

## 3. The two steppers (closes the Phase 1 range defer)

Both are the house `[ – ] value [ + ]` nudge triple (the same recipe as the rent nudge
row), value in a `.field`-styled read-only cell, 36px targets on coarse pointers.

| Control | Unit | Range | Step | Default | Maps to |
|---|---|---|---|---|---|
| Waiting Car Response | floors | 0-30 | 1 | 0 | `waitingCarResponse`; reach = span - value, so 0 = answers everything (today), higher = a staged car holds for farther calls |
| Standard Floor Departure | seconds | 0-60 | 2 | 48 | `standardFloorDeparture`; 48 game-seconds is the 0.8 game-minute default dwell (`DWELL_DEFAULT_SECONDS`), so the default reproduces today's hold |

- **These ranges ratify the Phase 1 provisional bounds.** `WAITING_CAR_RESPONSE_MAX`
  (30) and `STANDARD_FLOOR_DEPARTURE_MAX` (60) in `elevatorSchedule.ts` were flagged
  PROVISIONAL pending this spec (Phase 1 deferral inbox). The stepper maxes adopt them
  as-is, so no engine constant changes; the read-time clamps and the stepper caps agree.
  The Standard Floor Departure default (48) sits on the step-2 grid and equals
  `DWELL_DEFAULT_SECONDS`, so opening the dialog on an unscheduled shaft and pressing OK
  without touching anything writes a schedule that dispatches identically.
- **Announce on commit** (single-throat announce path), pinned:
  - `Waiting Car Response: 4 floors. Idle cars hold for calls more than 4 floors off.`
  - `Waiting Car Response: 0. Idle cars answer the nearest call.` (the floor-0 read)
  - `Standard Floor Departure: 48 seconds.`
- The `– ` disables at the floor, `+` at the cap; both borrow the existing disabled-nudge
  styling so a player sees why the press does nothing.

## 4. The floors section: serviced floors, base floor, home floors

A disclosure (`▸ Home floors and serviced floors`), open by default in Classic and folded
under Advanced in Modern. It is one scrollable list, `.field`-welled, one row per served
floor, newest engine truth (`tower.stopsOf`) driving the rows.

```
|  Floor   Serve   Home car(s)                    |  column heads
|  22      [x]     ● ●            (cars 5, 6)      |  a served floor, two cars homed here
|  15      [x]     ● ● ●          (cars 2, 3, 4)   |
|   1      [x]     ●              (car 1)          |  the base floor is marked (§4.2)
|  30      [ ]                                     |  a skipped floor (Serve off)
```

### 4.1 Serve On/Off (the stops model)

The `Serve` checkbox is the existing `skipFloors` toggle in list form: unchecking a floor
adds it to `skipFloors` (the car no longer stops there), rechecking removes it. This is
the SAME data the current `Configure stops…` dialog edits; per the owner call this list
REPLACES that dialog (§7), so it is the one place a shaft's stops are set. For an EXPRESS
shaft the floors are not a free list (it stops at lobbies/sky lobbies by construction), so
instead of a disabled-looking checkbox column it renders as a static one-line caption,
`Serves all lobbies and sky lobbies`, never a grayed picker (a grayed editable-looking
control reads as a bug; a caption reads as a fact).

### 4.2 Base / starting floor

One floor in the list carries the `◎` base marker: the shaft's starting/reference floor
(gdd §4.5, the base-floor setter). A `Set as base` affordance on a focused row moves it.
The base floor is where an unhomed car falls back when its own home floor is unset, so it
doubles as the shaft's default idle. Default: the lowest served lobby, which is exactly
today's derived idle floor, so an untouched shaft's base equals current behavior.

### 4.3 Home floors (per car)

Each served floor row shows a `●` dot per car homed there; a car is assigned by focusing a
row and pressing its car number, or dragging a car dot between rows. With up to 8 cars this
stays compact because most towers home a bank together: a `Home all cars here` quick-action
on a focused row assigns the whole fleet in one press (the common case), and the per-car
dots are the fine control for split staging (lower half lobby, upper half up-tower, the
down-rush play the whole feature exists for). An unassigned car falls back to the base
floor (§4.2), i.e. today's idle. Home floors are clamped to the shaft span on read
(Phase 2), so a value can never sit off the shaft. For an EXPRESS shaft the home rows are
its lobby/sky-lobby stops only (the caption's floors), so staging a bank at the top sky
lobby for the down-rush is one assignment; the per-car dots still allow splitting cars
across lobbies to feed different transfer points.

## 5. Classic versus Modern (the GameRules seam)

The dialog reads `sim.rules.elevatorScheduleUX()` once on open and renders per the flags,
never per the mode string (arch §5). The schedule it writes is identical either way; only
the authoring affordances differ.

| Concern | Classic (`rawGridDefault: true`, rest false) | Modern (`presets/autoTune/advice: true`, `rawGridDefault: false`) |
|---|---|---|
| Strip + steppers | Always visible, full manual control | Always visible |
| Floors/home section | Expanded by default | Behind the Advanced disclosure |
| Presets | None | Rush / Balanced / Feeder buttons |
| Auto-tune | None | `Auto-tune` button (fills the strip from measured load) |
| Advice | None (true state only, never what to set) | One honest hint line (§5.3) |

### 5.1 The three intent presets (Modern)

Each preset fills BOTH day-type rows and the home floors in one press, then leaves the
player free to hand-edit; a preset is a starting shape, not a lock. Concrete shapes
(`cars` = the shaft's car count, `top`/`bottom` its span):

- **Rush.** Full fleet in the morning (07:00-09:00) and evening (17:00-19:00) peaks, half
  (`ceil(cars/2)`) midday (10:00-16:00), two overnight (22:00-06:00). Homes the lower half
  of the fleet at the base lobby and the upper half near `top` (staged for the down-rush).
  Weekend row is the midday-half curve all day. This is the optimizer's default.
- **Balanced.** A smooth daytime hump: full fleet 08:00-18:00, half the shoulders, two
  overnight, same weekday and weekend. All cars home at the base lobby. The safe "don't
  overthink it" shape.
- **Feeder.** A steady `ceil(cars/2)` all day and night, every car homed at the shaft's
  highest served lobby (a sky lobby if one exists, else `top`). For a shaft whose job is
  feeding an express transfer rather than chasing the rush. Weekend equals weekday.

Pressing a preset announces `Applied the Rush schedule.` and re-renders the strip; it is
one undo (Cancel) or one other preset away, so it needs no confirm.

### 5.2 Auto-tune (Modern)

`Auto-tune` reads the shaft's own measured hourly load (the existing statistical demand the
dispatcher already accumulates, exposed read-only to the UI) and sets each hour's active
count proportional to that hour's load, clamped `1..cars`. It writes the working-copy rows
at author time only (no sim-tick effect, no RNG; arch §6), then re-renders. It never
touches home floors or the steppers, so it composes with a hand-set staging. Announce:
`Auto-tuned cars to this shaft's measured demand.` If the shaft has no measured history yet
(a fresh save), the button is disabled with the house why-disabled styling and a folded
note: `Auto-tune needs a day or two of measured traffic first.`

### 5.3 Advice (Modern, one line)

Under the strip, one honest hint comparing the AUTHORED active counts against the shaft's
MEASURED load, uncolored (an observation, not a fault). It never prescribes a value, only
names the mismatch (Classic withholds advice, never information, so it shows the same
measured load with no hint). Pinned patterns:

- `This shaft is over-staffed 09:00-11:00 and short at 17:00 on weekdays.`
- `Measured demand and your schedule line up.` (when nothing is notably off)

The measured-vs-authored comparison is a pure read on open and after each edit; it never
runs on the sim tick.

### 5.4 Presets and auto-tune on an express shaft

The party raised a real concern: Rush/Balanced/Feeder are named for up-tower-versus-lobby
staging on a multi-stop shaft, so on a lobby-only trunk their vocabulary risks meaning
something subtly different. The resolution keeps the presets (button parity, and the same
assistance the mode promises) but binds their staging to the express stop set, so the
names stay honest:

- **Rush** on express: full fleet at the peaks, and the up-tower home resolves to the
  HIGHEST served sky lobby (the down-rush transfer point), not an arbitrary floor.
- **Feeder** on express: steady `ceil(cars/2)`, every car homed at the highest served
  lobby. This is the natural express default and Modern should suggest it first.
- **Balanced** on express: the daytime hump, all cars homed at the base (ground) lobby.
- **Auto-tune** works unchanged (it reads measured load and sets counts); on express it
  additionally biases home floors toward the busiest served lobby.

Because every home target an express preset writes is already one of its lobby stops, the
preset output is well-defined for express rather than an arbitrary floor the shaft cannot
reach. Waiting Car Response defaults matter less on express (it stops sparsely, so an idle
car is rarely the deciding factor); the dialog still exposes it for parity but Modern's
advice never nags about it on an express shaft.

## 6. Simulate: the honest readout

Per arch §11 A4, Simulate is a cheap ANALYTIC projection computed on the UI thread from
the working copy, never a second headless sim instance. It is a live readout under the
strip (no separate Simulate button and no modal-within-modal): every edit recomputes it,
so the player always sees the consequence of the current draft. Pinned patterns:

- `Busiest weekday hour 17:00: 6 of 6 cars, homed lobby+22.`
- `Overnight (00:00-05:00): 2 of 6 cars on shift.`
- `Weekend never runs more than 3 of 6 cars.`

The heading count (`6 of 6`) and the readout derive from the same `activeCarCount` /
`homeFloorFor` accessors the dispatcher reads, so the preview can never drift from what the
sim will actually do. No projected wait-time number is promised here (that would imply a
routing simulation); the readout states supply and positioning, which is exactly what the
schedule controls.

## 7. Folding in `Configure stops…` (decided: yes)

The serviced-floors list (§4.1) edits the same `skipFloors` data as the existing
`Configure stops…` dialog, and two edit paths to one field is the duplication the design
system warns against. Owner call 2026-07-17: **fold in.** The `Schedule…` dialog becomes
the one per-shaft config surface; its floors list carries the Serve toggles and the base
setter, and the standalone `Configure stops…` button and its dialog retire. One place for
cars, timing, home floors, and stops, matching how the pricing spec folded the access-state
IOU into the one editor redraw rather than spreading it.

Build consequence: the `express` / `allstops` quick presets that lived beside
`Configure stops…` (`data-edit="express"` / `"allstops"`) move onto the schedule dialog's
floors section as two quick-actions above the list (`Express (lobbies)` / `All stops`), so
no stop-editing affordance is lost in the retirement. The `Configure stops…` entry point
(`data-edit="stops"`) and its `uiStops` surface are removed.

## 8. Mobile

The dialog is the same modal at `min(<dialog-width>, 92vw)`, reusing the editor's
fold-in and the shared `titleBarClose` (arch §8, gdd §4.5).

- **The strip** is the one piece that must adapt: 24 bars do not fit a phone width at 36px
  targets. It becomes a horizontally scrollable strip (a day is naturally a scroll) with
  snap stops every 6 hours, or, if scroll-in-a-modal tests poorly, a two-row 12+12 wrap.
  Either way each bar keeps a 36px hit target and a numeric label, so the touch edit does
  not depend on hitting a thin bar precisely.
- The steppers, presets, and floors list stack vertically and inherit the coarse-pointer
  36px minimum already in the editor's mobile block (it must extend to the strip cells and
  the stepper triples, mirroring how the pricing spec grew that block to cover selects).
- The Simulate readout and the advice line sit where the mobile editor already folds
  diagnostics in, so the phone player reads the consequence in the same panel that owns the
  controls.

## 9. Accessibility

- **The strip is a group of 24 controls.** Each hour cell is a labeled control
  (`role="slider"` or a stepper, `aria-label="Weekday 17:00, 6 of 6 cars"`,
  `aria-valuemin/max/now`). Arrow up/down changes that hour's count; left/right moves
  between hours; the day-type toggle is a two-button radio group. Color (bar height) is
  never the only cue: every cell carries its numeric value to assistive tech and on
  focus/hover.
- Visible focus on every control (design-system standing rule), one primary (OK), Cancel
  beside it, ✕ routes the cancel path, Esc cancels the whole dialog discarding the working
  copy.
- Announce strings (§3, §5, §6) go through the existing live region so a schedule authored
  without sight still narrates.

## 10. Versioning and review lane

- **Player-facing: a MINOR bump when this ships.** Phase 3 is the first phase a player can
  notice: a new authoring dialog that changes how a shaft dispatches. (Phases 1 and 2 were
  internal, no bump.) Keyed to "would a player notice?", a new capability is a minor.
- **Review lane: `/gds-code-review`.** The dialog authors engine-gameplay state
  (dispatch supply and positioning), so it rides the gameplay lane per the epics doc (E3b
  precedent, native-bridge/game-facing UI). The adversarial layers apply.
- **Screenshots.** A new dialog is a new gallery surface; expect `docs/screenshots/**`
  drift and mint the refreshed gallery through the pinned-container drift-gate on the PR,
  never a host browser.

## 11. Pinned player-facing strings (copy inventory)

| Surface | String |
|---|---|
| Editor action | `Schedule…` |
| Dialog title | `Schedule: <Shaft name> (floors <bottom>-<top>)` |
| Day-type toggle | `Weekday` / `Weekend` |
| Strip heading | `Cars on shift by hour` + `<n> of <cars>` |
| Announce, WCR set | `Waiting Car Response: <n> floors. Idle cars hold for calls more than <n> floors off.` |
| Announce, WCR zero | `Waiting Car Response: 0. Idle cars answer the nearest call.` |
| Announce, SFD set | `Standard Floor Departure: <n> seconds.` |
| Preset buttons | `Rush` / `Balanced` / `Feeder` |
| Announce, preset | `Applied the <Preset> schedule.` |
| Auto-tune button | `Auto-tune` |
| Announce, auto-tune | `Auto-tuned cars to this shaft's measured demand.` |
| Auto-tune disabled note | `Auto-tune needs a day or two of measured traffic first.` |
| Advice line | `This shaft is over-staffed <span> and short at <hour> on <day type>.` / `Measured demand and your schedule line up.` |
| Simulate, peak | `Busiest <day type> hour <HH:00>: <n> of <cars> cars, homed <where>.` |
| Simulate, overnight | `Overnight (00:00-05:00): <n> of <cars> cars on shift.` |
| Floors list heads | `Floor` / `Serve` / `Home car(s)` |
| Floors quick-actions (folded in from stops) | `Express (lobbies)` / `All stops` |
| Express floors caption | `Serves all lobbies and sky lobbies` |
| Home quick-action | `Home all cars here` |
| Advanced disclosure | `Home floors and serviced floors` |

## 12. Decisions and remaining open questions

**Decided by the owner (2026-07-17), folded into the spec above:**

- **Q1 fold in `Configure stops…`: YES** (§7). The schedule dialog is the one per-shaft
  config surface; the standalone stops dialog retires, its `express`/`allstops` presets
  move onto the floors section.
- **Q4 express gets the dialog: YES, both modes** (§1). Classic because the 1994 Express
  Elevator carried the same scheduling dialog (researched, §13); Modern because a
  game/systems/UX party was unanimous, chiefly to avoid invisible uneditable state from an
  imported express schedule. Express adapts with a caption floor list (§4.1),
  lobby-limited home floors (§4.3), and lobby-staged presets (§5.4).

**Still open (owner / playtest; the engine, the split, and the two decisions above are
settled):**

1. **Preset shapes (playtest; §5.1, §5.4).** Rush/Balanced/Feeder are defined concretely,
   but the exact peak windows and the half-fleet split are tuning that wants a playtest
   pass. Ship the shapes as written and revisit magnitudes with the same tuning pass as the
   other provisional weights.
2. **The strip interaction on mobile (§8).** Horizontal scroll versus a 12+12 wrap is a
   phone-ergonomics call best made against a real device test; the spec commits to a 36px
   target and a numeric label either way. Default: try scroll first, fall back to wrap if
   it tests poorly.
3. **Home-floor UI density (§4.3).** The per-car dots plus `Home all cars here` cover both
   the common (bank-together) and the fine (split-staging) cases. If playtest finds the
   dots fiddly on a 6-8 car shaft, a fallback is a single `Home floor` for the shaft with
   per-car split behind Advanced. Default: dots + quick-action as specced.
4. **1994 used 6 daily time frames; our model is 24 hourly slots (minor, Classic-fidelity
   nod).** The merged engine model is `activeCars[dayType][0..23]`, a Modern refinement over
   the original's coarser 6-frame day. Not a blocker (the strip authors the 24-slot model
   directly), but Classic could optionally GROUP the strip into the historical bands as a
   fidelity gesture. Deferred as polish; the 24-slot model stays the source of truth.

## 13. Sources (Classic express-scheduling research, 2026-07-17)

The Classic ruling in §1 (the 1994 Express Elevator carried the full scheduling dialog with
Waiting Car Response and Standard Floor Departure) rests on:

- Sim Tower Wiki, Elevators: https://simtower.fandom.com/wiki/Elevators
- GameSurge SimTower strategy guide: https://www.gamesurge.com/strategies/strategyindex/simtower.shtml
- ZealGames SimTower tips (per-time-frame Express-to-top/bottom clock settings, "Waiting
  Car Response 1 / Standard Floor Departure 30" advice): https://www.angelfire.com/games2/zealgames/simtower/towertips.html

The Modern ruling rests on the 2026-07-17 game/systems/UX roundtable summarized in §1 and
§5.4 (offer the dialog; adapt the floor list to a caption, the home floors to lobby stops,
and the presets to lobby staging).
