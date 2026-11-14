# Engine changelog

Release notes for the engine crate (`engine-rs/Cargo.toml`), one `## <version>`
section per crate version, newest first, written for people who build on the
engine. The player-facing notes live in [`CHANGELOG.md`](../CHANGELOG.md), one
section per app version. A crate bump adds its section here in the same PR
(`src/tests/engineChangelog.guard.test.ts` enforces it). Describe what changed
in the engine's contract and behavior: saves, frame and view layouts, the
catalog, identity, the binding, and rules. An engine change a player can feel
also gets a line in the app changelog.

Entries up to 0.24.0 were written afterward from the history of the commits that
raised the version, so they are documentation only.

There is no entry for 0.17.0, which only
existed as a step inside a stacked branch.

## 1.30.3 (2026-11-14)

- The far-from-a-lobby trade penalty for venues counts a working Metro platform (the station's middle story) as a place shoppers arrive, in both the hourly takings and the service diagnostics' `lobbyFar` fact.

## 1.30.2 (2026-11-14)

- A rider no longer gives up while aboard a car: they ride to their floor, and step out of the trip only when their car, their shaft or their floor's stop goes. The conformance lock moves.

## 1.30.1 (2026-11-13)

- `Tower::nearest_lobby_floor_distance` counts a tall lobby hall (#308) on every story it fills, so a floor over a 3-story hall on floor 30 is one floor from it (it was three). The commercial lobby penalty, its card fact `commercial.lobbyFar`, the tenant lobby-distance drain and the card's `lobbyDistance` all read it. One-story lobbies and floors below a hall are unchanged, and no conformance scenario moves.
- An elevator rider walks to the back of the landing's line and starts waiting there, rather than at the middle of the shaft; this moves the conformance lock.

## 1.30.0 (2026-11-13)

- Each crate release is published to crates.io as `verticopolis-engine`, and its WASM build to npm as `@verticopolis/engine` (earlier versions are `@maniator/verticopolis-engine` on GitHub Packages, which gets no new versions).
- The gameplay event catalog lives inside the crate now, at `engine-rs/src/gameplay/catalog.json`, so the packaged crate builds on its own; `gameplay::CATALOG_JSON` and the conformance lock digest are unchanged.
- The crate and npm READMEs are short pages that link the full guides on docs.verticopolis.com.
- While any guard is still out searching for a bomb (`Simulation::bomb_lockdown`, both modes), a step skips the crowd and the cars (no arrivals, walks, rides, car moves or elevator demand) and the hourly housekeeping pass sends no maids. The clock, the hourly and daily rules and the guards' search go on. A bomb nobody searches for freezes nothing. `bombSearch()` adds `lockdown`, so a renderer can tell.
- During that lockdown every edit is refused with `BOMB_SEARCH_EDIT_REFUSAL` (`Simulation::edit_refusal`): `can_build`, `build`, `paint_brush`, `can_build_transport`, `build_transport`, `remove_facility`, `sell_at`, `add_car`, `remove_car` and `extend_transport` on the crate, the new `edit_stop`, `edit_express_stops`, `edit_clear_stops` and `edit_schedule` (the player's stop and schedule changes, which the binding now routes through), and undo and redo (a refused step is kept for after the search).
- The conformance lock moves for `ransom-declined-classic`, `ransom-declined-modern` and `ransom-ignored-modern`; the last now waits a day for its search to end before it sells Security. No other scenario, frame-day case or fuzz entry moves.
- The binding's test and tooling calls (`setMoney`, `setCars`, `startFire`, the bare edits, the clock and seed calls and the rest of tier 3) are built only with the new `tooling` feature, so the shipped game and the npm package no longer carry them.
- The catalog's `rules` gains `shadedLook` (Modern true, Classic false) and `fedUpWait`, the wait in minutes past which a person is fed up (catalog version 17).
- The catalog's `rules` gains `decorativePassersBy` (catalog version 16): Classic false, Modern true.
- Saves are version 9 when they hold a tall lobby: `lobbyHeights` lists one `[floor, x0, x1, height]` entry per hall, and a version 8 `[floor, height]` entry still loads as one height over every lobby tile on that floor.
- `lobbyHeights()` returns `[floor, x0, x1, height]` quads, `lobbyRise(floor, x)` takes the column, and `walkwayTop(kind, x, bottom, top)` takes the flight's column.
- In Modern a tall lobby claims the raised stories over its own tiles only, and a shaft skips a raised story only where it passes through a tall hall.

## 1.29.0 (2026-11-13)

- Modern dispatch: a car parked on a stop whose call it owns (`DispatchRules::parked_owner_boards`, `GameMode::parked_owner_boards_its_floor`) boards the statistical estimate there as an arrival does, opening and dwelling, counting the ride, the load and the origin tally. The best-car choice had given it the call while its sweep only looks ahead, so the estimate on a parked car's floor was never boarded. Classic is unchanged.
- The conformance lock moves for the sixteen Modern scenarios with elevators, the frame-day golden for the two split-tower saves, the fuzz golden for `smoke-modern-five-star` and the Modern every-transport card text; no Classic scenario, frame-day case, fuzz entry or card moves.
- Docs: Modern's spread homes are never written to the schedule or a save, but a save keeps where each car stands and a `.TDT` export takes an unhomed car's home from there, so a save exported as Classic with a car parked at its spread stop records that stop as its home (a Modern tower is still refused).
- A retail room's row in the `.TDT` retail table is written in bytes 6 and 7, low byte first (`tdt::retail::with_row_high`); before, a row past 255 wrapped to an earlier room's. `TdtTenant` gains `row_high` (byte 7), and the import tries the rows 256 apart and keeps the one that names the room back, so files written with one byte still read.

## 1.28.0 (2026-11-13)

- Modern dispatch assigns each hall call to one on-shift car per step (`GameMode::elevators_send_the_best_car`): a car heading to the call within Waiting Car Response wins outright, else the lowest cost in floors (travel, a wrong-way car's trip out to its farthest promised stop and back plus the span, its dwell left and a dwell per promised stop). The span-less-response reach gate is retired from both modes.
- Modern cars with no home idle at the lobby (car 0) or stop `i * stops / cars` (`GameMode::spreads_unset_car_homes`); `schedule_facts` reports the same homes, and in both modes reports an unhomed car in a shaft that serves no lobby at its first stop, where dispatch parks it (it said the unserved bottom floor). Runtime only: no save, schedule or `.TDT` change.
- Standard Floor Departure restarts on arrival in both modes; Modern caps the wait at twice the setting (`GameMode::departure_wait_limit`), replacing `GameMode::departure_wait_restarts_on_arrival`. Every Modern scenario's checkpoints move.
- Retail rooms and their retail table rows name each other as in the game's saves (#2044): a room's byte 6 is its row index, the row's byte 1 its logical unit id, byte 11 its style and byte 13 the game's 255 (`tdt::retail`). The import reads the style from the row a room's byte 6 names when that row names it back and carries the 255, else from byte 6, as our older exports wrote it. `TdtRetailRow` gains `row` and `style`; `OutTenant::subtype_idx` becomes `retail_row`. Export hashes in `conformance/tdt-cases.json` move.
- A theater with no film age exports a party hall and theater table row on its film's first day, so its screen pieces get their 56 people records.
- The `.TDT` exporter splits each theater floor into a 7-tile screen piece (types 35 and 34) and an auditorium piece (19 and 18). Both name the venue's table row in byte 6; the table names the screen pieces, and each screen piece owns 56 people records (type 18) named by its bytes 8 and 9 (`tdt::venue_people`).
- The people block's count is the records in use plus at least 256 spare, rounded up to a multiple of 256 (`people_pool_size`), with zero records padding the spare. Export hashes in `conformance/tdt-cases.json` move.
- `import_tdt` writes each elevator's per-car home floors (record byte 186) as the shaft's `schedule.homeFloors`, snapped to the nearest stop, and `export_tdt` writes the authored `homeFloors` back into those bytes, falling back to the cars' positions. The `.TDT` import case hashes move.
- Classic dispatch reads Waiting Car Response as the 1994 game does (`GameMode::waiting_car_response_watches_moving_cars`: a parked car leaves a call to an on-shift car heading to it within that many floors) and restarts Standard Floor Departure on each arrival (`GameMode::departure_wait_restarts_on_arrival`), boarding the arrivals against the car's load. Modern keeps its reach reading and fixed dwell. Every Classic scenario's checkpoints move; `ransom-declined-classic` now ticks 288 hours to its first bomb threat.
- `Simulation::set_lobby_height` and `with_lobby_height` set the height a floor's first lobby rises to, and `Tower::lobby_height`, `tall_lobbies` and `is_tall_lobby_story` read it back (#308).
- A floor's first lobby asked taller than one story where the mode keeps it one story (a Classic sky lobby) is refused with a reason instead of laid one story high.
- The binding adds `setLobbyHeight(height)`, `lobbyRise(floor)` (the stories a lobby tile laid there rises), `lobbyHeights()` and `walkwayTop(kind, bottom, top)` (the top a flight out of a tall lobby is built to).
- A save with a tall lobby is version 8 and carries `lobbyHeights`; a save without one stays version 7.
- The .TDT importer and exporter read and write the header's ground lobby height and the two- and three-story stair types.
- A person boards or leaves a car only while the dispatch lists it open at their floor (`ElevatorDispatch::open_cars`): arrived, dwelling or parked. A car that would end a move within 0.05 of its target lands on it. The conformance lock moves with the crowd and the cars.

## 1.27.0 (2026-11-12)

- The Modern halo table gains the aquatic center (6 floors, +0.035) and the party hall (3 floors, +0.02), both felt by homes and hotel rooms at every hour, with `AQUATIC_HALO_FLOORS`, `AQUATIC_HALO_MAX`, `PARTY_HALL_HALO_FLOORS` and `PARTY_HALL_HALO_MAX`. A two-story venue's halo counts from its nearer story (`Halo::distance`), and the hourly satisfaction step now reads the table row by row (`Halo::is_felt_at`), so `SatisfactionContext` holds `halo_floors` and `hour` in place of one floor list per venue. The catalog digests move.
- A bomb blast guts, on each floor within `BLAST_FLOORS` of the bomb, only the runs of floor tiles that overlap the run holding the bomb, so a tower standing apart on the same lot is spared.
- The bomb search sweeps stretches of floor (one run of floor tiles each, `events::stairs`) and routes guards over the emergency stairs between overlapping stretches. A guard's save entry adds `x`, `route` (the corners of its walk on the stairs, as floor and stairs tile) and `arrive`, the bomb adds `swept`, and `bombSearch()` adds `route` to each sweeping guard. Older saves load with whole-floor sweeps.
- A thief lands on a stretch of floor (one draw over each floor's stretches, the same draw as before when a tower fills its floors) and is caught only when a Security office reaches it by the stairs. `VIEW_LAYOUT_VERSION` is 22: the frame header appends `thiefFxX`, a tile of his stretch.
- The conformance lock moves: the three ransom scenarios change their state hash only, because the bomb search saves the new keys. Every other hash stays.
- Classic adds a third pooled cap, `venues` (party halls and theaters, 16), checked by `Tower::cap_reason` and the undo cap check through `facilities::pools_for(mode)`; Modern keeps 16 of each.
- The catalog's `pools` and each facility's `pool` follow the mode, and `CATALOG_VERSION` is 15.
- The `.TDT` exporter numbers each floor's units the way the original does (plain floor tiles get no logical id: `FF` in byte 12 and no index map entry), and each party hall or theater record names its venue table row in byte 6 (`tdt::venue_export`). Every export case hash in `conformance/tdt-cases.json` moves; imports are unchanged.
- Each party hall half now writes its 40 people into the people block, with its tenant record's bytes 8 and 9 naming the first (`tdt::venue_export::write_people`); without them the original crashed on load.

## 1.26.0 (2026-11-12)

- `satisfaction_step` reads congestion as the larger of the aggregate estimate and the floor's real commute wait over the mode's limit (`GameMode::commute_wait_congestion`, `CLASSIC_WAIT_LIMIT` = `GIVE_UP`, `MODERN_WAIT_LIMIT` = 1.5 x `GIVE_UP`). A trip that starts in a lobby or off a Metro train (`Person::from_metro`, set only by a Metro arrival) counts on the tenant floor it serves. The conformance lock, frame-day and port-edit goldens move.
- New `satisfaction::shortfall`: `Simulation::service_shortfalls()` answers the tower's `ServiceShortfalls` for the hour, and `binding_for(unit, served)` the `ServiceShort` (cause, coverage, sinks) that binds a room. `satisfaction_step` folds its drain (`SHORTFALL_CAP` at the Good line, `SHORTFALL_EROSION` 0.12 an hour when it sinks) into the step, and `StepResult` gains `service_short`. The move-in gate counts the newcomer in the need.
- New vacate and gripe causes `trash` and `parking`: saves keep them, the inspector's `gripeCoverage` carries their coverage, and the port's `vacateReasons` list appends both, so `VIEW_LAYOUT_VERSION` is 17.
- The conformance lock moves for `vip-review-modern` only (a Modern scenario at three stars with no parking).
- New `rules::Halo` and `HaloEffect`, with `GameMode::halos()`, `halo_of(kind)` and `halo_strength(halo, d, family_size)`: the Modern venues' cross-floor halos (fitness club, spa, daycare, nightclub) as one table, which a rule test holds the hourly satisfaction step to, kind by kind. Classic has none.
- The catalog's facility entries gain `halo` (effect, floors, max, capLift, feltBy, openHoursOnly, familyScaled), null for a venue with none; `CATALOG_VERSION` is 14.
- New `rules::NoiseRule`, `NOISE_RULES` and `noise_rule_for(kind)`: the same-floor noise rule (which rooms hear which neighbors, and over how many tiles) as one table, which the noise scan now reads in both modes, and `GameMode::shows_noise_reach()` (Modern). The catalog's facility entries gain `noise`, a list of `{ role: "carries" | "hears", tiles, kinds }`, empty in Classic.
- `DiagnosticFacts` gains `amenity` (the venue's kind key and its ceiling lift), and `unitFacts` gains the `amenity` (kind code) and `amenityLift` slots, so `VIEW_LAYOUT_VERSION` is 21. No conformance scenario moves; the catalog digests do.
- Modern satisfaction rules: the nightclub halo applies only in its open hours, with `NIGHTCLUB_NOISE_MAX` raised from 0.08 to 0.12, and the move-in gate walks its horizon hour by hour, counting the club only in its open hours; amenity halos lift a capped room's ceiling by up to `AMENITY_CAP_LIFT_MAX` (0.15); `Kind::is_quiet_venue` (spa, daycare) drops out of the same-floor noise check; the daycare's smallest-family share is 0.4. The Modern conformance scenarios and the split-tower frame-day golden move.
- The catalog's `rules` adds `buildsWhilePaused` (`GameMode::builds_while_paused`): false in Classic, true in Modern. The engine still has no paused state; a frontend that pauses refuses new placement where the rule is false. `CATALOG_VERSION` is 10, and the catalog digests move.
- The catalog's `rules` adds `exportsTo1994` (`GameMode::exports_to_1994`: true in Classic) and `quotesLobbyDistance` (`GameMode::quotes_lobby_distance`: true in Modern). The `.TDT` export refuses a tower by the first rule, and the web game's export dialog and tenant card read both instead of the mode's name. `CATALOG_VERSION` is 12, and the catalog digests move.
- New `Simulation::parking_short()`: a hotel suite lacks its space or offices are short by the mode's rule. The parking inspector's `shortage` reads it, `statsReport`'s `parkingDemand` gains `short`, and `statsSheet` gains `parkingShort` after `parkingCoverage`, so `VIEW_LAYOUT_VERSION` is 20.
- New `economy::tickets`: `TicketPrice` (key, label, `income_mult`, `pick_mult`), `GameMode::ticket_prices()`, `ticket_price_default()` and `ticket_price(key)`, and `Simulation::set_ticket_price(id, key)`, which answers the step set or `None` for a room that is no cinema or a step the mode does not list. Modern lists `low` (0.75 of Normal's income per seat, 1.25 of its visits), `normal`, `high` (1.3, 0.75) and `premium` (1.6, 0.55); Classic lists none.
- `Extras` gains `ticket_price`, saved as `ticketPrice` on a Modern theater whose step is not Normal; a Classic save or an unknown step loads as Normal. An undo step puts a ticket price back like a film policy.
- A theater's ticket income is multiplied by its step's `income_mult`. The crowd's cinema visits are weighed by `pick_mult`: the theaters' whole share of the spawn options by their mean, and each theater's floor and seat in the venue draw by its own. A tower whose theaters all charge Normal draws exactly as before, so the conformance lock's scenarios do not move; only the catalog digests do.
- The catalog's economy gains `ticketPrices` and `ticketPriceDefault`; `CATALOG_VERSION` is 11. The port gains `setTicketPrice(id, code)` (codes from the new `ticketPrices` layout list, record slot `priceCode`), and `unitCard` gains a `ticketPrice` slot, so `VIEW_LAYOUT_VERSION` is 16. `unitDetail` reports `ticketPrice` too.
- New `economy::screens`: `ScreenFilm` (tier, days, policy) and `Simulation::book_film(id, screen, tier)` and `set_screen_policy(id, screen, policy)`; `change_film` and `set_film_policy` book and set the first screen. `GameMode::cinema_screens()` is 1 in Classic and 2 in Modern; a screen the theater does not run is refused (`FilmRefusal::NoScreen`, reason `noScreen`, or `None`).
- `Extras` gains `second_screen`, saved as `screen2` (with the first screen's keys) only while a Modern theater's second screen differs from its first, so a theater whose screens match saves as before, and a save without one shows the first screen's film on both. A Classic save or another room reads none.
- A theater's census audience and its film income multiplier are the mean over its screens, and it fills a blockbuster slot when any screen shows the mode's blockbuster at full draw. Each screen ages each night and rebooks its own policy's film once spent, so a Modern theater whose two screens are spent books twice. Of the conformance lock's scenarios only `player-edits-modern` moves: its film policy now sets the first screen alone, so the save carries a second screen.
- An undo step puts back each screen's film policy; the undo signature counts a second screen's policy where it differs from the first's.
- The catalog's economy gains `cinemaScreens`; `CATALOG_VERSION` is 13. The port's `setFilm(id, code, screen)` and `changeFilm(id, tier, screen)` take a screen from 0, and `unitCard` gains `screen2Policy`, `screen2Days` and `screen2Tier`, so `VIEW_LAYOUT_VERSION` is 19. `unitDetail` reports `screen2`.
- `economy::films` gains `FilmTier` (`New`, `Classic`, `Blockbuster`), `FilmRules` and `FilmRun`; `GameMode::films()` replaces `film_changes()`. `Simulation::change_film(id, tier)` takes a tier, refusing `unavailable` for a tier the mode lacks (a blockbuster in Classic), and `rebook_spent_films` books a Modern theater's policy film after the morning rollover. `pay_maintenance` charges no film in either mode and answers nothing; `start_booked_films`, `CINEMA_BOOKING_MONTHLY` and `CINEMA_BOOKING_BLOCKBUSTER` are gone.
- Modern's ticket income multiplier follows the film's tier and stage (`film_income_mult`); Classic keeps its blockbuster slot at 2.2. Modern's blockbuster slots are its blockbusters at full draw.
- `Extras` gains `film_blockbuster` (saved as `filmBlockbuster`); a Modern save from before this lists its booked blockbusters in `blockbusters`, and those load as blockbusters. Film policies add `revival` and `off`.
- The port's `changeFilm(id, tier)` takes a code from the new `filmTiers` list, and `unitCard`'s `filmClassic` slot is now `filmTier`. Both change the exported layout, so `VIEW_LAYOUT_VERSION` is 15. The catalog's `films` (key, label, price), `filmRebooks` (each Auto-rebook policy and its film, in the button's order) and `filmRebookDefault` replace `cinemaBookingMonthly`, `cinemaBookingBlockbusterMonthly`, `newFilmPrice` and `classicFilmPrice`; `CATALOG_VERSION` is 9.
- The conformance lock moves for the twelve Modern scenarios only (the monthly booking no longer draws from the random stream); `amenities-modern` no longer scripts the ransom that draw used to bring on day six.
- New `services::parking`: `ParkingDemand` gains `homes` and `shared_need`, Modern counts tenanted homes by household share (`CONDOS_PER_SPACE`, `APARTMENTS_PER_SPACE`, `STUDIOS_PER_SPACE`) and applies `METRO_PARKING_SHARE` to offices and homes, and `parking_move_in_reading()` answers the office and home move-in factors from one garage flood.
- `ServiceShortfalls` allocates Modern parking across offices and homes together; `parking_coverage()` and `parking_for()` replace the office-only reads. New gripe and vacate cause `homeParking` (never sinks, never empties a home), appended to the port's `vacateReasons`, and `statsSheet` gains `parkingHomes` after `parkingSuites` and `parkingCoverage` (NaN while parking is not short) after `parkingTotal`, as `statsReport`'s `parkingDemand` gains `homes` and `coverage`, so `VIEW_LAYOUT_VERSION` is 18. Mode choices are named rules on `GameMode`: `homes_need_parking` and `metro_eases_parking`.
- The conformance lock moves for the Modern scenarios whose towers have homes at three stars or more without enough parking. The five Modern fire and ransom scenarios now tick 208 hours (not 256) to their offer, which arrives sooner now, and the smoke Modern fuzz golden follows.

## 1.25.0 (2026-11-11)

- `remove_facility` on a sold condo charges the household's buy-back price (`household_price` of its sale price) before the resale refund, refuses when the money cannot cover it, and logs the buy-back; unsold and gutted condos are unchanged.
- New `economy::visitors` module: each venue's expected visitors are set at the daily rollover from yesterday's served count and a climb of 1 to 3 steps of 5, rolled from the tower's founding seed, the day and the room, so the main RNG stream is untouched. `census_count` for shops, fast food and restaurants returns `Unit::visitors_yest` (saved as `visitorsYest`), the star census no longer subtracts hotel guests from them, and a gutted venue clears it. The conformance lock moves on every scenario.
- The TDT importer reads each floor's remap and each retail row's byte 8 to seed `visitorsYest`; `TdtTower` gains `TdtFloor::index_map` and `TdtTail::retail`.
- `economy::visitors` gains the set audience: `set_audience`, `counts_set_audience` and `census_follows_the_day`. `census_count` for party halls and cinemas returns `Unit::visitors_yest`, which the daily rollover sets to the audience on a room's first night open (a cinema keeps the count it has), and the save loader keeps it for those kinds. The conformance lock moves.
- `TdtTenant` gains `draw` (byte 15, a theatre's film draw). The TDT importer seeds party halls and theatres from it when a class adds up to the finance line, or with an even share when the line splits into a valid audience.
- `economy::visitors` gains `film_draw` and the aging constants. `Extras` gains `film_days` (saved as `filmDays`, cinemas only); the daily rollover counts a cinema at the draw of its film's age and then ages the film. A gutted cinema starts a new film. The conformance lock moves; the ransom-declined-classic scenario's threat now comes at hour 352.
- `tdt::venues` reads and writes the original's party hall and theatre table (`read_venue_table`, `write_routing_tail`), and `TdtTail` gains `venues`. The importer seeds each theatre's `filmDays` from it. The exporter writes byte 15 (the film's draw), the table, and an index map from logical unit id to tenant; every TDT export hash moves.
- `Simulation::change_film(id, classic)` and the port command `changeFilm(id, classic)` (a `cost` slot; refusals `unavailable`, `notTheater`, `closed` and `funds`) change a Classic theatre's film. `GameMode::film_changes` gives the prices, and the catalog adds `newFilmPrice` and `classicFilmPrice` (null in Modern); `CATALOG_VERSION` is 8.
- `Extras` gains `film_classic` (saved as `filmClassic`, cinemas only), and `visitors::showing_draw` holds a classic's draw to 1. Classic's `pay_maintenance` books no films, and its blockbusters are the theatres whose film draws a full house, set at the morning rollover, on a change and when a theater opens. Modern's booking resets the film after the day's rollover has counted the spent one (`pay_maintenance` now answers the booked theatres, and `start_booked_films` opens their films). The conformance lock moves.
- `unitCard` adds the `filmDays` and `filmClassic` slots, and the frame layout's `VIEW_LAYOUT_VERSION` is 14.
- The TDT importer reads a film number below 6 as a classic and the exporter writes film 3 for one (`venues::is_classic_film`, `TdtVenue::shows_classic`).
- Modern: the unmet-demand coverage adds the daily income capacity of reachable attendance venues to the retail capacity; the income share still reads retail only, and Classic is unchanged (#705).
- The binding gains tooling members for the screenshot and test harnesses: bare placements (`placeBare`, `placeTransportBare`) and reads of a unit, a shaft, a tile, a floor's lobby and service, and the highest floor. No game command reaches them.

## 1.24.0 (2026-11-11)

- A declined ransom starts a timed bomb search in both modes (a hidden bomb, guards sweeping floors from the emergency stairs, a deadline) that the save keeps as `events.bomb` while it runs; Classic still calls only on a tower with Security.
- `bombSearch()` reads the search (each guard's floor, rooms, start, arrival and finish), and the view's header adds `bombSearchSeq` (view layout 13).
- New gameplay event `bomb_found`; the web build reports `bomb_outcome` (paid, found or exploded).

## 1.23.0 (2026-11-10)

- The binding drops `towerSetCars` and `towerResizeTransport`, the silent tower edits only the retired dual-run mirror called; `setCars` and `resizeTransport` stay for uncharged edits.

## 1.22.1 (2026-11-10)

- The tooling-only WASM binding gains `vacateUnit(id, reason)` and `setUnitRent(id, rent)`. `vacateUnit` runs the churn pass's departure on a chosen room for a named cause, buying back a sold condo, outside any open undo step. `setUnitRent` writes a room's price as given, with no ladder snap or band clamp, or clears it with null. Each refuses an unknown unit, an unknown cause, or a price that is not finite or is below 0, and changes nothing then. The TypeScript reference exposes the same test hooks, so the last write-only tests (condo re-listing and price stamping, and the HUD's kept room counts) run on both engines.
- No saved-game, frame, view-layout or catalog format changes. The public binding interface digest moves.

## 1.22.0 (2026-11-10)

- A lobby tile placed where there is no floor yet pays the floor's price on top of the lobby's, as the original charges a $500 floor tile with each $5,000 lobby tile placed where there is no floor yet. This covers a lobby placement, the Floor tool on the ground floor (which lays a lobby) and every gap tile a lobby bridge fills, so `quoteBuild` and `canBuild` quote, and `buildAt`, `build`, `paintTiles` and `paintBrush` charge, $5,500 for each such tile. A lobby placed over a floor tile still pays the lobby's price alone.
- The catalog publishes the rule: each facility entry gains `paysForFloor`, true for the lobby alone, and `CATALOG_VERSION` is 7. The prices are unchanged.
- `resizeTransport` refuses an extend through the ground floor where a tile under the shaft is not built yet ("Build the lobby on floor 1 first, then extend through it."), as it already refused one through an unbuilt sky lobby floor. It used to lay plain floor there, where only lobby belongs.
- Placement keeps the metro station's floor until a station is placed or removed. It used to walk every unit again after each tile a brush, a bridge or an extend laid.
- The conformance lock (`expected.json`, `loader-cases.json`, the catalog digests) and the port-edit golden move with these changes. No saved-game, frame or view-layout format change, and the binding's interface digest is unchanged.

## 1.21.1 (2026-11-04)

- The tooling-only WASM binding gains `startFireAt(id)`: it starts a chosen flammable room's fire through the normal outbreak and paid-rescue path, without consuming random draws. It refuses while a fire or emergency choice is active and does not join a pending undo gesture. The TypeScript reference exposes the same test hook so conformance can run a mid-visit fire on both engines.
- No saved-game, frame, view-layout or catalog format changes. The public binding interface digest moves.

## 1.21.0 (2026-11-04)

- An undo hands back a build's price only while the build is unused, and that use now lasts. A room the gesture built is in use once it opens (its state leaves construction, which it never goes back to), whatever a move-out or a collection does to it after ("Can't undo that: the room has opened since. Sell it instead.").
- A floor or lobby tile, or a shaft, is in use once an hourly pass has run with it standing, since that pass moves tenants in over the floors the tower reaches and shares the crowd out among the shafts: a step records the simulation's hourly-pass count when its edit began and compares it. Floor a room's build laid under it counts too, while the room is still being built ("Can't undo that: its floor has been in use since the clock passed the hour.", with "Sell it instead." when nothing stands on the tile).
- A shaft is also in use once anyone rides it, counted by the new `Transport::rides`: each boarding the dispatch makes, each person in the crowd who gets into a car, and each walker who steps onto stairs or an escalator. The count lives in memory only and is never saved, and every adopted tower forgets the steps, so neither count ever meets a step made on another tower. A step that would take out a used shaft, or take cars or floors back from one, is refused ("Can't undo that: it has been in use since. Sell it instead.").
- The advice to sell is left off for a lobby tile and a Classic room that stays for good.
- A gesture that builds a shaft, a car, floors for a shaft or a floor tile, uses it and sells it again keeps that use, so its step is refused ("Can't undo that: it was in use before it was sold."), after the builds' own reasons.
- Doing a sale or a bulldoze again (a redo) does not mind that a room opened or a shaft was ridden, as the sale itself does not, including a redo of a gesture that sold a car and bought floors. It refuses only a room whose tenants, income or state changed since ("Can't redo that: the room has changed since.").
- An underground build whose digging searched for treasure is never undone ("Can't undo that: building it dug for treasure. Sell it instead."), since the dice and the dug ground are not rewound.
- A step never takes out a floor or lobby tile that a room, a shaft or the story above it still stands on, unless the same step takes those out too, as a sale never does, nor a ground-floor tile that a run of basement tiles hangs from with nothing else to hold it. Nor does it put back a floor or lobby tile above the ground floor over a missing story, or a room on a floor that holds a lobby or on or below the metro station's row, as a build never could ("Can't undo that: something in the tower stands in the way.").
- A refused step that time can make apply stays where it was: not enough money yet, or a room on fire. Any other refusal can never apply, so `undo()` drops the step and the message adds "Undo again for the edit before it.", and a `redo()` refused that way ends the redo trail. Only an edit clears what stands in the way, and undoing that edit puts it back. When a step has reasons of both kinds, the lasting one is reported.
- A unit or shaft an edit touches again after time moved it on inside the same gesture keeps the edit's own facts from the first look and its live state as it leaves, and a condo that sold meanwhile keeps the price it sold at.
- No saved-game, frame, view layout or catalog change.

## 1.20.0 (2026-11-04)

- The catalog is now version 6. It gains a `rules` block with the mode's rules a frontend shows the player, so a frontend no longer decides them from the mode's name: `variantHouseholds` (a sold condo carries its own household of 2 to 5 that prices the sale), `previewNamesRefusal` (the build preview names the refusal before the click) and `scheduleAssist` (the elevator schedule's presets, auto-tune and staffing advice answer). Each is true in Modern and false in Classic, and each is stated from one rule method in `engine-rs/src/rules.rs`: the condo sale reads `GameMode::variant_households`, and the schedule preset, auto-tune and schedule facts queries read `GameMode::schedule_assist`, so the block states the rule those paths apply. (The save loader still keeps a saved household by the save's mode name; moving it onto `variant_households` is listed on #1621.) `GameMode::preview_names_refusal` is a presentation rule the engine only states (it refuses the same builds in both modes). The build gate and the catalog's `available` now read one rule too, `Facility::available_in`, through `GameMode::builds_modern_only_kinds`. The bridge plan behind the build preview and the auto-bridge keeps one flag per lot tile for the story below, on the stack, in place of a map of lists, so a wide gap no longer costs a scan per tile, and it plans nothing for an empty footprint (which every caller refuses before it plans). The move-in reach memo uses the engine's fast hasher. Both catalog digests move. No saved-game, frame or view layout change, and no rule, price or simulation result changes.

## 1.19.0 (2026-11-04)

- New port query and binding method `roomTiers()` for the Map's Eval and Pricing views (#343): one record with a `roomTier` row (`id`, `floor`, `x`, `evalTier`, `rentTier`) for every room that carries an evaluation or a rent level, in the view's room order. The tier codes index two new layout tables, `evalTiers` (`unrated`, `terrible`, `good`, `excellent`) and `rentTiers` (`unpriced`, `noRate`, `veryLow`, `low`, `average`, `high`). A room is rated when the Satisfaction heatmap draws it; its score is Terrible under the keep line a tenant on notice needs (`VACATE_RESCIND`, 0.4), Good from there up to and including the inspector's gripe line (`GRIPE_WARN`, 0.6), and Excellent above it. The Eval tier's Good line and the inspector's gripe check now read one predicate (`names_gripe`); the inspector names a gripe only for the kinds and tenants it inspects. The rent tier is the rung the Classic editor's picker shows (a price that is not a finite number sits on the Average rung, where the picker places it). For a Modern band price, a price that is not a number reads Average; a price over the neutral price is High, so +infinity reads High (the "rent set too high" gripe's own test, now one predicate, `RentConfig::over_neutral`, for the gripe, the over-market check on a tenant's notice and the tier); a price equal to the neutral price is Average (the batch reprice's own "on the default" test, now one predicate, `is_neutral_price`, for both); a price at or under the band's floor is Very Low; and any other price is Low. One pass over the rooms per call, with nothing written. S8 reads it only on the triggers the Map SPEC lists (while the Map is open on Eval or Pricing: opening it there or picking either tab, a change of game hour, a move of the revision or generation, and every applied rent command or emergency answer), and not more than once a frame. The TypeScript engine does not answer it (the port member is optional). The view layout is now version 12; the save and frame layouts and the catalog are unchanged.

## 1.18.0 (2026-11-04)

- Two tooling-only binding methods for tests. `setWeather(name)` sets today's weather ("clear", "cloudy" or "rain"), which no save carries; the next day's roll replaces it, and so does a load, and any other name answers false and changes nothing. `clearRetailTallies()` clears every unit's patronage and profit tallies, today and yesterday, the render-only fields no economy path reads. No game command reaches them. No saved-game, frame, view layout or catalog change.

## 1.17.0 (2026-11-04)

- A tooling-only binding method for tests: `setCustomersIn(id, count)` sets a unit's live customer tally, which no save carries, through the setter that logs the unit for the frame, so a test can fill a venue to capacity mid-run. Like a counted arrival, it then mirrors the tally into an attendance venue's occupants and moves the meal overlay revision. It answers false and changes nothing for an unknown unit or a count that is not a whole number from 0 to 2^53-1. The unit's kind and its venue cap are not checked, so any unit takes any count in that range. No game command reaches it. No saved-game, frame, view layout or catalog change.

## 1.16.0 (2026-11-04)

- Two tooling-only binding methods for tests: `setClock(minutes)` puts the clock at a minute count, forward or back, and runs nothing (the TypeScript `sim.clock = new Clock(minutes, calendar)`; the loop's pass memos stay, as with `advanceClock`), and `setUnitState(id, state, occupants?)` sets a unit's state by its save name and optionally its occupants, through the setters that log the unit for the frame. Each answers false and changes nothing for input it cannot apply. No game command reaches either. No saved-game, frame, view layout or catalog change.

## 1.15.0 (2026-11-04)

- The engine keeps the undo and redo steps of the tower it runs, in place of the web host, and a step holds only what its edit changed. New port members and binding methods: `undoCapture(label)` opens a journal on the tower before an edit gesture's first change (closing and keeping a gesture already open, if it changed the tower), `undoCommit()` closes it and keeps the newest undo step only if the gesture changed something (answering whether it did) and ends the redo trail, `undoDiscard()` closes an open journal and keeps it only if it changed the tower, so no gesture's edit is left out of the steps, and `undoClear()` forgets every step. The journal takes the before-image of each unit and shaft an edit touches the first time it touches it, and the cash the edit commands themselves charged and paid back (a build, a shaft, a car, an extension, a sale); it is off the tower while the simulation advances, so time passing is never part of a step, and a payment that is not an edit (a ransom, a rescue, the exterminator, rent, a treasure) is never part of one. A step is as big as its edit, whatever the size of the tower. `undo()` and `redo()` close a gesture under way, then apply the newest step and answer `[status, generation]` as `restore` does: `1` for a step applied (the generation moves), `0` for a refused step (the step stays available and nothing changes), and `2` when there is no step. A step is refused when the balance cannot pay for it ("Not enough money to undo that."), when a room it would take out has been used since the step was made: a tenant moved in, it earned, it changed hands, or it burned ("Can't undo that: the room has been in use since. Sell it instead."), while such a room is on fire ("Can't undo that while the room is on fire."), when it would reprice a condo that has sold since ("Can't undo that: a sold condo keeps its price."), and when the tower is not the one the step expects ("Can't undo that: the tower has changed since."): a unit or shaft it would take out or restore is gone, or a shaft's span, cars, stops or schedule moved, or a unit or shaft it would put back is there already, its tiles or column are taken, the floor under it is gone, or putting it back would go past the tower's cap for its kind (a tower that came in over a cap may be left as far over as the edit found it); a shaft given back its old span needs floor and a free column on every story of it too. Each image in a step says what it expects to find as well as what it does, so an edit made with no gesture open can never make a step move cash for an edit that is not there, or put a room on top of another. A room the gesture itself added is taken out only while its use is the use it came in with, and one the gesture added, that was used and that the gesture took out again, leaves the step refused, so no undo hands back the price of a used room. Applying a step puts back the units and shafts it carries (a removed one returns to its place in the list with its saved record, less the customers and diners who left with it; one edited in place gets back the price, the No Rate flag, the name, the variety, the film policy, or the span, cars, stops and schedule, while the state the simulation moved stays live), adds exactly the reverse of the cash its edit moved, restores the VIP visit day when nothing has moved it since, and ends an elevator's open extend gesture. The clock, the people, the dice, dug ground and the id counter are not rewound, so no id is handed out twice. `undoNotice()` is the player's message ("Undid: Bulldoze", "Redid: Bulldoze", "Nothing to undo.", "Nothing to redo."), and `undoDepths()` answers `[undo, redo]`. Each stack keeps 50 steps. Every adopted tower (`loadSave`, `restore`, `foundTower`, `loadVctower`, `adoptTdt`) forgets the steps. No saved-game, frame, view layout or catalog change.

## 1.13.0 (2026-11-04)

- New port query and binding method `floorCongestion(floor)`: the raw congestion ratio of one floor, the same value `hotspot` takes its peak from. A floor with no reading (empty, stranded, off the tower) and a floor that is not a whole number answer 0. It walks the rooms once per call, so it is a read for tests and tools; the frame keeps using `congestion` and `hotspot`, which are kept per step. The TypeScript engine answers it through `Simulation.congestionAt`. No saved-game, frame, view layout or catalog change.

## 1.12.0 (2026-11-04)

- Two card verdicts now come from the engine. The `shaftCard` record gains a `nearCapacity` slot (1 when the shaft's average car load is above 85%, else 0; a shaft with no reading is 0), placed right after `utilization`, so the slots after it move up by one. A new read-only `recyclingDemandMet()` on the port and the binding answers whether the working recycling centers can process the whole population. The host used to compare the load with 0.85 and the population with the capacity itself. The transport detail the stats and inspector read also carries `nearCapacity`. The view layout is now version 11; the save and frame layouts and the catalog are unchanged.

## 1.11.1 (2026-11-04)

- The `.TDT` export writes a hotel room that has been rented and now sits clean and empty with the vacant-and-clean stay state (24, `0x18`), the byte the original game's own saves hold for such a room. It used to write a bare 1, which has no stay state, so the original read the room as a sleeping guest and rewrote it as `0x10` when it saved (found by the infested-room round trip on the PC, #1629). Importing either byte gives the same empty room that has been rented, so a round trip through our own importer is unchanged. Seven export digests in the conformance lock move. No saved-game, frame, view layout or catalog change.

## 1.11.0 (2026-11-03)

- The view's frame header (`VIEW_LAYOUT_VERSION` 10) gains seven slots after `transports`: `day`, `dayOfWeek`, `isWeekend` (0 or 1), `quarter` and `year`, all counted from 0 on the tower's calendar, then `weekDays` and `weekendDays`, the calendar's week and weekend lengths in days. A host shows dates from them and no longer does the date arithmetic itself. The header is 39 slots wide (it was 32), so every record after it moves; read the offsets from `viewLayout()`. No saved-game, catalog or rule change.

## 1.10.1 (2026-11-03)

- The `.TDT` export writes an infested hotel room with the dirty flag (32) and counts it as a dirty room in the people and finance blocks, as a `dirty` room is. It used to write no flag, so the room re-imported as a clean vacant room. What flag 64 means in the original game is still unchecked (#1629), so it is not written. No saved-game, frame, view layout or catalog change.

## 1.10.0 (2026-11-03)

- `scheduleFacts` gains `homeFloors`: the draft's homes as the shaft would hold them, one per car, each on the nearest served floor (ties to the lower one), with a car the draft lists no home for at the base lobby. It is empty on a refusal. The host no longer snaps homes to served stops or works out the base lobby itself. The advice answer is unchanged. The staging counts (`upTowerCars`, `lobbyCars`) now follow the snapped homes, so a draft with a home on a skipped floor counts that car where the shaft would hold it. The query also borrows the day's measured ring instead of copying it (`autoTuneProposal` still copies it, since it returns the curve). No saved-game, frame, view layout or catalog change.

## 1.9.0 (2026-11-03)

- Two new read-only queries on the port and the binding for the elevator Schedule dialog. `scheduleFacts(id, draft, weekendView)` (native `Simulation::schedule_facts`) answers a keyed object: a `status` (`available`, `not-an-elevator`, `missing-shaft` or `invalid-draft`), the `recommended` preset (`feeder` for an express, `rush` for a local, null where the mode offers no assisted presets), the `advice` comparison (`ready`, `insufficient-data` or `unavailable-in-mode`, with the `over` and `short` hours: an hour is over when its authored cars reach the measured want plus two, short when they fall two under it and the hour does not already run the whole fleet) and the Simulate `staging` summary (whether the busiest hour is measured, the busiest hour or the assumed 17:00 down-rush, the cars on shift then, how many of them are homed above the base lobby, and the base and top lobby floors). `schedulePreset(id, name)` (native `Simulation::schedule_preset`) answers the `rush`, `balanced`, `feeder` or `stage-up-tower` preset's weekday and weekend rows and home floors, or a refusal (`unavailable-in-mode`, `not-an-elevator`, `missing-shaft` or `unknown-preset`). Classic keeps `stage-up-tower` (homes only) and the staging summary and gets no advice, recommendation or other preset. Both queries take the working draft in `scheduleShaft`'s slots (empty for none), write nothing, and carry no wording. The engine now owns the preset rows, the preset staging, the advice margins and the staging counts; the rules are the ones the dialog always used. A shaft that holds no cars (a loaded save can) now answers a `no-cars` status from `autoTuneProposal` (it answered `unavailable-in-mode` in 1.8.0), `schedulePreset` and the advice of `scheduleFacts`; a refused `scheduleFacts` answer carries the advice status `refused`, and `recommended` is only ever `rush`, `balanced` or `feeder`. No saved-game, frame, view layout or catalog change.

## 1.8.0 (2026-11-03)

- New read-only query `autoTuneProposal(id, draft, weekendView)` on the port and the binding (`EnginePortQueries`, `Engine::autoTuneProposal`, native `Simulation::auto_tune_proposal`). It answers a keyed object: a `status` (`available`, `insufficient-data`, `unavailable-in-mode`, `not-an-elevator`, `missing-shaft` or `invalid-draft`), each day type's readiness (`warm` once six hours of its curve are sampled, `sampledHours`, and the warm day's measured 24-hour `curve`) and, when available, the proposed weekday and weekend rows and home floors. The engine now owns the warm-up gate, the per-hour tuning (load fraction times installed cars, at least one car, at most the cars installed), the staging seed aimed at the busiest served boarding floor and the snap of homes to served stops. `draft` is the working schedule in `scheduleShaft`'s slots (empty for none; a home count of 0 marks staging as untouched, which the engine seeds, while hand-set homes are kept). A day that is not warm keeps the draft's own row. Classic answers `unavailable-in-mode` with readiness filled in. The query writes nothing: no tower, telemetry, rng, cash, event or save byte changes. The tuning rule itself is unchanged from the dialog's. No saved-game, frame, view layout or catalog change.

## 1.7.0 (2026-11-03)

- The `tdtExport` record gains `retailRowsDropped` after `outOfRange`: the shops, restaurants and fast food places past the 512 style rows a 1994 file holds, which the export used to drop without a count. The view layout is now version 9; the save and frame layouts and the catalog are unchanged.
- The `.TDT` importer's rebuilt elevator layout (used when a save's elevator table cannot be read) places each shaft on the nearest columns free of rooms and of earlier shafts over every floor it serves, reads the rooms from the final tower (after parking stalls slide onto their ramps), and leaves a shaft out with a warning when no column is free. The "ends right after its elevators" warning no longer says the stairways could not be read, since the importer still looks for them.

## 1.6.0 (2026-11-03)

- `serviceDiagnostics(id)` gains a keyed `commercial` section: `lobbyFar` is true when a foot-traffic venue sits more than two floors from the nearest (sky) lobby, which halves its trade, and null for a unit the penalty never applies to (a sky bar is exempt and a venue that earns nothing in the current mode has no trade to halve, as in the income rule). The `retail` patronage block is now limited to the venues the catalog prices per customer (shop, fast food and restaurant, plus food hall, amusements and boutique bay in Modern), the set the TypeScript reference showed it for. Sky Bar, Nightclub, Spa and Daycare no longer answer `retail.active`. No saved-game, frame, view layout or catalog change.

## 1.5.2 (2026-11-02)

- Added `maxHousehold` to catalog facility entries and `economy.garbageCollectHour` to the catalog economy. The catalog shape is now version 5, with matching TypeScript/Rust catalog locks and compatibility record; save, frame and view layout versions are unchanged.

## 1.5.0 (2026-11-01)

- Classic PC .TDT imports now record an explicit per-express-shaft `preserveBasementStops` provenance flag in saved transport data. Its underground stop choices are retained across ordinary .vctower serialization and reload, including empty and mixed skip lists. Older unmarked towers and Modern shafts retain their existing normalization; the save version and binding layout are unchanged.

## 1.4.0 (2026-11-01)

- `serviceDiagnostics(id)` now includes keyed, engine-authored `retail` facts for commercial venues: patronage, business tier, demand percentage, Modern-mode under/oversupply advice, yesterday's profit and rain. The inspector's demand map is memoized; no saved-game, frame or view layout change.
- Editing an older shaft's hourly duty counts keeps existing legacy home floors unchanged. Explicitly reauthored homes still snap to the shaft's stops.

## 1.3.0 (2026-11-01)

- The inspector can read typed, engine-authored service diagnostics through `serviceDiagnostics(id)`, returned to JavaScript as a keyed object. Parking, hotel and housekeeping verdicts and supporting facts are Rust-owned. Numeric frame and tenant records, the view layout, save format and simulation rules remain unchanged.

## 1.2.0 (2026-10-30)

- The catalog carries four kind facts on every facility entry: `commercial`, `hotel`, `leaseAmenity` and `unmetDemand`, the engine's own `is_commercial`, `is_hotel`, `is_lease_amenity` and `is_unmet_demand_kind`. A frontend reads them instead of keeping its own kind lists. `CATALOG_VERSION` is 3, so a frontend built for version 2 refuses this catalog, and the catalog digests are regenerated.

## 1.1.1 (2026-10-30)

- An elevator car the schedule has stood down takes no new riders: a person waiting at a floor does not board a parked car, which never left its home floor. A stood-down car that still has riders aboard keeps running to their floors, answers no hall calls and takes nobody new, then parks when the cab is empty. This moves `expected.json` for `amenities-modern`, `fixture-split-tower-4` and `offshift-schedule-modern`. The TypeScript reference engine carries the same rule so the shared lock holds for both.
- A bought elevator car joins the shaft's duty schedule (`Tower::set_cars`): in each day type, every hour that ran the whole fleet now runs the new fleet, and every other hour keeps its count. Home floors, stops and unscheduled shafts are unchanged, and a shrink still clamps. No conformance scenario buys a car into a schedule, so the lock does not move; the TypeScript reference mirrors the rule.

## 1.1.0 (2026-10-30)

- The wedding hall is 28 wide and 5 floors tall in both modes, anchored on floor 100 and rising through floor 104 (`WEDDING_HALL_TOP_FLOOR`, `Kind::highest_story`). Nothing is built above floor 100 but the hall. Saves that hold the old 16 wide hall widen it on load, with no save version change.
- Classic: the wedding hall cannot be sold or bulldozed (`GameMode::room_is_permanent` now lists it, with `CLASSIC_WEDDING_HALL_KEPT` as its refusal), and floor 100 takes only the hall. The reservation is checked after the shared refusals, so the TypeScript reasons still win where both engines refuse.
- The catalog lock hashes a view of the catalog with the hall's `width` and `floors` left out, on both sides, so the TypeScript table keeps its 16 by 1 hall. `catalog_json` still reports the real footprint. The digest is regenerated.
- `.TDT`: the cathedral's five parts (types 36 to 40) now read and write upward from floor 100 (rows 109 to 113), bottom part first; the importer keys a hall off its lowest part floor and the exporter allows the hall up to row 113.

## 1.0.4 (2026-10-30)

- Security, medical, housekeeping and recycling build at SimTower's widths (16, 26, 15 and 25 tiles), and the metro station is 30 tiles wide with a full-width tunnel row. This moves the catalog digest and the conformance checkpoints.
- Nothing can be built below a metro station, its bottom row holds only the station and its tunnel, and the bottom basement row (B10) takes only the metro. A station needs a clear bottom row and nothing under it.
- The v1 to v2 save migration keeps the old widths of those kinds, so old saves re-lay exactly as before.
- The `.TDT` importer slides parking stalls that the file leaves less than one stall's width from their neighbor toward the ramp, closing the gap, so a row such as TOWER7's B5 (a 3-tile and a 1-tile paving piece between stalls) chains to its ramp. A row split by a wider gap stays split.

## 1.0.3 (2026-10-30)

- The service elevator car holds 17 (`Kind::car_capacity`), the figure in the Windows Help file, up from 10. The catalog's `carCapacity`, the per-car load clamp, and the congestion read follow. The `.TDT` exporter keeps its old service capacity byte (`Kind::tdt_header_capacity`), because the byte is unreliable and the referee pins it. The catalog digests and the conformance lock move.

## 1.0.2 (2026-10-30)

- Classic: `GameMode::room_is_permanent` replaces `housekeeping_is_permanent` and also keeps placed security offices, recycling centers and movie theaters (`remove_facility` refuses with a per-kind message; a gutted shell still clears). Modern sells them. The `star-climb-classic` conformance scenario no longer sells its security office (it starts one office short of the 3-star gate), so the lock moves.

## 1.0.1 (2026-10-30)

- The 3-star gate (both modes) needs `SECURITY_OFFICES_FOR_THREE_STARS` (two) operational security offices instead of one, in the rating evaluation and in the star-gate panel getter. Stars still never downgrade. The `star-climb-classic` conformance scenario builds a second office and the lock moves with it.

## 1.0.0 (2026-10-30)

- The Rust engine is the only engine the shipped game runs: every deploy builds with `VC_ENGINE=wasm`, so there is no TypeScript engine to fall back to and no cohort draw. The TypeScript engine stays in the repository as the reference the conformance lock and tests compare against until it is deleted.
- No change to saves, the frame and view layouts, the catalog or the binding's declaration. The version marks that the game depends on this engine alone.

## 0.24.4 (2026-10-30)

- Classic: the metro station's help to commercial demand and its rain relief now need the station's platform floor to be served by transport. Modern keeps the any-operational-station rule.
- Housekeeping joins the kinds that cannot be placed underground (`no_basement` in the catalog), in both modes. Saves that already hold basement housekeeping still load.
- Classic: a placed housekeeping room cannot be sold or bulldozed (`GameMode::housekeeping_is_permanent`), except a gutted shell. Modern still sells it. Lobby tiles were already refused in both modes.

## 0.24.3 (2026-10-30)

- A metro station's unit card reads its elevator access at the platform floor, the floor above the row the station is saved on, the same floor the engine's own metro rule uses.

## 0.24.2 (2026-10-30)

- The .TDT importer reads a hotel room's stay state (checked in, asleep, vacant) from its status byte. Checked-in and asleep rooms arrive with their guests at any hour, and clean vacant rooms arrive empty, so a tower's guest count matches the file's hotel lines.
- A hotel suite holds 2 guests, as the finance block of every real save counts it. This moves the catalog digest, the conformance checkpoints and the .TDT export hashes.

## 0.24.1 (2026-10-30)

- The .TDT exporter writes the stairs table where SimTower keeps it, with the parking and clinic lists, and the importer finds it there (#1501).

## 0.24.0 (2026-10-29)

- The .TDT export keeps the game clock to the minute, so an exported tower imports with the same time.
- Shops, restaurants and fast food places imported from a save get a style.
- The stairs table is read once per window.

## 0.23.0 (2026-10-29)

- Real 1997 saves whose express shafts broke the elevator table walk now import.

## 0.22.0 (2026-10-29)

- Opening hours and households live in the engine catalog (#921, part 2b).

## 0.21.0 (2026-10-28)

- The port exposes the recycling card's fill and capacity lines (#1420).

## 0.20.0 (2026-10-28)

- The port can bulldoze a floor tile, quote a batch price, read a schedule and read the founder mark.

## 0.19.0 (2026-10-28)

- The frame loop reads the star rating, the emergency and the win from the port.

## 0.18.0 (2026-10-28)

- The port carries the renderer's reads.

## 0.16.0 (2026-10-28)

- The port advances time with one call per frame (slice 7, PR 5a).
- Frame layout version 5, with the binding and contract rows recorded (PR 1d).

## 0.15.1 (2026-10-28)

- Saves load the same in both engines for a random state of 0 and for hand-edited fields.

## 0.15.0 (2026-10-28)

- The panel queries are available on the engine (slice 7, PR 1c).

## 0.14.0 (2026-10-28)

- The port covers the lifecycle, events, log and text getters (slice 7, PR 1b).

## 0.13.0 (2026-10-28)

- The port covers the player commands and the HUD queries (slice 7, PR 1a).

## 0.12.0 (2026-10-27)

- Every player command goes through the port. The unit removal scan and the brush move into the engines (#1209).

## 0.11.0 (2026-10-27)

- The engine reports diagnostics facts for the tenant family (#1215).

## 0.10.0 (2026-10-27)

- The engine exposes the renderer-facing view (#1213).

## 0.9.0 (2026-10-27)

- The binding offers an hourly save delta (#1045).

## 0.8.1 (2026-10-27)

- The TypeScript .TDT exporter refuses or writes forged saves the way the Rust exporter does.

## 0.8.0 (2026-10-27)

- The panel getters are bound for the facade (#1214).

## 0.7.0 (2026-10-22)

- Merge leftovers are resolved and star-start semantics are intact.

## 0.6.0 (2026-10-21)

- The engine view is bound.

## 0.5.0 (2026-10-21)

- The Rust step driver lands, and the consumer drives time through it.

## 0.4.0 (2026-10-20)

- The binding answers the command gaps the facade listed (#868, slice 6d).

## 0.3.0 (2026-10-20)

- The crate is raised to 0.3.0 and its compatibility record is recorded again.

## 0.2.0 (2026-10-20)

- `engineIdentity()` and the crate version rule arrive (#963, slice 1).

## 0.1.0 (2026-10-08)

- First engine: the referee, new game, tower and build paths.
