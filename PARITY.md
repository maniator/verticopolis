# SimTower (1994): Gameplay Parity Checklist

The developer's checklist of how a **Classic** tower matches the 1994 game,
one line per mechanic. Players read the same story in the manual:
**[Differences from the 1994 game](https://verticopolis.com/help/differences/)**.
The rules themselves live in the Rust engine (`engine-rs/`), and its catalog
publishes the prices, sizes and caps, so this page names mechanics and issues
rather than copying numbers. Status: ✅ implemented · ◑ a faithful
abstraction · ⬜ not present.

Every entry under **Deliberate divergences** and **Known parity gaps** links
the help-page section that explains it to players, and
`src/tests/parityHelpPage.guard.test.ts` fails when either side lists one the
other does not.

## Building & structure
- ✅ Two layers: a floor layer and a room layer; floors appear under a room as it is placed, and nothing overhangs
- ✅ Ground lobby plus sky lobbies every 15th floor; lobbies are transit-only
- ✅ Basements below with continuous numbering (floor 0 = B1); the canon 375-tile lot
- ✅ Multi-story rooms (cinema, party hall, recycling, the whole-floor metro)
- ✅ Construction time and a partial-refund bulldoze
- ✅ Classic floors stay whole when bulldozed: only a story's end tiles come out (owner rulings 2026-11-12 and 2026-11-13, #2042; a PC check is still open). Modern may open a gap

## Facilities
- ✅ Offices (quarterly rent, weekday hours), condos (one sale, owner buy-back on loss), hotel single / double / suite (nightly)
- ✅ Fast food, restaurant, shop (business hours, foot traffic); cinema and party hall (evening crowds)
- ✅ Security, Medical Center, Housekeeping, Recycling Center, Parking, Metro Station
- ✅ Recycling fills daily and a pre-dawn truck empties it; 4★ needs the demand met; a shortfall lowers ratings from 3★ (#1970)
- ✅ Parking: offices from 3★ and one space per hotel suite; offices without parking lose rating from 3★ (#1970; distance to parking waits on a PC check, #1524)
- ✅ Wedding Hall on floor 100 in place of the Cathedral (see divergences)

## Transport
- ✅ Stairs and escalators as single flights; Classic people chain at most 4 stair flights or 7 escalators before refusing (#384, #323)
- ✅ Standard, service (staff only) and express elevators with several cars
- ✅ Per-floor stops, hour-by-hour car schedules and idle home floors (#464); the epic's follow-ups stay on #305
- ✅ Demand-driven dispatch; riders board to capacity; a floor counts as served only when the network reaches it

## Economy
- ✅ $2,000,000 to start; rent, condo sales, nightly hotel income, monthly upkeep
- ✅ Classic prices on the 1994 four-level ladder plus No Rate (#299); Modern keeps continuous ranges
- ◑ Shop, food and venue income from reachable foot traffic (#393; see divergences)
- ✅ Buried treasure when excavating basement rooms

## Population, stress & ratings
- ✅ Weekday, weekend and rush-hour cycles; four daily meal windows that load the elevators
- ✅ Individually routed commuters whose floor waits move ratings (#1971; see divergences)
- ✅ The two-ride rule: a floor more than two rides from the lobby draws no visitors
- ✅ Crowds turn red when transport is overwhelmed
- ✅ Star thresholds, facility gates and the TOWER at 15,000 with the VIP inspection

## Events & disasters
- ✅ Fire spreads sideways and up, never down; burned rooms stay gutted until bulldozed
- ✅ Bomb threats from 4★; the VIP's visits and the TOWER inspection
- ◑ While Security searches for a bomb, everyone else and every elevator stands still, and the tower takes no edits (the owner's recollection and call; whether the 1994 game does this is still to observe, #349)
- ✅ Treasure, thieves, Santa's sleigh (a cameo only) and newspaper headlines

## Stats & readouts
- ✅ Tower Statistics, the income breakdown, elevator utilization, the Map's evaluation views

## Time, audio, presentation
- ✅ The 1994 "breathing clock" (presentation only; Steady clock turns it off)
- ✅ The canon compressed calendar in Classic (`docs/canon/tdt-format.md` §3); Modern may pick a real-world length
- ✅ Day and night, lit windows, weather (cosmetic), the crane until floor 100, exterior escape stairs, grand lobbies
- ✅ Location-aware soundtrack and effects; pan, zoom and pinch

## Save / platform
- ✅ Autosave, save slots, `.vctower` export and import
- ✅ `.TDT` import with a fidelity report (backlog `tdt-importer` for tenant names, retail subtypes, finance history)
- ✅ `.TDT` export for Classic towers with a reverse fidelity report; Modern towers are refused (backlog `tdt-exporter`). Two game-side limits: a tower with rooms and no tenants shows a black frame in 1994 (#510, won't fix), and burned rooms go over cleared because the original can't draw them
- ✅ Mobile layout with touch pan and pinch

## Deliberate divergences
- Commuters are individually pathfound, with an aggregate congestion model underneath and a capped on-screen crowd. [Help](https://verticopolis.com/help/differences/#every-commuter-is-a-real-person)
- The Cathedral is a religion-agnostic Wedding Hall. [Help](https://verticopolis.com/help/differences/#the-wedding-hall)
- The census counts occupants (hotel guests until 4★, shoppers inside venues), with the TOWER at the canon 15,000 on the 375-tile lot. [Help](https://verticopolis.com/help/differences/#who-counts-toward-population)
- Housekeeping fields six simulated maids per unit on stairs and service elevators, with no 1994 long-trip pathfinding decay and no housekeeping build cap (1.54, 1.57). [Help](https://verticopolis.com/help/differences/#housekeeping-maids)
- Cockroach infestations are visible rooms with a full lifecycle; Classic cures only by bulldozing (1.53). [Help](https://verticopolis.com/help/differences/#cockroaches-you-can-see)
- Shop and restaurant patronage comes from the reachable nearby population; the original's opaque per-venue counters are not reproduced (#393). [Help](https://verticopolis.com/help/differences/#shoppers-come-from-nearby-floors)
- A rule-set (Classic or Modern) is chosen at founding and fixed for the tower's life; saves with no mode load as Classic. [Help](https://verticopolis.com/help/differences/#two-ways-to-play)
- Modern builds while paused; Classic refuses, as 1994 does (#1936). [Help](https://verticopolis.com/help/differences/#building-while-paused)

## Known parity gaps
- Lobby-distance pressure: Verticopolis drops the 1994 mid-block cap once every legal sky lobby is built (owner ruling 2026-07-16, #394); re-keying it on elevator reach is #436. [Help](https://verticopolis.com/help/differences/#lobby-distance)
- Other actions while paused: whether 1994 also refuses bulldozing, elevator or rent edits and the inspector, and whether a loaded tower starts paused, waits on a PC check (#1974). [Help](https://verticopolis.com/help/differences/#other-actions-while-paused)

The gaps from the 2026-07-15 r/SimTower optimization-thread review have
shipped (#393, #395 to #401); the review is
`_bmad-output/planning-artifacts/design/gdd-simtower-optimization-gaps-2026-07-15.md`.

## Verification
`npm test` runs the web game's unit and integration tests, and `cargo test`
in `engine-rs/` runs the engine's own: placement, economy, rating gates, the
events, dispatch, crowd routing, save and load, and the TOWER award. The
conformance suite replays every scenario in `conformance/scenarios/` and
checks each checkpoint hash against `conformance/expected.json`.
