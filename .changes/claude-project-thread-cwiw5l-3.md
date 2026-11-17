---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Towers with many empty rooms to let run faster: deciding whether a new tenant would stay now takes a fraction of the time, so a game day on a big tower runs up to a quarter faster.
## Engine
- The move-in check (`would_evict_fresh_tenant`) reads a room's placement once per check instead of once per hour of its two-day look-ahead, and `nearest_transport_distance` no longer copies a floor's transport spans. A game day on a tower with many vacant rooms takes up to about a quarter less work; every result is unchanged.
