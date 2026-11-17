---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Classic: thieves now come only to a tower with Security, like fires and bomb threats, as in the 1994 game. A Classic tower without Security is no longer robbed.

## Engine
- `GameMode::thief_needs_security` (Classic): the daily thief roll still draws, but in a Classic tower without a Security office no thief comes, no money is lost and no thief effect plays (#2364).
- The fuzz corpus's uncaught-thief entry runs as Modern now, and the Classic four-star smoke golden re-pinned.
