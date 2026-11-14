---
app: patch
crate: patch
---
## Player
- People stay in the tower when you reload a save: everyone walking, waiting, riding, eating, shopping or cleaning picks up where they were, and the elevators carry on mid-stop, instead of the building emptying and filling again from the lobby. If the game hits an engine error and reloads itself, that one reload still starts the tower empty, so the error is not replayed.
## Engine
- A save carries the crowd (`crowd`: every person, the crowd's id source and random stream, the commute-stress averages and the walk-ins booked for the hour) and the elevator cars' timers mid-stop (`dispatch`), and a load rebuilds the venue, meal and housekeeping counts from the people, so the people and the cars carry on where they were. The crowd also keeps the last step's hour, the Modern router's line counts, and the office commuters' desks and bookings when there are any. The elevator panels' hourly figures, the day's move-in report and the rooms cleaned today still start over on a load. Older saves load with an empty crowd as before, and older builds ignore both keys.
- The conformance state hash leaves out `crowd` and `dispatch`; the crowd hash now holds through a `reload`.
