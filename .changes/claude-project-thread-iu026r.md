---
app: patch
crate: patch
readmes: unchanged
---
## Player
- A bomb that goes off now damages only the tower it was hidden in. On a lot with several towers side by side, the others are left standing.
- During a bomb search on a lot with several towers, Security sweeps each tower separately and walks between towers only by the emergency stairs, through a floor they share such as the lobby. A tower that no floor joins to a Security office is not searched.
- Security guards searching for a bomb, and the thief and his guard, now stay the size of the crowd when you zoom out, instead of towering over several floors.
## Engine
- A bomb blast guts, on each floor within `BLAST_FLOORS` of the bomb, only the runs of floor tiles that overlap the run holding the bomb, so a tower standing apart on the same lot is spared.
- The bomb search sweeps stretches of floor (one run of floor tiles each, `events::stairs`) and routes guards over the emergency stairs between overlapping stretches. A guard's save entry adds `x`, `fromX`, `turn` and `arrive`, the bomb adds `swept`, and `bombSearch()` adds `fromLeft` and `turn` to each sweeping guard. Older saves load with whole-floor sweeps.
