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

## 1.57.0 (2026-11-19)

- The monthly maintenance and Modern rent passes walk the rooms only, past the floor and lobby tiles that owe nothing, so the month roll costs 3 to 36 times less on a large tower (about 520 us to 24 us). The money, the ledger and the messages are unchanged (#1158).
- A `.TDT` import merges multi-story parts with a sweep by left edge instead of comparing every pair, so a forged file with tens of thousands of theater pieces imports in linear-logarithmic time. The merged rooms are unchanged (#2086).
- New `recyclingCard()` read: the population the centers serve, what they process, the bins' fill and the verdict, from one read of the census tally (#1745).
- Loading a save finds each room's fields in one pass over its object instead of a lookup per key: about 30% fewer instructions and 25 to 30% less time on the perf towers, with the loaded game unchanged (#1612).
- The `.TDT` exporter writes the paving on a metro station's bottom row as the tunnel (type 45, state 0, no logical id), matching the original's own saves; the importer reads it back as paving, so a round trip is unchanged (#1503).
- An undo or redo step keeps the port's generation, since it is the same tower: hosts follow it from the frame as they follow an edit. A step that puts back only a room's rent, name, No Rate, films or ticket price raises no tower revision, as those edits raise none going forward, and a step that takes rooms out and puts others back walks the unit list's tail once instead of twice (#1802).
- The conformance lock gains scenarios for the floor and lobby brush, a five-star tower and its TOWER inspection, and engine branches no scenario reached before.
- A scenario that opens at four or five stars now starts with its favorable VIP visit, as a played tower at that star has.
- New tests pin what each code in the frame means and the shape of the catalog, so either changing moves its version.

## 1.56.0 (2026-11-19)

- Dragging an elevator, stairs or escalator reads only the built shafts in the dragged columns, from an index kept per edit, and checks the floors once, so a drag on a tower with many shafts answers far faster (68 us to 0.3 us per move with 1,358 shafts). A build cap check also counts the shafts once per edit. The answers are unchanged (#1261).
- The package's `THIRD-PARTY.json` now carries fflate's MIT notice, since the engine's `.vctower` writer ports fflate's deflate (#1356).
- The gameplay event catalog's `about` line names `src/events/gameplayEvents.d.ts`, the file `npm run gen:events` writes, which moves the lock digest. Comments that name the retired TypeScript engine's files say so, and `engine-rs/README.md` gives the commit where they can still be read (#1957).
- `tdtFilename()` on the binding answers the file name a `.TDT` export of the tower downloads as (A to Z and 0 to 9 from its name, upper-cased, 8 characters at most, `TOWER1.TDT` for a name with none or a DOS device name), so the web game no longer keeps its own copy of the rule (#1676).
- `Simulation::build_skybridge_as` lays a bridge in a look, `Simulation::restyle_skybridge` dresses a whole finished bridge in one (free, one undo step; a half bridge is refused until it is finished), and `Tower::skybridge_looks` lists every bridge with its look. The look is each bridge tile's lobby subtype (`SKYBRIDGE_LOOKS`), so the save format and version do not change: an older save loads its bridges plain, and an older build drops the subtype. `build_skybridge` now lays the glass skywalk. Placement refuses a floor or lobby tile right under a bridge tile (`UNDER_A_BRIDGE`), so floors never split a bridge. The catalog's `rules.skyBridge` gains `looks` (catalog 26). The binding adds `restyleSkyBridge(floor, x, look)` and `skyBridgeLooks()`, and `buildSkyBridge` takes the look as a third argument. The view layout moves to 34 for the new `restyleSkyBridge` record, and the conformance lock moved for the catalog only.

## 1.55.0 (2026-11-18)

- `lastRefusalCode()` names why the last tower file read or write was refused with one closed word (`too_large`, `not_tower`, `damaged`, `newer_version`, `not_save`, `unreadable`, `modern` or `refused`), so a host can count refusals without sending the player's sentence, which can quote the file. `loadVctower`, `loadVctowerBytes`, `loadTdt`, `exportVctower`, `exportVctowerBytes` and `tdtExport` set it on a refusal and clear it when they work (#2075).

## 1.54.0 (2026-11-18)

- The satisfaction pass and the move-in check find each room's nearest amenity with a binary search over a sorted list of venue floors, where they used to walk every venue's floors, and the hotel and condo passes walk the rooms rather than every tile. That is up to 3% fewer instructions per step on large Modern towers, with identical results.
- Fires and bomb blasts look units up by id and walk only the rooms, where they used to search and walk every unit and tile. A random-event check costs 62 to 93% fewer instructions, with identical results.
- The motion pass and the queue projection refill their waiting-line lists in place each step instead of building them again, 0.7% to 2.5% fewer instructions per step with identical results.
- A Modern office worker whose outing (a meal or a cinema visit) ends outside office hours leaves the tower from the venue (`workplace::off_work_after_outing`): the office's desk and head count drop by one and its `out_for_meal` comes back down, and the return leg goes to the ground lobby. During office hours, and in Classic, the outing still returns to the office (#2481).
- `sample_elevator_util` files the larger of the demand at the top of the hour that ended and the demand now under that hour, both the riders aboard and the Modern lines at the shaft's stops. `ElevatorTelemetry::hour_start` (new) keeps each elevator's demand at the top of the hour under way, and a save's `elevatorLoad` entries carry it as `hourStart`. A save without it reads the first hour after its load from the hour's end alone, as before. The conformance lock moves for the Modern scenarios that sample a rush edge (`metro-express-modern`, `starter-modern`) (#2466).
- The Classic notices drop their fix (`GameMode::advises_fixes`): the stranded-floor and metro cut-off notices, the Security tip after a fire, the theft, bomb and refused-ransom notices, the burned-room, helicopter and cockroach notices, and the unimpressed VIP. Modern's text is unchanged (#549).

## 1.53.0 (2026-11-18)

- The roots an undo step's ground-floor lobby tiles joined (`joined_roots`) leave out of their flood the basement the step takes out, so each part that basement linked keeps its own root and its undo is no longer refused as `Blocked` (#2210).
- The elevator dispatch no longer sorts its two door lists (closed and open cars) every chunk. Each shaft's cars are already in order, and the shafts' id order is kept per tower revision, so a tower whose save lists its shafts in id order does no reordering at all, and one that doesn't copies the runs into place. The lists, and every game, are identical (#2060).
- The catalog's `rules` gains `advisesFixes` (`GameMode::advises_fixes`: true in Modern), whether a card or notice that names a problem also says what to do about it (catalog version 25). Classic's 9 AM elevator warning drops its "Add cars or shafts." (#549).
- `service_diagnostic_facts`: the retail tier reads yesterday's patronage against a baseline scaled by `weekend_multiplier` for the day yesterday was (venues with an attendance cap keep one baseline), and `localDemandPct` is rounded down instead of to the nearest (#549).
- `TripFacts` gains `gave_up`, and the `personCard` record gains a `gaveUp` slot (view layout version 33). For someone who gave up waiting to set out, `from` is the floor they stand on, `to` is where the trip began, and `purpose` still names what the trip was for (#2188).
- The Modern router's `stand_down` leaves a shaft whose schedule has `auto_tune` on at its whole fleet, instead of counting only the cars the dispatch last ran, and `crowd::banks` shares a bank's riders by an Auto shaft's whole fleet the same way. Regression `rule_tests::auto_idle_express` replays the owner's split tower 32. The conformance lock moves for `starter-modern` and `metro-express-modern`; every Classic scenario keeps its hashes.

## 1.52.1 (2026-11-18)

- Dispatch runs every car of a shaft whose schedule has `auto_tune` on while anyone waits at its stops, and the row's count while nobody does. `Schedule::cars_for_backlog` keeps its signature and follows the same rule; the car capacity, span and homes it takes are no longer read.
- `sample_elevator_util` folds the riders aboard and the lines at the top of an hour into the demand ring's slot for the hour that just ended (and that hour's day type), as the origin rings fold the ended hour's boardings. Rings saved before keep their values and follow within a few game days.
- `crowd::banks` sizes an Auto shaft's share of a bank by the cars the dispatch last ran (`closed_cars`), as the Modern router's `stand_down` does, instead of by its row. The conformance lock moves for `starter-modern`, `metro-express-modern` and `offshift-schedule-modern`, with the `smoke-modern-five-star` corpus golden; every Classic scenario keeps its hashes.

## 1.52.0 (2026-11-18)

- New `queueLine(shaft, floor)` read: how far one elevator landing's waiting line reaches along its floor, from the shaft face to the rider standing farthest from it, so a host can mark one line in a bank of elevators whose lines run across each other.

## 1.51.0 (2026-11-18)

- The hourly move-in pass copies each vacant room once for the move-in gate instead of twice, and the served-floor and floor-reachability lookups it and the satisfaction pass make use the engine's fast hasher, so a game day does less work (up to 6% on the bench towers) with every result unchanged.
- How far a floor sits from the nearest lobby is read from a list of the lobby floors kept until a lobby is laid or removed, instead of walking every lobby floor and tall hall on each call, so a game day does less work (up to 1.9% on the bench towers) with every result unchanged.
- Whether a shaft stops at one floor is answered from a set of its stops built once per tower edit instead of a scan of its skip list, for the waiting lines, a rider's arrival and the serving transport kinds; results are unchanged (#1984).
- A floor's average commute wait now starts from no wait instead of from its first trip's wait, so one long wait or give-up moves it only part way (#2435). The conformance lock, the frame-day and port-edit goldens and one fuzz-corpus golden move with it, `holidays-classic` now lights no fire, and `ransom-declined-classic` ticks to the bomb threat's new hour.
- `sample_elevator_util` feeds the hourly demand ring with riders aboard plus the crowd's line at the shaft's stops (`crowd.shaft_lines`), so `retune_auto_schedules` sees a backlog the cars could not carry. Utilization still counts riders aboard only. Classic counts no lines, so its ring is unchanged.
- `Schedule::cars_for_backlog` takes the waiting count with the car capacity, and the cars' positions, ways and span with the unset-home rule, instead of the car count and waiting count alone (an API change, hence `crate: minor`). It runs every car above one trip waiting, keeps the cars already out (up to the last one out) while more than half a trip waits, and returns the row's count at half a trip or less. New `DispatchRules::auto_backlog`, on only where the mode has schedule assist (Modern), keeps a Classic shaft on its written rows whatever its `auto_tune` flag says, and the loader and `Tower::set_schedule` clear `auto_tune` for a mode without schedule assist (`Schedule::kept_by_mode`), so a Classic save no longer carries it.
- New rule tests in `rule_tests::auto_backlog`: a re-tune wins cars back from any cut while a line waits, a quiet Auto shaft still tunes down, a step-down keeps parked cars parked, a trickle after a rush lets the shaft fall back to its row, a Classic tower loads with Auto off, and the split-tower-29 Auto shaft keeps its worst line under three carloads for a whole day (39 with the fix, 265 without).
- The conformance lock moves for two Modern scenarios whose elevators run on Auto (`starter-modern` from checkpoint 49, where only the ring in the saved state differs, and `metro-express-modern` from checkpoint 10, after a morning re-tune that now reads the line). `starter-modern` also moves in play from checkpoint 57, where the gentler hold lets its Auto shafts stand down sooner after a line. No Classic scenario moves.

## 1.50.0 (2026-11-17)

- The move-in check (`would_evict_fresh_tenant`) reads a room's placement once per check instead of once per hour of its two-day look-ahead, and `nearest_transport_distance` no longer copies a floor's transport spans. A game day on a tower with many vacant rooms takes up to about a quarter less work; every result is unchanged.
- A Modern route search allocates its route's floor and shaft lists once at their size, and the floor-tile memo uses the engine's fast hasher, so a game day does slightly less work (up to 0.6% on the bench towers) with every result unchanged.
- New query `congestionCause(floor)` (and `Simulation::congestion_cause`): the ids of the transports behind one floor's congestion reading, in the tower's transport order. That is the transport with the highest estimate there (every one tied for it), or every passenger elevator stopping there when the floor's real commute wait sets the reading. Empty for a floor with no reading or one that is not a whole number. It builds the reading once, so it is a read for a tap, not a frame. No saved-game, frame, view layout or catalog change.
- Dispatch runs every car of a shaft whose schedule has `auto_tune` on while the crowd waiting at its stops is more than its on-shift cars hold (`Schedule::cars_for_backlog`). A schedule with Auto off keeps its rows as written.

## 1.49.0 (2026-11-17)

- The hourly demand ring and utilization (`sample_elevator_util`) count each car's estimate seats plus the crowd's own riders there (`Crowd::car_riders`), each rider once (#2397). The dispatch keeps the estimate's seats beside `car_load` without changing how any car moves, in one per-shaft record with the callers each car has seen and the time it has waited (`dispatch_cars.rs`), so a step looks a shaft up twice where it looked it up three times, and a save's `dispatch` carries them as `estimateSeats`; a save without them loads. The conformance lock is unchanged.
- `Schedule::auto_tune` (`autoTune` in the save, one more `scheduleShaft` slot, view layout 32): at 5 AM each game day (`schedule_auto::AUTO_TUNE_HOUR`) a Modern shaft on Auto takes `auto_tune_proposal`'s rows for the hours its ring has measured; other hours, the staging and the timings stay. A Modern elevator is built with it on. A save with a shaft on Auto is version 12 and carries `elevatorLoad`, the hourly load rings, so a reload re-tunes the same. Undo steps on the shaft survive a re-tune (`Schedule::same_but_auto_rows`). The pass moves no tower revision, so no cache rebuilds at 5 AM, and finds a shaft's twins with one floor-set comparison per elevator. The conformance lock moved for Modern scenarios only.
- A floor's average commute wait now lasts between hours only while an office, home or hotel room on it is settled. A floor with only shops and venues keeps its average for the hour its customers made it, so an old average can no longer drain its shops with no trip left to replace it. The conformance lock, the frame-day golden and one fuzz-corpus golden move with it.

## 1.48.1 (2026-11-17)

- The Modern router (`crowd::expected_time`) prices the walk from the tile a rider stands on to the first shaft, stair or escalator, at half the walking time (`crowd::expected_time::walk`); the kept routes are keyed by that tile too. The walks between legs and at the far end stay free. `auto_tune_proposal` proposes for each hour the fewest cars that carry its load below 0.9 of capacity each (it proposed the rounded load, which left those cars full and kept a one-car hour at one car), and tunes each hour from the larger of a shaft's own load and the mean load of its twins (same kind, stopping at every floor it does). The conformance lock moved for Modern scenarios only.
- At the end of each hourly satisfaction pass, the average commute wait of every floor that had no settled occupant when the pass began (no room occupied, asleep or vacating; a room an imported tower left moving in does not count) is dropped, so the floor reads no wait until new trips finish. The pass's own room loop gathers those floors. Saves already carry the averages (#1083), and a loaded tower forgets the same floors. The conformance lock and two fuzz goldens moved.
- `spatialCongestionByFloor` (and every reader built on it: `peakCongestionHotspot`, `floorHeatmap("congestion")`, `congestion()`, the inspector's congestion and the hourly satisfaction pass) raises each floor's transport estimate to its real average commute wait over the mode's limit where that is higher, and lists a floor with only a real wait after the estimate's floors. The 9 AM wait warning reads the same map. The conformance lock and the frame-day golden moved, and the `ransom-declined-classic` scenario now runs 544 hours to its threat.

## 1.48.0 (2026-11-17)

- From 512 people the crowd keeps a per-floor index of its people in the step, and a view's people window reads the people on its floors from it, so the frame's cost follows the screen instead of the crowd (#2151). Smaller crowds, today's included, keep no index and cost what they did.
- The view's frame carries only the elevators' transport records, in tower order; stairs and escalators run no car and come only with the structure (#2383). View layout version 29.
- A people window keeps its widest-shaft pad per tower revision instead of walking every transport each frame.
- The catalog publishes `rules.officesShareOneParkingSpace`, true in Classic, where one free space serves every office (#1970).
- `statsReport`, `statsSheet` and the parking ramp's diagnostics count the offices' parking need by the mode's rule (#2024): in Classic the offices count as one space while any is tenanted. `officePop` still carries every worker, and the garage still draws every car.
- The catalog names `hotelDouble` "Twin Room" (#380); the kind id stays `hotelDouble`, so saves and the binding are unchanged. The catalog digests and the `.TDT` referee's labels moved.
- `GameMode::thief_needs_security` (Classic): the daily thief roll still draws, but in a Classic tower without a Security office no thief comes, no money is lost and no thief effect plays (#2364).
- The fuzz corpus's uncaught-thief entry runs as Modern now, and the Classic four-star smoke golden re-pinned.
- Every crowd rider who boards an elevator joins the shaft's origin tally (`Crowd::elevator_boardings`, renamed from `commuter_boardings`), and the dispatch tallies only the waiting estimate's riders, no longer a staff car's callers (#477). Auto-tune's staging aim picks the busiest boarding floor above the base lobby, since the lobby now counts every crowd rider coming in. The tally is counting only: the conformance lock and every golden are unchanged.
- The tenant gripe facts carry `roomyShaft` for an elevator-bound congestion gripe: the passenger elevator stopping on the floor with the most free car slots (kind, bottom, top, cars, max cars), or none when each is full. `unitFacts` adds `gripeShaftKind`, `gripeShaftBottom`, `gripeShaftTop`, `gripeShaftCars` and `gripeShaftMaxCars`, and the same five for the lease gripe; view layout version 30.
- `extend_transport` stops a shaft just short of the first floor it cannot newly serve (another shaft in the way, or a lobby floor whose lobby is not built under it) and reports that floor's reason with the done step; the whole step is no longer refused. `extendShaft` leaves the reason in `lastReason()` (#1847).
- `labelUnit`, `nameTower` and `logLine` refuse text longer than 4,096 UTF-16 code units with "That request is not valid." and change nothing, so every caller meets the same cap the web's editor used to apply on its own (#1405).
- A tenant trip that runs out of patience before boarding and turns back folds a wait of at least twice the mode's commute wait limit onto its floor's commute average (240 s Classic, 360 s Modern). A trip cut short by an edit (a shaft or car removed) is not a give-up. Saves carry the person's `gaveUp` flag. The conformance lock and the frame-day and port-edit goldens moved.
- New `FireResponse` on `EventSystem::fire`: the guards Security sends to a fire by the emergency stairs and the rescue helicopter. `Simulation::advance_fire_response` runs each step; a paid rescue lands after `HELICOPTER_FLIGHT_MINUTES` instead of putting the fire out at once. Saves carry it as `events.fire` while a fire burns; an older save's fire gets its guards on the next step.
- `control_chance` takes Security's share from guards who reached the fire. `call_fire_rescue` refuses with `coming` while the helicopter is on its way. Classic's rescue costs a fixed $500,000 (`GameMode::fire_rescue_fixed_price`).
- New gameplay event `fire_out` (`by`: `security`, `rescue` or `burnedOut`). `VIEW_LAYOUT_VERSION` is 31: the frame header appends `fireResponseSeq`, and the binding adds `fireResponse()`.

## 1.47.1 (2026-11-17)

- Each open car carries the way it leaves (`Leaving`: up, down or either), and a waiting rider boards only a car leaving their way; the crowd's hall calls carry their way, so a car passes a stop whose callers are all bound the other way unless it turns there, and Modern's best-car choice counts a car that will pass them as coming the long way round. The conformance lock, the frame-day and port-edit goldens moved, and the Classic ransom scenario now runs 592 hours to its threat.

## 1.47.0 (2026-11-16)

- `Simulation::quote_skybridge` and `build_skybridge` (the binding's `quoteSkyBridge` and `buildSkyBridge` port records) quote and lay a whole sky bridge in one command; a lobby tile over open air is now refused.
- The catalog's `rules.sky_bridge` (`skyBridge` in JSON) publishes the tool's star, longest span and tile price; catalog version 23, view layout version 28.

## 1.46.0 (2026-11-16)

- Modern climbing speeds are now an escalator at 0.4 floors per crowd second and stairs at 0.25 (they were 1.3 and 0.85, faster than a Modern car), and the Modern router prices a floor on foot from that speed: the ride plus a step off for an escalator, the climb plus an effort cost for stairs. Classic is unchanged. The conformance lock moves for the Modern scenarios with stairs or escalators.
- Modern hotel guests check in and out as crowd people (`crowd::commuters`, new `Workplace::Hotel`): `GameMode::hotel_guests_arrive_in_person` (`REAL_HOTEL_GUESTS_ON`) and `Kind::stays_in_person`, which `Kind::arrives_in_person` now includes. A let room's `occupants` is the guests in it; they are booked at once in the hour after the room is let and leave over the hour of their checkout. These rooms no longer feed the dispatch's waiting estimate or its lobby share. The hour's checkouts now run before the commute bookings. The Modern conformance cases and goldens move.
- Each elevator demand ring keeps the hours it has sampled, so a measured zero counts toward the Auto-tune warm-up gate, and `elevatorTelemetry()` carries `weekdaySampled` and `weekendSampled` (#474).
- Classic climbing speed is now 1/24 floors per crowd second for stairs and escalators alike (it was 0.85 and 1.3), the ratio measured in SimTower v1.0: every flight takes 16 ticks, up or down, however crowded, while a standard car runs floor 1 to 10 and stops in 15. The conformance lock moves for the Classic scenarios with stairs or escalators, and ransom-declined-classic now ticks 1,192 hours to its bomb threat.
- The catalog's `rules` adds `frontDoorPerTower`, true where ground lobbies may stand apart (Modern), and the catalog version moves to 23.
- Modern sets no limit on stairs and escalators (`GameMode::limits_stairs_and_escalators`, Classic only): `transport_pools(mode)` now returns a slice, `MODERN_POOLED_CAPS` holds the elevator pool alone, and Modern's catalog lists no `walkways` pool, with `pool: null` on stairs and escalators. Classic's catalog is unchanged.
- `transport_cap(mode)` adds the lot's room for flights (`facilities::lot_flight_room`, 46 one-story flights on each of 109 stories) where a mode sets no limit, so a Modern save keeps every flight on load.

## 1.45.0 (2026-11-16)

- The catalog publishes `rules.starDuties`, what each star rating starts asking of a tower as `{ star, id }` records (`star_duties::star_duties`), and `rules.announcesStarDuties` (`GameMode::announces_star_duties`, Modern only), catalog version 22. The ratings the duties begin at are named constants the rules read (`EMERGENCIES_FROM_STAR`, `VIP_VISITS_FROM_STAR`, `HOTEL_GUESTS_UNCOUNTED_FROM_STAR`, `BOMB_THREATS_FROM_STAR`), with no change in behavior.
- Housekeepers coming in for a shift are not sent in while an elevator on their way in already has a full load waiting for every car, and come at a later hour (#2332).

### Contributors

- easterbunni on r/SimTower asked for a heads-up when the tower earns a star, after tenants left over parking the new rating needed.

## 1.44.0 (2026-11-16)

- Modern home residents commute as crowd people (`crowd::commuters`, new `Workplace::Home`): `GameMode::residents_commute_in_person` (`REAL_RESIDENT_TRIPS_ON`), `Kind::lives_in_person`, `Kind::arrives_in_person` and `Kind::residents_home_by_day`. A home's `occupants` is the residents at home; the hourly presence pass skips these homes, and they no longer feed the dispatch's waiting estimate (`ElevatorDispatch::accumulate`), whose lobby share now leaves out the population that arrives in person. The sampled school run is off where residents commute themselves. The Modern conformance cases, the frame-day golden and the Modern fuzz-corpus golden move.

## 1.43.0 (2026-11-15)

- `serialize`, `saveBytes` and the `.vctower` writers write each unit and each person straight to the text instead of building it as a JSON tree first. The output is byte for byte the same, and on a maxed tower the save is written about four times faster.
- New `saveBytes(appVersion, savedAtMs)`: the save JSON with `savedAt` and `appVersion` appended as its last two keys, as UTF-8 bytes, so a host can store a save without holding it as a JavaScript string. The Rust side is `Simulation::stamped_save_bytes`.
- Recycling (the 4★ gate, the nudge, the bin fill, the trash shortfall and the shop bonus) now leaves out the live customers of the Modern venues whose census is who is inside right now. Classic towers read their total population as before. No public API changes.
- `dominant_gripe` lets a steeper unmet-demand drain outrank `transportFar` and `lobbyFar`, as it already outranked noise (#548), and the tenant card reads coverage under those causes.
- At the end of a lease tenant's notice, a stamped cause that no longer holds is replaced by the current dominant gripe; a cause that still holds, a relocation, or a tenant with nothing wrong now keeps its stamp. The unmet-demand gripe facts read whether the room's own stretch of floor is reachable, not just its floor.
- Modern venue staff commute as crowd people (`crowd::commuters`, new `crowd::workplace`): `Kind::staff_size`, `Kind::staffed_at`, `Kind::waits_for_staff`, `Unit::staff_in` (not saved; rebuilt from the desks) and `Unit::open_for_business`, which gates visits, takings and the drawn presence. Their trips use `ErrandPlace::Work`, saved as `"work"`. Classic venues keep opening by the clock. A save made after an edit the desks were not squared with yet (workers stranded by a bulldoze, or a venue built while it should be open) carries `crowd.desksStale`, so its load sends anyone stranded out and calls the crew in at the first step, as the game that saved would (before, a reload straight after a bulldoze sent them out at once and changed the crowd). A Modern save also carries `crowd.venueStaff` once a step has squared the desks, so a load keeps a venue whose crew is not in yet empty; a save without it (one from before venue staff commuted, or one no step had squared) loads with its open venues' staff at work, and its first step squares the desks as a new game's does, so a 4.0 save taken between a bulldoze and the next step sends those workers out at that step. A venue that finishes construction mid-hour calls its crew in at once instead of at the next hour. A crew is called in four hours before its venue opens and stays through a break of four hours or less. The Modern conformance cases move. `ElevatorDispatch::accumulate` keeps the last room's kind answer and finds a floor's slot by index (`DispatchFloors::slot`). The route search keeps one seen-segment set between searches and clears only the words it touched, and the housekeeping pass counts free housekeepers in the walk that finds them.
- Modern routing: each elevator stop keeps a fading memory of its boarders' waits (`crowd::line_count::waits_seen`), and a stop's line costs the longer of the model and that memory. Saved in the crowd as `waitsSeen` rows `[shaft, floor, wait, fade]`; the `lines` rows now leave out a line nobody stands in.
- A Classic express follows the original's stop rule (#1527): `Tower::express_may_stop`, a `classicExpressStops` marker on saved shafts (a save without it gets its old lobby-only skips on 15th floors dropped), placement and resize refuse a Classic express that reaches neither the ground floor nor a 15th floor, and a `.TDT` keeps an express end's serviced byte both ways. The shaft card's stop row gains `toggles` (`Tower::stop_toggles`), view layout version 27. The conformance lock, loader and `.TDT` case pins and the frame-day and port-edit goldens move with the rule.
- Shops and fast food close their day at 10:00 (`Simulation::roll_over_morning_venues`, `MORNING_VENUE_DAY_ENDS_AT_HOUR`); restaurants, theatres and party halls still roll over at midnight (#1500). A save taken before 10:00 carries `morningVenueDay`; one without it counts today's close as done, and a `.TDT` saved before 10:00 closes that morning.
- A rider whose destination stopped being a stop mid-ride rides on to the car's stop nearest it, gets off and reroutes from there (#2324), instead of leaving the crowd: housekeepers over the staff network (`staff_shift::way_on`), anyone else over the passenger network, and with no way on they leave through the ground lobby (a housekeeper waits for the next errand). A rider whose car went still steps out of the trip.
- The `.TDT` exporter writes the stall table in the tail, points each stall's bytes 6 and 7 at its record, lists the connected stalls by record and writes the B1 ramp's x into header bytes 36 and 37 (`FFFF` with no ramp) (#307). Every export's bytes change; `conformance/tdt-cases.json` is re-locked.

## 1.42.0 (2026-11-15)

- Modern dispatch: a car its crowd fills owns no hall call and does not restart Standard Floor Departure for riders who cannot board (`GameMode::full_cars_pass_hall_calls`). The crowd keeps those cars in `Crowd::full_cars` (marked at the last seat, cleared when a seat is left, rebuilt on load, never saved), and `ElevatorCalls` gains `full`, a copy of it for dispatch.
- `Simulation::call_fire_rescue` (port command `callFireRescue`, record slot `cost`) puts the fire rescue offer up again while a fire burns, refusing with `none` when nothing burns and `pending` while a choice waits. View layout version 26 (#1889).
- `GameMode::fire_needs_security` (Classic): the daily roll starts a fire only in a tower with a Security office, the same gate the ransom call has (#1889).
- `hotel_checkout` books every asleep room's rent, including the rooms Modern holds for late checkout, and `hotel_late_checkout` only turns the held rooms over, so a held room removed before 14:00 no longer drops its night's rent (#2283).

## 1.41.2 (2026-11-15)

- Exact speed-ups, with every game the same: the parking check fills room by room, the demand pool, crew floors, commute averages and the lobby reach sets use the fast hasher, the lobby distance walks the tall halls once, the landing lines read each shaft once per line and are kept by place in the crowd, and the Modern router prices a line only when the link could still win. The conformance lock and the fuzz corpus do not move.

## 1.41.1 (2026-11-15)

- A save from a game's first day carries the step loop's hour, maintenance-period and quarter marks that the clock does not give (`periodMarks`), so a reload bills the first day's end as the unsaved game does. From the second day on the key is absent and a load sets the marks from the clock as before. The conformance state hash leaves it out; the fuzz goldens gained the field where a corpus entry saves on its first day.
- The Modern router (`crowd::expected_time`) bounds its A* search by the least a route to the goal can cost with no lines and the most cars each shaft holds running, from a search back from the goal that each route resumes only until its start's cost is final, read capped at that cost so it never depends on earlier searches, in place of the floors left times the fastest car's ride. The searches carry across tower edits that leave the graph's ways and least costs as they were (rooms, rents, car counts) and stay under 4 MiB. Routes cost what they did; where two routes tie, the one taken can differ, which moves the Modern conformance cases.
- The Modern router's lines (`Crowd::shaft_lines`) now hold a `line_count::Line` per landing, the riders and the longest wait in the line, and a boarding costs the longer of the expected wait and that measured one. A rider whose wait in a line passes an hour (`GIVE_UP`) is routed again once, from where they stand (`line_count::rethink_long_wait`), and keeps their place when the line is still quickest. `routing::plan` returns a route without joining its line. The saved `lines` rows are unchanged; a load counts the waits again from the saved people. The motion pass reuses the last count's map instead of allocating one.
- The Modern router keeps each line's boarding cost and the routes it found until a rider joins a line or the step's lines change. Every route comes out as before; the conformance lock and the fuzz corpus do not move.
- A Metro arrival is spawned only at a station where the line's train stands at that minute (`crowd::metro_train::train_in_at`), drawn `arrival_weight` times as often then so the day's count holds. A Modern office worker whose entrance is a station with no train in is held until the next call (`metro_train::hold_for_train`): the booking is re-queued for that call with the station on it (`Shift::station`), and the worker comes in by the street once the day's last train has gone. A Metro walk-in with no train in stays away. Saves: a held booking's row in the crowd's `shifts` gains an optional fourth element, the station id (`[at, office, inbound, station]`); rows without it load as before, so older saves are unchanged, and a game saved while workers wait for a train plays on the same after a reload (JSON and binary `.vctower`). The conformance lock and the frame-days goldens move.

## 1.41.0 (2026-11-15)

- A save carries the housekeeping tallies (`housekeeping`: `cleanedToday`, `yesterday` as cleaned and left dirty, and `nudgedDay` and `commuteNudgedDay`, the days the "can't reach" and "can't get in" nudges last fired), written only once there is something to keep. Older saves load with fresh tallies as before, and older builds ignore the key. The conformance state hash and the `.TDT` export leave it out.
- The crowd's save carries the elevator cars the schedule has stood down (`closedCars`, written only when there are some), so the router's first routes after a load skip them as the unbroken game's would (#2229).
- An office loads with no more workers at their desks than it holds, and a save's commuter desks are capped the same way, so a hand-edited head count cannot send extra workers home (#2230). A load keeps the desks of offices that are gone only while their workers fit under the people a save may hold (10,000), so a forged save cannot walk tens of thousands of workers out in one pass.
- A commuting worker who reaches a full office heads out again instead of sitting down (`crowd::commuters::at_destination`), so an office's head count never passes its population. A turned-back worker could find their desk taken by a replacement the hourly pass booked while they were away; the office then held 7, and since the loader caps a head count at the population (#2240) a save reloaded mid-rush played differently from the unbroken game (#2267).
- Modern collects lease rent (offices, clinics, fitness clubs) every maintenance period, scaled to that period's share of a real-world quarter; Classic still collects it each quarter. On the real-world calendar the bulletin line reads "Monthly office rent collected" (#2255).
- Each catalog calendar publishes `leasePeriodDays`, the days between two lease collections, and its `quarterlyRentScale` is now the share one collection pays; catalog version 20.
- Modern's elevator pool holds 48 shafts (`facilities::MODERN_ELEVATOR_SHAFT_CAP`, `MODERN_POOLED_CAPS`, `transport_pools(mode)`, `transport_cap(mode)`, `GameMode::builds_more_elevator_shafts`), so the catalog's Modern `elevators` pool reads 48 and a Modern save keeps up to 112 transports on load. Classic's pools are unchanged.
- A save carries the day's move-ins so far (`moveIns`: `offices`, `condos`, `rooms`, `fitness`, `clinic` and `rentals`, each written only above zero, and the key only when one is), so the day's report after a reload matches the unbroken game's (#2256). Older saves load with the counts at zero as before, and older builds ignore the key. The conformance state hash and the `.TDT` export leave it out; the lock moved only for the two fixtures whose scenarios reload, where the report line now appears as it would unbroken.
- A crowd member who ends a walk inside a Metro station on its platform floor waits for the line's train (`crowd::metro_train`) and leaves only while it stands at that station; after the day's last call they route to the nearest ground floor run. `Crowd::minute` (never saved) carries the game minute each crowd chunk ends on. A crowd stepped on its own (no minute) keeps the old ending.
- The catalog publishes the timetable as `world.metroTrain` (`firstHour`, `lastHour`, `legMinutes`, `dwellMinutes`, `runMinutes`); catalog version 19. The web renderer draws the train from it, so the drawn train and the riders who board it keep one timetable.
- The conformance lock, catalog digests, frame-days goldens and the catalog fixtures move; no save layout changes.
- `crowd::walk::walk_to` walks a walker whose target lies past the end of their run to that end at walking speed, instead of putting them there at once. The conformance lock and the frame-days goldens move; no save layout changes.

### Contributors

- ibiller reported Modern's slow first rent and the sliding office income, with their tower attached (#2255).

## 1.40.0 (2026-11-15)

- A walker whose shaft or flight stands over a gap in their floor walks to its nearest column on their own run instead of finding another way that leads back to the same shaft every step (`crowd::walk::reach_on_run`).
- The binary `.vctower` file: the line `VCTOWER2`, a newline, then the raw deflate bytes of the same stamped save (`TOWER_FILE_MAGIC_BINARY`). `load::encode_simulation_vctower_binary` and the binding's `exportVctowerBytes(appVersion, savedAtMs)` write one.
- `load::decode_vctower_bytes`, `Engine.fromVctowerBytes(bytes, mode?)` and the port's `loadVctowerBytes(bytes)` read a file's bytes of either kind. The text readers refuse a `VCTOWER2` file as damaged, since decoding one as text changes its bytes, and a later version (`VCTOWER3`, or a number that starts with 2 such as `VCTOWER21`) still asks for an update.
- View layout version 25: the port's `loadVctowerBytes` entry moves the exported layout pin.

## 1.39.0 (2026-11-15)

- The Modern router links ground lobby runs that do not touch through the street, priced by the walk across the open ground between them, and a walker on the ground floor carries on past a lobby's end (`GameMode::walks_the_street`, `crowd::street`).
- Modern lays a ground lobby tile apart from the tower (`GameMode::lays_ground_lobbies_apart`), and undo puts one back the same way.
- Modern sells ground lobby tiles under the floor-tile rules, refusing only the tower's last one (`GameMode::removes_lobby_tiles`).

## 1.38.0 (2026-11-14)

- A save carries the crowd (`crowd`: every person, the crowd's id source and random stream, the commute-stress averages and the walk-ins booked for the hour) and the elevator cars' timers mid-stop (`dispatch`), and a load rebuilds the venue, meal and housekeeping counts from the people, so the people and the cars carry on where they were. The crowd also keeps the last step's hour, the Modern router's line counts, and the office commuters' desks and bookings when there are any. The elevator panels' hourly figures, the day's move-in report and the rooms cleaned today still start over on a load. Older saves load with an empty crowd as before, and older builds ignore both keys.
- The conformance state hash leaves out `crowd` and `dispatch`; the crowd hash now holds through a `reload`.
- Modern places a lobby tile over open air on a sky lobby floor as a sky bridge tile when a sky lobby closes the gap on both sides within `SKYBRIDGE_MAX_SPAN` tiles; `Tower::is_skybridge_tile` reports one. A bridge carries no story or shaft, costs twice a lobby tile, and Classic placement is unchanged.
- `remove_facility` on a sky bridge tile removes every tile of that bridge and refuses while people walk on it; undo refuses the same way (`StepRefused::Crossing`). A walker whose target lies on another run of their floor reroutes from where they stand.
- Modern routes each trip by its expected time (wait, line, ride and climb) on a transit graph with an A* search; Classic keeps the fewest-rides route.
- `rules::REAL_OFFICE_COMMUTES_ON` is now `true`: Modern office workers commute as people (`crowd::commuters`), and the test-only switch is gone. Classic offices keep the clock's head count.
- Modern standard and service cars move at twice the base speed (`GameMode::car_speed_factor`, `DispatchRules::car_speed`) and express cars at four times (`GameMode::express_speed_factor`).
- The unit detail JSON adds `workersComing`, matching the `unitCard` slot: the workers on their way to a Modern office, null on any other kind.
- A housekeeper's commute uses the street floor's run nearest their room that a route reaches, and a Metro rider's trip starts or ends at the station's own run of the platform; a lot with one street run and one platform run is unchanged, so the conformance lock does not move.
- An express shaft stops at every basement floor it spans in both modes, and `setStop` accepts a basement floor on an express. Every express now writes `preserveBasementStops: true` into the save; a save without it loads with its basement skips cleared and gains it. `importTdt` writes the marker on each express, so `fromSave` keeps the file's basement skips too.
- The conformance lock moves: `fixture-sixseven` and `holidays-classic` (the sixseven tower, whose express runs from B5) move their crowd hashes, and `holidays-classic` its events; the other moved scenarios change only their state hash (the marker in the save), and a new `express-basements-classic` scenario covers building, toggling, shortening, extending and reloading a basement express. `loader-cases.json`, `tdt-cases.json` (11 import save hashes for the marker, and the two sixseven export cases) and `frame-days.json` move with it.
- A loaded tower numbers its saved log lines from 1 up to the log counter, so `logSince(0)` and the port's `logAfter(0)` list every line the save carried. They answered nothing before, since the counter restarted at 0.
- Save version 11 folds a row of plain floor tiles into its first tile with a `run` count (`FLOOR_RUN_KEY`, `FLOOR_RUN_SAVE_VERSION`); both loaders unfold it, and a tower with no such row keeps its old version stamp.
- `HELD_HOURS_SAVE_VERSION` names version 10, and `Simulation::serialize_unfolded` (the tooling binding's `serializeUnfolded()`) writes every unit on its own with the old stamp, the form the state view and its digests hash, so conformance digests do not move.

## 1.37.0 (2026-11-14)

- Real office commutes (`crowd::commuters`) land switched off behind `rules::REAL_OFFICE_COMMUTES_ON`, so the game plays as before. When on, Modern office workers walk in at the lobby or ride in on the Metro over 7 to 10 AM on weekdays, leave over 4 to 7 PM, and an office counts only the workers at their desks; Modern express cars move four times as fast (`GameMode::express_speed_factor`). Classic offices keep the clock's head count either way.
- `unitCard` adds a `workersComing` slot (the view layout goes to 24). It reads empty while real office commutes are off.

## 1.36.0 (2026-11-14)

- A car sold now holds back each hour the player cut back that the sale leaves at the whole fleet's size (`Schedule::held_back`, the new `HeldBack` type, `Schedule::refit`), so a car bought back joins only the hours that ran every car. A player's schedule edit that names no `heldBack` (`Tower::set_schedule`) keeps each held hour whose count it leaves as it was, and drops one it sets to another count.
- Save version 10 adds a schedule's `heldBack` hours. A save carries it, and is stamped 10, only when an hour is held back; every other save keeps version 7 or 9. `stamped_save_version(has_tall_lobby, holds_an_hour_back)` gives the version a save is stamped with; `save_version` keeps its one argument and answers for a save with no held hour.
- The undo check dates a unit an undo or redo put back by its return rather than its first build (#1846), and a step that takes out ground-floor lobby tiles passes a run that reaches the root of a part those tiles joined when they went in (#1848). Both only allow undos the check used to refuse; nothing it refused before for a real reason now applies.

## 1.35.2 (2026-11-14)

- A trip with an open end on a floor of several runs (a lot of separate ground lobbies) starts or ends in the run nearest its other end that a route reaches (`crowd::doors`), trying the next nearest when Classic's walk budget refuses one; a floor with one run picks the tile it always did. `routing::passenger_parts` caches the passenger graph's parts per tower revision so the choice skips runs no route could join without a search.
- `balance_shafts` weights each shaft of a bank by the cars its schedule keeps on shift at the crowd's hour (`Crowd::weekend` joins `Crowd::hour`); a bank whose shafts run alike draws exactly as before.
- `Kind::takes_walk_ins` answers false while `facilities::WALK_INS_ON` is off, which turns off the outside customers and restores the demand-counted patronage and dispatch estimate for those kinds. The conformance lock and goldens are re-pinned.

## 1.35.1 (2026-11-14)

- Every load path refuses a save with no numeric `minutes` or no `units` list at its top level, with a sentence a player can read; it used to load such a save as an empty tower.
- An undo or redo step that would put back a ground-floor or basement tile reaching no tile there that stays is refused as `Blocked`.

## 1.35.0 (2026-11-14)

- `crowd::walk_ins` books each open shop's and restaurant's customers from outside every hour, as many as its demand sends, and starts them at the ground lobby or a served Metro platform, split by what each entrance's transport carries; they are counted apart from the 140-person sample (`Crowd::walk_in_count`, ceiling `MAX_WALK_INS`).
- A car in the crowd now holds as many riders as its kind (21 standard, 17 service, 42 express) instead of 12, so riders from outside share the cars one to one with the tenants; `CAR_CAPACITY` is deprecated.
- Every kind that `Kind::takes_walk_ins` now counts the customers inside as its head count (`Kind::counts_visitors`), and its patronage counts arrivals at the door; income still follows demand. The Classic ransom scenario's first threat moved to hour 1000.
- `spawn_trips` no longer sends one-way trips to or from open venues (they stood a moment and finished on the venue's floor); `SpawnFloors::open_venues` and `ErrandPlace::Venue` are gone, and `Purpose::ToVenue` and `Purpose::FromVenue` stay in the published names but no trip carries them.
- A visitor leaves a venue's `customers_in` (and `hotel_customers_in`) when their stay ends and they set off home, instead of when the trip home finishes.
- A round-tripper whose origin room is gone when their stay ends now routes to the ground lobby (`transition_to_return`) instead of finishing at the venue.

## 1.34.2 (2026-11-14)

- The `.TDT` importer joins a theater's screen piece (types 35 and 34) only to the auditorium piece (19 and 18) on its right, the way SimTower writes every theater, so theaters built flush side by side stay separate (`tdt::part_merge`). The `theatre-whole` import case in `conformance/tdt-cases.json` now carries its screen pieces on the left; it still imports as one whole theater, and its save hash moves only because the import seed follows the file's bytes.

## 1.34.1 (2026-11-14)

- Patience no longer removes a visitor or tenant from the crowd. One still on the floor their trip began on turns back (`motion::turn_back`) to where they set out (`Person::start_x`, engine-internal) and leaves there; one past their first ride, or returning, keeps waiting. A shaft that goes from under someone on foot sends them back the same way if they are still setting out, or on by a new route to their trip's last floor (`motion::reroute`); only a rider whose car went, or someone with no way on, leaves the crowd. Housekeepers keep their own rule. The conformance lock, frame days, port edits and fuzz goldens are re-pinned, and the Classic ransom scenario's first threat moved to hour 40.

## 1.34.0 (2026-11-14)

- `personCard(id)` (and `crowd::trip::trip_facts` in Rust) answers one person's trip: why they are out, where the leg they are on began and ends, and their wait, as the layout's new `personCard` record with its `personPurposes`, `tripPlaces` and `shiftSteps` codes (view layout version 23).
- A venue's visitors keep its opening hours (`Kind::is_open_at`): a dweller leaves when its venue closes, a visitor who arrives after closing turns back, and meal trips and venue visits start only while the venue is open, and for an attendance venue only while it is still open next hour (`crowd::spawn::open_for_visits`). The step passes its clock hour to the crowd (`Crowd::hour`). The conformance lock, frame days, port edits and fuzz goldens are re-pinned, and the Classic ransom scenario's first threat moved to hour 664.

## 1.33.4 (2026-11-14)

- A meal venue's head count (fast food, restaurant, food hall; `Kind::is_meal_venue`) is the customers inside it (`customers_in`) while it stands, as party halls and cinemas already count their visitors. Commercial kinds no trip is sent to keep their full head count. Like the attendance venues (`Kind::counts_visitors`), a meal venue's head count is left out of the save, starts at 0 on a load or an undo, and is not added to the elevator waiting estimate, since its diners ride as real people. The conformance lock, frame days, port edits and fuzz goldens are re-pinned, and the Classic ransom scenario's first threat moved to hour 304.

## 1.33.3 (2026-11-14)

- `Tower::removal_reason` lets a Modern sky lobby tile go (`GameMode::removes_lobby_tiles`), keeps the ground lobby in both modes, checks the story above a tall hall's top, and refuses a floor or lobby tile a shaft needs in its column.
- `remove_facility` refunds a tall lobby tile half its price on each story it rises.
- An undo or redo that takes a tall lobby tile out is refused while a story stands on top of the hall, as a sale is.

## 1.33.2 (2026-11-14)

- Studios and apartments join the kinds that cannot be placed underground (`no_basement` in the catalog), so every home follows one rule. Saves that already hold basement studios or apartments still load.

## 1.33.1 (2026-11-14)

- Housekeepers are shift workers in the crowd: each crew's six walk in from the lobby two hours before the shift (and at any later hour on duty a crew is short, as after a load), by the staff route when one reaches the lobby and the passenger route when not, chain rooms on the staff route (a housekeeper who just finished a room takes the nearest dirty room their crew may take), ride home when nothing is left, and leave through the lobby when the shift ends. A housekeeper whose trip breaks stops where they stand and is sent on instead of leaving the crowd.
- Housekeepers on shift no longer count toward the crowd's 140-person sample. A housekeeper who finishes a room is sent on after the crowd chunk they finished in, from the dirty rooms read once per step; one dispatch pass per step serves those waiting at their housekeeping rooms, and the hourly pass reads the rooms fresh.
- The conformance lock moves, since housekeepers now travel in the crowd and the rooms clean at different minutes; the Classic ransom scenario now reaches its bomb threat after 376 hourly ticks.

## 1.33.0 (2026-11-14)

- `build_cap_in(mode, kind)` gives a tower's cap per mode, and the Modern catalog publishes a Metro `buildCap` of 3. Every station stands on the first station's row, undo puts a station back beside another, and a returning rider walks to the station nearest their shaft.

## 1.32.0 (2026-11-14)

- The catalog's `rules` block adds `venueFlights` (Modern `true`, Classic `false`, `GameMode::winds_venue_flights`): whether a frontend draws a one-story flight beside a venue as a spiral staircase or a switchback escalator. Drawing only. Catalog version 18; the catalog digests move for this field alone.

## 1.31.0 (2026-11-14)

- `setPeopleWindow(floorLo, floorHi, xLo, xHi)` (and `ViewReader::set_people_window` with a `view::PeopleWindow` in the crate) makes `viewFrame` carry only the people on screen, padded so every rider of a car on screen comes along; a number that is not finite clears it.

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
