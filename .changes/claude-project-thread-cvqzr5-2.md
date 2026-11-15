---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Saving a big tower is faster again: the engine now writes the save several times faster, so the autosave's pause, the save when you switch away or update, and Export are all shorter.
## Engine
- `serialize`, `saveBytes` and the `.vctower` writers write each unit and each person straight to the text instead of building it as a JSON tree first. The output is byte for byte the same, and on a maxed tower the save is written about four times faster.
