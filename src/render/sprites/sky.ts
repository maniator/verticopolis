/**
 * The sky layer's pure painters: the hour-driven sky color, the sun and moon
 * disc, and the drifting clouds. Moved out of the Excalibur scene module
 * (`excalibur/towerScene.ts`, which keeps the per-frame placement math) so the
 * atlas exporter can paint the same pixels without an engine. No drawing
 * changed in the move.
 */

/** Sky fill for an in-game hour (fractional hours allowed): a cosine blend
 *  from the night blue at 01:00 to the day blue at 13:00. */
export function skyColor(hour: number): string {
  const t = Math.cos(((hour - 13) / 24) * Math.PI * 2) * 0.5 + 0.5; // 1 at midday
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const r = mix(28, 130);
  const g = mix(34, 175);
  const b = mix(70, 224);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Sun radius by day, moon radius by night, in px. */
export const SUN_R = 16;
export const MOON_R = 11;

/** The sun (day) or moon (night) disc centered on (cx, cy). */
export function drawSunDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, day: boolean): void {
  ctx.fillStyle = day ? "#fff7c0" : "#eef";
  ctx.beginPath();
  ctx.arc(cx, cy, day ? SUN_R : MOON_R, 0, Math.PI * 2);
  ctx.fill();
}

/** How many clouds an overcast or rainy sky carries. */
export const CLOUD_COUNT = 5;

/** The fixed seed of cloud `i`; it drives the cloud's size, height and speed. */
export function cloudSeed(i: number): number {
  return i * 97 + 11;
}

/** A cloud's puff radius from its seed. */
export function cloudRadius(seed: number): number {
  return 56 + (seed % 44);
}

/** Cloud fill: a dark gray in the rain, a bright white on an overcast day. */
export function cloudFill(weather: string): string {
  return weather === "rain" ? "rgba(86,92,108,0.55)" : "rgba(244,247,255,0.72)";
}

/** One cloud: four overlapping puffs filled with the current `fillStyle`. */
export function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
  ctx.arc(x + r * 0.5, y + 4, r * 0.4, 0, Math.PI * 2);
  ctx.arc(x - r * 0.5, y + 4, r * 0.38, 0, Math.PI * 2);
  ctx.arc(x, y + 9, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}
