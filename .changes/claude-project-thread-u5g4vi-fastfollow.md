---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Big towers run faster: a game day on a maxed Classic tower takes about a quarter less work, a maxed Modern tower about a sixth less, and a Modern tower with a long elevator jam a little less than before the 4.1 line fix.

## Engine
- Exact speed-ups, with every game the same: the parking check fills room by room, the demand pool, crew floors, commute averages and the lobby reach sets use the fast hasher, the lobby distance walks the tall halls once, the landing lines read each shaft once per line and are kept by place in the crowd, and the Modern router prices a line only when the link could still win. The conformance lock and the fuzz corpus do not move.
