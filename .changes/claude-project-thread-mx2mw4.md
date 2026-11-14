---
app: minor
crate: minor
---
## Player
- Click or tap a walking person with the Inspect tool to see who they are, why they are out, where they came from, where they are going and how long they have waited, in Classic and Modern.
- The person card has a Follow button that keeps the camera on them until you move the view or close the card.
## Engine
- `personCard(id)` (and `crowd::trip::trip_facts` in Rust) answers one person's trip: why they are out, where the leg they are on began and ends, and their wait, as the layout's new `personCard` record with its `personPurposes`, `tripPlaces` and `shiftSteps` codes (view layout version 23).
