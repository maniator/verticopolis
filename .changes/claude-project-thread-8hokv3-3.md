---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern: the aquatic center now makes nearby condos, apartments and hotel rooms happier, up to six floors away, and the party hall does the same over three floors; placing either shows its green bands.
## Engine
- The Modern halo table gains the aquatic center (6 floors, +0.035) and the party hall (3 floors, +0.02), both felt by homes and hotel rooms at every hour, with `AQUATIC_HALO_FLOORS`, `AQUATIC_HALO_MAX`, `PARTY_HALL_HALO_FLOORS` and `PARTY_HALL_HALO_MAX`. A two-story venue's halo counts from its nearer story (`Halo::distance`), and the hourly satisfaction step now reads the table row by row (`Halo::is_felt_at`), so `SatisfactionContext` holds `halo_floors` and `hour` in place of one floor list per venue. The catalog digests move.
