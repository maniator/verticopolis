/**
 * The tower's exterior-facade family: the rooftop tower crane, the exterior
 * fire-escape stairs that clad the floors, and the ground-floor entrance
 * awning. Extracted from `structure.ts` (and since grown the crane scale
 * constants); all pure ctx-only draws.
 */

/** The hand-tuned base raster of the crane drawing (every coordinate in
 *  drawCrane is authored against this grid; scale, never retune). */
const CRANE_BASE_W = 128;
const CRANE_BASE_H = 76;
/** How much the base raster is blown up when rendered. The base crane stands
 *  1.7 floors tall, which reads fine against an empty sky but collapses next
 *  to the city skyline (10-36 floor buildings) and the street-level plaza:
 *  a real tower crane rises 4-8 floors above the roof it builds. The scale
 *  keeps the crane a fixed size (it never grows with the tower; the skyline
 *  only calibrates the scene if everything obeys it). */
export const CRANE_SCALE = 3;
/** Canvas size of the rooftop tower-crane graphic (scaled). */
export const CRANE_W = CRANE_BASE_W * CRANE_SCALE;
export const CRANE_H = CRANE_BASE_H * CRANE_SCALE;

/**
 * Where to perch the rooftop crane along the top floor, in world-tile units
 * (the mid-tile of the widest run of built tiles). Anchoring to the plain
 * (min,max) midpoint floats the crane over open sky when the top floor is
 * built in disjoint blocks (a setback, or a partly-leased top office row),
 * because the midpoint then lands in the gap between blocks. Centering on the
 * widest CONTIGUOUS run keeps the crane over actual structure; for a
 * fully-built row the widest run IS the whole span, so the result is the same
 * midpoint as before. Ties keep the leftmost run. `builtTiles` must be
 * non-empty (callers only invoke this for a floor that has structure); it may
 * repeat indices; duplicates are collapsed so a repeated tile can't be read
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
 * beacon blinks at the apex after dark, all on the decorative clock, so
 * pause/reduced-motion freezes it with everything else.
 */
export function drawCrane(ctx: CanvasRenderingContext2D, t: number, lit: boolean): void {
  // Every coordinate below is authored on the 128x76 base grid; the scale
  // transform blows the whole drawing up uniformly, line widths included. An
  // INTEGER scale keeps every edge on the pixel grid (fully chunky-crisp); a
  // fractional scale like 2.5 lands odd base coordinates on half-pixels,
  // which Canvas2D anti-aliases into the cached raster, a slight softness
  // accepted knowingly when the owner picks a non-integer size (the engine
  // renders pixelArt, so integer scales are preferred when the size works).
  ctx.save();
  ctx.scale(CRANE_SCALE, CRANE_SCALE);
  const baseY = CRANE_BASE_H; // canvas bottom sits on the roof line
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
  const jibEnd = CRANE_BASE_W - 4;
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
  const drop = 10 + (Math.sin(t * 0.27 + 2.1) * 0.5 + 0.5) * (CRANE_BASE_H - jibY - 28);
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
  ctx.restore();
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
