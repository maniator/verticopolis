---
app: minor
crate: minor
readmes: unchanged
---
## Player
- In Modern towers, condo, apartment and studio residents really leave for the day and come home. On weekdays all but one of each household (everyone in a studio) walk out through the ground lobby or the Metro between 7 and 10 AM and ride home between 4 and 7 PM; at night and on weekends everyone is home. Elevators no longer run up and down for residents nobody can see, so far fewer cars move with nobody aboard. Classic homes still count residents by the clock.
## Engine
- Modern home residents commute as crowd people (`crowd::commuters`, new `Workplace::Home`): `GameMode::residents_commute_in_person` (`REAL_RESIDENT_TRIPS_ON`), `Kind::lives_in_person`, `Kind::arrives_in_person` and `Kind::residents_home_by_day`. A home's `occupants` is the residents at home; the hourly presence pass skips these homes, and they no longer feed the dispatch's waiting estimate (`ElevatorDispatch::accumulate`), whose lobby share now leaves out the population that arrives in person. The sampled school run is off where residents commute themselves. The Modern conformance cases, the frame-day golden and the Modern fuzz-corpus golden move.
