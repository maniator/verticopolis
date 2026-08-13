import type { Unit } from "../../engine/types";
import { visibleOccupants } from "../../engine/Crowd";
import { PAL, SKIN, ceilingFixture, dado, geoVariant, maybeMirrored, personSeated, roomGlow, shade, vacancy, windowView, type RoomCtx } from "./common";
import { artRow, authoredWidth, screenLength } from "./artScale";
import { bevelBox, ceilingCap, curtain, downlights, fill, framedArt, glow, interiorWall, plankFloor } from "./dollhouse";
import { CONDO_PICTURES, CONDO_WALLS, HOTEL_WALLS, OFFICE_WALLS, SUITE_WALLS } from "./residential.looks";
import { ROACH_AMBER, ROACH_CHESTNUT, drawRoach } from "./residential.roaches";

/**
 * Residential and lodging room art: office, condo, and the three hotel grades,
 * ported to the ratified page-02 "warm dollhouse" composition (crown-molding
 * ceiling with downlights, pinstriped warm interior wall, wainscot dado or a
 * shaded lower band, plank floor, a curtained skyline window as the
 * warm-inside-cool-outside seam) over the shared primitives.
 *
 * Every look resolves from the room bake signature only (`u.state`, `d.lit`,
 * `u.width`, `u.occupants`, `u.outForMeal` via `visibleOccupants`, and the
 * condo `lateNight` flag from `d.hour`); none reads `d.anim`, so a static room
 * stays cacheable and repaints exactly when its look changes. Seated occupants
 * map one-to-one to `visibleOccupants(u)`, capped by the layout's seats and
 * filled in seat order: no ghost people. Integer pixel coordinates only.
 */

/** Floor-band height and floor-line Y for a room rect, matching the build's
 *  fy = 38 at the true FLOOR = 44 module height while tracking a shorter rect. */
function floorMetrics(y: number, h: number): { floorH: number; floorY: number } {
  const floorH = Math.max(4, Math.round(h * 0.14));
  return { floorH, floorY: y + h - floorH };
}

// ---- Office -------------------------------------------------------------

/** One office cubicle: a partition, a chair, a desk with a monitor whose screen
 *  lights only when the seat is staffed, and (staffed) a seated worker. The
 *  worker draws before the desk front so the desk occludes the seat, reading as
 *  "sitting at the desk" (build `cube`). Office-local by design. */
function cube(ctx: CanvasRenderingContext2D, dx: number, floorY: number, staffed: boolean, seed: number): void {
  fill(ctx, dx - 2, floorY - 17, 2, 17, "#5E4028"); // partition post
  fill(ctx, dx - 2, floorY - 17, 1, 17, "#7E5A38");
  fill(ctx, dx + 7, floorY - 10, 5, 10, "#3A3F4A"); // chair back
  fill(ctx, dx + 7, floorY - 10, 5, 1, "#4A5058");
  if (staffed) personSeated(ctx, dx + 8, floorY - 1, seed);
  fill(ctx, dx, floorY, 18, 1, "#000000", 0.16); // desk contact shadow
  bevelBox(ctx, dx, floorY - 6, 18, 3, PAL.oak); // desk top
  fill(ctx, dx, floorY - 3, 18, 3, shade(PAL.oak, -26)); // desk front
  fill(ctx, dx + 1, floorY - 13, 7, 7, "#20242C"); // monitor bezel
  fill(ctx, dx + 1, floorY - 13, 7, 1, "#3A4048");
  fill(ctx, dx + 2, floorY - 12, 5, 4, staffed ? "#5FB0DC" : "#2E3640"); // screen: lit when staffed
  if (staffed) fill(ctx, dx + 2, floorY - 12, 5, 1, "#8FD0EC");
  fill(ctx, dx + 9, floorY - 7, 6, 1, "#1A1D24"); // keyboard
  fill(ctx, dx + 15, floorY - 8, 2, 2, "#C87A5A"); // desk cup
}

