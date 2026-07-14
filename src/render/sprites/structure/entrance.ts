import type { DrawCtx } from "../common";
import { personSeated } from "../../pixelSprites/common";

/**
 * The ground-floor grand and service entrance facades: the wide two-tile grand
 * hotel entrance (left + right slices), the compact one-tile fallback, the
 * doorman, and the quiet service door. Imported by `lobby.ts`, whose
 * `drawLobbyTile` dispatches the entrance-variant tiles here.
 *
 * The grand entrance is ported from page-05's `grandEnt` reference: a glass
 * curtain wall behind a red scalloped awning, big gold double doors as the
 * focal point, a red carpet rolling out from them, a potted palm on the right
 * flank (the left flank carries the relocated reception), and the doorman on the
 * carpet. It reads warm and grander after dark (the doors
 * and awning glow as the tower's lit main entrance). The single relocated
 * reception desk and attendant (the once-per-lobby staffed counter from the
 * lobby de-repeat) stands on the left flank of the wide form.
 */

/** A composite-space fill drawer. `cx` is an x in the 22-wide composite facade,
 *  `ry` is relative to the slice's `y`. `off` shifts the right slice left by one
 *  tile so both 11px canvases paint the SAME composite; rects that fall off a
 *  slice's canvas are harmlessly clipped, which keeps the two halves lined up
 *  pixel-for-pixel at the join. Integer pixels, never a zero-size rect. */
type Filler = (cx: number, ry: number, cw: number, ch: number, color: string, alpha?: number) => void;

function makeFiller(ctx: CanvasRenderingContext2D, x: number, y: number, off: number): Filler {
  return (cx, ry, cw, ch, color, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + cx - off), Math.round(y + ry), Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch)));
    ctx.globalAlpha = 1;
  };
}

/** A potted palm: pot on the floor, a slim trunk, and green fronds. `cx` is the
 *  trunk's composite x, `fy` the floor line (relative to y). */
function palm(R: Filler, cx: number, fy: number): void {
  R(cx - 2, fy - 3, 5, 3, "#5C4A38"); // pot
  R(cx - 2, fy - 3, 5, 1, "#6A5240"); // pot rim
  R(cx, fy - 9, 1, 6, "#6A5240"); // trunk
  R(cx - 2, fy - 13, 5, 4, "#4E7A3E"); // fronds
  R(cx - 1, fy - 15, 3, 2, "#4E7A3E"); // top fronds
  R(cx - 3, fy - 11, 2, 1, "#4E7A3E"); // left frond
  R(cx + 2, fy - 11, 2, 1, "#4E7A3E"); // right frond
}

/** The shared grand-hotel facade body drawn by BOTH wide slices in composite
 *  space (each canvas clips to its half): sky and skyline, the glass curtain
 *  wall, the red scalloped awning, the gold double doors (focal point, glowing
 *  at night), the floor, the red carpet, and the right potted palm. The doorman
 *  and the left-flank reception are drawn per slice by the callers. */
