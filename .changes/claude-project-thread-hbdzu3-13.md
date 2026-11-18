---
app: patch
crate: minor
---
## Player
- Modern: an elevator on Auto no longer gives the last hour of a rush too few cars. Each hour now counts the bigger crowd of its start and its end, so a rush that ends on the hour keeps the cars it needed, and the morning rush reads as before. The schedule's advice, the auto-tune button and the hourly curves count the same way (#2466).

## Engine
- `sample_elevator_util` files the larger of the demand at the top of the hour that ended and the demand now under that hour, both the riders aboard and the Modern lines at the shaft's stops. `ElevatorTelemetry::hour_start` (new) keeps each elevator's demand at the top of the hour under way, and a save's `elevatorLoad` entries carry it as `hourStart`. A save without it reads the first hour after its load from the hour's end alone, as before. The conformance lock moves for the Modern scenarios that sample a rush edge (`metro-express-modern`, `starter-modern`) (#2466).
