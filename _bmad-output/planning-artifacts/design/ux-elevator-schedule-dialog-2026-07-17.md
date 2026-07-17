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
  dialog on express in both modes (Q4, Classic by 1994 research, Modern by party).
  A UX + game design party then reviewed every interaction and ruled on the
  count-axis fork (Q5): positioning leads, no count cost ships in Phase 3 (§14)."
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

> **Revised by the 2026-07-17 design party (see §14).** The anatomy below stands, but Modern
> re-weights it toward POSITIONING: the manual count strip is demoted behind Advanced and owned
> by Auto-tune, a measured-demand ghost series backs the strip, and Simulate scores staging. The
> ASCII here shows the pre-revision layout; §14.2 is authoritative for the Modern surface order.
> Classic keeps the manual strip primary.

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
|  Waiting Car Response   [ – ]  0 floors   [ + ]           |  stepper (§3, default 0)
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
| Waiting Car Response | floors | 0-30 | 1 | 0 | `waitingCarResponse`; 0 = answers the nearest call (today's behavior), higher = a staged car holds for farther calls. The exact reach geometry is the dispatcher's and is provisional in the engine, so the stepper commits only to the direction, never to a formula |
| Standard Floor Departure | seconds | 0-60 | 2 | 48 | `standardFloorDeparture`; 48 game-seconds is the 0.8 game-minute default dwell (`DWELL_DEFAULT_SECONDS`), so the default reproduces today's hold |

- **These ranges ratify the Phase 1 provisional bounds.** `WAITING_CAR_RESPONSE_MAX`
  (30) and `STANDARD_FLOOR_DEPARTURE_MAX` (60) in `elevatorSchedule.ts` were flagged
  PROVISIONAL pending this spec (Phase 1 deferral inbox). The stepper maxes adopt them
  as-is, so no engine constant changes; the read-time clamps and the stepper caps agree.
  The Standard Floor Departure default (48) sits on the step-2 grid and equals
  `DWELL_DEFAULT_SECONDS`, so opening the dialog on an unscheduled shaft and pressing OK
  without touching anything writes a schedule that dispatches identically.
- **Announce on commit** (single-throat announce path), pinned as templates (`<n>` is the
  committed value; see the copy inventory §11):
  - `Waiting Car Response set to <n>. Higher holds idle cars in place longer.`
  - `Waiting Car Response: 0. Idle cars answer the nearest call.` (the floor-0 read, the default)
  - `Standard Floor Departure: <n> seconds.`
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

`Auto-tune` reads the shaft's measured hourly load and sets each hour's active count
proportional to that hour's load. It writes the working-copy rows at author time only
(no sim-tick effect, no RNG; arch §6), then re-renders.

**Build note (the signal does not exist yet).** The dispatcher today keeps only a per-floor
waiting estimate, and `Simulation` samples an hourly AVERAGE elevator utilization
(`elevatorUtil`), neither of which is a per-shaft 24-hour demand curve. So Auto-tune and the
ghost series (§14.2) require Phase 3 to ADD a small per-shaft, per-hour demand accumulator: a
transient 24-slot ring per shaft (since v1.59.0 one ring per day type; see the §17 day-split
bullet, #466), filled from the demand the dispatch already computes, keyed
like `carDwell` so it is NOT serialized (rebuilt as the sim runs) and adds no golden-master
state and no RNG. Until a shaft has accumulated a day or two, Auto-tune and the ghost series
read empty (the disabled-note path below). This is engine-adjacent plumbing the Phase 3 PR
carries; it does not change dispatch behavior. The model permits `0..cars` per hour,
but Auto-tune deliberately floors its output at `1` (never 0): a measured-demand tune should
thin a quiet hour, never take the shaft fully off the air, so a lull cannot silently strand a
floor for an hour. A player who wants a true 0-car hour still sets it by hand on the strip.
Auto-tune also SEEDS positioning: when the player has not authored any home floors, it stages
the fleet toward the shaft's busiest served lobby (its measured-demand origin), so the
one-button assist helps the axis that matters (§14.4), not just the costless count axis. It
never overwrites a hand-set staging, and it never touches the steppers, so it composes with
manual positioning rather than clobbering it (the presets/Auto-tune no-clobber rule, §14.3).
Announce: `Auto-tuned cars and staging to this shaft's measured demand.` If the shaft has no
measured history yet
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
- **Auto-tune** on express follows the same rule as everywhere (§5.2): it sets counts from
  measured load and, when homes are unset, seeds staging toward the busiest served lobby,
  which on a lobby-only trunk is the highest served sky lobby (the transfer feeder point).

Because every home target an express preset writes is already one of its lobby stops, the
preset output is well-defined for express rather than an arbitrary floor the shaft cannot
reach. Waiting Car Response defaults matter less on express (it stops sparsely, so an idle
car is rarely the deciding factor); the dialog still exposes it for parity but Modern's
advice never nags about it on an express shaft.

## 6. Simulate: the honest readout

Per arch §11 A4, Simulate is a cheap ANALYTIC projection computed on the UI thread from
the working copy, never a second headless sim instance. It is a live readout under the
strip (no separate Simulate button and no modal-within-modal): every edit recomputes it,
so the player always sees the consequence of the current draft.

**It scores POSITIONING, not counts** (party revision §14.2). A count-only readout ("6 of 6
cars") cannot tell good staging from bad, so it never moves on the one axis the dialog is for.
Instead the readout compares the authored home floors against the measured demand at the peak
hour, so staging a bank up-tower against the down-rush visibly changes the line while shuffling
counts above the demand curve does not. Pinned patterns:

- `17:00 down-rush originates on floors 20-30; 2 cars staged there, 4 in lobby.`
- `Weekday peak 08:00 up-rush: cars staged at the lobby, ready.`
- `Overnight 00:00-05:00: 2 cars on shift, homed lobby.`

The readout derives from the same `activeCarCount` / `homeFloorFor` accessors the dispatcher
reads, so it can never drift from what the sim will do. No projected wait-time number is
promised (that would imply a routing simulation); the readout scores supply DIRECTION against
demand DIRECTION, which is exactly what the schedule controls and stays within the
no-routing-sim constraint.

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

## 8. Mobile (staging-first, revised by the 2026-07-17 mobile party)

The dialog is the same modal at `min(<dialog-width>, 92vw)`, `max-height: 82vh`, ONE vertical
scroll axis (no nested scroll anywhere), sticky navy `.win-title` with the `.btn.xs` ✕ and its
invisible tap halo, reusing the editor's diagnostics fold-in (§4.5, arch §8). A UX + game party
(Sally + Samus, 2026-07-17) reworked this section, because the pre-§14 draft was strip-first and
the strip is the axis with NO agency (§14). The rule: **on a phone, cut the count strip to the
bone and protect the per-car staging list**, which is the real skill and the most phone-native
shape (a vertical list of tappable rows). Recorded in §15.

**Modern phone surface (the default).** Because §14.2 already demotes the manual count grid
behind Advanced and lets Auto-tune own counts, the painful thing on a phone (24-bar editing) is
not on the Modern default surface at all. The primary column, top to bottom:
1. A sticky **Weekday/Weekend** segmented toggle (it re-scopes what is below, so it must not
   scroll away).
2. A **read-only demand sparkline** (full 24 hours, non-interactive: measured demand behind,
   authored count bars, over-supply grayed). Glanceable, needs no precision, fits the width
   because it is not a touch target. This carries the "read" half of the loop on mobile.
3. The **staging block, primary (not behind Advanced):** the `Home all cars here` and
   `Stage upper half up-tower` full-width quick-actions, then the key served floors as full-width
   36px rows carrying **numbered car chips** (`(5)(6)`) and a **peak-origin marker** on the rows
   the down-rush comes from, so staging is read and authored on one surface. Per-car assignment
   is tapping a chip onto a row. Numbered chips (not the desktop dots, never drag) are a mobile
   MUST (§14.3 promoted): anonymous dots are not separately tappable at 36px, and per-car split
   staging is the skill ceiling.
4. The three **preset** rows (recommended one marked) and the full-width **Auto-tune** row.
5. The two **steppers** as full-width `[ – ] value [ + ]` rows (label on its own line,
   press-and-hold auto-repeat, disabled-at-cap, the live legibility sentence under each).
6. **Simulate + advice** in the diagnostics fold directly under the sparkline/staging they
   describe (co-located, so author and see-result share a viewport).

The full serviced-floors list (every floor's Serve toggle and the base-floor setter) and the
editable 24-hour count grid live behind the **Advanced** disclosure: stops config and per-hour
counts are the low-agency, once-per-shaft parts, safe one fold away. If a tall (30-floor) shaft's
Advanced list buries OK, promote it to its own full-height sub-sheet reached by an
`Edit homes and stops…` row (each sheet keeps one scroll axis); ship inline first.

**Classic phone surface.** Classic keeps the manual count strip primary (fidelity), so it needs a
real touch editor. The strip is horizontally scrollable with a 6-hour snap (optionally labeled as
the 1994 time-frame bands, §12 Q4), each hour a 36px bar with its value printed ON the bar. You do
NOT set height by dragging: **tap a bar to select it, tap a second to extend a span** (a rush
window), and a **docked `[ – ] N cars [ + ]` stepper pinned under the strip** sets the whole
selection at once. Tap-select-span plus a big stepper is a reliable two-tap that maps to "a rush
window is 2-3 equal hours" and never depends on hitting a thin bar; it also gives the value a home
with no hover. Horizontal scroll beats a 12+12 wrap (a wrap breaks a rush window that straddles
hour 12).

**Coarse-pointer sizing.** Extend the `@media (pointer: coarse)` block to the strip cells, the
`[data-step]` nudges, the car chips, and the preset/quick-action rows, so every one clears 36px
(mirroring how the pricing spec grew that block to cover selects).

**Cancel.** ✕ / Esc / backdrop / hardware-back all cancel; when the working copy is dirty a
`Discard changes?` confirm guards them (on a phone an accidental edge-swipe or back is far likelier
to nuke a fully authored schedule than a stray desktop Esc, so mobile tips §14.3's judgment call to
yes).

**Rejected:** a pure morning/midday/evening/night time-band editor (it would coarsen the ratified
24-slot model; the tap-select-span gesture gets the band ergonomics while writing 24 slots), and
the 12+12 wrap (breaks the noon-straddling rush window).

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
| Announce, WCR set | `Waiting Car Response set to <n>. Higher holds idle cars in place longer.` |
| Announce, WCR zero | `Waiting Car Response: 0. Idle cars answer the nearest call.` |
| Announce, SFD set | `Standard Floor Departure: <n> seconds.` |
| Preset buttons | `Rush` / `Balanced` / `Feeder` |
| Announce, preset | `Applied the <Preset> schedule.` |
| Auto-tune button | `Auto-tune` |
| Announce, auto-tune | `Auto-tuned cars and staging to this shaft's measured demand.` |
| Auto-tune disabled note | `Auto-tune needs a day or two of measured traffic first.` |
| Advice line | `This shaft is over-staffed <span> and short at <hour span> on <day type>s.` / `Measured demand and your schedule line up.` (hour spans compress: `09:00–16:00`) |
| Simulate readout (§6, re-pinned §16/§17) | `Busiest <day type> hour <HH:00>: <u> staged up-tower, <l> at the lobby, <n> of <cars> cars on shift.` (a non-ground base reads `<l> at Floor <n> (the base)` with B-n grammar below ground; staging clause leads; an unmeasured day leads with `No measured <day type> peak yet; at the 17:00 down-rush` instead of `Busiest`) |
| Simulate origin clause (§6 as-built, #465) | Trailing, only once origins warm for the visible day: ` Most riders board at Floor <n>.` / ` Most riders board on floors <a>–<b>.` (contiguous band) / ` Most riders board on floors <a>, <b>, <c>.` (scattered) |
| Hotspot marker title (#465) | `Demand hotspot: many riders board here at the busiest <day type> hour` on the red ▲ beside the floor label; markers and clause show only floors the shaft still serves |
| Floors list heads (fold-in increment, §16) | `Floor` / `Serve` / `Home car(s)` |
| Floors quick-actions (fold-in increment, §16) | `Express (lobbies)` / `All stops` |
| Express floors caption (fold-in increment, §16) | `Serves all lobbies and sky lobbies` |
| Home quick-actions | `Home all cars at the lobby` (non-ground base: `Home all cars at Floor <n>`) / `Stage upper half up-tower` |
| Dirty Cancel arm | `Discard changes?` |
| Grid heading (§17) | `Serviced floors and home cars` |
| Announce, stops (§17) | `Floor <n> served.` / `Floor <n> skipped.` / `Floor <n> must stay a stop.` / `Stops set to lobbies only.` / `Stopping at every floor.` |
| Touch flow hint (§17) | `Tap an hour, then set its cars with − and +. A second tap spans hours.` |
| Ghost legend (§17) | `Dashes mark measured demand; the pale bar top is spare capacity.` |
| Endpoint Serve mark title (§17) | `The top and bottom stay connected: endpoints always stop` |
| Advanced disclosure (Modern) | `Cars on shift by hour (Advanced)` |
| Save announce | `Elevator schedule saved.` / gone-shaft refusal `That elevator is gone.` |

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
- **Q5 the count axis (no running cost) does not lead the dialog** (§14). Classic keeps the
  manual count strip primary and cost-free (canon O2 + research, §14.5); Modern re-weights
  toward positioning via three engine-free moves (§14.2) after a unanimous game/systems party.
  No count cost or bunching penalty ships in Phase 3: money-cost reopens canon and churns the
  golden master; a congestion penalty would invert the `congestion.ts` monotonic invariant.
  Both are deferred (the penalty only as a telemetry-gated post-Phase-3 experiment).

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

- SimTower Wiki, Elevators: https://simtower.fandom.com/wiki/Elevators
- GameSurge SimTower strategy guide: https://www.gamesurge.com/strategies/strategyindex/simtower.shtml
- ZealGames SimTower tips (per-time-frame Express-to-top/bottom clock settings, "Waiting
  Car Response 1 / Standard Floor Departure 30" advice): https://www.angelfire.com/games2/zealgames/simtower/towertips.html

The Modern ruling rests on the 2026-07-17 game/systems/UX roundtable summarized in §1 and
§5.4 (offer the dialog; adapt the floor list to a caption, the home floors to lobby stops,
and the presets to lobby staging).

## 14. Design review revisions (UX + game party, 2026-07-17)

After the first mockup, a UX seat (Sally) and a game seat (Samus) reviewed the dialog and
every interaction, and a follow-up game/systems party (Samus + Cloud) ruled on one
structural fork. This section records the outcomes and amends the sections above; where §2 to
§6 and §14 differ, §14 governs.

### 14.1 The count axis has no agency, so positioning leads (the fork, decided)

The review's headline finding: because there is no per-car running cost (GDD open question
O2), setting an hour BELOW the fleet size saves nothing and is strictly worse service, so a
rational player maxes every hour. The 24-hour "cars on shift" strip is therefore the
LOWEST-agency control, while POSITIONING (home-floor staging for the down-rush) carries the
real skill. Owner call 2026-07-17: research Classic, party for Modern.

- **Classic (researched + canon):** no count cost. Canon O2 already confirms 1994 charged no
  per-hour running cost; the research pass found only a flat per-shaft construction and
  maintenance cost, nothing that scales with active cars (sources §14.5). So in Classic the
  count strip is a manual positioning and service tool at 1994 semantics, unchanged and
  primary; withholding or demoting it would break fidelity.
- **Modern (party, unanimous Option A, NO engine change):** keep counts costless but stop
  presenting them as the hero. Both seats rejected giving counts weight for Phase 3:
  - A *money cost* is rejected outright: it reopens canon O2, perturbs the economy stream and
    the golden-master hash, and turns 24 hourly slots into a spreadsheet chore, the least
    SimTower-flavored option on the table.
  - A *bunching/congestion penalty* is rejected for Phase 3 and as an epic on a hard technical
    ground the systems seat found: `src/engine/sim/congestion.ts` rests on a MONOTONIC
    invariant (adding any parallel shaft strictly increases capacity and reduces congestion),
    which the #303 bank balancer and the two-ride routing BFS both assume. A penalty that made
    surplus cars RAISE congestion would invert that invariant and destabilize merged Phase 2
    plus the fairness work. Only a far-future dispatch rewrite (per-floor occupancy so bunching
    emerges, not a flat penalty term) could do it cleanly, and even then it likely reads as a
    chore. Deferred as a post-Phase-3, telemetry-gated experiment (build only if shipped
    telemetry shows players pin every count at max, i.e. the axis is provably dead), never a
    Phase 3 blocker, never money. A backlog row and issue are opened only if that telemetry
    trigger fires; until then it is captured here in the spec, not as tracked work.

### 14.2 The positioning-first re-layout (Modern; three engine-free moves)

Option A is not just "rearrange"; it makes positioning the legibly-scored lever via three
deterministic moves. The authoring itself is author-time (no tick effect); the one tick-time
addition is the transient, read-only per-shaft per-hour demand accumulator that feeds moves 1
and the Auto-tune of move 2 (§5.2 build note), which aggregates demand the dispatch already
computes, adds no serialized state and no RNG, and so leaves unscheduled towers byte-identical:

1. **Measured-demand ghost series behind the strip.** Render the shaft's measured hourly load
   (from the new per-shaft per-hour accumulator, §5.2 build note) as a second series behind the
   authored bars, and gray any authored bar segment ABOVE the demand line as "idle anyway, no
   effect." Maxing counts becomes a VISIBLE redundancy rather than a hidden non-choice, and
   Classic finally shows the true measured load it always promised (§5.3) instead of leaving
   Classic blind. This also restores the strip's count
   gridlines (0/2/4/.../cars) the first mockup dropped, so a bar's value reads without a
   tooltip.
2. **Auto-tune owns the Modern count rows by default; the manual strip moves behind Advanced.**
   In Modern (`rawGridDefault: false`), the primary surface is home-floor staging, the two
   response steppers, the demand-backed strip as a READOUT, and Simulate; the manual per-hour
   count grid sits behind the Advanced disclosure beside the raw floors list. The player
   inherits a sane Auto-tune count curve and never needs to touch counts to be optimal, which
   removes the max-and-ignore incentive. Classic keeps the manual strip primary (fidelity).
3. **Simulate scores staging, not counts** (§6). The readout responds to home-floor placement
   against the down-rush and stays flat above the demand line, so attention follows the number
   that actually moves. Pinned form: `17:00 down-rush originates on floors 20-30; 2 cars staged
   there, 4 in lobby.` Pure analytic read (same accessors), still no promised routed wait
   (§6 constraint intact).

### 14.3 Interaction findings folded in

MUST-FIX (each amends the section noted):

- **The strip needs a real edit gesture (§2, §9).** Click/tap-to-height plus arrow keys are
  the PRIMARY gesture (arrow up/down nudges an hour's count, left/right moves hours); vertical
  drag is an accelerator, never the only path. Each hour is a `role="slider"` cell with a
  visible focus ring and a spoken value.
- **Paint across hours (§2).** A rush window is 2-3 consecutive equal hours; support
  horizontal drag-to-paint the focused value across a span (and/or shift-click range fill), so
  the strip is a schedule editor, not 24 unrelated sliders.
- **Express keeps a home-floor picker (§4.3).** The caption replaces only the Serve COLUMN;
  the lobby/sky-lobby rows still render with their home-car marks so `Home all cars here` and
  per-car staging exist. The first mockup wrongly hid the whole list, dropping the one
  interaction express is justified on. The spec text (§4.3) already required this; it is now
  unmistakable.
- **Waiting Car Response defaults to 0 (§3).** Pin the untouched value to 0 (a true no-op that
  matches today), not 4; an untouched OK must not silently change dispatch, matching the
  SFD-48 story beside it.
- **Coarse-pointer sizing reaches the strip cells and stepper triples (§8, §9).** Extend the
  `pointer: coarse` block to `.strip` cells and the `[data-step]` nudges, and adopt the §8
  mobile strip (6-hour-snap scroll or 12+12 wrap) so a touch edit never depends on hitting a
  thin bar.

SHOULD-CONSIDER (folded as refinements):

- **Presets do not silently overwrite hand-set home floors (§5.1).** Scope a preset to the
  COUNT rows (and only set homes when the player has not authored any), or offer a lightweight
  in-dialog Undo for the last preset/Auto-tune; a whole-dialog Cancel is too blunt an undo for
  a one-button action.
- **Mark the recommended preset per shaft (§5.1, §5.4).** Highlight Feeder on express and Rush
  on a busy local, so the presets teach the mechanic instead of a flat three-button menu.
- **Live legibility sentence under each stepper (§3).** Show the announce sentence on-screen
  live (`Higher holds idle cars in place longer.`; a dwell tradeoff line for SFD), so
  the two tunables read as choices, not opaque knobs. Add press-and-hold auto-repeat and wire
  the disabled-at-floor/cap state.
- **Home floors: numbered car chips, not anonymous dots (§4.3).** Render `(5)(6)` chips rather
  than identical red dots, keep `Home all cars here` and a one-press "stage upper half
  up-tower" as the discoverable default, and drop the drag-between-rows gesture; the per-car
  chips are the split-staging tail.
- **Surface the base-floor and per-car assign as real WRITE affordances (§4.2, §4.3).** The
  mockup showed home marks and the `◎` base as read-only; give a focused row a visible
  `Set as base` control and a visible assign control, and differentiate the base glyph from a
  home mark (a `BASE` tag, not a near-identical ring).
- **Advice sits directly under the strip and never nags a maxed hour (§5.3).** Move the advice
  line under the strip it describes, and suppress the "short at H" clause whenever that hour
  already runs the full fleet (you cannot add a car you do not have); point at the `+ Car`
  action instead, or say nothing.
- **The day toggle scopes only the strip (§2).** Move Weekday/Weekend into the strip's header
  (`Cars on shift by hour: Weekday | Weekend`) so it visibly governs the per-day counts alone;
  the steppers, base, and home floors are shaft-wide and read that way.
- **Consider a dirty-only discard guard (§9).** This dialog holds a lot of authored state; a
  stray Esc dropping all of it silently is harsh. House grammar discards silently, so this is a
  judgment call, but a "Discard changes?" guard when the working copy is dirty is worth it.

### 14.4 Confirmed good (kept as specced)

Live-readout Simulate (no button), the Classic-open / Modern-folded split via the
`elevatorScheduleUX()` seam, no-confirm presets, and folding in `Configure stops…` (§7).
Auto-tune still cannot "win the dialog": it never overwrites a hand-set staging, so a player's
authored positioning always survives. Its one behavior change from the first draft is the party
recommendation now committed in §5.2: besides setting counts, it SEEDS staging toward the
busiest served lobby WHEN homes are unset, so the one-button assist helps positioning (the axis
that matters) instead of only the costless count axis. That seed rule is uniform across standard
and express (§5.4).

### 14.5 Sources (count-cost research, 2026-07-17)

The Classic "no count cost" ruling (§14.1) rests on GDD O2 (canon: no per-hour running cost)
plus a research pass that found only a flat per-shaft construction/maintenance cost, nothing
scaling with active cars:

- SimTower Wiki, Elevators: https://simtower.fandom.com/wiki/Elevators
- Relentless Optimizer, SimTower Reference: https://relentlessoptimizer.com/gaming/2021/03/13/simtower-reference/

The Modern Option A ruling rests on the 2026-07-17 game (Samus) and systems (Cloud) party,
whose reasoning (money-cost rejected; congestion-penalty inverts the `congestion.ts` monotonic
invariant; positioning-first re-layout) is summarized in §14.1 and §14.2.

## 15. Mobile design review (UX + game party, 2026-07-17)

A phone-focused roundtable (Sally, UX; Samus, game) reworked §8 after the desktop party, on the
owner's call to make the dialog work well on mobile. Both seats converged:

- **Cut the count strip, protect the staging list.** The strip is the low-agency axis (§14); on a
  phone it belongs behind Advanced in Modern (Auto-tune owns counts) and gets a tap-select-span
  editor in Classic. Per-car home-floor staging is the skill AND the most phone-native shape (a
  tappable row list), so it stays first-class, never folded away.
- **Numbered car chips are a mobile MUST** (promoted from the §14.3 SHOULD): anonymous dots are not
  separately tappable at 36px and drag-between-rows is unusable on glass. The single-stepper
  fallback (§12 Q3) is rejected on mobile because it buries the split-staging skill two folds deep.
- **One modal, one scroll axis;** a read-only demand sparkline carries the read half; the Simulate
  staging sentence is co-located with the staging control; a per-row peak-origin marker replaces the
  desktop ghost as the demand target; a dirty-discard guard is warranted on touch.
- **Same depth on the positioning axis, deliberately shallower on the count axis** (Samus's line): a
  phone player can author any home-floor staging a desktop player can, but may lean on Auto-tune and
  presets for counts, the axis with no ceiling to lock them out of.

The full mobile treatment is folded into §8; this section records the review and its rationale.

## 16. Build triage rulings (game + UX + architect party, 2026-07-17)

The Phase 3 build's adversarial review escalated three scope decisions; on the owner's call the
party (Samus, game; Sally, UX; Cloud, architect) ruled on each after fresh canon research into the
1994 Elevator window (manual OCR via archive.org, Sim Tower Wiki, dfloer/tower-docs TDT byte spec).
Canon facts the rulings rest on: the original was ONE window per shaft (a WD/WE toggle over a
6-time-frame clock strip, WCR and SFD panels, then a floors-by-cars grid showing serviced levels,
per-car home floors, and live car symbols); home floors were stored one per car; the dialog showed
no aggregate traffic statistics; express carried the same window with a restricted floor list.

- **Serviced floors and the `Configure stops…` fold-in (§4.1, §4.2, §7): deferred to the immediate
  next increment, unanimous.** The build ships as the scheduling surface only, and the standalone
  stops dialog stays alive until the fold-in lands. Grafting the floors section onto a
  review-hardened diff would re-arm the whole review over a doubled surface, and the interim state
  cannot diverge data-wise (both surfaces edit the same engine-owned fields). The canon one-window
  end state stands. The deferral is a live backlog row with its GitHub issue, and the fold-in
  increment must also retire `uiStops` and rewrite the suites pinning the stops button.
- **Staging list shape (§4.3): the shipped per-car selects are ratified as the INTERIM surface,
  unanimous.** They match the canon per-car data shape exactly, but they answer the staging
  question car-first when it is a floors-first question. The end state is the canon floors-by-cars
  grid, hosted by the serviced-floors rows the fold-in increment builds anyway (car chips on floor
  rows, §14.3/§15); the selects retire when it lands. One authoring surface, never both.
- **Simulate copy (§6, §11): re-pinned to the shipped staging-scored sentence, unanimous.** The
  original pinned strings named the rush's origin floors, data the per-hour accumulator does not
  hold; a readout must never claim what the sim cannot back. The sentence leads with the staging
  clause (the axis that responds to skill) and trails the on-shift count. The origin-floor variants
  are deferred behind a per-floor origin accumulator (backlog row; that accumulator would also
  sharpen the Auto-tune staging seed and feed the §15 peak-origin markers, and it must stay
  transient or it becomes a save-format conversation).
- **The measured-demand ghost series (§5.3, §14.2 move 1): deferred to the fold-in increment;
  both-modes commitment retained on a 2-1 vote.** Sally and Cloud hold the line that the GameRules
  seam differentiates affordances, never information access, and that Classic's strip is already a
  ratified non-1994 surface (24 slots against the original's 6 frames), so withholding the curve
  would leave Classic's manual-primary strip authoring blind. Samus's dissent (reading demand from
  the crowds IS the Classic skill loop; the 1994 dialog showed no stats) is recorded for the owner
  to overrule at the fold-in review if desired. The strip's count gridlines, pure presentation,
  shipped now in both modes.

Review patches folded into the build alongside these rulings: the apply path re-reads the live sim
(undo can swap it mid-dialog) and refuses a vanished shaft; presets no longer overwrite hand-set
homes and Auto-tune's staging seed is reachable on an untouched shaft; the up-tower staging target
falls back to the top served floor on a single-lobby shaft and the Simulate count follows any home
above the base; stored home floors snap to the nearest served stop; the measured ring seeds its
first sample at full value and the assists arm only after six sampled hours; the strip gained
keyboard editing (arrows adjust and move), shift-click span fill, and count gridlines; the pinned
announce strings ride the live region; touch gets 36px scrollable bars and the dirty-discard guard.

## 17. The floors fold-in as built (#464, 2026-07-17)

The fold-in increment shipped the one-surface dialog. Deltas against §4/§8/§15, recorded here
so the spec and the build cannot drift silently:

- **The floors grid is primary in BOTH modes** (staging-first, §14): span floors descending,
  Serve toggles (live-applied, per-toggle undo steps, exactly the retired dialog's semantics),
  the derived base marker, lobby tags, and one numbered chip per car on every served row. A
  chip press homes that car on that row: the radio-grid reading of §4.3's "focus a row and
  press its car number", chosen over focus-then-type (undiscoverable on touch) and drag
  (rejected in §15). The retired surfaces are gone: `Configure stops…`, its dialog, and the
  card's `Express (lobbies)` / `All stops` rows, which now live in the grid's quick row.
- **The base floor is DERIVED ONLY** (lowest served lobby, else the shaft bottom), marked with
  `◎` but not settable: the merged schedule model carries no base field, and adding one is a
  save-format conversation this increment does not open. §4.2's `Set as base` affordance is
  parked until an authored-base field earns a format bump; the marker plus the snap rules keep
  the derived base legible meanwhile.
- **The ghost series shipped in both modes** (§14.2 move 1, the §16 2-1 ruling): a dashed
  measured-demand mark per bar with the authored fill above it rendered pale as spare
  capacity, plus a one-line legend. The count gridlines and the in-scroller hour axis (ticks
  anchored to the bar track, so they scroll together; replaces the v1.57.1 static-axis hide)
  ride the same strip rebuild.
- **Mobile: the §15 read-only sparkline is superseded**, not built: with the strip scrolling
  inside its own well, the ghost carrying the read half, and Modern auto-opening Advanced
  whenever the advice line critiques strip numbers, a second demand rendering would duplicate
  the strip one fold away. The party may overrule at review. Shipped instead: the touch flow
  hint ("Tap an hour, then set its cars with − and +. A second tap spans hours."), second-tap
  span extension on coarse pointers, press-and-hold auto-repeat on every stepper, and the
  sticky day toggle. Peak-origin markers landed with the per-floor accumulator (#465),
  one increment later; see the origin bullet below.
- **Copy re-pins**: the Simulate base clause and the home-all quick action name the base floor
  when it is not the ground lobby (`8 at Floor 30 (the base)` / `Home all cars at Floor 30`),
  Samus's sky-lobby honesty flag from the containment review. New pinned strings: the stops
  announces (`Floor <n> served.` / `Floor <n> skipped.` / `Stops set to lobbies only.` /
  `Stopping at every floor.`), the grid heading `Serviced floors and home cars`, and the touch
  hint above.
- **Stop edits do not arm the discard guard**: they apply live with their own undo steps, so
  Cancel could not honestly take them back; the guard covers only the schedule working copy.
- **Known ghost limit**: the demand accumulator cannot tell "measured zero" from "hour not
  yet sampled", so an unsampled hour draws no dash rather than a zero dash. Tracked as
  `schedule-ring-sampled-mask` (#474).
- **Origin accumulator (#465, v1.61.0)**: the dispatcher tallies boardings by origin floor
  at its board site (only at stops with a live call, so a homecoming car cannot credit its
  own home floor and feed the staging aim back into itself); `sampleElevatorUtil` drains the
  tally hourly into day-split per-hour origin maps (transient, never serialized). The drain
  attributes to the hour that ENDED and to that hour's day type, so a midnight day-boundary
  drain files under yesterday's ring. Three specced surfaces land on it: red hotspot markers
  in the floors grid for the visible day's busiest hour, the Simulate trailing clause ("Most
  riders board on floors 5–7."), and Auto-tune's staging seed aiming the upper half at the
  busiest boarding floor across the WHOLE day's rings (a single peak-hour slot is often the
  lobby-dominated up-rush), preferring the visible day when warm. Presets keep the plain
  lobby split: they are intents, not measurements. Origins are gated on the day's warm demand
  curve, and both the markers and the aim are filtered to floors the shaft still serves, so
  EMA'd history can never mark or stage a skipped floor. Known limits, tracked: attendance
  venue riders (cinema, party hall) place real crowd calls and never enter the statistical
  boarding tally, so their floors cannot become hotspots; the dialog's origin snapshot goes
  stale across undo/adoptSim (#475).
- **Day-split rings (#466, v1.59.0)**: the measured accumulator keeps one 24-slot ring per
  day type, keyed on `clock.isWeekend` at sample time. The ghost, the advice sentence, the
  Simulate peak, and Auto-tune are all day-scoped: an unmeasured weekend shows no ghost and
  no advice even while the weekday curve is warm, and Auto-tune tunes each day only from its
  own ring (an unmeasured day keeps its authored row), announcing exactly which days it
  tuned. The Auto-tune button arms when either day is warm, with a hint naming the cold
  visible day; the warm-up gate (6 sampled hours) applies per ring and is re-checked on
  every recompute, so a day that warms while the dialog sits open is picked up. On a cold
  day the Simulate sentence does not claim a measured peak: it reads "No measured
  <day> peak yet; at the 17:00 down-rush: ...". The zero-vs-unsampled conflation is now
  per-day load-bearing (a genuinely dead weekend can never warm its ring); tracked as its
  own backlog row.
