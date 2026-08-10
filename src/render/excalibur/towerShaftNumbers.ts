import { isElevatorKind } from "../../engine/facilities";
import { FLOOR, TILE } from "../scale";
import type { TowerEngine } from "./TowerEngine";

/**
 * Elevator floor numbers, drawn in SCREEN space at the display resolution by
 * the {@link TowerEngine} overlay (see towerOverlay.drawOverlay).
 *
 * They used to be baked into the shaft sprite, but that bitmap is cached at
 * logical size (quality 1 in towerReconcile) and upscaled nearest-neighbor (the
 * engine runs pixelArt with antialiasing off), so on a fractional device-pixel
 * ratio (2.625 on a Pixel 8a) the baked digits garbled: the outline separated
 * from the glyph and read as a doubled number on some floors. Drawn here as a
 * fresh fillText each frame, every digit is rasterized once at the final display
 * size, so it stays crisp at any zoom and DPR. The cost is per-frame work bounded
 * by the two culls below (readable-zoom gate, then visible floor band per shaft).
 */
export function drawShaftNumbers(engine: TowerEngine, ctx: CanvasRenderingContext2D): void {
  const z = engine.cam.zoom;
  const floorHpx = FLOOR * z;
  // Below this the digits are too small for the pixel font to read; drawing them
  // is just noise (and unbounded work), exactly as the baked labels were when
  // zoomed this far out. Return before save() so the save/restore stays balanced.
  if (floorHpx < 13) return;
  // Save/restore because this shares the overlay's 2D context with painters that
  // run after it (drawRuler draws its labels at x=3 assuming the default left
  // textAlign, drawRain strokes at its own lineWidth): leaving textAlign,
  // textBaseline, lineJoin, miterLimit or lineWidth dirty would corrupt them.
  ctx.save();
  const fontPx = Math.max(8, Math.round(8 * z));
  ctx.font = `bold ${fontPx}px "MS Sans Serif", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, Math.round(fontPx / 4));
  // Visible floor band (screenToFloor(0) is the topmost visible floor, larger
  // than the bottom; both are integers via Math.ceil), matching drawStatsMap.
  const topFloor = engine.screenToFloor(0) + 1;
  const botFloor = engine.screenToFloor(engine.viewHeight) - 1;
  for (const t of engine.sim.tower.transports) {
    if (!isElevatorKind(t.kind)) continue;
    const shaftWpx = t.width * TILE * z;
    if (shaftWpx < 9) continue; // shaft too thin to fit a number
    const cx = engine.worldToScreenX(t.x + t.width / 2);
    // cx is the shaft CENTER, so half the shaft width is the exact off-screen
    // margin; a full width kept processing shafts up to a width past either edge.
    const halfW = shaftWpx / 2;
    if (cx < -halfW || cx > engine.viewWidth + halfW) continue; // off-screen left/right
    const skip = t.skipFloors && t.skipFloors.length ? new Set(t.skipFloors) : null;
    // Floors a car currently sits over, precomputed once per shaft (O(cars)) so
    // the floor loop stays O(1) per floor instead of scanning every car. The car
    // rides over the shaft numbers in the original, so its floor shows no digit;
    // rounding the continuous position hides the nearest floor (and, at a
    // mid-transit half-step, the one the cab has mostly reached).
    const covered = t.carPositions?.length ? new Set(t.carPositions.map((cp) => Math.round(cp))) : null;
    const lo = Math.max(t.bottom, botFloor);
    const hi = Math.min(t.top, topFloor);
    for (let num = lo; num <= hi; num++) {
      if (skip && skip.has(num)) continue; // express: not a stop, no number
      if (covered && covered.has(num)) continue; // a cab is over this floor
      const cy = engine.worldToScreenY(num) + floorHpx / 2;
      const label = num >= 1 ? String(num) : `B${1 - num}`;
      // A dark outline (stroke) then a near-white fill, both on the same path so
      // they rasterize together. At screen resolution this reads on any shaft
      // tint without the baked-bitmap ghosting the drop-shadow used to cause.
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(label, cx, cy);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(label, cx, cy);
    }
  }
  ctx.restore();
}
