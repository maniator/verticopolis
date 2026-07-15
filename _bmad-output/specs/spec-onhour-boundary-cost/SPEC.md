---
id: SPEC-onhour-boundary-cost
companions:
  - diagnosis.md
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# Engine hour-boundary cost (the on-the-hour hitch)

## Why

A pain to solve. The owner accepted the render-perf initiative (CAP-2 region composition) on the Pixel 8a; the residual is a small hitch exactly on the hour, previously masked by render cost. Headless diagnosis on the owner save (20,155 units, sim model v2, post-CAP-2 main) attributes it to the engine's hourly bundle: a boundary tick costs 52-113ms against 8.35ms regular minutes, worst at 8:00 where the canon hotel checkout and housekeeping dispatch stack. Roughly 70% of the dominant satisfaction sweep is one uncached layout predicate, the noise-adjacency scan, recomputed for every sensitive unit every hour even though its inputs change only when the player edits the tower. The render-perf spec recorded engine amortization as a non-goal; the backlog consult row (GH #367) stamped it spec-first. This spec is that consult's outcome, ratified by party on 2026-07-15 (architect REVISE-narrowed; dev and designer concurring). Full numbers in `diagnosis.md`.

## Capabilities

- **CAP-1**
  - **intent:** The hourly engine bundle stops rescanning layout-derived predicates, cutting the hour-boundary tick to a few multiples of a regular minute tick with byte-identical outcomes.
  - **success:** The committed bench shows the typical boundary tick falling from ~62ms to ~30-35ms and the 8:00 worst case from ~113ms to ~85ms on a ~20k-unit fixture; the golden master hash is unmoved; on the Pixel 8a at top speed the owner cannot tell the hour flipped except by the clock.

## Constraints

- **Outcome-identical or it does not ship.** Golden master `PINNED_STATE_HASH` must not move; no RNG draws added, removed, or reordered; same toasts, notices, evictions, star math. The cache changes WHEN work happens, never WHAT is observed: layout predicates are only consulted at boundaries, and every layout mutation bumps `tower.revision` before the next boundary, so cached and fresh reads see the same world.
- **One new cache only: the noise-adjacency index** (new pure module `src/engine/sim/noiseIndex.ts`). The served-floor set and transport columns are already revision-memoized in shipped code; their measured cost is call-path overhead, recovered by hoisting `tower.servedFloorSet()` out of the per-unit loops in `updateSatisfaction`, `attemptMoveIns`, and `ElevatorDispatch.accumulateWaiting` (the last also trims the flat minute tick), and by passing `farWalk`/`noisy` through to `vacateCause` instead of recomputing.
- **Cache storage is instance-attached** (Tower-field friend pattern like `servedSet`, or a Simulation transient like `elevatorUtil`), revision key compared with strict equality and initialized to -1. A module-level singleton keyed by bare revision is forbidden: revision is a per-instance counter and two Tower instances collide.
- **Never cache state-reading predicates.** The `functionalParkingSet` precedent (`tower/routing.ts:118-125`) is the fence: fire, gut, construction-finish, and occupancy mutations do NOT bump revision. `noiseAfflicted` is cacheable only because it is state-blind, including that a gutted or empty room still radiates by kind; that behavior must not be cleaned up in passing.
- **Caches never serialize.** Serialization is field-explicit; the PR adds a schema guard asserting no cache key appears in `serialize()` output and `towerStateSig` is unchanged by cache warm or cold.
- **`spatialCongestionByFloor` stays live** (it reads live demand). If it is ever memoized, the key is revision + clock.hour per the 2026-06-30 final review.
- **The 8:00 stack is canon and untouchable.** Morning hotel checkout is PRD FR-13 parity, checkout opens the housekeeping shift (FR-14), and overnight guests must be present at the midnight TOWER/VIP census. This spec makes the hour cheaper; it never reschedules sim events.
- **Mandatory differential test.** On randomized towers, every sensitive unit asserts cached noise flag === direct `nearestKindWithin`, covering: the multi-story cinema upper-story source (the top-ranked silent-drift risk; `register` maps both stories into `rooms`), lobby-shield break BEFORE the source check, open-air gap break, shared-wall distance 0, and exact band edges 11/21. Plus state-blindness pins (fire/gut/finish/occupancy leave cached === fresh) and a mutator sweep asserting all eleven `revision++` sites bump (place, removeUnit, placeTransport, removeTransport, resizeTransport, setCars, setStop, clearStops, setExpressStops, coerceExpressStops, reindex).
- **The perf claim must be reproducible.** The PR commits an opt-in (env-gated, never a CI gate) headless hour-cost bench over a synthetic ~20k-unit fixture; the owner save is personal data and stays out of the repo.
- **One PR** carrying the index, the hoists, the pass-through, the tests, and the bench: one mechanism, one invariant, one review context. Process: four quality gates, `/gds-code-review` in-session, patch version bump.

## Non-goals

- Sweep slicing across sim minutes, and onHour phase staggering (checkout :00 / housekeeping :01 / satisfaction :02). Both are determinism-breaking (golden-master re-derivation, notice-batching regression risk) and stay parked behind the GH #367 consult, reopened only by a post-cache Pixel 8a trace still showing a hitch attributable to the sim tick.
- Touching the 8:00 hotel bundle (checkout, housekeeping dispatch).
- Caching congestion or any demand-driven derivation.
- A `nearestTransportDistance` cache (already ~90% cached; 0.3ms per boundary residue).

## Success signal

On the Pixel 8a at top speed on the owner's tower, 12+ consecutive hour flips spanning 6:00-9:00 plus one midnight, at min zoom and detail zoom, produce no feelable hitch: the hour is only visible on the clock. The bench documents the boundary-tick drop, and the golden master proves the sim's story is untouched.

## Assumptions

- The synthetic ~20k-unit bench fixture reproduces the owner save's cost shape well enough to carry the before/after claim (the diagnosis observed cost tracking unit count and sensitive-unit mix, not save-specific quirks).
- A paused-game layout edit still invalidates correctly (revision bumps on placement regardless of pause); the owner acceptance includes one manual spot-check of exactly this.
