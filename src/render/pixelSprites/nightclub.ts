import type { Unit } from "../../engine/types";
import { busyStations, personStanding, roomOccupants, shade, shell, type RoomCtx } from "./common";
import { artRow, artUnits } from "./artScale";

/**
 * Modern Nightclub art: a single dark room lit by colored beams, with a DJ booth,
 * a glowing dance floor, and a crowd of dancers that fills in with the real
 * occupant count. Unlike the container kinds it has no subtypes, so this is one
 * bespoke look. Modern-only (never exported to the 1994 TDT). The club only ever
 * draws while open (the closed shutter covers its daytime hours), so this is
 * always the after-dark scene.
 *
 * Drawing reads only bake-signature inputs (the real occupant count and a stable
 * geography seed), so a placed room stays cacheable, an empty club reads empty
 * (dark, no dancers), and a TDT id renumber never reshuffles the crowd.
 */

const WALL = "#181022"; // near-black purple
const FLOOR = "#241834";
const BEAMS = ["#F0409A", "#40C0F0", "#70E060", "#F0A040", "#B060F0"]; // club light colors

/** A stable per-room seed from GEOGRAPHY (floor, x), so the crowd and light
 *  colors survive a save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 131 + u.x * 17) | 0;
}

export function nightclub(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const floorY = shell(ctx, x, y, w, h, WALL, FLOOR);
  const seed = figureSeed(u);
  const occ = roomOccupants(u);

  // Ceiling light rig: a dark bar with colored spot fixtures, each throwing a
  // faint triangular beam down toward the floor.
  ctx.fillStyle = "#0E0A16";
  ctx.fillRect(x, y, w, 3);
  for (let lx = x + 4, i = 0; lx + 2 < x + w - 2; lx += 9, i++) {
    const c = BEAMS[(i + seed) % BEAMS.length];
    ctx.fillStyle = shade(c, 40); // the fixture
    ctx.fillRect(lx, y + 2, 2, 2);
    // A faint downward beam (a few translucent-looking descending dots).
    ctx.fillStyle = shade(c, -30);
    const spread = Math.round((floorY - y) * 0.5);
    for (let by = y + 4; by < y + 4 + spread; by += 3) {
      const bw = 1 + Math.round(((by - y) / spread) * 2);
      ctx.fillRect(lx + 1 - (bw >> 1), by, bw, 1);
    }
  }

  // A glowing checkered dance floor strip along the floor line. The floor is
  // drawn at its screen size, but its AUTHORED width is what decides how many
  // dancers it holds, so that is worked out separately and handed to the row.
  const danceX0 = x + 4;
  const danceX1 = x + Math.round(w * 0.66);
  const danceArtW = Math.round(artUnits(w) * 0.66) - 4;
  for (let fx = danceX0, k = 0; fx + 3 < danceX1; fx += 4, k++) {
    ctx.fillStyle = (k % 2 === 0) ? shade(BEAMS[(k + seed) % BEAMS.length], -10) : "#14101E";
    ctx.fillRect(fx, floorY - 2, 4, 2);
  }

  // The DJ booth on the right: a raised console with two glowing decks and a DJ.
  const boothX = x + Math.round(w * 0.72);
  const boothW = w - (boothX - x) - 3;
  ctx.fillStyle = "#100A18";
  ctx.fillRect(boothX, floorY - 9, boothW, 9);
  ctx.fillStyle = shade(WALL, 26);
  ctx.fillRect(boothX, floorY - 9, boothW, 1);
  // Two turntables/decks glowing.
  ctx.fillStyle = BEAMS[seed % BEAMS.length];
  ctx.fillRect(boothX + 1, floorY - 8, 2, 2);
  ctx.fillRect(boothX + boothW - 3, floorY - 8, 2, 2);
  // The DJ behind the booth (only when the club is live, so an empty room reads
  // empty). The DJ is staff, not one of the room's occupants, so the dance floor
  // still holds its full crowd beside him.
  if (occ > 0) personStanding(ctx, boothX + Math.round(boothW / 2) - 3, floorY - 8, seed + 3);

  // Dancer anchors: the 6px pitch is authored art, counted against the DANCE
  // FLOOR at the tile it was drawn for. Read off the floor's pixel width the
  // club lost two dancing spots when the tile narrowed, and two people who were
  // in the club went undrawn.
  //
  // How many is authored geometry; WHERE they stand is not. A dancer is 6px wide
  // at a 6px pitch, so this crowd is shoulder to shoulder with nothing to give,
  // and at the narrower tile the lit strip alone no longer spans its own crowd:
  // squeezing them onto it is what made adjacent dancers overlap by a pixel. So
  // the count still comes off the strip's authored width, while the row itself
  // runs from the strip's left edge to just clear of the booth. That floor was
  // empty anyway, and a packed club spilling off the lit floor is the right read.
  //
  // The row starts a pixel left of the strip rather than on it. This crowd is
  // the one row in any room whose authored count wants its whole run, so with
  // the ends flush it sits on a knife edge: lose a single pixel anywhere (a
  // fractional room origin rounds one away) and the only way to still fit is to
  // step tighter than the pitch, which is the overlap again. A pixel of slack
  // costs nothing to look at and takes the row off that edge.
  const spots = artRow(danceArtW - 3 - 5, danceX0 - 1, boothX - 6, 6, 1, 6);
  // Who is dancing: the hash scatters them, the occupancy says how many. The old
  // loop counted a hash-skipped spot against the occupancy as if someone were
  // standing there, so a club with five people could show three.
  const dancing = busyStations(spots.length, occ, seed * 17);
  spots.forEach((dx, i) => {
    if (!dancing.has(i)) return;
    personStanding(ctx, dx, floorY, seed + i * 7);
    // A colored uplight glow at the dancer's feet.
    ctx.fillStyle = BEAMS[(i + seed) % BEAMS.length];
    ctx.fillRect(dx - 1, floorY - 1, 5, 1);
  });
}
