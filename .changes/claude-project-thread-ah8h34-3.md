---
app: none
crate: patch
readmes: unchanged
---
## Engine
- Fires and bomb blasts look units up by id and walk only the rooms, where they used to search and walk every unit and tile. A random-event check costs 62 to 93% fewer instructions, with identical results.
