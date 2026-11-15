---
app: patch
crate: minor
---
## Player
- Metro riders now leave on a real train. Someone heading home by the Metro waits on the platform until the train pulls in and boards it, rather than disappearing on an empty platform.
- Trains run once an hour from 6 AM through the 8 PM hour. A rider who reaches the platform after the last train goes up to the ground lobby and leaves by the street, and a Metro visitor finishing a visit at night heads straight for the lobby.

## Engine
- A crowd member who ends a walk inside a Metro station on its platform floor waits for the line's train (`crowd::metro_train`) and leaves only while it stands at that station; after the day's last call they route to the nearest ground floor run. `Crowd::minute` (never saved) carries the game minute each crowd chunk ends on. A crowd stepped on its own (no minute) keeps the old ending.
- The catalog publishes the timetable as `world.metroTrain` (`firstHour`, `lastHour`, `legMinutes`, `dwellMinutes`, `runMinutes`); catalog version 19. The web renderer draws the train from it, so the drawn train and the riders who board it keep one timetable.
- The conformance lock, catalog digests, frame-days goldens and the catalog fixtures move; no save layout changes.
