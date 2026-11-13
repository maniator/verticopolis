import { isPresent } from "../shared/unitState";
import type { UnitState } from "../shared/types";

/**
 * Modern's room shading (#2097): a light pass over each settled room, lit
 * from the upper left like Modern's people, baked into the room's region
 * canvas on the web only. The shared room sprites (and so the native atlas)
 * stay flat, and Classic never shades.
 *
 * A room in a state the player reads by its color (vacant gray, a dirty
 * tray, a closed sign, construction, fire, gutted) is left flat, so the
 * pass never changes what a reserved cue looks like.
 */

/** Whether a room gets the pass: Modern's look, and someone is there. */
export function shadesRoom(shadedLook: boolean, u: { readonly state: UnitState }): boolean {
  return shadedLook && isPresent(u);
}

/** The light from above: a warm lift at the ceiling, clear through the
 *  middle, a cool shadow at the floor. */
export const ROOM_LIGHT = { ceiling: "rgba(255,248,230,0.10)", clear: "rgba(255,255,255,0)", floor: "rgba(20,16,30,0.14)" } as const;
/** The lit left wall edge and the shaded right one. */
export const ROOM_EDGE = { lit: "rgba(255,248,230,0.16)", shaded: "rgba(20,16,30,0.18)" } as const;
/** Where the ceiling's lift has faded out, as a share of the room's height. */
const CLEAR_AT = 0.45;

/** Shade the room at (x, y), `w` by `h`, in the region canvas. */
export function shadeRoom(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  const light = ctx.createLinearGradient(0, y, 0, y + h);
  light.addColorStop(0, ROOM_LIGHT.ceiling);
  light.addColorStop(CLEAR_AT, ROOM_LIGHT.clear);
  light.addColorStop(1, ROOM_LIGHT.floor);
  ctx.fillStyle = light;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = ROOM_EDGE.lit;
  ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = ROOM_EDGE.shaded;
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.restore();
}
