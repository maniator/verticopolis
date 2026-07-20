---
baseline_commit: b3521919b7c07d35ab4f9c527499359e1d5eb602
---

# Story 304.1: Modern hotel meal-window late checkout (Model A)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Modern-mode player building a mixed-use tower,
I want a small, bounded fraction of last-night hotel guests to take a late checkout so they are still present at lunch and take a lunch meal trip,
so that a large hotel earns a midday lunch murmur a pure office tower does not, rewarding mixed-use placement, without inventing a guest who does not exist in 1994 canon (Classic stays byte-identical).

This is Phase 1 of #304. Phase 0 (the GDD, already on main) established that Classic is canon-correct as-is (hotel guests are gone at lunch) and that the Modern feature is opt-in "what the original couldn't do." A design party chose **Model A (late checkout)** over Model B (phantom day-use); this story implements Model A with the six guardrails the party attached.

## Acceptance Criteria

1. A new rule seam `GameRules.hotelDaytimePresence(): number` returns the fraction of last-night-occupied hotel rooms held past the morning checkout into the daytime meal windows. **Classic returns 0**; Modern returns a provisional, `ECON`-configured `0.2`. The seam follows the established Modern-magnitude pattern (`condoRelocationChance`, `demographicRoutines`): callers short-circuit on a `<= 0` return before doing any deferral work, so the Classic path is untouched.
2. **Classic is byte-identical.** The Classic golden-master reference-tower income hash does not move, and a Classic tower with a full reachable hotel and an open lunch restaurant produces **zero** hotel-origin lunch trips (the deferral short-circuits, and the lunch `hotelFloors` bin stays empty at midday).
3. **Deferred-room selection is deterministic (Guardrail 1).** The `round(p * N)` deferred rooms are chosen in `tower.units` iteration order (build/insertion order, not physical floor/x) with NO RNG draw, so neither the Classic nor the Modern seeded economy/spawn stream is perturbed by the choice of which rooms defer.
4. **Checkout is realized as an afternoon event over still-asleep rooms (Guardrail 2).** No new serialized field is added. The morning checkout (`HK_CHECKOUT_HOUR`) checks out all-but-`round(p*N)` asleep hotel rooms; a new afternoon event (after the lunch window closes, before evening fill) checks out every hotel room still `asleep`. Because evening fill (churn.ts) is the only thing that sets `asleep` and runs later in the day, "still asleep in the early afternoon" is exactly the deferred set, self-describing from serialized state.
5. **Revenue is recognized exactly once per room (Guardrail 3).** Across the morning and afternoon events, each hotel room's rent is booked to the `hotels` ledger exactly once per day. A full reachable Modern hotel banks the same daily hotel revenue as it did before this change (`N * rent`), just split across two events.
6. **Deferred rooms feed lunch through the existing spawn path.** A deferred room stays `asleep` through the lunch window `[11, 14)`, so it enters the existing `hotelFloors` meal-origin bin (gated on `state === "asleep"`) and spawns lunch meal trips with NO change to `spawn.ts`. A Modern hotel with `N` rooms occupied last night contributes a lunch hotel-origin sized to `Math.round(0.2 * N)`, never more than `N`; an empty-hotel Modern tower contributes zero.
7. **Midday census/star lift is bounded and non-gating (Guardrail 5).** The extra midday population is exactly the deferred `asleep` rooms (at most `round(p * N)`), counted through the existing `asleep`-is-present path; it is NOT a second census (`occupants`/census fields are the same one guest, not a duplicate). A test asserts the midday population delta is bounded by `round(p*N)` and does not by itself flip a star rating.
8. **Housekeeping interaction is covered by a regression test (Guardrail 4).** Deferred rooms turn `dirty` in the early afternoon instead of the morning. A test on an understaffed Modern hotel confirms the late-checkout rooms are handled correctly (turned over when maids reach them, or aging toward infestation on a chronically understaffed hotel exactly as an ordinary dirty room would), and that the morning `beforeCheckout`/`resetShift` housekeeping lifecycle is NOT re-run by the afternoon event.
9. **Version bump:** `package.json` `version` gets a minor bump (Modern player-facing change), lockfile in lockstep.

## Tasks / Subtasks

- [x] Task 1: Add the `hotelDaytimePresence()` rule seam (AC: 1)
  - [x] Add `hotelDaytimePresence(): number` to the `GameRules` interface in `src/engine/gameRules.ts`, documented like the other Modern-magnitude seams (Classic 0, short-circuit-before-work contract).
  - [x] Implement in `src/engine/ruleSets.ts`: `CLASSIC_RULES` returns `0`; `MODERN_RULES` returns `ECON.hotelDaytimePresence`.
  - [x] Add `hotelDaytimePresence: 0.2` to `ECON` in `src/engine/econConfig.ts` with a "provisional, pending calibration" comment.
