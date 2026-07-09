---
title: "Technical Design: Classic Calendar Parity (mode-resolved calendar)"
game: Verticopolis (browser SimTower clone)
author: Cloud Dragonborn (Game Architect, gds agent), with the canon-calendar party
date: 2026-07-08
status: Spec, approved for implementation
scope: The engine implementation of a mode-resolved calendar (week / quarter /
  year lengths + weekend rule), the income-invariant economy rescale that keeps
  money-per-in-game-day fixed across calendars, the save/determinism seam, and
  the load-bearing invariants that keep Modern real-world byte-identical to today.
grounds:
  - gdd-classic-calendar-parity-2026-07-08.md (the player-facing contract)
  - docs/canon/tdt-format.md §3 (canon calendar constants)
  - src/engine/Clock.ts, src/engine/Simulation.ts (onDay), src/engine/EconomySystem.ts
  - src/engine/EventSystem.ts, src/engine/Crowd.ts (weekend/year consumers)
  - src/engine/types.ts (GameMode, SerializedGame), src/engine/saveMigration.ts
---

# Technical Design: Classic Calendar Parity

## 0. LOAD-BEARING INVARIANTS: read before touching this mechanic

> If you change anything here, **re-run `parity.test.ts` (the TOWER run) and
> `phase2.test.ts` (the well-zoned endgame)**, they are the only guards that the
> rescale kept a healthy tower healthy, plus the new `calendar.test.ts` below.

1. **Modern real-world is byte-identical to today.** The real-world calendar is
   the current 7-day week / 90-day quarter / 360-day year with today's rent and
   maintenance amounts (rescale factor exactly `1.0`). Every existing Modern save
   and every existing test must reload and run identically. This is the safety
   net that makes the whole change atomic-but-contained: all risk lives on the
   canon path. Do not "clean up" the real-world constants into the canon ones.

2. **The change is ATOMIC, you cannot land the display without the rescale.**
   `Simulation.onDay()` collects rent whenever `clock.quarter` changes. Flip the
   quarter to canon's 3 days without rescaling the per-collection amount and rent
   collects 30x more often at full size = a 30x income bug. The calendar length
   and the economy rescale are the same commit. There is no partial state where
   canon dates are shown over a 360-day economy.

3. **Money-per-in-game-day is the preserved invariant.** Each periodic collection
   scales by `periodDays / oldPeriodDays`. Rent: `× quarterDays / 90`. Under
   canon that is `3/90 = 1/30`; under real-world `90/90 = 1`. Encode the
   *invariant* in tests (income over N in-game days is calendar-independent within
   rounding), never a hand-typed "expect $X" that rots.

4. **A day is 1440 minutes in every mode.** Only derived week/quarter/year change,
   as pure functions of `clock.day` and the resolved calendar. `clock.day`,
   `clock.minutes`, `minuteOfDay`, the rush-hour windows, and all `day + N`
   delta timers (VIP `day+3`/`day+5`) are untouched. Do not rescale the day.

5. **The calendar is resolved once from `mode` + the Modern toggle, both in the
   save.** Classic always resolves to canon. Modern resolves to the saved toggle
   (`modernCalendar: "canon" | "realWorld"`, default `realWorld`; the persisted
   value unifies with the `CalendarKind` vocabulary rather than a separate
   "short" label). Reload is therefore
   deterministic; no `Date.now()`/`Math.random()` enters calendar logic.

6. **`lastQuarter` / `lastMonth` re-derive from `clock` on load.** `deserialize`
   already sets `sim.lastQuarter = sim.clock.quarter` and `sim.lastMonth =
   Math.floor(sim.clock.day / 30)` (Simulation.ts ~2319). Keep that re-derivation
   pointed at whatever the resolved calendar computes, so an in-flight save that
   changes which calendar it reads cannot double-collect or skip the first
   period after load.

## 1. The seam: a mode-resolved `Calendar`

Introduce one small value object that owns the four calendar constants and the
weekend rule, resolved from the game mode + Modern toggle:

