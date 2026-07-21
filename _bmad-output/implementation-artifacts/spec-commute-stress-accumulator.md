# Spec: per-origin commute-stress accumulator (#514, read-only substrate)

Status: ready for implementation. Party-ratified 2026-07-20 (game/dev/design/player
roundtable). This is the **read-only** first cut the party cleared to build without a
tuning pass; coupling the signal into satisfaction/attrition is the separate,
owner-gated #502 track and is explicitly out of scope here.

## Intent

The 1994 original scores tenant happiness partly from elevator **wait time**
accumulated per Sim across a commute (`Quality = 300 - total stress / tenants`).
Our engine models the cost as a tower-wide `crowd.frustration` (a per-frame EMA,
HUD-only) plus per-floor `congestion` feeding satisfaction. That aggregate proxy
under-stresses one real case: a lone far tenant whose multi-transfer commute is slow
while the rest of the tower's elevators sit idle (congestion ~0, frustration ~0).

This spec adds the missing **per-origin measurement**: accumulate each commuter's
whole-trip landing wait and roll it up by origin. It changes **no behavior** and
feeds nothing into satisfaction yet. It exists so #502 (Modern's legible
commute-comfort readout) and any future per-Sim fidelity work read a real number
instead of re-deriving one.

## Granularity decision (per-origin-FLOOR, not per-unit)

The party framing said "per-origin-unit." The commuter spawn model does not support
that cheaply, and the read-only guardrail forbids the change that would:

- Plain commuter trips are spawned floor-to-floor: `spawnTrips` builds
  `trip(from, to) = add(crowd, tower, from, to)` where `from` is an rng-picked
  **floor** (`crowd.rng.pick(homes)`, `crowd.rng.pick(leasedOffices)`), never a unit.
  `Person.floors[0]` is the origin floor; there is no origin unit id.
- Only meal/venue round-trippers carry `Person.originUnitId` (set in
  `spawnMealOutbound`). Tagging a unit id onto the plain commuter path means picking
  a specific unit on the origin floor, an extra rng draw that would shift the shared
  crowd rng stream and re-baseline every golden master. That is a behavior change,
  which this spec forbids.

So v1 keys the accumulator by **origin floor** (the immutable `originFloor` stamped
at spawn, which equals `floors[0]` for a one-way trip), the granularity the sim
actually spawns at. Per-unit attribution, if #502 ever needs it, is a spawn-model
change tracked separately, not smuggled in here. Meal round-trippers already carry a
unit id, so a later refinement can subdivide a floor's stress without disturbing this
substrate.

## Boundaries and constraints

- **Read-only.** No write to `satisfaction`, `vacating`, churn, gripe copy, or any
  routing decision. The move-in/move-out seam (`satisfaction.ts`, `churn.ts`) is
  untouched. If any of those files change, the spec is being violated.
- **Not persisted.** Like `crowd.frustration`, the accumulator is an in-memory
  rolling stat. No `Simulation.serialize`/`deserialize` field, no TDT byte. It
  rebuilds as the sim runs after a load. This keeps it out of determinism-sensitive
  persisted state and out of the save format (no version bump for save/compat).
- **Deterministic.** Updated only on cadence-stable events (each boarding and each
  `finish`), pure arithmetic, no rng and no wall-clock/frame-rate input. Same seed →
  same finish sequence → same accumulator. (Contrast `crowd.frustration`, whose
  per-frame EMA is exactly why it is kept out of persisted state.)
- **No Big-O regression on the hot path.** The added work is O(1) per boarding and
  O(1) per `finish`, both events already visited by the existing per-person loop and
  the existing despawn path. No new full pass over `crowd.people`.
- **Both modes.** This is parity fidelity, not a Modern extra; Classic and Modern run
  it identically. No `GameRules` method is added (the mode split lives in #502's
  coupling, which is deferred).
- **src/engine stays DOM-free; American English; no em-dashes.** No player-facing
  copy ships in this PR (the readout is #502), so no changelog line is strictly owed,
  but bump `package.json` if the accumulator surfaces anywhere a player can see it
  (it does not in v1).

## Signal definition

- Per person, accumulate **landing wait across the whole trip**. `Person.wait` is
  per-call and zeroed on boarding (`motion.ts` clears it so a slow pickup does not
  keep counting through the ride). A new field `Person.tripWait` sums each served
  call's wait just before that reset, so a multi-leg commute contributes the sum of
  every leg's wait, not only the last leg's.
- At `finish`, fold `tripWait + wait` (the trailing `wait` catches a give-up while
  still queued) into the origin floor's rolling mean. **Staff are excluded** (they
  route the staff network and never count toward tenant stress, matching
  `crowd.frustration`).
- Key the fold on an **immutable `Person.originFloor`** stamped at spawn, NOT
  `floors[0]`. A round-tripper's `floors[0]` is rewritten to the venue floor by
  `transitionToReturn`, so keying on it would misattribute the tenant's commute to
  the venue they visited. `tripWait` is deliberately not reset across the dwell, so a
  round trip's outbound and return waits fold as one sample under the true origin.
- Storage: `Crowd.commuteWaitByFloor: Map<floor, seconds>`, an EMA in **seconds**
  (not pre-normalized to 0..1), so consumers can read the real wait and normalize
  against `STRESS_WAIT` themselves. Smoothing constant `COMMUTE_STRESS_ALPHA` is a
  readout-smoothing knob only; it has no behavioral effect.

