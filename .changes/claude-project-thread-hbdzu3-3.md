---
app: patch
crate: patch
readmes: unchanged
---
## Player
- An elevator shaft and a room no longer share tiles. A room can't be built where an elevator runs, and an elevator can't be built or stretched through a room; the game names the one in the way. Stairs and escalators still stand in front of rooms, an elevator still runs down to a Metro platform, and a tower saved with a room already inside a shaft opens and plays exactly as before.

## Engine
- `Simulation::can_build`, `Simulation::can_build_transport`, a shaft resize or extend, and the binding's `validateTransport`, `placeTransportDryRun` and shaft quote refuse an elevator shaft and a room on the same tile, with a reason naming the one in the way. No public item is added. The raw `Tower::place` and `Tower::place_transport` and the loader are unchanged, so saved towers load as they were. Ten conformance scenarios moved their builds off shafts and the lock moved with them.