```
type CalendarKind = "canon" | "realWorld";

interface Calendar {
  weekDays: number;      // canon 3,  realWorld 7
  quarterDays: number;   // canon 3,  realWorld 90
  yearDays: number;      // canon 12, realWorld 360
  isWeekend(day: number): boolean;   // canon: day % 3 === WEEKEND_SLOT; realWorld: day % 7 >= 5
}
```

- `resolveCalendar(mode, modernCalendar)` returns `CANON` for Classic, and for
  Modern returns `CANON` when the saved toggle is `"canon"` else `REAL_WORLD`.
- `Clock` holds a `Calendar` (injected; defaults to `REAL_WORLD` so bare `new
  Clock()` in tests is unchanged). Its `dayOfWeek`, `isWeekend`, `quarter`,
  `year`, `dayName`, and `formatRetroDate` read the calendar's constants instead
  of the hard-coded `7 / 90 / 360`.
- Canon constants come from `docs/canon/tdt-format.md §3` and must match the
  proven table in the GDD (`year = floor(day/12)`, `quarter =
  floor((day % 12)/3)`, both 1-indexed for display).

**Weekend phase is a validation output, not a guess.** `WEEKEND_SLOT` (which of
the 3 canon day-slots is the weekend) is pinned by the harness check in §5, then
frozen as a named constant. Today's real-world rule (`day % 7 >= 5`, Sat+Sun)
stays exactly as is.

## 2. Where the calendar is consumed (blast radius)

Audited consumers of the calendar-derived getters:

- **Rent**, `Simulation.onDay()` fires `economy.collectRent()` on `clock.quarter`
  change. `collectRent()` multiplies its total by `quarterDays / 90` (see §3).
- **Maintenance**, `onDay()` currently fires `payMaintenance()` on
  `floor(clock.day / 30)` change. Replace the 30-day "month" with a calendar
  period (canon = per-quarter, the only sub-year cadence canon has; real-world =
  the current 30 days so today is unchanged). Scale `payMaintenance()` amounts by
  `maintPeriodDays / 30`. `rollCondoRelocations()` rides the same tick and is
  rescaled with it (it is a Modern-only monthly roll; keep its per-real-day
  probability invariant).
- **Weekend demand**, `Crowd.ts` reads `clock.isWeekend` (hotel fill, retail
  rush). No code change beyond the calendar swap; it automatically follows the
  canon 3-day beat in Classic.
- **Yearly / seasonal events**, `EventSystem.ts` keys some behavior off
  `year` / day-of-year. Anything that means "about once a year" must be rescaled
  so it does not fire 30x more often under a 12-day year: convert to a per-real-day
  probability (`p_perYear / yearDays`) or key it off `day` deltas. Per-day event
  rolls are already calendar-independent and stay as-is. This audit is part of
  the implementation; list each touched call in the PR description.
- **Display**, `formatRetroDate()` and any HUD/Finance date string.

Nothing in the transport, build-cap, or population-census code reads the
calendar; those invariants are untouched.

## 3. The economy rescale

Localized to the two collectors, so the cadence and the amount can never
disagree:

```
// EconomySystem.collectRent()
total *= this.sim.calendar.quarterDays / 90;   // canon 3/90 = 1/30, realWorld = 1

// EconomySystem.payMaintenance()
amount *= this.sim.calendar.maintPeriodDays / 30;  // canon 3/30 = 1/10, realWorld = 1
```

- Factor is derived from the resolved calendar, so real-world is provably `1.0`
  (no float drift for the untouched path: guard `factor === 1` fast-path, or
  assert the real-world constants divide cleanly).
- `collectRent` applies the rescale to the summed total (one multiply, one
  rounding site), so per-office rounding cannot accumulate.
- `payMaintenance` instead rounds **per line item** in its `charge()` helper.
  This is a deliberate deviation from the single-rounding-site approach: the
  helper must keep `cost` (what leaves `money`) exactly equal to the sum mirrored
  into the per-category ledger, which a single total-round would break. It is
  exact for the shipped data because every maintenance constant is a multiple of
  10, so canon's `1/10` factor lands on an integer with zero residue; a future
  maintenance constant that is not a multiple of the period divisor would
  introduce sub-dollar per-item rounding (guard with a test if one is added).
