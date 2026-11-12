---
app: minor
crate: minor
readmes: unchanged
---
## Player
- From three stars, too little recycling now hurts your tenants, as it did in the original game. In Classic, any shortfall drains every office, condo, hotel room and rental toward red, and tenants give notice as they do for any other red rating, until you build enough Recycling Centers. In Modern, a tower up to one center short only holds those ratings at Good; a bigger shortfall drains them (#1970).
- From three stars, offices now need parking. In Classic, offices drain toward red when no parking space is left once hotel guests in suites have parked, and one free space is all they need: new offices move in at full speed once it exists. In Modern, the offices on the lowest floors park first; the rest hold at Good, and drain once spaces cover under half of the office workers.
- A tenant who leaves over either shortfall says why ("trash piling up without enough recycling" or "too little parking for its workers"), the room inspector names the cause and how much of the need is covered, and the log warns once when offices run short of parking. A Classic tower at three stars or more with no Recycling Center, or with no free parking for its offices, will see ratings fall after it loads.
## Engine
- New `satisfaction::shortfall`: `Simulation::service_shortfalls()` answers the tower's `ServiceShortfalls` for the hour, and `binding_for(unit, served)` the `ServiceShort` (cause, coverage, sinks) that binds a room. `satisfaction_step` folds its drain (`SHORTFALL_CAP` at the Good line, `SHORTFALL_EROSION` 0.12 an hour when it sinks) into the step, and `StepResult` gains `service_short`. The move-in gate counts the newcomer in the need.
- New vacate and gripe causes `trash` and `parking`: saves keep them, the inspector's `gripeCoverage` carries their coverage, and the port's `vacateReasons` list appends both, so `VIEW_LAYOUT_VERSION` is 17.
- The conformance lock moves for `vip-review-modern` only (a Modern scenario at three stars with no parking).
