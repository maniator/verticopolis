---
app: patch
crate: minor
readmes: unchanged
---
## Player
- A bomb that goes off now damages only the tower it was hidden in. On a lot with several towers side by side, the others are left standing.
- During a bomb search on a lot with several towers, Security sweeps each tower separately and walks between towers only by the emergency stairs, through a floor they share such as the lobby. A tower that no floor joins to a Security office is not searched.
- On a lot with several towers, Security catches a thief only in a tower it can walk to by the stairs, and the thief runs his own tower's rooms instead of the whole floor.
- Security guards searching for a bomb, and the thief and his guard, now stay the size of the crowd when you zoom out, instead of towering over several floors.
## Engine
- A bomb blast guts, on each floor within `BLAST_FLOORS` of the bomb, only the runs of floor tiles that overlap the run holding the bomb, so a tower standing apart on the same lot is spared.
- The bomb search sweeps stretches of floor (one run of floor tiles each, `events::stairs`) and routes guards over the emergency stairs between overlapping stretches. A guard's save entry adds `x`, `fromX`, `turn` and `arrive`, the bomb adds `swept`, and `bombSearch()` adds `fromLeft` and `turn` to each sweeping guard. Older saves load with whole-floor sweeps.
- A thief lands on a stretch of floor (one draw over each floor's stretches, the same draw as before when a tower fills its floors) and is caught only when a Security office reaches it by the stairs. `VIEW_LAYOUT_VERSION` is 22: the frame header appends `thiefFxX`, a tile of his stretch.
- The conformance lock moves: the three ransom scenarios change their state hash only, because the bomb search saves the new keys. Every other hash stays.
