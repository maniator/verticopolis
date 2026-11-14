---
app: patch
crate: minor
---
## Player
- Selling an elevator car and buying it back no longer puts the whole fleet on the hours you had cut back. An hour you set to run fewer cars keeps its count, even when the sale left it at the shaft's size.
- The elevator Schedule window now says how many cars are on shift at the chosen hour apart from how many are installed, such as "3 on shift at 17:00, 4 installed".
## Engine
- A car sold now holds back each hour the player cut back that the sale leaves at the whole fleet's size (`Schedule::held_back`, the new `HeldBack` type, `Schedule::refit`), so a car bought back joins only the hours that ran every car. A player's schedule edit clears the held hours.
- Save version 10 adds a schedule's `heldBack` hours. A save carries it, and is stamped 10, only when an hour is held back; every other save keeps version 7 or 9. `stamped_save_version(has_tall_lobby, holds_an_hour_back)` gives the version a save is stamped with; `save_version` keeps its one argument and answers for a save with no held hour.
