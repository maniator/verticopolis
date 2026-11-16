---
app: minor
crate: minor
---
## Player
- Modern towers can build as many stairs and escalators as the lot has room for. Classic keeps SimTower's limit of 64.
## Engine
- Modern sets no limit on stairs and escalators (`GameMode::limits_stairs_and_escalators`, Classic only): `transport_pools(mode)` now returns a slice, `MODERN_POOLED_CAPS` holds the elevator pool alone, and Modern's catalog lists no `walkways` pool, with `pool: null` on stairs and escalators. Classic's catalog is unchanged.
- `transport_cap(mode)` adds the lot's room for flights (`facilities::lot_flight_room`, 46 one-story flights on each of 109 stories) where a mode sets no limit, so a Modern save keeps every flight on load.
