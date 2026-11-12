---
app: patch
crate: minor
readmes: unchanged
---
## Player
- Towers exported to a `.TDT` file now number their rooms the way the original game does, so its party hall and theater table names the right rooms.
## Engine
- The `.TDT` exporter numbers each floor's units the way the original does (plain floor tiles get no logical id: `FF` in byte 12 and no index map entry), and each party hall or theater record names its venue table row in byte 6 (`tdt::venue_export`). Every export case hash in `conformance/tdt-cases.json` moves; imports are unchanged.
