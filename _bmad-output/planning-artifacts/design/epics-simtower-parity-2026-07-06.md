---
title: "Epics & Stories — SimTower 1994 Parity"
game: Verticopolis (browser SimTower clone)
date: 2026-07-06
status: In design
pairs_with:
  - gdd-simtower-parity-2026-07-06.md
  - arch-simtower-parity-2026-07-06.md
note: Each story is its own PR — quality gates (typecheck/lint/test/build) +
  /gds-code-review + package.json version bump per CLAUDE.md. Acceptance criteria
  live in the GDD section cited; this file is the sequencing + change map.
---

# Epics & Stories — SimTower 1994 Parity

**Merge order (from arch §5):** E1a → E3.1 → E4 → E5 → E1b → E1c → E2.x
Low-risk, high-value fixes first; canon widths before the reflow that depends on
them; balance-heavy penalties last.

---

## E1 — Spatial spine

### E1a — Buildable lot 340 → 375  ·  risk: low  ·  version: minor
- **Change:** `GRID.width` 340→375 (`facilities.ts:399`); update `PARITY.md:89`
  and any `AGENTS.md` canon note; grep tests/fixtures for `340`.
- **AC:** GDD §2.1, §2.4.1/§2.4.3. Fresh tower builds to x=374; docs state 375.
- **Unblocks:** everything (wider lot = reflow slack).

### E1b — Facility widths to canon + width-responsive sprite re-fit  ·  risk: med  ·  version: minor
- **Change:** `FACILITIES` widths — suite 8→10, fastFood 12→16, restaurant 16→24,
  cinema 24→31, stairs 4→8, escalator 4→8, parking 6→4, ramp 6→16
  (`facilities.ts`). Audit each changed kind's sprite draws responsively to `w`
  (`src/render/sprites/*`). Verify `snapX`, fixed-span gesture at width 8.
- **Gate:** corroborate cinema 31 / suite 10 with a 2nd source before landing
  those two (GDD §2.2 note, arch §4). If uncorroborated, hold just those two.
- **AC:** GDD §2.2, §2.3, §2.4.2/§2.4.4.
- **Depends:** E1a.

### E1c — SAVE_VERSION 1→2 + per-floor reflow migration + golden fixture  ·  risk: high  ·  version: minor
- **Change:** `SAVE_VERSION` 1→2 (`Simulation.ts:51`); implement `upgradeV1toV2`
  reflow at the seam (`Simulation.ts:150`) per arch §1.1; add `towerone_6.vctower`
  as a test fixture with the §1.3 assertions.
- **AC:** GDD §8.3; arch §1.1–§1.3 assertions (canon widths, no overlaps, no
  transport overlap, floor-backed, still serves, parking demand satisfied).
- **Depends:** E1b (canon widths must be final first).

---

## E2 — Pedestrian penalties (each its own PR; all via `updateSatisfaction`/economy)

### E2.1 — W1 transport-too-far (79 tiles)  ·  risk: med  ·  version: minor
- **Change:** `Tower.nearestTransportDistance` memoized on `servedRev`; penalty +
  `VacateReason "transportFar"` in `updateSatisfaction` (arch §2.2). Inspector
  cause string + countdown reuse.
- **AC:** GDD §3.3.

### E2.2 — W2 noise spacing (11 / 21 + commercial)  ·  risk: med  ·  version: minor
- **Change:** generalize `officeAdjacent`→`nearestKindWithin(u,kinds,maxTiles)`;
  hotel/condo↔office 21, office↔commercial 11, lobby-between cancels; feed existing
  noise erosion/telegraph; subsume the ±1 rule (no double-count) (arch §2.2).
- **AC:** GDD §4.3.

### E2.3 — W3 commercial-near-lobby (2 floors)  ·  risk: low–med  ·  version: minor
- **Change:** nearest-lobby-by-floor in the commercial income path; ×0.5 take
  beyond 2 floors + inspector reason (arch §2.2).
- **AC:** GDD §5.2.

---

## E3 — Parking correctness

### E3.1 — Office ratio 12→24 + sprite one-car  ·  risk: low  ·  version: minor
- **Change:** `PARKING_WORKERS_PER_SPACE` 12→24 (`facilities.ts:387`); rewrite
  `drawParking` to a single stall/one car, responsive to `w` so legacy 6-wide and
  new 4-wide both render clean (`sprites/facilities.ts:247`). Update parking-demand
  tests.
- **AC:** GDD §6.4.1–.2.
- **Note:** the sprite half pairs naturally with E1b's parking width 6→4, but the
  ratio fix is independent and highest-value — ship first.

### E3.2 — Parking drag-chain placement  ·  risk: low–med  ·  version: minor
- **Change:** add `parking` to the paint path (`main.ts:498` `onActionMove`;
  `buildActions` run via `dragRunTiles`); ramp stays single-tap (arch §2.3).
- **AC:** GDD §6.4.3.
- **Pairs with E4** (both touch the gesture/paint path).

---

## E4 — Input parity: mobile floor/lobby/parking drag-paint  ·  risk: low  ·  version: patch
- **Change:** `classifyDown` (`main.ts:433`) returns `"action"` for a paint tool
  (floor/lobby/parking) on touch so a drag paints; inspect/multi-touch still pans;
  guard double-placement (arch §2.4).
- **AC:** GDD §7.1.

---

## E5 — Canon capacity & docs  ·  risk: low  ·  version: patch
- **Change:** `TRANSPORT_CAPACITY.elevatorExpress` 33→42 (`facilities.ts:489`);
  re-check congestion tests. Fold PARITY.md/AGENTS.md canon updates not covered by
  E1a (car capacities, per-facility segment widths).
- **AC:** GDD §2 (docs), §"W4" note.

---

## Dependency summary

```
E1a ──┬─▶ E1b ──▶ E1c
      ├─▶ E3.1
      ├─▶ E3.2 ─┐
      ├─▶ E4 ───┴─(shared gesture path: sequence, don't parallelize)
      ├─▶ E5
      └─▶ E2.1, E2.2, E2.3  (independent; land after widths/reflow settle)
```

Open questions to resolve in-flight (GDD §10): unit-width persistence (**resolved**
— persisted, arch §1); cinema 31 / suite 10 second source (E1b gate); W3 penalty
shape (**resolved** — income scalar, arch §2.2).
