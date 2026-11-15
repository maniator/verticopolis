---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Metro riders now arrive on a real train too. Someone coming in by the Metro, office workers included, steps off the train while it stands at the platform, rather than appearing on an empty platform between trains. A worker due between trains comes on the next one, and the Metro brings as many riders a day as before.
## Engine
- A Metro arrival is spawned only at a station where the line's train stands at that minute (`crowd::metro_train::train_in_at`), drawn `arrival_weight` times as often then so the day's count holds. A Modern office worker whose entrance is a station with no train in is held until the next call (`metro_train::hold_for_train`): the booking is re-queued for that call with the station on it (`Shift::station`), and the worker comes in by the street once the day's last train has gone. A Metro walk-in with no train in stays away. Saves: a held booking's row in the crowd's `shifts` gains an optional fourth element, the station id (`[at, office, inbound, station]`); rows without it load as before, so older saves are unchanged, and a game saved while workers wait for a train plays on the same after a reload (JSON and binary `.vctower`). The conformance lock and the frame-days goldens move.
