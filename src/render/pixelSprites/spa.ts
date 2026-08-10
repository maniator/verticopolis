import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { busyStations, hash, personStanding, shade, shell, type RoomCtx } from "./common";

/**
 * Modern Spa art: a calm, warm wellness room with a steaming hot tub, a row of
 * massage tables, and potted greenery, with a few guests relaxing that fill in
 * with the real occupant count. Like the nightclub it has no subtypes, so this is
 * one bespoke look. Modern-only (never exported to the 1994 TDT). The spa only
 * ever draws while open (the closed shutter covers its off hours), so this is
 * always the daytime scene.
 *
 * Drawing reads only bake-signature inputs (the real occupant count and a stable
 * geography seed), so a placed room stays cacheable, an empty spa reads calm and
 * unattended, and a TDT id renumber never reshuffles the guests.
 */

const WALL = "#2a4740"; // deep calm teal
const FLOOR = "#d8cbb8"; // warm stone
const WATER = "#7fd0c4"; // hot-tub water
const TOWEL = "#f0ece2"; // massage-table linen
const PLANT = "#4f9a5c"; // greenery

/** A stable per-room seed from GEOGRAPHY (floor, x), so the guests and steam
 *  survive a save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 149 + u.x * 23) | 0;
}

export function spa(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const floorY = shell(ctx, x, y, w, h, WALL, FLOOR);
  const seed = figureSeed(u);
  const occ = visibleOccupants(u);

  // A warm accent band along the top of the back wall, the spa's calm signature.
  ctx.fillStyle = shade(WALL, 22);
  ctx.fillRect(x, y + 3, w, 2);

  // The hot tub on the left: a raised stone rim with steaming water, plus a few
  // rising steam wisps so the scene reads warm even when empty.
  const tubX = x + 3;
  const tubW = Math.min(Math.round(w * 0.34), w - 6);
  const tubTop = floorY - 7;
  ctx.fillStyle = shade(FLOOR, -28); // stone rim
  ctx.fillRect(tubX, tubTop, tubW, 7);
  ctx.fillStyle = WATER;
  ctx.fillRect(tubX + 1, tubTop + 1, tubW - 2, 4);
  ctx.fillStyle = shade(WATER, 24); // a lighter ripple line
  ctx.fillRect(tubX + 1, tubTop + 2, tubW - 2, 1);
  // Steam wisps rising from the tub (geometry-stable dots).
  ctx.fillStyle = shade(WALL, 40);
  for (let sx = tubX + 2, i = 0; sx < tubX + tubW - 1; sx += 5, i++) {
    const top = tubTop - 5 - (hash(seed + i * 3) > 0.5 ? 1 : 0);
    for (let sy = top; sy < tubTop; sy += 2) ctx.fillRect(sx, sy, 1, 1);
  }
  // A guest soaking in the tub when the spa is busy.
  if (occ > 0) personStanding(ctx, tubX + Math.round(tubW / 2) - 3, tubTop + 1, seed + 5);

  // Massage tables on the right: linen-topped beds along the floor line. This
  // row keeps its plain loop and its authored 11px pitch. Unlike the other rows
  // in this pass it is capped at three beds long before the room runs out of
  // wall, so the narrower tile never cost it a bed and there is nothing here for
  // the row helper to put right. Measured at 11 by 44 and at 10 by 45: three
  // beds either way.
  const bedX0 = tubX + tubW + 4;
  const beds: number[] = [];
  for (let bx = bedX0; bx + 8 < x + w - 2 && beds.length < 3; bx += 11) beds.push(bx);
  // Who is on a table: the hash scatters them, the occupancy says how many, and
  // the guest already soaking in the tub is one of the same people. Counting the
  // tub and the tables separately showed two guests for a spa holding one.
  const lying = busyStations(beds.length, occ - (occ > 0 ? 1 : 0), seed * 13);
  beds.forEach((bx, i) => {
    ctx.fillStyle = shade(FLOOR, -18); // the table base
    ctx.fillRect(bx, floorY - 3, 8, 3);
    ctx.fillStyle = TOWEL; // the linen
    ctx.fillRect(bx, floorY - 4, 8, 1);
    if (lying.has(i)) {
      ctx.fillStyle = shade(TOWEL, -10);
      ctx.fillRect(bx + 1, floorY - 5, 6, 1);
    }
  });

  // Potted greenery bookends the room, a spot of calm color against the stone.
  ctx.fillStyle = shade(FLOOR, -34);
  ctx.fillRect(x + w - 4, floorY - 2, 2, 2); // pot
  ctx.fillStyle = PLANT;
  ctx.fillRect(x + w - 5, floorY - 5, 4, 3); // fronds
}
