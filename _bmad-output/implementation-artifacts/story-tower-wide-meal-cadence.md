---
baseline_commit: 50c41094eab2fe0b6a2a71d8a379c150c92dea85
---

# Story: Tower-wide meal cadence

Status: review

Grounds: `_bmad-output/planning-artifacts/design/gdd-tower-wide-meal-cadence-2026-07-09.md`, `_bmad-output/planning-artifacts/design/arch-tower-wide-meal-cadence-2026-07-09.md`. This story implements the single feature both docs describe.

## Story

As **a player of a mid-to-late-game Verticopolis tower**,
I want **elevator load at breakfast, lunch, dinner, and late-night to reflect the actual foot traffic of every eating population**,
so that **shafts have to be sized for meal peaks (not just morning/evening commutes) and the "Lunch rush!" bulletin the game already shows corresponds to real stress on my transport network, matching how SimTower 1994 played**.

## Acceptance Criteria

1. **Windows.** Four meal windows are defined in one place in `Crowd.ts`: breakfast 6-9, lunch 11-14, dinner 17-20, late-night 21-24. A `mealWindowFor(hour)` helper returns the current window key or `null`. Lunch matches `Clock.isLunch()` byte-for-byte.
2. **Origin bins.** `Crowd.spawnFloors` produces the existing three bins plus `condoFloors`, `hotelFloors`, and `staffFloors: {kind, floor}[]`. `officeFloors` continues to be represented by the existing `staffedOffices` bin for the meal path (weekday-gated automatically via `updatePresence`).
3. **Staff on-shift gate.** A single `staffOnShift(kind, hour)` helper determines eligibility: housekeeping is on-shift `[HK_SHIFT_START, HK_SHIFT_END)` reading the exact constants from `EconomySystem`; security, medical, recycling are always eligible while operational.
4. **Meal-mix table.** A static `MEAL_MIX` table lists per-window origins with their weights and venue kinds, matching the GDD §3 table. No per-window if/else in `spawnTrips`.
5. **Weight for condos.** A new `ECON.mealPopulationWeights` constant carries `office: 1.0, condo: 0.3, hotel: 1.0, staff: 1.0`. No other new economy constants.
6. **Outbound + lagged return.** For each active meal window, `spawnTrips` adds outbound `origin -> venue` options weighted heavier in the first ~60% of the window and return `venue -> origin` options weighted heavier in the last ~60%; the profile crossover is in the middle third.
7. **Off-window fires zero meal trips.** For any hour outside the four meal windows, no meal-typed options are added. The existing morning/evening/night flow is unaffected.
8. **`MAX_PEOPLE` cap holds.** A large tower simulated through a full lunch window never exceeds `crowd.people.length === MAX_PEOPLE (140)`.
9. **Weekend correctness.** On a weekend day at 12:00, zero office-origin trips fire; condo/hotel/weekend-eligible-staff trips still fire. This comes for free from `staffedOffices` being empty on weekends (do not add a redundant `isWeekend` check).
10. **Income invariance.** `EconomySystem.collectTrafficIncome` returns the exact same numeric value on a fixed-clock fixture before and after the change (byte-identical economy).
11. **Bulletins.** Info-log entries "Breakfast rush!" and "Dinner rush!" fire at the start of their windows using the same day-boundary idiom as the existing lunch bulletin, gated by a tenant-count floor (min 30 occupied tenants).
12. **Dinner clock-crawl.** `timePacing.ts` gains an 18:00-18:30 crawl by splitting the 17:00-21:00 period into three sub-periods. The day's total frames stays 2600.
13. **No save fields.** `SerializedGame` is untouched. No `SAVE_VERSION` bump.
14. **Quality gates.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green.

**Explicitly deferred to follow-up (owner call 2026-07-09):** the visible-occupancy
render dip was drafted here and PULLED. Its "less people in offices during
lunch" effect is what the deeper canon parity work delivers honestly:
per-person round-trip tracking (individuals leave the office, arrive at the
venue, return) PLUS venue-customer population census (fastFood ~35, restaurants,
shops per canon) that lets `u.occupants` legitimately dip because real people
left. Faking it with a render-only projection is the wrong scope; the real fix
lands via the `population-census-parity` backlog row plus a new
`per-person-meal-round-trips` follow-up.

