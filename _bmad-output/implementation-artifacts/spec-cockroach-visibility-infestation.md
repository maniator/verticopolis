# Story: Cockroach Visibility + Infestation Lifecycle

Status: ready-for-dev

Tracks GitHub issues **#376** (hotel infested/sticky states) and **#401**
(housekeeping coverage overlay). Ships as one PR on branch
`claude/cockroaches-ui-visibility-c51wlw`. Review skill: `/gds-code-review`.

## Story

As a Verticopolis player who under-provisions hotel housekeeping,
I want to actually SEE cockroaches on the affected rooms and understand why
they are there and how to clear them,
so that the infestation is a legible, actionable game state instead of a
transient toast I miss and cannot locate.

### Background (why now)

The engine already breeds "cockroaches": a hotel room left `dirty` overnight
spreads to its neighbors (`spreadCockroaches`, `housekeeping.ts:190`). But the
only player-facing signal is a one-shot log toast (`🪳 Cockroaches spread ...`);
there is no roach sprite, no distinct infested state, and the Housekeeping
overlay tints crew *reach*, not the dirty rooms themselves. The original
SimTower drew an unmistakable roach sprite over infested rooms and made them
un-cleanable (bulldoze only). Owner reviewed a live save (`sixseven_11.vctower`,
96 dirty rooms across floors 14-59) and confirmed the gap.

## Owner-ratified design (party-mode debate, 2026-07-16)

Escalation timer and roach SPREAD are identical in both modes. Only the
RECOVERY of an infested room diverges by mode.

- **Escalation:** a hotel room continuously `dirty` for **3 days** escalates to
  a new `infested` state. Housekeeping can no longer clean an `infested` room
  (dispatch already only targets `dirty`). Infested rooms keep spreading and
  earn no rent.
- **Classic (pure 1994 parity):** `infested` is **permanent**. The only fix is
  bulldoze + rebuild. This intentionally REVERSES the current documented "keep
  it cleanable, no permanent infestation" decision (`PARITY.md` ~line 98 and the
  "will-not-build" note in
  `planning-artifacts/design/gdd-simtower-optimization-gaps-2026-07-15.md`),
  which must both be updated.
- **Modern (owner-ratified new mechanic):** a **paid exterminator** recovers
  infested rooms. Minimum call-out fee **~$5,000** plus **~$2,000 per infested
  room**, resolving the **next day** (rooms keep earning nothing and dirty
  neighbors keep spreading while you wait). Bulldoze remains the free-but-manual
  alternative. The per-room fee is tuned so a small outbreak is cheaper to
  exterminate than rebuild, and a large neglected wing is cheaper to bulldoze:
  "the crossover is the decision." This is a NEW mechanic (the 1994 game had no
  exterminator); it must be recorded as an owner-ratified divergence alongside
  the Modern-only economy sinks, gated entirely through `GameRules`.

## Acceptance Criteria

1. A `dirty` hotel room renders a light cockroach sprite; an `infested` room
   renders a heavier one. Both read correctly at both grades (single/double/
   suite) and on horizontally flipped rooms, and do not regress the existing
   `asleep`/ready/`empty` art.
2. A hotel room `dirty` for 3 consecutive in-game days escalates to `infested`
   at the daily checkout boundary (`beforeCheckout`, before the morning's fresh
   checkouts). The 3-day clock survives a save/load round trip (no reset
   exploit).
3. Housekeeping never cleans an `infested` room. `infested` rooms are the
   spread SOURCE. (SUPERSEDED 2026-07-17, v1.53.1: originally "like `dirty`";
   canon narrowed the source to `infested` only.)
4. Classic: an `infested` room cannot be recovered except by bulldoze. No
   exterminator is offered. Bulldozing an infested room works and is not blocked
   by any new logic.
5. Modern: the player can dispatch a paid exterminator. It charges
   `calloutFee + perRoomFee * infestedCount` immediately (rejected with a clear
   message if the tower has no infested rooms or insufficient funds), records
   the spend to the ledger, and clears the infestation the NEXT day. Bulldoze
   also still works.
