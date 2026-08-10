/**
 * Names given to every Excalibur actor this renderer creates.
 *
 * Excalibur's `engine.debug.filter` scopes debug draw to entities matching a
 * `nameQuery`, and an unnamed actor can never match one, so without these the
 * filter silently does nothing. Naming costs nothing at runtime (the name is
 * never drawn or serialized) and turns "draw every collider in the tower" into
 * "draw the colliders on the people", which is the difference between a usable
 * overlay and an unreadable one on a busy tower.
 *
 * Kept in one place so DEBUGGING.md can document the vocabulary and a rename
 * cannot quietly leave the docs behind.
 */
export const ACTOR_NAMES = {
  /** An ANIMATED room: a facility that still redraws per frame (under
   *  construction, a playing cinema, and so on). A settled room is composited
   *  into a `region` instead and has no actor of its own. Static floor and
   *  lobby tiles are TileMap cells, not actors, so they are not here either. */
  room: "room",
  /** One cell of the region compositor: a baked canvas carrying many settled
   *  rooms at once (towerRegions.ts). These, not `room`, are what most of a
   *  built tower is made of. */
  region: "region",
  /** An elevator, escalator, or stair shaft. */
  transport: "transport",
  /** A fire escape or ground-floor awning hanging off the tower edge. */
  escape: "escape",
  /** The rooftop construction crane. */
  crane: "crane",
  /** A routed person (a tenant or visitor the crowd sim is moving). */
  person: "person",
  /** An ambient walker (scenery crowd, not routed by the sim). */
  walker: "walker",
  /** An elevator car. */
  car: "car",
  /** The metro train. */
  train: "train",
  /** A garbage truck serving a recycling center. */
  truck: "truck",
  /** A car driving along a parking level. */
  garageCar: "garageCar",

  // ---- Static scene furniture (towerScene.ts, towerScenery.ts) ------------
  /** The excavated earth behind the basement, and its surface line. */
  dirt: "dirt",
  /** The lot's grass and apron strip. */
  groundStrip: "groundStrip",
  /** Sidewalk paving (plaza and street). */
  sidewalk: "sidewalk",
  /** Forecourt paving beside the lot. */
  pavement: "pavement",
  /** Asphalt with lane markings. */
  road: "road",
  /** The roundabout drive and its island. */
  roundabout: "roundabout",
  /** The plaza fountain. */
  fountain: "fountain",
  /** A plaza or street lamp (the street one carries the 375 ST sign). */
  lamp: "lamp",
  /** A tree, bush, or planter. */
  plant: "plant",
  /** A distant background skyline block. */
  skyline: "skyline",

  // ---- Screen-space layers (ex.ScreenElement, not world actors) ----------
  /** The sky/sun/moon layer behind everything. */
  sky: "sky",
  /** The full-viewport overlay: ruler, build preview, rain, heatmap tints. */
  overlay: "overlay",
} as const;

export type ActorName = (typeof ACTOR_NAMES)[keyof typeof ACTOR_NAMES];
