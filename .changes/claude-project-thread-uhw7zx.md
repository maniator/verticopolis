---
app: patch
crate: patch
---
## Player
- A tower imported from a 1994 SimTower `.TDT` file keeps each elevator car's waiting floor, so idle cars wait where the original game had them instead of all stacking on the lobby, and exporting writes those floors back.
## Engine
- `import_tdt` writes each elevator's per-car home floors (record byte 186) as the shaft's `schedule.homeFloors`, snapped to the nearest stop, and `export_tdt` writes the authored `homeFloors` back into those bytes, falling back to the cars' positions. The `.TDT` import case hashes move.