function drawGrandHotelBody(d: DrawCtx, R: Filler, W: number, h: number): void {
  const { lit } = d;
  const fy = h - 6; // floor line (reference fy=38 of 44)
  const dcx = Math.round(W / 2); // doors centered on the slice boundary
  // Sky band with a distant skyline behind the entrance.
  R(0, 0, W, 10, lit ? "#2A3350" : "#AFC8DE");
  for (let bx = 0, bi = 0; bx < W; bx += 4, bi++) {
    const bh = 3 + ((bi * 3) % 4);
    R(bx, 10 - bh, 3, bh, lit ? "#1E2740" : "#7EA0C0");
    if (lit) R(bx + 1, 10 - bh + 1, 1, 1, "#F3D08A"); // warm distant windows at night
  }
  R(0, 10, W, 1, "#3A4658"); // sky base line
  // Gold cornice cap along the very top, matching the concourse ceiling line
  // (drawLobbyTile), so the whole ground frontage reads as one continuous gilded
  // top line where the entrance meets the neighboring concourse tiles. The sky
  // then reads as a clerestory strip below the cornice.
  R(0, 0, W, 3, "#C9A24B");
  R(0, 3, W, 1, "#8A7430");
  // Glass curtain wall above and around the doors: dark frame, glass inner,
  // slim mullions. Warm interior spill glows at the base after dark.
  R(2, 11, W - 4, fy - 11, "#3A4658");
  R(3, 13, W - 6, fy - 14, lit ? "#243447" : "#8FB6C8");
  for (let gx = 5; gx < W - 4; gx += 5) R(gx, 13, 1, fy - 14, lit ? "#3A5068" : "#5A7E9A", 0.6);
  if (lit) R(4, fy - 7, W - 8, 6, "#C9A24B", 0.16);
  // Red scalloped awning across the top, with a small sign and (at night) warm
  // bulbs along the valance so it reads as the lit main entrance.
  R(3, 8, W - 6, 3, "#9A2E38");
  R(3, 8, W - 6, 1, "#B84450");
  for (let cx2 = 4; cx2 < W - 4; cx2 += 4) {
    R(cx2, 11, 2, 2, "#9A2E38"); // scalloped valance block
    if (lit) R(cx2, 12, 1, 1, "#F3D08A"); // warm bulb
  }
  R(dcx - 1, 5, 2, 3, "#8A8E96"); // small sign above center
  // Gold double doors: the focal point. A warm halo behind them at night.
  const doorL = dcx - 5;
  const doorW = 10;
  const doorTopY = fy - 18;
  const doorH = 18;
  if (lit) R(doorL - 1, doorTopY - 1, doorW + 2, doorH + 2, "#FFE08A", 0.22);
  R(doorL, doorTopY, doorW, doorH, lit ? "#D8B24E" : "#C9A24B");
  R(doorL, doorTopY, doorW, 1, lit ? "#F0D878" : "#E8C860"); // top highlight
  R(dcx - 1, doorTopY, 2, doorH, "#8A6A2A"); // center split at the boundary
  R(doorL, doorTopY, 1, doorH, "#8A6A2A"); // left edge
  R(doorL + doorW - 1, doorTopY, 1, doorH, "#8A6A2A"); // right edge
  R(dcx - 4, fy - 9, 2, 2, "#8A6A2A"); // left handle
  R(dcx + 2, fy - 9, 2, 2, "#8A6A2A"); // right handle
  // Floor and the red carpet rolling out from the doors.
  R(0, fy, W, h - fy, "#8A8478");
  R(dcx - 5, fy, 10, h - fy, "#9A2E38");
  R(dcx - 5, fy, 10, 1, "#B84450"); // carpet edge highlight
  // Right potted palm flanking the doors (the left flank carries the reception).
  palm(R, W - 4, fy);
}

/**
 * Left slice of the wide 2-tile grand hotel entrance. Draws the shared facade
 * body (clipped to this 11px canvas) plus the single relocated reception desk
 * and attendant on the left flank. The wide grand entrance is placed once per
 * lobby (on the leftmost frontage run of width >= 2), so a wide lobby shows
 * exactly one attendant rather than one every fourth concourse tile. A 1-tile
 * lobby uses the compact grand-solo fallback, which has no room for a counter
 * and shows none.
 */
export function drawGrandFacadeLeft(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const { ctx, lit } = d;
  const R = makeFiller(ctx, x, y, 0);
  drawGrandHotelBody(d, R, w * 2, h);
  // Reception counter with a single seated attendant on the left flank, standing
  // on the floor beside the doors. The desk face is drawn over the figure so only
  // the head and shoulders read above the counter.
  const fy = h - 6; // floor line, matching drawGrandHotelBody
  const deskL = x;
  const deskW = 6;
  const deskH = 8;
  const deskTop = y + fy - deskH; // desk base sits on the floor top
  personSeated(ctx, x, deskTop + deskH - 1, 4);
  ctx.fillStyle = "#6B4A2B"; // walnut counter
  ctx.fillRect(deskL, deskTop, deskW, deskH);
  ctx.fillStyle = "#8A6440"; // lit top rail
  ctx.fillRect(deskL, deskTop, deskW, 1);
  ctx.fillStyle = "#4E3620"; // shaded base so the counter sits on the floor
  ctx.fillRect(deskL, deskTop + deskH - 1, deskW, 1);
  if (lit) {
    ctx.fillStyle = "#F8E2B4"; // a warm desk lamp glow at night
    ctx.fillRect(deskL + 1, deskTop - 2, 2, 2);
  }
}