- Round half-up to whole dollars; document that the tiny per-collection rounding
  is intentional and swamped over a day.

## 4. Persistence & determinism

- **New save field:** `modernCalendar?: "canon" | "realWorld"` on
  `SerializedGame` (Modern only; absent or garbage -> `"realWorld"` via the
  existing coercion pattern). Classic ignores it and always resolves canon.
- **`SAVE_VERSION`: no bump, additive optional field** (the `filmPolicy` /
  `vacateReason` precedent). DECIDED during implementation. The calendar is a
  pure function of `mode` + `modernCalendar`, both already in the save, so a
  Classic save resolves to canon whether it is old or new, there is nothing in
  the save *data* to migrate, and a bump with an identity migration would buy no
  determinism. Existing Classic saves adopting canon on load is the intended
  *fix* (their date display was wrong), not a regression to grandfather, so no
  version gate is wanted. Confirmed safe by the full suite passing unchanged
  under canon (no fixture-replay test asserts a calendar-dependent value on a
  Classic save). Modern saves without the field coerce to `realWorld` and are
  byte-identical.
- **In-flight Classic saves.** `clock.day` is unchanged, so the tower's history is
  intact; only the derived date label and the forward cadence change. The
  `lastQuarter`/`lastMonth` re-derivation (invariant 6) means the first
  post-load period boundary is computed under the new calendar, so no double-
  charge or skip. This is the one place a save visibly "jumps" (its date relabels
  from e.g. Year 1 to Year 107); that is correct, and cosmetic.
- No `Date.now()` / `Math.random()` in any calendar path; headless and browser
  runs agree.

## 5. Harness validation (gates the merge)

Run on `tools/simtower/` (committed, opt-in, bring-your-own-ISO):

1. **Weekend phase**, VALIDATED 2026-07-08 (Wine harness, `my_tower.TDT`). The
   retail game's date stamp reads `<n>th WD/<Q>Q/<ord> Year` (identical to our
   `formatRetroDate`). Loaded from saved `currentDay` 60, the game ran forward
   and rendered `1st WD/2Q/6th Year` (= our model at day 63) then
   `2nd WD/3Q/6th Year` (= our model at day 67). Both match exactly: the week is
   `[1st WD, 2nd WD, WE]` (weekend is the TRAILING slot = `day % 3 == 2`), the
   quarter rolls every 3 days, and the weekday slot is `day % 3` (0-based). This
   confirms `CANON.weekendDays: 1` trailing and the absolute phase; no code
   change needed. (Note: the game advances during a headless load, so this is a
   two-point progression-consistency check, not a frozen-day read; the two points
   pin both weekday slots and two quarter boundaries.)
2. **Maintenance cadence**, read the retail Finance window across several
   in-game days to confirm the recurring-cost beat, justifying the canon
   per-quarter choice (or correcting it).
3. **Date round-trip**, `currentDay` <-> displayed date exact for MYTOWER /
   TOWER5 / TOWER6 (mostly proven); add any 3-star+ save available.

## 6. Test plan

`src/tests/calendar.test.ts` (new) plus the existing balance guards:

1. **Canon date math**, `year`/`quarter`/`dayOfWeek` for the proven table
   (`day 55 -> Y5 Q3`, `day 1280 -> Y107`, `day 1289 -> Y108`).
2. **Real-world unchanged**, the current getters produce today's exact values
   for a spread of days; `formatRetroDate()` string pinned.
3. **Income invariance**, simulate the same tower for N in-game days under canon
   vs real-world; total rent + maintenance net is equal within rounding. This is
   the balance invariant, encoded, not a hand-typed dollar figure.
4. **Cadence**, rent fires on every canon quarter boundary (every 3 days) in
   Classic and every 90 days in real-world; maintenance likewise.
5. **First-period safety**, a save deserialized mid-quarter does not double-
   collect or skip on the first `onDay()` after load, under both calendars.
6. **Toggle persistence**, Modern `canon`/`realWorld` round-trips through
   serialize/deserialize; missing field coerces to `realWorld`.
