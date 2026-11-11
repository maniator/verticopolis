---
app: patch
crate: minor
---
## Player
- Refusing the bomb ransom no longer settles at once with nothing to see. In both modes Security now searches the tower floor by floor against a 1:00 PM deadline: guards climb the emergency stairs and walk each floor, a countdown shows, a woodblock clock ticks, the music dips and the screen edges glow red. If they miss the bomb it goes off.
- Every turn of a bomb threat (search started, found, exploded) now pops up on screen, phone included, not only in the log.
- Modern: a Security office that opens during a search sends its guards to join it.
## Engine
- A declined ransom starts a timed bomb search in both modes (a hidden bomb, guards sweeping floors from the emergency stairs, a deadline) that the save keeps as `events.bomb` while it runs; Classic still calls only on a tower with Security.
- `bombSearch()` reads the search (each guard's floor, rooms, start, arrival and finish), and the view's header adds `bombSearchSeq` (view layout 13).
- New gameplay event `bomb_found`; the web build reports `bomb_outcome` (paid, found or exploded).
