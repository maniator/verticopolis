---
title: "Technical Design — Tenant Churn (the `vacating` state)"
game: Verticopolis (browser SimTower clone)
author: Cloud Dragonborn (Game Architect — gds agent), with the PR #109 party
date: 2026-07-03
status: Shipped in PR #109
scope: The engine implementation of the recoverable notice period — the
  `vacating` state machine, the predicates that keep it consistent across the
  codebase, save/load hardening, and the load-bearing constants.
grounds:
  - gdd-tenant-churn-2026-07-03.md (the player-facing contract)
  - src/engine/Simulation.ts, src/engine/types.ts
  - src/engine/{EconomySystem,Crowd,EventSystem,milestones}.ts
  - src/game/inspector.ts, src/render/pixelSprites.ts
---

# Technical Design — Tenant Churn (the `vacating` state)

## 0. LOAD-BEARING INVARIANTS — read before touching this mechanic

> If you change anything in this section, **re-run `phase2.test.ts` (the
> well-zoned endgame) and `parity.test.ts` (the TOWER run)** — they are the only
> guards that a balance change didn't start bleeding a healthy tower.

1. **`VACATE_RESCIND = 0.40` and `VACATE_NOTICE_MINUTES = 2880` are tuned, not
   arbitrary.** (`Simulation.ts`.) The rescind bar being *above* the "barely
   alive" floor is the entire point of the retune ("stabilized ≠ fixed"); the
   window being 2 days is what prevents per-rush-hour eviction spam. Moving
   either silently changes difficulty. `VACATE_RESCIND` is exported *only* so the
   inspector can show the player the exact target — keep that the single source.
2. **Recovery cannot fire on an unserved floor.** In `updateSatisfaction`, the
   `+0.05` recovery is gated behind `served`. This is what makes a genuinely
   broken layout still evict on schedule while a merely-congested one is
   recoverable. Do not "simplify" the recovery to be unconditional.
3. **Office noise can never evict.** Noise only *caps* satisfaction at 0.6
   (`Math.min`), it never drains to 0. Therefore `VacateReason` has no `"noise"`
   member and `vacateCause` never returns one. If you make noise a drain, you
   must add the reason back — and re-derive the attribution order.
4. **`vacating` counts as present.** `isPresent` and `isTenanted` both include
   `vacating`. A tenant on notice still pays rent, counts as population, and
   commutes. Every all-unit loop that should credit a live tenant routes through
   one of these two predicates — do not re-introduce a bare `state === "occupied"`
   check on a population/rent/crowd path.
5. **Only office/condo ever reach `vacating`.** Hotels evict instantly. Nothing
   sets `vacating` on any other kind; `isTenanted` is state-based and makes no
   such assumption, but the state machine is the only writer.

## 1. The state machine

`Simulation.updateSatisfaction()` runs hourly. After the satisfaction drains are
applied to a unit, the churn block (per unit):

```
leaseTenant = kind is office or condo

if leaseTenant and state == "vacating":
    if satisfaction >= VACATE_RESCIND:      # recovered → stay, silently
        state = "occupied"; clear vacateReason/vacateAt
    elif clock.minutes >= vacateAt:         # window elapsed, still bad → leave
        vacate(u, vacateReason ?? "access")
elif leaseTenant and satisfaction <= 0:     # give notice
    state = "vacating"
    vacateReason = vacateCause(u, served, cong)
    vacateAt = clock.minutes + VACATE_NOTICE_MINUTES
    notices.push({floor, kind, reason})     # batched, emitted after the loop
elif satisfaction <= 0 and isHotelKind:     # hotels: instant, with real cause
    vacate(u, vacateCause(u, served, cong))
```

- **Deadline is fixed per episode.** `vacateAt` is set once on entry and never
  pushed back; a brief dip that stays below the rescind bar does not extend it.
  Full recovery clears it; re-entry from `occupied` starts a fresh episode.
