---
title: "Architecture — SimTower 1994 Parity"
game: Verticopolis (browser SimTower clone)
author: Cloud Dragonborn (Game Architect — gds agent)
date: 2026-07-06
status: In design
pairs_with: _bmad-output/planning-artifacts/design/gdd-simtower-parity-2026-07-06.md
scope: How to implement the parity GDD safely — the save-compat model, where each
  pedestrian penalty lives, the noise/proximity data model, and the story-level
  change map. Engine stays DOM/render-free (CLAUDE.md).
grounds:
  - src/engine/types.ts (Unit.width persisted :202; VacateReason :108)
  - src/engine/Simulation.ts (migrateSave :117-152; deserialize trusts u.width :2037; updateSatisfaction; parkingDemand; officeAdjacent :1113)
  - src/engine/Tower.ts (servedFloors/servedRev memo; functionalParkingSet; roomAt O(1))
  - src/engine/Crowd.ts (routing; ≤2-ride; buildAdjacency)
  - src/engine/facilities.ts (FACILITIES widths; GRID; PARKING_WORKERS_PER_SPACE; TRANSPORT_CAPACITY; maxSpanFor)
  - src/render/sprites/facilities.ts (drawParking) and sibling sprites
  - src/main.ts (classifyDown/onAction*); src/game/buildActions.ts (paintFloorRun); src/ui/placement.ts (dragRunTiles)
---

# Architecture — SimTower 1994 Parity

## 1. The load-bearing finding: width changes are already save-safe

`Unit` **persists its own `width`** (`types.ts:202`) and `deserialize` **trusts
it** — the facility table is only a fallback for a missing/garbled value:

```ts
// Simulation.ts:2037
const width = Math.max(1, Math.min(GRID.width - x,
  Math.round(num(u.width, FACILITIES[u.kind].width))));
```

A grep of runtime consumers confirms every simulation/render path reads
`u.width` (the stored footprint), **not** `FACILITIES[kind].width`; the only
table reads are the build/preview paths for *new* placements
(`Simulation.ts:452-500`, `TowerEngine.ts:1199/1208`). Therefore:

- **Widening or narrowing a facility definition does not resize already-placed
  units.** An old 6-wide parking space stays 6 wide; a new one is 4 wide. They
  coexist with **no overlap and no corruption**.
- Every sprite receives `w = u.width * TILE` and draws to it, so an old unit
  renders correctly at its old footprint **as long as the sprite stays
  width-responsive** (draws relative to `w`, no hard-coded tile counts).

**Consequence:** preserving footprints is *safe* but it is **not what we want** —
a migrated tower would keep legacy widths forever and never become canon. Because
some kinds **expand** (fast food 12→16, restaurant 16→24, cinema 24→31, ramp
6→16) and some **squish** (parking 6→4, suite →10), a true canon migration must
**reflow each floor**. §1.1 specifies that reflow; §1.3 is the evidence it fits.

### 1.1 Migration design (v1 → v2): per-floor canon reflow

```ts
// migrateSave(), Simulation.ts:150 seam
if (migrated.version === 1) migrated = upgradeV1toV2(migrated);
```

`upgradeV1toV2` re-lays each floor's rooms at canon widths, preserving **order**
and, where slack allows, **relative gaps** — never overlapping a neighbor or a
transport column, always within the (now 375-wide) lot. Algorithm:

1. **Entities, not tiles.** Group units into footprint entities: a multi-floor
   room (cinema, party hall, recycling, metro — `facilityFloors>1`) is ONE entity
   that must land at the **same x on every floor it spans**. Single-floor rooms are
   their own entity. Structural `floor`/`lobby` (width 1) and `transports` are
   **not** entities to move (see 4, 6).
2. **Per floor, sort room entities by x.** Compute each entity's canon width
   (`CANON[kind] ?? stored`).
3. **Obstacle map = transport columns crossing this floor.** A shaft occupies
   `[t.x, t.x+t.width)` on every floor in `[t.bottom, t.top]`. Rooms may not land
   on these columns (parity: rooms never overlap shafts).
