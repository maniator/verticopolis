---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: people now count the walk to the first elevator, so they take the shaft nearer where they stand. A long lobby or Metro platform uses all of its elevators instead of the oldest ones.
- Modern: auto-tune no longer cuts a shaft that people avoid down to one car for good. Each hour gets the fewest cars that carry its riders with room, so tuning again keeps the same row, an hour whose few cars ran full gets one more car each time you tune, and a shaft few people ride is tuned from the busier shafts that stop at the same floors.

## Engine
- The Modern router (`crowd::expected_time`) prices the walk from the tile a rider stands on to the first shaft, stair or escalator, at half the walking time (`crowd::expected_time::walk`); the kept routes are keyed by that tile too. The walks between legs and at the far end stay free. `auto_tune_proposal` proposes for each hour the fewest cars that carry its load below 0.9 of capacity each (it proposed the rounded load, which left those cars full and kept a one-car hour at one car), and tunes each hour from the larger of a shaft's own load and the mean load of its twins (same kind, stopping at every floor it does). The conformance lock moved for Modern scenarios only.
