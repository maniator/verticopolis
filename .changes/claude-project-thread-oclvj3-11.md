---
app: patch
crate: minor
readmes: unchanged
---
## Player
- A tower with more than 256 shops, fast food places and restaurants exports to a .TDT file with every room linked to its own retail row, so each keeps its style on the way back in.
## Engine
- A retail room's row in the `.TDT` retail table is written in bytes 6 and 7, low byte first (`tdt::retail::with_row_high`); before, a row past 255 wrapped to an earlier room's. `TdtTenant` gains `row_high` (byte 7), and the import tries the rows 256 apart and keeps the one that names the room back, so files written with one byte still read.
