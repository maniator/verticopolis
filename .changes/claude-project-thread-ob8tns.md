---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: an elevator on Auto now puts every car to work whenever anyone is waiting at one of its stops. Before, it waited until more people stood in line than its running cars could take in one trip, so in a busy tower the morning commuters from the parking floors piled up by the hundreds in the basement while the few cars on shift came by already full.
- Modern: the morning re-tune of an elevator on Auto now counts the crowd it sees at the top of each hour toward the hour that built it. Before, the 7 AM hour was tuned from the empty lobby at 7:00, so the first commuters met one car.
- Classic and Modern: the elevator inspector's hourly load now shows the crowd at the top of each hour under the hour that just ended, so the busiest hours appear one hour earlier than before.
## Engine
- Dispatch runs every car of a shaft whose schedule has `auto_tune` on while anyone waits at its stops, and the row's count while nobody does. `Schedule::cars_for_backlog` keeps its signature and follows the same rule; the car capacity, span and homes it takes are no longer read.
- `sample_elevator_util` folds the riders aboard and the lines at the top of an hour into the demand ring's slot for the hour that just ended (and that hour's day type), as the origin rings fold the ended hour's boardings. Rings saved before keep their values and follow within a few game days.
- `crowd::banks` sizes an Auto shaft's share of a bank by the cars the dispatch last ran (`closed_cars`), as the Modern router's `stand_down` does, instead of by its row. The conformance lock moves for `starter-modern`, `metro-express-modern` and `offshift-schedule-modern`, with the `smoke-modern-five-star` corpus golden; every Classic scenario keeps its hashes.
