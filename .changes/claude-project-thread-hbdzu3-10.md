---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: Undo now takes back lobby tiles you laid across a gap together with the basement under them, when the part beyond the gap is a run of old plain ground floor. Before, the Undo was refused (#2210).

## Engine
- The roots an undo step's ground-floor lobby tiles joined (`joined_roots`) leave the basement the step takes out out of their flood, so each part that basement linked keeps its own root and its undo is no longer refused as `Blocked` (#2210).
