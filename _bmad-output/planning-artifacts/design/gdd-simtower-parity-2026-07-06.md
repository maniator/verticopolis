---
title: "GDD — SimTower 1994 Parity: segments, walking, parking & placement"
game: Verticopolis (browser SimTower clone)
author: Samus Shepard (Game Designer — gds agent), with the parity-audit party
date: 2026-07-06
status: In design
scope: A canon-alignment initiative. Move Verticopolis's spatial and pedestrian
  model onto the 1994 original's numbers wherever we can — facility segment
  widths, the buildable lot, the "transport is too far" office penalty, noise
  spacing buffers, commercial-near-lobby proximity, express-car capacity — plus
  the parking demand/visual fixes and the placement-input gaps (parking
  drag-chain, mobile floor/lobby drag-paint). Cross-cutting: a version bump and a
  v1→v2 save migration so existing towers survive the width changes.
grounds:
  - PARITY.md (canon reference; §"buildable lot" note at :89)
  - _bmad-output/planning-artifacts/reviews/faq-parity-2026-06-30/faq-canon.md
  - _bmad-output/planning-artifacts/design/gdd-tenant-churn-2026-07-03.md (noise, churn, telegraph rules)
  - _bmad-output/planning-artifacts/design/gdd-legibility-2026-07-01.md (§0 guardrails)
  - src/engine/facilities.ts (FACILITIES widths, GRID, PARKING_WORKERS_PER_SPACE, TRANSPORT_CAPACITY, maxSpanFor)
  - src/engine/Simulation.ts (SAVE_VERSION + migration seam :117-152; updateSatisfaction; parkingDemand)
  - src/engine/Crowd.ts (routing, ≤2-ride rule, no distance penalty)
  - src/engine/Tower.ts (functionalParkingSet, servedFloors)
  - src/main.ts / src/game/buildActions.ts / src/ui/placement.ts (build input, drag-paint)
  - src/render/sprites/facilities.ts (drawParking)
sources:
  - https://simtower.fandom.com/wiki/Segment
  - https://simtower.fandom.com/wiki/Office
  - https://simtower.fandom.com/wiki/Room
  - https://relentlessoptimizer.com/gaming/2021/03/13/simtower-reference/
  - https://gamefaqs.gamespot.com/pc/565191-simtower/faqs/28905 (kiwizoid FAQ)
  - https://www.gamesurge.com/strategies/strategyindex/simtower.shtml
---

# GDD — SimTower 1994 Parity: segments, walking, parking & placement

> **The pillar of this initiative:** *canon is the default.* Where Verticopolis
> has diverged from the 1994 original's published numbers, we move **back to
> canon** unless there is a hard technical reason to hold. Divergences that
> remain must be *chosen and documented in `PARITY.md`*, never accidental. This
> reverses local tunings (lot width 340, parking 6-wide, 12-workers-per-space)
> that were pragmatic guesses, now that the FAQ numbers are in hand.

## 0. Why this exists

A parity audit (against the kiwizoid GameFAQs FAQ, the SimTower Fandom wiki, and
the Relentless Optimizer reference) found that Verticopolis's **spatial model**
drifted from the original on three axes:

1. **Facility footprints** are on ad-hoc tile widths, not the original's segment
   widths (parking is 1.5× too wide, the ramp 2.7× too narrow, stairs/escalators
   half-width, fast food / restaurant / cinema / suite all short).
2. **Horizontal distance is free.** The original's signature "the elevator is too
   far" office penalty (**79 segments**) does not exist here at all — a tenant is
   unaffected by how far it sits from transport. Noise and commercial-placement
   proximity rules are also thinner than canon.
3. **Placement input** is missing the original's parking drag-chain, and the
   floor/lobby drag-paint doesn't work on touch.

None of these are bugs in isolation; together they mean a tower that "reads"
correctly in the original plays differently here. This GDD brings the numbers and
the pedestrian rules onto canon and fixes the two input gaps, behind a save
migration so no existing tower breaks.

