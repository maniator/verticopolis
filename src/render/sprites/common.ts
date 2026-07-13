import { person } from "../pixelSprites";

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}
/** Like {@link shade}, but returns a translucent `rgba()` for a glass fill. */
export function shadeAlpha(hex: string, amt: number, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  // Clamp alpha into [0,1] (and default a non-finite value to opaque) so a
  // future caller can never emit an invalid rgba() string.
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${r},${g},${b},${a})`;
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
/** Deterministic 0..1 from an integer seed — for stable per-unit variety. */
export function rand(seed: number): number {
  let x = (seed * 2654435761) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export const ACCENTS = ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a", "#b07fe0", "#e88f4a", "#4ad0c0"];

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  /** Whether the tower interior should look "lit" (evening/night). */
  lit: boolean;
  /** Continuous animation time in seconds (for flicker / motion). */
  anim: number;
  /** In-game hour 0..23, for time-of-day behavior. */
  hour: number;
  /** 0..1 transport overcrowding; tints walking crowds "angry" when high. */
  stress?: number;
  /** 0..1 fraction of working parking spaces holding a car right now (office
   *  cars by day, suite guests' cars overnight) — drives the garage visuals. */
  parkingUse?: number;
  /** Per-unit flag set by the room bake closure: this parking space is dead
   *  (not chained to a ramp), so no car could ever have reached it. */
  parkingDead?: boolean;
  /** 0..1 how full the recycling centers are right now (shared load) —
   *  garbage piles up through the day until the morning truck collection. */
  recycleFill?: number;
}

/** The 7px signage every service facility paints on its back wall; hidden
 *  when the room is too narrow to fit it. */
export function serviceLabel(ctx: CanvasRenderingContext2D, text: string, sx: number, y: number, color: string, minW: number, w: number) {
  ctx.fillStyle = color;
  ctx.font = "7px system-ui, sans-serif";
  if (w > minW) ctx.fillText(text, sx, y + 11);
}

/** Scatter standing people along a strip — the crowd idiom shared by the
 *  party hall and the metro platform (same seeded density gate). */
export function scatterPeople(ctx: CanvasRenderingContext2D, startX: number, endX: number, step: number, footY: number, scale: number) {
  for (let px = startX; px < endX; px += step) {
    if (rand(px | 0) > 0.4) person(ctx, px, footY, scale, px | 0);
  }
}

export function serviceBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = shade(color, -45);
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 4, w - 4, h - 9);
}
