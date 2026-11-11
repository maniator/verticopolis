---
app: minor
crate: minor
---
## Player
- Party halls and movie theaters now count toward the tower's population, the way the original game does: 50 for each open party hall and 120 for each theater showing a new film, from the morning after it opens (#1500).
- An imported SimTower tower keeps its party hall and theater population, including a theater whose film has aged, so it matches the original's on load (#1500).
## Engine
- `economy::visitors` gains the set audience: `set_audience`, `counts_set_audience` and `census_follows_the_day`. `census_count` for party halls and cinemas returns `Unit::visitors_yest`, which the daily rollover sets to the audience on a room's first night open (a cinema keeps the count it has), and the save loader keeps it for those kinds. The conformance lock moves.
- `TdtTenant` gains `draw` (byte 15, a theatre's film draw). The TDT importer seeds party halls and theatres from it when a class adds up to the finance line, or with an even share when the line splits into a valid audience.
