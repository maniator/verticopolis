---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Two theaters built side by side now come back as two theaters after a .TDT export and import, instead of one double-width theater.
## Engine
- The `.TDT` importer joins a theater's screen piece (types 35 and 34) only to the auditorium piece (19 and 18) on its right, the way SimTower writes every theater, so theaters built flush side by side stay separate (`tdt::part_merge`). The `theatre-whole` import case in `conformance/tdt-cases.json` now carries its screen pieces on the left; it still imports as one whole theater, and its save hash moves only because the import seed follows the file's bytes.
