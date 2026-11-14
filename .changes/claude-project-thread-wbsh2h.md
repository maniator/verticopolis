---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Modern: the bulldozer now takes out a sky lobby a tile at a time, tall halls included, for half of what each tile cost. The ground lobby stays, and Classic keeps every lobby as in 1994.
- The bulldozer no longer takes the last floor tile out from under an elevator, stairway or escalator, which left the shaft hanging in midair.
- Undo no longer takes a tall lobby out from under a floor you built on top of it.
## Engine
- `Tower::removal_reason` lets a Modern sky lobby tile go (`GameMode::removes_lobby_tiles`), keeps the ground lobby in both modes, checks the story above a tall hall's top, and refuses a floor or lobby tile a shaft needs in its column.
- `remove_facility` refunds a tall lobby tile half its price on each story it rises.
- An undo or redo that takes a tall lobby tile out is refused while a story stands on top of the hall, as a sale is.
