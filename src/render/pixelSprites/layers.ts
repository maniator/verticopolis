/**
 * Depth-layer marks for the sprite atlas. A room's draw routine calls
 * {@link layerBreak} once, after its shell (ceiling, back wall, windows, wall
 * art, floor band) and before its furniture and seated occupants. The routine
 * itself, or the one that wraps it, calls {@link layerEnd} after the furniture
 * and before anything the game draws over the room after it (the night scrim,
 * the notice badge, a grime wash, a ceiling light); the first end after the
 * break counts.
 *
 * In the game both calls do nothing: no hook is installed, so the drawing and
 * its pixels are exactly what they would be without them. The atlas bake
 * installs a hook for one extra render per room frame (`atlas/browserEntry.ts`)
 * and records the canvas at each mark to split the room into a shell picture
 * and a furniture picture (docs/atlas.md).
 *
 * A mark reads the canvas as it stands, so it is safe under a transform (the
 * mirrored layouts call it inside `maybeMirrored`): the hook ignores the
 * transform. Do not mark inside a clip narrower than the room: the bake puts
 * the shell back only inside the clip active at the end mark.
 */

export interface LayerHook {
  /** The shell is complete; everything drawn from here on is furniture. */
  shellEnd(ctx: CanvasRenderingContext2D): void;
  /** The furniture is complete; everything drawn from here on covers the
   *  whole room and belongs to both pictures. */
  furnitureEnd(ctx: CanvasRenderingContext2D): void;
}

let hook: LayerHook | null = null;

/** Mark the end of the room's shell. A no-op unless the atlas bake is
 *  recording layers. */
export function layerBreak(ctx: CanvasRenderingContext2D): void {
  hook?.shellEnd(ctx);
}

/** Mark the end of the room's furniture. A no-op unless the atlas bake is
 *  recording layers. */
export function layerEnd(ctx: CanvasRenderingContext2D): void {
  hook?.furnitureEnd(ctx);
}

/** Run `draw` with `h` receiving the layer marks, then restore the previous
 *  hook (even when `draw` throws). Only the atlas bake calls this. */
export function withLayerHook<T>(h: LayerHook, draw: () => T): T {
  const prev = hook;
  hook = h;
  try {
    return draw();
  } finally {
    hook = prev;
  }
}
