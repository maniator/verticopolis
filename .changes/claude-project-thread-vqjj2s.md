---
app: minor
crate: minor
---
## Player
- Lobbies can now be two or three stories tall. Pick the height on the Lobby card, or hold Ctrl while placing a lobby for two stories and Ctrl and Shift for three. In Classic only the ground lobby rises, and a sky lobby asked taller is refused with the reason; in Modern, sky lobbies can rise too. A lobby keeps its height once built, and each extra story costs another lobby tile.
- Elevators pass through a tall lobby without stopping. Stairs from it wind up the whole hall as a spiral staircase, and an escalator zigzags up it with a landing at each turn.
- On a phone, a tap that the game refuses to build now says why.
- A tall ground lobby survives .TDT import and export.
## Engine
- `Simulation::set_lobby_height` and `with_lobby_height` set the height a floor's first lobby rises to, and `Tower::lobby_height`, `tall_lobbies` and `is_tall_lobby_story` read it back (#308).
- A floor's first lobby asked taller than one story where the mode keeps it one story (a Classic sky lobby) is refused with a reason instead of laid one story high.
- The binding adds `setLobbyHeight(height)`, `lobbyRise(floor)` (the stories a lobby tile laid there rises), `lobbyHeights()` and `walkwayTop(kind, bottom, top)` (the top a flight out of a tall lobby is built to).
- A save with a tall lobby is version 8 and carries `lobbyHeights`; a save without one stays version 7.
- The .TDT importer and exporter read and write the header's ground lobby height and the two- and three-story stair types.
