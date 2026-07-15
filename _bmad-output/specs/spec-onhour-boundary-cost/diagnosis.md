# Diagnosis: the on-the-hour engine hitch

Measured 2026-07-15 on post-CAP-2 main (959c1d1), owner save: 20,155 units,
31 transports, sim model v2. Venue: headless node (vitest harness walking 24
sim-hours in 1-minute ticks with per-phase timers snapshotted at each
boundary). Browser probes at mid zoom under 4x throttle showed the boundary
frame only ~300-400ms over ~1s render-dominated neighbors: the render venue
swamps engine attribution, so headless is the authoritative venue for this
spec. The harness is not committed; the PR's bench reproduces it over a
synthetic fixture.

## Headline

- Regular minute tick: 8.35ms average (occasional crowd bursts to ~60-100ms).
- Hour-boundary tick: 52-113ms. Typical arithmetic: ~30ms satisfaction +
  8 moveIns + 6.5 star + 5.5 traffic + 3.5 presence + 8.35 baseline = ~62ms.
- Worst boundary 8:00 (113.5ms): hotelCheckout 22.3ms and
  dispatchHousekeepers 18.5ms stack on the regular bundle. Both are canon
  (PRD FR-13/FR-14) and out of scope.

## Per-boundary phase costs (ms, range across 24 boundaries)

| phase | ms |
|---|---|
| updateSatisfaction | 20-41 |
| attemptMoveIns | 5-11 |
| evaluateStar | 3-10 |
| collectTrafficIncome | 3-8 |
| updatePresence | 2-5 |
| dispatchHousekeepers | 1-18 (day shift) |
| hotelCheckout | 22 (8:00 only) |
| sampleElevatorUtil | ~0 |

## Inner attribution (totals across all 24 boundaries)

- `noiseAfflicted`: 469ms. The only uncached layout predicate. Per sensitive
  unit per boundary, `nearestKindWithin` probes up to 22 tiles x 2 directions,
  each probe up to three string-keyed map lookups with a fresh template-string
  key allocation; bottomed-out units pay it twice (again in `vacateCause`).
  Callers are exactly the hourly sweep and `vacateCause`: a cache harvests
  100% of it.
- `isFloorServed`: 200ms measured, but the underlying set is ALREADY
  revision-memoized (`servedFloors`, `tower/routing.ts`); the cost is a
  4-deep delegation chain called once per unit per phase plus instrumentation
  overhead. Fix is call-site hoisting, not a new cache. The
  `ElevatorDispatch.accumulateWaiting` site runs every step, so hoisting
  there also trims the flat minute tick.
- `spatialCongestionByFloor`: 90ms. Demand-driven (live census/rush), stays
  live.
- `nearestTransportDistance`: 7ms. Already sits on revision-memoized
  `transportColumns`; residue is 0.3ms per boundary. No cache.

## Expected outcome (dev arithmetic, ratified)

Savings ~19.5ms (noise index) + ~6-7ms (served hoists) + ~0.5ms (vacateCause
pass-through) = ~27ms: typical boundary ~62ms to ~30-35ms (from ~6-13x a
regular tick to ~3-4x), 8:00 ~113ms to ~85ms. The residual 8:00 cost is the
canon hotel bundle plus state-dependent population scans; if the device still
hitches after this ships, the escalation path is the GH #367 consult
(phase staggering, determinism-breaking), not more caching.

## Revision-bump audit (architect, 2026-07-15)

All layout mutations route through eleven `revision++` sites: place,
removeUnit, placeTransport, removeTransport, resizeTransport, setCars,
setStop, clearStops, setExpressStops, coerceExpressStops, reindex. No bypass
found in production code; nothing reachable from tick/onHour/onDay bumps
revision, so the cache computes once per player edit and never thrashes
mid-sim. State mutations (fire, gut, construction-finish, churn, checkout)
do not bump revision and are not inputs to the noise predicate (kind and
structure only). The mutator sweep test turns this audit into CI.

## Ratification record

Party 2026-07-15: architect REVISE (cut the cache list from three to one,
strike the slicing rider, one PR), dev concurring (story cut, test surface,
arithmetic above), designer concurring (canon audit PASS with four guards:
state-blind fence, congestion out, gutted-still-radiates preserved, golden
master as machine proof; 8:00 stack ruled canon; slicing ruled a non-goal
with its reopen gate).

Full-party roundtable, same day (owner-delegated final word): the cache
shape refined from an eager per-floor index module to a lazy revision-keyed
memo computing through the existing `nearestKindWithin`, deleting the
reimplementation-drift risk instead of testing around it; storage ruled a
Simulation transient (`elevatorUtil` precedent); spec PR merges first,
implementation follows as one PR.
