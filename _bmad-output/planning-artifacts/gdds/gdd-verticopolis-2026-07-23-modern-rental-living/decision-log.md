# Decision Log: Modern Rental Living

Append-only. Every design decision, its rationale, and version/state transitions.

## 2026-07-23 - Create (v0.1, Ratified)

Source: party-mode roundtable (player / dev / game / UX), 2026-07-23, owner-driven
across the session. Working mode: Express (design ratified before drafting).
Game type: Simulation-Management.

**Decisions of record:**

- **D1. Rental living is the feature; not another venue.** All ten Modern
  additions to date are commercial. Residential (one option, the condo) is the
  untapped axis and a meatier decision than an 11th venue. Owner-endorsed.
- **D2. Recurring monthly rent + retention (churn), full loop.** Owner: "full
  loop please." Distinct from condo lump sum and office quarterly. Composes the
  shipped churn loop + the office rent/vacancy/pricing.
- **D3. Two types, staggered like hotels.** Studio at ~2 stars (forgiving
  on-ramp, like `hotelSingle`), Apartment at ~3 stars (retention game). Owner:
  "early star entry like the single hotel room" + "the two types idea too."
- **D4. Studio forgiving vs Apartment demanding.** The sensitivity split is what
  makes them a difficulty on-ramp, not two sizes of one room; also protects
  early-game stars.
- **D5. Star rating can wobble from churn.** Owner-approved. Forgiving Studio
  keeps early stars safe; only Apartments put a rating at real risk. Magnitude is
  a tuning value (open).
- **D6. #502 transport-churn folded in for the Apartment only.** Demanding
  tenants leaving over a bad commute is the Apartment's character; keeps #502
  scope to one tier. Studio excluded.
- **D7. Visible vacancy reasons (first-class legibility).** No mystery income
  drains; reuses/extends `VacateReason` vocabulary. Carries the "inform before
  you hurt" principle from the 2026-07-03 tenant-churn party.
- **D8. Variants like office and condo.** Explicit owner requirement:
  `geoVariant` visual variety for both kinds + `rollHousehold` occupants for the
  Apartment.
- **D9. Labor-free.** No maids; housekeeping stays the hotel's distinction.
- **D10. Condo unchanged; Classic unchanged.** Condo stays the capital play
  (sell now, resells on turnover per [[gdd-condo-household-departures]]); rental
  is the cashflow counterpart. Classic residential stays condo-only, sticky.
- **D11. Skill routing correction.** Feature first mis-routed to `bmad-spec`;
  owner corrected to the game skill. Captured as a GDD via `gds-gdd` (gameplay =
  GDD, same split as `/gds-code-review` vs `/bmad-code-review`). No `bmad-spec`
  artifact was written.

**Deferred (Out of Scope), with reasons:**

- **Penthouse** (rooftop view-premium) and **Capsule hotel** (maid-logistics):
  strong party candidates, deferred to ship the residential-rental pair alone.
- **Duplex:** rejected by the party as a bigger-number reskin of the condo
  ("same vending machine, bigger number").

**Open items** (see `gdd.md` Open Items): economy tuning (widths, costs, rent
bands, populations, unlock stars, churn thresholds, star-impact magnitude), art
variant counts / Apartment "loft" sub-look, and whether "rent too high" is its
own vacate reason.

**State:** Ratified, ready for `gds-game-architecture`.

## 2026-07-23 - Implementation notes (from the code-grounded integration map)

The build surfaced three facts against the real engine, resolved as follows:

- **D12. "Too dirty" cut from residential churn.** There is no dirt/neglect
  satisfaction input for homes (dirt is a hotel-only housekeeping mechanic), so
  the GDD's "left: too dirty" reason has no engine backing. Dropped from scope;
  the residential churn causes are noise, access, congestion, lobby distance,
  unmet demand, transport, and rent.
- **D13. "Rent too high" reuses the office cause.** Offices already erode on
  over-market rent and name it "rent"; rentals reuse that path (no new vacate
  reason). The Apartment band is set default:max = 1:2 (like the office) so top-of-
  band gouging nets negative and evicts; the Studio's narrower ratio only sours.
- **D14. Epic 4 (#502) scoped to the shipped far-walk signal.** There is no
  existing per-tenant many-transfer "commute quality" scalar. Rather than build
  that net-new system, the Apartment reuses the office's shipped W1 far-walk
  transport penalty (`nearestTransportDistance > TRANSPORT_FAR_TILES`), named
  "transportFar". Delivers #502's player-facing intent (a badly-connected
  Apartment loses tenants) at low risk; the full many-transfer curve is a
  possible follow-up. The Studio stays exempt.
