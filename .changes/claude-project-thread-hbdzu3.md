---
app: minor
crate: minor
---
## Player
- In Modern, drag along a floor with a room tool to place a row of the same room: the ghost shows every room and the row's total price, and one Undo takes the whole row back (#646).
## Engine
- `quote_room_row` and `build_room_row` (`quoteRoomRow` and `buildRoomRow` in the binding) place a row of rooms along a floor in one command, Modern only; the catalog's `rules.room_rows` says where (catalog version 25, view layout version 33).
## Contributors
- Fonnesx asked for a way to place many rooms at once (#646).
