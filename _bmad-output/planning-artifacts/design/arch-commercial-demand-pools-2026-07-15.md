# Architecture: Commercial demand pools (#393)

Status: draft for review. Companion to
`gdd-commercial-demand-pools-2026-07-15.md`. This is the technical spine: the data
shapes, module boundaries, function seams, caching, and the test surface the build
phases hang off. It commits to *where* things live and *what* stays invariant, not
to tuned magnitudes (those are calibration, section 6 of the GDD).

## 1. One-sentence shape

Insert a deterministic, per-hour, per-venue `demandFraction` map between the census
and `collectTrafficIncome`, computed from per-origin budgets distributed across
reachable venues by capacity, and read it in place of the single `trafficAppeal()`
scalar. Everything else in the money loop is unchanged.

## 2. Module boundaries

New engine module: `src/engine/sim/demand.ts` (pure, no DOM, consistent with the
`src/engine/` rule). It owns the demand model and nothing else:

```
// src/engine/sim/demand.ts
export interface DemandMap {
  // venue unit id -> demand fraction in [0, 1] (the appeal replacement)
  fractionByUnit: Map<number, number>;
  // venue unit id -> raw delivered demand dollars D_v (for the inspector and tests)
  deliveredByUnit: Map<number, number>;
  // origin unit id -> count of reachable venues (the coverage signal #395 reads)
  reachableVenuesByOrigin: Map<number, number>;
}

export function computeDemandMap(sim: Simulation): DemandMap;
```

Why a map keyed by unit id, not a scalar on the sim: the inspector and the #395
coverage read both need per-venue and per-origin values, and a map is trivially
memoizable and testable in isolation.

`EconomySystem` is the only consumer in the money path. `collectTrafficIncome`
gains one call (`sim.demandMap()` accessor, memoized per hour) and swaps
`appeal` for `demandMap.fractionByUnit.get(u.id) ?? 0` at the single multiply site
(`EconomySystem.ts:202`). `trafficAppeal()` is deleted once nothing reads it (grep
first: only `collectTrafficIncome` and the barrel surface test touch it).

## 3. Data flow

```
census (totalPopulation / catalog population / condo residents)
   |                                                            per-kind weight (econConfig)
   v                                                            re-homed tower bonus (GameRules)
budget_o  = P_o * w_kind * S_percapita * M_tower   ---- per origin (office/condo/hotel)
   |
   |   floorReachable set (two-ride BFS, cached per tower.revision, per FLOOR)
   v
share(o->v) = budget_o * cap_v / sum_{v' in R_o} cap_{v'}     ---- capacity-proportional
   |
   v
D_v = sum_o share(o->v)                                       ---- delivered demand per venue
   |
   v
fraction_v = min(1, D_v / cap_v)                             ---- the appeal replacement
   |
   v
collectTrafficIncome: hourly_v = (cap_v / openHours) * fraction_v * rain * film * lobby * dice
```

`cap_v = ECON.dailyTrafficIncome[kind_v]`. Origins with an empty `R_o` (stranded,
no reachable venue) contribute nothing and are recorded so #395 can later see
"this origin has zero reachable venues".

## 4. Caching and cadence

Two cache layers, both keyed to avoid staleness:

- **Floor reachability**: `R_floor` (which venue-bearing floors a given floor
  reaches) depends only on layout, so cache per `tower.revision`. Reuse or extend
  the existing `floorReachable` primitive rather than adding a second BFS.
- **Demand map**: depends on layout *and* census occupancy (which drifts without a
  revision bump). Recompute on the hour tick, at the top of `collectTrafficIncome`
  (or a `demandMap()` accessor memoized on `(tower.revision, hourStamp)`). This
  matches the current hourly income cadence, so there is no new per-frame cost.

Cost bound on a maxed tower: origins are grouped by floor, reachability is a cached
per-floor set, so the pass is O(occupied floors x reachable venues), evaluated once
per in-game hour. Confirm against the `perf` Playwright lane before Phase A merges.

## 5. GameRules seam

> **Superseded (Phase C review, 2026-07-15): the `smoothing` field was dropped.**
> A per-venue "soft" curve that lifts a venue's earned fraction above the identity
> `min(1, share)` below the cap makes total delivered demand exceed the pool as
> venues are added, which inverts the model's core cannibalization property.
> Conservation holds only when every venue earns exactly `min(1, share)` below the
> cap, so a conservation-preserving soft shoulder does not exist. The shipped seam
> is `{ perCapita; floor }`; the Modern-vs-Classic difference is the small-tower
> `floor` today (a street-trade baseline), with per-capita magnitude shared by both
> modes for now and reserved for the calibration pass, never a per-venue cap curve.
> A future Modern demand assist must live outside the per-venue split (a larger
> `floor`, or a pool multiplier) to stay conservative. See the backlog Deferral
> inbox (Phase A note, RESOLVED). The original design below is kept for the record.

One new method, following `noiseErosionScale()` / `operatingOverheadPerUnit()`.
The snippet and bullets below are the ORIGINAL spec, retained for the record; the
`smoothing` field and the `"soft"` Modern clause were dropped (see the note above).
The shipped seam is `demandModel(): { perCapita: number; floor: number }`, and both
modes earn the plain `min(1, share)` below the cap.

