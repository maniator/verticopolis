---
app: patch
crate: minor
readmes: unchanged
---
## Player
- A tower with a party hall exported to a `.TDT` file now opens and plays in the original game, which crashed on it a few seconds after loading.
## Engine
- The `.TDT` exporter numbers each floor's units the way the original does (plain floor tiles get no logical id: `FF` in byte 12 and no index map entry), and each party hall or theater record names its venue table row in byte 6 (`tdt::venue_export`). Every export case hash in `conformance/tdt-cases.json` moves; imports are unchanged.
- Each party hall half now writes its 40 people into the people block, with its tenant record's bytes 8 and 9 naming the first (`tdt::venue_export::write_people`); without them the original crashed on load.
