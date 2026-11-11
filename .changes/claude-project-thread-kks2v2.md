---
app: minor
crate: minor
---
## Player
- Classic: refusing the bomb ransom now starts a search. Security guards sweep the tower floor by floor while a countdown runs and the clock ticks, and if they miss the bomb before the deadline it goes off.
## Engine
- Classic answers a declined ransom with a timed bomb search (a hidden bomb, guards sweeping floors, a deadline) that the save keeps as `events.bomb` while it runs; Modern still answers at once.
- `bombSearch()` reads the search, and the view's header adds `bombSearchSeq` (view layout 13).
