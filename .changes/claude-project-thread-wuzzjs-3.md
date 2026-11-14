---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Express elevators now stop at every basement floor they pass, in Classic and Modern, as in the original. Above ground they still stop only at lobbies.
- A basement stop on an express can be turned off and back on in the elevator's Schedule window, and a saved tower keeps the choice. The elevator card's Stops line now reads "lobbies and basements" for an express that reaches below ground, with a count of the stops turned off.
- An express elevator in a tower saved before this update loads with all of its basement stops on, and a `.TDT` tower keeps the basement stops its file has, however it is opened.

## Engine
- An express shaft stops at every basement floor it spans in both modes, and `setStop` accepts a basement floor on an express. Every express now writes `preserveBasementStops: true` into the save; a save without it loads with its basement skips cleared and gains it. `importTdt` writes the marker on each express, so `fromSave` keeps the file's basement skips too.
- The conformance lock moves: `fixture-sixseven` and `holidays-classic` (the sixseven tower, whose express runs from B5) move their crowd hashes, and `holidays-classic` its events; the other moved scenarios change only their state hash (the marker in the save), and a new `express-basements-classic` scenario covers building, toggling, shortening, extending and reloading a basement express. `loader-cases.json`, `tdt-cases.json` (11 import save hashes for the marker, and the two sixseven export cases) and `frame-days.json` move with it.
