import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { busyStations, personStanding, shade, shell, type RoomCtx } from "./common";
import { artRow, artUnits } from "./artScale";

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

  // A checkered soft play mat covering most of the floor. The mat is drawn at
  // its screen size, but its AUTHORED width is what decides how many children it
  // seats, so that is worked out separately and handed to the row.
  const matX0 = x + 3, matX1 = x + Math.round(w * 0.62);
  const matArtW = Math.round(artUnits(w) * 0.62) - 3;
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

  // The caregiver (a standing adult) is present whenever the room is open. She
  // is staff, not one of the children the room is counted in, so she does not
  // come off the mat's places.
  if (occ > 0) personStanding(ctx, shX - 6, floorY, seed + 2);

  // Places on the mat: the 6px pitch is authored art, counted against the MAT at
  // the tile it was drawn for and stepped at the current one. Read off the mat's
  // pixel width the room lost two places when the tile narrowed, and two
  // children who were in the room went undrawn.
  const places = artRow(matArtW - 3 - 4, matX0 + 3, matX1 - 4, 6);
  // Who is sitting where: the hash scatters them, the occupancy says how many.
  // The old loop counted a hash-skipped place against the occupancy as if a
  // child were there, so a room with five children could show two.
  const sitting = busyStations(places.length, occ, seed * 23);
  places.forEach((cx, i) => {
    if (sitting.has(i)) child(ctx, cx, floorY, seed + i * 5);
  });
}