export function office(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  if (u.state === "empty") return vacancy(ctx, x, y, w, h, "LEASE");
  // Geo-seeded variety, geometry first (party law): three true layouts (the
  // classic cubicle row, a meeting room, an executive corner), any of them
  // mirrored, over warm cream walls and olive carpet. Occupancy stays readable
  // in every layout: seats map to the people actually present.
  const wall = OFFICE_WALLS[geoVariant(u, 0, OFFICE_WALLS.length)];
  const filled = Math.max(0, visibleOccupants(u));
  const layout = geoVariant(u, 3, 5); // 0-2 cubicle row (anchor weight), 3 meeting, 4 executive
  const flip = geoVariant(u, 4, 2) === 1;
  const { floorH, floorY } = floorMetrics(y, h);
  const railY = floorY - 15;
  // Dollhouse shell (symmetric full-width fills: flip-invariant, drawn once).
  ceilingCap(ctx, x, y, w, PAL.warmWall);
  interiorWall(ctx, x, y + 3, w, railY - (y + 3), wall, true); // butts under the cap, no seam
  downlights(ctx, x, y + 3, w, filled > 0); // over the wall; lit only when someone is working
  fill(ctx, x, railY - 3, w, 1, "#C4A87A"); // rail shadow line
  dado(ctx, x, floorY, w, railY, wall);
  plankFloor(ctx, x, floorY, w, floorH, PAL.carpetGreen);
  maybeMirrored(ctx, flip, x, w, () => {
    // Curtained skyline window (flips with the layout): the cool world seam.
    const winTop = y + 7;
    const winH = railY - y - 11;
    const winW = Math.min(23, Math.max(9, Math.round(w * 0.3)));
    const winX = x + w - winW - 4;
    windowView(ctx, winX, winTop, winW, winH, d.lit, geoVariant(u, 5, 997));
    curtain(ctx, winX - 1, winTop, winH, "#B8845A");
    // One wall item per office, same slot: clock, whiteboard, or corkboard.
    const item = geoVariant(u, 1, 3);
    if (item === 2) {
      fill(ctx, x + 5, y + 8, 5, 5, PAL.ink); // wall clock
      fill(ctx, x + 6, y + 9, 3, 3, "#E8E4D0");
      fill(ctx, x + 7, y + 9, 1, 2, PAL.ink);
    } else {
      framedArt(ctx, x + 5, y + 7, 12, 7, item === 0 ? "#3E5A6E" : "#5A6E4A");
    }
    // A binder shelf, only when there is clear wall between the item and window.
    if (winX - (x + 20) >= 18) {
      const bsX = winX - 18;
      bevelBox(ctx, bsX, y + 6, 16, 9, "#6A5240");
      const spines = ["#8C3A32", "#3E5A8C", "#B08A3E", "#4A7A4A", "#7A5A9E"];
      for (let k = 0; k < 5; k++) fill(ctx, bsX + 2 + k * 3, y + 8, 2, 5, spines[k]);
    }
    if (layout === 3) {
      // Meeting room: one long table with a laptop and papers, high-back chairs
      // both sides, seated staff up to the chair count, a corner plant.
      // The table is worked out in authored units and then brought back to
      // screen. Its 60px ceiling is a fixed art literal that did not shrink with
      // the tile, so sizing the table on screen and counting its chairs in
      // authored units would credit a capped table with 66 authored pixels and
      // seat a sixth worker the room was never drawn to hold.
      const atw = Math.min(Math.round(authoredWidth(u.width) * 0.6), 60);
      const tw = Math.round(screenLength(atw));
      const tx = x + Math.round((w - tw) / 2);
      fill(ctx, tx, floorY, tw, 1, "#000000", 0.16);
      bevelBox(ctx, tx, floorY - 7, tw, 4, PAL.walnut);
      fill(ctx, tx + 6, floorY - 8, 4, 1, PAL.white); // papers
      fill(ctx, tx + tw - 12, floorY - 8, 4, 1, PAL.white);
      fill(ctx, tx + Math.round(tw / 2) - 3, floorY - 9, 6, 2, PAL.ink); // laptop
      // Chair anchors, counted against the TABLE at the tile its 11px pitch was
      // drawn for. Counting seats off the table's pixel width lost the fifth
      // chair when the tile narrowed, and the fifth worker present went undrawn
      // with it. A table too short for a chair seats none, which is what the
      // per-chair fit check used to do.
      const chairs = artRow(atw - 3 - 6, tx + 3, tx + tw - 6, 11, 1, 6);
      const seated = Math.min(filled, chairs.length);
      chairs.forEach((sx, i) => {
        fill(ctx, sx - 1, floorY - 12, 7, 5, "#3A3F4A"); // high-back chair
        fill(ctx, sx - 1, floorY - 12, 7, 1, "#4A5058");
        if (i < seated) personSeated(ctx, sx, floorY - 1, (u.id * 7 + i * 31) | 0);
      });
      fill(ctx, x + w - 9, floorY - 6, 3, 6, "#7A5A3A"); // corner plant
      fill(ctx, x + w - 12, floorY - 13, 8, 8, "#4E7A3E");
      fill(ctx, x + w - 10, floorY - 16, 4, 4, PAL.green);
    } else if (layout === 4) {
      // Executive corner: a big desk with a seated executive, a tall binder
      // cabinet, plus two side cubicles so a staffed office still shows people.
      // The layout is one chain of absolute anchors authored to just fill the
      // office at the retired 11px tile, so every anchor is restated at the
      // current one. Left alone, the chain overran the narrower room and the
      // second cubicle's worker dropped out of a fully staffed office. Only the
      // anchors move: the items keep their authored widths, so the chain's slack
      // is 1px rather than the 3 it was drawn with, and the fit check below is
      // what holds it honest if a room narrower than the office ever renders it.
      const ax = (n: number): number => x + Math.round(screenLength(n));
      fill(ctx, ax(6), floorY, 26, 1, "#000000", 0.16);
      bevelBox(ctx, ax(6), floorY - 8, 26, 6, "#71512F"); // executive desk
      fill(ctx, ax(9), floorY - 15, 8, 7, "#20242C"); // monitor bezel
      fill(ctx, ax(10), floorY - 14, 6, 5, filled > 0 ? "#5FB0DC" : "#2E3640");
      fill(ctx, ax(23), floorY - 17, 7, 17, "#5A3A2A"); // high-back leather chair
      fill(ctx, ax(23), floorY - 17, 7, 1, "#6A4A38");
      if (filled > 0) personSeated(ctx, ax(22), floorY - 1, (u.id * 7) | 0);
      bevelBox(ctx, ax(36), floorY - 18, 14, 18, "#5A4436"); // binder cabinet
      const spines = ["#8C3A32", "#3E5A8C", "#B08A3E", "#4A7A4A"];
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) fill(ctx, ax(38) + k * 3, floorY - 16 + r * 4, 2, 3, spines[(k + r) % 4]);
      for (let i = 0; i < 2; i++) {
        const cx = ax(54 + i * 22);
        if (cx + 18 > x + w - 2) break;
        cube(ctx, cx, floorY, i + 1 < filled, (u.id * 7 + (i + 1) * 31) | 0);
      }
    } else {
      // Classic cubicle row (the anchor layout): a bank of cubicles, staffed in
      // seat order up to the visible occupant count, one with an aisle plant.
      // The bank is counted against the room measured at the authored tile (its
      // width in tiles, which the scale change did not move) and stepped at the
      // current one, so a narrower tile tightens the aisles instead of retiring
      // a desk and the worker sitting at it. It keeps its own count formula
      // rather than `artRow`'s: this row reserves 12px of room where `artRow`
      // would reserve a whole cubicle, and switching would add a fourth desk the
      // office was never drawn with. The slot then holds its authored 22px
      // wherever that still fits, so the 9-tile office the catalog ships is
      // spaced exactly as it was drawn, and only tightens on the wide rooms
      // where the bank would otherwise run out through the far wall. That leaves
      // the fit check below as a backstop for the single-desk case, which has no
      // pitch to compress.
      const start = x + 7;
      const last = x + w - 2 - 18; // the furthest a desk can start and still fit
      const count = Math.max(1, Math.floor((authoredWidth(u.width) - 12) / 22));
      const slot = count > 1 ? Math.min(22, (last - start) / (count - 1)) : 22;
      const plantDesk = geoVariant(u, 2, count);
      const seated = Math.min(count, filled);
      for (let i = 0; i < count; i++) {
        const dx = start + Math.round(i * slot);
        if (dx + 18 > x + w - 2) break;
        cube(ctx, dx, floorY, i < seated, (u.id * 7 + i * 31) | 0);
        if (i === plantDesk) {
          fill(ctx, dx + 8, floorY - 9, 3, 2, PAL.green); // aisle plant
          fill(ctx, dx + 8, floorY - 7, 3, 2, "#8C5A3A");
        }
      }
    }
  });
}

