---
app: patch
crate: minor
readmes: unchanged
---
## Player
- A tower exported to a .TDT file can be built on in SimTower after loading: the file keeps free room for new people, so placing a theater no longer crashes the game.
- Theaters export the way SimTower writes them, each floor a screen piece and an auditorium, with the 56 people each screen keeps.
## Engine
- The `.TDT` exporter splits each theater floor into a 7-tile screen piece (types 35 and 34) and an auditorium piece (19 and 18). Both name the venue's table row in byte 6; the table names the screen pieces, and each screen piece owns 56 people records (type 18) named by its bytes 8 and 9 (`tdt::venue_people`).
- The people block's count is the records in use plus at least 256 spare, rounded up to a multiple of 256 (`people_pool_size`), with zero records padding the spare. Export hashes in `conformance/tdt-cases.json` move.