4. **Sweep left→right with a cursor.** For each entity in order: target `x =
   max(originalX, cursor)`; if `[x, x+canonW)` intersects a transport column or
   exceeds `GRID.width`, advance past the obstacle; place; set `cursor = x+canonW`.
   Preserve the original left-gap to the previous entity when it doesn't force an
   overlap (keeps the player's spacing intent where possible).
5. **Multi-floor entities:** compute the max target x required across all their
   floors, then place identically on each — so a 2-floor cinema stays vertical.
6. **Re-pave.** Ensure a `floor` (or `lobby`) structural tile exists under every
   tile of every room's NEW footprint; add missing width-1 `floor` units within
   the lot. Leftover paving from vacated tiles is harmless and kept (avoids
   stranding a floor that a transport still needs).
7. **Clamp & flag.** If a floor genuinely cannot fit (should not happen given
   §1.3 slack), leave the overflowing entity at its pre-reflow width and record a
   `migrationNotes` entry rather than overlapping.
8. Stamp `version = 2`. `upgradeV1toV2` is pure/total (no throw); a `version >
   SAVE_VERSION` save still fails closed as today.

### 1.2 Consequences the reflow deliberately accepts

- **Horizontal shift.** Rooms move in x, so cross-floor vertical alignment (and
  room↔shaft adjacency) degrades cosmetically. Routing is by floor-reachability,
  not adjacency, so **reachability/serving is preserved**; only looks change.
- **New spatial rules re-evaluate post-reflow.** W1 (transport-too-far) and W2
  (noise distance) are computed on the *new* positions, so a migrated tower may
  surface a telegraphed penalty it didn't have before. That is *correct* — it now
  obeys canon spatial rules — and it is safe because those penalties are the
  recoverable, telegraphed `vacating` kind, never instant loss.
- **Determinism.** The reflow is a pure function of the save; same input → same
  output (needed for a golden-fixture test).

### 1.3 Evidence: `towerone_6.vctower` (the golden fixture)

Decoded (`VCTOWER1` + base64 deflate-raw JSON), v1, 3★, 62 built floors, 24
transports (all elevators — no stairs/escalators), 12,975 units of which 11,897
are width-1 `floor`/`lobby` paving. Rooms needing resize and the reflow headroom:

| Kind | Count | Stored → canon | Effect |
|---|---:|---|---|
| parking | 85 | 6 → 4 | squish −170 tiles |
| hotelSuite | 13 | 12 → 10 | squish −26 tiles |
| parkingRamp | 5 | 6 → 16 | expand +50 |
| fastFood | 4 | 12 → 16 | expand +16 |
| restaurant | 3 | 16 → 24 | expand +24 |
| cinema | 3 | 24 → 31 | expand +21 |

- **14 of 15 expanders collide** with a room immediately to their right if grown
  in place (`parkingRamp→parking` ×50, `fastFood→office` ×8, `restaurant→medical`
  ×8, `cinema→condo` ×7, …) — proving expand-in-place is wrong and a reflow is
  required.
- **Slack exists:** rightmost room tile is **x=303**; the lot goes to **375** →
  ~72 tiles of right-hand slack per floor, and basements net-shrink (parking
  squish −170 ≫ ramp expand +50). So the §1.1 sweep fits without off-lot clamps.
- **Note:** this save's `hotelSuite` is stored at **12** — proof that widths have
  already drifted across versions and that `deserialize` faithfully trusts stored
  widths. The reflow's `CANON` map is keyed by kind, not by "stored==current".

**Fixture assertions (test):** after `upgradeV1toV2(towerone_6)` — every room is
at its canon width; no two rooms overlap on any floor; no room overlaps a
transport column; every room tile is floor/lobby-backed; the tower still loads,
serves, and reports parking demand satisfied under the 24-worker rule.

## 2. Per-mechanic implementation map

### 2.1 E1 — Spatial spine

| Change | Where | Notes |
|---|---|---|
| `GRID.width` 340→375 | `facilities.ts:399` | Pure constant. Grep tests/fixtures for 340. Camera/backdrop already derive from `GRID.width`. |
| Facility widths (suite 10, fastFood 16, restaurant 24, cinema 31, stairs 8, escalator 8, parking 4, ramp 16) | `facilities.ts` FACILITIES | Table-only. New builds pick these up; old units unaffected (§1). |
| Sprite re-fit | `src/render/sprites/*` | Audit each changed kind's draw fn is width-responsive to `w`. Parking redrawn (§2.3). |
| `SAVE_VERSION` 1→2 + `upgradeV1toV2` | `Simulation.ts:51,150` | §1.1. |
| Canon docs | `PARITY.md:89`, `AGENTS.md` | 340→375; note remaining divergences. |

Stairs/escalator width 4→8 interacts with `maxSpanFor` (span stays 1 floor — width
≠ span) and the 64-link pool (unchanged). Verify placement snap (`snapX`) and the
fixed-span gesture still work at width 8.

### 2.2 E2 — Pedestrian penalties (all through `updateSatisfaction`, the authoritative path)

**W1 transport-too-far.** New `Tower` helper, memoized on `servedRev` like
`servedFloors`:

```ts
// Tower: nearest reachable transport distance for an office, in tiles
nearestTransportDistance(u: Unit): number  // Infinity if none reachable on-floor path
```

- Compute per office: min horizontal gap between the office footprint and any
  transport column on the same floor that is itself reachable (reuse
  `servedFloors`/route reachability so a dead shaft doesn't count).
- In `updateSatisfaction`, if `dist > 79`, apply erosion (reuse the noise-tier
  constant) and attribute cause `transportFar` (new `VacateReason`, `types.ts:108`).
- Perf: memoize the per-floor transport-column set by `revision`; the per-office
  scan is O(offices × transportsOnFloor), bounded and cheap. Invalidate on the
  same signals `servedFloors` uses.

**W2 noise spacing.** Generalize `officeAdjacent` (`Simulation.ts:1113`, currently
±1 tile) into a distance-parameterized `nearestKindWithin(u, kinds, maxTiles)`:

- Hotel/condo: bothered by office within **21** tiles OR commercial within its
  band; lobby between cancels (scan for a lobby tile in the gap).
- Office: bothered by commercial (fast food et al.) within **11** tiles.
- Feed the **existing** noise erosion + telegraph (gdd-tenant-churn §3) — no new
  eviction path. The current ±1 office→hotel rule becomes the `maxTiles=21` case
  (no double-count).

**W3 commercial-near-lobby.** In the commercial income path
(`EconomySystem`/`collectTrafficIncome`): find nearest lobby by floor distance
(reuse lobby floor set); if `|Δfloor| > 2`, scale the unit's daily take (×0.5) and
expose an inspector reason. Income-scalar, not a lease — commercial has no
`vacating`.

### 2.3 E3 — Parking

- **Ratio:** `PARKING_WORKERS_PER_SPACE` 12→24 (`facilities.ts:387`). One-line;
  `parkingDemand` already divides by it. Update the tests that assert demand.
- **Sprite:** rewrite `drawParking` (`sprites/facilities.ts:247`) to a single
  stall + one car, **responsive to `w`** so both legacy 6-wide and new 4-wide
  units render cleanly (car shown per `parkingUse`/`parkingDead`).
- **Drag-chain:** add `parking` to the paint path — `onActionMove`
  (`main.ts:498`) currently gates `kind === "floor" || "lobby"`; extend to
  `parking`, routing through a `paintFloorRun`-like run using `dragRunTiles`. Ramp
  stays single-tap (16-wide fixture). Each dragged space still needs ramp-chaining
  to be *functional* — placement succeeds, functionality is the existing
  flood-fill's call.

### 2.4 E4 — Mobile drag-paint

`classifyDown` (`main.ts:433`) returns `"pan"` for non-drag-sized tools on touch.
Change: when a **paint tool** (`floor`/`lobby`/`parking`) is active, a touch press
returns `"action"` so the drag paints; `inspect` (and multi-touch) still pans.
Guard against double-placement (the `onTap` vs `onActionDown` split already
distinguishes). This is the only story that touches gesture routing — isolate it.

### 2.5 E5 — Canon capacity & docs

- `TRANSPORT_CAPACITY.elevatorExpress` 33→42 (`facilities.ts:489`). Standard(21)/
  service(16) already canon-ish; leave. Re-check congestion tests for the express
  number.
- `PARITY.md`/`AGENTS.md` canon updates fold in here and in E1.

## 3. Cross-cutting

- **Engine purity:** all penalty logic lands in `src/engine/` (no DOM). Sprites and
  gesture routing are the only render/UI touches (E1 sprite re-fit, E3 sprite, E4).
- **Determinism:** W1–W3 run in `updateSatisfaction`/economy (headless,
  seed-driven), never in `Crowd` (cosmetic, firewalled at `Simulation.ts:1027`).
- **Test fixtures:** add `towerone_6.vctower` (user save) as a migration/parity
  regression fixture — load, assert no overlap, assert parking demand satisfied
  under the 24-worker rule.
- **Version:** each shipped story bumps `package.json` `version` (minor for new
  capability, patch for fixes) per CLAUDE.md; `SAVE_VERSION` bumps once (E1).

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A changed-width sprite hard-codes tile counts → legacy units look wrong | Audit each redrawn sprite for `w`-responsiveness; parking is the exemplar. |
| A test/fixture hard-codes `GRID.width===340` or an old facility width | Grep before changing; update in the same story. |
| W1 distance scan on the per-frame path | Memoize by `revision` like `servedFloors`; never call from render. |
| W2 double-counts the old ±1 office rule | Replace the rule with the `maxTiles=21` case, single code path. |
| Reflow overlaps / strands / goes off-lot | Sweep is obstacle-aware and lot-clamped (§1.1); golden-fixture assertions on `towerone_6` (§1.3); pure/deterministic so failures are reproducible. |
| Reflow surfaces new penalties on a loaded tower | Intended (canon rules now apply) and safe — penalties are the telegraphed, recoverable `vacating` kind (§1.2). |
| Cinema 31 / suite 10 single-sourced | Spike a second source in E1; hold the change if it can't be corroborated. |

## 5. Story slicing (feeds `epics.md`)

E1 ships as **three** PRs — (E1a) lot 340→375 + docs (low risk, unblocks
everything); (E1b) facility widths + width-responsive sprite re-fit
(corroboration-gated on cinema 31 / suite 10); (E1c) `SAVE_VERSION` 1→2 + the
per-floor **reflow** migration + the `towerone_6` golden fixture (highest risk,
depends on E1b's canon widths existing). E2/E3/E4/E5 are independent PRs after
E1a. Recommended merge order: **E1a → E3 → E4 → E5 → E1b → E1c → E2** — high-value
low-risk fixes (parking ratio, mobile paint, express capacity) first, then the
canon widths, then the reflow migration once widths are final, then the
balance-heavy penalties.