## Tasks / Subtasks

- [x] `src/engine/econConfig.ts` (UPDATE): add `mealPopulationWeights: { office: 1.0; condo: 0.3; hotel: 1.0; staff: 1.0 }` to the `ECON` object. (AC: 5)
- [x] `src/engine/Crowd.ts` (UPDATE): the meal-cadence surface. (AC: 1, 2, 3, 4, 6, 7, 9, 10)
  - [x] Named constants at the top: `MEAL_WINDOWS`, `MealWindow` type, `MEAL_MIX` table. (AC: 1, 4)
  - [x] `mealWindowFor(hour: number): MealWindow | null` helper. (AC: 1)
  - [x] `staffOnShift(kind: StaffKind, hour: number): boolean` helper reading `HK_SHIFT_START/END` from `EconomySystem`. (AC: 3)
  - [x] Extend `SpawnFloors` type with `condoFloors: number[]`, `hotelFloors: number[]`, `staffFloors: {kind, floor}[]`. (AC: 2)
  - [x] Extend `spawnFloors()` to populate the three new bins in the same pass over `tower.units`. `staffFloors` respects operational state; the on-shift gate is applied at meal-consumption time. (AC: 2)
  - [x] Extend `spawnTrips()` to add meal-window options when `mealWindowFor(clock.hour)` is non-null. Weights come from `MEAL_MIX` and `ECON.mealPopulationWeights`. Outbound and return profiles per AC 6. (AC: 4, 6, 7)
  - [x] Preserve every existing branch (morning, evening, day, night) untouched; meal options are ADDED to `options` before `rng.pick`. (AC: 7, 10)
- [x] `src/engine/timePacing.ts` (UPDATE): split 17:00-21:00 into three sub-periods for the dinner crawl. Verify the day's total stays 2600 frames. (AC: 12)
- [x] `src/main.ts` (UPDATE): sibling emitters for breakfast and dinner mirroring `emitLunchRush`. Prefer folding all three into `emitMealRush(kind)` to keep the day-tag logic in one place. Tenant-count floor at 30. (AC: 11)
- [x] `src/tests/mealCadence.test.ts` (NEW): the ten test cases from arch §10. (AC: 1-11)
  - [x] `mealWindowFor` truth table for all 24 hours. (AC: 1)
  - [x] Off-window fires zero meal trips (hour 3). (AC: 7)
  - [x] Weekday lunch fires office-origin trips. (AC: 4)
  - [x] Weekend lunch fires zero office trips (condo/hotel still fire). (AC: 9)
  - [x] Housekeeping shift gate: fires at 12, silent at 21. (AC: 3)
  - [x] Security 24-hour: fires at 3, 12, 21. (AC: 3)
  - [x] `MAX_PEOPLE` cap holds across a full lunch simulation. (AC: 8)
  - [x] Return trips lag outbound over a full window (aggregate check). (AC: 6)
  - [x] `collectTrafficIncome` byte-identical on a fixed-clock fixture. (AC: 10)
  - [x] Bulletin cadence: fires once per meal per day, silent below tenant-count floor. (AC: 11)
- [x] `PARITY.md` (UPDATE): one-line bullet under Time/Population noting meal cadence. (No AC; documentation.)
- [x] Quality gates: `npm run typecheck && npm run lint && npm test && npm run build`. (AC: 14)

## Dev Notes