/**
 * Right slice of the wide 2-tile grand hotel entrance: the shared facade body
 * (clipped to this canvas gives the right door leaf, the right palm, and the
 * carpet) plus the doorman on the carpet by the doors. The doorman carries a
 * two-frame idle sway keyed to `d.anim`, so this slice bakes with cache: false.
 */
export function drawGrandFacadeRight(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const { ctx, anim } = d;
  const R = makeFiller(ctx, x, y, w);
  drawGrandHotelBody(d, R, w * 2, h);
  // The doorman stands on the carpet at the doors. Composite dcx = w; placing him
  // at composite dcx + 3 (local x = 3, since off = w) keeps both feet on the red
  // carpet and clear of the right palm's pot at composite 16.
  drawDoorman(ctx, Math.round(x + 3), y + h - 4, anim);
}

/** The green-and-gold doorman as a small pixel figure with a two-frame idle
 *  sway keyed to `anim`. Head + hat + torso shift one pixel between frames;
 *  shoes stay planted so it reads as "shifting weight," not "the whole figure
 *  slides." All rects are ≤ 2 wide and sit inside `[baseX, baseX+2]`, so the
 *  doorman never overpaints the tile's outer frame at the right edge. */
function drawDoorman(ctx: CanvasRenderingContext2D, baseX: number, feetY: number, anim: number): void {
  const swayRight = Math.floor(anim / 1.5) % 2 === 0;
  const bodyX = baseX + (swayRight ? 0 : 1);
  const feetX = baseX;
  const green = "#234b39";
  const hatDark = "#173324";
  const gold = "#c9a94c";
  ctx.fillStyle = hatDark; // hat cap (dark green so it reads distinct from the tunic)
  ctx.fillRect(bodyX, feetY - 9, 2, 1);
  ctx.fillStyle = "#e0c39b"; // head/face
  ctx.fillRect(bodyX, feetY - 8, 2, 2);
  ctx.fillStyle = green; // torso
  ctx.fillRect(bodyX, feetY - 6, 2, 4);
  ctx.fillStyle = gold; // collar/cuffs trim across the top of the torso
  ctx.fillRect(bodyX, feetY - 6, 2, 1);
  ctx.fillStyle = "#1a1512"; // shoes stay planted on the carpet
  ctx.fillRect(feetX, feetY - 2, 2, 2);
}

/**
 * The compact 1-tile grand entrance, used only when the lobby is too narrow to
 * fit the wide {@link drawGrandFacadeLeft} + {@link drawGrandFacadeRight} pair
 * (that is, on a 1-tile toy lobby). The same grand-hotel grammar compressed into
 * 11 pixels: sky, red awning, gold double doors, red carpet, one potted palm,
 * and the doorman. No reception (no room); the wide form is the primary one.
 */