## 1. The design pillars this answers to

| Pillar | What it means here |
|---|---|
| **Canon is the default** | Every number below is the 1994 value unless a documented technical reason overrides it. |
| **Inform before you hurt** (inherited, gdd-legibility §0) | New penalties (transport-too-far, expanded noise, commercial-too-far) telegraph the cause and are recoverable — they reuse the `vacating` notice period, never instant deletion. |
| **No save left behind** | A width/lot change must not corrupt or visually scramble an existing tower. Migration is part of the feature, not a follow-up. |

---

## 2. Segment-size parity (the spatial spine)

**The rule:** a **segment** is the original's atomic horizontal build unit (the
width of the Floor tool). Verticopolis's tile == one segment (Floor/Lobby are
width 1, Office is 9 in both). We align every facility footprint to its canon
segment width, and widen the buildable lot to the canon **375**.

### 2.1 Buildable lot: 340 → **375**

`GRID.width` moves 340 → 375. The prior 340 (PARITY.md:89) was chosen to keep the
**15,000 TOWER goal** reachable; 375 is *wider*, so it strictly helps that goal —
no conflict. `PARITY.md` is updated to state 375 = canon map width. Any facility
whose width tracks the lot (metro backdrop) tracks the new value.

### 2.2 Facility width table (current → canon)

| Facility | Current | Canon (seg) | Action | Confidence |
|---|---:|---:|---|---|
| Office | 9 | 9 | keep | ✅ |
| Condominium | 16 | 16 | keep | ✅ |
| Retail Shop | 12 | 12 | keep | ✅ |
| Party Hall | 24 | 24 | keep | ✅ |
| Hotel Single | 4 | 4 | keep | ✅ |
| Hotel Double | 6 | 6 | keep | ✅ |
| **Hotel Suite** | 12 | **10** | squish | ✅ |
| **Fast Food** | 12 | **16** | widen | ✅ |
| **Restaurant** | 16 | **24** | widen | ✅ |
| **Cinema** | 24 | **31** | widen | ✅ corroborated (2 sources) |
| **Stairway** | 4 | **8** | widen | ✅ |
| **Escalator** | 4 | **8** | widen | ✅ |
| **Parking Space** | 6 | **4** | narrow | ✅ |
| **Parking Ramp** | 6 | **16** | widen | ✅ |
| Elevator (std/svc/exp) | 3/4/4 | undocumented | keep | — |
| Security / Medical / Housekeeping / Recycling | 8/16/8/20 | undocumented | keep | — |