// ---- Condo --------------------------------------------------------------

/** Min room width for the absolute-offset dining/study layouts (chairs end at x+77). */
const WIDE_LAYOUT_MIN_W = 84;

// prettier-ignore
export function condo(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number, walls: string[] = CONDO_WALLS, pics: string[] = CONDO_PICTURES, vacancyLabel = "SALE"): void {
  const { ctx } = d;
  if (u.state === "empty") return vacancy(ctx, x, y, w, h, vacancyLabel);
  // Residents are "up" only when home and not asleep in the small hours.
  const home = visibleOccupants(u) > 0 && !(d.hour >= 23 || d.hour < 6);
  // Geo-seeded variety, geometry first: three true layouts (living, dining with a
  // kitchenette, a study), any of them mirrored, over warm plaster and maple. The
  // standing lamp appears in every layout so the home-glow signal survives.
  const wall = walls[geoVariant(u, 0, walls.length)];
  // Dining/study use absolute offsets so they need WIDE_LAYOUT_MIN_W: the 6-tile
  // Studio drew furniture through its own wall. Narrow rooms take living instead.
  const layout = w >= WIDE_LAYOUT_MIN_W ? geoVariant(u, 3, 5) : geoVariant(u, 3, 3);
  const flip = geoVariant(u, 4, 2) === 1;
  const { floorH, floorY } = floorMetrics(y, h);
  const railY = floorY - 14;
  ceilingCap(ctx, x, y, w, wall);
  interiorWall(ctx, x, y + 3, w, railY - (y + 3), wall, true); // butts under the cap, no seam
  ceilingFixture(ctx, x, y + 2, w, home); // over the wall; glows warm when residents are up
  fill(ctx, x, railY - 3, w, 1, "#A88A6E");
  fill(ctx, x, railY, w, floorY - railY, shade(wall, -8)); // shaded lower wall band
  plankFloor(ctx, x, floorY, w, floorH, "#B98A5A"); // maple floor
  fill(ctx, x + Math.round(w * 0.28), floorY + 1, Math.round(w * 0.4), 1, "#8C3A32", 0.4); // area rug hint
  // The standing floor lamp: shade warms to glowLit when home, drops to glowDim
  // otherwise (empty, or late-night asleep). Drawn in every layout.
  const lamp = (lxRaw: number): void => {
    const lx = Math.min(Math.max(lxRaw, x + 3), x + w - 4); // keep the 7px shade in the room
    fill(ctx, lx, floorY - 18, 1, 18, "#7A6A50"); // pole
    fill(ctx, lx - 3, floorY - 21, 7, 4, roomGlow(home)); // shade
    if (home) glow(ctx, lx, floorY - 19, PAL.glowLit);
  };
  maybeMirrored(ctx, flip, x, w, () => {
    // A framed art pair and a curtained skyline window (flip with the layout).
    const picIx = geoVariant(u, 1, pics.length);
    framedArt(ctx, x + 8, y + 8, 11, 8, pics[picIx]);
    framedArt(ctx, x + 23, y + 9, 9, 6, pics[(picIx + 2) % pics.length]);
    const winTop = y + 7;
    const winH = railY - y - 11;
    const winW = Math.min(22, Math.max(9, Math.round(w * 0.24)));
    const winX = x + w - winW - 6;
    windowView(ctx, winX, winTop, winW, winH, d.lit, geoVariant(u, 5, 997));
    curtain(ctx, winX - 1, winTop, winH, "#9A6E7A");
    curtain(ctx, winX + winW + 2, winTop, winH, "#9A6E7A");
    if (layout === 3) {
      // Dining: kitchenette on the wall, a set table with a candle, two seated
      // diners when home, a sideboard, the standing lamp.
      bevelBox(ctx, x + 6, railY + 1, 26, floorY - railY - 1, "#B8B4A8"); // kitchenette
      fill(ctx, x + 9, railY, 2, 1, PAL.ink); // stove burners
      fill(ctx, x + 13, railY, 2, 1, PAL.ink);
      fill(ctx, x + 6, y + Math.round(h * 0.32), 26, 5, "#9A968A"); // upper cabinet
      const tx = x + 46;
      fill(ctx, tx, floorY, 26, 1, "#000000", 0.16);
      bevelBox(ctx, tx, floorY - 7, 26, 3, PAL.walnut); // dining table
      fill(ctx, tx + 1, floorY - 4, 2, 4, shade(PAL.walnut, -20)); // legs
      fill(ctx, tx + 23, floorY - 4, 2, 4, shade(PAL.walnut, -20));
      fill(ctx, tx + 6, floorY - 8, 4, 1, PAL.white); // place settings
      fill(ctx, tx + 16, floorY - 8, 4, 1, PAL.white);
      fill(ctx, tx + 11, floorY - 10, 2, 3, "#E8C14A"); // candle
      if (home) glow(ctx, tx + 12, floorY - 10, PAL.glowLit);
      fill(ctx, tx - 5, floorY - 13, 3, 9, "#5A3A2A"); // dining chairs
      fill(ctx, tx + 28, floorY - 13, 3, 9, "#5A3A2A");
      if (home) {
        personSeated(ctx, tx - 5, floorY - 1, (u.id * 5) | 0);
        if (visibleOccupants(u) > 1) personSeated(ctx, tx + 27, floorY - 1, (u.id * 5 + 11) | 0);
      }
      bevelBox(ctx, x + w - 30, railY + 1, 10, floorY - railY - 1, "#8A6A4A"); // sideboard
      lamp(x + w - 12);
    } else if (layout === 4) {
      // Study: a tall bookcase wall, a desk with an open book and a monitor
      // under the lamp, a seated reader when home, a low cabinet.
      bevelBox(ctx, x + 6, railY - 2, 30, floorY - railY + 2, "#6A5240"); // bookcase
      const spines = ["#8C3A32", "#3E5A8C", "#B08A3E", "#4A7A4A", "#5A4A6E"];
      // Rows anchored at railY - 1 so the four 3px spine rows fit within the
      // bookcase (bottom row ends at floorY - 1) instead of spilling 1px onto the floor line.
      for (let r = 0; r < 4; r++) for (let k = 0; k < 9; k++) fill(ctx, x + 9 + k * 3, railY - 1 + r * 4, 2, 3, spines[(k + r) % 5]);
      const dx = x + 48;
      fill(ctx, dx, floorY, 22, 1, "#000000", 0.16);
      bevelBox(ctx, dx, floorY - 7, 22, 3, PAL.wood); // desk
      fill(ctx, dx + 6, floorY - 8, 7, 1, PAL.white); // open book
      fill(ctx, dx + 8, floorY - 13, 6, 6, "#4A5464"); // monitor
      if (home) personSeated(ctx, dx + 9, floorY - 1, (u.id * 5) | 0);
      bevelBox(ctx, x + w - 28, floorY - 5, 12, 5, "#5A6E8C"); // low cabinet
      lamp(dx + 20);
    } else {
      // Living room (the anchor layout): a tufted sofa with a seated resident
      // when home, a coffee table, the standing lamp, and the right-slot swap.
      const sofaW = Math.min(Math.round(w * 0.36), 40);
      const base = x + Math.round(w * 0.15);
      fill(ctx, base, floorY, sofaW, 1, "#000000", 0.16);
      bevelBox(ctx, base, floorY - 10, sofaW, 10, "#7C5A6A"); // sofa
      fill(ctx, base + 2, floorY - 13, sofaW - 4, 4, "#8C6A7A"); // back
      fill(ctx, base, floorY - 13, 3, 13, "#6A4858"); // arms
      fill(ctx, base + sofaW - 3, floorY - 13, 3, 13, "#6A4858");
      fill(ctx, base + 6, floorY - 12, 8, 3, "#9A7A8A"); // cushions
      fill(ctx, base + 20, floorY - 12, 8, 3, "#9A7A8A");
      if (home) personSeated(ctx, base + Math.round(sofaW * 0.4), floorY - 1, (u.id * 5) | 0);
      bevelBox(ctx, base + sofaW + 6, floorY - 6, 14, 6, PAL.walnut); // coffee table
      fill(ctx, base + sofaW + 9, floorY - 8, 2, 2, PAL.white); // vase
      lamp(base - 8);
      // Right slot: TV (weighted most common), a low bookshelf, or a plant.
      const slotW = Math.min(Math.round(w * 0.14), 18);
      const slotX = x + w - slotW - 6;
      const rightSlot = geoVariant(u, 2, 5);
      if (rightSlot <= 2) {
        bevelBox(ctx, slotX, floorY - 16, slotW, 13, "#2A2A32"); // TV
        fill(ctx, slotX + 1, floorY - 15, slotW - 2, 10, home ? "#8FB6FF" : "#2A2F3A");
        if (home) fill(ctx, slotX + 2, floorY - 14, slotW - 4, 4, "#B8D0FF", 0.5);
        bevelBox(ctx, slotX - 1, floorY - 3, slotW + 2, 3, "#5A4436"); // console
      } else if (rightSlot === 3) {
        bevelBox(ctx, slotX, floorY - 11, slotW, 11, "#6A5240"); // low bookshelf
        for (let row = 0; row < 2; row++) {
          for (let bx = slotX + 1, k = 0; bx + 2 < slotX + slotW - 1; bx += 3, k++) {
            fill(ctx, bx, floorY - 10 + row * 5, 2, 4, ["#8C3A32", "#3E5A8C", "#B08A3E"][k % 3]);
          }
        }
      } else {
        fill(ctx, slotX + 2, floorY - 5, 5, 5, "#8C5A3A"); // window plant
        fill(ctx, slotX + 1, floorY - 10, 3, 5, PAL.green);
        fill(ctx, slotX + 5, floorY - 9, 3, 4, PAL.green);
      }
    }
  });
}

