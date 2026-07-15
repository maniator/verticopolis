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

2026-07-14 post-implementation review (/gds-code-review, same session)

- Three adversarial layers ran (Blind Hunter, Edge Case Hunter, Acceptance
  Auditor). Patched findings, all fixed and re-verified on the branch:
  - The occupants mirror leaked into ElevatorDispatch's statistical demand,
    double-counting attendees who already place real hall/cab calls (and
    keeping phantom demand alive after closing). Fixed: the dispatch's
    per-unit demand loop skips attendance kinds; pinned by a test.
  - beginDwell could register attendance on a venue that caught fire or was
    gutted mid-trip, and syncAttendanceOccupants could re-stamp audience art
    onto a ruin while a stale tally drained. Fixed: arrival recheck on
    isOperational, and the mirror writes 0 for non-operational venues.
  - The blockbuster boost picked a cinema floor uniformly before weighting
    candidates, so multi-floor layouts sent most of the boost to plain
    cinemas. Fixed: the extra option targets only blockbuster floors.
  - The epics' promised regression tests were missing (drain-to-zero,
    give-up balance, mid-dwell bulldoze, return-to-floor-1,
    ratingPopulation + spatialCongestionByFloor neutrality, hotel-origin
    split stays zero, unreachable wedding hall, traffic-loop tenancy,
    dwell-window pins, population/attendance mutual exclusivity). Added.
- DECISION (was flagged as a deviation): dwell keys on the venue kind, so a
  late-night meal round-trip to the CINEMA adopts the 90-120 min showing
  window instead of the 30-60 meal window; food venues keep 30-60. Rationale:
  at a cinema you stay for the film regardless of why you came. Epics wording
  updated; dwell windows pinned by test.
- Deferred (recorded in implementation-artifacts/backlog.md): party hall 2:1
  option weight in hotel towers, hotel-mingle floor-first sampling, and the
  single-decrement-path rule for the tally.
- Dismissed: TDT import phantom audience (import derives occupants from the
  catalog population, which is 0 for attendance kinds).

2026-07-15 PR review follow-ups (Copilot + owner direction)

- DECISION (owner): visit origins generalize beyond "lobby or hotel" into a
  per-venue origin matrix: outside / condo / office / hotel, with staff kinds
  deliberately excluded (on shift; meals are their sanctioned break). The
  room-origin path reuses the meal spawn's bucket predicate
  (matchesMealOriginKind) and outForMeal accounting, so the two flows cannot
  drift. Census-neutral by construction: ratingPopulation sums censusCount
  per room (origin rooms keep counting their residents while they are out)
  and never reads outForMeal.
- DECISION (owner): the outside origin is named "outside", not "lobby": the
  ground lobby is where street visitors materialize today, not where they
  are from. A TODO at the resolution site names the metro platform (PR #294)
  as the future second street door so venue visitors can also arrive by
  train.
- Copilot review: renamed the person state "eating" to "dwelling" and
  eatSecondsLeft to dwellSecondsLeft (the state now covers showings, parties,
  and weddings, not just meals); replaced the `1 | "hotel"` origin union with
  the self-describing VisitOrigin union.
