---
stepsCompleted: ["step-01-validate-prerequisites", "step-02-design-epics", "step-03-create-stories", "step-04-final-validation"]
inputDocuments:
  - "_bmad-output/planning-artifacts/design/gdd-classic-modern-pricing-roadmap-2026-07-08.md (merged to main with PR #164)"
  - "_bmad-output/planning-artifacts/design/arch-condo-stickiness-2026-07-05.md"
  - "_bmad-output/planning-artifacts/design/gdd-tenant-churn-2026-07-03.md"
  - "_bmad-output/planning-artifacts/design/arch-tenant-churn-2026-07-03.md"
  - "_bmad-output/planning-artifacts/design/gdd-batch-pricing-2026-07-01.md"
  - "_bmad-output/planning-artifacts/design/arch-batch-pricing-2026-07-01.md"
  - "docs/canon/tdt-format.md"
  - "_bmad-output/planning-artifacts/ux-designs/ux-verticopolis-2026-07-07/DESIGN.md"
  - "_bmad-output/party-mode/memories/installed/.memlog.md (decision provenance)"
---

# Verticopolis - Epic Breakdown: Classic/Modern roadmap tier-1 (+ elevator-scheduling spec)

## Overview

This document decomposes the Classic/Modern roadmap GDD
(`gdd-classic-modern-pricing-roadmap-2026-07-08.md`) into implementable epics
and stories, covering the two remaining tier-1 items (the pricing split and
household-aware condo departures) plus the spec-first entry point for the
elevator per-day-type scheduling epic ruled FULL Classic parity by the owner
tiebreak of 2026-07-08 (GDD §7).