export function drawGrandCompact(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const { ctx, lit, anim } = d;
  const R = makeFiller(ctx, x, y, 0);
  const fy = h - 6;
  const lc = Math.floor(w / 2); // local center column
  // Sky + skyline.
  R(0, 0, w, 10, lit ? "#2A3350" : "#AFC8DE");
  for (let bx = 0, bi = 0; bx < w; bx += 4, bi++) {
    const bh = 3 + ((bi * 3) % 4);
    R(bx, 10 - bh, 3, bh, lit ? "#1E2740" : "#7EA0C0");
    if (lit) R(bx + 1, 10 - bh + 1, 1, 1, "#F3D08A");
  }
  R(0, 10, w, 1, "#3A4658");
  // Gold cornice cap matching the concourse ceiling line (drawLobbyTile).
  R(0, 0, w, 3, "#C9A24B");
  R(0, 3, w, 1, "#8A7430");
  // Glass curtain wall.
  R(1, 11, w - 2, fy - 11, "#3A4658");
  R(2, 13, w - 4, fy - 14, lit ? "#243447" : "#8FB6C8");
  if (lit) R(2, fy - 7, w - 4, 6, "#C9A24B", 0.16);
  // Red scalloped awning + sign.
  R(0, 8, w, 3, "#9A2E38");
  R(0, 8, w, 1, "#B84450");
  for (let cx2 = 1; cx2 < w - 1; cx2 += 3) {
    R(cx2, 11, 2, 2, "#9A2E38");
    if (lit) R(cx2, 12, 1, 1, "#F3D08A");
  }
  R(lc - 1, 5, 2, 3, "#8A8E96");
  // Gold double doors (7 wide) with a warm halo at night.
  const doorL = lc - 3;
  const doorW = 7;
  const doorTopY = fy - 18;
  const doorH = 18;
  if (lit) R(doorL - 1, doorTopY - 1, doorW + 2, doorH + 2, "#FFE08A", 0.22);
  R(doorL, doorTopY, doorW, doorH, lit ? "#D8B24E" : "#C9A24B");
  R(doorL, doorTopY, doorW, 1, lit ? "#F0D878" : "#E8C860");
  R(lc, doorTopY, 1, doorH, "#8A6A2A"); // center split
  R(doorL, doorTopY, 1, doorH, "#8A6A2A");
  R(doorL + doorW - 1, doorTopY, 1, doorH, "#8A6A2A");
  R(lc - 2, fy - 9, 1, 2, "#8A6A2A"); // handles, mirrored about the center split
  R(lc + 2, fy - 9, 1, 2, "#8A6A2A");
  // Floor + red carpet.
  R(0, fy, w, h - fy, "#8A8478");
  R(lc - 3, fy, 7, h - fy, "#9A2E38");
  R(lc - 3, fy, 7, 1, "#B84450");
  // One compact potted palm tucked at the far left, sized to fit the tile so it
  // is not clipped off the left edge.
  R(0, fy - 3, 3, 3, "#5C4A38"); // pot (cols 0..2)
  R(0, fy - 3, 3, 1, "#6A5240"); // pot rim
  R(1, fy - 8, 1, 5, "#6A5240"); // trunk
  R(0, fy - 12, 3, 4, "#4E7A3E"); // fronds
  R(1, fy - 14, 1, 2, "#4E7A3E"); // top frond
  // Doorman on the carpet just right of the doors. lc + 3 keeps his 2px sway
  // frame inside the 11px tile (lc + 4 would clip his rightmost column at x=11).
  drawDoorman(ctx, Math.round(x + lc + 3), y + h - 4, anim);
}

/**
 * The service entrance at the opposite frontage edge. Keeps the concourse's
 * warm-lobby grammar so it reads as the same building, but swaps the glass
 * double-door language for a solid wood panel door with a small brass
 * "service" plate on the wall beside it and a potted plant next to the door.
 * No glow, no doorman, no reflection: staff-only, quiet, but with enough
 * ornament to feel like a real detail rather than a shrunken grand entrance.
 */
