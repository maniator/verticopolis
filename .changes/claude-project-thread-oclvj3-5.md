---
app: minor
crate: minor
---
## Player
- A movie theater's audience now falls as its film ages, the way the original game does: 120 for the first six mornings of a film, 80 for the next three, then 40 (#1932).
- An imported SimTower tower keeps each theater's film age, and a tower exported to SimTower and opened again keeps it too (#1932).
## Engine
- `economy::visitors` gains `film_draw` and the aging constants. `Extras` gains `film_days` (saved as `filmDays`, cinemas only); the daily rollover counts a cinema at the draw of its film's age and then ages the film. A gutted cinema starts a new film. The conformance lock moves; the ransom-declined-classic scenario's threat now comes at hour 352.
- `tdt::venues` reads and writes the original's party hall and theatre table (`read_venue_table`, `write_routing_tail`), and `TdtTail` gains `venues`. The importer seeds each theatre's `filmDays` from it. The exporter writes byte 15 (the film's draw), the table, and an index map from logical unit id to tenant; every TDT export hash moves.
