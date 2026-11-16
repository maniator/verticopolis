---
app: patch
crate: minor
readmes: unchanged
---
## Player
- In Modern towers, hotel guests really check in and check out. Once a room is let, its guests ride up from the ground lobby or the Metro within the hour, and after checkout they ride back down and leave. Sleeping guests no longer call elevators, so fewer cars run up and down at night for guests nobody can see. Classic hotels still fill and empty by the clock.
## Engine
- Modern hotel guests check in and out as crowd people (`crowd::commuters`, new `Workplace::Hotel`): `GameMode::hotel_guests_arrive_in_person` (`REAL_HOTEL_GUESTS_ON`) and `Kind::stays_in_person`, which `Kind::arrives_in_person` now includes. A let room's `occupants` is the guests in it; they are booked at once in the hour after the room is let and leave over the hour of their checkout. These rooms no longer feed the dispatch's waiting estimate or its lobby share. The hour's checkouts now run before the commute bookings. The Modern conformance cases and goldens move.
