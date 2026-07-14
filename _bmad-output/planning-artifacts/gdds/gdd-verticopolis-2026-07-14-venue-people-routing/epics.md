# Venue People Routing - Development Epics

Epic E1: Route real people to the party hall, cinema, and wedding hall, and
derive honest visible attendance from them. Review skill: `/gds-code-review`
(gameplay/engine work).

## E1-S1: Attendance ledger and census-neutrality guards

- Add optional catalog field `attendance` to the `Facility` type; set cinema
  30, partyHall 20, weddingHall 12 in `facilitiesData.ts`. Helper
  `attendanceCap(kind)` beside the other facility predicates.
- Split the arrival-side counting gate in `crowd/motion.ts`: census venues
  (commercial, population > 0) keep the catalog-population clamp; attendance
  venues (attendance cap set) count against the cap. Over-cap arrivals attend
  uncounted (`venueUnitId` stays unset), mirroring the meal rule.
- Mirror `occupants = customersIn` for attendance kinds at every tally
  change; zero the mirror on load next to the existing `customersIn` strip in
  `sim/coerce.ts`; keep hourly presence/traffic passes from stamping catalog
  0 over the mirror while open.
- Tests: tally increments/decrements balanced across finish paths (return,
  give-up, mid-dwell bulldoze); cap enforcement; `totalPopulation`,
  `ratingPopulation`, and `spatialCongestionByFloor` identical with and
  without attendees; load resets the mirror.

## E1-S2: Entertainment visit flow (cinema + party hall)

- New spawn contributor `pushVenueVisitOptions` (additive, like
  `pushMealOptions`): lobby-origin round-trip visits to open, tenanted,
  reachable cinema and party hall floors, binned once per outer step in
  `spawnFloors`.
- No-origin return leg: a round-tripper without `originUnitId` returns to its
  outbound origin floor (`floors[0]`) after dwell instead of despawning at
  the venue; ghost-origin behavior (origin unit bulldozed) is unchanged.
- Per-kind dwell windows (cinema 90-120 game-min, party hall 60-120) applied
  at dwell entry; food venues keep the 30-60 eating window. The dwell keys on
  the VENUE kind, so a late-night meal trip whose venue is the cinema adopts
  the showing window (you stay for the film), a reviewed decision.
- Cinema leaves the one-way `openVenues` ambient pool; late-night meal
  round-trips to cinema now register attendance via the S1 gate.
- Blockbuster weighting: a cinema showing a blockbuster contributes its visit
  option twice per spawn round.
- Tests: visitors only during open hours; unreachable venue receives nobody;
  attendance rises and drains across an evening; blockbuster doubles option
  contribution; return leg completes to floor 1.

## E1-S3: Party hall hotel-guest mingling

- Hotel-floor origin option for party hall visits, reusing the meal
  round-trip origin accounting (`originUnitId`, `outForMeal`,
  `visibleOccupants` thinning, hotel-guest census split flag).
- Tests: hotel room thins while its guest attends; accounting balances on
  give-up; census neutrality holds for hotel-origin attendees.

## E1-S4: Weekend wedding visits

- Wedding-guest visit options: weekends only, 11:00-14:00 arrivals, ground
  lobby origin, operational + reachable wedding hall, attendance cap 12,
  dwell 120-180 game-min.
- No income, census, or win-flow changes.
- Tests: weekday and off-window hours spawn no guests; weekend window fills
  and disperses; unreachable hall receives nobody.
