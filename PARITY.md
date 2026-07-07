# SimTower (1994) — Gameplay Parity Checklist

This is a clean-room clone of Maxis/OPeNBooK's **SimTower** (1994), built from
scratch in TypeScript on the Excalibur.js engine. The goal is **1:1 gameplay**
on desktop with a modernized layout on mobile. Below is the feature inventory
and where each item stands. Status: ✅ implemented · ◑ implemented as a faithful
abstraction · ⬜ not present.

## Building & structure
- ✅ Two-layer grid: structural floor/corridor layer + room layer
- ✅ Ground lobby; **sky lobbies only on the ground floor and every 15th floor** (15, 30, 45…)
- ✅ Lobbies are transit-only — rooms can't be placed on a lobby concourse
- ✅ Floors auto-created under a room when placed (no pre-laying bare floor)
- ✅ No floating overhangs — a room must sit on the floor directly below (or the ground)
- ✅ Basements (B1…B10) with continuous numbering (floor 0 = B1)
- ✅ Multi-story facilities (cinema spans 2 floors; recycling 2; metro a whole basement floor)
- ✅ Build/sell with construction time and a partial-refund bulldoze
- ✅ Buildable bounds: 100 floors above, 10 basement levels below (B1…B10)

## Facilities (all original tenant/room types)
- ✅ Office (quarterly rent; staffed 8–18 on weekdays)
- ✅ Condominium — one-time sale, residents live in permanently. Priced on the original's construction-cost scale (default ~2× build cost, up to a ~2.5× ceiling; a higher asking price sells slower), and losing an owner to sustained neglect triggers a full-price **buy-back**
- ✅ Hotel — Single / Double / Suite (nightly revenue, guests check in/out)
- ✅ Fast Food, Restaurant, Retail Shop (daily traffic income, business hours)
- ✅ Cinema (multi-floor, evening crowds), Party Hall
- ✅ Services — Security, Medical Center, Housekeeping, Recycling Center, Parking
- ✅ Recycling Center **fills daily** with the tower's garbage (one center per ~2,500 population; a pre-dawn garbage truck empties them) — 4★ requires demand MET, not merely built
- ✅ Parking demand: offices want a space per ~12 workers from 3★; **every hotel suite needs a space of its own** (the VIP won't review without it); cars visibly fill the garage with real usage
- ✅ Metro Station (whole-floor deep basement; brings visitors)
- ✅ Wedding Hall on floor 100 (religion-agnostic stand-in for the Cathedral)

## Transport
- ✅ Stairs, Escalators (single-floor links, animated climbers)
- ✅ Standard / Service / Express elevators with multiple cars (service elevators are staff-only: housekeepers ride them, passengers never do)
- ✅ Per-elevator car count and **per-floor stop configuration** (express / skip)
- ✅ Demand-driven car dispatch (SCAN): cars serve waiting passengers, idle at the lobby when empty
- ✅ Riders board to capacity and alight; cab shows its real load
- ✅ Elevator-network reachability gates whether a floor is "served"

## Economy
- ✅ Start with $2,000,000
- ✅ Office rent (quarterly), condo sale (once, at ~2×–2.5× build cost with an owner buy-back on loss), hotel nightly revenue
- ✅ Food / retail / cinema / party-hall traffic income, scaled by foot traffic + open hours
- ✅ Per-car and per-service monthly maintenance
- ✅ Buried treasure when excavating basement rooms

## Population, stress & ratings
- ✅ Population from offices/condos/hotels; weekday/weekend + rush-hour cycle
- ✅ **Individually-routed commuters** — real people walk to a shaft, wait, board an actual car, transfer at sky lobbies and arrive (BFS over the transport network)
- ✅ Tenant stress from real elevator waits (visible commuter frustration) on top of an aggregate congestion backstop → low-satisfaction tenants move out
- ✅ **Two-ride rule has teeth:** a floor more than two rides from the lobby (one sky-lobby transfer) draws no visitors — its shops/food/cinema earn **no** traffic income, not just a warning, so late-game transport layout is a real economic puzzle
- ✅ Crowds tint red when they've waited too long / transport is overwhelmed (the original's visual cue)
- ✅ Star thresholds: 2★ 300 · 3★ 1,000 · 4★ 5,000 · 5★ 10,000
- ✅ Facility gates: Security required for 3★; Medical + recycling demand met for 4★
- ✅ **TOWER** rating: 5★ + Wedding Hall + metro + VIP inspection (8,000 pop, scaled to our model)

