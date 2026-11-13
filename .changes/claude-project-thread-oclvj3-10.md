---
app: patch
crate: minor
readmes: unchanged
---
## Player
- Shops, fast food and restaurants imported from SimTower towers keep their own styles; before, most shops in a played tower came in as Men's Clothing.
- A theater built the day a tower is exported to a .TDT file keeps its seats in SimTower like any other theater.
## Engine
- Retail rooms and their retail table rows name each other as in the game's saves (#2044): a room's byte 6 is its row index, the row's byte 1 its logical unit id, byte 11 its style and byte 13 the game's 255 (`tdt::retail`). The import reads the style from the row a room's byte 6 names when that row names it back and carries the 255, else from byte 6, as our older exports wrote it. `TdtRetailRow` gains `row` and `style`; `OutTenant::subtype_idx` becomes `retail_row`. Export hashes in `conformance/tdt-cases.json` move.
- A theater with no film age exports a party hall and theater table row on its film's first day, so its screen pieces get their 56 people records.
