# SimTower (1994): Gameplay Parity Checklist

This is a clean-room clone of Maxis/OPeNBooK's **SimTower** (1994), built from
scratch in TypeScript on the Excalibur.js engine. The goal is **1:1 gameplay**
on desktop with a modernized layout on mobile. Below is the feature inventory
and where each item stands. Status: ✅ implemented · ◑ implemented as a faithful
abstraction · ⬜ not present.

## Building & structure
- ✅ Two-layer grid: structural floor/corridor layer + room layer
- ✅ Ground lobby; **sky lobbies only on the ground floor and every 15th floor** (15, 30, 45…)
- ✅ Lobbies are transit-only, so rooms can't be placed on a lobby concourse
- ✅ Floors auto-created under a room when placed (no pre-laying bare floor)
- ✅ No floating overhangs: a room must sit on the floor directly below (or the ground)
- ✅ Basements (B1…B10) with continuous numbering (floor 0 = B1)
- ✅ Multi-story facilities (cinema and party hall span 2 floors; recycling 2; metro a whole basement floor)
- ✅ Build/sell with construction time and a partial-refund bulldoze
- ✅ Buildable bounds: 100 floors above, 10 basement levels below (B1…B10)

## Facilities (all original tenant/room types)
- ✅ Office (quarterly rent; staffed 8–18 on weekdays)
- ✅ Condominium: one-time sale, residents live in permanently. Classic lists on the canon 4-level ladder ($50k/$100k/$150k/$200k, and MAY firesale below build cost, exactly as in 1994); Modern keeps the construction-cost band (default ~2× build cost, up to a ~2.5× ceiling, floor at break-even; a higher asking price sells slower). Losing an owner to sustained neglect triggers a full-price **buy-back**
- ✅ Hotel: Single / Double / Suite (nightly revenue, guests check in/out)
- ✅ Fast Food, Restaurant, Retail Shop (daily traffic income, business hours)
- ✅ Cinema and Party Hall, both two-story rooms (guests enter on the lower floor); evening crowds
- ✅ Services: Security, Medical Center, Housekeeping, Recycling Center, Parking
- ✅ Recycling Center **fills daily** with the tower's garbage (one center per ~2,500 population; a pre-dawn garbage truck empties them). 4★ requires demand MET, not merely built
- ✅ Parking demand: offices want a space per ~12 workers from 3★; **every hotel suite needs a space of its own** (the VIP won't review without it); cars visibly fill the garage with real usage
- ✅ Metro Station (whole-floor deep basement; brings visitors)
- ✅ Wedding Hall on floor 100 (religion-agnostic stand-in for the Cathedral)

## Transport
- ✅ Stairs, Escalators (single-floor links, animated climbers)
- ✅ Standard / Service / Express elevators with multiple cars (service elevators are staff-only: housekeepers ride them, passengers never do)
- ✅ Per-elevator car count and **per-floor stop configuration** (express / skip); per-shift car scheduling and per-car home/waiting floors are a tracked gap (see Known parity gaps)
- ✅ Demand-driven car dispatch (SCAN): cars serve waiting passengers, idle at the lobby when empty
- ✅ Riders board to capacity and alight; cab shows its real load
- ✅ Elevator-network reachability gates whether a floor is "served"

## Economy
- ✅ Start with $2,000,000
- ✅ Office rent (quarterly), condo sale (once, with an owner buy-back on loss), hotel nightly revenue
- ✅ **Classic prices exactly like 1994** (v1.50.0, #299): offices, condos, and all three hotel room kinds use the original's discrete 4-level rate dropdown (Very Low / Low / Average / High) at the researched canon dollar tables (office 2k/5k/10k/15k quarterly; condo 50k/100k/150k/200k one-time; hotel single 500/1,500/2,000/3,000, double 800/2,000/3,000/4,500, suite 1,500/4,000/6,000/9,000 nightly), plus the **No Rate** off-market state (charges nothing AND blocks move-ins; an occupied unit keeps its free tenant, who still counts toward stars). Pre-split Classic saves snap once onto the ladder at load. Modern keeps the tuned continuous ranges. The dollar tables are single-source (Relentless Optimizer) pending a manual cross-check; canon hotel rates run ~10x our old band, an accepted faithful consequence (money trivializes late, as in 1994)
- ◑ Food / retail / cinema / party-hall traffic income, scaled by foot traffic + open hours (an aggregate foot-traffic model; per-venue dedicated patronage and cross-venue lift are a tracked gap, see Known parity gaps)
- ✅ Per-car and per-service monthly maintenance
- ✅ Buried treasure when excavating basement rooms

## Population, stress & ratings
- ✅ Population from offices/condos/hotels; weekday/weekend + rush-hour cycle
- ✅ **Individually-routed commuters**: real people walk to a shaft, wait, board an actual car, transfer at sky lobbies and arrive (BFS over the transport network)
- ✅ Tenant stress from real elevator waits (visible commuter frustration) on top of an aggregate congestion backstop → low-satisfaction tenants move out
- ✅ **Two-ride rule has teeth:** a floor more than two rides from the lobby (one sky-lobby transfer) draws no visitors. Its shops/food/cinema earn **no** traffic income, not just a warning, so late-game transport layout is a real economic puzzle
- ✅ Crowds tint red when they've waited too long / transport is overwhelmed (the original's visual cue)
- ✅ Star thresholds: 2★ 300 · 3★ 1,000 · 4★ 5,000 · 5★ 10,000
- ✅ Facility gates: Security required for 3★; Medical + recycling demand met for 4★
- ✅ **TOWER** rating: 5★ + Wedding Hall + metro + VIP inspection (8,000 pop, scaled to our model)

## Events & disasters
- ✅ Fire: spreads to the same-floor neighbor AND climbs to the room above (canon: fire spreads sideways and upward, never down) unless Security/Medical contain it; burned rooms are destroyed (gutted shells you must bulldoze and rebuild), never auto-repaired
- ✅ Bomb threat (4★+): Security defuses it; otherwise damage + fine, with an explosion flash at the blast epicenter
- ✅ VIP inspection → TOWER win/lose: the VIP's limousine pulls up to the lobby for the review
- ✅ Treasure discovery (a gold sparkle rises from the dig site); flavorful headlines
- ✅ Seasonal cameo: Santa's sleigh and reindeer fly across the sky above a 3★+ tower once over the holidays (a cameo only: "No presents, sorry", no cash)
- ✅ Thief: slinks across the floor with a loot sack; Security catches them (a guard trails them), otherwise they make off with some cash

## Stats & readouts
- ✅ Tower Statistics: population, tenancy, transport/access, parking & recycling demand, milestones
- ✅ **Income breakdown**: average $/day per category (offices, condos, hotels, retail, food, entertainment) net of each line's overhead, plus an upkeep line and net, over a trailing quarter (the original's income report)
- ✅ **Elevator utilization**: per-passenger-shaft average load (busiest first) in the stats screen, and a near-capacity warning in the shaft inspector
- ✅ **Colored evaluation overlay**: a toggleable per-floor heatmap (Congestion / Occupancy / Satisfaction) with a legend, like the original's map views

