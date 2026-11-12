import type { CatalogWorld } from "../catalog/catalogTypes";

/**
 * The world geometry the view is built for: the lot width and the floor range
 * that size the tile maps, the region grid, the scenery and the cursor clamps
 * (#921). It comes from the tower's catalog when the scene is built, so the
 * view reads the engine's world rather than the TypeScript tables.
 *
 * The ground, the scenery and the region grid are built once for the lot's
 * width and basement, so a later bind must state the same ones: a different
 * lot width or lowest floor means a damaged or mismatched catalog, and it
 * throws instead of drawing a lot of the wrong size. The top floor may move
 * between towers (a taller lot, #1985): every reader takes it live, and the
 * scene resizes its structure map when it swaps to such a tower (towerScene
 * `setSim`).
 */

/** The fields the view reads. */
export type ViewWorld = Pick<CatalogWorld, "lotWidth" | "minFloor" | "maxFloor">;

let bound: ViewWorld | null = null;

/** Binds the view to a catalog's world. A second bind must state the same
 *  lot width and lowest floor; a different one throws and leaves the bound
 *  world in place. The top floor may change. */
export function bindViewWorld(world: ViewWorld): void {
  const next = { lotWidth: world.lotWidth, minFloor: world.minFloor, maxFloor: world.maxFloor };
  const otherLot = bound !== null && (bound.lotWidth !== next.lotWidth || bound.minFloor !== next.minFloor);
  if (bound && otherLot) {
    throw new Error(
      `the catalog's lot (${next.lotWidth} tiles, lowest floor ${next.minFloor}) differs from the one the view was built for (${bound.lotWidth} tiles, lowest floor ${bound.minFloor})`,
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

/** Whether a world is bound yet, for a reader that waits for it instead of
 *  throwing (the overview map before the scene is built). */
export function viewWorldBound(): boolean {
  return bound !== null;
}

/** Test hook: forget the bound world. */
export function resetViewWorldForTests(): void {
  bound = null;
}
