# GDD: Commercial demand pools (#393)

Status: draft for review. Spec-first epic. This document is the design; no engine
code ships with it. Each build phase below lands as its own PR under
`/gds-code-review`.

Parent roadmap: `gdd-simtower-optimization-gaps-2026-07-15.md` (section B, priority
1). Backlog row: `commercial-demand-pools` (#393). This GDD expands that row into
a buildable model.

## 1. Problem

Verticopolis models commercial *income* but not commercial *demand*. Every
traffic venue earns a share of its advertised daily figure driven by a single
tower-wide scalar, `trafficAppeal()`, times a per-venue dice factor. Two
consequences follow, and both cut against SimTower's core identity as a placement
puzzle:

- **No cross-venue competition and no diminishing returns.** Two identical shops
  on the same floor each earn the full amount. Building more commercial is always
  pure upside past the population threshold, so the optimal move is "fill every
  spare tile with shops", not "place shops where the foot traffic is".
- **No emergent abandonment limit.** The r/SimTower thread that motivated this
  work suspects the 1994 original has a hidden cap on how many venues a tower
  supports. Our engine has no such cap (shop, fastFood, and restaurant are
  uncapped in `BUILD_CAPS`), and the only diminishing return is the `Math.min(1, ...)`
  ceiling on `trafficAppeal`. Past roughly 5,200 population every venue earns its
  full figure regardless of how many exist.

The fix is to give demand a *source* and a *distribution*: a finite per-origin
patronage budget that is split across the venues each origin can actually reach.
The abandonment limit then falls out of the math (build past what the reachable
demand can feed and each venue's share shrinks) instead of being a hardcoded
number. We model the observable behavior transparently rather than cloning the
original's suspected opacity.

## 2. Current state (grounded)

Citations are into the engine as of this branch; read them before building.

- `trafficAppeal()` (`src/engine/EconomySystem.ts:246-261`): tower-wide scalar
  `min(1, 0.35 + pop/8000 + metroBonus + recyclingBonus)`. Read exactly once, in
  `collectTrafficIncome` (`:113`). Documented as a demand *share* capped at 1, so
  income can never exceed the advertised daily figure.
- `collectTrafficIncome()` (`src/engine/EconomySystem.ts:112-236`), hourly from
  `sim/loop.ts:112`. Per venue:
  `hourly = (dailyTrafficIncome[kind] / openHoursPerDay(kind)) * appeal * rainMult
  * filmMult * lobbyMult * trafficFactor`. There is no per-venue visitor count in
  the money math; `occupants` / `customersIn` are display and census only.
- `ECON.dailyTrafficIncome` (`src/engine/econConfig.ts:7-13`): fastFood 2000,
  restaurant 4000, shop 2500, cinema 8000, partyHall 3000.
- `ECON.mealPopulationWeights` (`src/engine/econConfig.ts:37-42`): office 1.0,
  condo 0.3, hotel 1.0, staff 1.0. The closest existing per-origin weight, used
  today only by meal-trip spawning (`crowd/meals.ts`), never by the economy.
- Reachability gate: `drawsVisitors(floor)` (`EconomySystem.ts:122-132`) uses the
  two-ride `floorReachable` set (or `isFloorServed` as a fallback). This is the
  primitive the demand split reuses.
- W3 lobby penalty: `lobbyMult` halves income for a commercial venue more than
  `COMMERCIAL_LOBBY_FLOORS` (2) floors from the nearest lobby
  (`EconomySystem.ts:190-194`), keyed on `isCommercialKind` (so partyHall is
  outside it).
- Census vs crowd draw: the demand budget must read the statistical census
  (`totalPopulation` in `tower/routing.ts:158`, `occupantPopulation` in
  `sim/star.ts:73`, `censusCount`/`residentCount` in `census.ts`), never the
  roughly 140-person drawn crowd (`customersIn` in `crowd/visits.ts`), which
  saturates on large towers.
- GameRules seam: `src/engine/gameRules.ts` with `CLASSIC_RULES` / `MODERN_RULES`
  and per-mode economy methods (`operatingOverheadPerUnit`, `condoHoldTaxRate`,
  `noiseErosionScale`). The economy already reads through it. The demand model
  adds one method here rather than an inline mode check.

## 3. Goals and non-goals

Goals:

1. Replace the tower-wide `appeal` scalar with a per-venue demand fraction derived
   from a per-origin budget split across reachable venues.
2. Make cross-venue competition and diminishing returns emergent, so venue
   placement and count matter again.
3. Preserve every economy invariant listed in section 6.
4. Keep Classic pixel-faithful in magnitudes; let Modern retune for larger towers.
5. Feed a per-origin "local venue coverage" signal that `leave-tower-unmet-demand`
   (#395) can later read, without building #395 here.

Non-goals (this epic):

- No per-sim agent identity or per-customer simulation. Demand is statistical.
- No change to `BUILD_CAPS`, transport pooling, spans, or `Tower.capReason`.
- No new player-facing build type. This is an income-model change plus an honest
  inspector readout.
- Not cloning a hidden per-venue patronage counter. The model is transparent and
  aggregated.

## 4. The model

### 4.1 Origins and budgets

A demand *origin* is an occupied revenue unit that generates foot traffic: office,
condo, hotel. For each origin `o` with census population `P_o` and per-kind demand
weight `w_kind`:

```
budget_o = P_o * w_kind * S_percapita * M_tower
```

- `P_o` is the census occupancy (offices and hotels from catalog `population`,
  condos from `residents`), never the drawn crowd.
- `w_kind` reuses the shape of `mealPopulationWeights` (office 1.0, condo 0.3,
  hotel 1.0). Staff-origin demand is out of scope for v1 (staff are already
  modeled as a transport load rather than as spenders).
- `S_percapita` is the per-capita daily demand in dollars, the single calibration
  constant (section 7).
- `M_tower` re-homes the tower-wide bonuses that `appeal` folds in today: an
  operational metro and operational recycling, which currently raise appeal (they
  stand in for outside foot traffic). Their gameplay incentive must survive the
  swap. Exactly *how* they re-home is a calibration decision deferred to Phase A
  (section 7), not fixed here: the two candidates are a budget multiplier
  (`M_tower = 1 + metroBonus + recyclingBonus`, scaling with population) or a flat
  additive demand floor (independent of population, which keeps a small metro-fed
  tower viable). Both must reproduce the current metro +0.25 / recycling +0.1
  contribution at the calibration point; the choice is made with the reference
  numbers in hand. Until then `M_tower` is a placeholder for "the re-homed tower
  bonus", whatever form Phase A settles on.

`budget_o` is a quantity of demand dollars the origin's residents will spend per
day if they have somewhere reachable to spend it.

### 4.2 The reachable venue set

For origin `o` on floor `f`, the reachable venue set `R_o` is the set of
operational traffic venues on floors reachable from `f` under the existing
two-ride `floorReachable` rule (the same gate `drawsVisitors` already applies to
income). Reachability is a property of the floor, not the unit, so it is computed
once per floor and shared by all origins on it.

### 4.3 Capacity-proportional distribution

Each origin distributes its budget across its reachable venues in proportion to
venue capacity, where a venue's capacity is its advertised daily figure
`cap_v = dailyTrafficIncome[kind_v]`:

```
share(o -> v) = budget_o * cap_v / sum over v' in R_o of cap_{v'}      (for v in R_o)
D_v           = sum over origins o with v in R_o of share(o -> v)
```

Capacity-proportional (rather than equal) distribution handles a floor that mixes
a $2,500 shop and an $8,000 cinema without the small venue soaking a full even
share it cannot use. It also gives the conservation property below.

The per-venue demand fraction that replaces `appeal` is:

```
demandFraction_v = min(1, D_v / cap_v)
```

and the hourly income becomes:

```
hourly_v = (cap_v / openHoursPerDay(kind_v))
         * demandFraction_v
         * rainMult * filmMult * lobbyMult * trafficFactor
```

Only the `appeal` term changed: a single tower-wide scalar became a per-venue
`demandFraction_v`. The rain, film (blockbuster), lobby (W3), and dice terms are
untouched, so their balance and tests carry forward unchanged.

### 4.4 Why the abandonment limit is now emergent

Total delivered demand is conserved. If every origin reaches at least one venue,
`sum over v of D_v = sum over o of budget_o`, because each origin's budget is fully
distributed. So before the `min(1, ...)` cap bites, total commercial income is
exactly the sum of origin budgets (times the shared multipliers). Adding a venue
does not create demand; it redistributes the existing budget across one more
mouth.

Worked example. Two offices, each `budget = 100`, both reaching one shop
(`cap = 2500`). `D_shop = 200`, `demandFraction = min(1, 200/2500)`. Build a
second identical shop reachable from both offices. Now each office splits its
budget across two equal-capacity shops: `D_each = 100`, so each shop's fraction
halves. The two shops together still deliver `200`, not `400`. The second shop
cannibalizes the first. That is the diminishing return and the emergent
abandonment limit: build past what the reachable population can feed and the new
venue starves the old ones instead of minting free money.

### 4.5 Attendance venues

> **Superseded (#424, 2026-07-16): attendance venues no longer join the demand
> pool.** The Phase A design below folded cinema and partyHall into `totalCap` as
> capacity sinks. Adversarial review confirmed that distorts a modest tower: a
> single cinema (daily 8000) collapses `share = pool / totalCap` and can zero
> genuine shop/food income, even though its own trade runs on the separate
> live-attendance system, not the office lunch crowd. So attendance venues are now
> excluded from `totalCap`, and their income fraction comes from their live fill,
> `min(1, customersIn / attendanceCap)`, computed in the income loop. They never
> dilute the retail share nor draw the office/condo/hotel budget. The blockbuster
> `filmMult` still multiplies on top of that fill fraction. Note the two blockbuster
> channels now compose: a blockbuster draws a bigger crowd (a higher `customersIn`,
> so a higher fill fraction) AND applies the `filmMult`, so its premium is more than
> a flat 2.2x in an under-filled house. This is deliberate and bounded: the
> `min(1, ...)` cap holds a sold-out blockbuster to exactly `filmMult` times the
> advertised figure, so income can never run away, and a quiet tower's thin crowd
> keeps the absolute take low (still a gamble against the doubled booking fee),
> preserving the "a blockbuster can never pay back its doubled fee purely through
> appeal" balance from `gdd-economy-depth`. The `economyDepth` and
> `commercialDemandPools` tests pin the sold-out 2.2x premium and the empty-house
> zero. The original Phase A text is kept below for the record.

Cinema and partyHall carry a `dailyTrafficIncome` but have zero catalog population
and no retail subtype, and they skip the `patronageToday` seam
(`EconomySystem.ts:211-216`). They participate in the demand pool as capacity
sinks (`cap_v` from their daily figure) so a tower over-built with cinemas sees
the same starvation, but they keep their existing attendance display path
(`attendanceCap` / `customersIn`) untouched. The blockbuster `filmMult` still
multiplies on top of the fraction, so a blockbuster remains a demand amplifier for
that one cinema, capped at its advertised figure by the `min(1, ...)` on the
fraction (preserving the "a blockbuster can never pay back its doubled fee purely
through appeal" balance from `gdd-economy-depth`).

### 4.6 Compute cadence

The demand-fraction map is recomputed on the hour tick, inside (or just before)
`collectTrafficIncome`, matching today's cadence. Cost is bounded: reachability is
cached per floor per `tower.revision` (structural edits only), and the per-hour
pass is O(occupied floors x venues). No new per-frame work. The map is
deterministic (census plus layout), so it adds no RNG draw (section 6).

## 5. Classic versus Modern

> **Superseded (Phase C review, 2026-07-15): the `smoothing` field was dropped.**
> A per-venue "soft shoulder" that lifts a venue's earned fraction above the
> identity `min(1, share)` below the cap makes total delivered demand exceed the
> pool as venues are added, inverting the model's core cannibalization. The split
> stays the plain `min(1, share)` in both modes; only `perCapita` and the
> small-tower `floor` differ. See section 5's note in the arch doc and the backlog
> Deferral inbox (Phase A note, RESOLVED). The original table below is kept for the
> record.

The split shape is identical in both modes (otherwise Classic is not reproducing
the classic game). Only the magnitudes differ (the `smoothing` field was dropped,
see the note above), and they ride one `GameRules` method, following the
`noiseErosionScale()` pattern:

```
interface GameRules {
  // ... existing ...
  demandModel(): { perCapita: number; floor: number };  // `smoothing` dropped, see note above
}
```

| Aspect | Classic | Modern |
| --- | --- | --- |
| Per-capita spend `S` | Dedicated 1994 target at the calibration tower | Same shape, retuned so larger towers stay viable |
| Small-tower floor | Firmer: a thin tower genuinely starves commercial | Gentle floor so early commercial is not dead on arrival |
| Cap behavior | Hard `min(1, ...)` | Same hard cap (a soft shoulder would break conservation; dropped) |
| Distance | W3 halving stays as today | May compose the graduated lobby curve from #394 |

Classic withholds advice, never information: both modes compute the same true
demand fraction, and both may show it in the inspector (section 8). Only Modern
adds the "under-served" and "over-built here" hints.

## 6. Invariants the build must preserve

Every one of these is load-bearing and testable. A build phase that trips one is
wrong even if it typechecks.

1. **Income never exceeds the advertised daily figure.** `demandFraction_v <= 1`
   by the `min(1, ...)`, so `hourly_v <= cap_v / openHours`. Preserves the
   blockbuster balance and the appeal-cap contract.
2. **No new RNG draw.** The only economy RNG stays the existing per-venue
   `trafficFactor` at `EconomySystem.ts:198`. The demand map is deterministic. The
   `economyDepth` "overhead consumes no RNG / shared stream untouched" assertion
   and the golden-master hash both pin byte-identical stream position.
3. **Census, not crowd draw.** The RETAIL demand pool's budgets read
   `totalPopulation` / `occupantPopulation` / catalog `population` / condo
   `residents`, never `customersIn` or the roughly 140-person crowd, so a large
   tower's saturating crowd cannot cap the pool. Attendance venues (cinema, party
   hall) are a deliberate exception (#424): they never joined the census pool, and
   their income reads their own live `customersIn` fill, which is exactly their
   long-standing live-attendance model. The exception is safe because it is
   local to each attendance venue (it does not feed the shared retail pool) and
   bounded by its own small `attendanceCap`. Its known consequence is that on a
   very large tower the thin crowd may keep a cinema below its cap; that is the
   attendance system's existing behavior, and tuning attendance draw at scale is a
   calibration concern, not a demand-pool one.
4. **`retailSpendPerCustomer` stays cosmetic** (`econConfig.ts:16`). The money loop
   still does not divide by it. If a later phase makes visitors load-bearing, that
   is a separate, deliberate decision with its own review.
5. **W2 / W3 key off the single `isCommercialKind` predicate.** The demand split's
   notion of "commercial" stays consistent with the predicate the noise and lobby
   penalties use, so the inspector readout cannot drift from the money.
6. **One erosion step for distance.** This epic does not add a satisfaction drain;
   #394 does. When both land, the new lobby-distance term folds into the single
   per-tick erosion step so W1, W2, and lobby distance do not triple-erode.
7. **Ledger categories unchanged.** Per-venue income still records through
   `ledgerCatFor(u.kind)`.

## 7. Calibration and income conservation

The swap is calibrated, not guessed. Procedure:

1. Pick a golden reference tower (extend or reuse the `goldenMaster` fixture) at a
   population where today's `appeal` is at or near its `min(1, ...)` ceiling, so
   the two models can be lined up at a known point.
2. Solve `S_percapita` (Classic) so that total commercial income over the golden
   run under the new model equals the total under the old model at that tower.
   This conserves income at the calibration point; away from it the models
   diverge by design (that divergence is the feature).
3. Re-pin `PINNED_STATE_HASH` in `goldenMaster.integration.test.ts` with intent,
   in the same commit that introduces the new math, with the before/after totals
   recorded in the PR body.
4. Add a dedicated `commercialDemandPools.integration.test.ts` that asserts the
   conservation property directly (sum of venue demand equals sum of origin
   budgets when every origin is served) and the cannibalization property (adding a
   second identical reachable venue halves the first's fraction).

## 8. Inspector truthfulness

The retail inspector currently derives a customer baseline from
`TRAFFIC_FACTOR_MEAN` (`facilityDiagnostics.ts:89`). Under the new model the venue
knows its own `demandFraction_v`, so the readout should show the real per-venue
demand share instead of a tower-wide proxy, or it will lie once venues compete. A
later phase updates the retail lines to read the computed fraction (and, in
Modern, to name "under-served" when the fraction is capped high with headroom, or
"over-built" when a venue's fraction is low because peers split its origins).

## 9. Phasing

Each phase is its own PR with `/gds-code-review` (economy math is gameplay), the
four quality gates, and a version bump when player-facing.

- **Phase 0 (this PR):** GDD plus the architecture spec plus the backlog row
  update. Docs only, no engine diff, `/bmad-code-review` lane.
- **Phase A:** introduce the deterministic demand-fraction map and swap it in for
  `appeal` at the single call site, calibrated to conserve income (golden hash
  re-pin). Metro and recycling bonuses re-homed into `M_tower`. Classic values
  only; Modern reads the same numbers until Phase C.
- **Phase B:** the `commercialDemandPools` conservation and cannibalization tests,
  plus the inspector readout truthed to the per-venue fraction.
- **Phase C:** the `GameRules.demandModel()` divergence (Modern retune and soft
  floor) and the Modern-only under-served / over-built hints.
- **Follow-on (separate issues):** `weekend-patronage-curve` (#398) composes as a
  budget multiplier; `leave-tower-unmet-demand` (#395) reads the per-origin
  coverage signal this model exposes.

## 10. Risks and open questions

- **Golden-hash churn.** The income-model swap flips the pinned hash. Mitigated by
  calibrating to conserve income at the reference tower and recording the totals
  in the PR body, so the re-pin is auditable.
- **Small-tower starvation.** Removing the `0.35` appeal floor could starve
  early-game commercial. Open question: the exact `floor` value per mode. Resolve
  during Phase A calibration; it is a `demandModel()` field precisely so it can be
  tuned per mode without touching the math.
- **Re-homing metro and recycling.** `M_tower` must reproduce their current
  contribution at the calibration point. Open question: whether they multiply the
  budget (chosen here) or add a flat demand floor. Decide with the calibration
  numbers in hand.
- **Reachability cost on maxed towers.** Bounded by per-floor caching on
  `tower.revision`, but confirm with a perf check on a full tower before Phase A
  merges (the `perf` Playwright lane).
- **Attendance venue weighting.** RESOLVED (#424, 2026-07-16). Cinema's $8,000
  capacity dominated a mixed floor's proportional split and could zero a modest
  tower's genuine retail, so attendance venues (cinema, party hall) were pulled out
  of the demand pool entirely (see §4.5): they now earn from their own live
  attendance fill, not the office/condo/hotel budget. The blockbuster economics
  stay pinned by the `economyDepth` tests.

## 11. Source links

- Parent roadmap and priority: `gdd-simtower-optimization-gaps-2026-07-15.md`
  (section B row #393, priority 1, engineering notes).
- Economy invariants: `gdd-economy-depth-2026-07-01.md` (appeal cap and
  blockbuster balance).
- r/SimTower optimal-tower thread (the "abandonment cap" the OP suspected): linked
  from the parent roadmap's source block.