6. The Housekeeping heat-overlay tints actual `dirty` and `infested` rooms
   (distinct from clean), and marks floors outside staff/service-elevator reach
   (#401), reusing the existing heatmap pipeline.
7. The inspector shows friendly status text for `dirty`, `asleep`, and
   `infested` (no raw enum), each with a plain-language WHY and the mode-correct
   fix (housekeeping can't keep up / bulldoze / call the exterminator).
8a. Housekeeping legibility (mirrors parking): `Simulation.housekeepingCoverage()`
   exposes `{ rooms, crews, dailyCapacity, outOfReach, dirty, infested }`; a stats
   row reads `Housekeeping: C crews clean ~X rooms/day · R rooms · Z out of reach`
   (red when `dailyCapacity < rooms` or `outOfReach > 0`); a housekeeping station's
   inspector shows its ~`HK_ROOMS_PER_CREW`/day capacity and the rooms in its staff
   reach. No per-station room count exists today; this closes the parity gap with
   `parkingDemand()`.
8. `package.json` `version` is bumped (player-facing). `PARITY.md` and the
   optimization-gaps doc are updated. Backlog rows for #376/#401 are resolved
   and their GitHub issues closed per the standing mirror rule.
9. All four gates green (`typecheck`, `lint`, `test`, `build`); `/gds-code-review`
   run and every `patch` finding fixed, every `defer` finding logged in the
   backlog.

## Tasks / Subtasks

- [ ] **Engine: `infested` state + escalation** (AC: 2, 3, 4)
  - [ ] Add `"infested"` to `UnitState` union + `UNIT_STATES` set + comment
        (`src/engine/types.ts`). Audit `isOperational`/`isPresent`/`isTenanted`/
        `isDormant`: infested is present-but-not-tenanted, operational-but-dormant
        (nobody home, no income). Confirm each predicate's treatment explicitly.
  - [ ] Add `dirtySince?: number` to `Unit` (the day the room entered `dirty`).
        Set it wherever a room becomes `dirty` (checkout in `EconomySystem.hotelCheckout`
        and `spreadCockroaches`). Clear it when a room leaves `dirty` (cleaned in
        `Housekeeping.onResult`).
  - [ ] Persist `dirtySince` through `serializeUnit`/`deserialize` (`src/engine/sim/coerce.ts`)
        so the 3-day clock cannot be reset by save/reload. Coerce untrusted values.
  - [ ] In `Housekeeping.beforeCheckout`, BEFORE `spreadCockroaches`, escalate any
        room `dirty` for `>= INFEST_DAYS` (3) to `infested`. New constant near
        `HK_ROOMS_PER_CREW`.
  - [ ] Make `spreadCockroaches` spread from `infested` rooms; neighbors still go
        `dirty`. (Updated 2026-07-17, v1.53.1: source is `infested` only, not
        `dirty || infested`, per SimTower canon.)
- [ ] **Engine: gameRules recovery seam + Modern exterminator** (AC: 4, 5)
  - [ ] Add `GameRules.infestationRecovery(): { calloutFee: number; perRoomFee: number } | null`.
        Classic returns `null` (permanent); Modern returns the fee model. Constants
        alongside the other Modern economy magnitudes.
  - [ ] Add `Simulation.callExterminator()` (Modern only): count infested hotel
        rooms; reject (emit) when 0 or unaffordable; else charge, record ledger
        (`recordMoney`), and schedule next-day resolution via a single serialized
        `exterminationDueDay?: number` on the sim.
  - [ ] Resolve at the day boundary (in `loop.onDay`/`hotelCheckout` after
        escalation): when `clock.day >= exterminationDueDay`, set the rooms
        billed at call time (the remembered id list) to `empty`
        (`satisfaction = 1`, `dirtySince` cleared) and clear the due day. If the
        billed id list is missing after a mid-booking save/load, fall back to
        clearing every infested room. Overnight threshold-crossers are billed
        and cleared together, not swept for free.
  - [ ] Add a `LedgerCat` for extermination if the existing set has no fit.
- [ ] **Render: roach sprites** (AC: 1)
  - [ ] In `residential.ts` `hotel()`, add an `infested` local and a roach-drawing
        helper (small dark oval bodies + legs/antennae in `fill` pixels). Draw a
        couple on `dirty`, more on `infested`. Keep it outside the mirror wrapper
        (like the other state cues) so flipped rooms are pixel-identical, or seed
        positions deterministically from `u.id`.
  - [ ] Extend `residential.test.ts` dirty-state assertions and add infested.
- [ ] **Overlay #401** (AC: 6)
  - [ ] In `towerOverlay.ts`, extend the cleanliness/Housekeeping heatmap to tint
        `dirty`/`infested` rooms and flag out-of-staff-reach floors, reusing
        `staffConnected`/`staffComponents` and the existing legend pipeline.
- [ ] **UI: inspector + exterminator control** (AC: 7, 5)
  - [ ] `inspector.ts` `statusText`: friendly copy for `dirty` ("Needs cleaning
        (guest checked out)"), `asleep` ("Guest sleeping"), `infested`
        ("Cockroach infestation"), each with the WHY + mode-correct fix line.
        Update the pinned strings in `inspector.test.ts`.
  - [ ] Surface a "Call exterminator ($X to clear N rooms)" action in Modern when
        infested rooms exist (stats/housekeeping panel is the discoverable home;
        the inspector explains the option). Wire UI -> `Simulation.callExterminator()`.
- [ ] **UI: housekeeping coverage readout** (AC: 8a)
  - [ ] `Simulation.housekeepingCoverage()` (near `parkingDemand`, `sim/services.ts`):
        count hotel `rooms`, operational `crews`, `dailyCapacity = crews * HK_ROOMS_PER_CREW`
        (export the constant), `outOfReach` (hotel rooms in no crew's staff component,
        reuse the `staffComponents` logic already in `congestion.ts`), `dirty`, `infested`.
  - [ ] Stats row in `stats.ts` (and/or `towerStats.ts`) mirroring the parking rows,
        red when under-provisioned.
  - [ ] `facilityDiagnostics.ts`: a `housekeeping` branch showing capacity + rooms in reach.
- [ ] **Docs, tests, gates, review** (AC: 8, 9)
  - [ ] Update `PARITY.md` (Classic parity restored; Modern exterminator as a
        ratified divergence) and the optimization-gaps doc (move #376 from
        will-not-build / tracked-only into shipped; #401 shipped).
  - [ ] Resolve backlog rows + close issues #376 and #401.
  - [ ] Bump `package.json` version (minor: new player-facing capability).
  - [ ] Unit tests: escalation timing, save/load clock, housekeeping-skips-infested,
        spread-from-infested, Classic-no-exterminator, Modern charge/reject/next-day
        resolution, serialization round trip, render, overlay.
  - [ ] Run all four gates + `/gds-code-review`; fix `patch`, log `defer`.

## Dev Notes

### Current state of files being modified (READ before editing)

- `src/engine/types.ts`, `UnitState` union (line ~80), `UNIT_STATES` guard set,
  the four state predicates (`isOperational` 153, `isPresent` 162, `isTenanted`
  179, `isDormant` 186), `Unit` interface (225) and `SerializedUnit` (359).
  Preserve: every predicate routes "is this room X?" checks; adding a state means
  each predicate must place it deliberately. `infested`: present-for-nobody
  (NOT `isPresent`, nobody's home), NOT `isTenanted`, IS `isDormant` (no
  sim/income), IS "operational" only in the sense of not-construction/fire/gutted
 , but earns nothing; verify no income path keys off `isOperational` for hotels
  in a way that would pay an infested room.
- `src/engine/economy/housekeeping.ts`, `beforeCheckout` (41) already runs once
  per day before checkout and calls `spreadCockroaches` (190). `dispatch` (94)
  filters `room.state === "dirty"`, so infested is auto-skipped; do NOT add
  infested there. `onResult` (174) clears dirty -> empty; add `dirtySince`
  clear. All the Map state here is transient/not serialized by design, put the
  3-day clock on the Unit (`dirtySince`), not in this module.
- `src/engine/EconomySystem.ts`, `hotelCheckout` (285) sets `asleep -> dirty`;
  set `dirtySince` there. `HK_ROOMS_PER_CREW`/`HK_MAX_IN_FLIGHT` live here.
- `src/engine/gameRules.ts`, `GameRules` interface (74) + `CLASSIC_RULES`/
  `MODERN_RULES` + `makeRules` (461). Mirror the Modern-only-sink pattern
  (`operatingOverheadPerUnit`, `noiseErosionScale`, etc.): Classic returns the
  neutral value (`null`), Modern the real one. Accessed via `sim.rules?`
  (`SimContext.ts:29`); absent falls back to Modern.
- `src/engine/sim/loop.ts`, `hotelCheckout` fires at `HK_SHIFT_START` (104),
  `onDay` at 118. Exterminator resolution belongs on the day boundary.
- `src/render/pixelSprites/residential.ts`, `hotel()` (282); `dirty` local
  (285), rumpled-bedding branch (330), housekeeping-tray cue (381). State cues
  draw OUTSIDE the `maybeMirrored` wrapper on purpose.
- `src/render/excalibur/towerOverlay.ts`, `HEATMAP_LABELS` (32, cleanliness =
  "Housekeeping"/"covered"/"unreached"), `drawStatsMap` (235), `drawHeatLegend`
  (284), `heatColor` (49).
- `src/ui/templates/inspector.ts`, `statusText` (31-37) prints raw enum for
  everything except `vacating`. Legacy-replica equivalence tests pin these
  strings in `inspector.test.ts`.
- `src/main.ts`, hover/inspect wiring (866-880); UI -> sim command surface for
  the exterminator action.

### Testing standards

Vitest, deterministic seeded `rng.ts`, headless engine (no DOM in `src/engine/`).
Shift-left + regression per `AGENTS.md`. Add engine tests beside existing
`src/tests/**` and `src/engine/**/*.test.ts`; render tests use the existing
canvas-mock pattern in `src/render/pixelSprites/residential.test.ts`.

### Project Context Rules

- **`src/engine/` stays DOM/render-free.** Roach art is render-layer only; the
  engine exposes state, never pixels.
- **Tuning lives in canon files, quoted not duplicated.** Escalation days and
  exterminator fees are named constants near their siblings
  (`HK_ROOMS_PER_CREW`, the Modern economy magnitudes), not scattered literals.
- **Mode divergence flows through `GameRules` only**, no `if (mode === ...)` in
  the engine body.
- **American English; no em-dashes in new prose/copy/comments.** No AI-marketing
  vocabulary. Player copy stays plain and human.
- **Parity is the bar; new mechanics need owner ratification.** The Classic side
  RESTORES canon (the roach/infested state the 1994 game had). The Modern
  exterminator is a NEW mechanic, owner-ratified here; document it like the other
  ratified divergences, do not present it as canon.
- **Backlog mirrors to GitHub issues** (#376, #401): resolve rows and close
  issues when the work lands.
- **Version bump required** (player-facing).

### References

- [Source: src/engine/economy/housekeeping.ts#spreadCockroaches]
- [Source: src/engine/types.ts#UnitState]
- [Source: src/engine/gameRules.ts#GameRules]
- [Source: PARITY.md#Housekeeping]
- [Source: _bmad-output/planning-artifacts/design/gdd-simtower-optimization-gaps-2026-07-15.md] (#376, #401)
- [Source: _bmad-output/project-context.md#Housekeeping] (never-instant, distinct art, capacity finite)

## Dev Agent Record

### Agent Model Used

Claude Code (gds workflow).

### Completion Notes List

- Design ratified live via party-mode debate; owner picked "visible + full
  Classic parity, Modern paid exterminator (scaling + call-out), everything in
  one PR."

### File List

- Engine: `src/engine/types.ts` (infested state, dirtyDays, exterminationDueDay),
  `src/engine/economy/housekeeping.ts` (escalation, spread-from-infested, constants),
  `src/engine/gameRules.ts` + `src/engine/econConfig.ts` (infestationRecovery seam + fees),
  `src/engine/Simulation.ts` + `src/engine/sim/services.ts` (exterminator, coverage),
  `src/engine/sim/loop.ts` (resolution hook), `src/engine/sim/serialization.ts` +
  `src/engine/sim/coerce.ts` (persistence + coercion), `src/engine/sim/congestion.ts`
  (overlay infested tier), `src/engine/EventSystem.ts` (fire upward spread).
- Render: `src/render/pixelSprites/residential.ts` (roach sprites).
- UI: `src/ui/templates/inspector.ts` (status text), `src/game/facilityDiagnostics.ts`
  + `src/game/housekeepingDiagnostics.ts` (why + fix + coverage lines),
  `src/ui/templates/stats.ts` (coverage rows + exterminator button),
  `src/ui/uiDialogs.ts` + `src/ui/UI.ts` + `src/main.ts` (button wiring + confirm).
- Tests: `src/tests/integration/cockroachInfestation.integration.test.ts` (new),
  `src/tests/integration/gameEvents.integration.test.ts` (fire upward spread),
  `src/tests/integration/heatmap.integration.test.ts` (infested tier),
  `src/render/pixelSprites/residential.test.ts` (roach paint).
- Docs: `PARITY.md`, the gaps GDD, this spec + the design GDD + decision log,
  `_bmad-output/implementation-artifacts/backlog.md`, `package.json` (1.53.0).
