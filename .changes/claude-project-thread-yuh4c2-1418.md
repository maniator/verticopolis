---
app: patch
crate: patch
---

## Player

- A tower file or stored save that is missing its clock or its list of rooms is refused instead of loading as an empty tower.

## Engine

- Every load path refuses a save with no numeric `minutes` or no `units` list at its top level, with a sentence a player can read; it used to load such a save as an empty tower.
