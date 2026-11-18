---
app: none
crate: minor
readmes: unchanged
---
## Engine
- `lastRefusalCode()` names why the last tower file read or write was refused with one closed word (`too_large`, `not_tower`, `damaged`, `newer_version`, `not_save`, `unreadable`, `modern` or `refused`), so a host can count refusals without sending the player's sentence, which can quote the file. `loadVctower`, `loadVctowerBytes`, `loadTdt`, `exportVctower`, `exportVctowerBytes` and `tdtExport` set it on a refusal and clear it when they work (#2075).
