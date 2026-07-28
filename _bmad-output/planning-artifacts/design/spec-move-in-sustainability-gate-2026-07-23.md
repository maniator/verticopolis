# Spec: move-in sustainability gate (stop the eviction churn loop)

- **Date:** 2026-07-23
- **Lane:** GDS (gameplay/economy), owner-directed (bug report + "spec it first")
- **Status:** DESIGN, awaiting owner sign-off before implementation.
- **Trigger:** owner report on a Modern save (`pointed_1.vctower`, app 1.99.0):
  "infinite money glitch where a condo (or office) moves out because of bad
  satisfaction, but then it sells again, and the satisfaction resets... shouldn't
  it stay bad and no one move back in?!"

## 1. What is actually happening (diagnosis)

Reproduced against the owner's save (Modern, 3 stars, 97 condos). Over 90 in-game
days the condos ledger recorded **88 sales and 90 buy-backs**: the condos are
churning, each selling and being bought back roughly once in 90 days.

**It is not an infinite-money faucet.** Every sell/buy-back cycle nets **exactly
zero**: the sale income is `householdPrice(asking, residents)` (churn.ts moveIn)
and the buy-back is `householdPrice(u.rent = asking, residents)` (churn.ts
vacate) with the same inputs, so they cancel. The +$330k residual measured over
one 90-day window is a windowing artifact (condos sold near the end of the window
that had not yet been bought back), not a real gain. The player-visible symptom
is the **churn loop**: repeated "Condominium sold" / "owner left, bought it back"
toasts, population and `moveInsToday.condos` flapping, which reads like money
pouring in.

**Root cause.** `attemptMoveIns` (churn.ts) decides move-in from price demand and
reachability only; it never asks whether the spot can hold a tenant. So a unit
whose location erodes a tenant below the rescind bar (`VACATE_RESCIND = 0.4`)
sells, resets satisfaction to 1 on move-in, erodes back out, is bought back, and
immediately re-sells. Forever.

**The loop has several triggers (not just noise).** Any Modern erosion source
whose per-tick drain outpaces the +0.05/hr served recovery drives it:

- horizontal office/commercial **noise** (`noiseAfflicted`, NOISE_EROSION 0.07 /
  CONDO_NOISE_EROSION 0.054),
- **nightclub** vertical negative halo (NIGHTCLUB penalty up to 0.08, by floor
  distance; a condo directly above a nightclub is `noiseAfflicted === false` yet
  still churns),
- **very-far-from-lobby** erosion (`lobbyDistanceDrain`),
- **unmet local demand** erosion at deep coverage (`unmetDemandDrain`),
- **transport-too-far** (`farWalk`), which erodes in BOTH modes.

A first attempt that gated only on `noiseAfflicted` was adversarially reviewed
(`/gds-code-review`, Blind Hunter + Edge Case Hunter) and correctly rejected: it
patched one trigger of a multi-trigger loop, and it also OVER-blocked (a noisy
spot next to a fitness club / daycare would stabilize at the 0.6 cap and stay,
but a blanket `noiseAfflicted` gate refuses to sell it at all).

## 2. Design intent (Samus)

