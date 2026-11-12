---
app: minor
crate: minor
---
## Player
- In Classic, party halls and theaters now share one limit of 16, as in the original game, instead of 16 of each.
## Engine
- Classic adds a third pooled cap, `venues` (party halls and theaters, 16), checked by `Tower::cap_reason` and the undo cap check through `facilities::pools_for(mode)`; Modern keeps 16 of each.
- The catalog's `pools` and each facility's `pool` follow the mode, and `CATALOG_VERSION` is 15.
