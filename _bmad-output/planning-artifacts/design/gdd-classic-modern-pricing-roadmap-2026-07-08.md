---
title: "GDD: Classic/Modern pricing split + the Classic-parity-vs-Modern roadmap"
game: Verticopolis (browser SimTower clone)
author: Samus Shepard (Game Designer), with Cloud Dragonborn (architect) and the economy voice (design party, 2026-07-08)
date: 2026-07-08
status: In design
scope: Two linked outcomes. (1) A Classic/Modern PRICING split: Classic uses the
  1994 original's discrete 4-level rent dropdown (plus a "No Rate" state); Modern
  keeps today's continuous ranges. (2) A prioritized roadmap that sorts the
  outstanding Classic-parity gaps against the Modern-mode candidates, gating the
  non-canon economy sinks that currently leak into Classic. Design-only; each
  build lands as its own PR with the mandatory review skill + version bump.
grounds:
  - docs/canon/tdt-format.md (§4 rent-class byte 0-4; §7 retail; §9 finance 10+10)
  - src/engine/econConfig.ts (ECON.rent continuous bands; the sinks)
  - src/engine/gameRules.ts (CLASSIC_RULES / MODERN_RULES, the only mode seam)
  - src/engine/EconomySystem.ts (overheadPerLeasableUnitMonthly:430, condoMonthlyTaxRate:421)
  - src/engine/Simulation.ts (updateSatisfaction ratio math ~:961/1505; sellCondo :343/1630)
  - src/storage/tdtImport.ts (rentFromClass: importer already decodes the 0-4 byte)
  - _bmad-output/project-context.md (:46 stale "office noise does not evict")
research:
  - Canon rent values (WebSearch synthesis, single-source on the dollar tables; the
    archive.org manual was unfetchable and the hotel/condo tables are UNVERIFIED).
  - Classic-parity gap audit + Modern-sorting audit (agent passes, 2026-07-08).
---

# GDD: Classic/Modern pricing split + roadmap

> **Pillars this answers to:** *Canon is the default* (Classic is pixel-faithful
> 1994) and *Modern = "what the original couldn't do."* The core realization: our
> only mode seam, `makeRules()`, gates exactly one behavior (variant households),
> while three genuinely non-canon economy mechanics are applied to EVERY tower,
> quietly breaking Classic's faithfulness. This initiative widens the seam and
> puts each divergence on the correct side of it.

## 0. Canon rent model (research)

The 1994 original used ONE color-coded 4-level rent dropdown
(Blue/Green/Yellow/Red = Very Low / Low / Average / High = TDT rent-class byte
0-3; byte 4 = **No Rate**, the unset state) for **offices, condos, and all three
hotel room types**. Food / retail / cinema / party hall have **no** player rent
control (fixed per-facility income). Canon values:

| Facility | Very Low | Low | Average | High | Period | Confidence |
|---|---|---|---|---|---|---|
| Office | 2,000 | 5,000 | 10,000 | 15,000 | quarterly | **HARD** (matches us; 2k/10k corroborated) |
| Condo | 50,000 | 100,000 | 150,000 | 200,000 | one-time, locked after sale | MED (min 40k vs 50k unresolved) |
| Hotel single | 500 | 1,500 | 2,000 | 3,000 | nightly | **SOFT** (single-source, unverified) |
| Hotel double | 800 | 2,000 | 3,000 | 4,500 | nightly | **SOFT** |
| Hotel suite | 1,500 | 4,000 | 6,000 | 9,000 | nightly | **SOFT** |

> **Verification gap:** the hotel/condo dollar tables lean on ONE fan reference
> (Relentless Optimizer); the authoritative archive.org SimTower manual was
> unfetchable (403) and no second source corroborates them. Our hotel rates are
> ~10× BELOW these numbers today. This drives Decision 2.
>
> **CLOSED 2026-07-22 (spec-classic-economy-canon-cadence §2):** the GameFAQs
> FAQ lineage (BStuart, furdude2, Aristotle47) independently corroborates every
> table above, rung for rung, nightly hotel cadence included; confidence raised
> SOFT to MED (manual still unread). The same sweep verified the office cadence
> (the full lump each 3-day quarter), which retired the calendar-parity rescale
> for Classic, and surfaced the commercial daily-income gap now on the backlog.

## 1. Decision: pricing split shape (unanimous)

- Add **`GameRules.priceOptions(kind)`**. Classic returns a **discrete ladder**
  (the 4 canon rungs + a **No Rate** sentinel); Modern returns today's continuous
  `{min, default, max, step}` band. The editor renders a **dropdown** (Classic)
  or the existing **stepper/range** (Modern) off the *shape* of the return value.
