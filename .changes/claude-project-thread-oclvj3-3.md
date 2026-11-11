---
app: minor
crate: minor
---
## Player
- Shops, fast food and restaurants now count the visitors they served the day before, the way the original game does. A new venue expects 10 visitors on its first day and gains 5 to 15 more each day until it reaches its cap: 25 for a shop (30 on weekends) and 35 for fast food and restaurants (50 on weekends). Tower population and star progress follow these counts (#1500).
- An imported SimTower tower keeps its venues' visitor counts, so its shop, fast food and restaurant population matches the original's on load (#1500).
## Engine
- New `economy::visitors` module: each venue's expected visitors are set at the daily rollover from yesterday's served count and a climb of 1 to 3 steps of 5, rolled from the tower's founding seed, the day and the room, so the main RNG stream is untouched. `census_count` for shops, fast food and restaurants returns `Unit::visitors_yest` (saved as `visitorsYest`), the star census no longer subtracts hotel guests from them, and a gutted venue clears it. The conformance lock moves on every scenario.
- The TDT importer reads each floor's remap and each retail row's byte 8 to seed `visitorsYest`; `TdtTower` gains `TdtFloor::index_map` and `TdtTail::retail`.
