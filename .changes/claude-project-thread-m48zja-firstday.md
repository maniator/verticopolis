---
app: patch
crate: patch
---
## Player
- A tower saved on its first day and reloaded now pays its first maintenance and collects its first office rent at the end of that day, as it would have without the reload.
## Engine
- A save from a game's first day carries the step loop's hour, maintenance-period and quarter marks that the clock does not give (`periodMarks`), so a reload bills the first day's end as the unsaved game does. From the second day on the key is absent and a load sets the marks from the clock as before. The conformance state hash leaves it out; the fuzz goldens gained the field where a corpus entry saves on its first day.