```
// src/engine/gameRules.ts  (ORIGINAL spec; `smoothing` since dropped)
demandModel(): {
  perCapita: number;   // S_percapita: per-capita daily demand dollars
  floor: number;       // minimum per-venue fraction before demand (small-tower gate)
  smoothing: "hard" | "soft";  // cap approach; hard = plain min(1, x)  (DROPPED, not shipped)
};
```

- `CLASSIC_RULES.demandModel()` returns the 1994-calibrated `perCapita` and a firm
  (low or zero) `floor`. (Originally also `"hard"` smoothing; smoothing was dropped,
  and the shipped Classic is the plain `min(1, share)`.)
- `MODERN_RULES.demandModel()` returns `perCapita` (shared with Classic today; a
  larger-tower retune is reserved for calibration) and a gentle non-zero `floor` so
  early commercial is not dead on arrival. (Originally also optionally `"soft"`;
  that clause was dropped.)

`computeDemandMap` reads `sim.rules.demandModel()`; it never branches on the mode
string. The `floor` applies as `fraction_v = max(floor, min(1, D_v / cap_v))` when
the venue has at least the reachability gate satisfied (a stranded venue stays at
0 regardless of floor, so the floor is a demand assist, not a reachability
bypass).

## 6. Determinism and RNG

`computeDemandMap` is a pure function of census plus layout plus rules. It draws no
random numbers. The only economy RNG remains the per-venue `trafficFactor` at
`EconomySystem.ts:198`, unmoved. This keeps the `economyDepth` "shared stream
untouched" assertion and the `goldenMaster` hash valid as stream-position checks;
the hash value changes (the income math changed) but the stream *position* does
not.

## 7. Metro and recycling re-homing

`M_tower` is resolved inside `demand.ts` from the same operational-metro and
operational-recycling reads `trafficAppeal` uses today (`EconomySystem.ts:248-259`
logic moves or is shared). The multiply-vs-flat-floor choice (GDD 4.1) is a
one-line difference at the budget site and is settled at calibration; the
architecture supports either without moving a boundary.

## 8. Inspector

`src/game/facilityDiagnostics.ts` retail lines stop deriving a customer baseline
from the tower-wide `TRAFFIC_FACTOR_MEAN` proxy and instead read the venue's own
`deliveredByUnit` / `fractionByUnit` from the demand map (exposed through a
read-only `sim` accessor, no DOM in the engine). Modern adds the under-served
(fraction at ceiling with headroom) and over-built (fraction low because peers
split the origins) hints; Classic shows the number without the verdict. This is a
UI-plumbing slice and can ride `/bmad-code-review` if split into its own PR, or
`/gds-code-review` if bundled with the engine phase.

## 9. Test surface

- `src/tests/integration/goldenMaster.integration.test.ts`: re-pin
  `PINNED_STATE_HASH` in the Phase A commit, totals recorded in the PR body.
- `src/tests/integration/commercialDemandPools.integration.test.ts` (new):
  1. Conservation: with every origin served, `sum(D_v) == sum(budget_o)` within a
     dollar.
  2. Cannibalization: adding a second identical reachable venue halves the first's
     `fraction`.
  3. Stranded origin: an origin whose floor reaches no venue contributes 0 and is
     counted in `reachableVenuesByOrigin` as 0.
  4. Cap: an over-subscribed venue's `fraction` clamps at 1 and income never
     exceeds `cap_v / openHours`.
  5. Mode: Classic vs Modern `demandModel()` produces the documented floor
     difference on a thin tower.
- `src/tests/integration/economyDepth.integration.test.ts`: unchanged assertions
  must still pass (no new RNG).
- `src/tests/integration/modernEconomy.integration.test.ts`: Classic stays
  pixel-faithful at the calibration tower.
- `src/tests/integration/trafficTeeth.integration.test.ts`: the reachability gate
  still zeroes a stranded venue.
- `src/tests/barrelSurface.test.ts`: update if the exported constant surface
  changes (for example if `trafficAppeal`-adjacent exports are removed).
- Fixtures via `src/tests/fixtures/towerFixtures.ts` (assert every construction).

## 10. Files touched, by phase

Phase A (engine swap): `src/engine/sim/demand.ts` (new),
`src/engine/EconomySystem.ts` (swap site, delete `trafficAppeal`),
`src/engine/econConfig.ts` (per-capita and weight constants),
`src/engine/Simulation.ts` (memoized `demandMap()` accessor),
`goldenMaster` re-pin, new `commercialDemandPools` test.

Phase B (inspector truth): `src/game/facilityDiagnostics.ts`, a read-only sim
accessor for the demand map.

Phase C (mode divergence): `src/engine/gameRules.ts` (`demandModel()` in both
rule sets), `modernEconomy` assertions.

Untouched and must stay so: `facilities.ts` build caps, `Tower.capReason`,
transport pooling, the crowd draw (`crowd/visits.ts` `customersIn`).

## 11. Open architectural questions

- Whether `demandMap()` lives as a memoized accessor on `Simulation` or is passed
  explicitly into `collectTrafficIncome`. Leaning accessor (matches how the sim
  exposes other derived reads), decided in Phase A.
- Whether attendance venues (cinema, partyHall) share the one pool or get a
  separate leisure pool. GDD 4.5 keeps one pool for v1; revisit only if a single
  cinema distorts a small tower's split at calibration.
