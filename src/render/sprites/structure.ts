import type { Unit } from "../../engine/types";
import type { DrawCtx } from "./common";

// ---- Structure ----------------------------------------------------------

export function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#8c8676";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#9b9685";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = "#6f6a5c";
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let gx = x; gx < x + w; gx += 9) ctx.fillRect(gx, y + 2, 1, h - 5);
}

/** The lobby pattern repeats on this many structural tiles: column, plain,
 *  centerpiece (chandelier / planter), plain. The engine bakes one shared
 *  graphic per variant and picks by {@link lobbyVariant}, so adjacent tiles
 *  always line up into one continuous concourse. */
export const LOBBY_VARIANTS = 4;

/** Which pattern slot a lobby tile at grid x occupies. Defense-in-depth on
 *  top of deserialize's geometry clamps: a fractional, negative or non-finite
 *  x from any other caller (previews, tools, future fake units) still lands
 *  on a real variant instead of indexing the engine's baked-graphics array
 *  out of bounds. */
export function lobbyVariant(x: number): number {
  const t = Math.trunc(Number.isFinite(x) ? x : 0) % LOBBY_VARIANTS;
  return t < 0 ? t + LOBBY_VARIANTS : t;
}

/** Sentinel "variant" for the left half of the wide grand entrance: the
 *  left storefront display window. Outside the {@link LOBBY_VARIANTS} range
 *  so the engine can address it distinctly from the repeating cycle. */
export const ENTRANCE_GRAND_LEFT = LOBBY_VARIANTS;
/** Sentinel "variant" for the right half of the wide grand entrance: the
 *  doors + doorman + right display window. */
export const ENTRANCE_GRAND_RIGHT = LOBBY_VARIANTS + 1;
/** Sentinel "variant" for the compact 1-tile grand entrance, used as the
 *  narrow-lobby fallback when the lobby is too narrow to fit the wide 2-tile
 *  storefront. */
export const ENTRANCE_GRAND_SOLO = LOBBY_VARIANTS + 2;
/** Sentinel "variant" for the quiet service entrance at the opposite frontage
 *  edge. Same-shape door as the grand tile, no glow, no doorman. */
export const ENTRANCE_SERVICE = LOBBY_VARIANTS + 3;

/** Bake-target entry point for the ground-floor entrance tiles. `lobbyVariant`
 *  never returns the sentinel variants (they're outside its 0..LOBBY_VARIANTS
 *  cycle), so the engine bakes the entrance tiles by calling this directly.
 *
 *  `grand-left` / `grand-right` are the two 11-wide slices of the wide 2-tile
 *  storefront (glass display window with chandelier + double doors + doorman
 *  visible through the right window). `grand-solo` is the compact 1-tile
 *  fallback for lobbies too narrow to fit the wide version. `service` is the
 *  quiet mirrored door at the opposite frontage edge. */
export type EntranceKind = "grand-left" | "grand-right" | "grand-solo" | "service";
export function drawLobbyEntrance(
  d: DrawCtx,
  kind: EntranceKind,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const v =
    kind === "grand-left"
      ? ENTRANCE_GRAND_LEFT
      : kind === "grand-right"
        ? ENTRANCE_GRAND_RIGHT
        : kind === "grand-solo"
          ? ENTRANCE_GRAND_SOLO
          : ENTRANCE_SERVICE;
  drawLobbyTile(d, x, y, w, h, v, true);
}

export function drawLobby(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number) {
  // One pattern slice per structural tile of the unit, scaled to whatever the
  // caller renders a tile as (the engine bakes at TILE px; the gallery draws
  // bigger). Keyed by absolute tile x so runs stay aligned however sliced.
  // The slice count is capped by the pixel span so a forged width can't turn
  // this into a near-endless loop (deserialize clamps width too — second belt).
  const tiles = Math.max(1, Math.min(Math.round(u.width) || 1, Math.ceil(w)));
  const pitch = w / tiles;
  for (let t = 0; t < tiles; t++) {
    const x0 = x + t * pitch;
    const tw = t === tiles - 1 ? x + w - x0 : pitch;
    drawLobbyTile(d, x0, y, tw, h, lobbyVariant(u.x + t), u.floor === 1);
  }
}

