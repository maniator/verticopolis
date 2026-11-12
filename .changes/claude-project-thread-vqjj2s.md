---
app: minor
crate: minor
---
## Player
- Lobbies can now be two or three stories tall. In Classic, hold Ctrl while placing the ground lobby for two stories, or Ctrl and Shift for three; in Modern, sky lobbies can rise too. A lobby keeps its height once built.
- Elevators pass through a tall lobby without stopping, and stairs and escalators from it climb the whole lobby.
- A tall ground lobby survives .TDT import and export.
## Engine
- `Simulation::set_lobby_height` and `with_lobby_height` set the height a floor's first lobby rises to, and `Tower::lobby_height`, `tall_lobbies` and `is_tall_lobby_story` read it back (#308).
- The binding adds `setLobbyHeight(height)` and `lobbyHeights()`.
- A save with a tall lobby is version 8 and carries `lobbyHeights`; a save without one stays version 7.
- The .TDT importer and exporter read and write the header's ground lobby height and the two- and three-story stair types.
