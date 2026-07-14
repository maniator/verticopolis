import { ACCENTS } from "../common";

/**
 * The moving actors: the garbage truck, the parking-ramp sedans, and the
 * metro train. Each is drawn at local (0,0) into its own small canvas; the
 * engine slides the resulting Excalibur Actor along a track (see
 * `TowerEngine`). Extracted verbatim from `facilities.ts`.
 */

/** The garbage truck that empties the recycling centers each morning — its own
 *  Excalibur Actor (like the metro train); the engine slides it along the
 *  center's bottom story during the collection hour. Drawn at (0,0) into w×16. */
export function drawGarbageTruck(ctx: CanvasRenderingContext2D, w: number): void {
  const bodyW = w - 12;
  // Hopper body (municipal green with rib lines).
  ctx.fillStyle = "#4a7a44";
  ctx.fillRect(0, 2, bodyW, 9);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  for (let rx = 3; rx < bodyW - 2; rx += 6) ctx.fillRect(rx, 3, 1, 7);
  ctx.fillStyle = "rgba(255,255,255,0.4)"; // top rim
  ctx.fillRect(0, 2, bodyW, 1);
  // Cab (front, right-facing) with a window.
  ctx.fillStyle = "#5a8a54";
  ctx.fillRect(bodyW, 4, 10, 7);
  ctx.fillStyle = "#cfe4ff";
  ctx.fillRect(bodyW + 5, 5, 4, 3);
  // Loader mouth at the back.
  ctx.fillStyle = "#3a5a36";
  ctx.fillRect(0, 5, 3, 6);
  // Wheels.
  ctx.fillStyle = "#1b1f2a";
  for (const wx of [4, bodyW - 6, bodyW + 4]) {
    ctx.beginPath();
    ctx.arc(wx, 12, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#6a6f7a"; // hubs
  for (const wx of [4, bodyW - 6, bodyW + 4]) ctx.fillRect(wx - 1, 11, 2, 2);
}

/** A small sedan for the garage floors — its own Actor; the engine drives it
 *  along the parking run at commute hours. Drawn at (0,0) into 16×8. */
export function drawStreetCar(ctx: CanvasRenderingContext2D, seed: number): void {
  const color = ACCENTS[Math.abs(seed) % ACCENTS.length];
  ctx.fillStyle = color;
  ctx.fillRect(1, 2, 14, 4); // body
  ctx.fillRect(4, 0, 7, 3); // cabin
  ctx.fillStyle = "#cfe4ff";
  ctx.fillRect(5, 1, 2, 2); // windows
  ctx.fillRect(8, 1, 2, 2);
  ctx.fillStyle = "#1b1f2a"; // wheels
  ctx.fillRect(3, 6, 3, 2);
  ctx.fillRect(10, 6, 3, 2);
}

/** The subway carriage graphic, drawn at (0,0) into a w×9 rect. It is its own
 *  Excalibur Actor; the engine slides it in and out along the platform. */
export function drawMetroTrain(ctx: CanvasRenderingContext2D, w: number, headlightOn: boolean): void {
  ctx.fillStyle = "#cdd3da"; // silver carriage
  ctx.fillRect(0, 0, w, 9);
  ctx.fillStyle = "#e0454a"; // livery stripe
  ctx.fillRect(0, 6, w, 2);
  ctx.fillStyle = "#3a4250"; // window band
  for (let wx = 4; wx + 5 < w; wx += 9) ctx.fillRect(wx, 2, 5, 3);
  ctx.fillStyle = headlightOn ? "#ffe27a" : "#9fc0ff"; // headlight blink
  ctx.fillRect(1, 3, 2, 2);
}
