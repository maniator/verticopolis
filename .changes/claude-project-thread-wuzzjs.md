---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Fixed people jumping along the floor to an elevator line. When the line beside an elevator filled the floor right up to its end, people joining it, and people already in it, could leap up to 46 tiles in an instant. They now walk there like everyone else.
## Engine
- `crowd::walk::walk_to` walks a walker whose target lies past the end of their run to that end at walking speed, instead of putting them there at once. The conformance lock and the frame-days goldens move; no save layout changes.
