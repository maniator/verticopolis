---
app: minor
crate: patch
readmes: unchanged
---
## Player
- While Security searches for a bomb, the tower stands still: elevators stop and tenants and visitors wait where they are until the bomb is found or goes off. Only the guards move. You can't build, bulldoze, sell, change an elevator, or undo and redo until the search ends. A tower with no Security to search keeps running and takes edits as usual.
## Engine
- While any guard is still out searching for a bomb (`Simulation::bomb_lockdown`, both modes), a step skips the crowd and the cars (no arrivals, walks, rides, car moves or elevator demand) and the hourly housekeeping pass sends no maids. The clock, the hourly and daily rules and the guards' search go on. A bomb nobody searches for freezes nothing. `bombSearch()` adds `lockdown`, so a renderer can tell.
- During that lockdown every edit is refused with `BOMB_SEARCH_EDIT_REFUSAL` (`Simulation::edit_refusal`): `can_build`, `build`, `paint_brush`, `can_build_transport`, `build_transport`, `remove_facility`, `sell_at`, `add_car`, `remove_car` and `extend_transport` on the crate, the new `edit_stop`, `edit_express_stops`, `edit_clear_stops` and `edit_schedule` (the player's stop and schedule changes, which the binding now routes through), and undo and redo (a refused step is kept for after the search).
- The conformance lock moves for `ransom-declined-classic`, `ransom-declined-modern` and `ransom-ignored-modern`; the last now waits a day for its search to end before it sells Security. No other scenario, frame-day case or fuzz entry moves.
