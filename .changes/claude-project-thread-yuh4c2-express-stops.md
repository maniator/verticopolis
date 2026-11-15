---
app: patch
crate: minor
readmes: unchanged
---
## Player
- Classic express elevators now stop where the 1994 game's do: the ground floor, every 15th floor (sky lobby or not) and every basement. Each of those stops can be turned off in the Schedule window, and an express has to reach the ground floor or a 15th floor. An end off those floors is passed, not stopped at. Modern express elevators are unchanged.
## Engine
- A Classic express follows the original's stop rule (#1527): `Tower::express_may_stop`, a `classicExpressStops` marker on saved shafts (a save without it gets its old lobby-only skips on 15th floors dropped), placement and resize refuse a Classic express that reaches neither the ground floor nor a 15th floor, and a `.TDT` keeps an express end's serviced byte both ways. The shaft card's stop row gains `toggles` (`Tower::stop_toggles`), view layout version 27. The conformance lock, loader and `.TDT` case pins and the frame-day and port-edit goldens move with the rule.
