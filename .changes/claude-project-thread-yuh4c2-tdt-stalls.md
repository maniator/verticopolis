---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Parking stalls in a tower exported for SimTower (1994) now stay connected in the old game. Before, the old game dropped every stall's connection a few days after loading.
## Engine
- The `.TDT` exporter writes the stall table in the tail, points each stall's bytes 6 and 7 at its record, lists the connected stalls by record and writes the B1 ramp's x into header bytes 36 and 37 (`FFFF` with no ramp) (#307). Every export's bytes change; `conformance/tdt-cases.json` is re-locked.
