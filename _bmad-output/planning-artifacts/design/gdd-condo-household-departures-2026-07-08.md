---
title: "GDD: Household-aware condo departures (Modern)"
game: Verticopolis (browser SimTower clone)
author: Samus Shepard (Game Designer), with Cloud Dragonborn (architect) and the economy voice
date: 2026-07-08
status: Ratified (party 2026-07-08, unanimous). Ready to build.
scope: A Modern-only condo mechanic. A sold condo's household can relocate for
  life reasons (a job move, an upsize or downsize) independent of how well the
  tower serves it, so Modern condos turn over instead of being perfectly sticky.
  Classic condos stay 1994-sticky (they only ever leave through the existing
  neglect path). Tier-1 #3 of the Classic/Modern roadmap; the cheap net-new
  Modern feature that reuses existing machinery.
grounds:
  - src/engine/gameRules.ts (the mode seam; sellCondo/churnMultiplier already here)
  - src/engine/Simulation.ts (vacate/buy-back :1364, the vacating notice branch :1026, onDay/payMaintenance)
  - src/engine/types.ts (VacateReason, VACATE_REASON_TEXT, Unit.residents/vacateReason/vacateAt)
  - _bmad-output/party-mode/tenant-churn-party-findings-2026-07-03.md ("inform before you hurt")
  - Modern-mode roundtable (party memlog 2026-07-08): condo flight-risk was Modern shortlist #1
research:
  - The 1994 original had NO condo turnover: once sold, a condo owner stayed forever.
    So any departure mechanic is a Modern-only "what the original couldn't do."
---

# GDD: Household-aware condo departures (Modern)

> **Pillar this answers to:** *Modern = "what the original couldn't do."* The 1994
> game froze a condo the moment it sold. Modern already models a real household
> (2 to 5 people) behind each condo; this makes that household a living thing that
> can move on, so a mature Modern tower has gentle turnover instead of a wall of
> permanent owners. Classic keeps the faithful, sticky condo.

## 1. What it is

A sold **Modern** condo can lose its household to a **relocation**: a life event
(job move, the family outgrows the unit or downsizes) that is unrelated to how
well the tower serves them. It is rare, it is telegraphed, and a **bigger family
is a bigger flight risk** (more likely to relocate, and it cost more to place, so
the turnover costs more). Classic condos never relocate: they stay exactly as
1994 shipped them (sticky, leaving only through the existing neglect buy-back).

This is deliberately NOT the neglect path. Neglect (sustained low satisfaction)
already loses a condo owner through the existing `vacating` erosion. Relocation
fires on a **happy, well-served** condo too, so Modern condos churn a little even
when the player is doing everything right.

## 2. Why it is cheap (reuses existing machinery)

- **Household** already exists: `Unit.residents` (2 to 5, Modern only) and
  `householdPrice()` already scale a condo's price and buy-back by family size.
- **Departure** already exists: `vacate()` runs the full condo lifecycle (buy the
  unit back at `householdPrice`, clear `everOccupied`/`residents`, re-list it to
  sell fresh) and emits the toast.
- **The notice** already exists: the `vacating` state + `vacateAt` countdown +
  the inspector's "leaves in N" readout.
- **The mode seam** already exists: `GameRules`. Classic returns the neutral 0.

The net-new code is a monthly roll behind one new `GameRules` method, one new
`VacateReason`, and the copy for it.

## 3. Decisions (ratified: party 2026-07-08 + owner)

### 3a. Economic model: reuse the full-price buy-back (RATIFIED, unanimous)
Relocation runs the SAME path a neglect departure does: the player reclaims the
unit at `householdPrice(residents)` and re-lists it to sell fresh. It rides the
single shared `vacate()` spine with zero new economic semantics (relocation is a
sold `everOccupied` condo, so it lands in the existing buy-back branch untouched).

**It is a mild self-scaling SINK, not a wash (Winston's correction).** This is the
point, not a side effect:
- Relocation risk scales UP with family size (see 3c), so the departing pool skews
  toward 4s and 5s. You buy those back at `householdPrice(residents)`, and every
  re-sale rolls a fresh household that regresses toward the mean of 3. Net drain
  per cycle is roughly `asking/3 · (r_new − r_old)` (negative on average).
- While the bought-back unit sits unsold it also pays the Modern `condoMonthlyTaxRate`
  and `overheadPerLeasableUnitMonthly` until it re-sells (the vacancy gap bleeds).

That gentle drain is exactly the anti-trivialization the Modern economy layer
exists for. The rejected alternative (free turnover: no reclaim charge, the unit
just re-sells and books fresh income) is a success-scaling faucet that re-introduces
the late-game money trivialization the Modern sinks were added to cure, and it
would fork the one shared `vacate()` money leg on `reason`. Rejected.

Pre-existing, not introduced here (backlog notes, do NOT block): the buy-back reads
current `rentOf(u)` so a player who re-priced a sold unit can arbitrage it, and a
low-cash player can be pushed negative by the involuntary charge. Both already exist
on the ratified neglect buy-back path; relocation reuses it verbatim. Save/reload is
idempotent at the money leg (`vacate()` clears `everOccupied` before the next pass).

### 3b. Notice model: informational, non-rescindable advance notice (RATIFIED, owner)
The condo enters `vacating` with a 2-day (`VACATE_NOTICE_MINUTES`) window and the
toast/inspector say the family is relocating and when. Because a relocation is a
life event, the notice is **informational and non-rescindable**: fixing the tower
cannot keep them (unlike a neglect notice, which rescinds when satisfaction
recovers). The window is a heads-up to plan for the turnover, not a save-them
prompt. Honors the tenant-churn party's "inform before you hurt" ruling.

### 3c. Rate and household scaling
- Checked **once a month** (in `payMaintenance`), per sold Modern condo.
- Base monthly relocation chance ~**1.5%** at the mean household of 3 (so a condo
  turns over roughly once per ~5 in-game years on average: rare texture, not a
  treadmill), scaled by family size so a 5-person family is a clearly bigger
  flight risk than a 2-person one. Exact curve tuned against a playthrough; the
  constant lives in `econConfig` (a Modern key) so it is not a magic number.
- **Determinism:** the roll uses the seeded gameplay RNG and is placed so a
  **Classic** tower's RNG stream stays byte-identical to today (Classic returns 0
  and never rolls). Modern reproduces across save and reload.

## 4. Acceptance criteria

1. New `GameRules.condoRelocationChance(residents)`: Modern returns a per-month
   probability scaled by household size; Classic returns 0. Unit-tested both modes.
2. A sold Modern condo can enter a `relocation` `vacating` notice from the monthly
   roll even at full satisfaction; a Classic condo never does (deterministic seed).
3. The `relocation` notice does NOT rescind when satisfaction is high (life event),
   and counts down to the existing buy-back at `householdPrice` (bigger family
   costs more). The unit re-lists to sell fresh afterward.
4. Copy: a new `VACATE_REASON_TEXT["relocation"]` phrase; the toast and inspector
   read as a relocation (not a complaint). No em-dashes.
5. Classic RNG stream is unchanged (a Classic golden/telemetry check confirms no
   drift). Minor version bump (new Modern player-facing capability).

## 5. Out of scope (later, if wanted)
- Flavors (a) player-initiated evict/buy-out and (c) relocation-offer-to-another-empty-condo
  from the `condo-eviction` backlog row stay parked.
- A named-tenant "the Rivera family is moving" flourish waits on the named-tenant feature.
