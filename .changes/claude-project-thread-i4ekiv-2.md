---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Click or tap the Traffic readout when it names a floor, such as "Backed up · B2", and the view zooms in on that floor, centered on what is backing it up. The floor flashes red for a few seconds and the elevators, stairs or escalators backing it up are outlined in yellow.
## Engine
- New query `congestionCause(floor)` (and `Simulation::congestion_cause`): the ids of the transports behind one floor's congestion reading, in the tower's transport order. That is the transport with the highest estimate there (every one tied for it), or every passenger elevator stopping there when the floor's real commute wait sets the reading. Empty for a floor with no reading or one that is not a whole number. It builds the reading once, so it is a read for a tap, not a frame. No saved-game, frame, view layout or catalog change.