Out of scope here: the economy-sink gating (tier-1 #1) ships in PR #164 and
needs no stories; tier-2+ build work (lobby height, finance 10+10, sticky hotel
state) and the parked epics (star-falling, prestige) wait for their own passes.

> **STATUS RECONCILIATION 2026-07-09 (read before building anything).** A
> parallel real-game-validation marathon (Wine harness, `tools/simtower/`)
> landed a lot of main out of the roadmap's tier order, and it overtakes parts
> of this doc:
> - **Condo departures already shipped (v1.12.0, backlog `condo-eviction`).**
>   Household-aware relocation plus the arch-condo-stickiness neglect fuse are
>   in main. Epic 2 is RECONCILED below from "build a fuse" down to "verify the
>   two paths coexist and document the economics" (see the Epic 2 banner).
> - **The 12-day Classic calendar is no longer ratified-out.** Backlog
>   `classic-calendar-parity` (P1, owner-designated fast-follow) adopts it for
>   Classic; it supersedes every "3-day-week / 12-day-calendar stays
>   ratified-out" line this doc and the roadmap GDD inherited. It is its own
>   epic, not covered here.
> - **The TDT elevator schedule bytes now emit the game's DEFAULT block**
>   (`TDT_ELEVATOR_SCHEDULE_DEFAULT`), not zero (backlog
>   `tdt-trailing-structure-layout`, v1.14.0). Epic 3's round-trip AC is about
>   PLAYER-EDITED schedules layered on that default, corrected below.
> Epic 1 (pricing split) is unaffected and remains the clean next build.

**Sequencing dependency (satisfied 2026-07-08):** PR #164 is merged; main
carries the GDD, the sink gating, and the GameRules methods the stories
build beside.

## Requirements Inventory

### Functional Requirements

FR1: `GameRules` gains `priceOptions(kind)`: Classic returns the discrete
4-rung canon ladder plus a No Rate sentinel; Modern returns today's continuous
`{min, default, max, step}` band (GDD §1).
FR2: Classic rung dollar values are the FULL canon tables for every rentable
kind (office 2k/5k/10k/15k quarterly; condo 50k/100k/150k/200k one-time; hotel
single 500/1500/2000/3000, double 800/2000/3000/4500, suite 1500/4000/6000/9000
nightly), each table commented with its provenance (GDD §2, user call).
FR3: The unit editor renders a rent dropdown in Classic and the existing
stepper/range in Modern, switching off the SHAPE of `priceOptions()`'s return,
never off the mode string (GDD §1; gameRules.ts "no mode conditionals" rule).
FR4: A real "No Rate" state exists in the engine and it means OFF-MARKET: a No
Rate unit charges nothing AND accepts no move-ins (the two halves are one
state, never separable), and the .TDT importer's class-4 units map onto it
instead of silently reverting to the default rent. Explicit ACs: importing a
tower with class-4 units must not flood those units with zero-rent tenants;
setting No Rate on an OCCUPIED unit never evicts (the tenant stays, pays
nothing, and still counts in the rating census, the canonical endpoint of the
cheap-rent population lever); No Rate is a Classic-only surface, Modern's
editor never offers it and a Modern save carrying a forged noRate coerces it
away through a GameRules method (seam law, like coerceResidents) (GDD §1;
party rulings 2026-07-08).
FR5: `Unit.rent` stays a raw number; income, satisfaction, and move-in math
keep keying off `rentOf(u)` vs the neutral rung, re-anchored in Classic onto
canon Average (GDD §1).
FR6: Batch pricing becomes "set all to <level>" in Classic (dropdown semantics)
and keeps the range editor in Modern (GDD §1; gdd-batch-pricing).
FR7: Classic condos MAY sell below build cost (canon floor 50k); Modern keeps
the 80k break-even floor. Sold condos are PRICE-LOCKED (canon: one-time,
locked after sale): the rent dropdown disables on a sold condo (GDD §2).
FR8: The .TDT exporter's `classFromRent` maps Classic rung values losslessly to
rent-class bytes 0-3 and No Rate to byte 4; export→import round-trips a Classic
tower's rent levels exactly (GDD §1; tdt-format §4).
FR9: Modern condos gain "patient flight risk" departures: sustained rock-bottom
neglect eventually loses an owner (a longer, higher-tolerance fuse than the
office 2-day hair-trigger), while spikes (transient noise, one bad rush hour)
are absorbed without churn (party memlog condo-churn ruling; GDD §4 tier-1).
FR10: Condo departures are household-aware: bigger families (4-5) wear down
faster and smaller ones (2) slower, reusing `residents` and
`churnMultiplier()`; Classic condos stay 1994-sticky (no departure fuse at
all beyond the existing access walkout) (GDD §4; gameRules.ts).
FR11: A departing condo owner follows the tenant-churn contract: notice period
with a live inspector countdown, rescindable by fixing the cause, and the
existing access-loss walkout is unchanged (arch-tenant-churn; arch-condo-
stickiness).
FR12: When a Modern owner departs, the unit returns to the market unsold; the
one-time-sale economy (sale price, `everOccupied` gate, buy-back mirror via
`householdPrice`) is not perturbed (arch-condo-stickiness invariants).
FR13: An `elevator-scheduling` spec pass produces paired gdd-/arch- docs
covering: the 1994 per-day-type scheduling model, its UI, the interaction
between a manual per-shaft schedule and our automatic SCAN dispatch, and the
TDT 56-byte schedule block mapping for import/export round-trip (GDD §7).
FR14: The scheduling spec resolves its named design forks explicitly: what a
schedule controls (cars in service per day segment), what happens to canon
behavior when the player never touches the UI (SCAN remains the default), and
Classic/Modern applicability (parity feature: both modes, identical).

### NonFunctional Requirements

NFR1: No mode conditionals outside `GameRules`: every Classic/Modern divergence
is a method on the rules object with two implementations (gameRules.ts law).
NFR2: Deserialize hardening: forged/hostile saves (NaN rent, out-of-band rung,
forged No Rate on a non-rentable kind, forged departure timers) clamp or drop
safely, matching the engine's existing coercion idioms.
NFR3: Pre-split Classic saves migrate by SNAP-ON-LOAD (owner call at the epic
review party, 2026-07-08): a stored continuous rent snaps once to the nearest
canon rung at load (ties round UP), uniform for every kind with no
intent-guessing special cases, so the dropdown never lies and no phantom
"custom" row exists. The one-time income shift is accepted (noise under
Decision 2's hotel rescale); the golden fixture pins the migration by name,
including the two sharp edges: an office at the old $20k max drops to High
$15k, and a firesale condo at the old $80k floor snaps to $100k. The
migration note turns the condo edge into a feature callout ("condos can now
sell as low as $50k", below the old floor). Forged rents (NaN, negative,
absurd) clamp then snap. Modern saves are untouched.
NFR4: Determinism: departure fuses and any scheduling behavior derive from the
seeded RNG and game clock only; save/reload reproduces identical outcomes.
NFR5: Hot-path budget: per-tick work stays sub-quadratic; departure checks ride
the existing satisfaction pass (no new per-unit scans inside per-person loops).
NFR6: Engine stays DOM-free (`src/engine/` rule); all UI lives in `src/ui/`.
NFR7: American English; no em-dashes in new prose; version bump per player
impact (minor for the pricing capability; minor for condo departures).
NFR8: Every build story runs the 4 quality gates plus `/gds-code-review` in the
same session; `patch` findings fixed, `defer` findings recorded in the backlog.
NFR9: Exporter/importer guarantees hold: exported files parse with zero
importer warnings; re-export stays byte-identical.

### Additional Requirements

- AR1: PR #164 is the base: `GameRules` already carries the three sink methods;
  the pricing split adds `priceOptions()` beside them (GDD §5.1).
- AR2: PARITY.md gains the pricing-split row; the elevator-scheduling row flips
  from "ratified out" to "planned parity" when the spec lands (GDD §5.4, §7).
  SUPERSEDED 2026-07-09: the calendar divergence no longer "stays", backlog
  `classic-calendar-parity` (P1 fast-follow) adopts the 12-day Classic calendar
  as its own epic; PARITY.md tracks that under that row, not here.
- AR3: Backlog rows: `pricing-split` closes when Epic 1 ships;
  `condo-eviction` already shipped v1.12.0 (Epic 2 becomes its verification/doc
  follow-up, not a new build); `elevator-scheduling` points at the spec docs
  (GDD §4).
- AR4: The importer's people records (`residents` seeds) and the exporter's
  refuses-Modern rule both interact with condo departures: a Modern tower still
  refuses export (standing cost, party ruling); importer-created Classic towers
  must never carry departure state.
- AR5: Canon dollar tables are single-source (Relentless Optimizer); each rung
  table carries a provenance comment and a "verify against the manual if it
  becomes readable" note (GDD §2). The archive.org manual check stays an open
  owner follow-up (GDD §6.1).
- AR6: New builds default to the Average rung (GDD §6.3; the engine already
  defaults to cfg.default), distinct from the importer's byte-4 No Rate
  mapping. Story text references the GameRules method names as merged on main
  from PR #164 (the GDD's noiseErosionRate vs the shipped noiseErosionScale),
  verified at dev time.
- AR7: Two Epic 2 interactions are INTENDED, documented so nobody "fixes"
  them: a departure drops population but the star rating stays (the ratchet
  holds; star-falling is a parked epic), and a vacated condo returning to
  market re-arms the Modern hold tax (neglect carries an economic sting).

### UX Design Requirements

UX-DR1: The Classic rent dropdown uses the ratified dialog grammar (design
system: `.field` select styling, one primary per dialog, 36px touch targets
under pointer:coarse) and shows the 1994 color coding (Blue/Green/Yellow/Red)
with the dollar value per rung plus a "No Rate" entry.
UX-DR2: The batch-pricing dialog in Classic swaps its range editor for the same
rung dropdown ("Set all offices to Average"); Modern's dialog is unchanged.
UX-DR3: A condo on departure notice reuses the existing inspector countdown
pattern from tenant churn (live countdown + cause + what rescinds it), not a
new widget.
UX-DR4: Rung changes announce through the existing single-throat a11y announce
path with pinned strings; the dropdown is keyboard-operable.
UX-DR5: The scheduling spec must include a UX section designing the per-shaft
schedule editor against the design system (this is spec output, not build).

### FR Coverage Map

FR1: Epic 1 - priceOptions(kind) shape split on the rules seam
FR2: Epic 1 - full canon rung tables with provenance comments
FR3: Epic 1 - editor renders dropdown/stepper off the return shape
FR4: Epic 1 - real No Rate engine state, importer class-4 mapping
FR5: Epic 1 - Unit.rent stays a number; math re-anchors on canon Average
FR6: Epic 1 - Classic batch pricing becomes "set all to level"
FR7: Epic 1 - Classic condo floor 50k (below cost); Modern keeps 80k
FR8: Epic 1 - exporter maps rungs and No Rate losslessly (round-trip)
FR9: Epic 2 - Modern patient flight risk fuse (spikes absorbed)
FR10: Epic 2 - household-aware departure speed; Classic stays sticky
FR11: Epic 2 - notice/countdown/rescind contract reused from tenant churn
FR12: Epic 2 - departure returns unit to market; sale economy untouched
FR13: Epic 3 - paired gdd-/arch- scheduling spec docs (model, UI, SCAN interaction, TDT bytes)
FR14: Epic 3 - spec resolves the named design forks explicitly

## Epic List

### Epic 1: Price like 1994 (the Classic/Modern pricing split)

A Classic player prices offices, condos, and hotel rooms exactly as the 1994
game offered: one color-coded dropdown with four canon rungs plus No Rate, at
the researched canon dollar values, batch-editable, surviving save/load and
round-tripping through .TDT export/import losslessly. A Modern player notices
nothing: the continuous ranges stay. Lands as one PR (GDD §5.5), minor bump.

**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8
**NFRs in scope:** NFR1, NFR2, NFR3, NFR6, NFR7, NFR8, NFR9; UX-DR1, UX-DR2, UX-DR4
**Dependencies:** PR #164 merged (GameRules seam + GDD). Standalone thereafter.

### Epic 2: Condos you can lose (Modern patient flight risk)

A Modern player's sold condos become a bet they placed: an owner absorbs spikes
but leaves under sustained neglect (or, since v1.12.0, a life-event relocation
roll), sooner for a big family, and the satisfaction heatmap becomes an
instrument instead of a mood ring. Classic condos stay 1994-sticky. RECONCILED
2026-07-09: the mechanic shipped in main (arch-condo-stickiness neglect fuse +
`condo-eviction` v1.12.0 relocation), so this epic is now VERIFICATION and
DOCUMENTATION, not a new build. Lands as one PR, patch bump (tests + docs).

**FRs covered:** FR9, FR10, FR11, FR12
**NFRs in scope:** NFR1, NFR2, NFR4, NFR5, NFR7, NFR8; UX-DR3
**Dependencies:** PR #164 merged (noiseErosionScale gating defines the Classic
baseline) and `condo-eviction` v1.12.0 (the relocation path to verify against).
Independent of Epic 1.

### Epic 3: Design the 1994 elevator schedule (spec-first)

The owner-ratified full-parity elevator scheduling epic starts the way the
roadmap requires: paired gdd-/arch- documents that design the 1994 per-day-type
scheduling model, its per-shaft UI, the interaction between a manual schedule
and our automatic SCAN dispatch, and the TDT 56-byte schedule block mapping for
import/export round-trip. The build stories are cut from the approved spec in a
later pass; this epic's deliverable is the approved spec itself.

**FRs covered:** FR13, FR14
**NFRs in scope:** NFR7 (prose rules); UX-DR5 (schedule editor UX section)
**Dependencies:** none (docs only; canon doc + owner ruling already on record).

### Story-ordering rules (elicitation + party, 2026-07-08)

- Epic 1 builds ENGINE-STATE-FIRST as story numbering, not prose: the No Rate
  state, canon rung tables, and snap migration land before any dropdown UI
  story exists to touch them.
- Epic 3's spec story carries the schedule-vs-SCAN interaction section as a
  hard acceptance criterion; a spec that dodges it does not pass.

### Epic ordering and independence

Epic 1 and Epic 2 are independent of each other (different engine surfaces:
pricing/editor vs satisfaction/churn; both extend the GameRules seam with
different methods). Epic 3 is docs-only and independent. All three assume PR
#164 is merged. Recommended order: 1 then 2 then 3, purely for review focus;
nothing blocks running them in parallel sessions.

## Epic 1: Price like 1994 (the Classic/Modern pricing split)

A Classic player prices offices, condos, and hotel rooms exactly as the 1994
game offered; a Modern player notices nothing. Engine-state-first ordering:
stories 1.1-1.3 build the engine truth, 1.4-1.5 surface it, 1.6 closes the
round-trip. One PR, minor bump.

### Story 1.1: The engine knows the 1994 rent ladder

As a Classic player,
I want my tower's economy to price against the real 1994 rent rungs,
So that income and move-in behavior match the original game.

**Acceptance Criteria:**

**Given** a Classic tower
**When** the engine asks `rules.priceOptions(kind)` for a rentable kind
**Then** it returns the discrete ladder: the four canon rungs (office
2k/5k/10k/15k; condo 50k/100k/150k/200k; hotel single 500/1500/2000/3000,
double 800/2000/3000/4500, suite 1500/4000/6000/9000) plus a No Rate sentinel
**And** each rung table carries the provenance comment (Relentless Optimizer,
single-source, "verify against the manual if it becomes readable") (FR2, AR5).

**Given** a Modern tower
**When** the engine asks `rules.priceOptions(kind)`
**Then** it returns today's continuous `{min, default, max, step}` band
unchanged (FR1)
**And** no call site outside `gameRules.ts` branches on the mode string (NFR1).

**Given** any tower
**When** income, satisfaction, or move-in math runs
**Then** it still keys off `rentOf(u)` as a raw number vs the neutral anchor,
re-anchored in Classic onto canon Average (FR5)
**And** a new Classic build defaults to the Average rung (AR6).

**Given** the merged main after PR #164
**When** the story is implemented
**Then** it references the GameRules method names as actually shipped
(verified at dev time, AR6).

### Story 1.2: No Rate takes a unit off the market

As a Classic player,
I want to mark a unit No Rate like the 1994 dropdown allowed,
So that it charges nothing and stops accepting tenants until I price it.

**Acceptance Criteria:**

**Given** a vacant Classic office at No Rate
**When** move-in evaluation runs for any number of days
**Then** no tenant ever moves in and the unit earns nothing (FR4).

**Given** an OCCUPIED Classic unit set to No Rate
**When** the economy and satisfaction passes run
**Then** the tenant stays (never evicted), pays nothing, and still counts in
the rating census (FR4, canon cheap-rent lever endpoint).

**Given** a .TDT import whose tenants carry rent-class byte 4
**When** the tower is created
**Then** those units land in No Rate exactly (not default rent) and vacant
class-4 units do not flood with zero-rent tenants afterward (FR4).

**Given** a Modern save forged to carry a No Rate flag
**When** it deserializes
**Then** the flag coerces away through a GameRules method (seam law, like
coerceResidents); Modern's engine never holds the state (FR4, NFR2).

### Story 1.3: Old Classic towers snap onto the ladder

As a returning Classic player,
I want my pre-split save to load cleanly onto the canon rungs,
So that the new dropdown always tells the truth about what my units charge.

**Acceptance Criteria:**

**Given** a pre-split Classic save with continuous rents
**When** it loads
**Then** every stored rent snaps once to the nearest canon rung, ties rounding
UP, uniformly for every kind with no special cases (NFR3).

**Given** the golden migration fixture
**When** it runs
**Then** it pins each old value to its expected rung by name, including the two
sharp edges: an office at the old $20k max lands on High $15k, and a firesale
condo at the old $80k floor lands on $100k (NFR3)
**And** tower income before/after is asserted so the shift is visible in review.

**Given** forged rents (NaN, negative, absurd) in a hostile save
**When** it loads
**Then** values clamp then snap; nothing non-finite or off-ladder survives into
a Classic tower (NFR2, NFR3).

**Given** a Modern save
**When** it loads
**Then** rents are untouched (NFR3).

**Given** the release notes for the version
**When** the migration ships
**Then** they state the snap plainly and carry the feature callout: condos can
now sell as low as $50k, below the old floor (NFR3, party ruling).

### Story 1.4: The Classic rent dropdown

As a Classic player,
I want the unit editor to offer the 1994 color-coded rent dropdown,
So that pricing feels exactly like the original.

**Acceptance Criteria:**

**Given** a Classic tower and a rentable unit selected
**When** the editor renders the price control
**Then** it shows a dropdown with the four color-coded rungs
(Blue/Green/Yellow/Red = Very Low/Low/Average/High) with dollar values, plus
No Rate, chosen off the SHAPE of `priceOptions()`'s return, never the mode
string (FR3, NFR1, UX-DR1).

**Given** a Modern tower
**When** the editor renders the price control
**Then** the existing stepper/range appears unchanged (FR3).

**Given** a SOLD Classic condo
**When** the editor renders
**Then** the dropdown is disabled: sold condos are price-locked (FR7).

**Given** an unsold Classic condo
**When** the player opens the dropdown
**Then** Very Low $50k is offered (below build cost, canon firesale) while
Modern keeps its 80k floor (FR7).

**Given** keyboard or assistive-tech interaction
**When** the player changes a rung
**Then** the dropdown is fully keyboard-operable and the change announces
through the existing single-throat announce path with pinned strings (UX-DR4)
**And** the control uses the ratified dialog grammar (.field select, 36px touch
targets under pointer:coarse) (UX-DR1).

### Story 1.5: Set all offices to Average

As a Classic player,
I want batch pricing to speak in rungs,
So that I can reprice a whole kind the way the original's dropdown thought.

**Acceptance Criteria:**

**Given** a Classic tower with several offices at mixed rungs
**When** the player uses batch pricing and picks a level
**Then** every unit of that kind snaps to the chosen rung (or No Rate), sold
condos excepted (they stay locked) (FR6, FR7).

**Given** a Modern tower
**When** the player opens batch pricing
**Then** the existing range editor appears unchanged (FR6, UX-DR2).

**Given** batch-set to No Rate on a kind with occupied units
**When** it applies
**Then** occupied units keep their tenants (pay nothing, still counted), vacant
ones go off-market; no eviction wave (FR4, FR6).

### Story 1.6: Rungs survive the trip to 1994 and back

As a player moving towers between Verticopolis and SimTower,
I want rent levels to round-trip losslessly,
So that a Classic tower means the same thing in both games.

**Acceptance Criteria:**

**Given** a Classic tower with units on every rung and one No Rate unit
**When** it exports to .TDT and re-imports
**Then** every unit's rung and the No Rate state come back exactly
(classFromRent maps rungs to bytes 0-3 and No Rate to byte 4, both directions)
(FR8, FR4).

**Given** any exported Classic tower post-split
**When** the importer parses it
**Then** zero warnings are raised and re-export stays byte-identical (NFR9).

**Given** the exporter's reverse fidelity report
**When** a post-split Classic tower exports
**Then** the "rents snap to four classes" stays-behind line no longer applies
(rents are already rungs) and the report reflects that honestly (FR8).

### Story 1.7: The seam law becomes a tripwire

As a developer on either mode,
I want the "no mode branches outside GameRules" law enforced by the test suite,
So that Classic and Modern can never re-jumble as the seam grows.

**Acceptance Criteria:**

**Given** the engine and game sources (src/engine, src/game, src/ui, src/main.ts)
**When** the tripwire test runs
**Then** it fails on any mode-string branch ("classic"/"modern" comparisons or
mode conditionals) outside gameRules.ts, with an allowlist only for the ratified
exceptions: construction defaults, the GameMode type guard, and the new-tower
picker UI (NFR1).

**Given** a future PR that adds `if (mode === "modern")` anywhere in the
simulation
**When** the suite runs
**Then** the tripwire names the file and line in its failure message, so the
review conversation starts from the law.

**Decision provenance (sim-split party, 2026-07-08):** a ModernSimulation
subclass was steelmanned and rejected: polymorphic construction would let a
forged save pick its own attack surface before validation (deserialize hardens
once, in one class), inheritance ships every Classic bugfix into Modern
silently, and the modes disagree rather than stack. Revisit GROUPING the
GameRules interface (`rules.economy.*`, `rules.pricing.*`) if it grows past
roughly a dozen methods; never subclassing. Recorded in the backlog.

## Epic 2: Condos you can lose (Modern patient flight risk)

> **RECONCILED 2026-07-09 (reconciliation party) against main as shipped.**
> Two things happened in parallel that overtook this epic's original plan:
> (1) `arch-condo-stickiness` shipped the "patient" neglect fuse as a gentle
> erosion RATE (`CONDO_NOISE_EROSION = 0.054`), so a sold condo already erodes
> slowly and vacates on sustained neglect via the `satisfaction <= 0` notice,
> and a spike the player fixes in time never reaches 0. (2) A separate session
> shipped `condoRelocationChance` (a Modern life-event departure roll) that
> reuses the SAME `vacate()` buy-back path. So the mechanic this epic set out
> to build is, in substance, already in main. Two original rulings are
> OVERTURNED here because the code they assumed does not exist:
>
> - **The "accumulator with decay" fuse is dropped.** Main shipped the erosion
>   RATE approach and it satisfies the same intent (spikes never evict; only
>   sustained neglect does). Building a second accumulator would rip out
>   shipped, tested code for no behavior gain.
> - **The "$0 resale sting" is dropped: it was factually wrong.** `vacate()`
>   charges the player the buy-back (`householdPrice(rentOf, residents)`) and
>   then CLEARS `everOccupied`, so the unit resells FRESH. The sting is the
>   repurchase, not a zeroed resale. Winston's relocation point stands: that
>   buy-back is a self-scaling sink (you repurchase big households at their
>   inflated price, resell toward the mean 3, and eat hold-tax + overhead while
>   it sits empty). That IS the flight-risk consequence, already in main.
>
> What is genuinely LEFT for this epic is verification and documentation, not a
> new mechanic. Neglect-departure and relocation-departure must be proven to
> coexist on the one shared `vacate()` spine without double-counting, and the
> economics must be documented so nobody re-opens "condos need a sting."
> One PR, patch bump (tests + docs; no new player-facing mechanic).

### Story 2.1: Neglect and relocation coexist on one vacate spine

As a Modern player,
I want a condo I neglect and a condo whose household relocates to behave
coherently,
So that the two departure paths never double-charge me or contradict each
other.

**Acceptance Criteria:**

**Given** a Modern sold condo on a neglect notice (`state === "vacating"`,
a satisfaction-cause reason)
**When** the monthly relocation roll runs
**Then** the roll skips it (its `state !== "occupied"` guard already holds), so
a unit can never carry both a neglect and a relocation notice at once (FR9).

**Given** a Modern sold condo already on a non-rescindable `relocation` notice
**When** its satisfaction later drops
**Then** the notice stays `relocation` and never rescinds or re-attributes (the
shipped `isRelocation` guard), so neglect cannot hijack a life-event departure
(FR9, FR11).

**Given** two identical Modern condos, one housing 5 residents and one 2, both
under identical sustained neglect
**When** each vacates
**Then** the 5-person buy-back costs more than the 2-person (household-scaled
via `householdPrice`), so bigger families both leave the same way and hurt
more, no new household math invented (FR10).

**Given** a Classic tower
**When** any condo endures any satisfaction history or a monthly tick
**Then** no relocation ever rolls (`condoRelocationChance` returns 0, guarded
before the RNG draw so the seeded stream is byte-identical) and neglect uses
the gentle `CONDO_NOISE_EROSION` fuse, matching arch-condo-stickiness; only the
access walkout is immediate (FR10, 1994-sticky).

**Given** a save/reload with a unit mid-notice under either reason
**When** the tower resumes
**Then** `state`, `vacateReason`, and `vacateAt` reproduce exactly and forged
values coerce safely, verified by test (NFR2, NFR4).

### Story 2.2: The owner tells you before they go (both reasons)

As a Modern player,
I want every condo departure to give notice I can read,
So that losing a condo is never a silent surprise, whatever the cause.

**Acceptance Criteria:**

**Given** a condo on a neglect notice
**When** the player inspects it
**Then** the inspector shows the live countdown, the satisfaction cause, and the
recovery target, and recovering above the rescind bar keeps the owner (the
shipped tenant-churn contract) (FR11, UX-DR3).

**Given** a condo on a `relocation` notice
**When** the player inspects it
**Then** the inspector shows the countdown and the non-blaming life-event copy,
and makes clear it CANNOT be rescinded (a life event is not a complaint), so
the two notice types read distinctly (FR11, UX-DR3).

**Given** a tower losing floor access under a condo
**When** the access walkout triggers
**Then** it behaves exactly as today (immediate, cause `access`), unchanged by
either notice path (FR11).

### Story 2.3: The departure economics are documented, not rebuilt

As a maintainer,
I want the shipped condo-departure economics pinned and documented,
So that no future change silently re-opens "condos need a sting" or forks the
one vacate path.

**Acceptance Criteria:**

**Given** any owned Modern condo that vacates (neglect OR relocation)
**When** it leaves
**Then** the player pays the buy-back `householdPrice(rentOf, residents)`,
`everOccupied` clears, and the unit resells fresh, one shared path, pinned by a
test that exercises BOTH reasons through it (FR12).

**Given** the vacated unit sitting unsold in a Modern tower
**When** the monthly economy runs
**Then** the condo hold tax and per-unit overhead charge against it (re-armed by
vacancy), documented as the intended self-scaling sink, not a bug (AR7).

**Given** the population drop from a departure
**When** star evaluation runs
**Then** the rating ratchet holds (no star falls; star-falling is a parked
epic), documented as intended (AR7).

**Given** PARITY.md and the backlog
**When** this epic ships
**Then** they record that the buy-back is the flight-risk consequence
(self-scaling by household) and that neglect + relocation share one vacate
spine, so the design intent survives without the code being re-derived (FR12).

## Epic 3: Design the 1994 elevator schedule (spec-first)

The owner-ratified full-parity scheduling epic starts with its paired spec
docs; the build stories are cut from the approved spec in a later pass. The
schedule-vs-SCAN interaction section is a hard acceptance criterion.

### Story 3.1: The scheduling GDD

As the owner of a parity promise,
I want a design doc for 1994 per-day-type elevator scheduling,
So that the build matches the original instead of our guess about it.

**Acceptance Criteria:**

**Given** the canon sources (docs/canon/tdt-format.md elevator record, the FAQ
canon summary, clean-room only, upstream source archives untouched)
**When** gdd-elevator-scheduling is authored
**Then** it specifies the 1994 model: what a schedule controls (cars in service
per day-type segment), per-shaft scope, and day-type semantics (FR13).

**Given** the named design forks
**When** the doc lands
**Then** each is resolved explicitly: an untouched schedule leaves SCAN
behavior exactly as today (default = no regression), and the feature is parity
(both modes, identical) (FR14).

**Given** the design system contract
**When** the doc's UX section is written
**Then** it designs the per-shaft schedule editor against the ratified dialog
grammar (UX-DR5).

### Story 3.2: The scheduling architecture note

As the keeper of the SCAN dispatcher,
I want an architecture doc before anyone layers a manual schedule on it,
So that the two systems compose instead of fighting.

**Acceptance Criteria:**

**Given** the approved gdd-elevator-scheduling
**When** arch-elevator-scheduling is authored
**Then** it specifies the schedule-vs-SCAN interaction precisely (what SCAN
consults, when, and what happens to calls a schedule strands); a doc that
dodges this section does not pass (FR13, hard AC).

**Given** the TDT elevator record's 56-byte schedule block, which the exporter
already emits as the game's DEFAULT block (`TDT_ELEVATOR_SCHEDULE_DEFAULT`,
shipped v1.14.0 so real SimTower loads our files with working cars)
**When** the arch doc lands
**Then** it maps the bytes both directions for PLAYER-EDITED schedules layered
on that default (import reads a non-default block into per-shaft schedules;
export writes the player's schedule, falling back to the default block for
shafts the player never touched) and names the importer/exporter changes
required (FR13).

**Given** the engine's constraints
**When** the doc lands
**Then** it carries the load-bearing invariants at the top (determinism,
hot-path budget, engine DOM-free, no mode conditionals outside GameRules if
any divergence appears) (NFR1, NFR4, NFR5, NFR6).