- **`Unit.rent` stays a raw number.** Income / satisfaction / move-in math is
  untouched: it keys off `rentOf(u)` vs `cfg.default`. Note this *does* re-anchor
  the satisfaction/move-in curves onto the canon rungs in Classic; that is
  intended (Average = the neutral rung, exactly as in 1994).
- **No Rate** (level 4): a unit deliberately not on the rental market / charging
  nothing. Engine gets a real "no rate" state so the importer's class-4 units
  keep their intent instead of silently reverting to default.
- Batch pricing ("Set all …") becomes "set all to <level>" in Classic; keeps the
  range editor in Modern.

## 2. Decision: Classic uses the FULL canon values (user call, 2026-07-08)

The party had hedged hotels to "keep our values behind the canon structure"
because the dollar tables are single-source. The user overruled: **Classic uses
the researched canon values for every rentable kind**, on the reasoning that the
TDT-era documentation traces back to the real game, and *canon is the default*.

- **Office**: `2k / 5k / 10k / 15k` (quarterly).
- **Condo**: `50k / 100k / 150k / 200k` (one-time), and Classic MAY **sell below
  build cost** (canon texture: drop to clear a bad unit at a loss). Modern keeps
  the 80k break-even floor. (Min 40k-vs-50k unresolved; use 50k until verified.)
- **Hotel single / double / suite** (nightly): `500/1500/2000/3000`,
  `800/2000/3000/4500`, `1500/4000/6000/9000`.

**Provenance (record honestly in code):** the rent-class *structure* (byte 0-4)
is from the reverse-engineered TDT docs; the *dollar tables* are from the
Relentless Optimizer reference (single-source; the archive.org manual was
unfetchable). Comment each Classic rung table with that source and a
"verify against the manual if it becomes readable" note. Proceeding on the
user's call that these trace to the real game, not a primary-source verification.

**Balance implication (accepted):** canon hotel rates are ~10× our current
values, so Classic hotels earn far more. Stars gate on POPULATION, not income,
so this does not shortcut the star ladder; it gives the player more cash, which
*amplifies the original's late-game money trivialization* Classic already
inherits from Decision 3 (sinks off). That is faithful, not a regression. Modern
keeps our tuned continuous ranges, so Modern balance is unaffected. Flag for a
Classic playthrough sanity pass (does early-hotel cash change the 2★→3★ feel?),
but do not re-tune away from canon.

## 3. Decision: Classic goes pure; the economy sinks move to Modern

Three non-canon mechanics currently apply to ALL towers and are gated behind
Modern via new `GameRules` methods returning the neutral value for Classic:

| Mechanic | Today (all towers) | Classic | Modern |
|---|---|---|---|
| `operatingOverhead()` | `overheadPerLeasableUnitMonthly` $700/unit | **0** | $700 |
| `condoHoldTax()` | `condoMonthlyTaxRate` 1.5% on unsold condos | **0** | 1.5% |
| `noiseErosionRate()` | office-noise erosion that EVICTS | **0** (cap-only, canon) | today's erosion |

- **Rationale:** `gdd-economy-depth` added these because the original's late game
  trivializes money. That is a *faithful flaw* Classic should inherit; Modern is
  where the "deeper economy" lives. This also gives Modern a coherent identity
  (today it is households-only).
- **Compat:** old Classic saves load **cheaper and gentler** (non-breaking).
- **Must-fix:** `project-context.md:46` still says office noise "does not evict"
  (false today). Correct it as part of the gating PR (Classic: does not evict;
  Modern: erodes and can evict).
- **Test requirement:** gating noise-eviction off is more than a constant flip;
  Classic must cleanly revert to canon cap-at-0.6-never-evict. Needs its own test.

## 4. The roadmap

