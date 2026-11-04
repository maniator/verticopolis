/**
 * How the game reads a raw input event where two layers must agree on it.
 */

/** Space, as the two names browsers report it by, or by its physical key: with
 *  Option held, macOS reports Space as a no-break space. The game's Space hold
 *  (`inputKeys`) and the palette's items (`uiPalette`) share this one test, so
 *  the palette skips exactly the Space releases the game canceled. */
export function isSpaceKey(e: Pick<KeyboardEvent, "key" | "code">): boolean {
  return e.key === " " || e.key === "Spacebar" || e.code === "Space";
}

/** The wheel turn that zooms the world, or 0 for one that does not. Browsers
 *  remap Shift+wheel to a sideways scroll (deltaY 0), so under the Shift pan key
 *  deltaX carries the zoom; any other sideways swipe zooms nothing. The camera
 *  (`towerInputCamera`) zooms by it, and the Space hold (`inputKeys`) counts a
 *  turn as a pan only when it zooms. */
export function wheelZoomDelta(e: { deltaX: number; deltaY: number; shiftKey?: boolean }): number {
  if (e.deltaY !== 0) return e.deltaY;
  return e.shiftKey ? e.deltaX : 0;
}
