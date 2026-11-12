---
app: minor
crate: minor
---
## Player
- In Classic you can no longer build while the game is paused, as in the original. A click, tap or keyboard placement while paused says "Unpause to build." and points at Play. Modern still lets you build while paused (#1936).
## Engine
- The catalog's `rules` adds `buildsWhilePaused` (`GameMode::builds_while_paused`): false in Classic, true in Modern. The engine still has no paused state; a frontend that pauses refuses new placement where the rule is false. `CATALOG_VERSION` is 10, and the catalog digests move.
