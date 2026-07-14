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

/** Height of the garbage truck, in px. Sized to fill most of the recycling
 *  center's bottom story (a 44px floor) so it reads as a hulking municipal
 *  truck, far taller than the 24px crowd figures, rather than a toy. The body,
 *  cab, and wheel rows scale their vertical extents off this height (a few
 *  details stay fixed, e.g. the 7px wheels and the 16px cab width), so the
 *  truck grows largely as one piece if the height is retuned. */
export const GARBAGE_TRUCK_H = 42;

/** The garbage truck that empties the recycling centers each morning: its own
 *  Excalibur Actor (like the metro train); the engine slides it along the
 *  center's bottom story during the collection hour. Drawn at (0,0) into
 *  w x GARBAGE_TRUCK_H. */
export function drawGarbageTruck(ctx: CanvasRenderingContext2D, w: number): void {
  const H = GARBAGE_TRUCK_H;
  const wheel = 7; // tire size in px
  const axleY = H - wheel; // wheels sit on the bottom `wheel` rows
  const bodyTop = 4;
  const bodyH = axleY - bodyTop; // hopper spans from the lid line to the axle
  const bodyW = w - 16; // the cab takes the front 16px (right side)
  // Hopper body (municipal green) with a lighter top light and a body seam.
  ctx.fillStyle = "#4A7A44";
  ctx.fillRect(0, bodyTop, bodyW, bodyH);
  ctx.fillStyle = "#6A9A5E"; // top light
  ctx.fillRect(0, bodyTop, bodyW, 3);
  ctx.fillStyle = "#3A6236"; // darker ribs
  for (let rx = 4; rx < bodyW - 2; rx += 8) ctx.fillRect(rx, bodyTop + 3, 1, bodyH - 5);
  ctx.fillStyle = "#2E5A2A"; // horizontal seam
  ctx.fillRect(0, bodyTop + Math.round(bodyH * 0.5), bodyW, 1);
  // Recycle-arrow badge: a light chasing-arrows triangle on the hopper side.
  const bx = Math.max(2, (bodyW >> 1) - 4);
  const by = bodyTop + Math.round(bodyH * 0.32);
  ctx.fillStyle = "#DCE8C0";
  ctx.fillRect(bx, by + 3, 9, 1); // base
  ctx.fillRect(bx + 1, by + 2, 1, 1); // left slope
  ctx.fillRect(bx + 7, by + 2, 1, 1); // right slope
  ctx.fillRect(bx + 4, by, 1, 3); // apex
  // Cab (front, right-facing) with a windowed glint and a top highlight.
  const cabW = 16;
  const cabH = Math.round(bodyH * 0.74);
  const cabY = axleY - cabH;
  ctx.fillStyle = "#5A8A54";
  ctx.fillRect(bodyW, cabY, cabW, cabH);
  ctx.fillStyle = "#CFE4FF";
  ctx.fillRect(bodyW + 6, cabY + 3, 8, Math.max(3, Math.round(cabH * 0.42)));
  ctx.fillStyle = "#E4F0FF";
  ctx.fillRect(bodyW + 6, cabY + 3, 8, 1);
  // Rear loader mouth, with a couple of bags waiting at it.
  ctx.fillStyle = "#3A5A36";
  ctx.fillRect(0, bodyTop + 4, 4, bodyH - 4);
  ctx.fillStyle = "#7A8A64";
  ctx.fillRect(1, axleY - 4, 3, 4);
  ctx.fillRect(4, axleY - 3, 3, 3);
  // Two-tone wheels (tire + hub), integer rects (no arcs).
  for (const wx of [8, bodyW - 10, bodyW + 8]) {
    ctx.fillStyle = "#16181C";
    ctx.fillRect(wx - 1, axleY, wheel, wheel);
    ctx.fillStyle = "#5A5E66";
    ctx.fillRect(wx + 1, axleY + 2, 3, 3);
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

/** Height of the metro train, in px: the party-ratified "one and a half
 *  floor" consist for the high-platform station. The train's base rides the
 *  track bed at the station's bottom edge; at this height its window band
 *  clears the raised platform deck (one story up, see METRO_DECK_STORIES in
 *  the station draw) so waiting commuters stand face-to-face with the cars.
 *  The body, window band, stripe, and undercarriage all size off this
 *  constant; the headlight and coupling gaps stay fixed. */
export const METRO_TRAIN_H = 60;

/** Length of one carriage, in px. The train actor spans the whole lot, so the
 *  body is drawn as a consist of coupled cars rather than one endless tube. */
const METRO_CAR_W = 150;

/** The subway consist, drawn at (0,0) into a w x METRO_TRAIN_H rect: coupled
 *  silver cars with lit window bands, sliding door pairs, roof pods, a red
 *  livery stripe, and bogies under each car. It is its own Excalibur Actor;
 *  the engine slides it in and out along the platform (it enters from the
 *  left, so the cab and headlight face right-of-travel at the left end). */
export function drawMetroTrain(ctx: CanvasRenderingContext2D, w: number, headlightOn: boolean): void {
  const H = METRO_TRAIN_H;
  const skirtY = H - 8; // undercarriage top
  const stripeY = H - 22; // red livery band
  const bandY = Math.round(H * 0.22); // window band top
  const bandH = Math.round(H * 0.3);
  for (let cx = 0; cx < w; cx += METRO_CAR_W) {
    const cw = Math.min(METRO_CAR_W, w - cx) - 4; // 4px coupling gap per car
    if (cw <= 0) break;
    // Car body: silver shell with a lit roof edge and a shaded lower flank.
    ctx.fillStyle = "#C6CCD4";
    ctx.fillRect(cx, 2, cw, skirtY - 2);
    ctx.fillStyle = "#E0E6EC"; // roof highlight
    ctx.fillRect(cx + 1, 2, cw - 2, 2);
    ctx.fillStyle = "#AEB6C0"; // lower body shade
    ctx.fillRect(cx, stripeY + 5, cw, skirtY - stripeY - 5);
    // Roof equipment: an AC pod per car and a thin conduit line.
    ctx.fillStyle = "#9AA2AC";
    ctx.fillRect(cx + Math.max(6, cw >> 1) - 10, 0, 20, 2);
    ctx.fillStyle = "#7E8894";
    ctx.fillRect(cx + 4, 1, cw - 8, 1);
    // Window band with glass glints, interrupted by sliding door pairs.
    for (let wx = cx + 10; wx + 12 < cx + cw; wx += 24) {
      const doorSlot = Math.floor((wx - cx) / 24) % 3 === 2;
      if (doorSlot) {
        // Door pair: two leaves, center seam, tall door windows.
        ctx.fillStyle = "#B4BCC6";
        ctx.fillRect(wx, bandY - 2, 12, skirtY - bandY - 2);
        ctx.fillStyle = "#16181C"; // center seam
        ctx.fillRect(wx + 5, bandY - 2, 1, skirtY - bandY - 2);
        ctx.fillStyle = "#2A3440"; // door windows
        ctx.fillRect(wx + 1, bandY, 3, bandH - 2);
        ctx.fillRect(wx + 7, bandY, 3, bandH - 2);
      } else {
        ctx.fillStyle = "#2A3440"; // lit saloon window
        ctx.fillRect(wx, bandY, 12, bandH);
        ctx.fillStyle = "#9FC0E0"; // glass glint
        ctx.fillRect(wx, bandY, 4, 2);
      }
    }
    // Red livery stripe with a light catch, full car length.
    ctx.fillStyle = "#D0392B";
    ctx.fillRect(cx, stripeY, cw, 4);
    ctx.fillStyle = "#E85D4A";
    ctx.fillRect(cx, stripeY, cw, 1);
    // Undercarriage skirt and two bogies (wheel trucks) per car.
    ctx.fillStyle = "#1A2028";
    ctx.fillRect(cx + 2, skirtY, cw - 4, H - skirtY);
    ctx.fillStyle = "#0E1116";
    for (const bx of [cx + 14, cx + cw - 34]) {
      if (bx > cx && bx + 20 < cx + cw) {
        ctx.fillRect(bx, H - 6, 20, 6);
        ctx.fillStyle = "#2E3640"; // wheel glint
        ctx.fillRect(bx + 3, H - 4, 4, 2);
        ctx.fillRect(bx + 13, H - 4, 4, 2);
        ctx.fillStyle = "#0E1116";
      }
    }
    // Coupling diaphragm in the gap to the next car.
    if (cx + METRO_CAR_W < w) {
      ctx.fillStyle = "#3A4048";
      ctx.fillRect(cx + cw, Math.round(H * 0.3), 4, Math.round(H * 0.4));
    }
  }
  // Cab nose at the leading (left) end: windshield, destination board, and the
  // headlight keyed on state (#9FC0E0 stays the one dark-headlight literal the
  // narrow-carriage test isolates; the window loop above starts at x 10 with a
  // 12px guard, so a w=8 bake paints no glints).
  ctx.fillStyle = "#B4BCC6";
  ctx.fillRect(0, 4, 5, skirtY - 6);
  ctx.fillStyle = "#20262E"; // windshield
  ctx.fillRect(1, bandY - 2, 4, Math.round(bandH * 0.8));
  ctx.fillStyle = "#E8C14A"; // destination board
  ctx.fillRect(1, 6, 4, 3);
  ctx.fillStyle = headlightOn ? "#FFE27A" : "#9FC0E0"; // headlight, keyed on state
  ctx.fillRect(0, stripeY - 6, 3, 4);
}