- [x] Task 2: Defer a deterministic fraction at morning checkout (AC: 3, 4, 5)
  - [x] In `EconomySystem.hotelCheckout()` (`src/engine/EconomySystem.ts`), read `p = this.sim.rules.hotelDaytimePresence()`. If `p <= 0`, behave exactly as today (check out every `asleep` hotel room), no new work, no new iteration order.
  - [x] When `p > 0`: count `N` = asleep hotel rooms; `deferCount = Math.round(p * N)`. Walking `this.sim.tower.units` in order, leave the first `deferCount` asleep hotel rooms `asleep` (do NOT book their revenue or mark them dirty) and check out the rest exactly as today. Preserve `beforeCheckout()`/`resetShift()` bracketing unchanged.
- [x] Task 3: Add the afternoon late-checkout event (AC: 4, 5, 8)
  - [x] Add `EconomySystem.hotelLateCheckout()`: for every hotel unit still `asleep`, book `rentOf(u)` to `money` + the `hotels` ledger and set `state = "dirty"`, `occupants = 0`. Do NOT call `beforeCheckout()`/`resetShift()` (the morning lifecycle already ran). Guard the whole method on `hotelDaytimePresence() > 0` so Classic is a pure no-op.
  - [x] Schedule it in `src/engine/sim/loop.ts` `onHour` at a new `HK_LATE_CHECKOUT_HOUR` constant (14:00, after the lunch window `[11, 14)` so guests are present for the full window, before evening fill `[17, 21)`). Place it so the day's housekeeping dispatch (which runs each hour within the shift) picks up the newly-dirty rooms on subsequent ticks.
- [x] Task 4: Tests (AC: 2, 5, 6, 7, 8)
  - [x] Classic golden master unchanged (run existing `goldenMaster.integration.test.ts`; add an explicit Classic "zero hotel-origin lunch trips with a full hotel + open lunch restaurant" assertion if not already covered).
  - [x] Revenue-once: a full reachable Modern hotel banks exactly `N * rent` to the `hotels` ledger across one simulated day (morning + afternoon events sum to the pre-change total).
  - [x] Modern lunch draw bounded: `N` rooms occupied last night → lunch hotel-origin count `== Math.round(0.2 * N)`, never `> N`; empty hotel → zero.
  - [x] Census bound: midday population delta `<= Math.round(p * N)` and does not by itself flip a star rating.
  - [x] Housekeeping: understaffed Modern hotel handles late-checkout dirty rooms like ordinary dirty rooms; afternoon event does not re-run `beforeCheckout`/`resetShift`.
- [x] Task 5: Record the decision and bump the version (AC: 9)
  - [x] Add a "Decision: Model A (chosen)" section to `_bmad-output/planning-artifacts/design/gdd-hotel-meal-windows-2026-07-19.md` recording the party's pick, the six guardrails, and the housekeeping finding (spread surface unchanged; the cost is confined to understaffed towers).
  - [x] `npm version minor` (bumps `package.json` + lockfile together); confirm the CI version guard passes.
