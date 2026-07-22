# Spec: Classic maintenance canon cadence (seam design, provisional, gated)

- **Date:** 2026-07-22
- **Lane:** GDS (gameplay/engine parity), owner-directed ("also write the seam
  spec and the lobby-fee GDD")
- **Status:** DESIGN ONLY. This spec is authored so the seam is ready, but
  implementation stays GATED on #575-grade primary verification of the canon
  maintenance dollar table (the values below are single-lineage, no primary).
- **Trigger:** issue #573 (`canon-maintenance-table`), the last economy line
  still on the income-invariant calendar rescale in Classic after the office
  rent cadence moved to the full canon lump (`GameRules.quarterlyRentScale`,
  spec-classic-economy-canon-cadence-2026-07-22).
- **Party:** Mary (sources), Samus Shepard (design ruling), Cloud Dragonborn
  (seam architecture), Link Freeman (blast radius), John (scope), the owner's
  standing PR #574 epistemics ruling in Grumbal's chair.

## 1. Evidence and the resolved ambiguities (2026-07-22 #575 sweep)

The candidate canon chart, with the three open conflicts now resolved from the
sources (all still ONE lineage: BStuart FAQ -> Relentless Optimizer -> Fandom,
not independent; the official manual is silent on the dollar figures):

| Item | Canon (per quarter) | Notes / resolution |
| --- | --- | --- |
| Security | -20,000 | BStuart + RO agree |
| Housekeeping | -10,000 | BStuart + RO agree |
| Recycling | -50,000 | **PER QUARTER** (the "per year" wording is an unsourced outlier) |
| Metro | -100,000 | BStuart + RO agree |
| Parking ramp | -10,000 | RO only (thin) |
| Escalator | -5,000 | BStuart + RO agree |
| Stairs | 0 | none |
| Elevator | -10,000 | **PER SHAFT**, flat per installation, NOT multiplied by cars |
| Medical | 0 | **no fee recovered** (medical center has no recurring maintenance) |
| Lobby | star-tiered | free 1-2 stars, 300/segment at 3, 1,000/segment at 4+ (a NEW mechanic: its own GDD, `gdd-star-tiered-lobby-fees-2026-07-22.md`) |

**Our current Classic upkeep runs 10-125x BELOW this chart.** We charge
modern-tuned monthly constants (`ECON.serviceMaintenanceMonthly`,
`ECON.maintenancePerCarMonthly`) rescaled by `maintPeriodDays /
REAL_WORLD.maintPeriodDays` = 3/30 = 1/10 per canon 3-day period. Examples,
per canon quarter: security $200 (canon $20,000), housekeeping $100 (canon
$10,000), recycling $400 (canon $50,000), metro $800 (canon $100,000), medical
$500 (canon $0). Elevator: $60/car/qtr, 8 cars/shaft = $480/shaft (canon
$10,000/shaft). This is exactly the "10-100x Classic upkeep swing on snippet
evidence" the followups-spec warned against, which is why implementation stays
gated.

## 2. The ruling (provisional, gated)

Classic's contract is parity. Once the canon maintenance table is
primary-verified, Classic should charge the **full canon amount each canon
period** through a seam sibling to `quarterlyRentScale`, replacing the 1/10
rescale for Classic only. **Modern keeps the 1/10 rescale** (its balance is
ours, not 1994's), exactly as it kept the rent rescale.

Two structural facts make this NOT a one-line scalar like the rent seam:

1. The canon values are not a scalar multiple of ours, so a scale factor cannot
   reproduce them. Classic needs a canon per-period DOLLAR TABLE, not a
   rescaled modern table.
2. Elevator upkeep is per shaft in canon, but our loop charges
   `t.cars * maintenancePerCarMonthly` per shaft. Classic must charge a flat
   per-shaft amount, a change to the loop shape, not just the constant.
3. Medical is $0 in canon; Classic must not charge it (today it pays $500/qtr).

## 3. Implementation contract (Cloud) - for when the gate clears

- New seam member `GameRules.maintenanceModel()` returning a discriminated
  shape the `payMaintenance` loop reads once (like `quarterlyRentScale` is read
  once): either `{ mode: "modern-rescale" }` (today's monthly constants x
  `maintPeriodDays / REAL_WORLD.maintPeriodDays`) or `{ mode: "canon-quarter",
  table }` where `table` is the primary-verified canon per-quarter dollars per
  kind, plus the elevator per-shaft flat and medical 0.
  - `MODERN_RULES`: `{ mode: "modern-rescale" }` (byte-identical to today).
  - `CLASSIC_RULES`: `{ mode: "canon-quarter", table: CANON_MAINTENANCE }`.
- `EconomySystem.payMaintenance` branches on the mode once at the top (constant
  for the whole run, like the `rules` resolve it already does), then:
  - modern-rescale: the existing `charge` path, untouched.
  - canon-quarter: elevator upkeep becomes a flat per-shaft amount (drop the
    `* t.cars`); `serviceMaintenanceMonthly` lookups read `CANON_MAINTENANCE`
    per kind (medical absent = 0); the period is the canon quarter, not the
    monthly rescale.
- The lobby star-tiered fee is a NEW income/cost line (not in
  `serviceMaintenanceMonthly` today); it belongs to the lobby-fee GDD, not this
  seam, and lands as its own charge keyed on star and lobby-segment count.
- `payMaintenance`'s `scale`/`REAL_WORLD` path and the Modern branch stay
  byte-identical, the same discipline the rent seam used.

## 4. Test plan (Link) - for when the gate clears

- Seam unit tests: `MODERN_RULES.maintenanceModel().mode === "modern-rescale"`;
  `CLASSIC_RULES.maintenanceModel()` returns the canon table; a bare test
  context falls back to Modern (byte-identical), matching `collectRent`.
- `payMaintenance` integration: a Classic tower with one security desk pays the
  full canon $20,000/qtr (was $200); an identical Modern tower still pays the
  rescaled $200. An elevator shaft with N cars pays the flat per-shaft canon
  amount in Classic (independent of N) and the per-car amount in Modern. A
  medical center pays $0 in Classic, its rescaled value in Modern.
- Golden master: the Classic fingerprint re-pins (its economy shifts, expected
  and re-pinnable with an intent comment); the Modern fingerprint MUST NOT move
  (the seam proof, same discipline as the rent PR).

## 5. Gate (do NOT skip)

Implementation waits on #575-grade primary verification of the canon
maintenance DOLLAR table. The recycling quarter-vs-year and elevator
per-shaft-vs-per-car ambiguities are resolved from the sources but on ONE
lineage; a 10-125x upkeep swing on single-lineage evidence is exactly the
mistake the owner's PR #574 review warned against. Verify the dollar table
(retail game via the Wine harness once a genuinely populated tower can be
driven, or a genuinely independent primary source), then run this spec through
`/gds-code-review` with all four gates green and the golden-master discipline
above. `/gds-code-review` on implementation, per CLAUDE.md (economy change).
