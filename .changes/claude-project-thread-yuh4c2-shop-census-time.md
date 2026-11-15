---
app: patch
crate: patch
---
## Player
- A shop's and a fast food's visitor count, and the population it adds to, now changes when shops open at 10 AM, as in the original game, instead of at midnight. A restaurant's still changes overnight.
## Engine
- Shops and fast food close their day at 10:00 (`Simulation::roll_over_morning_venues`, `MORNING_VENUE_DAY_ENDS_AT_HOUR`); restaurants, theatres and party halls still roll over at midnight (#1500). A save taken before 10:00 carries `morningVenueDay`; one without it counts today's close as done, and a `.TDT` saved before 10:00 closes that morning.
