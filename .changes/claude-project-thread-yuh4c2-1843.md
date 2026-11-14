---
app: patch
crate: patch
readmes: unchanged
---

## Player

- Undo no longer puts back a ground-floor or basement tile with nothing beside, above or below it.

## Engine

- An undo or redo step that would put back a ground-floor or basement tile reaching no tile there that stays is refused as `Blocked`.
