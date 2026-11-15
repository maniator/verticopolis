---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Turning off an elevator stop no longer makes the people riding to that floor disappear from the car. They get off at the nearest stop and find the rest of the way from there, or leave through the lobby when there is none.
## Engine
- A rider whose destination stopped being a stop mid-ride rides on to the car's stop nearest it, gets off and reroutes from there (#2324), instead of leaving the crowd: housekeepers over the staff network (`staff_shift::way_on`), anyone else over the passenger network, and with no way on they leave through the ground lobby (a housekeeper waits for the next errand). A rider whose car went still steps out of the trip.
