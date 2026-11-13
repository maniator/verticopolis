---
app: minor
crate: patch
readmes: unchanged
---
## Player
- While Security searches for a bomb, the tower stands still: elevators stop and tenants and visitors wait where they are until the bomb is found or goes off. Only the guards move. A tower with no Security to search keeps running.
## Engine
- While any guard is still out searching for a bomb (`Simulation::bomb_lockdown`, both modes), a step skips the crowd and the cars (no arrivals, walks, rides, car moves or elevator demand) and the hourly housekeeping pass sends no maids. The clock, the hourly and daily rules and the guards' search go on. A bomb nobody searches for freezes nothing. `bombSearch()` adds `lockdown`, so a renderer can tell. The conformance lock moves for `ransom-declined-classic`, `ransom-declined-modern` and `ransom-ignored-modern`; no other scenario, frame-day case or fuzz entry moves.