export function drawServiceEntrance(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number): void {
  // Door on the left half of the tile so the plant + plate can share the right
  // half. Same top / bottom rows as the grand door so the two entrances read
  // as living on the same ground plane.
  const doorTop = y + 6;
  const doorBot = y + h - 5;
  const frameL = x + 1;
  const frameR = x + 4;
  // Dark frame (jambs, header, sill) matches the grand entrance's frame color
  // so both doors clearly belong to the same building's carpentry.
  const frameColor = "#3a2a20";
  ctx.fillStyle = frameColor;
  ctx.fillRect(frameL, doorTop, frameR - frameL + 1, 1); // header
  ctx.fillRect(frameL, doorTop, 1, doorBot - doorTop); // left jamb
  ctx.fillRect(frameR, doorTop, 1, doorBot - doorTop); // right jamb
  ctx.fillRect(frameL, doorBot - 1, frameR - frameL + 1, 1); // sill
  // Solid wood panel: warm mid-brown door with two recessed panels and a
  // vertical grain line so it doesn't read as one flat rectangle.
  const wood = "#7a5230";
  const woodHi = "#8f6438";
  const woodLo = "#5c3d21";
  const panelL = frameL + 1;
  const panelR = frameR - 1;
  ctx.fillStyle = wood;
  ctx.fillRect(panelL, doorTop + 1, panelR - panelL + 1, doorBot - doorTop - 2);
  ctx.fillStyle = woodHi; // grain highlight
  ctx.fillRect(panelL, doorTop + 1, 1, doorBot - doorTop - 2);
  ctx.fillStyle = woodLo; // grain shadow
  ctx.fillRect(panelR, doorTop + 1, 1, doorBot - doorTop - 2);
  // Two recessed panels (upper + lower) so the door reads as a paneled wood
  // door instead of one flat plank.
  const panelInner = "#6a4525";
  const upperY = doorTop + 3;
  const lowerY = doorBot - 8;
  ctx.fillStyle = panelInner;
  ctx.fillRect(panelL, upperY, panelR - panelL + 1, 5);
  ctx.fillRect(panelL, lowerY, panelR - panelL + 1, 5);
  ctx.fillStyle = woodLo;
  ctx.fillRect(panelL, upperY, panelR - panelL + 1, 1);
  ctx.fillRect(panelL, lowerY, panelR - panelL + 1, 1);
  // Brass hinges: two small gold dots on the left jamb.
  const brass = "#caa94a";
  ctx.fillStyle = brass;
  ctx.fillRect(frameL, doorTop + 5, 1, 2);
  ctx.fillRect(frameL, doorBot - 6, 1, 2);
  // Doorknob on the right side, centered vertically on the panel.
  const knobY = Math.floor((doorTop + doorBot) / 2) - 1;
  ctx.fillRect(panelR, knobY, 1, 1);
  // Brass "service" plate on the wall to the right of the door: a small gold
  // plaque with three darker etch lines standing in for lettering at this
  // pixel scale. The eye reads the shape as a signage plate, not text.
  const plateL = x + 6;
  const plateT = y + 12;
  const plateW = 4;
  const plateH = 4;
  ctx.fillStyle = brass;
  ctx.fillRect(plateL, plateT, plateW, plateH);
  ctx.fillStyle = "#8a7430"; // darker gold border for depth
  ctx.fillRect(plateL, plateT, plateW, 1);
  ctx.fillRect(plateL, plateT + plateH - 1, plateW, 1);
  ctx.fillStyle = "#5c4a1e"; // etched "lettering"
  ctx.fillRect(plateL + 1, plateT + 2, plateW - 2, 1);
  // Potted plant beside the door: brass/copper pot with a green shrub, the
  // same shrub language the sky-lobby planter uses so plants read as one
  // family across the concourse. Sits on the polished floor above the carpet.
  const potCx = x + 8;
  const potY = y + h - 9;
  ctx.fillStyle = "#8a6a30"; // brass pot
  ctx.fillRect(potCx - 2, potY, 5, 4);
  ctx.fillStyle = brass; // pot rim highlight
  ctx.fillRect(potCx - 2, potY, 5, 1);
  ctx.fillStyle = "#5c4a1e"; // pot base shadow
  ctx.fillRect(potCx - 2, potY + 3, 5, 1);
  ctx.fillStyle = "#567f46"; // shrub body
  ctx.beginPath();
  ctx.arc(potCx + 0.5, potY - 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6f9c58"; // shrub highlight leaf
  ctx.fillRect(potCx - 1, potY - 4, 2, 2);
}
