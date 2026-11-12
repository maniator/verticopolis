---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Long elevator waits now stress your tenants, as they did in the original game. Each floor keeps a running average of how long its commuters really waited, and once that passes a rider's patience (two minutes in Classic, three in Modern) the floor's offices, condos and hotel rooms lose rating and name congestion as their complaint. A lobby floor is never charged for its own queue, and a Metro rider's wait counts on the floor it heads for (#1971).
## Engine
- `satisfaction_step` reads congestion as the larger of the aggregate estimate and the floor's real commute wait over the mode's limit (`GameMode::commute_wait_congestion`, `CLASSIC_WAIT_LIMIT` = `GIVE_UP`, `MODERN_WAIT_LIMIT` = 1.5 x `GIVE_UP`). A trip that starts in a lobby or off a Metro train (`Person::from_metro`, set only by a Metro arrival) counts on the tenant floor it serves. The conformance lock, frame-day and port-edit goldens move.
