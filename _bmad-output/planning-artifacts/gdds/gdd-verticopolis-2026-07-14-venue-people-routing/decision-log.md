# Decision Log - Venue People Routing GDD

2026-07-14 (headless create, gds-gdd)

- Intent: create. Game type: simulation (existing project). Scope taken from
  the user request: people routing for party hall, cinema honest attendance,
  wedding hall, and "the others"; metro explicitly excluded (owned by another
  agent).
- Investigated engine state first: venue destination set
  (`crowd/spawn.ts:isVenue`) covers shop/restaurant/fastFood/cinema; party
  hall and wedding hall receive no routed people; cinema's population-0
  catalog entry keeps its customer tally and `occupants` at 0 (backlog item
  "entertainment honest-attendance").
- DECISION: attendance is derived from real routed round-trip visitors, not a
  statistical or booking-derived number. Rationale: the user asked for
  routing; the frozen art spec forbids ghost crowds; the meal round-trip
  machinery already provides balanced accounting.
- DECISION: new catalog field `attendance` (cinema 30, partyHall 20,
  weddingHall 12) rather than reusing `population`, which would leak into the
  census. Census neutrality pinned as an invariant with tests.
- DECISION: `occupants` mirrors the live tally for the three kinds so the
  shipped occupancy-gated art fills with zero render changes (bake signature
  already includes `occupants`). Mirror resets on load with the transient
  tally.
- DECISION: cinema moves from one-way ambient visits to round-trip attendance
  visits; food/retail keep existing behavior. Late-night meal trips to cinema
  now also register attendance.
- DECISION: canon touches included: hotel guests mingle at the party hall
  (hotel-origin visits), weddings are weekend-only (11:00-14:00 arrival
  window), blockbuster doubles the cinema's visit-option contribution.
- DECISION: "one wedding per weekend day" modeled as a weekend midday visit
  window, not a scheduled event object (simplest thing that reads correctly).
- DECISION: no income changes anywhere; party hall and cinema keep
  statistical traffic income. Matches the meal-cadence precedent ("make the
  shafts feel the demand, leave the economy alone").
- Out of scope recorded: metro (other agent), parking (statistical by
  design), unreachable-venue advisories, monetization of the wedding hall.
- Assumptions tagged in gdd.md: attendance caps and dwell windows are
  tunable design numbers, not canon figures.

2026-07-14 finalization

- Headless run: validation subagent skipped in favor of the mandatory
  post-implementation `/gds-code-review` in the same session (this GDD feeds
  an immediate implementation, and the review skill's adversarial layers
  audit the acceptance criteria against the code).
- Artifacts: gdd.md, epics.md, decision-log.md in this folder.