## I-O and edge-case matrix

| Case | Input | Expected accumulator effect |
| --- | --- | --- |
| Easy commute | non-staff, boards immediately, `tripWait=0` | origin-floor EMA nudges toward 0 (an easy commute lowers stress) |
| Slow single ride | one leg, waited 40s | `tripWait=40`; EMA toward 40 for `originFloor` |
| Multi-transfer | 3 legs, waits 20+15+30 | `tripWait=65` (sum of all legs), folded once at finish |
| Same-floor walk | no rides (`shafts=[]`) | `tripWait=0`, folds 0; correct (no wait) |
| Give up while queued | despawns from `waiting`, `wait=50`, `tripWait=10` | folds `10+50=60` |
| Round-tripper return | `originFloor=50`, `floors[0]` rewritten to venue `3` | folds under **50** (true origin), not `3` |
| Staff dispatch | `staff=true` | **no fold** (excluded) |
| Outside/metro arrival | origin = platform/basement floor | folds under that floor (a trip originating there); acceptable for v1 |
| Bulldozed origin floor | floor gone by finish | EMA still keyed by the numeric floor; harmless (a stat, not a unit ref) |

## Code map

- `src/engine/crowd/person.ts`: add `tripWait: number` (cumulative per-trip landing
  wait; distinct from per-call `wait`) and `originFloor: number` (immutable spawn
  origin) to the `Person` interface. Add `COMMUTE_STRESS_ALPHA` beside
  `STRESS_WAIT`/`GIVE_UP`.
- `src/engine/crowd/trips.ts`: `makePerson` Person literal: initialize `tripWait: 0`
  and `originFloor: from`.
- `src/engine/crowd/motion.ts`:
  - boarding reset (`p.wait = 0` after seating a rider): prepend `p.tripWait += p.wait;`.
  - `transitionToReturn`: note that `tripWait` is deliberately NOT reset (unlike
    `wait`/`age`/`linger`), so a round trip folds as one sample.
  - `finish(crowd, p, tower)`: for `!p.staff`, call
    `crowd.recordCommute(p.originFloor, p.tripWait + p.wait)`.
- `src/engine/Crowd.ts`: add `commuteWaitByFloor = new Map<number, number>()`; clear
  it in `reset()`; add `recordCommute(originFloor, seconds)` (the EMA update),
  `commuteStressAt(floor): number` (read-only getter, 0 when unseen), and a
  `commuteStressByFloor: ReadonlyMap<number, number>` getter for enumeration.
- `src/engine/Simulation.ts`: **no change.** A `sim.commuteStressAt` passthrough
  mirroring `crowdStress` was considered, but the file sits exactly at the 500-line
  size ratchet and the ongoing split effort (#365/#369) is shrinking it, not growing
  it. #502 reads the accumulator via the public `sim.crowd.commuteStressAt(floor)`;
  a passthrough can land when Simulation.ts is split.

## Tasks and acceptance

1. Add `tripWait` + `originFloor` + init; boarding fold; finish fold (keyed on
   `originFloor`); `Crowd` accumulator + read-only getters. No `Simulation` change
   (read via `sim.crowd.commuteStressAt`; see the Code map).
2. Update the hand-built `Person` literals and test builders
   (`crowd.integration.test.ts`, `motion.test.ts`, `queueView.test.ts`,
   `venueTrips.test.ts`, `metroVisitOrigin.test.ts`) with `tripWait: 0` and `originFloor`.
3. New test `src/tests/integration/commuteStress.integration.test.ts`:
   - a single slow-wait trip raises `sim.crowd.commuteStressAt(originFloor)` above 0;
   - a multi-leg trip folds the **sum** of leg waits (not just the last leg);
   - an easy (no-wait) commute keeps/pulls the origin floor toward 0;
   - staff dispatches do **not** move any floor's value;
   - **determinism**: two runs from the same seed produce identical
     `commuteStressByFloor` snapshots;
   - **read-only**: a run with slow commutes leaves `updateSatisfaction` outcomes
     (unit `satisfaction`, `vacating`) byte-identical to a control with the
     accumulator present but unread (assert satisfaction is unaffected by wait alone,
     still driven by congestion).
4. Golden masters (`parity.integration.test.ts`, route/crowd goldens) unchanged.

## Verification

- `npm run typecheck && npm run lint && npm test && npm run build` all green.
- **Benchmark first (party guardrail):** run `RUN_HOUR_BENCH=1 npx vitest run
  src/tests/integration/hourCost.bench.integration.test.ts` on `main` and on the
  branch; the per-hour cost must not regress (the added work is O(1) on
  already-iterated events).
- `/gds-code-review` (gameplay/engine change): focus on determinism, the read-only
  boundary (nothing in `satisfaction.ts`/`churn.ts`/`gripe.ts` changed), the
  boarding/finish fold correctness (whole-trip sum, give-up residual, staff
  exclusion), and no golden-master or save-format drift.

## Deferred / out of scope (recorded, not built here)

- Per-**unit** attribution (needs a spawn-model change; #502-adjacent).
- Coupling the signal into Modern satisfaction (gentle nudge, grumble + attrition,
  never a wall): **#502**, owner-tuned curve.
- Any Classic behavior change: none; Classic already hard-refuses over-long walks and
  routes uncapped otherwise.
