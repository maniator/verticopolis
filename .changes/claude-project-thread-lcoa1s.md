---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern: elevators send the car best placed for each call (the nearest by travel, counting the stops it already owes and passing over a car heading the other way), so a far call no longer waits for a parked car and two cars no longer chase one floor. A car already on its way within the shaft's Waiting Car Response keeps the call.
- Modern: cars with no home of their own wait spread up the shaft (the first at the lobby) instead of stacking on the lobby. Homes you set are kept, and nothing new is written to your save.
- Modern: a car loading at a floor keeps boarding new arrivals, but leaves after twice its Standard Floor Departure at most.
## Engine
- Modern dispatch assigns each hall call to one on-shift car per step (`GameMode::elevators_send_the_best_car`): a car heading to the call within Waiting Car Response wins outright, else the lowest cost in floors (travel, a wrong-way car's trip out to its farthest promised stop and back plus the span, its dwell left and a dwell per promised stop). The span-less-response reach gate is retired from both modes.
- Modern cars with no home idle at the lobby (car 0) or stop `i * stops / cars` (`GameMode::spreads_unset_car_homes`); `schedule_facts` reports the same homes. Runtime only: no save, schedule or `.TDT` change.
- Standard Floor Departure restarts on arrival in both modes; Modern caps the wait at twice the setting (`GameMode::departure_wait_limit`), replacing `GameMode::departure_wait_restarts_on_arrival`. Every Modern scenario's checkpoints move.
