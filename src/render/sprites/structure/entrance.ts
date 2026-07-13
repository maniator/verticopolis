import type { DrawCtx } from "../common";

/**
 * The ground-floor grand and service entrance facades: the wide two-tile
 * storefront (left + right slices), the compact one-tile fallback, the doorman,
 * and the quiet service door. Extracted verbatim from `structure.ts`. Imported
 * by `lobby.ts`, whose `drawLobbyTile` dispatches the entrance-variant tiles
 * here.
 */

/**
 * Left slice of the wide 2-tile grand entrance. This slice is a floor-to-cornice
 * glass storefront display window: interior visible through the glass, with the
 * lobby's chandelier hanging in the top area and a glimpse of the red carpet at
 * the bottom. The door itself lives in the right slice; here we paint only the
 * glass panel and the left storefront frame.
 *
 * This slice + the right slice compose a 22-pixel-wide facade. Instead of a
 * door painted on the interior wall (which reads as an interior door), the
 * whole two-tile section reads as the tower's street-facing storefront, with
 * the interior seen through big display windows. Sally's storefront reframe;
 * Samus's wayfinding beat.
 */
export function drawGrandFacadeLeft(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  drawGrandStorefrontShared(d, x, y, w, h, "left");
}

/**
 * Right slice of the wide 2-tile grand entrance: the double doors at the
 * boundary with the left slice, a smaller glass panel showing the doorman
 * standing inside on the carpet, and the right storefront frame. The doorman
 * carries a two-frame idle sway keyed to `d.anim`, so this slice draws every
 * frame (see the cache-false bake in TowerEngine).
 */
export function drawGrandFacadeRight(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  drawGrandStorefrontShared(d, x, y, w, h, "right");
}

/**
 * The shared skeleton of both wide-facade slices: cornice, storefront frame
 * top/bottom rails, kickplate, floor + carpet. Then dispatches the slice-
 * specific interior (chandelier display window for left, double doors +
 * doorman for right). Sharing the skeleton keeps the two slices lined up
 * pixel-for-pixel at the join, which is the whole point of the split.
 */
function drawGrandStorefrontShared(d: DrawCtx, x: number, y: number, w: number, h: number, side: "left" | "right"): void {
  const { ctx, lit } = d;
  // Storefront body extents. Both slices use the same rails so the two 11-wide
  // canvases compose into one continuous 22-wide facade.
  const railTop = y + 3;
  const railBot = y + h - 5; // meets the polished floor's top row (see drawLobbyTile)
  const frameColor = "#3a2a20";
  const kickColor = "#7a5e33";
  const goldTrim = "#c9a94c";
  // Gilded cornice (matches the concourse's other tiles so the top line reads
  // as one continuous ceiling across the whole lobby).
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = "#8a7430";
  ctx.fillRect(x, y + 2, w, 1);
  // Storefront top rail (dark metal), full width.
  ctx.fillStyle = frameColor;
  ctx.fillRect(x, railTop, w, 1);
  // Kickplate under the glass, meeting the floor.
  ctx.fillStyle = kickColor;
  ctx.fillRect(x, railBot - 2, w, 2);
  // Polished floor + red carpet (same as the base ground lobby tile so the
  // entrance blends into the concourse's floor line without a seam).
  ctx.fillStyle = "#c9b177";
  ctx.fillRect(x, y + h - 5, w, 5);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(x, y + h - 5, w, 1);
  ctx.fillStyle = "#8f7a48";
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillStyle = "#a3243c"; // red carpet stripe
  ctx.fillRect(x, y + h - 4, w, 3);
  ctx.fillStyle = "#d9b356"; // carpet gold edge
  ctx.fillRect(x, y + h - 5, w, 1);
  // Warm interior background visible through the glass. Brightens at night so
  // the whole storefront reads as a hot rectangle of light after dark.
  const glassTop = railTop + 1;
  const glassBot = railBot - 2;
  const interior = ctx.createLinearGradient(0, glassTop, 0, glassBot);
  if (lit) {
    interior.addColorStop(0, "#fff2c2");
    interior.addColorStop(1, "#f0d68a");
  } else {
    interior.addColorStop(0, "#f8f1dc");
    interior.addColorStop(1, "#e3d7b3");
  }
  ctx.fillStyle = interior;
  ctx.fillRect(x, glassTop, w, glassBot - glassTop);
  // Interior carpet visible through the very bottom of the glass, so the
  // carpet visually continues from outside the doors right through the display
  // window (a signature grand-hotel beat).
  ctx.fillStyle = "#a3243c";
  ctx.fillRect(x, glassBot - 2, w, 2);
  if (side === "left") {
    drawGrandFacadeLeftInterior(d, x, y, w, glassTop, glassBot, frameColor, goldTrim);
  } else {
    drawGrandFacadeRightInterior(d, x, y, w, h, glassTop, glassBot, frameColor, goldTrim);
  }
}

