# Spec: Classic economy canon cadence and the 1994 tables (snippet-corroborated, provisional)

- **Date:** 2026-07-22
- **Lane:** GDS (gameplay/engine parity), party-ratified, owner pre-authorized
- **Trigger:** owner report on the SixSeven save ("something is off with classic
  economy... I shouldn't have this amount of money... please look up if this is
  valid with 1994 sources") plus the standing pricing-split follow-ups ("verify
  the dollar tables", "Classic playthrough sanity pass on early-hotel cash").
- **Party:** Mary (sources), Samus Shepard (design ruling), Cloud Dragonborn
  (seam architecture), Link Freeman (implementation/test blast radius), John
  (scope), Paige (this document).

## 1. The evidence

The owner's save (`sixseven_16.vctower`, app 1.75.0): Classic, 4 stars,
$333,256,172 at in-game day 1590. Ledger per in-game day: hotels ~$1.05M
(459 rooms), offices ~$250k per 3-day quarter (~$85k/day across 886 offices),
food + retail ~$85k, cinemas roughly net-zero against film bookings. Per unit
that is ~$2,300/night for a hotel room against ~$96/day for an office (24x),
where the 1994 original ran the two at rough parity.

## 2. Source verification (the "look it up" half)

Fetched via web search on 2026-07-22; direct page fetches were blocked by the
session network policy, so values were mined from search snippets of the pages
named below. Search snippets from the GameFAQs FAQ lineage (BStuart, furdude2,
Aristotle47; mirrored at Neoseeker and CheatCodes) corroborate the Relentless
Optimizer tables the pricing split shipped on, rung for rung. Two honest
limits on that corroboration (owner review, PR #574): the pages themselves
were not read, only snippets, and a lineage mirrored across sites is not
established as independent of the fan reference. So every "corroborated"
verdict below is explicitly PROVISIONAL until a primary or genuinely
independent source is read directly (backlog row
`classic-rent-primary-source-verification`, issue #575; the Wine harness is
the definitive path, as it was for stairs willingness and the calendar phase):

| Item | 1994 sources (snippet-level) | Verticopolis Classic | Verdict |
| --- | --- | --- | --- |
| Office rent | $2k/5k/10k/15k per quarter; quarter = 3 days; paid "every 1st weekday" | same ladder, but each collection pays 1/30 of the rung | ladder **corroborated (provisional)**; cadence **deviates** (this spec fixes it) |
| Hotel single | $500/1,500/2,000/3,000 nightly | same, nightly, full | **corroborated (provisional)** |
| Hotel double | $800/2,000/3,000/4,500 nightly | same | **corroborated (provisional)** |
| Hotel suite | $1,500/4,000/6,000/9,000 nightly | same | **corroborated (provisional)** |
| Condo | $150k one-time (build cost $80k) | $150k Average rung | **corroborated (provisional)** (Very Low 40k-vs-50k still open) |
| Fast food | ~$3k/day ($9k/qtr) at normal population | $2k/day headline, demand-scaled | deviates low; deferred calibration |
| Restaurant | ~$6k/day ($18k/qtr) | $4k/day headline | deviates low; deferred calibration |
| Shop | $4k-20k/day by popularity | $2.5k/day headline | deviates low; deferred calibration |
| Cinema | $0-10k/day by performance, film booked monthly | $8k/day headline, 150k/300k bookings | comparable; deferred with the rest |
| Maintenance | full amounts charged per quarter | modern-tuned monthly values, 1/10 per canon period | canon dollar table unverified; deferred |

Provenance notes in `src/engine/pricing.ts` and the pricing GDD record this
snippet-level corroboration without a confidence-tier upgrade: the tables stay
at their shipped SOFT/MED tiers, marked provisionally reinforced. The
archive.org manual remains unread; if any primary source ever contradicts
these, re-open here and in the pricing GDD's Decision 2.

**#575 UPDATE 2026-07-22 (primary manual + Wine harness read; owner call: keep
open).** The CADENCE line above is now **primary-confirmed**, no longer
provisional: the official manual, read directly off the disc (Italian full text
plus English OCR), states a quarter is 3 in-game days, a year is 4 quarters, and
the Finance window reports per quarter (figures x100), and the rent-class
structure round-trips into the retail 1994 game under the Wine harness. The
manual is SILENT on the dollar tables. The independence assessment resolved
NEGATIVE (RO, the FAQ lineage, and Fandom are one lineage, not independent), so
the value tiers stay provisional; office and condo gained a genuine second
source (patcoston.com), hotels remain single-lineage. A headless per-class
dollar read was not achievable (imported tenants never instantiate, so info
windows divide by zero; an all-vacant fixture crashes on load). #575 stays open,
narrowed to an independent dollar read of the hotel ladders and the condo
minimum. Full record in the pricing GDD's verification blockquote.

**Answer to the owner's question:** the amount of money is valid. The 1994 game
famously drowned a 4-star tower in cash; stars gate on population, never on
income. A true 1994 tower of SixSeven's shape would earn roughly $4M per day
(offices at the full quarterly lump plus the same hotel nightly take), about
four times what Verticopolis currently pays it.

## 3. The ruling (Samus, unanimous, owner pre-authorized)

Classic's contract is parity, not challenge. The income-invariant calendar
rescale (gdd-classic-calendar-parity §3) was premised on "we do not have the
canon rent numbers"; that premise expired the day the canon ladders shipped.
Keeping the rescale for Classic silently under-pays offices 30x against canon
and makes hotels look like an exploit when they are simply canonical.

1. **Classic collects the full canon office rent lump every canon quarter.**
   An Average office pays its whole $10,000 each 3-day quarter, the fast office
   money the original was known for.
2. **Modern is untouched.** Its calendar toggle keeps the income-invariant
   rescale: a Modern tower earns the same per in-game day on either calendar,
   because Modern's balance is ours, not 1994's.
3. **Hotels, condos, and commercial change nothing in this PR.** Hotels and
   condos are already canon; commercial headline values are deferred to a
   calibration row because our demand-pool model scales the headline figure, so
   a bare constant swap would not reproduce the FAQ's "at normal population"
   numbers anyway.
4. **Maintenance keeps the 1/10 rescale in both modes** until the canon
   maintenance dollar table is verified (deferred row). Known, documented gap:
   Classic upkeep stays per-day-equivalent to Modern's tuning.

## 4. Implementation contract (Cloud)

- New seam member `GameRules.quarterlyRentScale(quarterDays: number): number`:
  the factor applied to the summed quarterly office rent at collection.
  - `CLASSIC_RULES`: returns `1` (the full 1994 lump, whatever the calendar;
    Classic is always canon).
  - `MODERN_RULES`: returns `quarterDays / REAL_WORLD.quarterDays` (the
    income-invariant rescale; exactly 1 on real-world, structurally).
- `EconomySystem.collectRent` reads the seam through the file's standard
  `this.sim.rules ?? MODERN_RULES` fallback, so bare test contexts keep the
  rescale byte-identical. One multiply, one `Math.round` on the summed total,
  as before.
- `payMaintenance` is not touched.
- Help/Compare copy gains the divergence bullet (the `RULE_TO_HELP` typecheck
  guard forces the classification); the "Calendar pace" bullet's income-per-day
  sentence is rescoped to Modern's choice, which is the only place it is true
  now.

## 5. Test plan (Link)

- Seam unit tests: `CLASSIC_RULES.quarterlyRentScale(3) === 1`;
  `MODERN_RULES.quarterlyRentScale(3) === 1/30`;
  `MODERN_RULES.quarterlyRentScale(90) === 1`.
- `calendar.integration.test.ts`: the Classic day-3 lump test flips from $333
  to the full $10,000 (regression pinning the shift into the new behavior); the
  cross-calendar per-day invariance test is rebuilt around Modern-canon vs
  Modern-real-world (where the invariant still holds) plus a Classic divergence
  assertion; the structural 1/30 factor test is rescoped to Modern's canon
  calendar. Bare-context and real-world tests are unchanged by design.
- Golden master: the Classic fingerprint re-pins if the fixture's 3-day run
  collects rent from an occupied office; the Modern fingerprint MUST NOT move
  (that is the proof the change flows only through the seam).
- Owner's save as evidence: SixSeven's 886 offices move from ~$250k to ~$8.9M
  per quarter after this change. That is canon.

## 5b. Review record (2026-07-22, PR #574)

`/gds-code-review` ran in-session. Layers: Blind Hunter and Acceptance Auditor
completed; the Edge Case Hunter run was stopped by the owner mid-flight, so
that layer did not report (recorded per the workflow's failure handling; a
manual edge-walk of collectRent callers, bare contexts, the golden master, and
the Help drift guard was done during implementation). Findings and triage:

- **patch (blind med + auditor low, merged):** the rebuilt Modern invariance
  test asserted constants against constants and its "end-to-end" comment
  overclaimed. Fixed: both sides now measure production `collectRent` (a
  Modern-canon sim collects the rescaled $333, the identical Classic sim the
  full $10,000).
- **patch (blind low):** the Classic full-lump test title said "whatever the
  calendar says" but only exercised the canon calendar through `collectRent`.
  Fixed: a REAL_WORLD-calendar context asserts the same full lump.
- **patch (Copilot):** `CLASSIC_RULES.quarterlyRentScale` names its ignored
  parameter (`_quarterDays`); the Calendar-pace bullet reads "earns the same
  money per in-game day".
- **dismiss:** help.test phrase lives in compare.ts (by design: compareTemplate
  is the single source rendered into the Help section; the guard checks the
  rendered Help text and passes); CHANGELOG has no 1.77.0 section (that
  version shipped with no player-facing notes, per the changelog's own
  convention, and predates this PR); `MODERN_RULES` import "missing" (a
  diff-only artifact; the import was already present and typecheck is green).
- **defer:** none new; the two pre-triaged rows below carry the deferred scope.

## 6. Deferred (backlog rows, mirrored to issues)

- `classic-commercial-income-canon`: calibrate Classic's
  `dailyTrafficIncome` against the FAQ figures (fast food 3k/day, restaurant
  6k/day, shop 4k-20k popularity-scaled, cinema 0-10k/day) through the
  demand-pool model, not a bare constant swap. Wants a playtest pass.
- `canon-maintenance-table`: verify the 1994 maintenance dollar table (FAQ
  lineage lists per-quarter amounts) and decide whether Classic charges full
  canon amounts per canon period, replacing the 1/10 rescale.
- `classic-rent-primary-source-verification` (owner review, PR #574): establish
  the rent ladders and the full-per-quarter office cadence from a primary or
  genuinely independent source (read the FAQ pages directly, OCR the manual,
  or read the retail game via the Wine harness). Until then every
  corroboration in §2 stays provisional; a contradiction re-opens this spec's
  ruling and the pricing GDD's Decision 2.
