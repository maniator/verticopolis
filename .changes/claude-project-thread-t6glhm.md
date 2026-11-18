---
app: minor
crate: minor
---
## Player
- Modern: pick a look for each sky bridge. While the Sky Bridge tool is picked, a Bridge look strip offers Glass Skywalk, Steel Truss, Deco Arcade, Garden Walk and the plain Lobby look. A new bridge goes up in the picked look, and a click on a finished bridge changes its look for free (Undo puts the old one back). Each look is drawn whole across the bridge, with an underside below it. New bridges start as a glass skywalk; bridges in towers saved before this version keep the plain lobby look until you pick another.
- Modern: the story right under a sky bridge stays open air. Floors may rise to two stories below a bridge, and the game asks you to bulldoze the bridge before building up to it, so floors never cut a bridge in two.

## Engine
- `Simulation::build_skybridge_as` lays a bridge in a look, `Simulation::restyle_skybridge` dresses a whole finished bridge in one (free, one undo step; a half bridge is refused until it is finished), and `Tower::skybridge_looks` lists every bridge with its look. The look is each bridge tile's lobby subtype (`SKYBRIDGE_LOOKS`), so the save format and version do not change: an older save loads its bridges plain, and an older build drops the subtype. `build_skybridge` now lays the glass skywalk. Placement refuses a floor or lobby tile right under a bridge tile (`UNDER_A_BRIDGE`), so floors never split a bridge. The catalog's `rules.skyBridge` gains `looks` (catalog 26). The binding adds `restyleSkyBridge(floor, x, look)` and `skyBridgeLooks()`, and `buildSkyBridge` takes the look as a third argument. The view layout moves to 34 for the new `restyleSkyBridge` record, and the conformance lock moved for the catalog only.
