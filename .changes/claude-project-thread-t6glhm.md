---
app: minor
crate: minor
---
## Player
- Modern towers get a Sky Bridge tool at 3 stars, under Structure. Point it at the open air between two towers' sky lobbies and the ghost shows the whole bridge with its full price; one click builds all of it, or nothing. On a phone, tap once to see it and tap again to build.
- The Lobby tool no longer lays tiles out over open air, so a sky bridge can't be left half built. A half bridge in an older save stays, and the Sky Bridge tool finishes it for the price of the missing tiles.

## Engine
- `Simulation::quote_skybridge` and `build_skybridge` (the binding's `quoteSkyBridge` and `buildSkyBridge` port records) quote and lay a whole sky bridge in one command; a lobby tile over open air is now refused.
- The catalog's `rules.sky_bridge` (`skyBridge` in JSON) publishes the tool's star, longest span and tile price; catalog version 23, view layout version 28.
