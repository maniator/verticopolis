import { rand } from "../common";

/**
 * The moving actors: the garbage truck, the parking-ramp sedans, and the
 * metro train. Each is drawn at local (0,0) into its own small canvas; the
 * engine slides the resulting Excalibur Actor along a track (see
 * `TowerEngine`). Enriched to the 1994 narrative board (art bible page 08):
 * integer pixel rects, warm livery, two-tone wheels.
 */

/** Jitter a hex anchor by at most 10 per RGB channel from a stable seed, the
 *  art-bible variant rule (color is support, geometry is the real variety). The
 *  result is an `rgb()` string near the anchor, so it never collides with a
 *  reserved state literal. */
function jitter(hex: string, seed: number): string {
  const n = parseInt(hex.slice(1), 16);
  const off = (k: number) => Math.round((rand(seed * 4 + k) * 2 - 1) * 10);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + off(1));
  const g = clamp(((n >> 8) & 255) + off(2));
  const b = clamp((n & 255) + off(3));
  return `rgb(${r},${g},${b})`;
}

/** The garbage truck that empties the recycling centers each morning: its own
 *  Excalibur Actor (like the metro train); the engine slides it along the
 *  center's bottom story during the collection hour. Drawn at (0,0) into w x 16. */
export function drawGarbageTruck(ctx: CanvasRenderingContext2D, w: number): void {
  const bodyW = w - 12;
  // Hopper body (municipal green) with a lighter top light and a body seam.
  ctx.fillStyle = "#4A7A44";
  ctx.fillRect(0, 2, bodyW, 10);
  ctx.fillStyle = "#6A9A5E"; // top light
  ctx.fillRect(0, 2, bodyW, 1);
  ctx.fillStyle = "#3A6236"; // darker ribs
  for (let rx = 3; rx < bodyW - 2; rx += 6) ctx.fillRect(rx, 4, 1, 7);
  ctx.fillStyle = "#2E5A2A"; // horizontal seam
  ctx.fillRect(0, 7, bodyW, 1);
  // Recycle-arrow badge: a light chasing-arrows triangle on the hopper side.
  const bx = Math.max(2, (bodyW >> 1) - 2);
  ctx.fillStyle = "#DCE8C0";
  ctx.fillRect(bx, 6, 5, 1); // base
  ctx.fillRect(bx + 1, 5, 1, 1); // left slope
  ctx.fillRect(bx + 3, 5, 1, 1); // right slope
  ctx.fillRect(bx + 2, 4, 1, 1); // apex
  // Cab (front, right-facing) with a windowed glint and a top highlight.
  ctx.fillStyle = "#5A8A54";
  ctx.fillRect(bodyW, 5, 10, 7);
  ctx.fillStyle = "#CFE4FF";
  ctx.fillRect(bodyW + 5, 6, 4, 3);
  ctx.fillStyle = "#E4F0FF";
  ctx.fillRect(bodyW + 5, 6, 4, 1);
  // Rear loader mouth, with a couple of bags waiting at it.
  ctx.fillStyle = "#3A5A36";
  ctx.fillRect(0, 6, 3, 6);
  ctx.fillStyle = "#7A8A64";
  ctx.fillRect(1, 10, 2, 2);
  ctx.fillRect(3, 9, 2, 2);
  // Two-tone wheels (tire + hub), integer rects (no arcs).
  for (const wx of [4, bodyW - 6, bodyW + 4]) {
    ctx.fillStyle = "#16181C";
    ctx.fillRect(wx - 1, 12, 3, 3);
    ctx.fillStyle = "#5A5E66";
    ctx.fillRect(wx, 13, 1, 1);
  }
}

/** A small sedan for the garage floors: its own Actor; the engine drives it
 *  along the parking run at commute hours. Drawn at (0,0) into 16 x 8. The body
 *  is anchored to a calm blue, jittered per seed (not a rainbow accent). */
export function drawStreetCar(ctx: CanvasRenderingContext2D, seed: number): void {
  const body = jitter("#4E7A9E", seed);
  const roof = jitter("#3E6486", seed + 17);
  ctx.fillStyle = body; // lower body / chassis
  ctx.fillRect(1, 3, 14, 3);
  ctx.fillStyle = roof; // cabin roof
  ctx.fillRect(4, 0, 8, 3);
  ctx.fillStyle = "#CFE4FF"; // two windows
  ctx.fillRect(5, 1, 2, 2);
  ctx.fillRect(8, 1, 2, 2);
  ctx.fillStyle = "#16181C"; // dark tires
  ctx.fillRect(3, 6, 3, 2);
  ctx.fillRect(11, 6, 3, 2);
  ctx.fillStyle = "#FFE27A"; // front headlight
  ctx.fillRect(14, 3, 1, 2);
}

/** The subway carriage graphic, drawn at (0,0) into a w x 9 rect. It is its own
 *  Excalibur Actor; the engine slides it in and out along the platform. */
export function drawMetroTrain(ctx: CanvasRenderingContext2D, w: number, headlightOn: boolean): void {
  ctx.fillStyle = "#C6CCD4"; // silver carriage
  ctx.fillRect(0, 0, w, 9);
  ctx.fillStyle = "#E0E6EC"; // top highlight
  ctx.fillRect(0, 0, w, 1);
  ctx.fillStyle = "#D0392B"; // red livery stripe
  ctx.fillRect(0, 6, w, 2);
  ctx.fillStyle = "#E85D4A"; // lighter livery highlight
  ctx.fillRect(0, 6, w, 1);
  for (let wx = 4; wx + 5 < w; wx += 9) {
    ctx.fillStyle = "#2A3440"; // lit window band
    ctx.fillRect(wx, 2, 5, 3);
    ctx.fillStyle = "#9FC0E0"; // glass glint
    ctx.fillRect(wx, 2, 2, 1);
  }
  ctx.fillStyle = headlightOn ? "#FFE27A" : "#9FC0E0"; // headlight, keyed on state
  ctx.fillRect(1, 3, 2, 2);
}