## Time, audio, presentation
- ✅ **The 1994 "breathing clock"**: real time is spent the way the original spent its 2,600 frames/day. The clock crawls through the lunch crush and races through the small hours (span table in `docs/canon/tdt-format.md` §3), normalized so a full day costs the same real time and the speed buttons keep their meaning. Presentation-only (the sim stays a uniform 1,440-minute day); a per-device **Steady clock** preference in Help disables the rhythm
- ✅ **Canon calendar** (Classic): the compressed 1994 calendar from `docs/canon/tdt-format.md` §3, a 3-day week (2 weekday + 1 weekend), a 3-day quarter, and a 12-day year (day counter rolls at 11,987 = 999 years). Office rent collects each quarter (every 3 days); the Finance date matches the retail game (e.g. `currentDay` 1280 reads "Year 107", which our old 360-day calendar rendered "Year 4"). Rent and maintenance amounts are rescaled to the period so income per in-game day is unchanged. Modern picks this compressed calendar or a friendlier real-world length (7-day week, 90-day quarter, 360-day year) at New Tower
- ✅ **Meal cadence**: all four daily meal windows drive real elevator load from every eating population. Breakfast (6-9) brings hotel guests and condo residents down for fastFood; lunch (11-14) is the workday peak from offices, condos, hotels and on-shift staff, filling fastFood and restaurants; dinner (17-20) mirrors lunch with a clock-crawl at 18:00 that reads visibly slow like the noon one; late-night (21-24) sends hotel and condo traffic to fastFood-until-close and cinema. Bulletin logs for breakfast/lunch/dinner match the original's tempo cues
- ✅ **Meal round-trips visibly thin the room**: a worker who leaves floor 32 for lunch has an EMPTY desk until she walks back. Offices and condos show real per-person departures during their meal windows and refill on return, matching the 1994 game's "the elevators just called them all down" feel. Round-trippers pause 30-60 minutes at the venue to eat, then walk home; a bulldozed origin during someone's lunch is a silent despawn, no ghost effects. Hotel rooms do not yet draw guest figures, so their visual dip is a planned follow-up
- ✅ **Venue-population census seam**: a worker or resident out on a meal round-trip is tracked separately via the transient `outForMeal` overlay, so venue-side meal counts can read the lunch crowd without mutating the room's canonical occupancy. The displayed population stays on the canonical room census, and the rating census keeps the canon hotel rule: a guest out for a meal, like a guest in-room, stops counting once the tower reaches 3★
- ✅ Day/night sky with the sun and moon both arcing across; lit interiors at night, lights-out when empty/asleep, shops show CLOSED off-hours
- ✅ Weather: deterministic per-day clear / cloudy / rain (the `WeatherKind` states), with drifting clouds and rain streaks (purely cosmetic; off the gameplay RNG)
- ✅ Location-aware procedural soundtrack + SFX
- ✅ Pan / zoom / pinch and collision-based picking, all via Excalibur
- ✅ Animated people: lobby/corridor walkers, stair/escalator climbers, elevator riders, the metro train
- ✅ Rooftop construction crane perched over the highest built floor (animated trolley, hook and night beacon) until the tower tops out at floor 100. Then it comes down, as in the original
- ✅ Exterior escape stairs zigzagging down both sides of the tower silhouette
- ✅ Grand lobbies: the ground concourse gets marble, gilded cornice, columns, red carpet and chandeliers that glow after dark; sky lobbies read as cooler stone with planters and framed prints

