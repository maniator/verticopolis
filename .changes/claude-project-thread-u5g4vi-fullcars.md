---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: a full elevator car no longer stops at every floor where people are waiting. It passes them and stops only to let its riders off, and another car comes for the people waiting. At a busy rush, riders on the upper floors no longer wait an hour or more while full cars crawl past.
## Engine
- Modern dispatch: a car its crowd fills owns no hall call and does not restart Standard Floor Departure for riders who cannot board (`GameMode::full_cars_pass_hall_calls`). The crowd keeps those cars in `Crowd::full_cars` (marked at the last seat, cleared when a seat is left, rebuilt on load, never saved), and `ElevatorCalls` gains `full`, a copy of it for dispatch.
