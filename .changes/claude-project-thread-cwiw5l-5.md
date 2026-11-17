---
app: none
crate: patch
readmes: unchanged
---
## Engine
- The hourly move-in pass copies each vacant room once for the move-in gate instead of twice, and the served-floor and floor-reachability lookups it and the satisfaction pass make use the engine's fast hasher, so a game day does less work (up to 6% on the bench towers) with every result unchanged.
