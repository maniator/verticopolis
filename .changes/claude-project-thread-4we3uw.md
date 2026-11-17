---
app: patch
crate: patch
---
## Player
- An elevator's Avg load, the schedule's advice and auto-tune now count everyone riding, so a shaft busy with shoppers, moviegoers, residents, hotel guests or staff no longer reads emptier than it is.

## Engine
- The hourly demand ring and utilization (`sample_elevator_util`) count each car's estimate seats plus the crowd's own riders there (`Crowd::car_riders`), each rider once (#2397). The dispatch keeps the estimate's seats beside `car_load` without changing how any car moves, in one per-shaft record with the callers each car has seen and the time it has waited (`dispatch_cars.rs`), so a step looks a shaft up twice where it looked it up three times, and a save's `dispatch` carries them as `estimateSeats`; a save without them loads. The conformance lock is unchanged.
