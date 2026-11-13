---
app: minor
crate: patch
readmes: unchanged
---
## Player
- People now get on and off an elevator only when it stops at their floor with its doors open, so you see riders step out of the car instead of hopping on and off a car passing by.
- An elevator no longer slides past a floor it was about to stop at, and the drawn car keeps closer to where the car really is, so it settles onto each stop.
## Engine
- A person boards or leaves a car only while the dispatch lists it open at their floor (`ElevatorDispatch::open_cars`): arrived, dwelling or parked. A car that would end a move within 0.05 of its target lands on it. The conformance lock moves with the crowd and the cars.
