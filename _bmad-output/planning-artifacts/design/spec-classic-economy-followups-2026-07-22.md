# Spec: Classic economy follow-ups (commercial ceilings, maintenance chart, primary sources)

- **Date:** 2026-07-22
- **Lane:** GDS (gameplay/engine parity), party-ratified, owner-directed ("go for followups")
- **Scope:** the three rows spun out of spec-classic-economy-canon-cadence-2026-07-22:
  `classic-commercial-income-canon` (#572), `canon-maintenance-table` (#573),
  `classic-rent-primary-source-verification` (#575).
- **Party:** Mary (sources), Samus Shepard (design ruling), Cloud Dragonborn
  (seam architecture), Link Freeman (blast radius), John (scope), Grumbal's
  chair occupied by the owner's standing epistemics ruling from PR #574.

## 1. New evidence (2026-07-22 sweep; snippet-level unless noted)

Same collection method and limits as the cadence spec: values mined from search
snippets because the network policy blocks direct page reads. Same-lineage FAQ
material, so PROVISIONAL throughout.

**Commercial daily income (the 1994 chart):**

| Venue | 1994 chart (daily) | Notes |
| --- | --- | --- |
| Fast food | (-3k) / 2k / 5k | "at normal population, $3k/day ($9k/qtr)"; note the wobble: 3k is not one of the recorded tiers (restaurant's normal 6k IS its middle tier), an intra-lineage inconsistency like the recycling cadence; can LOSE money at low patronage |
| Restaurant | 4k / 6k / 10k | normal $6k/day |
| Retail shop | 4k / 10k / 15k / 20k | "by popularity levels" |
| Theater (cinema) | 0 / 2k / 10k | "by performance" |
| Party hall | 20k flat | needs 50 population |

**Maintenance (candidate canon chart, NOT implemented):** security -20k/qtr
(cost 100k), housekeeping -10k/qtr (cost 50k), recycling -50k (one source says
per QUARTER, another says per YEAR: an intra-lineage conflict), metro -100k/qtr
(cost 1M), parking ramp -10k/qtr, escalator -5k/qtr, stairs none, elevators
"10k per quarter" (per shaft or per car unresolved), lobby fees tiered by star
(free at 1-2 stars, 300/segment at 3, 1,000/segment at 4+), medical fee not
recovered.

**Primary sources located (#575):** archive.org hosts the SimTower PC manual
as full OCR text (`archive.org/stream/SimTower_-_Manual_-_PC/..._djvu.txt`),
the Prima official strategy guide (Rick Barba) as scans, and retail game
images. All are blocked by this session's network policy but confirmed to
exist and indexed; the manual's Finance-window note ("multiply all figures by
100") already surfaced through snippets, matching the TDT money x100 encoding
we import. The GDD's old "manual unfetchable" premise is stale: the blocker
is now access rather than existence.

## 2. Rulings

1. **#572 SHIPPED (provisional).** New seam `GameRules.commercialDailyIncome(kind)`:
   Classic reads `ECON.classicDailyTrafficIncome`, the chart's TOP tiers
   (fast food 5k, restaurant 10k, shop 20k, cinema 10k, party hall 20k) as
   sold-out ceilings; the demand-pool fraction and live-attendance fill produce
   the lower tiers, which lands a busy venue near the chart's "normal" figures.
   Modern keeps `ECON.dailyTrafficIncome` unchanged. For the retail-pool
   kinds the headline is both the income figure and the demand-pool capacity
   bid, read from one seam in the money loop and the demand map, so those two
   cannot desync; attendance venues (cinema, party hall) sit outside the pool
   by design (#424) and their counterweight is the live-attendance fill. The
   anchor is not a hard cap: weekend and blockbuster multipliers ride above it
   (canon's own weekend visitor lift), so a saturated weekend shop can exceed
   20k; recorded, accepted. The inspector's customer-verdict baseline stays on
   the pre-#572 yardstick in both modes (review finding: scoring against the
   1994 ceiling would read healthy Classic venues as red), pending the
   verdict-band calibration in the playtest pass.
   Consequence accepted and documented: Classic per-venue capacity grows, so
   retail coverage reads higher and the unmet-demand ceiling fires later in
   Classic; that interaction plus `demandPerCapita` stays on the row's playtest
   pass. The chart's low-patronage LOSS tier (fast food -3k) is out of scope
   (no loss mechanic exists; noted for the playtest pass).
2. **#573 DEFERRED, evidence recorded.** The candidate chart above goes to the
   issue, but implementation waits for primary verification: the recycling
   quarter-vs-year conflict, the elevator per-shaft-vs-per-car ambiguity, and
   the unrecovered medical fee make a 10-100x Classic upkeep swing on snippet
   evidence exactly the mistake the owner's PR #574 review warned against.
   Star-tiered lobby fees are additionally a NEW mechanic needing its own GDD.
3. **#575 PROGRESSED, stays open.** The issue gains the concrete source
   pointers; the definitive step is unchanged (read a primary source directly:
   the manual text, the Prima guide, or the retail game via the Wine harness,
   from an environment that can reach them).

## 3. Test plan

- Seam pins: per-kind Classic ceilings, Modern's live-table identity, shared
  kind classification, undefined for non-venues (gameRules.test.ts).
- Demand-map seam wiring: the same office block saturates a Modern shop
  (fraction 1) and leaves a Classic 1994-ceiling shop at pool/capacity
  (commercialDemandPools tests, with a dedicated Classic twin).
- Mode-shared mechanisms that need an oversubscribed venue (fraction cap,
  raw-share exposure, the capacity-shortfall gripe) move to Modern fixtures,
  each with a comment saying why.
- Classic golden master re-pins; the Modern hash must not move (the seam
  proof, same discipline as the cadence PR).
