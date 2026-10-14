import type { CatalogWorld } from "../engine/catalogTypes";

/**
 * The world geometry the view is built for: the lot width and the floor range
 * that size the tile maps, the region grid, the scenery and the cursor clamps
 * (#921). It comes from the tower's catalog when the scene is built, so the
 * view reads the engine's world rather than the TypeScript tables.
 *
 * The scene sizes its tile maps once, so the world is bound once and must not
 * change under it. Both engines' catalogs state the same world (the catalog
 * digests pin it), so a later bind with a different world means a damaged or
 * mismatched catalog, and it throws instead of drawing a lot of the wrong size.
 */

/** The fields the view reads. */
export type ViewWorld = Pick<CatalogWorld, "lotWidth" | "minFloor" | "maxFloor">;

let bound: ViewWorld | null = null;

/** Binds the view to a catalog's world. A second bind must state the same
 *  world; a different one throws. */
export function bindViewWorld(world: ViewWorld): void {
  const next = { lotWidth: world.lotWidth, minFloor: world.minFloor, maxFloor: world.maxFloor };
  if (bound && (bound.lotWidth !== next.lotWidth || bound.minFloor !== next.minFloor || bound.maxFloor !== next.maxFloor)) {
    throw new Error(
      `the catalog's world (${next.lotWidth} tiles, floors ${next.minFloor} to ${next.maxFloor}) differs from the one the view was built for (${bound.lotWidth} tiles, floors ${bound.minFloor} to ${bound.maxFloor})`,
    );
  }
  bound = next;
}

/** The bound world. Throws before the first bind: nothing in the view may
 *  guess the lot's size. */
export function viewWorld(): ViewWorld {
  if (!bound) throw new Error("the view world is not bound yet: bind it from the tower's catalog before drawing");
  return bound;
}

/** Test hook: forget the bound world. */
export function resetViewWorldForTests(): void {
  bound = null;
}