## Save / platform
- ✅ Autosave + multiple save slots, `.vctower` tower-file export/import (`localStorage`)
- ✅ Import of original 1994 SimTower saves (**`.TDT`**, per `docs/canon/tdt-format.md`): funds, star rating, clock, floors, rooms, rent classes, hotel room states, and the save's own elevators and stairways (with their per-floor stop settings) come over, with a fidelity report shown before anything is adopted and an auto-save to a free slot. A truncated or corrupt transport block falls back to a synthesized elevator layout, and the report says which path ran; tenant names, retail subtypes and finance history are queued follow-ups (backlog `tdt-importer`)
- ✅ Export back to original 1994 SimTower saves (**`.TDT`**): rooms with occupancy and hotel states, transports with per-floor stop settings, funds, star, and the clock make the trip; a reverse fidelity modal shows what stays behind (funds round to $100, names and the ledger drop; since the v1.50.0 pricing split Classic rents already ARE the four 1994 lease classes, so they round-trip losslessly and the old "rents snap" line no longer applies) before anything downloads, and Modern-rule towers are refused. Every exported file must re-import through our own parser with zero warnings; validation against the real game is a recorded follow-up (backlog `tdt-exporter`)
- ✅ Mobile: responsive layout, touch pan/pinch, drawer panels