/** The LEFT slice's decoration: outer storefront frame at x=0, big glass panel
 *  with a chandelier hanging inside, and a slim door jamb at the RIGHT edge
 *  (which composes with the right slice's door leaf into one full-height door
 *  boundary). No door leaf on this slice; the doors start in the right slice. */
function drawGrandFacadeLeftInterior(
  d: DrawCtx,
  x: number,
  y: number,
  w: number,
  glassTop: number,
  glassBot: number,
  frameColor: string,
  goldTrim: string,
): void {
  const { ctx, lit } = d;
  // Outer storefront frame post along the LEFT edge of the tile.
  ctx.fillStyle = frameColor;
  ctx.fillRect(x, glassTop, 1, glassBot - glassTop);
  // Chandelier visible through the glass, centered in the display window.
  const cx = x + Math.floor(w / 2);
  ctx.fillStyle = "#8a7430";
  ctx.fillRect(cx, y + 5, 1, 3); // chain
  ctx.fillStyle = lit ? "#ffd76b" : "#c8a343";
  ctx.fillRect(cx - 2, y + 8, 5, 2);
  ctx.fillRect(cx - 3, y + 11, 7, 2);
  ctx.fillStyle = lit ? "#fff1b0" : "#a3873a";
  for (const dx of [-3, 0, 3]) ctx.fillRect(cx + dx, y + 10, 1, 1);
  if (lit) {
    ctx.fillStyle = "rgba(255,214,110,0.28)";
    ctx.beginPath();
    ctx.arc(cx + 0.5, y + 11, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Gold horizontal accent rail across the display window (a decorative brass
  // bar, like real hotel storefronts have running under the window at head
  // height). Ties the two slices together visually.
  ctx.fillStyle = goldTrim;
  ctx.fillRect(x + 1, glassTop + 12, w - 1, 1);
  // Door jamb along the RIGHT edge of the tile: this is where the double doors
  // start. The doors' left leaf lives in the right slice starting at x=1.
  ctx.fillStyle = frameColor;
  ctx.fillRect(x + w - 1, glassTop, 1, glassBot - glassTop);
}

/** The RIGHT slice's decoration: door jamb continues from the left slice, then
 *  the double doors with a gold split rail, then a smaller glass panel showing
 *  the doorman, then the right outer frame. The doors get their own brighter
 *  glow to signal the actual entrance opening. */
function drawGrandFacadeRightInterior(
  d: DrawCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  glassTop: number,
  glassBot: number,
  frameColor: string,
  goldTrim: string,
): void {
  const { ctx, lit, anim } = d;
  // Door left leaf: x=0..2 (the door jamb from the left slice continues at
  // world x=w-1 of that slice, and here we start with the door leaf itself).
  const doorLeftL = x + 0;
  const splitX = x + 3;
  const doorRightR = x + 5;
  const doorJambR = x + 6;
  const glassPanelL = x + 7;
  const glassPanelR = x + w - 1;
  const outerFrame = x + w - 1;
  // A brighter glow BEHIND the doors so the entrance opening reads hotter than
  // the display windows either side (that hierarchy is the whole wayfinding
  // beat).
  const doorGlow = ctx.createLinearGradient(0, glassTop, 0, glassBot);
  if (lit) {
    doorGlow.addColorStop(0, "#fff6d4");
    doorGlow.addColorStop(1, "#ffe08a");
  } else {
    doorGlow.addColorStop(0, "#fff2c2");
    doorGlow.addColorStop(1, "#f0d68a");
  }
  ctx.fillStyle = doorGlow;
  ctx.fillRect(doorLeftL, glassTop, doorRightR - doorLeftL + 1, glassBot - glassTop);
  // Gold split rail between the two door leaves.
  ctx.fillStyle = goldTrim;
  ctx.fillRect(splitX, glassTop, 1, glassBot - glassTop);
  // Door jambs / frame between doors and glass.
  ctx.fillStyle = frameColor;
  ctx.fillRect(doorJambR, glassTop, 1, glassBot - glassTop);
  // Kickplates at the base of each door leaf so the doors don't dissolve into
  // the carpet at play zoom.
  ctx.fillStyle = "#7a5e33";
  ctx.fillRect(doorLeftL, glassBot - 4, doorRightR - doorLeftL + 1, 2);
  // Right glass panel showing the interior with the doorman.
  ctx.fillStyle = frameColor;
  ctx.fillRect(outerFrame, glassTop, 1, glassBot - glassTop);
  // Gold accent rail matching the left slice, so the two windows read as
  // one continuous display band.
  ctx.fillStyle = goldTrim;
  ctx.fillRect(glassPanelL, glassTop + 12, glassPanelR - glassPanelL, 1);
  // The doorman: 2-frame idle sway on a 3-second cycle keyed to `d.anim`, so
  // this slice bakes with cache: false. Positioned inside the right glass
  // panel, standing on the carpet visible through the window. Green tunic and
  // gold trim echo the marquee overhead.
  drawDoorman(ctx, glassPanelL, y + h - 4, anim);
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
 * The compact 1-tile grand entrance, used only when the lobby is too narrow
 * to fit the wide {@link drawGrandFacadeLeft} + {@link drawGrandFacadeRight}
 * pair (that is, on a 1-tile toy lobby). Compressed door, glow and doorman
 * into an 11-pixel-wide sprite; the wide storefront is the primary form and
 * what most towers show.
 */
export function drawGrandCompact(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const { ctx, lit, anim } = d;
  // Door well: y from just under the wainscot down to the top of the polished
  // floor. `doorBot` MUST land on the same row the base tile's floor starts
  // (`y + h - 5`, see drawLobbyTile), so the door sill visually rests on the
  // floor. A one-pixel gap here makes the door look like it floats above the
  // ground with a strip of marble showing through underneath.
  const doorTop = y + 6;
  const doorBot = y + h - 5;
  const cxi = x + Math.floor(w / 2);
  // Interior glow, wider than the door, so the light "spills" onto the frame
  // and the wall. Warm and subtle by day, hot and bright after dark: this is
  // the wayfinding beat that anchors the eye on the frontage after sunset.
  const glowGrad = ctx.createLinearGradient(0, doorTop, 0, doorBot);
  if (lit) {
    glowGrad.addColorStop(0, "rgba(255,224,138,0.45)");
    glowGrad.addColorStop(1, "rgba(255,214,110,0.28)");
  } else {
    glowGrad.addColorStop(0, "rgba(247,227,168,0.22)");
    glowGrad.addColorStop(1, "rgba(247,227,168,0.10)");
  }
  ctx.fillStyle = glowGrad;
  ctx.fillRect(cxi - 4, doorTop, 9, doorBot - doorTop);
  // Dark door frame, 5 px wide centered on the tile.
  const frameL = cxi - 2;
  const frameR = cxi + 2;
  ctx.fillStyle = "#3a2a20";
  ctx.fillRect(frameL, doorTop, frameR - frameL + 1, 1); // header
  ctx.fillRect(frameL, doorTop, 1, doorBot - doorTop); // left jamb
  ctx.fillRect(frameR, doorTop, 1, doorBot - doorTop); // right jamb
  ctx.fillRect(frameL, doorBot - 1, frameR - frameL + 1, 1); // sill
  // Glass panels: the brighter interior showing through. Two panels split by
  // a gilded center rail so the eye reads a double door, not a window.
  const glassL = frameL + 1;
  const glassR = frameR - 1;
  const glassTop = doorTop + 1;
  const glassBot = doorBot - 1;
  const glassGrad = ctx.createLinearGradient(0, glassTop, 0, glassBot);
  if (lit) {
    glassGrad.addColorStop(0, "#fff2c2");
    glassGrad.addColorStop(1, "#f0d68a");
  } else {
    glassGrad.addColorStop(0, "#eef2f7");
    glassGrad.addColorStop(1, "#d6dee9");
  }
  ctx.fillStyle = glassGrad;
  ctx.fillRect(glassL, glassTop, glassR - glassL + 1, glassBot - glassTop);
  ctx.fillStyle = "#c9a94c"; // gilded center split
  ctx.fillRect(cxi, glassTop, 1, glassBot - glassTop);
  // Kickplate at the base of each door leaf so the doors don't melt into the
  // carpet at play zoom.
  ctx.fillStyle = "#7a5e33";
  ctx.fillRect(glassL, glassBot - 2, glassR - glassL + 1, 2);
  // Red carpet accent: bump the interior carpet color one pixel higher right
  // at the base of the doors, so the carpet visibly meets the threshold.
  ctx.fillStyle = "#a3243c";
  ctx.fillRect(glassL - 1, y + h - 5, glassR - glassL + 3, 1);
  // Doorman just outside the right jamb, sharing the wide grand's recipe so
  // both forms feel like the same figure. baseX = frameR + 1 puts him one
  // pixel outside the door frame, and drawDoorman's 2-wide sprite fits inside
  // the remaining 3 pixels of tile without clipping on either sway frame.
  drawDoorman(ctx, frameR + 1, y + h - 4, anim);
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
