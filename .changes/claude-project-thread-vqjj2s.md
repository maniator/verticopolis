---
app: minor
crate: minor
---
## Player
- Lobbies can now be two or three stories tall. Pick the height on the Lobby card, or hold Ctrl while placing a lobby for two stories and Ctrl and Shift for three. In Classic only the ground lobby rises, as in the original; in Modern, sky lobbies can rise too. A lobby keeps its height once built, and each extra story costs another lobby tile.
- Elevators pass through a tall lobby without stopping, and stairs and escalators from it climb the whole lobby.
- A tall ground lobby survives .TDT import and export.
## Engine
- `Simulation::set_lobby_height` and `with_lobby_height` set the height a floor's first lobby rises to, and `Tower::lobby_height`, `tall_lobbies` and `is_tall_lobby_story` read it back (#308).
- The binding adds `setLobbyHeight(height)`, `lobbyRise(floor)` (the stories a lobby tile laid there rises) and `lobbyHeights()`.
- A save with a tall lobby is version 8 and carries `lobbyHeights`; a save without one stays version 7.
- The .TDT importer and exporter read and write the header's ground lobby height and the two- and three-story stair types.
