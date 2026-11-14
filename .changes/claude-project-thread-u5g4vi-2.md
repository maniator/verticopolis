---
app: none
crate: minor
---
## Engine
- `setPeopleWindow(floorLo, floorHi, xLo, xHi)` (and `ViewReader::set_people_window` with a `view::PeopleWindow` in the crate) makes `viewFrame` carry only the people on screen, padded so every rider of a car on screen comes along; a number that is not finite clears it.
