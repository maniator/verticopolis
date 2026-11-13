---
app: patch
crate: patch
readmes: unchanged
---
## Player
- A shop or restaurant just above a tall lobby no longer says it is too far from a lobby. Distance to a tall lobby now counts from its top story, for tenants' ratings too.
## Engine
- `Tower::nearest_lobby_floor_distance` counts a tall lobby hall (#308) on every story it fills, so a floor over a 3-story hall on floor 30 is one floor from it (it was three). The commercial lobby penalty, its card fact `commercial.lobbyFar`, the tenant lobby-distance drain and the card's `lobbyDistance` all read it. One-story lobbies and floors below a hall are unchanged, and no conformance scenario moves.
