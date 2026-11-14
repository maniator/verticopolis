---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Office workers really come to work: from 8 AM on weekdays each one walks in at the lobby or rides in on the Metro, and an office counts only the workers who reached their desks. They leave the same way from 6 PM, so slow elevators fill an office late and an office no route reaches never fills.
- The office card says how many workers are still on the way, for example "Occupants: 4/6, 2 on the way".
- Workers inside an office that is bulldozed or loses its tenant walk out through the lobby instead of vanishing.
## Engine
- Office head counts come from workers who commute as crowd people (`crowd::commuters`); the one-way office trips are gone, and offices no longer add to the elevator waiting estimate.
- `unitCard` adds a `workersComing` slot (the view layout goes to 24).
