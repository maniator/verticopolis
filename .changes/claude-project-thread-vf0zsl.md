---
app: patch
crate: patch
readmes: unchanged
---
## Player
- When someone waits so long for their first car that they give up on the trip, that trip now counts against their floor as a very long wait. Before, a person who gave up waiting for their first car counted no wait at all, so a floor whose people kept giving up never counted as jammed. Now it does, in both Classic and Modern.

## Engine
- A tenant trip that runs out of patience before boarding and turns back folds a wait of at least twice the mode's commute wait limit onto its floor's commute average (240 s Classic, 360 s Modern). A trip cut short by an edit (a shaft or car removed) is not a give-up. Saves carry the person's `gaveUp` flag. The conformance lock and the frame-day and port-edit goldens moved.