## Deliberate divergences
- Commuters are **individually pathfound** (walk → wait → ride a real car → transfer → arrive) and their waiting drives stress, but a lightweight **aggregate** congestion model still runs underneath as the deterministic, DOM-free backbone the headless tests assert against. The visible crowd is capped (~140 on screen) for performance rather than rendering the entire population at once.
- The **Cathedral** is a religion-agnostic **Wedding Hall**.
- The population census counts **occupants**: office workers + condo residents (hotel guests count up through 4★, then drop out); retail/food/visitors never do. The **TOWER** goal is the canonical **15,000**, kept reachable by the canon **375-tile** buildable lot width (the 1994 map is 375 segments wide; a well-zoned 100-floor tower measures well over 15,000 occupants).
- Optional **rule-set** chosen when a tower is founded and fixed for its life: **Classic** is the pixel-faithful 1994 game; **Modern** adds what the original couldn't; today that means *variant households* (a condo sells to a 2–5 person family, weighted to a mean of 3 so the star ladder is unchanged, that scales its price and how demanding it is) and a *calendar choice* (the compressed 1994 calendar or a real-world-length one). Classic always runs the canon calendar. Saves with no mode load as Classic, and a Modern save with no calendar choice loads real-world-length.
- **Housekeeping is modeled on rooms-per-crew with staff-network routing and cockroach spread**, not the 1994 "six housekeepers, one floor each, and a service elevator over exactly six floors" geometry. That geometry optimized around a pathfinding quirk (seven-plus floors degraded), which we deliberately do not reproduce.
- **Cockroaches are visible and have a full lifecycle** (as of 1.53). A hotel room left dirty for 3 straight days breeds a roach **infestation** (a distinct sprite and room state) that housekeeping can no longer clean, exactly as in 1994. **Classic** recovers only by bulldozing and rebuilding (canon). **Modern** adds an owner-ratified paid **exterminator** (a call-out fee plus a per-room fee, landing the next day) as an alternative to the bulldozer; this is a new mechanic, gated through the rule-set, and the only divergence here. Roaches spread along the hotel floor (never between floors), matching canon.
- **Commercial patronage is modeled from reachable nearby population** rather than the original's opaque per-venue patron counters (which expert players suspect hide a cap). The transparent per-origin demand-pool refinement that restores the classic diminishing-returns and cross-venue behavior is tracked (#393); the opaque counter itself is not reproduced.

## Known parity gaps (tracked, 2026-07-15)

An r/SimTower optimization-thread review (a four-lens roundtable across game
design, systems, engineering, and UX) surfaced deeper 1994 behaviors that sit
under the checkmarks above. They are identified, sorted, and tracked; the full
analysis is
`_bmad-output/planning-artifacts/design/gdd-simtower-optimization-gaps-2026-07-15.md`.

- **Deep per-elevator scheduling**: per-shift car schedules and per-car home/waiting floors. Today we expose car count and per-floor stops only. Tracked as `elevator-scheduling` #305 (owner ruling: full parity).
- **Per-venue demand and cross-venue patronage**: commercial income is an aggregate foot-traffic share today, so it lacks diminishing returns on venue count and the "good to best" cross-venue lift. Tracked #393, with the "leave the tower when no venue is reachable" population pressure as #395.
- **Graduated far / very-far lobby-distance penalty for all tenants**: shipped in v1.44.0 as #394, recalibrated in v1.46.1 by owner ruling (2026-07-16). The optimization-thread analysis reports the 1994 game capping mid-block floors (6-10, 21-25, ...) even under correct play; v1.44.0 mirrored that, which left about 40 percent of a fully-lobbied tower permanently capped while the inspector prescribed a "nearer sky lobby" the placement grid refuses. The ruling favors feedback integrity over that mid-block tithe: the no-penalty edge is now derived from the lobby ladder (floor(lobbyInterval / 2)), so a tower with every legal sky lobby built feels no distance pressure, the bands land only on genuinely skipped lobbies, and the short block above the highest buildable slot caps at worst and never evicts, with the inspector naming only slots that can actually be built. A deliberate, recorded divergence. Re-keying the pressure on elevator reach and transfer depth (what the wait-time-centered reading of the original models) is the tracked follow-up.
- **Contiguous sky-lobby transfer requirement**: express-to-standard transfers use implicit shared-stop adjacency today. Tracked #396 (Classic-gated).
- **Condo demographics (school runs) and office sales-call trips**: today a generic household-departure model, no school entity or sales calls. Tracked #397. Weekend patronage curve: #398.
- **UI legibility of the above** (next-star blockers, per-unit gripe reason, cleanliness/coverage overlay): #399, #400, #401.

## Verification
`npm test` runs **500+ unit/integration tests** covering placement rules,
economy, ratings gates, the housekeeping/fire/bomb events, elevator dispatch,
the individually-routed **crowd's BFS routing and movement**
(`src/tests/integration/crowd.integration.test.ts`), save/load, and an
**end-to-end run to the TOWER victory** (`src/tests/integration/parity.integration.test.ts`).
