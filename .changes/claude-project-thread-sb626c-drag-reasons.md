---
app: patch
crate: patch
---
## Player
- Dragging an elevator's arrow past a floor it can't serve, such as an unbuilt lobby or another shaft, now grows the shaft as far as it can go and says why it stopped when you let go.
- A bulldoze drag that leaves tiles behind, such as Classic's rule that a floor comes out only from either end, now says why once when you let go.

## Engine
- `extend_transport` stops a shaft just short of the first floor it cannot newly serve (another shaft in the way, or a lobby floor whose lobby is not built under it) and reports that floor's reason with the done step; the whole step is no longer refused. `extendShaft` leaves the reason in `lastReason()` (#1847).
