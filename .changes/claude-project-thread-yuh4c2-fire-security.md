---
app: patch
crate: patch
---
## Player
- In Classic towers, fires now start only once the tower has Security, as in the 1994 game. Modern towers can still catch fire without it.
## Engine
- `GameMode::fire_needs_security` (Classic): the daily roll starts a fire only in a tower with a Security office, the same gate the ransom call has (#1889).
