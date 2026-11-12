---
app: none
crate: minor
---
## Engine
- The catalog's `rules` adds `exportsTo1994` (`GameMode::exports_to_1994`: true in Classic) and `quotesLobbyDistance` (`GameMode::quotes_lobby_distance`: true in Modern). The `.TDT` export refuses a tower by the first rule, and the web game's export dialog and tenant card read both instead of the mode's name. `CATALOG_VERSION` is 12, and the catalog digests move.
