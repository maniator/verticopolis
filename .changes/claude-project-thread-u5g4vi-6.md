---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Shops and restaurants now get real customers from the city. Each one walks in at the ground lobby or gets off the Metro, rides your elevators to the shop and leaves the same way, so a shop draws only the people really inside it, and Today's patronage counts who actually got there.
- Elevator cars now fill to their real size (21 in a standard car, 42 in an express), so lines clear faster in busy towers.
- As many outside customers come as a shop's trade draws, with no daily limit. A shop your elevators can't get people to in time counts fewer visitors toward your population.
- Fixed people who walked to a shop's or venue's floor, stood about a minute and vanished there (or appeared there out of nowhere). Every visitor now comes in through the lobby or the Metro, stays for the visit (a film 90 to 120 minutes, a meal or a browse 30 to 60) and leaves the same way.
- A shop, restaurant or venue now counts a customer out as they walk out its door, so it draws only the people really inside and frees the seat for the next one at once.
- Someone out for a meal or a visit whose room was bulldozed meanwhile now leaves by the ground lobby instead of vanishing at the venue.
## Engine
- `crowd::walk_ins` books each open shop's and restaurant's customers from outside every hour, as many as its demand sends, and starts them at the ground lobby or a served Metro platform, split by what each entrance's transport carries; they are counted apart from the 140-person sample (`Crowd::walk_in_count`, ceiling `MAX_WALK_INS`).
- A car in the crowd now holds as many riders as its kind (21 standard, 17 service, 42 express) instead of 12, so riders from outside share the cars one to one with the tenants; `CAR_CAPACITY` is deprecated.
- Every kind that `Kind::takes_walk_ins` now counts the customers inside as its head count (`Kind::counts_visitors`), and its patronage counts arrivals at the door; income still follows demand. The Classic ransom scenario's first threat moved to hour 1000.
- `spawn_trips` no longer sends one-way trips to or from open venues (they stood a moment and finished on the venue's floor); `SpawnFloors::open_venues` and `ErrandPlace::Venue` are gone, and `Purpose::ToVenue` and `Purpose::FromVenue` stay in the published names but no trip carries them.
- A visitor leaves a venue's `customers_in` (and `hotel_customers_in`) when their stay ends and they set off home, instead of when the trip home finishes.
- A round-tripper whose origin room is gone when their stay ends now routes to the ground lobby (`transition_to_return`) instead of finishing at the venue.
