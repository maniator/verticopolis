---
app: patch
crate: patch
readmes: unchanged
---
## Player
- A floor that empties now forgets how long its old tenants waited, so new tenants moving in are not charged for a jam that ended with the people before them.

## Engine
- At the end of each hourly satisfaction pass, the average commute wait of every floor that had no settled occupant when the pass began (no room occupied, asleep or vacating; a room an imported tower left moving in does not count) is dropped, so the floor reads no wait until new trips finish. The pass's own room loop gathers those floors. Saves already carry the averages (#1083), and a loaded tower forgets the same floors. The conformance lock and two fuzz goldens moved.
