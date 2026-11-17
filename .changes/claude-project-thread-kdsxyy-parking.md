---
app: patch
crate: minor
readmes: unchanged
---
## Player
- Classic: the Tower Statistics "Parking demand" line now counts what Classic asks for, one space for all the offices plus one per hotel suite, so the number agrees with its green or red color. Modern still counts a space for every 24 workers.

## Engine
- The catalog publishes `rules.officesShareOneParkingSpace`, true in Classic, where one free space serves every office (#1970).
- `statsReport`, `statsSheet` and the parking ramp's diagnostics count the offices' parking need by the mode's rule (#2024): in Classic the offices count as one space while any is tenanted. `officePop` still carries every worker, and the garage still draws every car.