> **[NOTE FOR DESIGNER]** Cinema 31 and hotel-suite 10 are **corroborated by a
> second source** (Fandom Room/Cinema pages + a second web source confirming
> "Cinema occupies 2 levels and is 31 segments long" and "Hotel Suite width 10
> segments") — the E1b gate is cleared and both shipped. Widths left "undocumented"
> (elevators, service rooms) are **not** changed — canon-first does not mean invent
> numbers.

### 2.3 Downstream effects of the width changes

- **Parking demand math** already counts *spaces*, not tiles, so a 4-wide space
  is still one functional spot — but the ramp going 6→16 changes basement layout
  and the flood-fill footprint (still correct: it seeds every ramp tile).
- **`buildMinutes`, cost-per-tile intuition, `BUILD_CAPS`** are unaffected by
  width except cosmetically; verify no test hard-codes a width.
- **Sprites** for every widened/narrowed facility must be re-fit to the new span
  (the parking sprite is redrawn anyway — §6.2).

### 2.4 Acceptance criteria

1. `GRID.width === 375`; a fresh tower can build to the right edge at x=374.
2. Every facility in §2.2 marked "widen/narrow" has its `FACILITIES[kind].width`
   at the canon value, and its sprite fills the new footprint with no clipping or
   gap.
3. `PARITY.md` states 375 as the canon lot width and lists any remaining
   deliberate divergence.
4. No existing test asserts an old width; all gates green.

---

## 3. W1 — "Stairs/elevators are far away" (the 79-segment penalty)

**The rule (canon):** an office more than **79 segments** of horizontal walking
from the nearest *reachable* transport (stairs, escalator, or elevator door) gains
the "Stairs/Elevators are far away" condition — its evaluation drops and, left
unfixed, it fails to lease / vacates.

### 3.1 Model

- Distance is **horizontal, same-floor, to the nearest transport column that is
  itself reachable** (a shaft that goes nowhere doesn't count). Measured from the
  office's nearest edge to the transport's nearest edge, in tiles/segments.
- The penalty routes through the **authoritative aggregate** path
  (`updateSatisfaction`), *not* the cosmetic per-sim crowd — consistent with how
  congestion and noise already work, and headless-deterministic.
- It is a **satisfaction drain**, so it composes with the existing `vacating`
  notice period: a too-far office is telegraphed (cause: **transport too far**),
  shown the live countdown, and recovers if a transport is added within reach.

### 3.2 Tuning

| Knob | Value | Rationale |
|---|---|---|
| Distance threshold | **79 tiles** | Canon. With offices 9 wide, a centered stair/escalator serves ~18 offices — the original's known layout trick still works. |
| Drain when too far | reuse noise-tier erosion (~−0.07/hr, capped) | Matches an existing telegraphed pressure; not an instant kill. |
| Cause string | "🚶 The nearest elevator/stairs is too far — workers won't walk it." | New `VacateReason` `"transportFar"`. |

### 3.3 Acceptance criteria

1. An office whose nearest reachable transport edge is >79 tiles away on its floor
   accrues the penalty; ≤79 does not.
2. The penalty drains satisfaction and can drive `vacating` with cause
   `transportFar`, shown in the inspector with a live countdown.
3. Adding stairs/elevator within 79 tiles stops the drain; an on-notice office
   rescinds silently.
4. Unreachable transport does not count as "near". Deterministic under headless.

---

## 4. W2 — Noise spacing buffers

**The rule (canon):** noise-sensitive rooms lose evaluation near noise sources,
with two documented horizontal buffers and a broader sensitivity matrix than we
model today.

### 4.1 What changes vs. today

Verticopolis currently models **only** office→hotel/condo noise, at a **1-tile,
same-floor** radius (gdd-tenant-churn §3). Canon is wider:

| Sensitive room | Bothered by | Documented buffer |
|---|---|---|
| Office | commercial (fast food, restaurant, retail, cinema) | fast food ↔ office: **11 empty segments** |
| Hotel / Condo | commercial **and** office | hotel ↔ office: **21 segments** |

- Within the buffer distance (same floor; and the existing shared-wall
  adjacency), the sensitive room takes the noise erosion already defined in
  gdd-tenant-churn §3 (annoyance cap 0.6 → gentle erosion → telegraphed notice).
- A **lobby between** the source and the sensitive room acts as a buffer (canon).

### 4.2 Tuning & scope

| Knob | Value | Note |
|---|---|---|
| Fast-food → office buffer | 11 tiles | Canon, same floor. |
| Hotel/condo → office buffer | 21 tiles | Canon, same floor. Replaces/extends the 1-tile rule. |
| Other commercial → office/hotel | same erosion, buffer = the room's own width band | ⚠️ per-pair segment constants beyond 11/21 are undocumented — use a single "within buffer OR shared wall" rule, only 11 & 21 hard-coded. |
| Effect | reuse §3 noise erosion & telegraph | No new eviction path. |

> **[ASSUMPTION: only the 11- and 21-segment buffers are canon numbers; other
> noisy pairings use the same adjacency+erosion rule without a distinct published
> constant. Confirmed "qualitative only" by the research pass.]**

### 4.3 Acceptance criteria

1. A hotel/condo within 21 tiles of an office (same floor) takes noise erosion; a
   lobby placed between them cancels it.
2. An office within 11 tiles of fast food (and other commercial) takes erosion.
3. Existing 1-tile office→hotel behavior is subsumed, not duplicated (no
   double-counting).
4. All noise still telegraphs via the notice period; deterministic headless.

---

## 5. W3 — Commercial must be near a lobby

**The rule (canon):** shops and food more than **2 floors** from a lobby / sky
lobby suffer an "elevators too far" penalty — the original's reason underground
retail clusters near the lower lobbies.

### 5.1 Model & tuning

- For each commercial unit (fast food, restaurant, shop, cinema), find the nearest
  lobby/sky-lobby by **floor distance**. If `|Δfloors| > 2`, apply a **draw/income
  penalty** (not a lease eviction — commercial has no lease; poor placement starves
  its traffic, matching how commercial already depends on a served floor).
- Penalty scales the unit's daily take (e.g. ×0.5 beyond 2 floors), telegraphed in
  the inspector ("Too far from a lobby — few shoppers reach it").

### 5.2 Acceptance criteria

1. A shop/food unit >2 floors from any lobby earns reduced traffic income; ≤2 is
   unaffected.
2. The inspector explains the penalty; adding a lobby within 2 floors clears it.
3. Deterministic; no new eviction path for commercial.

---

## 6. Parking

### 6.1 Office demand ratio: 12 → **24** workers per space

`PARKING_WORKERS_PER_SPACE` 12 → 24. Canon is **one space per four offices**;
office = 6 workers, so 24 workers/space is exactly "one per four offices." Today's
12 makes offices demand **2× the parking** the original asks for. This also fixes
the reported symptom (a well-parked tower reading as "short").

### 6.2 Sprite: one space shows ~5 cars → **one car**

`drawParking` currently paints a bay-divider run and up to ~5 cars across the
6-tile module, implying ~5 spaces for what the engine counts as one. With the
footprint narrowing to the canon **4 tiles** (§2.2), the sprite is redrawn as a
**single stall with one car** (car shown when `parkingUse` says the space is
occupied). Result: visual == count == one space.

### 6.3 Placement: parking **drag-chain**

Canon lets you place parking like the Floor tool — click-drag to lay a **chain of
spaces** connected to the ramp. Today only floor/lobby drag-paint; parking is
one-tap. Add parking (and ramp?) to the drag-paint path so a drag lays a run of
spaces along the floor. (Ramp stays single-placement — it's a 16-wide fixture, not
a tiled run.)

### 6.4 Acceptance criteria

1. `PARKING_WORKERS_PER_SPACE === 24`; `parkingDemand` for N offices = `ceil(N*6/24)`.
2. A single parking module is 4 tiles, draws one stall/one car, and counts as one
   functional spot when ramp-chained.
3. Click-drag with the Parking tool lays a contiguous run of spaces (desktop and
   touch, per §7); each still obeys ramp-chaining to be functional.
4. The user's `towerone_6` save, post-migration, shows parking demand satisfied
   (85 spaces vs the new 24-worker demand) and no visual scramble.

---

## 7. Mobile floor/lobby (and parking) drag-paint

**The gap:** `classifyDown` returns `"pan"` for any non-drag-sized tool on touch
(`main.ts:442`), so a touch-drag with Floor/Lobby/Parking pans the camera instead
of painting a run. Drag-paint is mouse-only today.

**The rule:** on touch, a drag **with a paint tool active** (floor, lobby,
parking) paints the run; a drag with the **inspect** tool (or two-finger) still
pans. This mirrors the desktop gesture and matches the original's drag-to-lay
feel. Single-finger pan remains available via the inspect tool / when no paint
tool is held.

### 7.1 Acceptance criteria

1. With Floor/Lobby/Parking active on touch, a one-finger drag paints a
   contiguous run (not a pan).
2. With Inspect active on touch, a drag still pans.
3. Desktop behavior unchanged; no double-placement.
4. Verified on a touch emulation / real device.

---

## 8. Version bump & save migration (v1 → v2)

**The rule:** the width and lot changes alter geometry, so existing saves must
migrate. `SAVE_VERSION` 1 → 2, using the already-stubbed upgrade seam
(`Simulation.ts:150`).

### 8.1 Migration intent

- **Lot 340→375:** additive on the right; existing unit x-positions are unchanged.
- **Facility width changes need a real reflow.** Units persist their own `width`
  and `deserialize` trusts it, so simply loading an old save is *safe* but leaves
  it on legacy widths forever — not canon. Since some kinds expand (ramp 6→16,
  fast food 12→16, restaurant, cinema) and some squish (parking 6→4, suite →10),
  the migration **re-lays each floor at canon widths**, preserving order and gaps,
  never overlapping a neighbor or a transport column, within the 375 lot. Full
  algorithm + the evidence it fits `towerone_6` (14/15 expanders would collide in
  place, but ~72 tiles of slack + net basement shrink make the reflow fit) is in
  the architecture doc §1.
- **Accepted trade:** rooms shift horizontally, so vertical alignment degrades
  cosmetically and canon spatial rules (W1/W2) re-evaluate on the new layout —
  correct, and safe because those penalties are telegraphed/recoverable.
- **Goal:** an old tower loads, adopts canon widths, and doesn't look broken — the
  user's `towerone_6` is the golden migration fixture (assertions in arch §1.3).

### 8.2 `package.json` version

Player-facing behavior changes across the board → **minor** bumps per shipped
story (new capability), patch for pure fixes. The initiative as a whole lands over
several PRs; each bumps `version` per CLAUDE.md.

### 8.3 Acceptance criteria

1. `SAVE_VERSION === 2`; a v1 save loads through `upgradeV1toV2` with no thrown
   errors and no overlapping units.
2. `towerone_6.vctower` loads post-migration with intact, non-overlapping
   geometry and correct parking/other counts.
3. A v2 save round-trips (serialize→deserialize) identically.
4. A save from a *newer* version than the build still refuses gracefully (existing
   behavior preserved).

---

## 9. Out of scope / deferred

- **Elevator/service-room widths** (undocumented in canon) — not touched.
- **Per-pair noise constants** beyond 11/21 — single rule, no invented numbers.
- **Cinema draw radius, lobby crowd cap** — canon is qualitative only; not modeled.
- **Stairs "cumulative 4–5 floor willingness"** vs our ride-count routing — sources
  conflict (4 vs 5); deferred, tracked as an open question.
- **Map width beyond 375 / vertical basement changes** — not in scope.

## 10. Open questions

1. Does `Unit` persist `width`, or derive it at load? (Decides migration strategy — §8.1.) → architecture.
2. Cinema 31 / suite 10 — second source before shipping the width change? → architecture spike.
3. W3 penalty as income-scalar vs. draw-radius — pick during architecture.

---

## 11. Development epics (summary — detail in `epics.md`)

| # | Epic | Stories | Risk |
|---|---|---|---|
| E1 | **Spatial spine** | Lot 375; facility width alignment; sprite re-fit; **save migration v1→v2** | High (save-breaking) |
| E2 | **Pedestrian penalties** | W1 transport-too-far; W2 noise spacing; W3 commercial-near-lobby | Med (balance) |
| E3 | **Parking correctness** | ratio 12→24; sprite one-car; parking drag-chain | Low–Med |
| E4 | **Input parity** | mobile floor/lobby/parking drag-paint | Low |
| E5 | **Canon capacity & docs** | express 33→42; PARITY.md/AGENTS.md canon updates | Low |

**Sequencing:** E1 first (everything else sits on the corrected geometry + a
migration path), then E3/E4/E5 (low-risk, independent), then E2 (the balance-heavy
penalties, each its own reviewed PR). Every story: quality gates + `/gds-code-review`
+ `version` bump per CLAUDE.md.
