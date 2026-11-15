---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Turning off an elevator stop no longer makes the people riding to that floor disappear from the car. They get off at the nearest stop and find the rest of the way from there.
## Engine
- A rider whose destination stopped being a stop mid-ride rides on to the car's stop nearest it and reroutes from there (#2324), instead of leaving the crowd. A rider whose car went, or with no way on from any stop, still steps out of the trip.