7. **`parity.test.ts` + `phase2.test.ts`**, a healthy tower stays healthy (the
   real balance guard for the rescale).

## 7. File-touch summary

- `src/engine/Clock.ts`, hold a `Calendar`; derive `dayOfWeek`/`isWeekend`/
  `quarter`/`year`/`dayName`/`formatRetroDate` from it. New `calendar.ts` (or a
  small block here) for `CANON` / `REAL_WORLD` constants + `resolveCalendar`.
- `src/engine/Simulation.ts`, hold/resolve the `Calendar`; `onDay()` maintenance
  period off the calendar (kill `day/30`); keep the `lastQuarter`/`lastMonth`
  re-derivation pointed at the resolved calendar.
- `src/engine/EconomySystem.ts`, `collectRent` / `payMaintenance` rescale.
- `src/engine/EventSystem.ts`, rescale any per-year cadence (audit + list).
- `src/engine/types.ts`, `SerializedGame.modernCalendar`, coercion helper.
- `src/engine/saveMigration.ts`, version decision (see §4).
- New-Tower UI (Modern), the Short vs Real-world toggle, wired to the save field.
- `docs/canon/tdt-format.md`, cross-link §3 as the constant source; `PARITY.md`
  line noting Classic = canon calendar, Modern default = real-world.
- Fold in the deferred `tdtFormat.ts:603` truncation-warning wording tweak.
  (Not folded in: no discrete deferred wording item was found in the backlog
  when implemented; the existing message at `tdtFormat.ts:600-602` is already
  honest, so it was left unchanged rather than churned.)

## 8. Review Findings (`/gds-code-review`, 2026-07-08, v1.15.0)

Three adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor).
Every `patch` finding was fixed and re-verified (gates green: typecheck, lint,
951 tests, build). Load-bearing invariants 1-6 and the SAVE_VERSION §4 decision
were all confirmed satisfied by the reviewers.

**Patched (7):**
- `[Patch]` Rescale divisors were bare `90`/`30` literals, not linked to the
  `REAL_WORLD` constants they must equal for the byte-identical claim, now
  `REAL_WORLD.quarterDays` / `REAL_WORLD.maintPeriodDays` (`EconomySystem.ts`,
  `Simulation.ts` condo relocation).
- `[Patch]` `emitLunchRush` still hard-coded a 7-day week (`% 7 >= 5`); routed
  through `clock.calendar` so the bulletin fires on the right days under canon
  [`src/main.ts`].
- `[Patch]` `Clock.dayName` was calendar-blind (canon weekend slot rendered
  "Wed", contradicting `isWeekend`/`formatRetroDate`); now real-world keeps
  Mon..Sun, canon labels WD/WE slots [`src/engine/Clock.ts`].
- `[Patch]` Maintenance toast said "Maintenance paid" on every calendar; restored
  the exact "Monthly maintenance paid" string for real-world (where the charge
  genuinely is monthly) so that path stays byte-identical [`EconomySystem.ts`].
- `[Patch]` The `calendar.ts` weekend-phase remediation comment wrongly said to
  "adjust weekendDays's slot"; corrected (it is a count, not a slot) + backlog
  contingency note.
- `[Patch]` Added the missing test-plan coverage: maintenance per-in-game-day
  invariance and the quarter/year cadence, on both calendars [`calendar.test.ts`].
- `[Patch]` Doc reconciliation: the wire value is `"canon"` (not `"short"`) and
  `payMaintenance` rounds per line item (not on the summed total) to keep
  `money == ledger`; §1/§3/§4 updated.

**Deferred (2)** (see backlog Deferral inbox): the 999-year day-counter roll is
unimplemented (out of acceptance scope); the trailing-slots weekend model can't
express a non-trailing phase (contingent on the harness result).

**Dismissed (2):** `collectRent`'s `Math.round` is a no-op for real-world because
`total` is a sum of integer rents (byte-identical holds); the "Monthly
maintenance" string had no other consumers (repo grep confirmed).

**Remaining before merge (owner-driven):** the harness weekend-phase validation
(§5.1) and the optional maintenance-cadence confirmation (§5.2). The date
round-trip (§5.3) is already proven.