- [x] Task 6: Quality gates + review
  - [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green.
  - [x] Run `/gds-code-review` (mandatory for engine/gameplay work); fix every `patch` finding, record every `defer` finding in the backlog.

## Dev Notes

### Current state of the files this story touches (read before editing)

- **`src/engine/EconomySystem.ts` `hotelCheckout()` (lines ~301-327)** (UPDATE). Today: calls `this.housekeeping.beforeCheckout()` (reports yesterday's shift + breeds overnight cockroaches BEFORE rooms go dirty), then a single loop over `this.sim.tower.units` that, for each `isHotelKind` unit with `state === "asleep"`, does `revenue += rentOf(u); u.state = "dirty"; u.occupants = 0;`, then books `revenue` to `sim.money` + the `"hotels"` ledger + an emit, then `this.housekeeping.resetShift()`. **Preserve:** the `beforeCheckout`/`resetShift` bracketing and the single revenue emit belong to the MORNING event only. The deferral must not re-run either lifecycle call in the afternoon.
- **`src/engine/sim/loop.ts` `onHour()` (lines ~112-139)** (UPDATE). Today: at `sim.clock.hour === HK_CHECKOUT_HOUR` it calls `sim.economy.hotelCheckout()`; then, within `[hkShift.start, hkShift.end)`, it calls `sim.resolveExtermination()` and `sim.economy.dispatchHousekeepers()`. **Add** the `HK_LATE_CHECKOUT_HOUR` call. The comment at 115-116 ("Guests check out in the morning ... overnight hotel population is still present at the midnight TOWER/VIP evaluation") is why checkout is a morning event; the afternoon partial checkout is Modern-only and must not disturb the midnight evaluation (it fires at 14:00, well clear).
- **`src/engine/sim/churn.ts` `attemptMoveIns` (lines ~129-136)** (READ ONLY, do not edit). Hotel rooms fill ONLY in the evening: `if (sim.clock.isEvening() && sim.rng.chance(0.5 * demand)) { u.state = "asleep"; u.everOccupied = true; ... }`. `isEvening()` is `[17, 21)`. This is why "still asleep at 14:00" uniquely identifies the deferred set: nothing sets `asleep` between the morning checkout and 17:00.
- **`src/engine/gameRules.ts`** (UPDATE, interface). The `GameRules` interface documents the Modern "deeper economy" seams. New method goes in this block. Note the standing contract copied from `condoRelocationChance`/`demographicRoutines`: "Callers MUST short-circuit on a 0 return BEFORE drawing from the RNG, so a Classic tower's seeded stream stays byte-identical." Mirror that wording.
- **`src/engine/ruleSets.ts`** (UPDATE). `CLASSIC_RULES` and `MODERN_RULES` singletons implement `GameRules`. Add the two implementations (Classic `0`, Modern `ECON.hotelDaytimePresence`).
- **`src/engine/econConfig.ts`** (UPDATE). Home of `ECON` Modern magnitudes. Add `hotelDaytimePresence: 0.2` (provisional).
- **`src/engine/crowd/spawn.ts`** (READ ONLY, do not edit; this is the whole point of Model A). `spawnFloors` bins a hotel unit into `hotelFloors` when `state === "asleep"` (~line 120). `spawnMealOutbound` only spawns a meal round-trip from a unit with `visibleOccupants > 0` (~line 366), the finding that reverted the first Phase-1 pass. A deferred room is a REAL `asleep` occupant, so it satisfies both gates through the existing path with no edit here.
- **`src/engine/crowd/meals.ts`** (READ ONLY). `MEAL_WINDOWS` lunch is `[11, 14)`; `MEAL_MIX` already lists `hotel` under lunch. No change.

### Design decision context (why Model A, from the party)

- Model A reuses the shipped `hotelFloors -> pushMealOptions -> spawnMealOutbound` path (already covered by `mealCadence.integration.test.ts`) and needs NO new spawn machinery and NO new serialized field. Model B (phantom day-use) would add ~5 new surfaces in the fragile crowd-spawn core plus a new persisted "rooms occupied last night" count.
- **Housekeeping finding (the user's key question):** deferring checkout does NOT increase cockroach-spread surface, `spreadCockroaches()` runs once in the morning `beforeCheckout()` and already sees every last-night room `asleep` regardless of deferral; there is no second spread pass. The only real cost is that deferred rooms turn `dirty` ~6h later (14:00 vs morning) and, on a chronically understaffed hotel, can miss the evening re-let or age toward `INFEST_DAYS` a little faster. On a normally-staffed Modern hotel the 08:00-19:00 shift (cutoff 18:30) absorbs the early-afternoon dirt easily. This is a bounded, Modern-only price signal, not a leak.

### Testing standards

- Vitest. Engine tests are deterministic and headless (seeded RNG, no DOM). Integration tests under `src/tests/integration/`, unit tests colocated or under `src/tests/`.
- The **Classic golden master** (`src/tests/integration/goldenMaster.integration.test.ts`) pins Classic economy byte-identical; it is the primary tripwire. There is no Modern golden pin, so Modern assertions are behavioral (counts, bounds), not hash-based.
- Guardrail 1 (no RNG draw for deferral) is what keeps BOTH streams stable; assert Classic golden unchanged AND, ideally, that a Modern run's RNG call count is unchanged by the deferral (deterministic selection).

### Project Structure Notes

- `src/engine/` stays DOM-free and rendering-free (project rule). All of this story is pure engine + config.
- The rule-set seam is the ONLY sanctioned place Classic/Modern behavior diverges; do not add `if (mode === "modern")` anywhere else.

### Project Context Rules

- Every non-trivial engine change runs the mandatory deep review: `/gds-code-review` (gameplay/engine lane). A self-read does not satisfy it. Fix every `patch` finding; record every `defer` finding in `_bmad-output/implementation-artifacts/backlog.md`.
- Quality gates before pushing: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, all green.
- Bump `package.json` `version` on player-facing change (minor here), lockfile in lockstep (`npm version`); a CI guard enforces the lockstep.
- American English; no em-dashes in new prose/comments; no "X, not Y" emphatic restatement; no AI marketing vocabulary.
- Transport/build-cap canon lives in `src/engine/facilities.ts`; not touched here.
- Backlog mirrors to GitHub issues: the `per-person-meal-round-trips` row carries #304; close the issue when the row finishes (Phase 1 completes the hotel-gate remainder).

### References

- [Source: _bmad-output/planning-artifacts/design/gdd-hotel-meal-windows-2026-07-19.md], full Phase 0 GDD: parity finding, current mechanics, Classic decision, Modern Model A vs B, the `visibleOccupants > 0` finding, section 6 test list.
- [Source: src/engine/EconomySystem.ts#hotelCheckout], the morning checkout seam being split.
- [Source: src/engine/sim/loop.ts#onHour], daily scheduling; where `HK_LATE_CHECKOUT_HOUR` hooks in.
- [Source: src/engine/gameRules.ts#GameRules], the Modern-magnitude seam contract to mirror.
- [Source: src/engine/crowd/spawn.ts], the unchanged `hotelFloors` / `visibleOccupants > 0` path Model A reuses.

## Dev Agent Record

### Agent Model Used

Claude Code (gds-create-story + gds-dev-story workflow).

### Debug Log References

- Confirmed `updatePresence` (satisfaction.ts:48) stamps an `asleep` hotel room's
  `occupants = f.population` each hour, so a deferred room reads `visibleOccupants > 0`
  through lunch and spawns via the existing path (no `spawn.ts` change).
- Confirmed evening fill (churn.ts:106) only fills `empty` rooms, so deferred (`asleep`)
  and afternoon-dirtied rooms never double-fill or double-charge.
- Classic golden master (`goldenMaster.integration.test.ts`) and `mealCadence` both
  green after the change: Classic path is byte-identical.

### Completion Notes List

- Task 1: `GameRules.hotelDaytimePresence()` seam added (Classic 0, Modern
  `ECON.hotelDaytimePresence = 0.2`), short-circuit-before-work contract documented.
- Task 2: `EconomySystem.hotelCheckout()` defers the first `Math.round(p*N)` asleep
  rooms in `tower.units` insertion order (no RNG); `p <= 0` behaves exactly as before.
- Task 3: `EconomySystem.hotelLateCheckout()` added, scheduled at
  `HK_LATE_CHECKOUT_HOUR = 14` in `sim/loop.ts`; books deferred rent once, marks rooms
  dirty, does not re-run the morning housekeeping lifecycle.
- Task 4: 11 tests in `hotelLateCheckout.integration.test.ts` (seam values, Classic
  parity + no-op, deterministic bounded deferral, empty-hotel zero, revenue-once,
  housekeeping-lifecycle spy, end-to-end Modern-lingers/Classic-zero lunch trips).
- Task 5: Model A decision + six guardrails recorded in the GDD (section 4b);
  `npm version minor` -> 1.65.0 (lockfile in lockstep).
- Task 6: `typecheck`, `lint`, `test` (2493 passed), `build` all green. `/gds-code-review` next.

### File List

- `src/engine/gameRules.ts` (M) - `hotelDaytimePresence()` interface method.
- `src/engine/ruleSets.ts` (M) - Classic 0 / Modern `ECON.hotelDaytimePresence`.
- `src/engine/econConfig.ts` (M) - `hotelDaytimePresence: 0.2` (provisional).
- `src/engine/EconomySystem.ts` (M) - deferral in `hotelCheckout()`, new
  `hotelLateCheckout()`, `HK_LATE_CHECKOUT_HOUR` constant.
- `src/engine/sim/loop.ts` (M) - schedule `hotelLateCheckout()` at `HK_LATE_CHECKOUT_HOUR`.
- `src/tests/integration/hotelLateCheckout.integration.test.ts` (A) - the guardrail tests.
- `_bmad-output/planning-artifacts/design/gdd-hotel-meal-windows-2026-07-19.md` (M) - decision record.
- `_bmad-output/implementation-artifacts/304-1-modern-hotel-late-checkout.md` (A) - this story.
- `package.json`, `package-lock.json` (M) - 1.64.2 -> 1.65.0.

### Change Log

- 2026-07-20: Implemented Model A (late checkout) for #304 Phase 1. Modern-only,
  deterministic, byte-identical Classic. Version 1.65.0.
- 2026-07-20: `/gds-code-review` (Blind Hunter + Edge Case Hunter + Acceptance
  Auditor). Fixed 2 patch findings: (1) windowed the late checkout `[14, 17)` for
  save/load robustness (was an exact `=== 14`, could strand a deferred room on a
  reload past 14:00); (2) neutral `?? 0` rules fallback so a bare context keeps
  pre-feature behavior. Filled 2 test gaps: AC7 census-lift bound + star-non-flip,
  AC8 understaffed-hotel housekeeping turnover. Recorded 1 defer (deferred rent
  lost if a room is destroyed 08:00-14:00) in the backlog. 17 tests in the new
  file; all four gates green (2499 passed).
