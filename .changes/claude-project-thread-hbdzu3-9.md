---
app: patch
crate: minor
---
## Player
- A person who gives up waiting for their first elevator and turns back no longer shows as on the way back from where they were going. Their card says they gave up waiting, and that they are heading back from where they stand to where they set out.

## Engine
- `TripFacts` gains `gave_up`, and the `personCard` record gains a `gaveUp` slot (view layout version 33). For someone who gave up waiting to set out, `from` is the floor they stand on, `to` is where the trip began, and `purpose` still names what the trip was for (#2188).
