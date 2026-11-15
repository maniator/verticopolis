---
app: minor
crate: minor
readmes: unchanged
---
## Player
- Modern towers can have more than one ground lobby: with floor bridging off, lay a lobby anywhere on the ground line to start another tower.
- Modern can bulldoze ground lobby tiles, so a lobby bridged across open ground can be parted into two towers' front doors. The lot keeps its last ground lobby tile.
## Engine
- Modern lays a ground lobby tile apart from the tower (`GameMode::lays_ground_lobbies_apart`), and undo puts one back the same way.
- Modern sells ground lobby tiles under the floor-tile rules, refusing only the tower's last one (`GameMode::removes_lobby_tiles`).
