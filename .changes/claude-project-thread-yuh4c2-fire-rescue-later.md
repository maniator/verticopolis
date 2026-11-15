---
app: minor
crate: minor
---
## Player
- Tower > Call Fire Rescue… brings the fire rescue offer back while a fire burns, so declining it the first time no longer rules it out, as in the 1994 game.
## Engine
- `Simulation::call_fire_rescue` (port command `callFireRescue`, record slot `cost`) puts the fire rescue offer up again while a fire burns, refusing with `none` when nothing burns and `pending` while a choice waits. View layout version 26 (#1889).