// ---- Hotel --------------------------------------------------------------

export function hotel(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number, grade: number): void {
  const { ctx } = d;
  const asleep = u.state === "asleep";
  const dirty = u.state === "dirty";
  const infested = u.state === "infested"; // cockroaches: a worse, heavier-roach dirty
  const soiled = dirty || infested; // both leave the bed rumpled and unmade
  // Unlike office and condo, a hotel has no "empty" vacancy shell: a room between
  // guests stays furnished and ready to rent (state "empty" reads as ready, with
  // the lamp lit), so there is no vacancy early return here.
  // Rooms of the SAME grade stay uniform (a hotel corridor is identical rooms
  // whose job is broadcasting ready/asleep/dirty), but the GRADES are distinct
  // geometry: a single is one bed, a double is two beds with a real gap, a suite
  // adds a sitting area to a wide bed. Per-unit variety is only the linen wall
  // tint (suite drifts in its own gold band), a bed mirror, and the window seed.
  const wallBand = grade === 3 ? SUITE_WALLS : HOTEL_WALLS;
  const wall = wallBand[geoVariant(u, 0, wallBand.length)];
  // "Someone is here at all" gate stays canonical for hotels.
  const lit = !asleep && (u.occupants > 0 || d.lit);
  const wallColor = asleep ? "#3A3550" : wall;
  const floorBase = asleep ? "#4A4560" : "#A88A5E";
  const { floorH, floorY } = floorMetrics(y, h);
  const railY = floorY - 16;
  ceilingCap(ctx, x, y, w, wallColor);
  interiorWall(ctx, x, y + 3, w, railY - (y + 3), wallColor, true); // butts under the cap, no seam
  if (w > 44) ceilingFixture(ctx, x, y + 2, w, lit); // over the wall; ceiling light on the wider grades
  fill(ctx, x, railY - 3, w, 1, shade(wallColor, -16));
  fill(ctx, x, railY, w, floorY - railY, shade(wallColor, -9)); // shaded lower wall band
  plankFloor(ctx, x, floorY, w, floorH, floorBase);
  const flip = geoVariant(u, 1, 2) === 1;
  const winSeed = geoVariant(u, 2, 997);
  // One bed per grade slot: walnut headboard, cream sheet, warm hotelPink duvet
  // and a deep-red foot trim (replacing the old cool mattress), pillow(s), and
  // an asleep sleeper only when the room is actually occupied (no ghost guests).
  const bed = (bx: number, bw: number, pillows: number, sleeper: number): void => {
    const top = floorY - 12;
    fill(ctx, bx, floorY, bw, 1, "#000000", 0.18); // contact shadow
    bevelBox(ctx, bx, top - 2, 4, 14, PAL.walnut); // headboard
    fill(ctx, bx + 1, top - 1, 2, 12, "#8A6640"); // headboard highlight
    fill(ctx, bx + 4, top, bw - 4, 12, "#F2ECDE"); // mattress / turned sheet
    fill(ctx, bx + 4, top, bw - 4, 1, "#FFFFFF");
    fill(ctx, bx + 4, top + 4, bw - 4, 7, PAL.hotelPink); // warm duvet
    fill(ctx, bx + 4, top + 4, bw - 4, 1, "#C98A82"); // duvet top shade
    fill(ctx, bx + 4, top + 10, bw - 4, 1, "#8A2A38"); // foot trim
    const pw = Math.max(5, Math.round(bw * 0.26));
    fill(ctx, bx + 5, top + 1, pw, 3, "#FBF7EC"); // pillow
    fill(ctx, bx + 5, top + 1, pw, 1, "#FFFFFF");
    if (pillows > 1) fill(ctx, bx + 5, top + 5, 5, 2, "#FBF7EC");
    if (asleep && sleeper < visibleOccupants(u)) {
      fill(ctx, bx + Math.round(bw * 0.32), top + 3, Math.round(bw * 0.55), 6, PAL.hotelRed); // blanket
      fill(ctx, bx + 6, top + 1, 3, 3, SKIN[(u.id + sleeper) % SKIN.length]); // sleeper head
    } else if (soiled) {
      fill(ctx, bx + 5, top + 1, Math.round(bw * 0.8), 7, "#B8A98A"); // rumpled bedding
      fill(ctx, bx + 7, top + 2, Math.round(bw * 0.4), 2, "#A89878");
    }
  };
  // Suite sitting-area width: one source of truth shared by the bed placement
  // and the sofa/lamp draw so the two can never desync.
  const suiteSofaW = Math.min(Math.round(w * 0.2), 18);
  // Bed positions per grade, in unmirrored room coordinates.
  const beds: { bx: number; bw: number; pillows: number }[] = [];
  if (grade === 1) {
    beds.push({ bx: x + 6, bw: Math.min(Math.round(w * 0.5), 24), pillows: 1 });
  } else if (grade === 2) {
    const bw = Math.min(Math.round((w - 26) / 2), 24); // two beds with a REAL gap
    beds.push({ bx: x + 6, bw, pillows: 1 });
    beds.push({ bx: x + 6 + bw + 8, bw, pillows: 1 });
  } else {
    beds.push({ bx: x + suiteSofaW + 14, bw: Math.min(Math.round(w * 0.42), 40), pillows: 2 }); // suite: sitting area then a wide bed
  }
  maybeMirrored(ctx, flip, x, w, () => {
    if (w > 44) framedArt(ctx, x + Math.round(w * 0.16), y + 7, 12, 8, asleep ? "#2A2740" : "#8FA6B8");
    const winTop = y + 7;
    const winH = railY - y - 11;
    const winW = w > 80 ? 14 : 9;
    const winX = x + (w > 80 ? w - 20 : w - 13);
    windowView(ctx, winX, winTop, winW, winH, asleep || d.lit, winSeed);
    curtain(ctx, winX - 2, winTop, winH, asleep ? "#2E2A44" : "#B08A6A");
    if (grade === 3) {
      bevelBox(ctx, x + 5, floorY - 8, suiteSofaW, 8, "#7C5A6A"); // sitting sofa
      fill(ctx, x + 5, floorY - 11, suiteSofaW, 3, "#8C6A7A");
      fill(ctx, x + 7, floorY - 10, 6, 3, "#9A7A8A");
      if (suiteSofaW > 14) fill(ctx, x + 15, floorY - 10, 6, 3, "#9A7A8A");
      // Coffee table in front of the sofa (the sitting area, not the bed): the
      // bed starts at x + suiteSofaW + 14 and paints last, so a table placed
      // there would be fully occluded. Keep it inside the sofa's footprint.
      bevelBox(ctx, x + 7, floorY - 4, Math.min(suiteSofaW - 6, 11), 4, PAL.walnut); // coffee table
      fill(ctx, x + suiteSofaW + 8, floorY - 15, 1, 15, "#7A6A50"); // floor lamp pole
      fill(ctx, x + suiteSofaW + 6, floorY - 18, 5, 3, roomGlow(lit)); // shade
      if (lit) glow(ctx, x + suiteSofaW + 8, floorY - 16, PAL.glowLit);
    }
    beds.forEach((b, i) => bed(b.bx, b.bw, b.pillows, i));
    if (grade === 2) {
      const gapX = beds[0].bx + beds[0].bw + 2; // shared nightstand between the two beds
      fill(ctx, gapX, floorY - 5, 4, 5, "#6A4A30");
    }
  });
  // State cues and their nightstand anchor draw OUTSIDE the mirror so they render
  // pixel-identical on flipped rooms (variation never touches a state cue).
  // asleep / dirty are exclusive unit states. Reserved colors and geometry are
  // unchanged; only the ready lamp gains a 1px ink socket ring (legibility rule).
  fill(ctx, x + w - 6, floorY - 6, 4, 6, "#6A4A30"); // nightstand
  if (dirty) {
    fill(ctx, x + w - 6, floorY - 9, 4, 3, "#D4623A"); // housekeeping tray (a crew is still coming)
  } else if (!infested && lit) {
    // An infested room is abandoned by housekeeping: no tray, no cozy lamp.
    fill(ctx, x + w - 6, floorY - 6, 4, 1, PAL.ink); // ink socket ring under the bulb
    fill(ctx, x + w - 5, floorY - 11, 2, 5, "#FFD86A"); // ready: lamp on
  }
  // Cockroaches (owner-approved redesign). An INFESTED room gets a sickly-green
  // grime wash plus one big "hero" roach on the bed and three smaller ones
  // scattered over the bed, wall, and floor, so it reads as infested even zoomed
  // out. A DIRTY room gets a single amber warning roach. All draw here, outside
  // the mirror wrapper, so a flipped room reads identically; flips off the unit
  // id give scatter variety without per-frame motion (rooms are cached sprites).
  if (infested) {
    const fv = (n: number): number => (geoVariant(u, 30 + n, 2) === 1 ? 1 : -1);
    fill(ctx, x, y, w, h, "#5A6828", 0.2); // grime wash
    drawRoach(ctx, x + w * 0.44, floorY - 9, 16, 1, 1, ROACH_CHESTNUT); // hero, on the bed
    drawRoach(ctx, x + w * 0.16, floorY - 2, 10, fv(1), 1, ROACH_CHESTNUT);
    drawRoach(ctx, x + w * 0.72, floorY - 6, 10, fv(2), 1, ROACH_CHESTNUT);
    drawRoach(ctx, x + w * 0.64, y + 11, 9, fv(3), -1, ROACH_CHESTNUT);
  } else if (dirty) {
    const fx = geoVariant(u, 31, 2) === 1 ? 1 : -1;
    drawRoach(ctx, x + w * 0.3, floorY - 8, 11, fx, 1, ROACH_AMBER);
  }
  if (asleep && visibleOccupants(u) > 0) {
    // The "z" is text, so it draws OUTSIDE the mirror wrapper at a computed
    // position (mirrored text would render backward), floating over the first
    // occupied bed. Its baseline stays exactly where it shipped (floorY - 10),
    // so the asleep cue is pixel-identical regardless of the bed art. It is
    // gated on a real sleeper, matching the sleeper figure, so an empty bed never broadcasts a "z".
    const zSrc = beds[0].bx + 8;
    const zx = flip ? 2 * x + w - zSrc - 5 : zSrc;
    ctx.fillStyle = "rgba(210,220,255,0.9)";
    ctx.font = "8px system-ui, sans-serif";
    ctx.fillText("z", zx, floorY - 10);
  }
}
