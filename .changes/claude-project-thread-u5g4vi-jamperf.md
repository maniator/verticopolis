---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern towers with long elevator lines run faster: the game works out each line's wait once a step instead of at every look, and reuses a route it has just found while nobody has joined a line since.

## Engine
- The Modern router keeps each line's boarding cost and the routes it found until a rider joins a line or the step's lines change. Every route comes out as before; the conformance lock and the fuzz corpus do not move.