## Events & disasters
- ✅ Fire — spreads to the neighbor unless Security/Medical contain it; burned rooms are destroyed (gutted shells you must bulldoze and rebuild), never auto-repaired
- ✅ Bomb threat (4★+) — Security defuses it; otherwise damage + fine, with an explosion flash at the blast epicenter
- ✅ VIP inspection → TOWER win/lose — the VIP's limousine pulls up to the lobby for the review
- ✅ Treasure discovery (a gold sparkle rises from the dig site); flavorful headlines
- ✅ Seasonal cameo: Santa's sleigh and reindeer fly across the sky above a 3★+ tower once over the holidays (a cameo only — "No presents, sorry", no cash)
- ✅ Thief — slinks across the floor with a loot sack; Security catches them (a guard trails him), otherwise they make off with some cash

## Stats & readouts
- ✅ Tower Statistics: population, tenancy, transport/access, parking & recycling demand, milestones
- ✅ **Income breakdown** — average $/day per category (offices, condos, hotels, retail, food, entertainment) net of each line's overhead, plus an upkeep line and net, over a trailing quarter (the original's income report)
- ✅ **Elevator utilization** — per-passenger-shaft average load (busiest first) in the stats screen, and a near-capacity warning in the shaft inspector
- ✅ **Colored evaluation overlay** — a toggleable per-floor heatmap (Congestion / Occupancy / Satisfaction) with a legend, like the original's map views

## Time, audio, presentation
- ✅ Day/night sky with the sun and moon both arcing across; lit interiors at night, lights-out when empty/asleep, shops show CLOSED off-hours
- ✅ Weather: deterministic per-day clear / cloudy / rain (the `WeatherKind` states) — drifting clouds and rain streaks (purely cosmetic; off the gameplay RNG)
- ✅ Location-aware procedural soundtrack + SFX
- ✅ Pan / zoom / pinch and collision-based picking, all via Excalibur
- ✅ Animated people: lobby/corridor walkers, stair/escalator climbers, elevator riders, the metro train
- ✅ Rooftop construction crane perched over the highest built floor (animated trolley, hook and night beacon) until the tower tops out at floor 100 — then it comes down, as in the original
- ✅ Exterior escape stairs zigzagging down both sides of the tower silhouette
- ✅ Grand lobbies: the ground concourse gets marble, gilded cornice, columns, red carpet and chandeliers that glow after dark; sky lobbies read as cooler stone with planters and framed prints

## Save / platform
- ✅ Autosave + multiple save slots, `.vctower` tower-file export/import (`localStorage`)
- ◑ Import of original `.TWR` saves — decoder is a documented v2 stub
- ✅ Mobile: responsive layout, touch pan/pinch, drawer panels

## Deliberate divergences
- Commuters are **individually pathfound** (walk → wait → ride a real car → transfer → arrive) and their waiting drives stress, but a lightweight **aggregate** congestion model still runs underneath as the deterministic, DOM-free backbone the headless tests assert against. The visible crowd is capped (~140 on screen) for performance rather than rendering the entire population at once.
- The **Cathedral** is a religion-agnostic **Wedding Hall**.
- The population census counts **occupants** — office workers + condo residents (hotel guests count only through 3★); retail/food/visitors never do, matching the original's metric. The **TOWER** goal is the canonical **15,000**, kept reachable by the canon **375-tile** buildable lot width (the 1994 map is 375 segments wide; a well-zoned 100-floor tower measures well over 15,000 occupants).
- Optional **rule-set** chosen when a tower is founded and fixed for its life: **Classic** is the pixel-faithful 1994 game; **Modern** adds what the original couldn't — today, *variant households* (a condo sells to a 2–5 person family, weighted to a mean of 3 so the star ladder is unchanged, that scales its price and how demanding it is). Saves with no mode load as Classic.

## Verification
`npm test` runs **500+ unit/integration tests** covering placement rules,
economy, ratings gates, the housekeeping/fire/bomb events, elevator dispatch,
the individually-routed **crowd's BFS routing and movement**
(`src/tests/crowd.test.ts`), save/load, the `.TWR` parser, and an
**end-to-end run to the TOWER victory** (`src/tests/parity.test.ts`).
