---
app: minor
crate: minor
---
## Player
- Saves and exported towers are much smaller, often under half their old size, and play exactly the same. A tower saved by this version needs this version or newer to open.
## Engine
- Save version 11 folds a row of plain floor tiles into its first tile with a `run` count (`FLOOR_RUN_KEY`, `FLOOR_RUN_SAVE_VERSION`); both loaders unfold it, and a tower with no such row keeps its old version stamp.
- `HELD_HOURS_SAVE_VERSION` names version 10, and `Simulation::serialize_unfolded` (the tooling binding's `serializeUnfolded()`) writes every unit on its own with the old stamp, the form the state view and its digests hash, so conformance digests do not move.
