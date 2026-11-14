---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern: sky bridges. Lay lobby across the open air between two towers' sky lobbies on the same floor, up to 24 tiles, and people walk across to use either tower's elevators. A bridge tile costs twice a lobby tile and carries nothing, and the bulldozer never leaves part of a bridge hanging.
## Engine
- Modern places a lobby tile over open air on a sky lobby floor as a sky bridge tile when a sky lobby closes the gap on both sides within `SKYBRIDGE_MAX_SPAN` tiles; `Tower::is_skybridge_tile` reports one. A bridge carries no story or shaft, costs twice a lobby tile, and Classic placement is unchanged.
