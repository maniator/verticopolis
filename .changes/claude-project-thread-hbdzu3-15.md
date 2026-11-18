---
app: patch
crate: minor
readmes: unchanged
---
## Player
- Opening a SimTower `.TDT` file whose reader fails to load (offline, say) now says the save couldn't be read, where before nothing happened.

## Engine
- `lastRefusalCode()` names why the last tower file read or write was refused with one closed word (`too_large`, `not_tower`, `damaged`, `newer_version`, `not_save`, `unreadable`, `modern` or `refused`), so a host can count refusals without sending the player's sentence, which can quote the file. `loadVctower`, `loadVctowerBytes`, `loadTdt`, `exportVctower`, `exportVctowerBytes` and `tdtExport` set it on a refusal and clear it when they work (#2075).
