---
app: minor
crate: minor
---
## Player
- A tower imported from a 1994 SimTower `.TDT` file keeps each elevator car's waiting floor, so idle cars wait where the original game had them instead of all stacking on the lobby, and exporting writes those floors back.
- Classic: elevators follow the original's two dispatch settings. With a Waiting Car Response set, a parked car stays put while another car of the shaft is already on its way to the call within that many floors, and a car loading at a floor keeps boarding new arrivals for its Standard Floor Departure wait before it leaves (or until it is full).
## Engine
- `import_tdt` writes each elevator's per-car home floors (record byte 186) as the shaft's `schedule.homeFloors`, snapped to the nearest stop, and `export_tdt` writes the authored `homeFloors` back into those bytes, falling back to the cars' positions. The `.TDT` import case hashes move.
- Classic dispatch reads Waiting Car Response as the 1994 game does (`GameMode::waiting_car_response_watches_moving_cars`: a parked car leaves a call to an on-shift car heading to it within that many floors) and restarts Standard Floor Departure on each arrival (`GameMode::departure_wait_restarts_on_arrival`), boarding the arrivals against the car's load. Modern keeps its reach reading and fixed dwell. Every Classic scenario's checkpoints move; `ransom-declined-classic` now ticks 288 hours to its first bomb threat.
