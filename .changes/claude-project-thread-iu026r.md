---
app: patch
crate: patch
readmes: unchanged
---
## Player
- A bomb that goes off now damages only the tower it was hidden in. On a lot with several towers side by side, the others are left standing.
- Security guards searching for a bomb, and the thief and his guard, now stay the size of the crowd when you zoom out, instead of towering over several floors.
## Engine
- A bomb blast guts only rooms that overlap the epicenter floor's run of floor tiles around the bomb, two floors above and below (`BLAST_FLOORS`); a tower that fills its floors is hit across their width, as before.
