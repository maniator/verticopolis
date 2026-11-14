---
app: patch
crate: patch
readmes: unchanged
---
## Player
- Fixed people in a lot of separate towers joined only by a basement heading down through the basement and across to the leftmost tower's lobby to leave. Everyone now goes in and out by the lobby under their own tower when its transport reaches it.
- Fixed a shaft you cut to fewer cars on its schedule taking as many riders as the full shaft beside it. Riders now split between twin shafts by the cars each has running, so a one-car shaft no longer builds a line for hours.
- Shop and restaurant customers from the city are off for now. At full demand they jammed the elevators of towers built before 3.12.0 and tenants moved out over congestion. Shops count their customers from demand as they did before 3.12.0, and the customers come back once their numbers suit the transport.
## Engine
- A trip with an open end on a floor of several runs (a lot of separate ground lobbies) starts or ends in the run nearest its other end that a route reaches (`crowd::doors`), trying the next nearest when Classic's walk budget refuses one; a floor with one run picks the tile it always did. `routing::passenger_parts` caches the passenger graph's parts per tower revision so the choice skips runs no route could join without a search.
- `balance_shafts` weights each shaft of a bank by the cars its schedule keeps on shift at the crowd's hour (`Crowd::weekend` joins `Crowd::hour`); a bank whose shafts run alike draws exactly as before.
- `Kind::takes_walk_ins` answers false while `facilities::WALK_INS_ON` is off, which turns off the outside customers and restores the demand-counted patronage and dispatch estimate for those kinds. The conformance lock and goldens are re-pinned.