- **`vacateCause`** re-derives the dominant drain from current `served` / `cong` /
  over-rent, in the same priority order the drains are applied. `access` is the
  catch-all for the rare emergency-driven bottom-out.
- **`emitNotices`** collapses a tick's notices to one toast (named unit, or a
  per-cause tally). Rescind and re-notice are otherwise silent.

## 2. Predicates & blast radius

Two predicates in `types.ts` are the consistency backbone:

- **`isPresent`** = `occupied | asleep | moving_in | vacating` — "counts as live
  population". Used by `Tower.totalPopulation`, `Simulation.ratingPopulation`,
  `spatialCongestionByFloor`.
- **`isTenanted`** = `occupied | vacating` — a lease in residence. Used by office
  rent (`EconomySystem.collectRent`), parking demand, the office stats count,
  crowd spawning (`Crowd.floorsWhere`), and fire stress (`EventSystem`).

The remaining bare `state === "occupied"` checks are deliberately *not* routed
through these — they are non-lease paths (commercial traffic income, the
`updatePresence` default arm, hotel `asleep` checks) where `vacating` is
unreachable.

## 3. Persistence

Two new optional `Unit` fields, `vacateReason?: VacateReason` and
`vacateAt?: number`, ride the existing spread-serialize. On load they are
hardened like every other field: `isVacateReason(...)` guards the reason,
`num(vacateAt, 0)` coerces the deadline. A save with `state: "vacating"` but a
missing/garbage `vacateAt` resolves on the next tick rather than hanging. No
`SAVE_VERSION` bump — additive optional fields, matching the `filmPolicy`
precedent. `moveIn` clears both fields so a recycled unit never shows stale data.

## 4. Render / UI

- `pixelSprites.noticeBadge` — a static amber corner ribbon drawn for a
  `vacating` unit. Static (no per-tick animation) to honour screenshot stability.
- `inspector.ts` — the on-notice card: friendly status, cause, live countdown
  from `vacateAt - clock.minutes`, and current-vs-`VACATE_RESCIND`. Recomputed
  per hover, so it ticks live without any tick-loop work.

## 5. Determinism & performance

- No `Date.now()` / `Math.random()`; all timing keys off `clock.minutes`. The
  notice countdown and rescind are fully deterministic → headless and browser
  runs agree, saves reload identically.
- The added per-unit cost in the hourly loop is one boolean (`leaseTenant`) plus
  the predicates' extra comparison; `vacateCause` (the only non-trivial work)
  runs only on the tick a unit actually bottoms out.

## 6. Test plan (all in `src/tests/simulation.test.ts` unless noted)

1. `occupied → vacating → empty` after the notice window on an unreachable floor,
   with the `access` cause and the departure toast.
2. Rescind: connect the floor, satisfaction recovers, unit returns to `occupied`.
3. Silent rescind: no "staying"/"gave notice"-pair spam.
4. Batched mass move-out: N units → one toast.
5. Retune lock: a unit nursed to 0.30 (between the old 0.25 and new 0.40 bar) at
   the deadline **still evicts**, importing `VACATE_RESCIND` to stay in sync.
6. `phase2.test.ts` (well-zoned endgame) + `parity.test.ts` (TOWER run): a
   healthy tower does **not** bleed — the balance guard for every constant here.
7. `phase2.test.ts` F25: hotels still evict instantly.

## 7. File-touch summary

- `types.ts` — `VacateReason`, `VACATE_REASON_TEXT`, `isVacateReason`,
  `isTenanted`, `isPresent` (+`vacating`), `Unit.vacateReason/vacateAt`.
- `Simulation.ts` — constants, the churn state machine, `vacateCause`,
  `emitNotices`, `vacate(reason)`, save-load hardening, `moveIn` clear.
- `EconomySystem.ts` / `Crowd.ts` / `EventSystem.ts` / `milestones.ts` — routed
  through `isTenanted`.
- `inspector.ts` / `pixelSprites.ts` — the on-notice surfaces.
