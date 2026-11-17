---
app: patch
crate: minor
readmes: unchanged
---
## Player
- A tenant complaining of crowded elevators now names the elevator on their floor with room for more cars and how many it runs, so you can add cars before building another shaft. When every elevator there already runs all its cars, the tenant says a parallel shaft is the next step (#2251).

## Engine
- The tenant gripe facts carry `roomyShaft` for an elevator-bound congestion gripe: the passenger elevator stopping on the floor with the most free car slots (kind, bottom, top, cars, max cars), or none when each is full. `unitFacts` adds `gripeShaftKind`, `gripeShaftBottom`, `gripeShaftTop`, `gripeShaftCars` and `gripeShaftMaxCars`, and the same five for the lease gripe; view layout version 30.
