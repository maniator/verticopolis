---
app: patch
crate: minor
readmes: unchanged
---
## Player
- The statistics screen's Parking demand line turns red only when tenants actually feel the shortage. In Classic, one free space is all your offices need, so a garage with fewer spaces than the workers' cars no longer reads as short while it has that space.
## Engine
- New `Simulation::parking_short()`: a hotel suite lacks its space or offices are short by the mode's rule. The parking inspector's `shortage` reads it, `statsReport`'s `parkingDemand` gains `short`, and `statsSheet` gains `parkingShort` after `parkingCoverage`, so `VIEW_LAYOUT_VERSION` is 20.
