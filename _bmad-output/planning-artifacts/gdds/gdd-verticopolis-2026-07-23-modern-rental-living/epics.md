# Development Epics: Modern Rental Living

Companion to `gdd.md`. Sequenced so each epic is independently verifiable and the
risky economy/churn wiring lands before art and legibility. Numbers are the GDD's
design targets and are the balance phase's to finalize.

## Epic 1 - Catalog & placement

**Goal:** Studio and Apartment exist as placeable Modern-only residential kinds.

- Add `rentalStudio` and `rentalApartment` to `facilitiesData.ts`
  (`category: residential`; Studio width 6 / pop 1 / minStar 2 / ~$22k;
  Apartment width 11 / pop 2-3 / minStar 3 / ~$60k). Colors distinct from the
  condo's green so the palette reads.
- Modern-only gating through the existing predicate path (`facilityPredicates.ts`
  / `MODERN_RULES`); absent from the Classic catalog.
- Any per-tower caps in `facilities.ts` (`BUILD_CAPS`); default to uncapped like
  condos unless balance says otherwise.
- Palette placement: land under the residential/Modern section of the new tabbed
  palette; "new tools" dot behavior handled by the existing unlock-visibility system.

**Done when:** both kinds place in a Modern tower at/after their star gate, are
absent in Classic, and a placement test pins the star gates and Modern-only rule.

## Epic 2 - Rental income (recurring monthly, player-set)

**Goal:** an occupied rental pays monthly rent at a price the player sets.

- Add a residential rent band to `priceOptions` / `MODERN_PRICE_OPTIONS`
  (Studio ~$1.5k-$3k, Apartment ~$4k-$8k), driven by the existing office-style
  pricing UI and the tracked `price_tune` economy action.
- Monthly rent tick in the economy/ledger (distinct from office quarterly and
  hotel nightly); **zero income while vacant**.
- Editor/inspector shows the unit's current rent and occupancy, reusing the
  office lease panel pattern.

**Done when:** an occupied rental accrues its set rent monthly, a vacant one
accrues nothing, and changing the price changes income; tests pin the cadence and
the vacant-earns-nothing rule.

## Epic 3 - Churn & re-lease (the retention loop)

**Goal:** rentals run the shipped `vacating` loop and re-lease after departure.

- Route rental units through the existing satisfaction -> `vacating`
  (reason recorded) -> reversible-notice -> departure path
  (`rollCondoRelocations` / the notice branch in `Simulation.ts`).
- **Net-new:** after a rental tenant leaves, the unit enters a **vacant/re-lease**
  state and re-leases at the player's set rent, gated by desirability (mirror the
  office re-lease path), rather than reselling.
- Sensitivity split: **Studio forgiving** (erodes only on real noise/dirt/
  unreachable, high tolerance) vs **Apartment demanding** (erodes on noise, dirt,
  unmet local demand). Tune via the mode-seam churn hooks in `gameRules.ts`.

**Done when:** an unhappy rental gives notice with a reason, a timely fix cancels
it, an unfixed one leaves and the unit re-leases when conditions/price recover;
tests pin notice, cancel-on-fix, departure, and re-lease, and pin that the Studio
tolerates conditions that would evict an Apartment.

## Epic 4 - Transport-quality churn for the Apartment (#502)

**Goal:** a demanding Apartment tenant erodes over a bad commute; Studio does not.

- Implement the deferred #502 transport-satisfaction erosion (long climb /
  many-transfer trip feeds satisfaction drain) **for the Apartment kind only**,
  per the `MODERN_RULES.walkwayWillingnessApplies` seam comment.
- Erosion feeds the same churn loop from Epic 3 (no separate leave path).
- Studio explicitly excluded from #502.

**Done when:** an Apartment with a genuinely bad commute erodes toward notice with
a "hard to reach" reason, an identical Studio does not, and a test pins the
Apartment-only scope.

## Epic 5 - Variants (visual + household)

**Goal:** placed rentals vary like offices and condos.

- `geoVariant`-driven wall-palette + decor/picture sets for both kinds in
  `residential.ts` / `residential.looks.ts` (own arrays, condo/office pattern).
- `rollHousehold`-style occupant variety for the Apartment (e.g. 2-4);
  Studio fixed single-occupant.
- Pixel-sprite art for Studio and Apartment (and the Sprite Gallery cell).

**Done when:** a strip of the same kind shows varied walls/decor, Apartment
households vary, a determinism test pins the per-unit variant selection, and the
Sprite Gallery shows both.

## Epic 6 - Legibility (vacancy reasons + notice telegraph)

**Goal:** every income/star dip from churn has a visible, honest cause.

- Extend `VacateReason` / `VACATE_REASON_TEXT` as needed for rental causes
  ("too loud", "too dirty", "hard to reach", and the rent-too-high decision from
  Open Items).
- Surface the reason on a `vacating`/vacant rental; show the notice grace window;
  make occupied-vs-vacant scannable (office-style).

**Done when:** a player can read why any rental went dark, sees notice before
departure, and a test pins each reason string to its cause.

## Epic 7 - Population & star-rating coupling

**Goal:** occupancy moves population/stars, gently early.

- Occupied rentals add population; vacancies subtract it, feeding the existing
  star computation.
- Tune magnitude so Studio churn barely moves stars and Apartment churn can
  meaningfully dent a rating if ignored (owner-approved that it CAN).

**Done when:** a tower that loses an Apartment floor shows a population/star dip
that recovers on re-lease, a Studio-only tower's stars stay stable through
scrappy conditions, and a test pins both.

## Epic 8 - Persistence, tests, screenshots, release

**Goal:** ships clean.

- Save round-trip preserves occupancy, per-unit rent, vacancy + reason, and the
  notice/departure timer. Save-shape change handled per project TDT/save law
  (this touches engine-data fidelity, so `/gds-code-review`).
- Full quality gates green; unit + integration coverage for Epics 1-7.
- Screenshot scene(s) for the new residential kinds (desktop + mobile), pinned
  deterministically.
- Minor version bump + one player-outcome CHANGELOG line; backlog row mirrored to
  a GitHub issue if any `defer` findings arise.

**Done when:** a saved tower with rentals reloads byte-faithful, gates are green,
the gallery shows the new kinds, and the review skill (`/gds-code-review`) has
run clean.

---

## Sequencing notes

- Epics 1-3 are the spine; 4-7 layer on and are independently shippable if scope
  needs trimming (e.g. #502 could slip a build without blocking the pair).
- Epic 3's re-lease path and Epic 8's save-shape change are the two highest-risk
  items; land them with the most test rigor.
- The whole feature is gameplay/engine work, so `/gds-code-review` (not
  `/bmad-code-review`) is the deep review, and the save round-trip half is
  explicitly a `/gds-code-review` concern.