- **D15. The per-kind forgiving/demanding knob is net-new.** The existing churn
  knobs are mode-level and household-size-level, not per-kind. Implemented as a
  per-kind erosion-rate + input-set selection (Studio: gentle rate, noise/access
  only; Apartment: steep rate, plus lobby/unmet/transport/rent).
- **D16. Unmet local demand is cut from the Apartment's cause set (supersedes the
  unmet half of D12 and D15).** The GDD and both earlier entries list unmet
  demand among the drains the Apartment feels. It never fired: rentals are not
  demand origins (`originWeight` in `demand.ts` returns undefined for them), so
  `unmetCoverage` returns null on every live tick. Worse, the move-in gate DOES
  register its probe as an origin, so the gate modeled a drain the live sim never
  applied and could hold an Apartment out of a good spot whose only fault was
  unreachable retail. Rentals are now excluded from the coverage guard on the
  live, gate and copy paths alike, so all three agree. The Apartment still churns
  on noise, far walk, lobby distance and rent. Realizing the intended unmet-demand
  churn means making rentals real demand origins first, which is a live economy
  change (a demand origin draws commercial demand), tracked as #661.
- **D17. The Studio's erosion sits BELOW the served recovery (revises D15's
  "gentle rate").** D15 said gentle and the build read that as the sold condo's
  rate, whose own constant documents an invariant of being deliberately ABOVE the
  +0.05/hr recovery so noise can wear an owner out. The Studio therefore inherited
  being evictable, and once the move-in gate covered rentals it would not lease at
  all next to an office: permanently unleasable, not merely unhappy. That
  contradicts the pillar of strip-placing Studios along low floors, which is where
  the offices and shops are. The forgiving tier now has its own rate below the
  recovery, so noise caps it at the annoyance ceiling and never evicts it, the
  same shape as Classic office noise. Being evictable is what makes the Apartment
  the demanding tier, so it keeps the steep office rate.
- **D18. The Apartment joins every residential halo.** The fitness and daycare
  offsets were condo-only; the nightclub cross-floor penalty already covered the
  condo AND every hotel kind, so the Apartment was the one residential tier that
  felt none of the three. (An earlier wording of this entry said all three were
  condo-only. That overstated it: `satisfactionStep` has applied the nightclub
  penalty to hotels since the venue shipped, and this change did not touch that.)
  The effect was that the tier built to be demanding was strictly LESS demanding
  than the condo it is meant to out-demand, and the GDD's own success metric (a
  dropped nightclub visibly turning nearby units dark) did nothing across floors
  for it. The Apartment now feels all three. The Studio stays out of them: it is
  the forgiving tier.
- **D19. Household size is the condo distribution, 2 to 5.** The GDD gives two
  different figures (`population: 2-3` in mechanic 1, "e.g. 2-4" in mechanic 6 and
  Epic 5) and the build matches neither, because `moveIn` reuses the condo's
  `rollHousehold`. Recorded as the deliberate choice rather than re-tuned: sharing
  the distribution is what makes the Apartment's `churnMultiplier` behave like a
  condo's, which is the point of the tier. The catalog `population: 2` stays as
  the pre-lease fallback `residentCount` reads before a household is rolled.
- **D20. Rentals are real demand origins and the Apartment's unmet-demand churn
  is live (supersedes D16, restoring the unmet half of D12 and D15).** D16 cut
  unmet demand from the Apartment's cause set because the drain could never fire
  (rentals were not demand origins) and the gate modeled a drain the live sim
  never applied. #661 removed that root cause: `originWeight` now gives every
  rental resident the condo per-resident weight, so occupied Studios and
  Apartments feed the commercial demand pool and register in the coverage
  origin map. With the origin support real, the Apartment's unmet-demand drain
  is restored on all three paths D16 aligned: the live tick (the
  `isUnmetDemandKind` coverage guard includes `rentalApartment`), the move-in
  gate (the probe registers and the share folds the probe household's demand),
  and the gripe copy (`dominantGripe` names `unmetDemand`; `wontLeaseText`
  mirrors the same predicate). D16's carve-outs are obsolete and must not be
  restored. The Studio stays the forgiving tier: its residents feed the pool,
  but `isUnmetDemandKind` excludes it, so it never feels the drain on any path.