| Tier | Item | Why | Effort | Backlog row |
|---|---|---|---|---|
| **1: do now** | Gate the 3 economy sinks behind Modern (+ fix project-context:46) | Restores Classic faithfulness; gives Modern an identity; nearly free | S | `modern-economy-gating` (new) |
| **1** | Pricing split: office/condo/hotel canon rungs (FULL canon values incl. hotels, per Decision 2), No-Rate state | Canon-grounded; establishes the split pattern | M | `pricing-split` (new) |
| **1** | Household-aware condo departures (Modern) SHIPPED v1.12.0 | Only cheap net-new Modern feature; reuses `residents`/`churnMultiplier` | S–M | `condo-eviction` flavor b (spec: gdd-condo-household-departures-2026-07-08) |
| **2: spec first** | Lobby height 1–3 stories | Most *visible* missing thing; iconic buildable grand lobby | M–L | `lobby-height` (new) |
| **2: spec first** | Elevator per-day-type scheduling (Classic parity, FULL) | Owner tiebreak 2026-07-08: 1994 shipped it (the per-shaft schedule block in the TDT elevator record). Build the scheduling behavior AND its UI to match 1994, and round-trip the TDT schedule bytes on import/export. Epic-sized; needs its own gdd-/arch- docs first (see §7) | L (epic) | `elevator-scheduling` (new) |
| **2** | Finance 10+10 report | Ready; makes the pricing decisions legible | S–M | `finance-1010` (exists) |
| **2.5** | Bug-infested sticky hotel state + days-dirty 0-2 | Real hotel texture; needs art + a save field | M | `tdt-importer` (deferred) → own row |
| **3: flavor, opportunistic** | Retail subtypes, named tenants, twin rename, per-person eval | Cosmetic; do with the importer | S each | `retail-subtypes` etc. |
| **Parked: spec-first, not tiered** | Bounded star-falling (Modern) | Modern-mode roundtable shortlist #2: a star can fall (grace window, only un-earned stars, never TOWER). Epic-sized; needs its own gdd-/arch- docs before any build | L (epic) | `star-falling` (parked) |
| **Parked: on demand** | Post-TOWER prestige (Modern) | Roundtable shortlist item, explicitly parked until player demand. Endgame content past the TOWER rank | L (epic) | `post-tower-prestige` (parked) |
| **Ratified divergences, do NOT build** | 3-day week/12-day calendar | Enormous balance blast radius across every rate/eval that assumes a 7-day week | n/a | document in PARITY.md |

## 5. Acceptance criteria (tier-1)

1. `GameRules` gains `priceOptions(kind)`, `operatingOverhead()`, `condoHoldTax()`,
   `noiseErosionRate()`; Classic returns canon/neutral, Modern returns today's.
   The three sink call sites (`EconomySystem.ts:421/430`, the noise-erosion loop)
   read through the rules object.
2. Classic editor shows a rent **dropdown** (office/condo/hotel) with the canon
   rungs + No Rate; Modern unchanged. `Unit.rent` remains a number; deserialize
   hardened as usual.
3. Old Classic saves load without a mass move-out/charge wave (sinks off is
   non-breaking); a golden Classic fixture confirms no first-load shock.
4. `project-context.md:46` corrected; PARITY.md notes the pricing split and the
   two ratified divergences (calendar, elevator scheduling).
5. Each tier-1 item is its own PR: quality gates + `/gds-code-review` (engine
   economy) + version bump (minor for the pricing capability, patch for the
   internal sink-gating that changes Classic balance).

## 6. Open questions (owner: user / follow-up)

1. **Verify hotel + condo dollar tables** against the archive.org manual when it
   becomes readable. Per Decision 2 (user call, 2026-07-08) Classic already uses
   the FULL canon values for every rentable kind, hotels included; this is a
   later cross-check to confirm the single-source dollar tables, not a gate that
   holds hotels back. If the manual ever contradicts them, re-open Decision 2.
2. Condo minimum: 40k vs 50k (sources conflict): use 50k provisionally.
3. Default starting rent level (likely Average), confirm; the engine already
   defaults units to `cfg.default` = Average for offices, so this composes.

## 7. Resolved: elevator per-day-type scheduling is FULL Classic parity (owner ruling 2026-07-08)

Two ratified artifacts had disagreed:

- **This roadmap (§4)** originally listed elevator per-day-type car scheduling
  under **"do NOT build"** (a manual-scheduling UI almost nobody uses; a QoL
  regression against our automatic SCAN dispatch).
- **The Modern-mode roundtable (party memlog, 2026-07-08)** reclassified the
  elevator **schedule block** as a **Classic parity gap**, on the receipt that
  1994 shipped it (the per-shaft schedule block in the TDT elevator record,
  `docs/canon/tdt-format.md`).

**Owner tiebreak (2026-07-08): FULL PARITY.** Elevator per-day-type schedule
blocks are confirmed a Classic parity gap. Build the scheduling **behavior AND
its UI** to match 1994, and round-trip the TDT schedule bytes on import/export.
The roadmap now carries this as a spec-first tier-2 item (§4,
`elevator-scheduling` backlog row); it is no longer under "do NOT build". The
3-day-week / 12-day-calendar item was never part of this conflict and stays
ratified-out.

This is epic-sized: it needs its own `gdd-`/`arch-` docs before any build (the
scheduling model, the per-day-type UI, and the importer/exporter byte mapping),
and it will layer a manual per-shaft schedule on top of our automatic SCAN
dispatch, so the interaction between a user schedule and SCAN needs a design
pass. Recorded here, in the party memlog, and in the backlog.