- **Do not touch:** `EconomySystem.collectTrafficIncome`, `trafficAppeal`, any `dailyTrafficIncome[kind]` constant, `NOISE_EROSION`, `updateSatisfaction`. The whole point is these stay put. (Arch §0.1)
- **`MAX_PEOPLE` is the ceiling; do not raise it.** If a healthy tower saturates the pool, tune `mealPopulationWeights` down. (Arch §0.2)
- **Meal windows single-sourced.** Do not scatter hour comparisons through `Crowd.ts`; read from `MEAL_WINDOWS`. Lunch window must match `Clock.isLunch()` (11-14) exactly.
- **Weekend correctness for offices** comes for free from `updatePresence` zeroing office occupants on weekends, which empties the `staffedOffices` bin. A redundant `clock.isWeekend` in `spawnTrips` would drift if `updatePresence` ever changes.
- **The return flow is aggregate**, not per-person tracking. Outbound and return are two independent spawns; over a window they aggregate to approximately equal totals. Do not add per-person round-trip identity.
- **Style:** no em-dashes in new prose. American English. Match the codebase comment voice.
- **`spawnFloors` shape:** `staffFloors` carries `{kind, floor}` per element so on-shift filtering can be applied at consumption time; a plain floor list would lose the kind and force a re-scan of `tower.units`.

## Change Log

- 2026-07-09: story created from gdd + arch pair.

## Dev Agent Record

### Debug Log

- Test-first RED phase confirmed 32 of 36 failures against unchanged code (the 4 that fluked to green were `staffOnShift` truth-table cases for security/medical/recycling since the export symbol was compile-missing).
- GREEN phase, one failure on the traffic-income idempotency test (used ONE tower across TWO calls, which lets `pendingIncome` mutations spill between reads). Refactored to two identical fresh towers; passes.
- 2026-07-09 owner scope pull: the visible-occupancy render dip was pulled after the owner realized it was a fake substitute for per-person round-trip tracking + venue-customer population census (the honest fix). Both deferred to `[[per-person-meal-round-trips]]` and `[[population-census-parity]]` backlog rows.

### Completion Notes

- Transport-only meal-cadence overlay ships. Aggregate outbound + lagged return trip pool feeds the same weighted `spawnTrips` options array; `MAX_PEOPLE` cap self-throttles. Economy stays byte-identical (guarded by test). `PARITY.md` bullet added, `package.json` bumped 1.15.0 -> 1.16.0 (player-facing new capability).
- Visible-occupancy render dip pulled; the honest render dip lands when per-person round-trips + venue-pop census go in.
- Bulletins added: `emitLunchRush` folded into `emitMealRushes` covering breakfast (07:00), lunch (12:00, weekday), dinner (18:00, weekday), gated by a 30-tenant floor so a 1-star tower does not spam.
- Dinner clock-crawl added at 18:00-18:30 by splitting the 17:00-21:00 period into three; day total stays 2600 frames.

## File List

- `src/engine/econConfig.ts` (M): `ECON.mealPopulationWeights` constants.
- `src/engine/Crowd.ts` (M): `StaffKind`, `MEAL_WINDOWS`, `MEAL_MIX`, `mealWindowFor`, `staffOnShift`, phase-profile helpers, extended `SpawnFloors`, expanded `spawnFloors` + `spawnTrips` + `pushMealOptions`.
- `src/engine/timePacing.ts` (M): split 17:00-21:00 into three sub-periods for the dinner crawl.
- `src/main.ts` (M): `emitLunchRush` -> `emitMealRushes` for breakfast/lunch/dinner; `lastLunchDay` -> `lastMealRushDay` record; tenant-count floor.
- `src/tests/mealCadence.test.ts` (A): 36 tests covering the acceptance criteria.
- `PARITY.md` (M): meal-cadence bullet under Time.
- `package.json` (M): 1.15.0 -> 1.16.0.
- `_bmad-output/implementation-artifacts/story-tower-wide-meal-cadence.md` (A): this story.
- `_bmad-output/planning-artifacts/design/gdd-tower-wide-meal-cadence-2026-07-09.md` (A): design doc.
- `_bmad-output/planning-artifacts/design/arch-tower-wide-meal-cadence-2026-07-09.md` (A): arch doc.
- `_bmad-output/implementation-artifacts/backlog.md` (M): added `per-person-meal-round-trips` row, escalated `population-census-parity` note.
