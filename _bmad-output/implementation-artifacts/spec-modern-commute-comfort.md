# Spec: Modern commute comfort (#502): resolved as legibility; behavior moves to #436

Status: RESOLVED 2026-07-21 as a legibility-only change, by a second party (game, dev,
design, and player) after implementation surfaced two blockers. The behavioral
refinement the party originally imagined is redirected to #436.

## What #502 set out to do

Give Modern a soft counterpart to Classic's hard walk-refusal: a tenant whose commute is
rough (long elevator waits, or a long stair climb Modern's uncapped stairs allow) should
grumble and become less satisfied over time, never be blocked from moving in. Reuse the #514 per-origin
commute accumulator; add a gentle Modern satisfaction penalty and a readout.

## Why it did not ship as a satisfaction drain

Two findings during implementation, both verified:

1. **The wait-based signal breaks determinism.** `Crowd.commuteStressAt` is an EMA over
   crowd finish-events, whose spawn/finish stream is tick-cadence dependent. Feeding it
   into persisted `satisfaction` makes headless (coarse ticks) and browser (fine ticks)
   diverge, exactly the reason `crowd.frustration` is deliberately kept out of
   satisfaction. Proven: a Modern tower's office satisfactions came out `[…0.98, 0.87]`
   at `tick(60)` vs `[…0.66, 0.59]` at `tick(1)` over the same game-time; Classic
   (untouched) was identical at both. So the crowd accumulator must stay read-only.

2. **The only deterministic survivor is redundant.** The deterministic substitute for
   "rough commute" is the forced stair-climb length to a floor (pure routing,
   cadence-independent). But a long forced climb to a floor IS being far from the nearest
   lobby, which the existing `lobbyDistanceDrain` (`lobbyFar`) already penalizes in both
   modes, and elevator-WAIT discomfort is already the `congestion` drain's job. A parallel
   commute drain is overlapping math, not new feel: in testing it always resolved to the
   sharper `lobbyFar` gripe.

## Party ruling (2026-07-21)

- **Cut the parallel commute drain.** `congestion` owns wait cost; `lobbyFar` owns
  height/climb cost. A second erosion term is redundant.
- **#502 ships legibility only:** a Classic vs Modern compare bullet ("Longer climbs")
  documenting the real divergence (Modern lets people climb any number of flights to
  reach a floor; Classic refuses a long climb; a floor left on a long climb with no
  elevator sits far from a lobby and wears its tenants down, so run an elevator to it).
  This lands the walk-budget comparison line that was deferred here from #384/#503/#509.
- **The behavioral refinement moves to #436** ("re-key the lobby-distance pressure on
  elevator reach and transfer depth, not raw floor count"). That is the honest home for
  making the existing drain's advice correct on a stair-only floor ("run an elevator
  here", not "add a sky lobby"), as one coherent drain rather than a redundant second
  one. Its own spec + party + tuning.

## What shipped in this change

- `src/ui/templates/compare.ts`: the "Longer climbs" divergence bullet.
- `src/ui/templates/compare.test.ts`, `src/ui/templates/help.test.ts`: the drift guards
  (`DIVERGENCE_PHRASES`, and `RULE_TO_HELP[walkwayWillingnessApplies]` now maps to the
  bullet instead of `null`).
- `CHANGELOG.md` + `package.json` minor bump (a player reading the guide notices the new
  comparison line). No engine change, no satisfaction/routing change, no golden re-pin.

## Guardrail

Trivially satisfied: no new satisfaction coupling, so no determinism risk and no move-in
wall. The #514 accumulator stays read-only.

## Deferred to #436

- Re-key lobby-distance pressure on elevator reach / transfer depth so its advice is
  correct for a stair-only floor.
- Any per-Sim commute-stress fidelity (#514's own follow-up row) stays as it was.