/**
 * One 11px slice of the lobby concourse. The ground lobby (floor 1) is the
 * tower's grand entrance — warm marble, gilded cornice, red carpet, fluted
 * columns and chandeliers that glow in the evening. Sky lobbies read as their
 * cooler, airier cousins: pale stone, planters and framed art instead of
 * chandeliers, same gold trim so they still read as "lobby" at a glance.
 */
function drawLobbyTile(d: DrawCtx, x: number, y: number, w: number, h: number, variant: number, ground: boolean) {
  const { ctx, lit } = d;
  // Back wall: warm marble downstairs, cool stone up in the sky lobbies.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, ground ? "#f8f1dc" : "#eef2f7");
  g.addColorStop(1, ground ? "#e3d7b3" : "#d6dee9");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Wainscot line so the wall reads paneled, not flat.
  ctx.fillStyle = ground ? "rgba(120,100,60,0.16)" : "rgba(70,90,115,0.14)";
  ctx.fillRect(x, y + 19, w, 1);
  // Gilded cornice along the ceiling.
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = "#8a7430";
  ctx.fillRect(x, y + 2, w, 1);
  // Polished floor with a sheen line.
  ctx.fillStyle = ground ? "#c9b177" : "#b3bfcd";
  ctx.fillRect(x, y + h - 5, w, 5);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(x, y + h - 5, w, 1);
  ctx.fillStyle = ground ? "#8f7a48" : "#8794a4";
  ctx.fillRect(x, y + h - 1, w, 1);
  if (ground) {
    // Red carpet with gold edging, running the whole concourse.
    ctx.fillStyle = "#a3243c";
    ctx.fillRect(x, y + h - 4, w, 3);
    ctx.fillStyle = "#d9b356";
    ctx.fillRect(x, y + h - 5, w, 1);
  }

  // Decorations center on the slice and stay inside it, whatever the caller's
  // tile scale — in-engine each slice is its own 11px baked canvas, so anything
  // painted past the edge would be clipped into a visible seam.
  const cx = x + Math.floor(w / 2);
  if (variant === 0) {
    // Fluted column, cornice to floor, with gold capital and base.
    ctx.fillStyle = ground ? "#f1e8ce" : "#e4eaf2";
    ctx.fillRect(cx - 1, y + 5, 3, h - 12);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(cx - 1, y + 5, 1, h - 12);
    ctx.fillStyle = ground ? "rgba(105,90,55,0.4)" : "rgba(70,85,110,0.4)";
    ctx.fillRect(cx + 1, y + 5, 1, h - 12);
    ctx.fillStyle = "#caa84a";
    ctx.fillRect(cx - 2, y + 3, 5, 2);
    ctx.fillRect(cx - 2, y + h - 7, 5, 2);
  } else if (variant === 2 && ground) {
    // Chandelier — gold tiers on a chain, aglow after dark.
    ctx.fillStyle = "#8a7430";
    ctx.fillRect(cx, y + 3, 1, 3);
    ctx.fillStyle = lit ? "#ffd76b" : "#c8a343";
    ctx.fillRect(cx - 2, y + 6, 5, 2);
    ctx.fillRect(cx - 3, y + 9, 7, 2);
    ctx.fillStyle = lit ? "#fff1b0" : "#a3873a";
    for (const dx of [-3, 0, 3]) ctx.fillRect(cx + dx, y + 8, 1, 1);
    if (lit) {
      ctx.fillStyle = "rgba(255,214,110,0.28)";
      ctx.beginPath();
      ctx.arc(cx + 0.5, y + 9, Math.min(6.5, w / 2 - 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (variant === 2) {
    // Sky-lobby planter: a potted shrub instead of a chandelier.
    ctx.fillStyle = "#7c8798";
    ctx.fillRect(cx - 2, y + h - 9, 5, 4);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cx - 2, y + h - 9, 5, 1);
    ctx.fillStyle = "#567f46";
    ctx.beginPath();
    ctx.arc(cx + 0.5, y + h - 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6f9c58";
    ctx.fillRect(cx - 1, y + h - 13, 2, 2);
  } else if (variant === 3) {
    if (ground) {
      // Wall sconce, warm when the evening lights come on.
      ctx.fillStyle = "#caa84a";
      ctx.fillRect(cx - 1, y + 12, 3, 1);
      ctx.fillStyle = lit ? "#ffe9a0" : "#b5924a";
      ctx.fillRect(cx, y + 10, 1, 2);
    } else {
      // Framed print between the sky-lobby windows.
      ctx.fillStyle = "#8a7430";
      ctx.fillRect(cx - 2, y + 9, 5, 7);
      ctx.fillStyle = "#b9cadb";
      ctx.fillRect(cx - 1, y + 10, 3, 5);
      ctx.fillStyle = "#5d7a95";
      ctx.fillRect(cx - 1, y + 13, 3, 2);
    }
  } else if (variant === ENTRANCE_GRAND_LEFT && ground) {
    drawGrandFacadeLeft(d, x, y, w, h);
  } else if (variant === ENTRANCE_GRAND_RIGHT && ground) {
    drawGrandFacadeRight(d, x, y, w, h);
  } else if (variant === ENTRANCE_GRAND_SOLO && ground) {
    drawGrandCompact(d, x, y, w, h);
  } else if (variant === ENTRANCE_SERVICE && ground) {
    drawServiceEntrance(ctx, x, y, w, h);
  }
}

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
function drawGrandFacadeLeft(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  drawGrandStorefrontShared(d, x, y, w, h, "left");
}

/**
 * Right slice of the wide 2-tile grand entrance: the double doors at the
 * boundary with the left slice, a smaller glass panel showing the doorman
 * standing inside on the carpet, and the right storefront frame. The doorman
 * carries a two-frame idle sway keyed to `d.anim`, so this slice draws every
 * frame (see the cache-false bake in TowerEngine).
 */
function drawGrandFacadeRight(d: DrawCtx, x: number, y: number, w: number, h: number): void {
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
function drawGrandCompact(d: DrawCtx, x: number, y: number, w: number, h: number): void {
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
function drawServiceEntrance(ctx: CanvasRenderingContext2D, x: number, y: number, _w: number, h: number): void {
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
  // Doorknob on the right side.
  ctx.fillRect(panelR, y + Math.floor((doorTop + doorBot) / 2) - y - 1, 1, 1);
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

export function drawConstruction(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  // Bare concrete shell.
  ctx.fillStyle = "#6f6a5e";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#5c574c";
  ctx.fillRect(x, y, w, 2);
  // Yellow/black hazard band along the floor.
  for (let hx = x; hx < x + w; hx += 8) {
    ctx.fillStyle = (Math.floor(hx / 8) % 2) === 0 ? "#e8c14a" : "#2a2a2a";
    ctx.fillRect(hx, y + h - 4, 4, 4);
  }
  // Scaffolding poles and cross-braces.
  ctx.strokeStyle = "rgba(220,220,230,0.55)";
  ctx.lineWidth = 1;
  for (let sx = x + 6; sx < x + w - 2; sx += 14) {
    ctx.beginPath();
    ctx.moveTo(sx, y + 2);
    ctx.lineTo(sx, y + h - 4);
    ctx.moveTo(sx, y + h - 4);
    ctx.lineTo(sx + 14, y + 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(220,220,230,0.4)";
  ctx.beginPath();
  ctx.moveTo(x + 2, y + h / 2);
  ctx.lineTo(x + w - 2, y + h / 2);
  ctx.stroke();
  // A little crane hook swinging on the global clock.
  const hookX = x + 8 + (Math.sin(d.anim) * 0.5 + 0.5) * Math.max(0, w - 16);
  ctx.strokeStyle = "#caa84a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hookX, y - 2);
  ctx.lineTo(hookX, y + h * 0.4);
  ctx.stroke();
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(hookX - 2, y + h * 0.4, 4, 3);
}

/** Canvas size of the rooftop tower-crane graphic. */
export const CRANE_W = 128;
export const CRANE_H = 76;

/**
 * Where to perch the rooftop crane along the top floor, in world-tile units
 * (the mid-tile of the widest run of built tiles). Anchoring to the plain
 * (min,max) midpoint floats the crane over open sky when the top floor is
 * built in disjoint blocks — a setback, or a partly-leased top office row —
 * because the midpoint then lands in the gap between blocks. Centering on the
 * widest CONTIGUOUS run keeps the crane over actual structure; for a
 * fully-built row the widest run IS the whole span, so the result is the same
 * midpoint as before. Ties keep the leftmost run. `builtTiles` must be
 * non-empty (callers only invoke this for a floor that has structure); it may
 * repeat indices — duplicates are collapsed so a repeated tile can't be read
 * as a one-wide gap that splits a run.
 */
export function craneAnchorTile(builtTiles: Iterable<number>): number {
  const xs = [...new Set(builtTiles)].sort((a, b) => a - b);
  let bestStart = xs[0];
  let bestEnd = xs[0];
  let runStart = xs[0];
  for (let i = 1; i <= xs.length; i++) {
    // A break in the run (or the end of the list) closes the current run.
    if (i === xs.length || xs[i] !== xs[i - 1] + 1) {
      if (xs[i - 1] - runStart > bestEnd - bestStart) {
        bestStart = runStart;
        bestEnd = xs[i - 1];
      }
      if (i < xs.length) runStart = xs[i];
    }
  }
  // bestEnd is the last tile index (inclusive); its right edge is bestEnd + 1.
  return (bestStart + bestEnd + 1) / 2;
}

/**
 * The rooftop tower crane that crowns the build while the tower is still
 * climbing (it comes down once the 100th floor caps the tower, as in the
 * original). Drawn fresh each frame into a CRANE_W×CRANE_H rect: the trolley
 * rides the jib, the hook reels a girder up and down, and a red aircraft
 * beacon blinks at the apex after dark — all on the decorative clock, so
 * pause/reduced-motion freezes it with everything else.
 */
export function drawCrane(ctx: CanvasRenderingContext2D, t: number, lit: boolean): void {
  const baseY = CRANE_H; // canvas bottom sits on the roof line
  const mx = 56; // mast center
  const jibY = 18; // jib chord height
  const steel = "#e0a83c";
  const dark = "#9a6f1e";
  // Roof pad under the mast.
  ctx.fillStyle = "#6b6f78";
  ctx.fillRect(mx - 7, baseY - 3, 14, 3);
  // Lattice mast: two chords with X-bracing.
  ctx.fillStyle = steel;
  ctx.fillRect(mx - 3, jibY, 2, baseY - 3 - jibY);
  ctx.fillRect(mx + 1, jibY, 2, baseY - 3 - jibY);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let yy = jibY + 2; yy < baseY - 8; yy += 6) {
    ctx.moveTo(mx - 2, yy);
    ctx.lineTo(mx + 2, yy + 6);
    ctx.moveTo(mx + 2, yy);
    ctx.lineTo(mx - 2, yy + 6);
  }
  ctx.stroke();
  // Jib out to the right, counter-jib to the left.
  const jibEnd = CRANE_W - 4;
  const cjEnd = mx - 26;
  ctx.fillStyle = steel;
  ctx.fillRect(cjEnd, jibY, jibEnd - cjEnd, 2);
  ctx.fillRect(mx + 3, jibY + 4, jibEnd - mx - 6, 1);
  ctx.strokeStyle = dark;
  ctx.beginPath();
  for (let xx = mx + 6; xx < jibEnd - 4; xx += 7) {
    ctx.moveTo(xx, jibY + 2);
    ctx.lineTo(xx + 4, jibY + 4);
  }
  ctx.stroke();
  // Apex with tie bars holding both arms.
  ctx.fillStyle = steel;
  ctx.fillRect(mx - 1, jibY - 12, 2, 12);
  ctx.strokeStyle = steel;
  ctx.beginPath();
  ctx.moveTo(mx, jibY - 10);
  ctx.lineTo(jibEnd - 8, jibY);
  ctx.moveTo(mx, jibY - 10);
  ctx.lineTo(cjEnd + 3, jibY);
  ctx.stroke();
  // Counterweight block.
  ctx.fillStyle = "#7d838d";
  ctx.fillRect(cjEnd, jibY + 2, 7, 7);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(cjEnd, jibY + 2, 7, 1);
  // Operator cab, window lit in the evening.
  ctx.fillStyle = "#5a636e";
  ctx.fillRect(mx + 2, jibY + 2, 7, 6);
  ctx.fillStyle = lit ? "#ffe27a" : "#9fc0ff";
  ctx.fillRect(mx + 4, jibY + 3, 4, 3);
  // Trolley slides along the jib; the hook line reels a girder up and down.
  const span = jibEnd - (mx + 14) - 6;
  const trolleyX = mx + 14 + (Math.sin(t * 0.45) * 0.5 + 0.5) * span;
  const drop = 10 + (Math.sin(t * 0.27 + 2.1) * 0.5 + 0.5) * (CRANE_H - jibY - 28);
  ctx.fillStyle = dark;
  ctx.fillRect(trolleyX - 2, jibY + 4, 5, 3);
  ctx.strokeStyle = "#3c3f45";
  ctx.beginPath();
  ctx.moveTo(trolleyX + 0.5, jibY + 7);
  ctx.lineTo(trolleyX + 0.5, jibY + 7 + drop);
  ctx.stroke();
  ctx.fillStyle = "#d8dce2";
  ctx.fillRect(trolleyX - 1.5, jibY + 7 + drop, 4, 2);
  ctx.fillStyle = "#8f4f2f"; // the girder riding the hook
  ctx.fillRect(trolleyX - 6, jibY + 9 + drop, 13, 2);
  // Aircraft-warning beacon at the apex, blinking after dark.
  ctx.fillStyle = lit && Math.sin(t * 3.2) > 0 ? "#ff5a4a" : "#8a2f26";
  ctx.fillRect(mx - 1, jibY - 14, 2, 2);
}

/** Width in px of one exterior fire-escape segment. */
export const ESCAPE_W = 14;

/**
 * One floor-tall segment of the exterior escape stairs that cling to both
 * sides of the tower (a canon staple of the original's silhouette). `side` is
 * which outside wall it hangs off; the flight's diagonal flips with floor
 * parity so stacked segments read as one continuous zigzag down the facade.
 */
export function drawEscapeStairs(
  ctx: CanvasRenderingContext2D,
  side: "left" | "right",
  parity: 0 | 1,
  floorH: number,
): void {
  const w = ESCAPE_W;
  const rail = "#4e5866";
  const railHi = "#7b8694";
  // Outer support rail, hung clear of the wall.
  const outX = side === "left" ? 0 : w - 1;
  ctx.fillStyle = rail;
  ctx.fillRect(outX, 1, 1, floorH - 1);
  // Landing deck at the floor line, with guard rail above it.
  ctx.fillStyle = "#39414e";
  ctx.fillRect(0, floorH - 4, w, 3);
  ctx.fillStyle = railHi;
  ctx.fillRect(0, floorH - 4, w, 1);
  ctx.fillStyle = rail;
  ctx.fillRect(0, floorH - 12, w, 1);
  for (const px of [1, Math.floor(w / 2), w - 2]) ctx.fillRect(px, floorH - 12, 1, 8);
  // The flight itself, zigzagging with floor parity.
  const x0 = parity === 0 ? 1 : w - 2;
  const x1 = parity === 0 ? w - 2 : 1;
  ctx.strokeStyle = railHi;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, 2);
  ctx.lineTo(x1 + 0.5, floorH - 4);
  ctx.stroke();
  ctx.fillStyle = "#5d6875";
  const steps = 6;
  for (let s = 1; s < steps; s++) {
    const sx = x0 + ((x1 - x0) * s) / steps;
    const sy = 2 + ((floorH - 6) * s) / steps;
    ctx.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1);
  }
}

/** Width in px of one ground-floor entrance awning. Noticeably wider than a
 *  fire-escape segment ({@link ESCAPE_W}) so the canopy reads as a projecting
 *  storefront shade rather than a ladder rail. */
export const AWNING_W = 24;

/**
 * A prestige entrance marquee over the ground-floor frontage, standing in for
 * the fire escape on floor 1. Deep green with gilded trim so it reads as a grand
 * lobby canopy, not a storefront: the street level wears these instead of the
 * exterior stairs that clad the floors above, so we swap them in on the ground
 * row. `side` is the wall the canopy juts out from: it mounts flush to that wall
 * and slopes down and outward. Painted into a floor-tall canvas (only the upper
 * strip is used) so it shares the escape segment's top-left anchor and
 * edge-following geometry.
 */
export function drawAwning(ctx: CanvasRenderingContext2D, side: "left" | "right", floorH: number): void {
  const w = AWNING_W;
  ctx.save();
  // Draw in one canonical frame (wall at x = 0, canopy projecting right to
  // x = w), then mirror it for a left wall so both corners share the recipe.
  if (side === "left") {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  const topY = Math.round(floorH * 0.1); // just under the lobby cornice
  // A prestige marquee: a solid deep hunter-green canopy with gilded piping
  // and a scalloped arch fringe that echo the lobby's gold cornice, sconces
  // and chandeliers.
  const green = "#234b39";
  const greenHi = "#2f6149";
  const greenLo = "#173324";
  const gold = "#c9a94c";
  const goldHi = "#e6cf82";
  // How far the canopy top edge drops from the wall to the outer lip. Scaled to
  // the projection (a wider awning juts out and down more) so the slope stays
  // proportional at any width instead of flattening out.
  const topDrop = Math.round(w * 0.28);
  const bodyH = 8; // solid canopy thickness, filled top rail to fringe
  const archR = 3; // how far each scallop arch bulges below the body
  const archP = 6; // pixels per arch
  // The canopy is filled solid from the gilded top rail down to a bottom edge
  // that swings through a row of arches (a classic scalloped valance). Each
  // column drops to `arch`, the semicircular dip of the scallop it sits in;
  // dividing by `archP - 1` (not `archP`) forces each scallop to close back to
  // 0 on its rightmost column, so consecutive arches meet flush at 0 instead of
  // stair-stepping through a `~archR/2` seam.
  for (let cx = 0; cx < w; cx++) {
    const t = cx / (w - 1);
    const top = topY + Math.round(t * topDrop);
    const arch = Math.round(Math.sin((Math.PI * (cx % archP)) / (archP - 1)) * archR);
    const base = top + bodyH; // flat underside of the solid body
    const bottom = base + arch; // ...dipping through the scallop
    ctx.fillStyle = green; // solid fill
    ctx.fillRect(cx, top, 1, bottom - top);
    ctx.fillStyle = greenHi; // sheen just under the rail
    ctx.fillRect(cx, top + 1, 1, 1);
    ctx.fillStyle = greenLo; // shaded belly above the fringe
    ctx.fillRect(cx, base - 1, 1, 1);
    ctx.fillStyle = goldHi; // gilded top rail
    ctx.fillRect(cx, top, 1, 1);
    ctx.fillStyle = gold; // gilded edge tracing each arch
    ctx.fillRect(cx, bottom - 1, 1, 1);
  }
  // Gilded outer lip down the projecting edge, and a brass bracket bolting the
  // canopy to the wall.
  const lipTop = topY + topDrop;
  ctx.fillStyle = gold;
  ctx.fillRect(w - 1, lipTop, 1, bodyH);
  ctx.fillStyle = "#8a7430";
  ctx.fillRect(0, topY, 1, bodyH + topDrop);
  ctx.restore();
}

/** Charred interior behind the flames of a burning unit. */
export function drawBurntShell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#241c18";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3a2a20";
  ctx.fillRect(x, y + h - 4, w, 4);
  // Smoke smudges up the back wall.
  ctx.fillStyle = "rgba(20,16,14,0.55)";
  for (let sx = x + 3; sx < x + w - 2; sx += 11) ctx.fillRect(sx, y, 5, h - 4);
}

/** Animated flames licking up from the floor of a burning unit. */
export function drawFlames(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  const base = y + h - 3;
  for (let fx = x + 2; fx < x + w - 2; fx += 6) {
    const phase = d.anim * 6 + fx * 0.7;
    const flame = (Math.sin(phase) * 0.5 + 0.5) * (h * 0.55) + h * 0.3;
    // Outer orange tongue.
    ctx.fillStyle = "#e8631e";
    ctx.beginPath();
    ctx.moveTo(fx, base);
    ctx.lineTo(fx + 3, base - flame);
    ctx.lineTo(fx + 6, base);
    ctx.closePath();
    ctx.fill();
    // Inner yellow core.
    ctx.fillStyle = "#ffd23a";
    ctx.beginPath();
    ctx.moveTo(fx + 1.5, base);
    ctx.lineTo(fx + 3, base - flame * 0.6);
    ctx.lineTo(fx + 4.5, base);
    ctx.closePath();
    ctx.fill();
  }
  // Ember glow wash.
  ctx.fillStyle = "rgba(232,99,30,0.18)";
  ctx.fillRect(x, y, w, h);
}
