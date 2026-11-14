---
app: minor
crate: minor
readmes: unchanged
---
## Player
- In Modern towers, office workers now really come to work: each one rides in from the lobby or the Metro between 7 and 10 AM, counts once they reach their desk, and goes home between 4 and 7 PM. An office's card shows who is still on the way.
- Modern elevators move twice as fast, and express elevators four times as fast, so the morning rush gets everyone to work.
## Engine
- `rules::REAL_OFFICE_COMMUTES_ON` is now `true`: Modern office workers commute as people (`crowd::commuters`), and the test-only switch is gone. Classic offices keep the clock's head count.
- Modern standard and service cars move at twice the base speed (`GameMode::car_speed_factor`, `DispatchRules::car_speed`) and express cars at four times (`GameMode::express_speed_factor`).
- The unit detail JSON adds `workersComing`, matching the `unitCard` slot: the workers on their way to a Modern office, null on any other kind.