A tenant should not move into a spot that will just erode them out. The gate must
key on the **outcome** ("would a fresh tenant here settle below the rescind
bar?"), not on any single cause, so it catches every trigger and never blocks a
spot that would actually stabilize. When the player fixes the cause (removes the
noise source, adds a sky lobby, etc.) the spot should attract tenants again.

Consequence, accepted (corrected by the economist seat, 2026-07-23): an
already-occupied unit in a bad spot still erodes, gives notice, and is bought
back ONCE (the existing "neglect hurts" buy-back). It then stays empty until the
cause is fixed, and while empty a condo keeps paying **condo hold-tax +
operating overhead** every month (`EconomySystem.payMaintenance`, gated on
`!everOccupied` and `operational`), and an empty office keeps paying overhead.
So the true cost is NOT a bounded one-time hit: it is a one-time buy-back plus an
**ongoing carrying cost on dead inventory** until the defect is cleared or the
unit is bulldozed. That is honest economics (idle inventory has a holding cost),
and it makes **bulldoze the loss-cut**: razing the unit zeroes both sinks. The
inspector must telegraph this (see the legibility requirement below) so the
carrying cost reads as a player-controllable "fix it or raze it," not an
unexplained drain.

## 3. Two implementation options

### Option A: shared sustainability predicate (auto-heal)

Extract the per-unit satisfaction step out of `updateSatisfaction` into a pure
helper (given a unit + its current satisfaction + the once-per-pass context of
halo floor sets and the demand map, return the next satisfaction). Then:

- `updateSatisfaction` builds the context once and calls the helper per unit
  (behavior-preserving; the golden hashes must NOT move for this extraction, and
  that unchanged-hash is the proof it is a pure move).
- New `wouldEvictFreshTenant(sim, u, ctx)`: iterate the helper from a fresh
  tenant's starting satisfaction for ~2 in-game days and return whether it lands
  below `VACATE_RESCIND`.
- `attemptMoveIns` builds the context once and gates condo/office move-in on it.

Pros: correct by construction (single source of truth, no drift), auto-heals the
moment the cause clears, never over-blocks a would-stabilize spot. Cons: a
high-blast-radius refactor of the most carefully-tuned, byte-stable function in
the engine. De-risk with the golden-hash-unchanged check on the extraction, a
differential test (predicate verdict vs actually running the sim), and a re-run
of the review loop.

### Option B: off-market on dissatisfaction eviction (safer)

When a lease tenant (condo/office) is evicted for a dissatisfaction cause (not a
relocation life event), the unit does not auto-re-list; it goes to an off-market
state that the player re-lists once they have addressed the problem.

Pros: zero changes to the satisfaction math (no regression risk to the tuned
core), cause-agnostic (catches every trigger because it fires on the eviction
outcome), never over-blocks (a would-stabilize spot never evicts). Cons: a UX
change (the player re-lists a unit after fixing its cause rather than it auto-
refilling); needs a state that is NOT the existing player-set "No Rate" (which
carries TDT class-4 export meaning), so a new "vacated, awaiting re-list" state,
plus its inspector affordance and a batch "re-list all" convenience.

**Recommendation:** Option A is the better game feel (auto-heal, no busywork) if
we accept the core-refactor risk; Option B is the safe, robust fallback. Owner to
choose in review.

## 4. Mode scoping and Classic parity (decision needed)

Noise, nightclub, lobby-far, and unmet-demand erosion are Modern-only (Classic
caps but never erodes for them; `noiseErosionScale` etc. return 0). But
`farWalk` (transport-too-far) erodes in BOTH modes, so a Classic office far from
any shaft can churn the same way today.

- **Modern-only gate:** Classic stays byte-identical (Classic golden hash
  unchanged); the rare Classic farWalk churn remains, tracked as a follow-up.
- **Both-modes gate:** more faithful (1994 does not endlessly re-lease an office
  in a dead-transport spot), but re-pins the Classic golden hash and needs a
  parity call.

Recommendation: ship Modern-only first (the reported bug and every reviewer case
is Modern), keep Classic byte-stable, and file the Classic farWalk churn as a
separate parity row.

## 5. The buy-back interaction (decision needed)

When an occupied unit erodes out and is bought back, and it then can no longer
re-sell (gated), the buy-back is a real one-time cost. Options: keep it (the
departing owner cashes out; "neglect hurts", consistent with today), or waive it
when the unit will not re-list (softer). Recommendation: keep it; note that the
`rollCondoRelocations` toast copy ("bought it back to re-sell") should be
softened for the case where re-sale is now gated.

## 6. Test plan

- Regression (integration): a Modern tower with an empty condo/office in a
  spot that erodes a fresh tenant out (one fixture per trigger: horizontal
  noise, nightclub-above, very-far-from-lobby, transport-far) stays empty and
  never fires the one-time sale; a clean spot fills; a noisy spot with a strong
  offsetting amenity (fitness/daycare) that would stabilize STILL fills (the
  over-block regression the first attempt failed).
- Differential (Option A): the predicate verdict matches actually running the
  sim (a seeded tenant at a "would-evict" spot does evict; at a "sustainable"
  spot does not).
- Golden master: Classic hash UNCHANGED (Modern-only scope) or re-pinned with
  intent (both-modes); Modern re-pins (the fixture's noisy offices stop
  leasing). Option A's extraction must leave BOTH hashes unchanged as its own
  step before the gate lands.
- `/gds-code-review` loop (Copilot/Codex down until Aug 1): run the skill, fix
  every patch finding, re-run until a clean pass; version bump; four gates green.

## 7. Party ruling (2026-07-23, UNANIMOUS)

Party: the Landlord (player-operator), the Economist, Samus Shepard (design),
Cloud Dragonborn (architecture), Link Freeman (dev). Each grounded in the code
and independently reached the same three decisions.

1. **Option A (shared sustainability predicate, auto-heal).** Decisive reasons:
   (a) 1994 precedent, a bad spot stayed vacant until you fixed it, then filled
   on its own; the original had no "re-list" button (design); (b) B always pays
   one guaranteed churn cycle per unit (it fires on the eviction OUTCOME, so a
   fresh unit fills, erodes, and evicts once before parking, a SECOND buy-back on
   a life-event relocation) while A gates the move-in itself and never seats a
   doomed tenant (economist, design); (c) A's scary part, extracting the tuned
   satisfaction step, is self-verifying against two golden hashes, so its risk is
   mechanically provable to zero, whereas B trades that for a wide, oracle-less
   save/TDT/undo/UI surface that a sole `/gds-code-review` loop (Copilot/Codex
   down to Aug 1) is worst at clearing (architecture, dev); (d) A auto-heals with
   nothing new persisted; B needs a new serialized Unit state that ripples across
   the persistence seam and cannot reuse `noRate` (Modern forbids it; it carries
   TDT class-4 meaning). B stays on the shelf as the fallback only if the owner
   rejects touching the tuned core at all.

2. **Both modes (owner override, 2026-07-23).** The party first proposed
   Modern-only sequencing, but the owner pushed back: Classic runs the SAME
   nonsensical churn today, through the `farWalk` door (an office too far from
   transport erodes in BOTH modes, so it re-leases and re-evicts forever;
   Classic condos escape it only because noise/lobby/unmet merely CAP in Classic
   and condos never relocate). That churn is an emergent artifact of our own
   move-in code (instant re-lease + satisfaction reset to 1), not a modeled 1994
   mechanic, so gating one mode and leaving the identical bug in the other is
   inconsistent. Decision: gate BOTH modes with the same predicate and seam;
   Classic simply flips `gatesUnsustainableMoveIns()` on and re-pins the Classic
   golden master WITH INTENT.

   **Canon grounding for the Classic re-pin (PRIMARY SOURCE, verified
   2026-07-23).** The official 1994 manual (read directly off the disc, Italian
   tutorial, ~p.9) settles it: an office with poor access "rimangono vuoti" (they
   REMAIN EMPTY) because the tenants refuse to use the emergency stairs; add
   decent access and they fill. So 1994 models livability AT MOVE-IN, a bad-access
   office stays vacant until fixed and does NOT churn. Our current behavior
   (fill the bad spot, evict, re-fill, forever) is therefore a DIVERGENCE from
   1994 in BOTH modes, and the sustainability gate (a spot that cannot hold a
   tenant stays empty until fixed) is exactly the manual's described behavior.
   The Classic re-pin carries that intent: it restores fidelity, matching the
   manual, not inventing a new mechanic. (A Wine-harness behavioral confirmation
   is available but not required: the manual is the primary source and answers
   the question directly, more cleanly than the synthetic-save harness could
   given its known zero-live-population limits.)

3. **Keep the buy-back; fix the copy.** It is load-bearing for the condo money
   model, it is what makes a condo sale non-repeatable; waiving it reintroduces
   the faucet (keep the banked sale, walk from the repurchase free, re-sell later
   for a second full price). Fairness comes from telegraphing, which already
   exists (the `vacating` grace period + attributed gripe), not from waiving.
   The `vacate` and `rollCondoRelocations` toast copy that promises a re-sell
   ("bought it back to re-sell") MUST change to the truth ("held as empty
   inventory; will not re-list until you fix the cause here").

### 7a. Make-or-break requirement: legibility of a gated-empty unit

Both the Landlord and Samus rule this the single thing that decides whether A
FEELS good or MYSTERIOUS, and make it NON-OPTIONAL. Today the "Main gripe" line
that names noise / unmet-demand is gated on `isPresent(u)`, so an EMPTY unit gets
no explanation for those causes (transport-far and lobby-far already self-explain
on empty units; noise and unmet-demand do NOT). So the feature MUST add an
empty-unit "won't lease here" diagnostic, the mirror of the gripe line, evaluated
against a SIMULATED FRESH TENANT (not the unit's meaningless reset satisfaction):
e.g. "Won't lease: a noisy neighbor nearby would drive tenants out. Remove the
source, or move the unit." Reuse `dominantGripe`/`gripeLineText` seeded from the
fresh-tenant verdict. Plus the one-time eviction toast, de-lied, is the push cue
that something WAS wrong. With both cues, A delivers the "something was wrong"
signal with zero busywork, which is the whole case for A over B.

### 7.3. Attempt log: the binary Classic shortcut was tried and REJECTED (2026-07-23)

To deliver Classic parity fast, a binary gate was tried: skip an empty office
move-in when it is `farWalk` (nearestTransportDistance > TRANSPORT_FAR_TILES),
Classic-only via `gatesUnsustainableMoveIns()`. It reproduced the Classic churn
and passed its own fixture, but `/gds-code-review` (Blind Hunter + Edge Case
Hunter) and the test suite rejected it as INCOMPLETE, INACCURATE, and DISRUPTIVE:

- **Incomplete (Edge Case Hunter, severe):** it covers only `farWalk`, but
  `lobbyFar` ALSO evicts in Classic (`LOBBY_VERY_FAR_EROSION 0.055 > 0.05`,
  proven by `walkingPenalties.integration.test.ts`: "erodes a very-far office to
  a notice, attributed to lobbyFar (Classic)"). A far-from-lobby office/condo
  still churns. (Noise and unmet-demand ARE genuinely Classic-inert, so deferring
  those is correct; lobby is the leak.)
- **Inaccurate (Blind Hunter):** cheap rent OFFSETS far-walk in the satisfaction
  model (a Very-Low office nets positive: 0.05 served + ~0.056 rent bonus > 0.07
  erosion), so a binary distance gate over-blocks an office a real tenant would
  hold.
- **Disruptive:** it broke two integration fixtures (`faqComplete`,
  `reviewFixes`) that build wide office floors with one shaft, and pushed
  `satisfaction.ts` over the 500-line ceiling.

Conclusion: an accurate Classic gate must cover `farWalk` AND `lobbyFar`, netted
against rent and recovery, which IS the satisfaction-aware predicate. There is no
correct binary shortcut. **Classic and Modern converge on the SAME shared
predicate (Option A).** So Classic parity is delivered by the same extraction +
`wouldEvictFreshTenant` work as Modern, gated per mode (each cause already
mode-scoped through the rule-set seams), not as a separate quick fix. The
per-cause Classic-vs-Modern activity: `farWalk` both modes; `lobbyFar` both
modes; noise/nightclub/unmet Modern-only.

## 8. Implementation contract (Cloud + Link)

Two-commit discipline, `/gds-code-review` loop each, four gates green, version
bump (minor: player-noticeable Modern economy change).

- **Commit 1, pure extraction (behavior-preserving):** lift the once-per-pass
  context (congestion source, `servedFloors`, the four halo floor-sets built with
  their exact `isTenanted`/`isOperational` gating, the lazy `computeDemandMap`)
  into a `ctx`, and move the per-unit satisfaction step into a pure
  `satisfactionStep(sim, u, current, ctx) -> { next, farWalk, noisy, lobbyFar,
  unmetDemand }`. It returns the cause flags because the notice/vacate/rescind
  state machine downstream consumes them; that stateful block STAYS in
  `updateSatisfaction`. Thread the running satisfaction through a LOCAL and write
  back once (the current code re-reads `u.satisfaction` mid-sequence across ~7
  clamped steps; any lingering mid-sequence read leaks and flips the hash). The
  helper draws no RNG. **Acceptance: BOTH `PINNED_STATE_HASH` (Classic) and
  `PINNED_MODERN_STATE_HASH` (Modern) unchanged** (the oracle that proves the
  move is pure).
- **Commit 2, the gate:**
  - `wouldEvictFreshTenant(sim, u, ctx)`: seat a fresh tenant and iterate
    `satisfactionStep` under a frozen ctx over the notice/erosion timescale
    (~2 in-game days), early-exit the moment satisfaction crosses below
    `VACATE_RESCIND` (block) or stabilizes at/above it (allow). Draws no RNG.
  - **Simulate-time assumptions (critical, this is where the over-block hides):**
    model the tenant the SALE would produce, mean household `CLASSIC_HOUSEHOLD`
    (= 3, deterministic, never draw), and the SOLD-condo erosion rate
    (`CONDO_NOISE_EROSION`), with the daycare halo scaled by that mean, NOT the
    steeper unsold `NOISE_EROSION` with `residents ?? 0` (which biases pessimistic
    and re-introduces the exact over-block the first attempt was rejected for).
  - The gate applies in BOTH modes (owner override §7.2), so no mode-scoping flag
    is needed: the predicate is already mode-correct because every erosion cause
    flows through `sim.rules` (in Classic only `farWalk` and congestion can fire;
    noise/lobby/unmet return 0). In `attemptMoveIns`: build ctx once per pass
    (lazily, only when a condo/office reaches the gate), then
    `if ((u.kind === "condo" || u.kind === "office") &&
    wouldEvictFreshTenant(sim, u, ctx)) continue;` placed AFTER `demandFactor` and
    BEFORE the `sim.rng.chance` draw (same slot as the `noRate` skip). Do NOT
    reintroduce a `noiseErosionScale() > 0` proxy; the mode difference lives in
    the predicate's rule-set reads, not the call-site.
  - Empty-unit "won't lease: <cause>" inspector line (§7a) + de-lied eviction
    toast copy.
  - Re-pin BOTH `PINNED_STATE_HASH` (Classic) and `PINNED_MODERN_STATE_HASH`
    (Modern) with intent. Classic's intent: matches the 1994 manual (bad-access
    offices "rimangono vuoti", §7.2), a fidelity fix. Modern's intent: the fixture
    already seats a noisy office one tile from a fast food, so it re-pins
    regardless (expected). The "differs from Classic" golden assertion must still
    hold (the two fixtures diverge on the Modern-only sinks).

- **Determinism:** the predicate is RNG-free and must leave `serialize()` /
  `noiseMemoRev` unchanged; pin that in the differential test.
- **Perf:** ctx once per hourly pass (not per frame); the predicate early-exits
  in 1-2 iterations. No new full-collection scan nested in a per-unit loop.

## 9. Test plan (Link)

- **Unit, `satisfactionStep`:** table tests per sink (unserved, congestion,
  over-market rent, each of the four halos, farWalk, noise x mode scale, lobby,
  unmet, steepest-cause-wins `max`, tightest-cap `min`) locking the helper to the
  old inline math.
- **Unit, `wouldEvictFreshTenant`:** clean -> false; each trigger (horizontal
  noise, nightclub-above, very-far-from-lobby, transport-far) -> true;
  **noisy-but-offset-by-fitness/daycare -> false** (the over-block guard);
  a spot landing exactly at `VACATE_RESCIND` over the horizon (boundary).
- **Integration, golden master:** extraction commit leaves BOTH hashes unchanged
  (the pure-move oracle); gate commit re-pins BOTH with intent (Classic = the
  manual-confirmed fidelity fix, Modern = the noisy-office fixture); the
  "Modern differs from Classic" assertion still holds.
- **Integration, Classic parity:** a Classic office stranded far from transport
  stays empty (never fills), matching the manual ("rimangono vuoti"); add
  transport and it fills. This is the canon behavior the both-modes gate restores.
- **Integration, regression (one fixture per trigger):** Modern empty condo/
  office in an eroding spot stays empty, fires no sale/move-in toast,
  `moveInsToday` stays 0; a clean spot fills; the noisy+offsetting-amenity spot
  STILL fills.
- **Integration, occupied path:** an occupied bad-spot unit erodes -> notice ->
  exactly ONE buy-back -> then stays empty (never re-sells).
- **Differential (A's signature test, mirroring `noiseMemo.integration`):**
  `wouldEvictFreshTenant(...) === (seat a real tenant, run ~2 days, did it
  evict?)` across every trigger and the offset-stabilize case; assert the
  predicate draws no RNG and leaves `serialize()`/`noiseMemoRev` unchanged.

## 10. Scope notes the party requires stated (Samus)

- **Hotels are out of scope on purpose.** A room re-books nightly; a bad room
  just underperforms, which is canon. Do NOT gate hotel bookings.
- **Fitness club / clinic are out of scope because placement erosion never
  touches them** (they erode only on over-market rent, which is player-set and
  self-healing). So condo + office is the complete placement-churn scope; state
  it to pre-empt "what about the fitness club?".
- **Relocation exposes latent doom:** a happy Modern condo can relocate
  (life event), be bought back, and if the spot has since become doomed, never
  re-sell. Correct under the gate, but the inspector reason (§7a) must cover it
  so "my happy condo left and now the unit is dead" is legible.
- **Star-census sits lower, honestly.** Permanent vacancies mean a tower propped
  across a star threshold by churn-cycled units can fall short; and a smaller
  connected census slightly softens retail demand-pool income. Both are honest.
- **Perception cure:** the +$330k windowing residual in the condos ledger must
  read honestly after the fix (the visible cure the player feels is the toast
  flapping stopping); verify the stats/ledger do not still imply a live glitch.

## 11. Follow-up backlog rows (mirror to GH issues)

- `move-in-gate-horizon-calibration`: the ~2-day predicate horizon is a magic
  number; a spot where erosion ~= recovery can land just above the bar at 2 days
  and drift below over 5 (marginal-spot fill/erode/evict/gate flap). Tie the
  horizon to the notice + erosion timescale and playtest; accept marginal flap as
  a documented v1 limitation.

(The Classic `farWalk` fix is no longer a follow-up: per §7.2 it is folded into
the main both-modes change, grounded by the manual.)
