import type { Unit } from "../engine/types";
import { drawUnit, type DrawCtx } from "./sprites";
import { drawDeadParkingX } from "./sprites/facilities/garage";

/**
 * How the web game paints one room into a canvas, shared by the game and the
 * atlas export so the two cannot drift. Settled rooms go through the region
 * compositor (`excalibur/towerRegions.ts`); burning and unbuilt rooms through
 * their own per-frame canvas (`excalibur/towerReconcile.ts` `addRoom`).
 */

/** A settled room at (dx, dy) inside a shared canvas: clipped to its own
 *  rect (one sprite must never bleed onto a neighbor), with the dead-parking
 *  mark over an unchained space. `d.ctx` must already be the target. */
export function paintSettledUnit(d: DrawCtx, u: Unit, dx: number, dy: number, w: number, h: number, dead: boolean): void {
  const ctx = d.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, w, h);
  ctx.clip();
  d.parkingDead = dead;
  drawUnit(d, u, dx, dy, w, h);
  if (dead) drawDeadParkingX(ctx, dx, dy, w, h);
  ctx.restore();
}

/** A burning or unbuilt room into its own `w` x `h` canvas at the origin.
 *  The dead-parking mark never applies to an animated state. */
export function paintAnimatedUnit(d: DrawCtx, u: Unit, w: number, h: number): void {
  d.parkingDead = false;
  drawUnit(d, u, 0, 0, w, h);
}
