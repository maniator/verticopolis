---
app: patch
crate: minor
readmes: unchanged
---
## Player
- In Classic, a room's card and the morning elevator warning now name what's wrong without telling you how to fix it, as the 1994 game did. Modern still adds what to do about it.

## Engine
- The catalog's `rules` gains `advisesFixes` (`GameMode::advises_fixes`: true in Modern), whether a card or notice that names a problem also says what to do about it (catalog version 25). Classic's 9 AM elevator warning drops its "Add cars or shafts." (#549).
