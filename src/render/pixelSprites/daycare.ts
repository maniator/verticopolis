import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { hash, personStanding, shade, shell, type RoomCtx } from "./common";

/**
 * Modern Daycare art: a bright, cheerful playroom with a soft play mat, a toy
 * shelf, a row of little cots, and a caregiver, with small children that fill in
 * with the real occupant count. Like the other Track-2 showpieces it has no
 * subtypes, so this is one bespoke look. Modern-only (never exported to the 1994
 * TDT). The room only ever draws while open (the closed shutter covers its off
 * hours), so this is always the busy daytime scene.
 *
 * Drawing reads only bake-signature inputs (the real occupant count and a stable
 * geography seed), so a placed room stays cacheable, an empty room reads quiet,
 * and a TDT id renumber never reshuffles the children.
 */

const WALL = "#FBE8B8"; // warm cream
const FLOOR = "#E6C98A"; // soft wood
const MAT = ["#E8785D", "#5DB4E8", "#6BD47A", "#F0C24A"]; // primary-color play mat
const SHELF = "#B07A46";

/** A stable per-room seed from GEOGRAPHY (floor, x), so the children and toys
 *  survive a save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 137 + u.x * 19) | 0;
}

/** A small child: a shorter body than the adult silhouette, in a bright smock. */
function child(ctx: CanvasRenderingContext2D, px: number, footY: number, seed: number): void {
  const c = MAT[seed % MAT.length];
  ctx.fillStyle = "#000000";
  ctx.globalAlpha = 0.22;
  ctx.fillRect(px, footY - 3, 3, 3); // body block
  ctx.globalAlpha = 1;
  ctx.fillStyle = c;
  ctx.fillRect(px, footY - 3, 3, 2); // smock
  ctx.fillStyle = "#E8C9A0";
  ctx.fillRect(px, footY - 5, 3, 2); // head
}

export function daycare(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const floorY = shell(ctx, x, y, w, h, WALL, FLOOR);
  const seed = figureSeed(u);
  const occ = visibleOccupants(u);

  // A bright bunting garland along the top wall.
  for (let bx = x + 2, i = 0; bx + 4 < x + w - 2; bx += 6, i++) {
    ctx.fillStyle = MAT[(i + seed) % MAT.length];
    ctx.fillRect(bx, y + 3, 4, 3);
  }

  // A checkered soft play mat covering most of the floor.
  const matX0 = x + 3, matX1 = x + Math.round(w * 0.62);
  for (let mx = matX0, k = 0; mx + 4 < matX1; mx += 5, k++) {
    ctx.fillStyle = shade(MAT[(k + seed) % MAT.length], -8);
    ctx.fillRect(mx, floorY - 2, 5, 2);
  }

  // A toy shelf on the right with colorful bins.
  const shX = x + Math.round(w * 0.66);
  const shW = w - (shX - x) - 3;
  ctx.fillStyle = SHELF;
  ctx.fillRect(shX, floorY - 12, shW, 12);
  ctx.fillStyle = shade(SHELF, 20);
  ctx.fillRect(shX, floorY - 12, shW, 1); ctx.fillRect(shX, floorY - 7, shW, 1);
  for (let bx = shX + 1, i = 0; bx + 2 < shX + shW; bx += 4, i++) {
    ctx.fillStyle = MAT[(i + seed + 1) % MAT.length];
    ctx.fillRect(bx, floorY - 11, 3, 3); // upper bin of toys
    ctx.fillRect(bx, floorY - 6, 3, 3); // lower bin
  }
  // A stack of blocks on the mat.
  for (let i = 0; i < 3; i++) { ctx.fillStyle = MAT[(seed + i) % MAT.length]; ctx.fillRect(matX0 + 2, floorY - 4 - i * 2, 3, 2); }

  // The caregiver (a standing adult) is present whenever the room is open.
  if (occ > 0) personStanding(ctx, shX - 6, floorY, seed + 2);

  // Children on the play mat, filling in with occupancy. Bounded by the mat width,
  // so a forged occupant count can never over-iterate.
  let drawn = 0;
  for (let cx = matX0 + 3; cx + 3 < matX1 && drawn < occ; cx += 6, drawn++) {
    if (hash(seed * 23 + drawn) > 0.12) child(ctx, cx, floorY, seed + drawn * 5);
  }
}
