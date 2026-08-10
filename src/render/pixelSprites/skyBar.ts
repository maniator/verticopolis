import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { busyStations, hash, personSeated, personStanding, shade, shell, type RoomCtx } from "./common";
import { artRow, artUnits } from "./artScale";

/**
 * Modern Sky Bar art: a warm rooftop cocktail lounge at dusk, its back wall a big
 * dark window onto a lit skyline, with a bar counter of glowing bottles, a row of
 * stools, and patrons that fill in with the real occupant count. Like the other
 * Track-2 showpieces it has no subtypes, so this is one bespoke look. Modern-only
 * (never exported to the 1994 TDT). The bar only ever draws while open (the closed
 * shutter covers its daytime hours), so this is always the evening scene.
 *
 * Drawing reads only bake-signature inputs (the real occupant count and a stable
 * geography seed), so a placed room stays cacheable, an empty bar reads quiet, and
 * a TDT id renumber never reshuffles the crowd or the skyline.
 */

const WALL = "#241a2a"; // dusk-purple interior
const SKY = "#0e1526"; // night sky through the window
const COUNTER = "#3a2418"; // warm wood bar
const BOTTLE = ["#e0b040", "#c85050", "#50b0c0", "#a060c0"]; // backlit bottles
const WINDOW_LIGHT = ["#f0d070", "#f0a850", "#d0d0f0"]; // distant city windows

/** A stable per-room seed from GEOGRAPHY (floor, x), so the crowd, bottles, and
 *  skyline survive a save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 167 + u.x * 29) | 0;
}

export function skyBar(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const floorY = shell(ctx, x, y, w, h, WALL, WALL);
  const seed = figureSeed(u);
  const occ = visibleOccupants(u);

  // The skyline window fills the upper back wall: a dark sky pane with a jagged
  // silhouette of buildings and scattered lit windows, the bar's whole reason to
  // sit up high.
  const winTop = y + 3;
  const winBot = floorY - 9;
  ctx.fillStyle = SKY;
  ctx.fillRect(x + 2, winTop, w - 4, winBot - winTop);
  // Building silhouettes rising from the sill, of stable pseudo-random heights.
  for (let bx = x + 3, i = 0; bx + 4 < x + w - 3; bx += 6, i++) {
    const bh = 4 + Math.round(hash(seed + i * 5) * (winBot - winTop - 5));
    ctx.fillStyle = shade(SKY, 10);
    ctx.fillRect(bx, winBot - bh, 5, bh);
    // A few lit windows on each building.
    for (let wy = winBot - bh + 2; wy < winBot - 1; wy += 3) {
      if (hash(bx * 7 + wy) > 0.55) {
        ctx.fillStyle = WINDOW_LIGHT[(i + wy) % WINDOW_LIGHT.length];
        ctx.fillRect(bx + 1 + ((wy & 1) ? 2 : 0), wy, 1, 1);
      }
    }
  }
  // The window frame.
  ctx.fillStyle = shade(WALL, 30);
  ctx.fillRect(x + 2, winTop, w - 4, 1);
  ctx.fillRect(x + 2, winBot, w - 4, 1);

  // The bar counter along the floor line, with a row of backlit bottles behind it.
  const barX = x + 3;
  const barW = w - 6;
  ctx.fillStyle = COUNTER;
  ctx.fillRect(barX, floorY - 4, barW, 4);
  ctx.fillStyle = shade(COUNTER, 26); // polished edge
  ctx.fillRect(barX, floorY - 4, barW, 1);
  for (let lx = barX + 2, i = 0; lx < barX + barW - 2; lx += 4, i++) {
    ctx.fillStyle = BOTTLE[(i + seed) % BOTTLE.length];
    ctx.fillRect(lx, floorY - 7, 1, 3); // a bottle glowing on the back shelf
  }

  // Stool anchors: the 7px stool pitch is authored art, counted against the
  // COUNTER at the tile it was drawn for and stepped at the current one. Read
  // off the counter's pixel width it lost two stools when the tile narrowed, and
  // two patrons who were at the bar went undrawn with them. The counter's own
  // authored width is named rather than folded into the margins, so the two
  // 3px insets that define it cannot drift apart from `barW` unnoticed.
  const counterArtW = artUnits(w) - 6;
  const stools = artRow(counterArtW - 3 - 9, barX + 3, barX + barW - 9, 7);
  // Which stools are taken: the occupancy says how many, the seed says which.
  // The old loop counted a hash-skipped stool against the occupancy as if
  // someone had sat there, so a bar with five patrons could show two.
  const taken = busyStations(stools.length, occ, seed * 19);
  // Patrons: a bartender behind the counter when the bar is live, and guests on
  // stools in front of it. The bartender is staff, not one of the room's
  // occupants, so he does not come off the stool count. Stools sit closer
  // together than a figure is wide, so a patron overlapping him is inherent and
  // always was; landing on his exact column is not, because then the two read as
  // one person, so he steps aside far enough to stay his own figure.
  if (occ > 0) {
    const onStool = new Set(stools);
    let bartX = barX + Math.round(barW / 2) - 3;
    while (onStool.has(bartX)) bartX++;
    personStanding(ctx, bartX, floorY - 6, seed + 2);
  }
  stools.forEach((sx, i) => {
    if (!taken.has(i)) return;
    personSeated(ctx, sx, floorY - 1, seed + i * 11);
    ctx.fillStyle = shade(COUNTER, -18); // the stool
    ctx.fillRect(sx + 1, floorY - 1, 2, 1);
  });
}
