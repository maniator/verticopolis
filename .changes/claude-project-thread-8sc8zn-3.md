---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: bulldozing any tile of a sky bridge takes the whole bridge down, so a bridge is never left in pieces, and it waits while anyone is walking across. Undo puts the whole bridge back.
- People headed across a floor that was cut in two find another way from where they stand, instead of jumping over the gap.
## Engine
- `remove_facility` on a sky bridge tile removes every tile of that bridge and refuses while people walk on it; undo refuses the same way (`StepRefused::Crossing`). A walker whose target lies on another run of their floor reroutes from where they stand.
