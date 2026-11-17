---
app: none
crate: patch
readmes: unchanged
---
## Engine
- A Modern route search allocates its route's floor and shaft lists once at their size, and the floor-tile memo uses the engine's fast hasher, so a game day does slightly less work (up to 0.6% on the bench towers) with every result unchanged.
