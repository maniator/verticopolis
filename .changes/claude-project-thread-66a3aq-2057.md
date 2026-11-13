---
app: patch
crate: patch
readmes: unchanged
---
## Player
- In Modern towers, an idle elevator waiting on a floor now picks up the people waiting there instead of leaving them for a car that never comes.
## Engine
- Modern dispatch: a car parked on a stop whose call it owns (`DispatchRules::parked_owner_boards`, `GameMode::parked_owner_boards_its_floor`) boards the statistical estimate there as an arrival does, opening and dwelling, counting the ride, the load and the origin tally. The best-car choice had given it the call while its sweep only looks ahead, so the estimate on a parked car's floor was never boarded. Classic is unchanged.
- The conformance lock moves for the sixteen Modern scenarios with elevators, the frame-day golden for the two split-tower saves, the fuzz golden for `smoke-modern-five-star` and the Modern every-transport card text; no Classic scenario, frame-day case, fuzz entry or card moves.
- Docs: Modern's spread homes are never written to the schedule or a save, but a save keeps where each car stands and a `.TDT` export takes an unhomed car's home from there, so a save exported as Classic with a car parked at its spread stop records that stop as its home (a Modern tower is still refused).
